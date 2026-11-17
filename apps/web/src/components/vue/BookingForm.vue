<script setup lang="ts">
/**
 * Native ticket booking form (port of the legacy inline script).
 * Tier + quantity → attendee details + custom questions → coupon → bill → login check → (free) confirm / (paid) Razorpay → /booking/<reference>.
 * The bill shown here is a preview; the server recomputes every amount and its figures are authoritative.
 */
import { computed, onMounted, reactive, ref } from "vue";
import { call, isLoggedIn, RequestError } from "@/scripts/http";

interface Tier { id: number; name: string; price: number; capacity: number | null; sold: number }
interface Question { id: number; label: string; is_required: boolean }
const props = defineProps<{
  event: { id: number; title: string; slug: string };
  tiers: Tier[];
  questions: Question[];
  hasCoupons: boolean;
  commissionRate: number;
  absorptionMode: "organiser" | "customer" | "split";
}>();

// Form state saved across the login dialog (sessionStorage).
const PENDING_KEY = "jj_pending_booking";
const questions = props.questions.slice(0, 3);

const tierId = ref<number | "">("");
const qty = ref(1);
const attendee = reactive({ name: "", email: "", whatsapp: "" });
const answers = reactive<Record<number, string>>({});
const couponCode = ref("");
const discount = ref(0);
const couponMsg = ref<{ ok: boolean; text: string } | null>(null);
const couponBusy = ref(false);
const submitting = ref(false);
const error = ref("");
const verifying = ref(false);

const left = (t: Tier) => (t.capacity === null ? Infinity : Math.max(0, t.capacity - t.sold));
const tier = computed(() => props.tiers.find((t) => t.id === tierId.value) ?? null);
const maxQty = computed(() => Math.max(1, Math.min(10, tier.value ? left(tier.value) : 10)));
const qtyOptions = computed(() => Array.from({ length: maxQty.value }, (_, i) => i + 1));

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const inr = (n: number) => `₹${n.toFixed(2)}`;

/** Same maths as the server's computeBill (display only). */
const bill = computed(() => {
  const price = tier.value ? Number(tier.value.price) : 0;
  const subtotal = r2(price * qty.value);
  const disc = Math.min(discount.value, subtotal);
  const base = r2(subtotal - disc);
  const share = props.absorptionMode === "customer" ? 1 : props.absorptionMode === "split" ? 0.5 : 0;
  if (base <= 0) return { subtotal, disc, fee: 0, gst: 0, total: 0 };
  const rawFee = base * (props.commissionRate / 100);
  const rawGst = rawFee * 0.18;
  const customerFee = r2((rawFee + rawGst) * share);
  const fee = r2(rawFee * share);
  return { subtotal, disc, fee, gst: r2(customerFee - fee), total: r2(base + customerFee) };
});

const buttonLabel = computed(() => {
  if (!tier.value) return "Proceed to Book 🎟️";
  return bill.value.total <= 0 ? "Complete Free Registration 🎟️" : "Pay & Confirm Booking 💳";
});

function onTierOrQtyChange() {
  if (qty.value > maxQty.value) qty.value = maxQty.value;
  // The discount depends on the subtotal, so a changed order needs the coupon applied again.
  if (discount.value > 0) { discount.value = 0; couponMsg.value = { ok: false, text: "Order changed. Please apply your coupon again." }; }
}

async function applyCoupon() {
  const code = couponCode.value.trim();
  if (!tier.value) { error.value = "Please select a ticket option first."; return; }
  error.value = "";
  if (!code) { discount.value = 0; couponMsg.value = null; return; }
  couponBusy.value = true;
  try {
    const res = await call<{ discount_amount: number }>("/coupons/apply", { event_id: props.event.id, coupon_code: code, subtotal: r2(Number(tier.value.price) * qty.value) });
    discount.value = res.discount_amount;
    couponMsg.value = { ok: true, text: `✅ Coupon applied! ₹${res.discount_amount.toFixed(2)} discount.` };
  } catch (e) {
    discount.value = 0;
    couponMsg.value = { ok: false, text: e instanceof RequestError ? e.message : "Failed to apply coupon." };
  } finally { couponBusy.value = false; }
}

function requireLogin() {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ tier_id: tierId.value, qty: qty.value, name: attendee.name, email: attendee.email, whatsapp: attendee.whatsapp, answers: { ...answers }, coupon: couponCode.value }));
  } catch { /* storage unavailable: the visitor re-enters the form */ }
  window.dispatchEvent(new CustomEvent("jj:login", { detail: { url: location.pathname, page: `Event Booking: ${props.event.title}`, button: "Book Tickets" } }));
}

function loadRazorpay(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

const goToBooking = (ref: string) => { verifying.value = true; location.href = `/booking/${ref}`; };

async function submit() {
  error.value = "";
  if (!tier.value) { error.value = "Please select a ticket option."; return; }
  if (!isLoggedIn()) { requireLogin(); return; }
  if (!/^[6-9]\d{9}$/.test(attendee.whatsapp.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, ""))) { error.value = "Please enter a valid 10-digit WhatsApp number."; return; }
  submitting.value = true;
  try {
    const res = await call<any>("/bookings", {
      event_id: props.event.id,
      tier_id: tier.value.id,
      quantity: qty.value,
      attendee_name: attendee.name,
      attendee_email: attendee.email,
      attendee_phone: attendee.whatsapp,
      answers: questions.map((q) => ({ question_id: q.id, answer: (answers[q.id] ?? "").trim() })).filter((a) => a.answer),
      // Only a coupon the visitor has successfully applied is sent; the server re-validates it and recomputes the discount.
      coupon_code: discount.value > 0 ? couponCode.value.trim() : undefined,
    });
    if (res.status === "confirmed") { goToBooking(res.reference); return; }

    await loadRazorpay();
    const Razorpay = (window as any).Razorpay;
    const reference: string = res.reference;
    const rzp = new Razorpay({
      key: res.order.key_id,
      amount: res.order.amount,
      currency: res.order.currency,
      name: "Jagruk Jaipur",
      description: "Event Tickets Booking",
      order_id: res.order.id,
      handler: async (payment: Record<string, string>) => {
        verifying.value = true;
        try {
          await call(`/bookings/${reference}/verify`, {
            razorpay_order_id: payment.razorpay_order_id,
            razorpay_payment_id: payment.razorpay_payment_id,
            razorpay_signature: payment.razorpay_signature,
          });
          location.href = `/booking/${reference}`;
        } catch (e) {
          verifying.value = false; submitting.value = false;
          error.value = e instanceof RequestError ? e.message : "We could not verify your payment. If money was deducted it will be refunded automatically.";
        }
      },
      modal: { ondismiss: () => { submitting.value = false; } },
      prefill: { name: attendee.name, email: attendee.email, contact: attendee.whatsapp },
      theme: { color: "#7C3AED" },
    });
    rzp.on?.("payment.failed", (r: any) => { error.value = r?.error?.description ?? "The payment failed. Please try again."; submitting.value = false; });
    rzp.open();
  } catch (e) {
    if (e instanceof RequestError && e.status === 401) { requireLogin(); }
    else error.value = e instanceof Error ? e.message : "Something went wrong. Please try again.";
    submitting.value = false;
  }
}

onMounted(async () => {
  // Restore what the visitor typed before the login dialog interrupted them.
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) {
      sessionStorage.removeItem(PENDING_KEY);
      const p = JSON.parse(raw);
      if (props.tiers.some((t) => t.id === p.tier_id)) tierId.value = p.tier_id;
      qty.value = Math.min(Number(p.qty) || 1, maxQty.value);
      Object.assign(attendee, { name: p.name ?? "", email: p.email ?? "", whatsapp: p.whatsapp ?? "" });
      Object.assign(answers, p.answers ?? {});
      couponCode.value = p.coupon ?? "";
    }
  } catch { /* ignore */ }
  if (isLoggedIn()) {
    try {
      const { user } = await call<{ user: { name: string | null; email: string | null; whatsapp_number: string } }>("/me");
      if (!attendee.name) attendee.name = user.name ?? "";
      if (!attendee.email) attendee.email = user.email ?? "";
      if (!attendee.whatsapp) attendee.whatsapp = user.whatsapp_number.replace(/^91(?=\d{10}$)/, "");
    } catch { /* not logged in after all */ }
  }
  if (couponCode.value && tier.value) applyCoupon();
});

const field = "w-full rounded-lg border border-white/20 bg-black/20 p-3 text-base text-white outline-none focus:border-primary";
const label = "mb-[0.4rem] block text-[0.8rem] font-medium text-white";
</script>

<template>
  <form id="ticket-purchase-form" class="glass-box scroll-mt-40" data-no-loading :data-comm-rate="commissionRate" :data-absorption-mode="absorptionMode" novalidate @submit.prevent="submit">
    <h2 class="mb-1 text-[1.4rem]">🎟 Book Your Tickets</h2>
    <p class="mb-5 text-[0.9rem] text-muted">Pick a ticket, add the attendee's details and confirm. Your pass with a QR code is available right after booking.</p>

    <div class="grid grid-cols-[1fr_120px] gap-4 max-sm:grid-cols-1">
      <div>
        <label for="ticket-tier-select" :class="label">Ticket type</label>
        <select id="ticket-tier-select" v-model="tierId" :class="field" required @change="onTierOrQtyChange">
          <option value="" class="bg-bg-2">Select a ticket option</option>
          <option v-for="t in tiers" :key="t.id" :value="t.id" :disabled="left(t) === 0" class="bg-bg-2">
            {{ t.name }} — {{ Number(t.price) > 0 ? `₹${Number(t.price).toLocaleString("en-IN")}` : "Free" }}{{ left(t) === 0 ? " (Sold out)" : left(t) <= 10 ? ` (${left(t)} left)` : "" }}
          </option>
        </select>
      </div>
      <div>
        <label for="ticket-qty-select" :class="label">Quantity</label>
        <select id="ticket-qty-select" v-model.number="qty" :class="field" @change="onTierOrQtyChange">
          <option v-for="n in qtyOptions" :key="n" :value="n" class="bg-bg-2">{{ n }}</option>
        </select>
      </div>
    </div>

    <div v-if="tier" id="attendee-info-section" class="mt-5 flex flex-col gap-4">
      <div class="border-t border-line pt-5 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-faint">Attendee details</div>
      <div>
        <label for="attendee-name" :class="label">Full name</label>
        <input id="attendee-name" v-model="attendee.name" name="attendee_name" type="text" autocomplete="name" required minlength="2" maxlength="120" :class="field" />
      </div>
      <div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <div>
          <label for="attendee-email" :class="label">Email</label>
          <input id="attendee-email" v-model="attendee.email" name="attendee_email" type="email" autocomplete="email" required :class="field" />
        </div>
        <div>
          <label for="attendee-whatsapp" :class="label">WhatsApp number</label>
          <input id="attendee-whatsapp" v-model="attendee.whatsapp" name="attendee_whatsapp" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="10-digit number" maxlength="13" required :class="field" />
        </div>
      </div>

      <div v-for="q in questions" :key="q.id" class="custom-q-group">
        <label :for="`custom-q-${q.id}`" :class="label">{{ q.label }}<span v-if="q.is_required" class="text-danger"> *</span></label>
        <input :id="`custom-q-${q.id}`" v-model="answers[q.id]" type="text" maxlength="500" :required="q.is_required" class="custom-q-ans" :class="field" />
      </div>

      <div v-if="hasCoupons">
        <label for="coupon-code-input" :class="label">Coupon code</label>
        <div class="flex gap-2">
          <input id="coupon-code-input" v-model="couponCode" type="text" autocapitalize="characters" maxlength="40" placeholder="Have a coupon?" :class="field" @keydown.enter.prevent="applyCoupon" />
          <button id="apply-coupon-btn" type="button" class="btn btn-outline" :disabled="couponBusy" @click="applyCoupon">{{ couponBusy ? "…" : "Apply" }}</button>
        </div>
        <p v-if="couponMsg" id="coupon-msg" class="mt-2 text-[0.85rem]" :class="couponMsg.ok ? 'text-[#4ade80]' : 'text-danger'">{{ couponMsg.text }}</p>
      </div>
    </div>

    <!-- Bill -->
    <div v-if="tier" class="mt-6 rounded-card border border-line bg-white/[0.03] p-4 text-[0.92rem]" aria-live="polite">
      <div class="flex justify-between py-1 text-muted"><span>Subtotal</span><span id="bill-subtotal">{{ inr(bill.subtotal) }}</span></div>
      <div v-if="bill.disc > 0" id="bill-discount-row" class="flex justify-between py-1 text-[#4ade80]"><span>Discount</span><span id="bill-discount">-{{ inr(bill.disc) }}</span></div>
      <template v-if="bill.fee > 0">
        <div id="bill-fee-row" class="flex justify-between py-1 text-muted"><span>Convenience fee</span><span id="bill-fee">{{ inr(bill.fee) }}</span></div>
        <div id="bill-gst-row" class="flex justify-between py-1 text-muted"><span>GST (18% on fee)</span><span id="bill-gst">{{ inr(bill.gst) }}</span></div>
      </template>
      <div class="mt-2 flex justify-between border-t border-line pt-3 text-[1.1rem] font-bold text-ink"><span>Total</span><span id="bill-total">{{ inr(bill.total) }}</span></div>
    </div>

    <p v-if="error" role="alert" class="mt-4 text-[0.9rem] text-danger">{{ error }}</p>

    <button id="buy-tickets-submit-btn" type="submit" class="btn btn-accent mt-5 w-full justify-center !p-[0.9rem] text-base" :class="{ 'pointer-events-none opacity-75': submitting }" :disabled="submitting">
      <template v-if="submitting"><span class="btn-spinner"></span> Processing Order...</template>
      <template v-else>{{ buttonLabel }}</template>
    </button>
  </form>

  <Teleport to="body">
    <div v-if="verifying" id="payment-verification-overlay" role="alert" aria-live="assertive"
         class="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[rgb(10_10_15/0.95)] text-white">
      <div class="mb-6 h-[60px] w-[60px] animate-spin rounded-full border-[5px] border-primary-soft/10 border-t-primary-soft"></div>
      <h2 class="mb-2 text-2xl font-extrabold tracking-tight">Verifying Ticket Reservation...</h2>
      <p class="max-w-[350px] px-4 text-center text-[0.95rem] leading-normal text-[#a3a3a3]">We've received your registration. Please wait a moment...</p>
    </div>
  </Teleport>
</template>
