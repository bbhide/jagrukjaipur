import type { FastifyInstance } from "fastify";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { one, pool, q, tx, type Queryable } from "../db.js";
import { todayIST } from "../lib/dates.js";
import { HttpError, badRequest, conflict, notFound } from "../lib/errors.js";
import { requireUser } from "../lib/session.js";
import { normaliseMobile } from "../lib/text.js";
import { computeBill, couponDiscount, toPaise, type AbsorptionMode } from "../services/billing.js";

// ─── Delivery hooks (TODO) ────────────────────────────────────────────────
// Passes (PDF + QR) are meant to go out over WhatsApp and e-mail once a booking is confirmed.
// The delivery channel is not implemented yet; these stubs only log so the call sites are in place.
export async function sendPassViaWhatsApp(bookingId: number): Promise<void> {
  console.log(`[TODO] sendPassViaWhatsApp: deliver ticket pass for booking #${bookingId}`);
}
export async function sendPassViaEmail(bookingId: number): Promise<void> {
  console.log(`[TODO] sendPassViaEmail: deliver ticket pass for booking #${bookingId}`);
}
async function notifyConfirmed(bookingId: number) {
  try { await Promise.all([sendPassViaWhatsApp(bookingId), sendPassViaEmail(bookingId)]); }
  catch (err) { console.error("pass delivery hook failed", err); }
}

// ─── Schemas ──────────────────────────────────────────────────────────────
const couponBody = z.object({
  event_id: z.coerce.number().int().positive(),
  coupon_code: z.string().trim().min(1, "Enter a coupon code.").max(40),
  subtotal: z.coerce.number().min(0).max(10_000_000),
});

const bookingBody = z.object({
  event_id: z.coerce.number().int().positive(),
  tier_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1, "Choose at least 1 ticket.").max(10, "You can book up to 10 tickets at a time."),
  attendee_name: z.string().trim().min(2, "Please enter the attendee's name.").max(120),
  attendee_email: z.email("Please enter a valid email address.").max(160),
  attendee_phone: z.string().trim().min(1, "Please enter a WhatsApp number.").max(20),
  answers: z.array(z.object({ question_id: z.coerce.number().int().positive(), answer: z.string().trim().max(500) })).max(3).default([]),
  coupon_code: z.string().trim().max(40).optional(),
});

const verifyBody = z.object({
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

// ─── Helpers ──────────────────────────────────────────────────────────────
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function newReference(): string {
  const bytes = randomBytes(10);
  return "JJ" + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}
const newTicketCode = () => randomBytes(18).toString("base64url");

interface RazorpayKeys { keyId: string; keySecret: string }
async function razorpayKeys(db: Queryable): Promise<RazorpayKeys | null> {
  const rows = await q<{ key: string; value: string | null }>(`SELECT key, value FROM settings WHERE key IN ('razorpay_key_id','razorpay_key_secret')`, [], db);
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value?.trim() ?? ""]));
  const keyId = s.razorpay_key_id || config.RAZORPAY_KEY_ID || "";
  const keySecret = s.razorpay_key_secret || config.RAZORPAY_KEY_SECRET || "";
  return keyId && keySecret ? { keyId, keySecret } : null;
}

interface CouponRow { id: number; code: string; discount_type: "percent" | "fixed"; discount_value: number; max_uses: number | null; uses: number; valid_until: string | null; is_active: boolean }

/** Looks the coupon up and validates it. `lock` takes a row lock (used inside the booking transaction). */
async function evaluateCoupon(db: Queryable, eventId: number, code: string, subtotal: number, lock = false) {
  const coupon = await one<CouponRow>(`SELECT id, code, discount_type, discount_value, max_uses, uses, valid_until, is_active
                                       FROM coupons WHERE event_id = $1 AND code = $2 ${lock ? "FOR UPDATE" : ""}`, [eventId, code], db);
  if (!coupon) throw badRequest("Invalid coupon code.");
  if (!coupon.is_active) throw badRequest("This coupon is no longer active.");
  if (coupon.valid_until && coupon.valid_until < todayIST()) throw badRequest("This coupon has expired.");
  if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) throw badRequest("This coupon has reached its usage limit.");
  const discount = couponDiscount(coupon.discount_type, coupon.discount_value, subtotal);
  if (discount <= 0) throw badRequest("This coupon does not apply to this order.");
  return { coupon, discount };
}

/**
 * Confirms a booking exactly once: creates one ticket per seat, bumps tier.sold and coupon.uses.
 * Caller must hold the booking row lock (`SELECT … FOR UPDATE`). Returns false when it was already confirmed.
 */
async function confirmBooking(db: PoolClient, booking: { id: number; tier_id: number; quantity: number; coupon_id: number | null; status: string }, paymentId: string | null): Promise<boolean> {
  if (booking.status === "confirmed") return false;
  if (booking.status === "cancelled" || booking.status === "refunded") throw conflict("This booking can no longer be confirmed.");
  const existing = await one<{ n: number }>(`SELECT count(*) AS n FROM tickets WHERE booking_id = $1`, [booking.id], db);
  if (!existing || existing.n === 0) {
    for (let i = 0; i < booking.quantity; i++) await q(`INSERT INTO tickets (booking_id, code) VALUES ($1, $2)`, [booking.id, newTicketCode()], db);
  }
  await q(`UPDATE ticket_tiers SET sold = sold + $2 WHERE id = $1`, [booking.tier_id, booking.quantity], db);
  if (booking.coupon_id) await q(`UPDATE coupons SET uses = uses + 1 WHERE id = $1`, [booking.coupon_id], db);
  await q(`UPDATE bookings SET status = 'confirmed', confirmed_at = now(), razorpay_payment_id = COALESCE($2, razorpay_payment_id) WHERE id = $1`, [booking.id, paymentId], db);
  return true;
}

async function createRazorpayOrder(keys: RazorpayKeys, amountPaise: number, receipt: string, notes: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64") },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, "Could not reach the payment gateway. Please try again.", "gateway_unreachable");
  }
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.id) {
    console.error("Razorpay order creation failed", res.status, data?.error?.description);
    throw new HttpError(502, "The payment gateway rejected the order. Please try again.", "gateway_error");
  }
  return data.id as string;
}

const BOOKING_COLS = `b.id, b.reference, b.status, b.quantity, b.attendee_name, b.attendee_email, b.attendee_phone,
  b.subtotal, b.discount, b.customer_fee, b.total, b.created_at, b.confirmed_at,
  t.name AS tier_name, t.price AS tier_price`;
const EVENT_COLS = `e.id AS event_id, e.title AS event_title, e.slug AS event_slug, e.event_date, e.event_time, e.end_date, e.end_time,
  e.image_path, e.thumb_path, e.status AS event_status, v.name AS venue_name, v.area AS venue_area, v.address AS venue_address`;

export default async function bookingRoutes(app: FastifyInstance) {
  // ─── Coupon preview ─────────────────────────────────────────────────────
  app.post("/coupons/apply", { config: { rateLimit: { max: 30, timeWindow: "5 minutes" } } }, async (req) => {
    const b = couponBody.parse(req.body);
    const ev = await one<{ id: number }>(`SELECT id FROM events WHERE id = $1 AND status IN ('published','cancelled') AND approval_status = 'approved'`, [b.event_id]);
    if (!ev) throw badRequest("Invalid coupon code.");
    const { coupon, discount } = await evaluateCoupon(pool, b.event_id, b.coupon_code, b.subtotal);
    return { success: true, discount_amount: discount, code: coupon.code };
  });

  // ─── Create booking ─────────────────────────────────────────────────────
  app.post("/bookings", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req) => {
    const user = await requireUser(req);
    const b = bookingBody.parse(req.body);
    const phone = normaliseMobile(b.attendee_phone);
    if (!phone) throw badRequest("Please enter a valid 10-digit WhatsApp number.");

    const result = await tx(async (db) => {
      const ev = await one<any>(
        `SELECT e.id, e.title, e.status, e.approval_status, e.has_ticketing, e.event_date, e.end_date,
                o.id AS organizer_id, o.ticketing_enabled, o.commission_rate, o.absorption_mode
         FROM events e LEFT JOIN organizers o ON o.id = e.organizer_id WHERE e.id = $1`, [b.event_id], db);
      if (!ev || ev.status !== "published" || ev.approval_status !== "approved") throw notFound("This event is not available for booking.");
      if (!ev.has_ticketing || !ev.organizer_id || !ev.ticketing_enabled) throw badRequest("Tickets for this event are not sold through Jagruk Jaipur.");
      if ((ev.end_date ?? ev.event_date) < todayIST()) throw badRequest("This event has already taken place.");

      // The tier row lock serialises concurrent bookings for the same tier, so the capacity check below cannot be raced.
      const tier = await one<{ id: number; name: string; price: number; capacity: number | null; sold: number }>(
        `SELECT id, name, price, capacity, sold FROM ticket_tiers WHERE id = $1 AND event_id = $2 FOR UPDATE`, [b.tier_id, ev.id], db);
      if (!tier) throw badRequest("Please choose a valid ticket option.");
      if (tier.capacity !== null) {
        // Seats held by unpaid bookings in the last 15 minutes count against capacity so a checkout in progress is not oversold.
        const held = await one<{ n: number }>(
          `SELECT COALESCE(sum(quantity), 0) AS n FROM bookings WHERE tier_id = $1 AND status = 'pending' AND created_at > now() - interval '15 minutes'`, [tier.id], db);
        const left = Math.max(0, tier.capacity - tier.sold - (held?.n ?? 0));
        if (b.quantity > left) throw conflict(left === 0 ? `"${tier.name}" is sold out.` : `Only ${left} ticket${left === 1 ? "" : "s"} left for "${tier.name}".`);
      }

      const questions = await q<{ id: number; label: string; is_required: boolean }>(`SELECT id, label, is_required FROM event_questions WHERE event_id = $1 ORDER BY sort_order, id`, [ev.id], db);
      const given = new Map(b.answers.map((a) => [a.question_id, a.answer]));
      const answers = questions.map((qn) => {
        const text = given.get(qn.id) ?? "";
        if (qn.is_required && !text) throw badRequest(`Please answer: ${qn.label}`);
        return { question_id: qn.id, label: qn.label, answer: text };
      }).filter((a) => a.answer);

      const price = Number(tier.price);
      const subtotal = price * b.quantity;
      let couponId: number | null = null;
      let discount = 0;
      if (b.coupon_code) {
        const c = await evaluateCoupon(db, ev.id, b.coupon_code, subtotal, true);
        couponId = c.coupon.id; discount = c.discount;
      }
      const bill = computeBill({ price, quantity: b.quantity, discount, commissionRate: Number(ev.commission_rate), absorptionMode: ev.absorption_mode as AbsorptionMode });
      const free = bill.total === 0;

      let keys: RazorpayKeys | null = null;
      if (!free) {
        keys = await razorpayKeys(db);
        if (!keys) throw new HttpError(503, "Online payments are not available right now.", "payments_unavailable");
      }

      let booking: { id: number; reference: string } | null = null;
      for (let attempt = 0; attempt < 5 && !booking; attempt++) {
        const ref = newReference();
        booking = await one(
          `INSERT INTO bookings (reference, event_id, user_id, tier_id, quantity, attendee_name, attendee_email, attendee_phone, answers, coupon_id,
                                 subtotal, discount, commission, gst, customer_fee, total, organizer_payout, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending')
           ON CONFLICT (reference) DO NOTHING RETURNING id, reference`,
          [ref, ev.id, user.id, tier.id, b.quantity, b.attendee_name, b.attendee_email, phone, JSON.stringify(answers), couponId,
           bill.subtotal, bill.discount, bill.commission, bill.gst, bill.customer_fee, bill.total, bill.organizer_payout], db);
      }
      if (!booking) throw new HttpError(500, "Could not create the booking. Please try again.");

      if (free) {
        await confirmBooking(db, { id: booking.id, tier_id: tier.id, quantity: b.quantity, coupon_id: couponId, status: "pending" }, null);
      }
      return { booking, bill, free, keys, eventTitle: ev.title as string, eventId: ev.id as number };
    });

    if (result.free) {
      void notifyConfirmed(result.booking.id);
      return { success: true, status: "confirmed", reference: result.booking.reference };
    }

    // Paid: the order is created outside the DB transaction (no row locks held during a network call).
    try {
      const orderId = await createRazorpayOrder(result.keys!, toPaise(result.bill.total), result.booking.reference,
        { booking_reference: result.booking.reference, event_id: String(result.eventId) });
      await q(`UPDATE bookings SET razorpay_order_id = $2 WHERE id = $1`, [result.booking.id, orderId]);
      return {
        success: true, status: "payment_required", reference: result.booking.reference,
        order: { id: orderId, amount: toPaise(result.bill.total), currency: "INR", key_id: result.keys!.keyId },
        bill: result.bill,
      };
    } catch (err) {
      await q(`UPDATE bookings SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [result.booking.id]);
      throw err;
    }
  });

  // ─── Verify payment ─────────────────────────────────────────────────────
  app.post("/bookings/:reference/verify", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req) => {
    const user = await requireUser(req);
    const { reference } = req.params as { reference: string };
    const b = verifyBody.parse(req.body);

    const outcome = await tx(async (db) => {
      const booking = await one<any>(
        `SELECT id, reference, tier_id, quantity, coupon_id, status, razorpay_order_id FROM bookings WHERE reference = $1 AND user_id = $2 FOR UPDATE`, [reference, user.id], db);
      if (!booking) throw notFound("Booking not found.");
      if (booking.status === "confirmed") return { ok: true, already: true, id: booking.id as number };
      if (!booking.razorpay_order_id || booking.razorpay_order_id !== b.razorpay_order_id) throw badRequest("This payment does not belong to this booking.");

      const keys = await razorpayKeys(db);
      if (!keys) throw new HttpError(503, "Online payments are not available right now.", "payments_unavailable");
      const expected = createHmac("sha256", keys.keySecret).update(`${b.razorpay_order_id}|${b.razorpay_payment_id}`).digest("hex");
      const a = Buffer.from(expected), c = Buffer.from(b.razorpay_signature);
      const valid = a.length === c.length && timingSafeEqual(a, c);
      if (!valid) {
        if (booking.status === "pending") await q(`UPDATE bookings SET status = 'failed' WHERE id = $1`, [booking.id], db);
        return { ok: false, id: booking.id as number };
      }

      // Lock order matches POST /bookings (tier before coupon) to avoid deadlocks.
      await q(`SELECT 1 FROM ticket_tiers WHERE id = $1 FOR UPDATE`, [booking.tier_id], db);
      if (booking.coupon_id) await q(`SELECT 1 FROM coupons WHERE id = $1 FOR UPDATE`, [booking.coupon_id], db);
      // A valid signature proves the money was taken, so a booking marked 'failed' earlier (e.g. by a stray bad request) is still honoured.
      await confirmBooking(db, booking, b.razorpay_payment_id);
      return { ok: true, already: false, id: booking.id as number };
    });

    if (!outcome.ok) throw badRequest("Payment verification failed. If money was deducted, it will be refunded automatically.");
    if (!outcome.already) void notifyConfirmed(outcome.id);
    return { success: true, status: "confirmed", reference };
  });

  // ─── Read ───────────────────────────────────────────────────────────────
  app.get("/bookings/:reference", async (req) => {
    const user = await requireUser(req);
    const { reference } = req.params as { reference: string };
    const row = await one<any>(
      `SELECT ${BOOKING_COLS}, ${EVENT_COLS}
       FROM bookings b JOIN ticket_tiers t ON t.id = b.tier_id JOIN events e ON e.id = b.event_id LEFT JOIN venues v ON v.id = e.venue_id
       WHERE b.reference = $1 AND b.user_id = $2`, [reference, user.id]);
    if (!row) throw notFound("Booking not found."); // also the answer for someone else's booking
    const tickets = row.status === "confirmed"
      ? await q(`SELECT code, checked_in_at FROM tickets WHERE booking_id = $1 ORDER BY id`, [row.id])
      : [];
    const { id: _id, ...rest } = row;
    const booking = {
      reference: rest.reference, status: rest.status, quantity: rest.quantity, attendee_name: rest.attendee_name, attendee_email: rest.attendee_email,
      attendee_phone: rest.attendee_phone, subtotal: rest.subtotal, discount: rest.discount, customer_fee: rest.customer_fee, total: rest.total,
      created_at: rest.created_at, confirmed_at: rest.confirmed_at, tier_name: rest.tier_name,
    };
    const event = {
      id: rest.event_id, title: rest.event_title, slug: rest.event_slug, event_date: rest.event_date, event_time: rest.event_time, end_date: rest.end_date,
      end_time: rest.end_time, image_path: rest.image_path, thumb_path: rest.thumb_path, status: rest.event_status,
      venue_name: rest.venue_name, venue_area: rest.venue_area, venue_address: rest.venue_address,
    };
    return { booking, event, tickets };
  });

  app.get("/me/bookings", async (req) => {
    const user = await requireUser(req);
    const bookings = await q(
      `SELECT b.reference, b.status, b.quantity, b.total, b.created_at, t.name AS tier_name,
              e.title AS event_title, e.slug AS event_slug, e.event_date, e.event_time, e.thumb_path
       FROM bookings b JOIN ticket_tiers t ON t.id = b.tier_id JOIN events e ON e.id = b.event_id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 100`, [user.id]);
    return { bookings };
  });
}
