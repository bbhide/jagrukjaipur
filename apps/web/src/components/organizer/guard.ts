/** Shared plumbing for the organiser portal pages. Layout inferred — the legacy organiser portal was not observable (see docs/01-reconnaissance.md §6). */
import type { AstroGlobal } from "astro";
import { api, ApiError } from "@/lib/api";
import { loadShell } from "@/lib/page";
import type { Me, SiteData } from "@/lib/types";

export interface BankOnFile { account_holder: string; account_number_masked: string; ifsc: string; bank_name: string }
export interface OrganizerMe {
  id: number; name: string; slug: string; contact: string | null; about: string | null; email: string | null; gstin: string | null; state: string | null;
  commission_rate: number; absorption_mode: string; ticketing_enabled: boolean; approval_status: string; bank: BankOnFile | null;
}

export interface Portal { siteData: SiteData; me: Me | null; organizer: OrganizerMe | null; redirect: Response | null }

/**
 * Loads the site shell, the visitor and their organiser row. Portal pages are never cached or indexed.
 * With `needOrganizer` (default) a logged-in visitor without an organiser row is sent to /organizer to register.
 */
export async function loadPortal(Astro: AstroGlobal, needOrganizer = true): Promise<Portal> {
  Astro.response.headers.set("Cache-Control", "no-store");
  Astro.response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const { siteData, me } = await loadShell(Astro);
  let organizer: OrganizerMe | null = null;
  if (me) {
    try { organizer = (await api<{ organizer: OrganizerMe | null }>("/organizer/me", { request: Astro.request })).organizer; }
    catch (e) { if (!(e instanceof ApiError && e.status === 401)) throw e; return { siteData, me: null, organizer: null, redirect: null }; }
  }
  const redirect = me && !organizer && needOrganizer ? Astro.redirect("/organizer", 302) : null;
  return { siteData, me, organizer, redirect };
}

/** A failed API call on a portal page: lost session or missing record sends the visitor back; anything else is a real error. */
export function portalFail(Astro: AstroGlobal, e: unknown): Response {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return Astro.redirect("/organizer", 302);
    if (e.status === 404) return Astro.redirect("/organizer/dashboard", 302);
  }
  throw e;
}

export const formValues = (form: FormData): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !(k in out)) out[k] = v;
  return out;
};

export const rupees = (n: number | string) => `₹ ${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

/** Turns the posted profile form into the API body. */
export function profileBody(f: Record<string, string>) {
  return {
    name: f.name, email: f.email, contact: f.contact, state: f.state, gstin: f.gstin, about: f.about,
    bank: { account_holder: f.bank_account_holder ?? "", account_number: f.bank_account_number ?? "", ifsc: f.bank_ifsc ?? "", bank_name: f.bank_name ?? "" },
  };
}

// ─── Event form helpers ───────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The portal edits descriptions as plain text; blank lines become paragraphs, single newlines become <br>. */
export const textToHtml = (t: string) => t.trim().split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
export const htmlToText = (h: string | null | undefined) => (h ?? "")
  .replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(li|h[2-4]|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();

/** Re-packs the posted event form for the API (same fields; description converted to HTML). */
export function eventFormData(form: FormData): FormData {
  const out = new FormData();
  for (const [k, v] of form.entries()) {
    if (k === "description" && typeof v === "string") out.append(k, textToHtml(v));
    else if (k === "image" && v instanceof File && v.size === 0) continue;
    else out.append(k, v);
  }
  return out;
}

export interface FormOptions { categories: { id: number; name: string; icon: string }[]; venues: { id: number; name: string; area: string | null }[] }

/** Values for the form from an API event (edit page). */
export function valuesFromEvent(ev: any): Record<string, string> {
  const t = (s: string | null) => (s ?? "").slice(0, 5);
  return {
    title: ev.title ?? "", short_description: ev.short_description ?? "", description: htmlToText(ev.description), event_date: ev.event_date ?? "", event_time: t(ev.event_time),
    end_date: ev.end_date ?? "", end_time: t(ev.end_time), venue_id: ev.venue_id ? String(ev.venue_id) : "", listing_type: ev.listing_type, ticket_url: ev.ticket_url ?? "",
  };
}
