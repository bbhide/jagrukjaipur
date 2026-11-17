import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q, tx, type Queryable } from "../../db.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { cleanHtml, slugify } from "../../lib/text.js";
import { readMultipart, removeImage, saveImage } from "../../lib/uploads.js";

const id = z.coerce.number().int().positive();
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(blank, s.optional());
const bool = z.preprocess((v) => v === true || v === "on" || v === "1" || v === "true" || v === 1, z.boolean());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Enter a valid time.");
const arr = (v: unknown) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

const eventSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(300, "Title is too long (max 300 characters)."),
  status: z.enum(["draft", "published", "cancelled", "past"]).default("draft"),
  short_description: z.string().trim().max(500, "Short description is too long (max 500 characters).").optional(),
  description: z.string().max(60000).optional(),
  event_date: dateStr,
  event_time: opt(timeStr),
  end_date: opt(dateStr),
  end_time: opt(timeStr),
  organizer_id: opt(z.coerce.number().int().positive()),
  venue_id: opt(z.coerce.number().int().positive()),
  is_free: bool,
  ticket_url: opt(z.string().trim().url("Ticket URL must be a valid link.").max(1000)),
  button_text: opt(z.string().trim().max(40)),
  ticket_price: opt(z.string().trim().max(60)),
  is_featured: bool,
  is_exclusive: bool,
  is_recurring: bool,
  recurrence_type: opt(z.enum(["weekly", "monthly"])),
  recurrence_days: z.preprocess(arr, z.array(z.coerce.number().int().min(0).max(6))),
  recurrence_day_of_month: opt(z.coerce.number().int().min(1).max(31)),
  category_id: z.preprocess(arr, z.array(z.coerce.number().int().positive()).min(1, "Choose at least one category.").max(3, "Choose up to 3 categories.")),
  submission_id: opt(z.coerce.number().int().positive()),
});

const ROW_COLS = `id, title, slug, short_description, description, event_date, event_time, end_date, end_time, organizer_id, venue_id,
  image_path, thumb_path, is_free, ticket_url, button_text, ticket_price, is_featured, is_exclusive, is_recurring,
  recurrence_type, recurrence_days, recurrence_day_of_month, status, views, interests, has_ticketing, source, approval_status`;

async function uniqueSlug(db: Queryable, title: string, excludeId?: number) {
  const base = slugify(title);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const hit = await one(`SELECT 1 FROM events WHERE slug = $1 AND id <> $2`, [slug, excludeId ?? 0], db);
    if (!hit) return slug;
  }
}

async function parse(req: any) {
  const { fields, files } = await readMultipart(req);
  const b = eventSchema.parse(fields);
  if (b.end_date && b.end_date < b.event_date) throw badRequest("End date cannot be before the start date.");
  b.category_id = [...new Set(b.category_id)];
  const found = await q(`SELECT id FROM categories WHERE id = ANY($1::int[])`, [b.category_id]);
  if (found.length !== b.category_id.length) throw badRequest("One of the selected categories does not exist.");
  if (b.organizer_id && !(await one(`SELECT 1 FROM organizers WHERE id = $1`, [b.organizer_id]))) throw badRequest("Selected organiser does not exist.");
  if (b.venue_id && !(await one(`SELECT 1 FROM venues WHERE id = $1`, [b.venue_id]))) throw badRequest("Selected venue does not exist.");
  const recurring = b.is_recurring && !!b.recurrence_type;
  const values = {
    ...b,
    description: cleanHtml(b.description),
    short_description: b.short_description || null,
    button_text: b.button_text || "Get Tickets",
    ticket_price: b.is_free ? null : b.ticket_price ?? null,
    is_recurring: recurring,
    recurrence_type: recurring ? b.recurrence_type! : null,
    recurrence_days: recurring && b.recurrence_type === "weekly" ? [...new Set(b.recurrence_days)].sort() : [],
    recurrence_day_of_month: recurring && b.recurrence_type === "monthly" ? b.recurrence_day_of_month ?? null : null,
  };
  return { values, file: files.image };
}

export default async function (app: FastifyInstance) {
  app.get("/events/form-options", async () => {
    const [categories, organizers, venues] = await Promise.all([
      q(`SELECT id, name, icon FROM categories WHERE is_active AND NOT is_system ORDER BY sort_order, id`),
      q(`SELECT id, name, contact FROM organizers ORDER BY name`),
      q(`SELECT id, name FROM venues ORDER BY name`),
    ]);
    return { categories, organizers, venues };
  });

  app.get("/events", async (req) => {
    const qs = z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(["draft", "published", "cancelled", "past"]).optional().catch(undefined),
      page: z.coerce.number().int().min(1).catch(1).default(1),
    }).parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (qs.q) { params.push(`%${qs.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`); where.push(`e.title ILIKE $${params.length}`); }
    if (qs.status) { params.push(qs.status); where.push(`e.status = $${params.length}`); }
    const W = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM events e ${W}`, params))!.n;
    const per = 20;
    const items = await q(
      `SELECT e.id, e.title, e.slug, e.image_path, e.thumb_path, e.event_date, e.end_date, e.event_time, e.status, e.views,
              e.is_featured, e.is_exclusive, e.is_recurring, e.is_free, e.has_ticketing, v.name AS venue_name,
              (SELECT c.name FROM event_categories ec JOIN categories c ON c.id = ec.category_id WHERE ec.event_id = e.id ORDER BY ec.position, c.id LIMIT 1) AS category
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id ${W}
       ORDER BY e.event_date DESC, e.id DESC LIMIT ${per} OFFSET ${(qs.page - 1) * per}`, params);
    return { items, total, page: qs.page, pages: Math.max(1, Math.ceil(total / per)) };
  });

  app.get("/events/:id", async (req) => {
    const { id: eid } = z.object({ id }).parse(req.params);
    const row = await one(`SELECT ${ROW_COLS} FROM events WHERE id = $1`, [eid]);
    if (!row) throw notFound("Event not found.");
    const cats = await q<{ category_id: number }>(`SELECT category_id FROM event_categories WHERE event_id = $1 ORDER BY position, category_id`, [eid]);
    return { ...row, category_ids: cats.map((c) => c.category_id) };
  });

  const COLS = ["title", "slug", "short_description", "description", "event_date", "event_time", "end_date", "end_time", "organizer_id", "venue_id",
    "is_free", "ticket_url", "button_text", "ticket_price", "is_featured", "is_exclusive", "is_recurring", "recurrence_type", "recurrence_days",
    "recurrence_day_of_month", "status"] as const;

  app.post("/events", async (req) => {
    const { values: v, file } = await parse(req);
    const img = file ? await saveImage(file, "event") : null;
    try {
      const out = await tx(async (db) => {
        const slug = await uniqueSlug(db, v.title);
        const data: Record<string, unknown> = { ...v, slug, event_time: v.event_time ?? null, end_date: v.end_date ?? null, end_time: v.end_time ?? null,
          organizer_id: v.organizer_id ?? null, venue_id: v.venue_id ?? null, ticket_url: v.ticket_url ?? null, recurrence_days: v.recurrence_days };
        const params = [...COLS.map((c) => data[c] ?? null), img?.path ?? null, img?.thumb ?? null];
        const row = (await one<{ id: number; slug: string }>(
          `INSERT INTO events (${COLS.join(",")}, image_path, thumb_path) VALUES (${params.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id, slug`, params, db))!;
        for (const [i, c] of v.category_id.entries()) await q(`INSERT INTO event_categories (event_id, category_id, position) VALUES ($1,$2,$3)`, [row.id, c, i], db);
        if (v.submission_id) await q(`UPDATE submissions SET status = 'added' WHERE id = $1 AND kind = 'event'`, [v.submission_id], db);
        return row;
      });
      return { success: true, id: out.id, slug: out.slug };
    } catch (e) { if (img) { await removeImage(img.path); await removeImage(img.thumb); } throw e; }
  });

  app.put("/events/:id", async (req) => {
    const { id: eid } = z.object({ id }).parse(req.params);
    const old = await one<{ title: string; slug: string; status: string; image_path: string | null; thumb_path: string | null }>(
      `SELECT title, slug, status, image_path, thumb_path FROM events WHERE id = $1`, [eid]);
    if (!old) throw notFound("Event not found.");
    const { values: v, file } = await parse(req);
    const img = file ? await saveImage(file, "event") : null;
    try {
      const slug = await tx(async (db) => {
        const slug = v.title !== old.title && old.status === "draft" ? await uniqueSlug(db, v.title, eid) : old.slug;
        const data: Record<string, unknown> = { ...v, slug };
        const params: unknown[] = COLS.map((c) => data[c] ?? null);
        let set = COLS.map((c, i) => `${c} = $${i + 1}`).join(", ");
        if (img) { params.push(img.path, img.thumb); set += `, image_path = $${params.length - 1}, thumb_path = $${params.length}`; }
        params.push(eid);
        await q(`UPDATE events SET ${set}, updated_at = now() WHERE id = $${params.length}`, params, db);
        await q(`DELETE FROM event_categories WHERE event_id = $1`, [eid], db);
        for (const [i, c] of v.category_id.entries()) await q(`INSERT INTO event_categories (event_id, category_id, position) VALUES ($1,$2,$3)`, [eid, c, i], db);
        return slug;
      });
      if (img) { await removeImage(old.image_path); await removeImage(old.thumb_path); }
      return { success: true, id: eid, slug };
    } catch (e) { if (img) { await removeImage(img.path); await removeImage(img.thumb); } throw e; }
  });

  app.delete("/events/:id", async (req) => {
    const { id: eid } = z.object({ id }).parse(req.params);
    const old = await one<{ image_path: string | null; thumb_path: string | null }>(`SELECT image_path, thumb_path FROM events WHERE id = $1`, [eid]);
    if (!old) throw notFound("Event not found.");
    try { await q(`DELETE FROM events WHERE id = $1`, [eid]); }
    catch (e: any) { if (e?.code === "23503") throw conflict("This event has ticket bookings and cannot be deleted. Mark it as cancelled instead."); throw e; }
    await removeImage(old.image_path); await removeImage(old.thumb_path);
    return { success: true };
  });
}
