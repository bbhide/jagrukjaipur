import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../db.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { USER_COOKIE, createSession, destroySession, readSession, requireUser, setLoggedInFlag, updateSession } from "../lib/session.js";
import { normaliseInstagram, normaliseMobile } from "../lib/text.js";
import { sendOtp, verifyOtp } from "../services/otp.js";

const sendBody = z.object({ whatsapp_number: z.string(), source_page: z.string().max(300).optional(), source_button: z.string().max(300).optional() });
const verifyBody = z.object({ otp: z.string().regex(/^\d{4}$/, "Enter the 4-digit code.") });
const completeBody = z.object({ name: z.string().trim().min(2, "Please enter your full name.").max(80), email: z.email("Please enter a valid email address.").max(160) });
const profileBody = z.object({
  name: z.string().trim().min(2, "Please enter your full name.").max(80),
  gender: z.enum(["Male", "Female", "Other", "Prefer not to say", ""]).optional(),
  dob: z.union([z.iso.date(), z.literal("")]).optional(),
  email: z.union([z.email("Please enter a valid email address."), z.literal("")]).optional(),
  instagram_username: z.string().max(120).optional(),
});

const PROFILE_COLS = `id, whatsapp_number, name, gender, dob, email, instagram_username`;

export default async function authRoutes(app: FastifyInstance) {
  // Step 1 — request a code. The pending number lives in a server-side session, never in the client.
  app.post("/auth/otp/send", { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const body = sendBody.parse(req.body);
    const number = normaliseMobile(body.whatsapp_number);
    if (!number) throw badRequest("Please enter a valid 10-digit mobile number.");
    const otpId = await sendOtp(number, { sourcePage: body.source_page, sourceButton: body.source_button, ip: req.ip });
    const existing = await readSession(req, USER_COOKIE);
    const data = { whatsapp_number: number, otp_id: otpId };
    if (existing && existing.kind === "pending") await updateSession(existing.id, { data });
    else await createSession(reply, "pending", null, data);
    return { success: true };
  });

  // Step 2 — verify. Known users are logged in; new numbers still owe a name and email.
  app.post("/auth/otp/verify", { config: { rateLimit: { max: 15, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { otp } = verifyBody.parse(req.body);
    const s = await readSession(req, USER_COOKIE);
    if (!s || s.kind !== "pending" || !s.data.otp_id) throw badRequest("Please request a new OTP.");
    await verifyOtp(s.data.otp_id, s.data.whatsapp_number, otp);
    const user = await one<{ id: number; name: string | null }>(
      `INSERT INTO users (whatsapp_number) VALUES ($1)
       ON CONFLICT (whatsapp_number) DO UPDATE SET updated_at = now() RETURNING id, name`, [s.data.whatsapp_number]);
    await updateSession(s.id, { kind: "user", subject_id: user!.id, data: {} });
    if (user!.name) { setLoggedInFlag(reply); return { success: true, status: "logged_in", name: user!.name }; }
    return { success: true, status: "need_name" };
  });

  // Step 3 — first-time users complete registration.
  app.post("/auth/complete", async (req, reply) => {
    const body = completeBody.parse(req.body);
    const s = await readSession(req, USER_COOKIE);
    if (!s || s.kind !== "user" || !s.subject_id) throw unauthorized("Please verify your WhatsApp number first.");
    await q(`UPDATE users SET name = $2, email = $3, updated_at = now() WHERE id = $1`, [s.subject_id, body.name, body.email]);
    setLoggedInFlag(reply);
    return { success: true, name: body.name };
  });

  app.post("/auth/logout", async (req, reply) => {
    await destroySession(req, reply, USER_COOKIE);
    return { success: true };
  });

  app.get("/me", async (req) => {
    const u = await requireUser(req);
    const user = await one(`SELECT ${PROFILE_COLS} FROM users WHERE id = $1`, [u.id]);
    const organizer = await one(`SELECT id, name, slug, approval_status, ticketing_enabled FROM organizers WHERE user_id = $1`, [u.id]);
    return { success: true, user, organizer };
  });

  app.put("/me", async (req) => {
    const u = await requireUser(req);
    const b = profileBody.parse(req.body);
    const user = await one(
      `UPDATE users SET name = $2, gender = $3, dob = $4, email = $5, instagram_username = $6, updated_at = now() WHERE id = $1 RETURNING ${PROFILE_COLS}`,
      [u.id, b.name, b.gender || null, b.dob || null, b.email || null, normaliseInstagram(b.instagram_username)]);
    return { success: true, user };
  });
}
