import type { EventCardData } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parts = (d: string) => { const [y, m, day] = d.split("-").map(Number); return { y, m: m - 1, day, wd: new Date(Date.UTC(y, m - 1, day)).getUTCDay() }; };
const pad = (n: number) => String(n).padStart(2, "0");

/** 02 Oct 2026 */
export const dateShort = (d: string) => { const p = parts(d); return `${pad(p.day)} ${MONTHS[p.m]} ${p.y}`; };
/** 17 November 2026 */
export const dateLong = (d: string) => { const p = parts(d); return `${p.day} ${MONTHS_LONG[p.m]} ${p.y}`; };
/** Monday, 16 November 2026 */
export const dateFull = (d: string) => `${DAYS[parts(d).wd]}, ${dateLong(d)}`;
/** Friday, 02 Oct 2026 */
export const dateShare = (d: string) => `${DAYS[parts(d).wd]}, ${dateShort(d)}`;
/** 21 November (no year) */
export const dayMonth = (d: string) => { const p = parts(d); return `${p.day} ${MONTHS_LONG[p.m]}`; };
/** 8 Oct 2026 */
export const dateCompact = (d: string) => { const p = parts(d); return `${p.day} ${MONTHS[p.m]} ${p.y}`; };

/** "19:30:00" → 7:30 PM */
export function time12(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

export const cardDate = (e: EventCardData) => `${dateShort(e.display_date)}${e.event_time ? ` · ${time12(e.event_time)}` : ""}`;

export const eventUrl = (slug: string) => `/event/${slug}`;

export function priceLabel(e: Pick<EventCardData, "is_free" | "ticket_price">): string | null {
  if (e.is_free) return "🟢 Free";
  return e.ticket_price ? `🎟 ₹ ${e.ticket_price}` : null;
}

export function truncate(s: string, n: number) { return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s; }

/** Text handed to the Web Share API / clipboard from a card. */
export function shareText(e: EventCardData): string {
  const when = `${dateShare(e.display_date)}${e.event_time ? ` at ${time12(e.event_time)}` : ""}`;
  const where = [e.venue_name, e.venue_area].filter(Boolean).join(", ");
  const price = e.is_free ? "Free Entry" : e.ticket_price ? `Tickets from ₹${e.ticket_price}` : null;
  return [
    "Catch this amazing event! 🎉",
    `📅 ${when}`,
    where ? `📍 ${where}` : null,
    price ? `🎟️ ${price}` : null,
    e.short_description ? truncate(e.short_description, 150) : null,
    "👇 Get your tickets & info here 👇",
  ].filter(Boolean).join("\n");
}

export const site = {
  name: "Jagruk Jaipur",
  url: (import.meta.env.PUBLIC_SITE_URL ?? "https://jagrukjaipur.com").replace(/\/$/, ""),
  whatsapp: import.meta.env.PUBLIC_WHATSAPP_CHANNEL ?? "https://whatsapp.com/channel/0029Vb7sCKPJENy09PC2ln1X",
  instagram: import.meta.env.PUBLIC_INSTAGRAM_URL ?? "https://www.instagram.com/jagrukjaipur",
  youtube: import.meta.env.PUBLIC_YOUTUBE_URL ?? "https://www.youtube.com/@jagrukjaipur",
  clarityId: import.meta.env.PUBLIC_CLARITY_ID ?? "",
  keywords: "Jaipur events, things to do in Jaipur, concerts in Jaipur, comedy shows Jaipur, upcoming events Jaipur, weekend events Jaipur, Jagruk Jaipur",
};
