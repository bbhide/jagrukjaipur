import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBill, couponDiscount, round2, toPaise } from "../src/services/billing.js";

const base = { price: 1000, quantity: 2, commissionRate: 15 };

test("organiser absorbs: buyer pays the ticket price only", () => {
  const b = computeBill({ ...base, absorptionMode: "organiser" });
  assert.equal(b.subtotal, 2000);
  assert.equal(b.commission, 300);
  assert.equal(b.gst, 54);
  assert.equal(b.customer_fee, 0);
  assert.equal(b.total, 2000);
  assert.equal(b.organizer_payout, 2000 - 354);
});

test("customer absorbs: buyer pays commission + GST on top, organiser gets the full amount", () => {
  const b = computeBill({ ...base, absorptionMode: "customer" });
  assert.equal(b.customer_commission, 300);
  assert.equal(b.customer_gst, 54);
  assert.equal(b.customer_fee, 354);
  assert.equal(b.total, 2354);
  assert.equal(b.organizer_payout, 2000);
});

test("split absorbs 50/50", () => {
  const b = computeBill({ ...base, absorptionMode: "split" });
  assert.equal(b.customer_fee, 177);
  assert.equal(b.customer_commission, 150);
  assert.equal(b.customer_gst, 27);
  assert.equal(b.total, 2177);
  assert.equal(b.organizer_payout, 2000 - 177);
});

test("discount reduces the fee base, and is shown separately from the subtotal", () => {
  const b = computeBill({ price: 500, quantity: 2, discount: 200, commissionRate: 10, absorptionMode: "customer" });
  assert.equal(b.subtotal, 1000);
  assert.equal(b.discount, 200);
  assert.equal(b.commission, 80); // 10 % of 800
  assert.equal(b.gst, 14.4);
  assert.equal(b.total, 894.4);
  assert.equal(b.organizer_payout, 800);
});

test("discount is capped at the subtotal and a fully discounted order is free", () => {
  for (const mode of ["organiser", "customer", "split"] as const) {
    const b = computeBill({ price: 300, quantity: 1, discount: 999, commissionRate: 15, absorptionMode: mode });
    assert.equal(b.discount, 300);
    assert.equal(b.total, 0);
    assert.equal(b.commission, 0);
    assert.equal(b.gst, 0);
    assert.equal(b.customer_fee, 0);
    assert.equal(b.organizer_payout, 0);
  }
});

test("free tier: nothing is charged in any mode", () => {
  for (const mode of ["organiser", "customer", "split"] as const) {
    const b = computeBill({ price: 0, quantity: 4, commissionRate: 15, absorptionMode: mode });
    assert.deepEqual([b.subtotal, b.total, b.customer_fee, b.organizer_payout], [0, 0, 0, 0]);
  }
});

test("zero commission rate means no fee", () => {
  const b = computeBill({ price: 250, quantity: 3, commissionRate: 0, absorptionMode: "customer" });
  assert.equal(b.total, 750);
  assert.equal(b.organizer_payout, 750);
});

test("amounts are rounded to 2 decimals and rows add up", () => {
  const b = computeBill({ price: 199, quantity: 3, commissionRate: 12.5, absorptionMode: "split" });
  for (const v of Object.values(b)) assert.equal(v, round2(v));
  assert.equal(round2(b.customer_commission + b.customer_gst), b.customer_fee);
  assert.equal(round2(b.subtotal - b.discount + b.customer_fee), b.total);
  // 597 × 12.5 % = 74.625 ; GST 13.4325 ; half of 88.0575 = 44.02875
  assert.equal(b.commission, 74.63);
  assert.equal(b.gst, 13.43);
  assert.equal(b.customer_fee, 44.03);
  assert.equal(b.total, 641.03);
});

test("never pays the organiser a negative amount", () => {
  const b = computeBill({ price: 1, quantity: 1, commissionRate: 100, absorptionMode: "organiser" });
  assert.equal(b.organizer_payout, 0);
});

test("rejects invalid input", () => {
  assert.throws(() => computeBill({ price: -1, quantity: 1, commissionRate: 15, absorptionMode: "organiser" }), RangeError);
  assert.throws(() => computeBill({ price: 10, quantity: 0, commissionRate: 15, absorptionMode: "organiser" }), RangeError);
  assert.throws(() => computeBill({ price: 10, quantity: 1, commissionRate: 101, absorptionMode: "organiser" }), RangeError);
});

test("coupon discounts", () => {
  assert.equal(couponDiscount("percent", 50, 399), 199.5);
  assert.equal(couponDiscount("percent", 150, 100), 100);
  assert.equal(couponDiscount("fixed", 75, 60), 60);
  assert.equal(couponDiscount("fixed", 75, 200), 75);
});

test("toPaise avoids float drift", () => {
  assert.equal(toPaise(894.4), 89440);
  assert.equal(toPaise(0.29), 29);
  assert.equal(toPaise(1.005), 101);
});
