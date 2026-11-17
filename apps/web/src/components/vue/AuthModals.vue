<script setup lang="ts">
/**
 * WhatsApp OTP login (3 steps) and the Edit Profile dialog.
 * Any element carrying `.needs-auth-ticket-btn` is a members-only action: logged-in visitors are sent
 * to its `data-ticket-url`, everyone else gets the login dialog first and continues afterwards.
 */
import { nextTick, onMounted, reactive, ref } from "vue";
import { call, isInternal, isLoggedIn, RequestError } from "@/scripts/http";

const props = defineProps<{ loggedIn: boolean }>();

const open = ref(false);
const step = ref<1 | 2 | 3>(1);
const busy = ref(false);
const error = ref("");
const form = reactive({ mobile: "", otp: "", name: "", email: "" });
const pending = reactive({ url: null as string | null, page: "", button: "", slug: "" });
const copy = reactive({ intro: "", last: "" });
const otpInput = ref<HTMLInputElement>();
const nameInput = ref<HTMLInputElement>();

function describe(button: string, page: string, url: string) {
  const b = button.toLowerCase(), p = page.toLowerCase(), u = url.toLowerCase();
  if (b.includes("submit event") || u.includes("submit-event") || p.includes("submit-event")) return ["submit your event", "submitting your event"];
  if (b.includes("community") || u.includes("community") || p.includes("community")) return ["submit your community", "submitting your community"];
  if (b.includes("maps") || b.includes("direction") || u.includes("maps")) return ["access event location", "opening location"];
  if (/contact|social|phone|instagram|facebook|website|youtube/.test(b)) return ["access contact details and links", "accessing links and details"];
  if (b.includes("search") || p.includes("search") || u.includes("search")) return ["search events & communities", "searching"];
  return ["access event tickets", "getting your tickets"];
}

function openLogin(url: string | null, page?: string, button?: string, slug?: string) {
  Object.assign(form, { mobile: "", otp: "", name: "", email: "" });
  Object.assign(pending, { url, page: page || location.pathname, button: button || "Get Tickets", slug: slug || "" });
  const [a, b] = describe(pending.button, pending.page, url ?? "");
  copy.intro = `Enter your WhatsApp number to securely ${a}.`;
  copy.last = `Just one last step before ${b}.`;
  step.value = 1; error.value = ""; open.value = true;
}

function go(url: string, slug?: string) {
  if (slug) navigator.sendBeacon?.(`/api/events/${slug}/interest`, new Blob(["{}"], { type: "application/json" }));
  if (isInternal(url)) location.href = url;
  else window.open(url, "_blank", "noopener");
}

function finish() {
  const { url, slug } = pending;
  if (url && url !== "#") {
    go(url, slug);
    if (!isInternal(url)) { open.value = false; location.reload(); }
  } else location.reload();
}

async function run(fn: () => Promise<void>) {
  busy.value = true; error.value = "";
  try { await fn(); } catch (e) { error.value = e instanceof RequestError ? e.message : "Network error. Please try again."; }
  busy.value = false;
}

const sendOtp = () => run(async () => {
  if (!/^\d{10}$/.test(form.mobile.trim())) return;
  await call("/auth/otp/send", { whatsapp_number: form.mobile.trim(), source_page: pending.page, source_button: pending.button });
  step.value = 2;
  nextTick(() => otpInput.value?.focus());
});

const verifyOtp = () => run(async () => {
  const res = await call("/auth/otp/verify", { otp: form.otp.trim() });
  if (res.status === "logged_in") return finish();
  step.value = 3;
  nextTick(() => nameInput.value?.focus());
});

const complete = () => run(async () => {
  await call("/auth/complete", { name: form.name.trim(), email: form.email.trim() });
  finish();
});

// ─── Profile ──────────────────────────────────────────────────
const profileOpen = ref(false);
const profileBusy = ref(false);
const profileLoading = ref(false);
const profileError = ref("");
const profileOk = ref("");
const profile = reactive({ whatsapp_number: "", name: "", gender: "", dob: "", email: "", instagram_username: "" });

function cleanInstagram() {
  let u = profile.instagram_username.trim().split("?")[0].replace(/\/$/, "");
  if (u.includes("/")) u = u.split("/").pop() ?? "";
  profile.instagram_username = u.replace(/^@/, "");
}

async function openProfile() {
  profileOpen.value = true; profileLoading.value = true; profileError.value = ""; profileOk.value = "";
  try {
    const { user } = await call("/me");
    Object.assign(profile, { whatsapp_number: user.whatsapp_number ?? "", name: user.name ?? "", gender: user.gender ?? "", dob: user.dob ?? "", email: user.email ?? "", instagram_username: user.instagram_username ?? "" });
  } catch (e) {
    if (e instanceof RequestError && e.status === 401) { document.cookie = "wa_logged_in=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;"; location.reload(); return; }
    profileError.value = e instanceof RequestError ? e.message : "Network error. Please try again.";
  }
  profileLoading.value = false;
}

/** The dialog stays open until gender, date of birth and email are filled, as on the reference site. */
function closeProfile(force = false) {
  if (!force && (!profile.gender || !profile.dob || !profile.email.trim())) { profileError.value = "Please complete your profile."; profileOk.value = ""; return; }
  profileOpen.value = false;
}

async function saveProfile() {
  cleanInstagram();
  profileBusy.value = true; profileError.value = ""; profileOk.value = "";
  try {
    await call("/me", { name: profile.name.trim(), gender: profile.gender, dob: profile.dob, email: profile.email.trim(), instagram_username: profile.instagram_username }, "PUT");
    profileOk.value = "Profile updated successfully!";
    document.querySelectorAll<HTMLElement>(".nav-profile-name").forEach((el) => (el.innerText = profile.name.trim()));
    setTimeout(() => closeProfile(true), 1200);
  } catch (e) { profileError.value = e instanceof RequestError ? e.message : "Network error. Please try again."; }
  profileBusy.value = false;
}

async function logout() {
  await call("/auth/logout", {}).catch(() => {});
  location.href = "/";
}

onMounted(() => {
  const authed = () => props.loggedIn || isLoggedIn();

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".share-event-card")) return;
    if (target.closest("[data-open-profile]")) { e.preventDefault(); openProfile(); return; }
    const el = target.closest<HTMLElement>(".needs-auth-ticket-btn");
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const url = el.dataset.ticketUrl || "#";
    if (authed()) { if (url !== "#") go(url, el.dataset.eventSlug); return; }
    openLogin(url, el.dataset.sourcePage, el.dataset.sourceButton || el.innerText.trim(), el.dataset.eventSlug);
  }, true);

  // Search is members-only: intercept the field and the form.
  const searchGate = (e: Event, label: string, url = "/search") => {
    if (authed()) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).blur?.();
    openLogin(url, location.pathname, label);
  };
  document.addEventListener("submit", (e) => {
    const f = (e.target as HTMLElement).closest<HTMLFormElement>('form[action="/search"]');
    if (!f) return;
    const qv = (f.querySelector<HTMLInputElement>('input[name="q"]')?.value ?? "").trim();
    searchGate(e, "Search Form Submit", qv ? `/search?q=${encodeURIComponent(qv)}` : "/search");
  }, true);
  for (const type of ["focusin", "click"] as const) {
    document.addEventListener(type, (e) => {
      const t = e.target as HTMLElement;
      if (t?.id === "nav-search-input" || t?.id === "search-input") searchGate(e, type === "click" ? "Search Input Click" : "Search Input Focus");
    }, true);
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { open.value = false; if (profileOpen.value) closeProfile(); } });
  window.addEventListener("jj:login", (e) => { const d = (e as CustomEvent).detail ?? {}; openLogin(d.url ?? null, d.page, d.button); });
});

const field = "w-full rounded-lg border border-white/20 bg-black/20 p-3 text-base text-white outline-none focus:border-primary";
const iconField = `${field} pl-[2.2rem]`;
const label = "mb-[0.4rem] block text-[0.8rem] font-medium text-white";
const iconCls = "absolute left-3 top-1/2 -translate-y-1/2 text-[0.9rem] text-[#aaa]";
</script>

<template>
  <div class="auth-modal-overlay" :class="{ active: open }" id="auth-modal-overlay" @click.self="open = false">
    <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <button class="auth-modal-close !text-white" id="auth-modal-close" aria-label="Close" @click="open = false">&times;</button>

      <div v-if="step === 1" id="auth-step-1">
        <h2 id="auth-modal-title" class="mb-2 text-2xl text-white">Log in via WhatsApp</h2>
        <p id="auth-modal-desc" class="mb-6 text-[0.9rem] text-[#aaa]">{{ copy.intro }}</p>
        <form id="auth-form-1" data-no-loading @submit.prevent="sendOtp">
          <input v-model="form.mobile" type="tel" id="auth-mobile" inputmode="numeric" placeholder="10-digit Mobile Number" required pattern="[0-9]{10}" maxlength="10" :class="[field, 'mb-4']" />
          <button type="submit" class="btn btn-primary w-full justify-center" id="auth-btn-1" :disabled="busy">{{ busy ? "Sending..." : "Send OTP" }}</button>
          <p v-if="error" id="auth-error-1" class="mt-2 text-[0.85rem] text-danger" role="alert">{{ error }}</p>
        </form>
      </div>

      <div v-else-if="step === 2" id="auth-step-2">
        <h2 class="mb-2 text-2xl text-white">Enter OTP</h2>
        <p class="mb-6 text-[0.9rem] text-[#aaa]">We've sent a code to your WhatsApp: <span id="auth-mobile-display" class="font-semibold text-white">+91 {{ form.mobile }}</span></p>
        <form id="auth-form-2" data-no-loading @submit.prevent="verifyOtp">
          <input ref="otpInput" v-model="form.otp" type="text" id="auth-otp" inputmode="numeric" autocomplete="one-time-code" placeholder="4-digit code" required maxlength="4" :class="[field, 'mb-4 text-center tracking-[0.2em]']" />
          <button type="submit" class="btn btn-primary w-full justify-center" id="auth-btn-2" :disabled="busy">{{ busy ? "Verifying..." : "Verify OTP" }}</button>
          <p v-if="error" id="auth-error-2" class="mt-2 text-[0.85rem] text-danger" role="alert">{{ error }}</p>
        </form>
      </div>

      <div v-else id="auth-step-3">
        <h2 class="mb-2 text-2xl text-white">Complete Registration</h2>
        <p class="mb-6 text-[0.9rem] text-[#aaa]">{{ copy.last }}</p>
        <form id="auth-form-3" data-no-loading @submit.prevent="complete">
          <input ref="nameInput" v-model="form.name" type="text" id="auth-name" placeholder="Your Full Name" required :class="[field, 'mb-4']" />
          <input v-model="form.email" type="email" id="auth-email" placeholder="Email Address" required :class="[field, 'mb-6']" />
          <button type="submit" class="btn btn-primary w-full justify-center" id="auth-btn-3" :disabled="busy">{{ busy ? "Saving..." : "Complete Registration" }}</button>
          <p v-if="error" id="auth-error-3" class="mt-2 text-[0.85rem] text-danger" role="alert">{{ error }}</p>
        </form>
      </div>
    </div>
  </div>

  <div v-if="loggedIn" class="auth-modal-overlay" :class="{ active: profileOpen }" id="profile-modal-overlay" @click.self="closeProfile()">
    <div class="auth-modal max-h-[92vh] !max-w-[450px] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
      <button class="auth-modal-close" id="profile-modal-close" aria-label="Close" @click="closeProfile()">&times;</button>
      <h2 id="profile-modal-title" class="mb-2 flex items-center gap-2 text-2xl text-white">👤 Edit Profile</h2>
      <p class="mb-6 text-[0.9rem] text-[#aaa]">Manage your profile information and preferences.</p>
      <form id="profile-form" data-no-loading @submit.prevent="saveProfile">
        <div class="mb-4">
          <label class="mb-[0.4rem] block text-[0.8rem] text-[#aaa]" for="profile-mobile">WhatsApp Number (Verified)</label>
          <div class="relative"><span :class="iconCls">📞</span>
            <input id="profile-mobile" type="text" :value="profile.whatsapp_number" readonly disabled class="w-full cursor-not-allowed rounded-lg border border-white/10 bg-white/5 p-3 pl-[2.2rem] text-base text-[#888]" /></div>
        </div>
        <div class="mb-4">
          <label :class="label" for="profile-name">Full Name</label>
          <div class="relative"><span :class="iconCls">👤</span><input id="profile-name" v-model="profile.name" type="text" required placeholder="Your Name" :class="iconField" /></div>
        </div>
        <div class="mb-4">
          <label :class="label" for="profile-gender">Gender</label>
          <select id="profile-gender" v-model="profile.gender" :class="[field, 'profile-select appearance-none']">
            <option value="">Select Gender</option><option>Male</option><option>Female</option><option>Other</option><option>Prefer not to say</option>
          </select>
        </div>
        <div class="mb-4">
          <label :class="label" for="profile-dob">Date of Birth</label>
          <input id="profile-dob" v-model="profile.dob" type="date" :class="[field, '[color-scheme:dark]']" />
        </div>
        <div class="mb-4">
          <label :class="label" for="profile-email">Email Address</label>
          <div class="relative"><span :class="iconCls">✉️</span><input id="profile-email" v-model="profile.email" type="email" placeholder="name@example.com" :class="iconField" /></div>
        </div>
        <div class="mb-6">
          <label :class="label" for="profile-instagram">Instagram Username</label>
          <div class="relative"><span :class="iconCls">📸</span><input id="profile-instagram" v-model="profile.instagram_username" type="text" placeholder="e.g. jagrukjaipur" :class="iconField" @blur="cleanInstagram" /></div>
          <small class="mt-[0.3rem] block text-xs text-[#888]">Enter username only (no full URL or @)</small>
        </div>
        <button type="submit" class="btn btn-primary mb-4 w-full justify-center" id="profile-btn-save" :disabled="profileBusy || profileLoading">
          {{ profileLoading ? "Loading..." : profileBusy ? "Saving..." : "Save Changes" }}
        </button>
        <p v-if="profileError" id="profile-error" class="mt-2 text-center text-[0.85rem] text-danger" role="alert">{{ profileError }}</p>
        <p v-if="profileOk" id="profile-success" class="mt-2 text-center text-[0.85rem] text-[#10b981]" role="status">{{ profileOk }}</p>
        <button type="button" class="mx-auto mt-3 block text-[0.8rem] text-muted underline" id="profile-logout" @click="logout">Sign out</button>
      </form>
    </div>
  </div>
</template>

<style>
.profile-select {
  background: rgba(0, 0, 0, 0.2) url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23ffffff%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E") no-repeat right 0.75rem center;
  background-size: 0.65rem auto;
}
.profile-select option { background: #130b20; color: #fff; }
</style>
