<script setup lang="ts">
/**
 * Dynamic rows for ticket tiers, buyer questions (max 3) and promo codes. Serialises to the hidden inputs
 * `tiers`, `questions` and `coupons` that the surrounding <form> posts. Layout inferred — the legacy organiser portal was not observable.
 */
import { computed, reactive } from "vue";

interface Tier { id?: number; name: string; price: string | number; capacity: string | number | null; sold?: number }
interface Question { label: string; is_required: boolean }
interface Coupon { code: string; discount_type: "percent" | "fixed"; discount_value: string | number; max_uses: string | number | null; valid_until: string | null; uses?: number }

const props = defineProps<{ tiers?: Tier[]; questions?: Question[]; coupons?: Coupon[] }>();

const tiers = reactive<Tier[]>((props.tiers?.length ? props.tiers : [{ name: "General Admission", price: "", capacity: "" }]).map((t) => ({ ...t, capacity: t.capacity ?? "" })));
const questions = reactive<Question[]>((props.questions ?? []).map((x) => ({ ...x })));
const coupons = reactive<Coupon[]>((props.coupons ?? []).map((c) => ({ ...c, max_uses: c.max_uses ?? "", valid_until: c.valid_until ?? "" })));

const blank = (v: unknown) => v === "" || v === null || v === undefined;
const tiersJson = computed(() => JSON.stringify(tiers.map((t) => ({
  ...(t.id ? { id: t.id } : {}), name: t.name, ...(blank(t.price) ? {} : { price: Number(t.price) }), ...(blank(t.capacity) ? {} : { capacity: Number(t.capacity) }),
}))));
const questionsJson = computed(() => JSON.stringify(questions.filter((x) => x.label.trim()).map((x) => ({ label: x.label, is_required: x.is_required }))));
const couponsJson = computed(() => JSON.stringify(coupons.filter((c) => c.code.trim()).map((c) => ({
  code: c.code, discount_type: c.discount_type, discount_value: Number(c.discount_value),
  ...(blank(c.max_uses) ? {} : { max_uses: Number(c.max_uses) }), ...(c.valid_until ? { valid_until: c.valid_until } : {}),
}))));

const locked = (t: Tier) => (t.sold ?? 0) > 0;
const addTier = (name = "") => { if (tiers.length < 10) tiers.push({ name, price: "", capacity: "" }); };
const removeTier = (i: number) => { if (tiers.length > 1 && !locked(tiers[i]!)) tiers.splice(i, 1); };
</script>

<template>
  <div>
    <input type="hidden" name="tiers" :value="tiersJson" />
    <input type="hidden" name="questions" :value="questionsJson" />
    <input type="hidden" name="coupons" :value="couponsJson" />

    <div class="editor-block">
      <div class="editor-head">
        <h4>🎟 Ticket tiers</h4>
        <div class="organizer-action-btns">
          <button type="button" class="btn btn-outline btn-sm" :disabled="tiers.length >= 10" @click="addTier('Early Bird')">+ Early Bird</button>
          <button type="button" class="btn btn-outline btn-sm" :disabled="tiers.length >= 10" @click="addTier('VIP')">+ VIP</button>
          <button type="button" class="btn btn-outline btn-sm" :disabled="tiers.length >= 10" @click="addTier('Group')">+ Group</button>
          <button type="button" class="btn btn-outline btn-sm" :disabled="tiers.length >= 10" @click="addTier()">+ Tier</button>
        </div>
      </div>
      <p class="org-note" style="margin-bottom:0.75rem">Set the price to 0 for a free RSVP tier. Leave capacity empty for unlimited. Tiers with sales can't be removed or re-priced.</p>
      <div v-for="(t, i) in tiers" :key="i" class="tier-row">
        <input class="form-input grow" v-model="t.name" placeholder="Tier name" maxlength="80" aria-label="Tier name" />
        <input class="form-input w-sm" v-model="t.price" type="number" min="0" step="0.01" placeholder="Price ₹" :readonly="locked(t)" aria-label="Price in rupees" />
        <input class="form-input w-sm" v-model="t.capacity" type="number" min="1" step="1" placeholder="Capacity" aria-label="Capacity" />
        <span v-if="locked(t)" class="row-locked">{{ t.sold }} sold</span>
        <button v-else type="button" class="row-remove" :disabled="tiers.length <= 1" aria-label="Remove tier" @click="removeTier(i)">✕</button>
      </div>
    </div>

    <div class="editor-block">
      <div class="editor-head">
        <h4>❓ Questions for buyers <span class="text-muted text-small">(up to 3)</span></h4>
        <button type="button" class="btn btn-outline btn-sm" :disabled="questions.length >= 3" @click="questions.push({ label: '', is_required: true })">+ Question</button>
      </div>
      <div v-for="(x, i) in questions" :key="i" class="question-row">
        <input class="form-input grow" v-model="x.label" maxlength="200" placeholder="e.g. T-shirt size?" aria-label="Question" />
        <label class="req-toggle"><input type="checkbox" v-model="x.is_required" /> Required</label>
        <button type="button" class="row-remove" aria-label="Remove question" @click="questions.splice(i, 1)">✕</button>
      </div>
      <p v-if="!questions.length" class="org-note">No custom questions. Buyers are asked for their name and contact details only.</p>
    </div>

    <div class="editor-block">
      <div class="editor-head">
        <h4>🏷 Promo codes</h4>
        <button type="button" class="btn btn-outline btn-sm" :disabled="coupons.length >= 20" @click="coupons.push({ code: '', discount_type: 'percent', discount_value: '', max_uses: '', valid_until: '' })">+ Promo code</button>
      </div>
      <div v-for="(c, i) in coupons" :key="i" class="coupon-row">
        <input class="form-input grow" v-model="c.code" maxlength="30" placeholder="CODE" style="text-transform:uppercase" aria-label="Promo code" />
        <select class="form-input w-md" v-model="c.discount_type" aria-label="Discount type">
          <option value="percent">% off</option>
          <option value="fixed">₹ off (flat)</option>
        </select>
        <input class="form-input w-sm" v-model="c.discount_value" type="number" min="0.01" step="0.01" :max="c.discount_type === 'percent' ? 100 : undefined" placeholder="Value" aria-label="Discount value" />
        <input class="form-input w-sm" v-model="c.max_uses" type="number" min="1" step="1" placeholder="Max uses" aria-label="Maximum uses" />
        <input class="form-input w-md" v-model="c.valid_until" type="date" aria-label="Valid until" />
        <button type="button" class="row-remove" aria-label="Remove promo code" @click="coupons.splice(i, 1)">✕</button>
      </div>
      <p v-if="!coupons.length" class="org-note">No promo codes. Add one to offer a percentage or flat ₹ discount.</p>
    </div>
  </div>
</template>
