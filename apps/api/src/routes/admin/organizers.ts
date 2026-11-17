import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q, tx, type Queryable } from "../../db.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { slugify } from "../../lib/text.js";
import { readMultipart, removeImage, saveImage } from "../../lib/uploads.js";

const id = z.coerce.number().int().positive();
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(blank, s.optional());
const bool = z.preprocess((v) => v === true || v === "on" || v === "1" || v === "true", z.boolean());
const arr = (v: unknown) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

const FEATURE_ICONS: Record<string, string> = {
  "Paid Events": "🎟️", "Group Chat": "💬", "Workshops": "📚", "Kid Friendly": "🧸", "Free Events": "🆓", "Networking": "🤝", "Open Mic": "🎤",
};

const schema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  contact: opt(z.string().trim().max(120)),
  is_active: bool,
  is_community: bool,
  about: opt(z.string().trim().max(5000)),
  special: opt(z.string().trim().max(2000)),
  social_instagram: opt(z.string().trim().max(300)),
  social_facebook: opt(z.string().trim().max(300)),
  social_twitter: opt(z.string().trim().max(300)),
  social_whatsapp: opt(z.string().trim().max(300)),
  social_website: opt(z.string().trim().max(300)),
  category_id: z.preprocess(arr, z.array(z.coerce.number().int().positive()).max(3, "Choose up to 3 themes.")),
  features: z.preprocess(arr, z.array(z.string())),
  custom_feature_icon: z.preprocess(arr, z.array(z.string())),
  custom_feature_label: z.preprocess(arr, z.array(z.string())),
});

function buildFeatures(b: z.infer<typeof schema>) {
  const out: { icon: string; label: string }[] = [];
  for (const label of b.features) if (FEATURE_ICONS[label]) out.push({ icon: FEATURE_ICONS[label], label });
  b.custom_feature_label.forEach((label, i) => {
    const l = label.trim().slice(0, 40);
    if (l) out.push({ icon: (b.custom_feature_icon[i] ?? "").trim().slice(0, 8) || "✨", label: l });
  });
  return out;
}

const SELECT = `SELECT id, name, slug, contact, is_active, is_community, logo_path, about, special, features,
  social_instagram, social_facebook, social_twitter, social_whatsapp, social_website FROM organizers`;

async function setCategories(db: Queryable, oid: number, ids: number[]) {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const found = await q(`SELECT id FROM categories WHERE id = ANY($1::int[])`, [unique], db);
    if (found.length !== unique.length) throw badRequest("One of the selected themes does not exist.");
  }
  await q(`DELETE FROM organizer_categories WHERE organizer_id = $1`, [oid], db);
  for (const [i, c] of unique.entries()) await q(`INSERT INTO organizer_categories (organizer_id, category_id, position) VALUES ($1,$2,$3)`, [oid, c, i], db);
}

const FIELDS = ["name", "contact", "is_active", "is_community", "about", "special", "social_instagram", "social_facebook", "social_twitter", "social_whatsapp", "social_website"] as const;

export default async function (app: FastifyInstance) {
  app.get("/organizers", async (req) => {
    const { type } = z.object({ type: z.enum(["all", "organizer", "community"]).catch("all").default("all") }).parse(req.query);
    const where = type === "community" ? "WHERE is_community" : type === "organizer" ? "WHERE NOT is_community" : "";
    return { items: await q(`SELECT id, name, slug, contact, is_active, is_community, logo_path FROM organizers ${where} ORDER BY name, id`) };
  });

  app.get("/organizers/:id", async (req) => {
    const { id: oid } = z.object({ id }).parse(req.params);
    const row = await one(`${SELECT} WHERE id = $1`, [oid]);
    if (!row) throw notFound("Organiser not found.");
    const cats = await q<{ category_id: number }>(`SELECT category_id FROM organizer_categories WHERE organizer_id = $1 ORDER BY position`, [oid]);
    return { ...row, category_ids: cats.map((c) => c.category_id) };
  });

  app.post("/organizers", async (req) => {
    const { fields, files } = await readMultipart(req);
    const b = schema.parse(fields);
    const logo = files.logo ? await saveImage(files.logo, "org_logo") : null;
    try {
      const out = await tx(async (db) => {
        const base = slugify(b.name);
        let slug = base;
        for (let n = 2; await one(`SELECT 1 FROM organizers WHERE slug = $1`, [slug], db); n++) slug = `${base}-${n}`;
        const data = b as Record<string, any>;
        const params = [...FIELDS.map((f) => data[f] ?? null), slug, logo?.path ?? null, JSON.stringify(buildFeatures(b))];
        const row = (await one<{ id: number }>(
          `INSERT INTO organizers (${FIELDS.join(",")}, slug, logo_path, features) VALUES (${params.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, params, db))!;
        await setCategories(db, row.id, b.category_id);
        return { id: row.id, slug };
      });
      return { success: true, ...out };
    } catch (e) { if (logo) await removeImage(logo.path); throw e; }
  });

  app.put("/organizers/:id", async (req) => {
    const { id: oid } = z.object({ id }).parse(req.params);
    const old = await one<{ logo_path: string | null }>(`SELECT logo_path FROM organizers WHERE id = $1`, [oid]);
    if (!old) throw notFound("Organiser not found.");
    const { fields, files } = await readMultipart(req);
    const b = schema.parse(fields);
    const logo = files.logo ? await saveImage(files.logo, "org_logo") : null;
    try {
      await tx(async (db) => {
        const data = b as Record<string, any>;
        const params: unknown[] = [...FIELDS.map((f) => data[f] ?? null), JSON.stringify(buildFeatures(b))];
        let set = [...FIELDS, "features"].map((c, i) => `${c} = $${i + 1}`).join(", ");
        if (logo) { params.push(logo.path); set += `, logo_path = $${params.length}`; }
        params.push(oid);
        await q(`UPDATE organizers SET ${set}, updated_at = now() WHERE id = $${params.length}`, params, db);
        await setCategories(db, oid, b.category_id);
      });
      if (logo) await removeImage(old.logo_path);
      return { success: true, id: oid };
    } catch (e) { if (logo) await removeImage(logo.path); throw e; }
  });

  app.delete("/organizers/:id", async (req) => {
    const { id: oid } = z.object({ id }).parse(req.params);
    const old = await one<{ logo_path: string | null }>(`SELECT logo_path FROM organizers WHERE id = $1`, [oid]);
    if (!old) throw notFound("Organiser not found.");
    try { await q(`DELETE FROM organizers WHERE id = $1`, [oid]); }
    catch (e: any) { if (e?.code === "23503") throw conflict("This organiser has payout settlements on record and cannot be deleted. Mark it inactive instead."); throw e; }
    await removeImage(old.logo_path);
    return { success: true };
  });
}
