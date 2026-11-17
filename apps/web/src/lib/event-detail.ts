/** Types and pure helpers for the event detail page (kept out of the .astro file so they can be reused and checked). */
import type { EventCardData } from "./types";
import { dateFull, dateLong, dateShort, shareText, site, time12 } from "./format";

export interface Tier { id: number; name: string; price: number; capacity: number | null; sold: number }
export interface Question { id: number; label: string; is_required: boolean }
export type Absorption = "organiser" | "customer" | "split";

export interface EventDetail extends EventCardData {
  description: string | null;
  venue_address: string | null;
  venue_maps_url: string | null;
  organizer_name: string | null;
  organizer_slug: string | null;
  organizer_contact: string | null;
  commission_rate: number | null;
  absorption_mode: Absorption | null;
  ticketing_enabled: boolean | null;
  tiers: Tier[];
  questions: Question[];
  has_coupons: boolean;
  created_at: string;
  is_recurring?: boolean;
  recurrence_type?: string | null;
  recurrence_days?: number[] | null;
  recurrence_day_of_month?: number | null;
}

/** "₹ 149" / "149" / "₹149" all become "149"; text such as "Registration" is kept as is. */
const bare = (p: string) => p.replace(/^\s*₹\s*/, "").trim();
export const rupee = (p: string) => `₹${bare(p)}`;

const weekdayOf = (d: string) => dateFull(d).split(",")[0]!;
/** "Friday 2 October 2026" */
const longWithWeekday = (d: string) => `${weekdayOf(d)} ${dateLong(d)}`;

/** `<title>` as on the legacy site: "{title} in Jaipur | {d Mon} | {price} | Jagruk Jaipur". */
export function seoTitle(e: EventDetail): string {
  const d = new Date(`${e.event_date}T00:00:00Z`);
  const short = `${d.getUTCDate()} ${dateShort(e.event_date).split(" ")[1]}`;
  const base = /jaipur/i.test(e.title) ? e.title : `${e.title} in Jaipur`;
  const price = e.is_free ? "Free" : e.ticket_price ? rupee(e.ticket_price) : null;
  return [base, short, price, site.name].filter(Boolean).join(" | ");
}

/** Date line in the meta row: "16 Nov 2026 · 11:00 AM – 18 Nov 2026", "02 Oct 2026 – 18 Apr 2027", "07 Feb 2027 · 6:00 PM". */
export function metaDate(e: EventDetail): string {
  let s = dateShort(e.event_date);
  if (e.event_time) s += ` · ${time12(e.event_time)}`;
  if (e.end_date && e.end_date !== e.event_date) s += ` – ${dateShort(e.end_date)}${e.end_time ? ` · ${time12(e.end_time)}` : ""}`;
  else if (e.end_time) s += ` – ${time12(e.end_time)}`;
  return s;
}

/** Price shown in the sidebar, or null when nothing is known. */
export function sidebarPrice(e: EventDetail): { text: string; free: boolean } | null {
  if (e.tiers.length) {
    const prices = e.tiers.map((t) => Number(t.price));
    const min = Math.min(...prices), max = Math.max(...prices);
    if (max === 0) return { text: "🟢 Free Entry", free: true };
    const f = (n: number) => `₹${n.toLocaleString("en-IN")}`;
    return min === max ? { text: f(min), free: false } : { text: min === 0 ? `Free – ${f(max)}` : `${f(min)} – ${f(max)}`, free: false };
  }
  if (e.is_free) return { text: "🟢 Free Entry", free: true };
  if (e.ticket_price) return { text: `₹ ${bare(e.ticket_price)}`, free: false };
  return null;
}

/** The auto-generated FAQs, worded exactly like the legacy page. */
export function faqs(e: EventDetail): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  out.push({ q: `Is ${e.title} confirmed in Jaipur?`, a: `Yes. ${e.title} is listed for ${longWithWeekday(e.event_date)}${e.venue_name ? ` at ${e.venue_name}` : ""}.` });
  out.push({
    q: `What are the ticket prices for ${e.title}?`,
    a: e.is_free ? "Entry is free for this event." : e.ticket_price ? `Tickets start from ${rupee(e.ticket_price)}.` : "Please check the official page for ticket pricing.",
  });
  if (e.venue_name) out.push({ q: `Where is ${e.title} taking place?`, a: `At ${e.venue_name}${e.venue_area ? ` in ${e.venue_area}` : ""}.` });
  if (e.event_time) out.push({ q: `What time does ${e.title} start?`, a: `The event starts at ${time12(e.event_time)} on ${longWithWeekday(e.event_date)}.` });
  return out;
}

const abs = (p: string | null) => (p ? (p.startsWith("http") ? p : `${site.url}${p}`) : undefined);

export function seoDescription(e: EventDetail): string {
  return shareText(e);
}

/** Share links (text layout identical to the legacy buttons). */
export function shareLinks(e: EventDetail, url: string) {
  const title = `${e.title} — ${site.name}`;
  const wa = `${shareText(e)}\n\n${title}\n${url}`;
  return {
    whatsapp: `https://api.whatsapp.com/send?text=${encodeURIComponent(wa).replace(/%20/g, "+")}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title).replace(/%20/g, "+")}&url=${encodeURIComponent(url)}`,
    title,
  };
}

const numericPrice = (p: string) => { const m = bare(p).replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? m[0] : null; };

export function eventJsonLd(e: EventDetail, canonicalUrl: string) {
  const org = e.organizer_name ? { "@type": "Organization", name: e.organizer_name, url: `${site.url}/organizer/${e.organizer_slug}` } : { "@type": "Organization", name: site.name, url: site.url };
  const price = e.is_free ? "0" : e.ticket_price ? numericPrice(e.ticket_price) : "0";
  const ticketed = e.tiers.length ? String(Math.min(...e.tiers.map((t) => Number(t.price)))) : null;
  return {
    "@context": "https://schema.org", "@type": "Event",
    name: e.title,
    description: seoDescription(e),
    image: abs(e.image_path),
    startDate: `${e.event_date}T${e.event_time ?? "00:00:00"}+05:30`,
    endDate: `${e.end_date ?? e.event_date}T${e.end_time ?? "23:59:59"}+05:30`,
    eventStatus: e.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(e.venue_name ? { location: { "@type": "Place", name: e.venue_name, address: { "@type": "PostalAddress", ...(e.venue_area ? { addressLocality: e.venue_area } : {}), ...(e.venue_address ? { streetAddress: e.venue_address } : {}), addressRegion: "RJ", addressCountry: "IN" } } } : {}),
    organizer: org,
    performer: { "@type": "Organization", name: org.name },
    offers: {
      "@type": "Offer",
      ...((ticketed ?? price) !== null ? { price: ticketed ?? price } : {}),
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
      validFrom: new Date(e.created_at).toISOString(),
      url: e.ticket_url ?? canonicalUrl,
    },
  };
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) };
}

export function breadcrumbJsonLd(e: EventDetail, canonicalUrl: string) {
  const cat = e.categories[0];
  const items = [{ name: "Home", url: site.url }, ...(cat ? [{ name: cat.name, url: `${site.url}/category/${cat.slug}` }] : []), { name: e.title, url: canonicalUrl }];
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })) };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
/** "Every Sat & Sun" / "Every month on the 10th" (sidebar recurring line), or null for one-off events. */
export function recurrenceText(e: EventDetail): string | null {
  if (!e.is_recurring) return null;
  if (e.recurrence_type === "monthly" && e.recurrence_day_of_month) return `Every month on the ${ordinal(e.recurrence_day_of_month)}`;
  const days = [...(e.recurrence_days ?? [])].sort((a, b) => a - b).map((d) => DAY[d]).filter(Boolean);
  return days.length ? `Every ${days.join(" & ")}` : null;
}
