/**
 * Ticket billing. Pure functions (no I/O) so the maths is easy to test.
 *
 * Mirrors the legacy client-side `calculateBilling`:
 *   base       = (price × qty − discount)              never below 0
 *   commission = base × commissionRate%                platform fee on the discounted amount
 *   gst        = commission × 18%
 *   absorption = who pays commission + gst:  organiser → nobody extra, customer → buyer pays all, split → 50/50
 *   total      = base + the buyer's share of (commission + gst); 0 when base is 0
 *
 * The SERVER result is authoritative: the booking API recomputes everything and ignores client amounts.
 */
export type AbsorptionMode = "organiser" | "customer" | "split";

export const GST_RATE = 0.18;

/** Round to 2 decimals (half away from zero, with a nudge for binary floating point). */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface BillInput {
  /** Unit price in rupees. */
  price: number;
  quantity: number;
  /** Coupon discount in rupees (already computed). Capped at the subtotal. */
  discount?: number;
  /** Platform commission, percent (e.g. 15). */
  commissionRate: number;
  absorptionMode: AbsorptionMode;
}

export interface Bill {
  /** price × quantity, before discount. */
  subtotal: number;
  discount: number;
  /** Platform fee on (subtotal − discount). */
  commission: number;
  /** 18 % GST on the commission. */
  gst: number;
  /** Part of commission + gst charged to the buyer. */
  customer_fee: number;
  /** Buyer's share of the commission alone, and of the GST alone (for the two bill rows). customer_fee = sum of both. */
  customer_commission: number;
  customer_gst: number;
  /** What the buyer pays. */
  total: number;
  /** (subtotal − discount) minus the part of commission + gst the organiser absorbs. */
  organizer_payout: number;
}

const SHARE: Record<AbsorptionMode, number> = { organiser: 0, customer: 1, split: 0.5 };

export function computeBill(input: BillInput): Bill {
  const { price, quantity, commissionRate, absorptionMode } = input;
  if (!(price >= 0) || !Number.isFinite(price)) throw new RangeError("price must be a non-negative number");
  if (!Number.isInteger(quantity) || quantity < 1) throw new RangeError("quantity must be a positive integer");
  if (!(commissionRate >= 0 && commissionRate <= 100)) throw new RangeError("commissionRate must be between 0 and 100");
  if (!(absorptionMode in SHARE)) throw new RangeError("unknown absorption mode");

  const subtotal = round2(price * quantity);
  const discount = round2(Math.min(Math.max(input.discount ?? 0, 0), subtotal));
  const base = round2(subtotal - discount);

  if (base <= 0) {
    return { subtotal, discount, commission: 0, gst: 0, customer_fee: 0, customer_commission: 0, customer_gst: 0, total: 0, organizer_payout: 0 };
  }

  const rawCommission = base * (commissionRate / 100);
  const rawGst = rawCommission * GST_RATE;
  const commission = round2(rawCommission);
  const gst = round2(rawGst);

  const share = SHARE[absorptionMode];
  const customer_fee = round2((rawCommission + rawGst) * share);
  const customer_commission = round2(rawCommission * share);
  const customer_gst = round2(customer_fee - customer_commission); // rows always add up to customer_fee
  const total = round2(base + customer_fee);
  const organizer_payout = round2(Math.max(0, base - (commission + gst - customer_fee)));

  return { subtotal, discount, commission, gst, customer_fee, customer_commission, customer_gst, total, organizer_payout };
}

/** Discount a coupon gives on `subtotal` (never more than the subtotal). */
export function couponDiscount(type: "percent" | "fixed", value: number, subtotal: number): number {
  const raw = type === "percent" ? (subtotal * Math.min(value, 100)) / 100 : value;
  return round2(Math.min(Math.max(raw, 0), subtotal));
}

/** Razorpay amounts are integers in paise. */
export const toPaise = (rupees: number): number => Math.round(round2(rupees) * 100);
