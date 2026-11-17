/**
 * Organiser portal API (ticketing partners). Layout and several business rules inferred — the legacy portal sat behind a
 * WhatsApp login and was not observable (see docs/01-reconnaissance.md §6). Everything is scoped to the organiser row that
 * belongs to the logged-in user (organizers.user_id).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { one, q, tx } from "../db.js";
import type { Queryable } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { requireUser, type AuthUser } from "../lib/session.js";
import { cleanHtml, normaliseMobile, slugify } from "../lib/text.js";
import { uniqueVenueSlug } from "../services/venues.js";
import { readMultipart, removeImage, saveImage } from "../lib/uploads.js";

// ─── Validation ───────────────────────────────────────────────
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());

const bankInput = z.object({
  account_holder: z.string().trim().min(2, "Enter the account holder name.").max(120),
  account_number: z.string().trim().max(40),
  ifsc: z.string().trim().toUpperCase().regex(IFSC_RE, "Enter a valid IFSC code (e.g. HDFC0001234)."),
  bank_name: z.string().trim().min(2, "Enter the bank name.").max(120),
});

const profileInput = z.object({
  name: z.string().trim().min(2, "Please enter your brand or organisation name.").max(120),
  email: z.email("Please enter a valid email address.").max(160),
  contact: z.string().trim().transform((v, ctx) => {
    const n = normaliseMobile(v);
    if (!n) { ctx.addIssue({ code: "custom", message: "Please enter a valid 10-digit contact number." }); return z.NEVER; }
    return n.slice(2);
  }),
  state: z.string().trim().min(2, "Please select your state.").max(60),
  gstin: z.preprocess(blank, z.string().trim().toUpperCase().regex(GSTIN_RE, "Enter a valid 15-character GSTIN.").optional()),
  about: optText(2000),
  bank: z.preprocess((v) => (v && typeof v === "object" && Object.values(v as object).every((x) => !x) ? undefined : v), bankInput.optional()),
});

const tiersInput = z.array(z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, "Every ticket tier needs a name.").max(80),
  price: z.coerce.number("Enter a ticket price.").min(0, "Ticket price cannot be negative.").max(1_000_000),
  capacity: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1, "Capacity must be at least 1.").max(1_000_000).optional()),
})).min(1, "Add at least one ticket tier.").max(10, "At most 10 ticket tiers.");

const questionsInput = z.array(z.object({
  label: z.string().trim().min(1).max(200),
  is_required: z.boolean().default(true),
})).max(3, "At most 3 custom questions.");

const couponsInput = z.array(z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, "Promo codes are 3–30 letters, numbers, - or _."),
  discount_type: z.enum(["percent", "fixed"]),
  discount_value: z.coerce.number().gt(0, "Discount must be more than 0.").max(1_000_000),
  max_uses: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(1_000_000).optional()),
  valid_until: z.preprocess(blank, z.iso.date().optional()),
})).max(20, "At most 20 promo codes.").superRefine((list, ctx) => {
  list.forEach((c, i) => {
    if (c.discount_type === "percent" && c.discount_value > 100) ctx.addIssue({ code: "custom", path: [i, "discount_value"], message: "A percentage discount cannot exceed 100." });
  });
  if (new Set(list.map((c) => c.code)).size !== list.length) ctx.addIssue({ code: "custom", message: "Promo codes must be unique." });
});

const eventInput = z.object({
  title: z.string().trim().min(3, "Please enter an event title.").max(160),
  category_id: z.array(z.coerce.number().int().positive()).min(1, "Choose at least one category.").max(3, "Choose at most 3 categories."),
  short_description: optText(300),
  description: optText(20000),
  event_date: z.iso.date("Please choose the event date."),
  event_time: z.preprocess(blank, z.string().regex(TIME_RE, "Enter a valid start time.").optional()),
  end_date: z.preprocess(blank, z.iso.date("Enter a valid end date.").optional()),
  end_time: z.preprocess(blank, z.string().regex(TIME_RE, "Enter a valid end time.").optional()),
  venue_id: z.preprocess(blank, z.coerce.number().int().positive().optional()),
  venue_name: optText(160),
  venue_area: optText(120),
  venue_address: optText(400),
  venue_maps_url: z.preprocess(blank, z.url({ protocol: /^https?$/, error: "Enter a valid Google Maps link." }).max(600).optional()),
  listing_type: z.enum(["free_listing", "ticketing"], "Choose a listing type."),
  ticket_url: z.preprocess(blank, z.url({ protocol: /^https?$/, error: "Enter a valid ticket link (https://…)." }).max(600).optional()),
}).superRefine((e, ctx) => {
  if (e.end_date && e.end_date < e.event_date) ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date cannot be before the start date." });
  if (!e.venue_id && !e.venue_name) ctx.addIssue({ code: "custom", path: ["venue_id"], message: "Choose a venue or enter a new one." });
});

function parseJson(raw: unknown, what: string): unknown {
  if (raw === undefined || raw === "") return [];
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { throw badRequest(`Could not read the ${what}.`); }
}

// ─── Helpers ──────────────────────────────────────────────────
interface OrganizerRow {
  id: number; name: string; slug: string; contact: string | null; about: string | null; email: string | null; gstin: string | null; state: string | null;
  bank_details: { account_holder: string; account_number: string; ifsc: string; bank_name: string } | null;
  commission_rate: number; absorption_mode: string; ticketing_enabled: boolean; approval_status: string; created_at: string;
}
const ORG_COLS = `id, name, slug, contact, about, email, gstin, state, bank_details, commission_rate, absorption_mode, ticketing_enabled, approval_status, created_at`;

const mask = (n: string) => (n.length <= 4 ? n : `${"X".repeat(Math.max(n.length - 4, 4))}${n.slice(-4)}`);

function publicOrganizer(o: OrganizerRow) {
  const { bank_details, ...rest } = o;
  return { ...rest, bank: bank_details ? { account_holder: bank_details.account_holder, account_number_masked: mask(bank_details.account_number), ifsc: bank_details.ifsc, bank_name: bank_details.bank_name } : null };
}

async function getOrganizer(user: AuthUser): Promise<OrganizerRow | null> {
  return one<OrganizerRow>(`SELECT ${ORG_COLS} FROM organizers WHERE user_id = $1`, [user.id]);
}

async function requireOrganizer(req: FastifyRequest): Promise<OrganizerRow> {
  const user = await requireUser(req);
  const org = await getOrganizer(user);
  if (!org) throw forbidden("Please register as an organiser first.");
  return org;
}

/** Merges new bank details with the stored ones: a masked/blank account number keeps the stored number. */
function mergeBank(input: z.infer<typeof bankInput> | undefined, existing: OrganizerRow["bank_details"]) {
  if (!input) return existing;
  let number = input.account_number.replace(/\s+/g, "");
  if (!number || /^[X*•]+\d{0,4}$/i.test(number)) {
    if (!existing) throw badRequest("Enter the bank account number.");
    number = existing.account_number;
  } else if (!/^\d{9,18}$/.test(number)) throw badRequest("Enter a valid bank account number (9–18 digits).");
  return { account_holder: input.account_holder, account_number: number, ifsc: input.ifsc, bank_name: input.bank_name };
}

async function uniqueSlug(table: "organizers" | "events", base: string, db: Queryable): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await one(`SELECT 1 FROM ${table} WHERE slug = $1`, [slug], db))) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

const priceText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Lowest paid tier as a card label ("499" or "499 onwards" when there are several paid tiers). */
function priceLabel(tiers: { price: number }[]): string | null {
  const paid = tiers.map((t) => t.price).filter((p) => p > 0);
  if (!paid.length) return null;
  return `${priceText(Math.min(...paid))}${paid.length > 1 ? " onwards" : ""}`;
}

async function ownedEvent(id: number, org: OrganizerRow) {
  if (!Number.isInteger(id) || id <= 0) throw notFound("Event not found.");
  const ev = await one<any>(`SELECT * FROM events WHERE id = $1 AND organizer_id = $2 AND source = 'organizer'`, [id, org.id]);
  // Other organisers' events look exactly like missing ones.
  if (!ev) throw notFound("Event not found.");
  return ev;
}

const idParam = (req: FastifyRequest) => Number((req.params as any).id);

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function formatAnswers(answers: unknown): string {
  if (!Array.isArray(answers)) return "";
  return answers.map((a: any) => {
    if (a && typeof a === "object") {
      const label = a.label ?? a.question ?? a.q;
      const value = a.answer ?? a.value ?? a.a;
      return label !== undefined ? `${label}: ${value ?? ""}` : JSON.stringify(a);
    }
    return String(a);
  }).join(" | ");
}

// ─── Routes ───────────────────────────────────────────────────
export default async function organizerRoutes(app: FastifyInstance) {
  // — Profile ————————————————————————————————————————————————
  app.get("/organizer/me", async (req) => {
    const user = await requireUser(req);
    const org = await getOrganizer(user);
    return { organizer: org ? publicOrganizer(org) : null };
  });

  app.post("/organizer/register", async (req) => {
    const user = await requireUser(req);
    const b = profileInput.parse(req.body);
    if (await getOrganizer(user)) throw conflict("You are already registered as an organiser.");
    const bank = mergeBank(b.bank, null);
    try {
      const org = await tx(async (db) => {
        const slug = await uniqueSlug("organizers", b.name, db);
        return one<OrganizerRow>(
          `INSERT INTO organizers (name, slug, contact, about, email, gstin, state, bank_details, user_id, is_community, approval_status, ticketing_enabled, commission_rate, absorption_mode)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,'approved',TRUE,15,'organiser') RETURNING ${ORG_COLS}`,
          [b.name, slug, b.contact, b.about ?? null, b.email, b.gstin ?? null, b.state, bank ? JSON.stringify(bank) : null, user.id], db);
      });
      return { success: true, organizer: publicOrganizer(org!) };
    } catch (e: any) {
      if (e?.code === "23505") throw conflict("You are already registered as an organiser.");
      throw e;
    }
  });

  app.put("/organizer/me", async (req) => {
    const org = await requireOrganizer(req);
    const b = profileInput.parse(req.body);
    const bank = mergeBank(b.bank, org.bank_details);
    // commission_rate, absorption_mode, approval_status and ticketing_enabled are admin-only and never touched here.
    const updated = await one<OrganizerRow>(
      `UPDATE organizers SET name = $2, contact = $3, about = $4, email = $5, gstin = $6, state = $7, bank_details = $8, updated_at = now()
       WHERE id = $1 RETURNING ${ORG_COLS}`,
      [org.id, b.name, b.contact, b.about ?? null, b.email, b.gstin ?? null, b.state, bank ? JSON.stringify(bank) : null]);
    return { success: true, organizer: publicOrganizer(updated!) };
  });

  // — Dashboard ——————————————————————————————————————————————
  app.get("/organizer/dashboard", async (req) => {
    const org = await requireOrganizer(req);
    const events = await q(
      `SELECT e.id, e.title, e.slug, e.event_date, e.event_time, e.status, e.approval_status, e.rejection_reason, e.has_ticketing, e.listing_fee_status, e.image_path,
              COALESCE(s.sold, 0) AS sold, COALESCE(s.gross, 0) AS gross
         FROM events e
         LEFT JOIN (SELECT b.event_id, SUM(b.quantity) AS sold, SUM(b.subtotal - b.discount) AS gross
                      FROM bookings b WHERE b.status = 'confirmed' GROUP BY b.event_id) s ON s.event_id = e.id
        WHERE e.organizer_id = $1 AND e.source = 'organizer'
        ORDER BY e.event_date DESC, e.id DESC`, [org.id]);
    const totals = await one<{ tickets_sold: number; gross_sales: number; net_payout: number }>(
      `SELECT COALESCE(SUM(b.quantity),0) AS tickets_sold, COALESCE(SUM(b.subtotal - b.discount),0) AS gross_sales, COALESCE(SUM(b.organizer_payout),0) AS net_payout
         FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.organizer_id = $1 AND b.status = 'confirmed'`, [org.id]);
    const settled = (await one<{ s: number }>(`SELECT COALESCE(SUM(amount),0) AS s FROM settlements WHERE organizer_id = $1`, [org.id]))!.s;
    return {
      organizer: { id: org.id, name: org.name, approval_status: org.approval_status, ticketing_enabled: org.ticketing_enabled },
      totals: {
        events: events.length, tickets_sold: totals!.tickets_sold, gross_sales: totals!.gross_sales,
        net_payout: totals!.net_payout, settled, outstanding: Math.round((totals!.net_payout - settled) * 100) / 100,
      },
      events,
    };
  });

  app.get("/organizer/form-options", async (req) => {
    await requireOrganizer(req);
    const [categories, venues] = await Promise.all([
      q(`SELECT id, name, slug, icon FROM categories WHERE is_active AND NOT is_system ORDER BY sort_order, name`),
      q(`SELECT id, name, area FROM venues WHERE is_active ORDER BY name`),
    ]);
    return { categories, venues };
  });

  // — Events ————————————————————————————————————————————————
  /** Shared by create and update: reads the multipart body into validated pieces. */
  async function readEventBody(req: FastifyRequest) {
    if (!req.isMultipart()) throw badRequest("Please submit the event form.");
    const { fields, files } = await readMultipart(req);
    const cats = fields.category_id === undefined ? [] : Array.isArray(fields.category_id) ? fields.category_id : [fields.category_id];
    const input = eventInput.parse({ ...fields, category_id: cats.filter((c: string) => c !== "") });
    let tiers: z.infer<typeof tiersInput> = [], questions: z.infer<typeof questionsInput> = [], coupons: z.infer<typeof couponsInput> = [];
    if (input.listing_type === "ticketing") {
      tiers = tiersInput.parse(parseJson(fields.tiers, "ticket tiers"));
      questions = questionsInput.parse(parseJson(fields.questions, "questions")).filter((x) => x.label);
      coupons = couponsInput.parse(parseJson(fields.coupons, "promo codes"));
    }
    return { input, tiers, questions, coupons, image: files.image };
  }

  async function resolveVenue(input: z.infer<typeof eventInput>, db: Queryable): Promise<number> {
    if (input.venue_id) {
      if (!(await one(`SELECT 1 FROM venues WHERE id = $1 AND is_active`, [input.venue_id], db))) throw badRequest("That venue does not exist.");
      return input.venue_id;
    }
    const v = await one<{ id: number }>(`INSERT INTO venues (name, slug, area, address, maps_url) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.venue_name, await uniqueVenueSlug(input.venue_name ?? "", db), input.venue_area ?? null, input.venue_address ?? null, input.venue_maps_url ?? null], db);
    return v!.id;
  }

  async function checkCategories(ids: number[], db: Queryable) {
    const uniq = [...new Set(ids)];
    const found = await q<{ id: number }>(`SELECT id FROM categories WHERE id = ANY($1::int[]) AND is_active AND NOT is_system`, [uniq], db);
    if (found.length !== uniq.length) throw badRequest("One of the selected categories is not valid.");
    return uniq;
  }

  const setCategories = async (eventId: number, ids: number[], db: Queryable) => {
    await q(`DELETE FROM event_categories WHERE event_id = $1`, [eventId], db);
    for (const [i, id] of ids.entries()) await q(`INSERT INTO event_categories (event_id, category_id, position) VALUES ($1,$2,$3)`, [eventId, id, i], db);
  };

  const insertQuestions = async (eventId: number, list: { label: string; is_required: boolean }[], db: Queryable) => {
    await q(`DELETE FROM event_questions WHERE event_id = $1`, [eventId], db);
    for (const [i, x] of list.entries()) await q(`INSERT INTO event_questions (event_id, label, is_required, sort_order) VALUES ($1,$2,$3,$4)`, [eventId, x.label, x.is_required, i], db);
  };

  /** Promo codes are matched by code so `uses` survives an edit. */
  const syncCoupons = async (eventId: number, list: z.infer<typeof couponsInput>, db: Queryable) => {
    const existing = await q<{ id: number; code: string }>(`SELECT id, code FROM coupons WHERE event_id = $1`, [eventId], db);
    const keep = new Set(list.map((c) => c.code));
    for (const e of existing) if (!keep.has(e.code.toUpperCase())) await q(`DELETE FROM coupons WHERE id = $1`, [e.id], db);
    for (const c of list) {
      const hit = existing.find((e) => e.code.toUpperCase() === c.code);
      if (hit) await q(`UPDATE coupons SET discount_type=$2, discount_value=$3, max_uses=$4, valid_until=$5, is_active=TRUE WHERE id=$1`, [hit.id, c.discount_type, c.discount_value, c.max_uses ?? null, c.valid_until ?? null], db);
      else await q(`INSERT INTO coupons (event_id, code, discount_type, discount_value, max_uses, valid_until) VALUES ($1,$2,$3,$4,$5,$6)`, [eventId, c.code, c.discount_type, c.discount_value, c.max_uses ?? null, c.valid_until ?? null], db);
    }
  };

  app.post("/organizer/events", async (req) => {
    const org = await requireOrganizer(req);
    const { input, tiers, questions, coupons, image } = await readEventBody(req);
    const saved = image ? await saveImage(image, "event") : null;
    try {
      const id = await tx(async (db) => {
        const cats = await checkCategories(input.category_id, db);
        const venueId = await resolveVenue(input, db);
        const ticketing = input.listing_type === "ticketing";
        const slug = await uniqueSlug("events", input.title, db);
        // Free listing: free unless the organiser supplied an external ticket link. Ticketing: free only if every tier is ₹0.
        const isFree = ticketing ? tiers.every((t) => t.price === 0) : !input.ticket_url;
        // listing_fee_status stays 'free': the legacy listing-fee amount is unknown, so nothing is charged here.
        const ev = await one<{ id: number }>(
          `INSERT INTO events (title, slug, short_description, description, event_date, event_time, end_date, end_time, organizer_id, venue_id, image_path, thumb_path,
                               is_free, ticket_url, ticket_price, status, source, has_ticketing, approval_status, listing_fee_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft','organizer',$16,'pending','free') RETURNING id`,
          [input.title, slug, input.short_description ?? null, cleanHtml(input.description), input.event_date, input.event_time ?? null, input.end_date ?? null, input.end_time ?? null,
            org.id, venueId, saved?.path ?? null, saved?.thumb ?? null, isFree, ticketing ? null : input.ticket_url ?? null, ticketing ? priceLabel(tiers) : null, ticketing], db);
        await setCategories(ev!.id, cats, db);
        for (const [i, t] of tiers.entries()) await q(`INSERT INTO ticket_tiers (event_id, name, price, capacity, sort_order) VALUES ($1,$2,$3,$4,$5)`, [ev!.id, t.name, t.price, t.capacity ?? null, i], db);
        await insertQuestions(ev!.id, questions, db);
        await syncCoupons(ev!.id, coupons, db);
        return ev!.id;
      });
      return { success: true, id };
    } catch (e) {
      if (saved) { await removeImage(saved.path); await removeImage(saved.thumb); }
      throw e;
    }
  });

  app.get("/organizer/events/:id", async (req) => {
    const org = await requireOrganizer(req);
    const ev = await ownedEvent(idParam(req), org);
    const [tiers, questions, coupons, cats, venue] = await Promise.all([
      q(`SELECT id, name, price, capacity, sold FROM ticket_tiers WHERE event_id = $1 ORDER BY sort_order, id`, [ev.id]),
      q(`SELECT id, label, is_required FROM event_questions WHERE event_id = $1 ORDER BY sort_order, id`, [ev.id]),
      q(`SELECT id, code, discount_type, discount_value, max_uses, uses, valid_until FROM coupons WHERE event_id = $1 ORDER BY id`, [ev.id]),
      q<{ category_id: number }>(`SELECT category_id FROM event_categories WHERE event_id = $1 ORDER BY position`, [ev.id]),
      ev.venue_id ? one(`SELECT id, name, area, address, maps_url FROM venues WHERE id = $1`, [ev.venue_id]) : null,
    ]);
    return {
      event: {
        id: ev.id, title: ev.title, slug: ev.slug, short_description: ev.short_description, description: ev.description,
        event_date: ev.event_date, event_time: ev.event_time, end_date: ev.end_date, end_time: ev.end_time, image_path: ev.image_path,
        venue_id: ev.venue_id, venue, ticket_url: ev.ticket_url, listing_type: ev.has_ticketing ? "ticketing" : "free_listing",
        status: ev.status, approval_status: ev.approval_status, rejection_reason: ev.rejection_reason, listing_fee_status: ev.listing_fee_status,
        category_ids: cats.map((c) => c.category_id), tiers, questions, coupons,
      },
    };
  });

  app.put("/organizer/events/:id", async (req) => {
    const org = await requireOrganizer(req);
    const ev = await ownedEvent(idParam(req), org);
    const { input, tiers, questions, coupons, image } = await readEventBody(req);
    const saved = image ? await saveImage(image, "event") : null;
    try {
      await tx(async (db) => {
        const cats = await checkCategories(input.category_id, db);
        const venueId = await resolveVenue(input, db);
        const ticketing = input.listing_type === "ticketing";
        const existing = await q<{ id: number; name: string; price: number; sold: number }>(
          `SELECT t.id, t.name, t.price, t.sold FROM ticket_tiers t WHERE t.event_id = $1 FOR UPDATE`, [ev.id], db);
        const booked = new Set((await q<{ tier_id: number }>(`SELECT DISTINCT tier_id FROM bookings WHERE event_id = $1`, [ev.id], db)).map((r) => r.tier_id));
        const hasSales = (t: { id: number; sold: number }) => t.sold > 0 || booked.has(t.id);

        if (!ticketing) {
          if (existing.some(hasSales)) throw badRequest("This event already has ticket sales, so it cannot be switched to a free listing.");
          await q(`DELETE FROM ticket_tiers WHERE event_id = $1`, [ev.id], db);
        } else {
          const keepIds = new Set(tiers.filter((t) => t.id).map((t) => t.id));
          for (const t of tiers) if (t.id && !existing.some((e) => e.id === t.id)) throw badRequest("A ticket tier in the form does not belong to this event.");
          for (const e of existing) {
            if (!keepIds.has(e.id)) {
              if (hasSales(e)) throw badRequest(`The "${e.name}" tier has sales and cannot be removed.`);
              await q(`DELETE FROM ticket_tiers WHERE id = $1`, [e.id], db);
            }
          }
          for (const [i, t] of tiers.entries()) {
            const cur = t.id ? existing.find((e) => e.id === t.id)! : null;
            if (cur) {
              if (hasSales(cur) && Number(cur.price) !== t.price) throw badRequest(`The price of the "${cur.name}" tier cannot be changed because tickets have been sold.`);
              if (t.capacity !== undefined && t.capacity < cur.sold) throw badRequest(`The capacity of "${cur.name}" cannot be lower than the ${cur.sold} tickets already sold.`);
              await q(`UPDATE ticket_tiers SET name=$2, price=$3, capacity=$4, sort_order=$5 WHERE id=$1`, [cur.id, t.name, t.price, t.capacity ?? null, i], db);
            } else {
              await q(`INSERT INTO ticket_tiers (event_id, name, price, capacity, sort_order) VALUES ($1,$2,$3,$4,$5)`, [ev.id, t.name, t.price, t.capacity ?? null, i], db);
            }
          }
        }
        await insertQuestions(ev.id, ticketing ? questions : [], db);
        await syncCoupons(ev.id, ticketing ? coupons : [], db);
        await setCategories(ev.id, cats, db);

        const isFree = ticketing ? tiers.every((t) => t.price === 0) : !input.ticket_url;
        // Approved events stay approved after an edit. A rejected event goes back to the moderation queue (re-submission).
        const approval = ev.approval_status === "rejected" ? "pending" : ev.approval_status;
        await q(
          `UPDATE events SET title=$2, short_description=$3, description=$4, event_date=$5, event_time=$6, end_date=$7, end_time=$8, venue_id=$9,
                  image_path=COALESCE($10, image_path), thumb_path=COALESCE($11, thumb_path), is_free=$12, ticket_url=$13, ticket_price=$14,
                  has_ticketing=$15, approval_status=$16, rejection_reason = CASE WHEN $16 = 'pending' THEN NULL ELSE rejection_reason END, updated_at=now()
            WHERE id = $1`,
          [ev.id, input.title, input.short_description ?? null, cleanHtml(input.description), input.event_date, input.event_time ?? null, input.end_date ?? null, input.end_time ?? null,
            venueId, saved?.path ?? null, saved?.thumb ?? null, isFree, ticketing ? null : input.ticket_url ?? null, ticketing ? priceLabel(tiers) : null, ticketing, approval], db);
      });
    } catch (e) {
      if (saved) { await removeImage(saved.path); await removeImage(saved.thumb); }
      throw e;
    }
    if (saved) { await removeImage(ev.image_path); await removeImage(ev.thumb_path); }
    return { success: true, id: ev.id };
  });

  app.delete("/organizer/events/:id", async (req) => {
    const org = await requireOrganizer(req);
    const ev = await ownedEvent(idParam(req), org);
    if (await one(`SELECT 1 FROM bookings WHERE event_id = $1 LIMIT 1`, [ev.id])) throw badRequest("This event has bookings and cannot be deleted.");
    await q(`DELETE FROM events WHERE id = $1`, [ev.id]);
    await removeImage(ev.image_path); await removeImage(ev.thumb_path);
    return { success: true };
  });

  // — Guest list ————————————————————————————————————————————
  async function loadBookings(eventId: number) {
    return q(
      `SELECT b.id, b.reference, b.attendee_name, b.attendee_email, b.attendee_phone, t.name AS tier, b.quantity, b.total, b.answers, b.confirmed_at,
              COALESCE((SELECT json_agg(json_build_object('code', k.code, 'checked_in_at', k.checked_in_at) ORDER BY k.id) FROM tickets k WHERE k.booking_id = b.id), '[]'::json) AS tickets
         FROM bookings b JOIN ticket_tiers t ON t.id = b.tier_id
        WHERE b.event_id = $1 AND b.status = 'confirmed' ORDER BY b.confirmed_at DESC NULLS LAST, b.id DESC`, [eventId]);
  }

  app.get("/organizer/events/:id/bookings", async (req) => {
    const org = await requireOrganizer(req);
    const ev = await ownedEvent(idParam(req), org);
    const bookings = await loadBookings(ev.id);
    return { event: { id: ev.id, title: ev.title, slug: ev.slug, event_date: ev.event_date }, bookings };
  });

  app.get("/organizer/events/:id/bookings.csv", async (req, reply) => {
    const org = await requireOrganizer(req);
    const ev = await ownedEvent(idParam(req), org);
    const rows = await loadBookings(ev.id) as any[];
    const header = ["Booking reference", "Attendee name", "Email", "Phone", "Ticket tier", "Quantity", "Total paid (INR)", "Booked at", "Answers", "Tickets", "Checked in"];
    const lines = [header.map(csvCell).join(",")];
    for (const b of rows) {
      const tickets = b.tickets as { code: string; checked_in_at: string | null }[];
      lines.push([
        b.reference, b.attendee_name, b.attendee_email, b.attendee_phone, b.tier, b.quantity, b.total,
        b.confirmed_at ? new Date(b.confirmed_at).toISOString() : "", formatAnswers(b.answers),
        tickets.map((t) => t.code).join(" "), `${tickets.filter((t) => t.checked_in_at).length}/${tickets.length}`,
      ].map(csvCell).join(","));
    }
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="guestlist-${ev.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 60) || ev.id}.csv"`);
    return "﻿" + lines.join("\r\n") + "\r\n";
  });

  // — Door check-in ————————————————————————————————————————
  // Always HTTP 200 so the scanner UI can render ok / duplicate / invalid as states rather than errors.
  app.post("/organizer/checkin", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const org = await requireOrganizer(req);
    const { code: raw } = z.object({ code: z.string().trim().min(1).max(300) }).parse(req.body);
    // QR passes may encode a URL; the ticket code is its last path segment.
    const code = raw.includes("/") ? raw.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop()! : raw;
    const find = (c: string) => one<{ id: number; checked_in_at: string | null; attendee_name: string; tier: string; event_title: string }>(
      `SELECT k.id, k.checked_in_at, b.attendee_name, t.name AS tier, e.title AS event_title
         FROM tickets k JOIN bookings b ON b.id = k.booking_id JOIN events e ON e.id = b.event_id JOIN ticket_tiers t ON t.id = b.tier_id
        WHERE k.code = $1 AND e.organizer_id = $2 AND b.status = 'confirmed'`, [c, org.id]);
    const t = await find(code);
    if (!t) return { result: "invalid" };
    // Atomic: two phones scanning the same code at once cannot both succeed.
    const won = await one<{ checked_in_at: string }>(`UPDATE tickets SET checked_in_at = now() WHERE id = $1 AND checked_in_at IS NULL RETURNING checked_in_at`, [t.id]);
    if (!won) {
      const again = await find(code);
      return { result: "duplicate", checked_in_at: again?.checked_in_at ?? t.checked_in_at, attendee_name: t.attendee_name, tier: t.tier, event_title: t.event_title };
    }
    return { result: "ok", attendee_name: t.attendee_name, tier: t.tier, event_title: t.event_title, checked_in_at: won.checked_in_at };
  });

  // — Payouts ———————————————————————————————————————————————
  app.get("/organizer/settlements", async (req) => {
    const org = await requireOrganizer(req);
    const settlements = await q(`SELECT id, amount, payment_mode, summary, created_at FROM settlements WHERE organizer_id = $1 ORDER BY created_at DESC, id DESC`, [org.id]);
    const net = (await one<{ n: number }>(
      `SELECT COALESCE(SUM(b.organizer_payout),0) AS n FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.organizer_id = $1 AND b.status = 'confirmed'`, [org.id]))!.n;
    const settled = settlements.reduce((s, r: any) => s + Number(r.amount), 0);
    return { balance: { net_payout: net, settled, outstanding: Math.round((net - settled) * 100) / 100 }, settlements };
  });
}
