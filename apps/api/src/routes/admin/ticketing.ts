/** Ticketing back-office: organisers, moderation queue, sales, payout settlements and listing promo codes. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../../db.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { getSetting, setSetting } from "./settings.js";

const id = z.object({ id: z.coerce.number().int().positive() });
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const bool = z.preprocess((v) => v === true || v === "true" || v === "1" || v === "on", z.boolean());

/** Stub: the organiser is told why their event was rejected. Real e-mail delivery is not implemented yet. */
function notifyOrganizerRejected(organizerEmail: string | null, eventTitle: string, reason: string) {
  console.log(`[notifyOrganizerRejected] (stub, no e-mail sent) to=${organizerEmail ?? "n/a"} event="${eventTitle}" reason="${reason}"`);
}

/** Earned (confirmed organiser_payout) vs settled per organiser. */
const BALANCES_SQL = `
  WITH earned AS (
    SELECT e.organizer_id, COALESCE(sum(b.quantity),0)::int AS tickets, COALESCE(sum(b.subtotal - b.discount),0) AS gross,
           COALESCE(sum(b.commission),0) AS commission, COALESCE(sum(b.organizer_payout),0) AS net_due
      FROM bookings b JOIN events e ON e.id = b.event_id WHERE b.status = 'confirmed' AND e.organizer_id IS NOT NULL GROUP BY e.organizer_id),
  settled AS (SELECT organizer_id, sum(amount) AS amount FROM settlements GROUP BY organizer_id)
  SELECT o.id AS organizer_id, o.name, o.email, o.commission_rate,
         COALESCE(earned.tickets,0) AS tickets_sold, COALESCE(earned.gross,0) AS gross_sales, COALESCE(earned.commission,0) AS platform_commission,
         COALESCE(earned.net_due,0) AS net_payout_due, COALESCE(settled.amount,0) AS settled_amount,
         COALESCE(earned.net_due,0) - COALESCE(settled.amount,0) AS outstanding
    FROM organizers o LEFT JOIN earned ON earned.organizer_id = o.id LEFT JOIN settled ON settled.organizer_id = o.id
   WHERE o.user_id IS NOT NULL OR o.ticketing_enabled OR earned.organizer_id IS NOT NULL OR settled.organizer_id IS NOT NULL
   ORDER BY o.name`;

export default async function ticketingRoutes(app: FastifyInstance) {
  // ── Organisers ──
  app.get("/ticketing/organizers", async () => ({
    organizers: await q(
      `SELECT id, name, email, contact, gstin, state, commission_rate, absorption_mode, ticketing_enabled, approval_status, created_at
         FROM organizers WHERE user_id IS NOT NULL OR ticketing_enabled ORDER BY id DESC`),
  }));

  app.put("/ticketing/organizers/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    const b = z.object({
      commission_rate: z.coerce.number().min(0, "Commission must be between 0 and 100.").max(100, "Commission must be between 0 and 100."),
      absorption_mode: z.enum(["organiser", "customer", "split"]),
      ticketing_enabled: bool,
      approval_status: z.enum(["pending", "approved", "rejected"]),
      gstin: z.preprocess(blank, z.string().trim().max(20).optional()),
      state: z.preprocess(blank, z.string().trim().max(60).optional()),
    }).parse(req.body);
    const row = await one(
      `UPDATE organizers SET commission_rate=$1, absorption_mode=$2, ticketing_enabled=$3, approval_status=$4, gstin=$5, state=$6, updated_at=now()
        WHERE id=$7 RETURNING id`, [b.commission_rate, b.absorption_mode, b.ticketing_enabled, b.approval_status, b.gstin ?? null, b.state ?? null, i]);
    if (!row) throw notFound("Organiser not found.");
    return { success: true };
  });

  // ── Moderation queue ──
  app.get("/ticketing/events", async () => ({
    events: await q(
      `SELECT e.id, e.title, e.slug, e.event_date, e.created_at, e.has_ticketing, e.listing_fee_status, e.listing_payment_ref, e.approval_status, e.rejection_reason, e.status,
              o.id AS organizer_id, o.name AS organizer_name, o.email AS organizer_email
         FROM events e LEFT JOIN organizers o ON o.id = e.organizer_id
        WHERE e.source = 'organizer' ORDER BY e.created_at DESC, e.id DESC`),
  }));

  app.post("/ticketing/events/:id/approve", async (req) => {
    const { id: i } = id.parse(req.params);
    const row = await one(
      `UPDATE events SET approval_status='approved', status='published', rejection_reason=NULL, updated_at=now() WHERE id=$1 AND source='organizer' RETURNING id`, [i]);
    if (!row) throw notFound("Event not found.");
    return { success: true };
  });

  app.post("/ticketing/events/:id/reject", async (req) => {
    const { id: i } = id.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(1, "A rejection reason is required.").max(1000) }).parse(req.body);
    const ev = await one<{ title: string; listing_fee_status: string; organizer_email: string | null }>(
      `SELECT e.title, e.listing_fee_status, o.email AS organizer_email FROM events e LEFT JOIN organizers o ON o.id = e.organizer_id WHERE e.id=$1 AND e.source='organizer'`, [i]);
    if (!ev) throw notFound("Event not found.");
    const refund = ev.listing_fee_status === "paid";
    // TODO(razorpay): when refund is true, issue the actual refund via Razorpay's refund API for listing_payment_ref. Only the status is changed here.
    await q(
      `UPDATE events SET approval_status='rejected', rejection_reason=$1, status='draft',
              listing_fee_status = CASE WHEN listing_fee_status='paid' THEN 'refunded' ELSE listing_fee_status END, updated_at=now() WHERE id=$2`, [reason, i]);
    notifyOrganizerRejected(ev.organizer_email, ev.title, reason);
    return { success: true, refunded: refund };
  });

  // ── Sales ──
  app.get("/ticketing/sales", async () => {
    const totals = await one(
      `SELECT COALESCE(sum(quantity),0)::int AS tickets_sold, COALESCE(sum(subtotal - discount),0) AS gross_sales, COALESCE(sum(commission),0) AS commission,
              COALESCE(sum(gst),0) AS gst, COALESCE(sum(organizer_payout),0) AS organizer_payouts FROM bookings WHERE status='confirmed'`);
    const by_event = await q(
      `SELECT e.id, e.title, e.event_date, o.name AS organizer_name, COALESCE(sum(b.quantity),0)::int AS tickets_sold, COALESCE(sum(b.subtotal - b.discount),0) AS gross_sales,
              COALESCE(sum(b.commission),0) AS commission, COALESCE(sum(b.organizer_payout),0) AS net_payout
         FROM bookings b JOIN events e ON e.id = b.event_id LEFT JOIN organizers o ON o.id = e.organizer_id
        WHERE b.status='confirmed' GROUP BY e.id, o.name ORDER BY gross_sales DESC, e.title`);
    const by_organizer = await q(BALANCES_SQL);
    return { totals, by_event, by_organizer };
  });

  // ── Settlements ──
  app.get("/ticketing/settlements", async () => ({
    balances: (await q<any>(BALANCES_SQL)).map((r) => ({ organizer_id: r.organizer_id, name: r.name, total_earned: r.net_payout_due, total_settled: r.settled_amount, outstanding: r.outstanding })),
    ledger: await q(
      `SELECT s.id, s.organizer_id, o.name AS organizer_name, s.amount, s.payment_mode, s.summary, s.created_at, a.username AS created_by_name
         FROM settlements s JOIN organizers o ON o.id = s.organizer_id LEFT JOIN admins a ON a.id = s.created_by ORDER BY s.created_at DESC, s.id DESC`),
  }));

  app.post("/ticketing/settlements", async (req) => {
    const b = z.object({
      organizer_id: z.coerce.number().int().positive("Choose an organiser."),
      amount: z.coerce.number().min(0.01, "Amount must be at least ₹0.01."),
      payment_mode: z.enum(["UPI", "Bank Transfer", "NetBanking", "Cash"]),
      summary: z.string().trim().min(1, "A transfer summary is required.").max(500),
    }).parse(req.body);
    if (!(await one(`SELECT 1 FROM organizers WHERE id=$1`, [b.organizer_id]))) throw badRequest("Organiser not found.");
    const row = await one(
      `INSERT INTO settlements (organizer_id, amount, payment_mode, summary, created_by) VALUES ($1, round($2::numeric,2), $3, $4, $5) RETURNING id`,
      [b.organizer_id, b.amount, b.payment_mode, b.summary, (req as any).admin?.id ?? null]);
    return { success: true, id: row!.id };
  });

  // ── Listing promo codes ──
  app.get("/ticketing/promos", async () => ({
    enabled: (await getSetting("listing_promo_enabled")) === "1",
    promos: await q(`SELECT id, code, discount_type, discount_value, max_uses, uses, valid_until, is_active, created_at FROM listing_promos ORDER BY id DESC`),
  }));

  app.post("/ticketing/promos", async (req) => {
    const b = z.object({
      code: z.string().trim().min(1, "Promo code is required.").max(40).regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, dashes and underscores."),
      discount_type: z.enum(["percent", "fixed"]),
      discount_value: z.coerce.number().positive("Discount value must be greater than 0."),
      max_uses: z.preprocess(blank, z.coerce.number().int().min(1).optional()),
      valid_until: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry must be YYYY-MM-DD.").optional()),
      is_active: bool.default(true),
    }).parse(req.body);
    if (b.discount_type === "percent" && b.discount_value > 100) throw badRequest("A percentage discount cannot exceed 100.");
    if (await one(`SELECT 1 FROM listing_promos WHERE code = $1`, [b.code])) throw badRequest("A promo code with that name already exists.");
    const row = await one(
      `INSERT INTO listing_promos (code, discount_type, discount_value, max_uses, valid_until, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.code.toUpperCase(), b.discount_type, b.discount_value, b.max_uses ?? null, b.valid_until ?? null, b.is_active]);
    return { success: true, id: row!.id };
  });

  app.put("/ticketing/promos-enabled", async (req) => {
    const { enabled } = z.object({ enabled: bool }).parse(req.body);
    await setSetting("listing_promo_enabled", enabled ? "1" : "0");
    return { success: true, enabled };
  });

  app.put("/ticketing/promos/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    const { is_active } = z.object({ is_active: bool }).parse(req.body);
    if (!(await one(`UPDATE listing_promos SET is_active=$1 WHERE id=$2 RETURNING id`, [is_active, i]))) throw notFound("Promo code not found.");
    return { success: true };
  });

  app.delete("/ticketing/promos/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    if (!(await one(`DELETE FROM listing_promos WHERE id=$1 RETURNING id`, [i]))) throw notFound("Promo code not found.");
    return { success: true };
  });
}
