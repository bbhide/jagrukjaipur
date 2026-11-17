/** Settings & integrations (Gemini, Razorpay, notification e-mails) and the Gemini event extractor. Secrets are never returned. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { q } from "../../db.js";
import { badRequest, HttpError } from "../../lib/errors.js";
import { readMultipart } from "../../lib/uploads.js";

export async function getSetting(key: string): Promise<string | null> {
  const rows = await q<{ value: string | null }>(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}
export async function setSetting(key: string, value: string) {
  await q(`INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, value]);
}
const DEFAULT_MODEL = "gemini-3.5-flash";

/** Stored value first, env fallback. */
async function geminiKey() { return (await getSetting("gemini_api_key")) || config.GEMINI_API_KEY || null; }
async function geminiModel() { return (await getSetting("gemini_model")) || DEFAULT_MODEL; }
async function razorpayCreds() {
  return { id: (await getSetting("razorpay_key_id")) || config.RAZORPAY_KEY_ID || null, secret: (await getSetting("razorpay_key_secret")) || config.RAZORPAY_KEY_SECRET || null };
}

const modelName = z.string().trim().regex(/^[A-Za-z0-9._-]{1,80}$/, "Model name may only contain letters, digits, dots, dashes and underscores.");

async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 15000) });
    const text = await res.text();
    let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export default async function settingsRoutes(app: FastifyInstance) {
  app.get("/settings", async () => {
    const [gKey, model, rz, emails] = await Promise.all([geminiKey(), geminiModel(), razorpayCreds(), getSetting("admin_notification_emails")]);
    return {
      gemini_configured: !!gKey,
      gemini_model: model,
      razorpay_key_id: (await getSetting("razorpay_key_id")) ?? config.RAZORPAY_KEY_ID ?? "",
      razorpay_configured: !!(rz.id && rz.secret),
      admin_notification_emails: emails ?? "",
      smtp_configured: !!config.SMTP_URL,
    };
  });

  app.get("/settings/ai-status", async () => ({ configured: !!(await geminiKey()), model: await geminiModel() }));

  app.put("/settings/gemini", async (req) => {
    const body = z.object({ gemini_api_key: z.string().trim().max(300).optional(), gemini_model: modelName }).parse(req.body);
    let connected: boolean | null = null;
    if (body.gemini_api_key) {
      const r = await fetchJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": body.gemini_api_key } });
      if (!r.ok) {
        const why = r.status === 0 ? "Could not reach Google's API." : (r.body?.error?.message ?? `Google rejected the key (HTTP ${r.status}).`);
        throw badRequest(`Gemini connection failed: ${why.replace(/[.\s]*$/, "")}. Nothing was saved.`);
      }
      await setSetting("gemini_api_key", body.gemini_api_key);
      connected = true;
    }
    await setSetting("gemini_model", body.gemini_model);
    return { success: true, connected, message: connected ? "Gemini connected and settings saved." : "Model saved." };
  });

  app.put("/settings/razorpay", async (req) => {
    const body = z.object({
      razorpay_key_id: z.string().trim().min(1, "Razorpay Key ID is required.").max(100),
      razorpay_key_secret: z.string().trim().min(1, "Razorpay Key Secret is required.").max(200),
    }).parse(req.body);
    const auth = Buffer.from(`${body.razorpay_key_id}:${body.razorpay_key_secret}`).toString("base64");
    const r = await fetchJson("https://api.razorpay.com/v1/payments?count=1", { headers: { Authorization: `Basic ${auth}` } });
    if (!r.ok) {
      const why = r.status === 0 ? "Could not reach Razorpay." : (r.body?.error?.description ?? `Razorpay rejected the credentials (HTTP ${r.status}).`);
      throw badRequest(`Razorpay connection failed: ${why.replace(/[.\s]*$/, "")}. Nothing was saved.`);
    }
    await setSetting("razorpay_key_id", body.razorpay_key_id);
    await setSetting("razorpay_key_secret", body.razorpay_key_secret);
    return { success: true, connected: true, message: "Razorpay connected and keys saved." };
  });

  app.put("/settings/notifications", async (req) => {
    const { admin_notification_emails } = z.object({ admin_notification_emails: z.string().max(1000) }).parse(req.body);
    const list = admin_notification_emails.split(",").map((s) => s.trim()).filter(Boolean);
    const email = z.string().email();
    const bad = list.find((e) => !email.safeParse(e).success);
    if (bad) throw badRequest(`"${bad}" is not a valid e-mail address.`);
    await setSetting("admin_notification_emails", list.join(", "));
    return { success: true };
  });

  app.post("/settings/test-email", async () => {
    if (!config.SMTP_URL) throw badRequest("Email delivery is not configured (set SMTP_URL).");
    // Stub: no mail transport is bundled yet, so nothing is sent.
    throw new HttpError(501, "SMTP_URL is set, but e-mail sending is not implemented in this build yet.", "not_implemented");
  });

  // ── Gemini: extract event details from a poster and/or pasted text ──
  app.post("/ai/extract-event", async (req) => {
    const key = await geminiKey();
    if (!key) throw badRequest("Gemini is not configured. Add an API key under Settings & Integrations.");
    const { fields, files } = await readMultipart(req);
    const text = typeof fields.text === "string" ? fields.text.trim().slice(0, 12000) : "";
    const image = files.image;
    if (!text && !image) throw badRequest("Upload a poster image or paste some event text.");
    if (image && !/^image\/(jpeg|png|webp|gif)$/.test(image.mimetype)) throw badRequest("Please upload a JPEG, PNG, WebP or GIF image.");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const prompt =
      `You extract event details for a Jaipur (India) events guide. Today's date is ${today}. ` +
      `Return ONLY a JSON object with exactly these keys: title, short_description (max 300 chars), description (plain text or simple HTML paragraphs), ` +
      `event_date (YYYY-MM-DD), event_time (HH:MM, 24h), end_date (YYYY-MM-DD), end_time (HH:MM), venue_name, is_free (boolean), ` +
      `ticket_price (string label such as "499 onwards", empty if free), ticket_url, category_names (array of up to 3 short category names such as Music, Comedy, Workshop). ` +
      `Use null for anything not stated. If the year is missing assume the next upcoming occurrence.` +
      (text ? `\n\nEvent text:\n${text}` : "");
    const parts: any[] = [{ text: prompt }];
    if (image) parts.push({ inline_data: { mime_type: image.mimetype, data: image.buffer.toString("base64") } });
    const model = await geminiModel();
    const r = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", timeoutMs: 45000,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
    });
    if (r.status === 0) throw new HttpError(502, "Could not reach the Gemini API. Please try again.", "upstream_unavailable");
    if (!r.ok) throw new HttpError(502, `Gemini error: ${r.body?.error?.message ?? `HTTP ${r.status}`}`, "upstream_error");
    const raw: string | undefined = r.body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
    if (!raw) throw new HttpError(502, "Gemini returned no content. Try a clearer poster or more text.", "upstream_empty");
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return { success: true, ...parsed };
    } catch {
      throw new HttpError(502, "Gemini returned an unreadable response. Please try again.", "upstream_invalid");
    }
  });
}
