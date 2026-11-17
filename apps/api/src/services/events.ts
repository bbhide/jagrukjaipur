import { q, one } from "../db.js";
import { displayDate, occursOn, todayIST, weekendRange, type Recurrence } from "../lib/dates.js";

export interface CategoryRef { name: string; slug: string; icon: string; color: string }

export interface EventCard extends Recurrence {
  id: number;
  title: string;
  slug: string;
  short_description: string | null;
  event_time: string | null;
  end_time: string | null;
  display_date: string;
  image_path: string | null;
  thumb_path: string | null;
  is_free: boolean;
  ticket_url: string | null;
  button_text: string;
  ticket_price: string | null;
  is_featured: boolean;
  is_exclusive: boolean;
  has_ticketing: boolean;
  status: string;
  views: number;
  interests: number;
  venue_name: string | null;
  venue_area: string | null;
  venue_slug: string | null;
  categories: CategoryRef[];
}

const CARD_SELECT = `
  SELECT e.id, e.title, e.slug, e.short_description, e.event_date, e.event_time, e.end_date, e.end_time,
         e.image_path, e.thumb_path, e.is_free, e.ticket_url, e.button_text, e.ticket_price,
         e.is_featured, e.is_exclusive, e.is_recurring, e.recurrence_type, e.recurrence_days, e.recurrence_day_of_month,
         e.has_ticketing, e.status, e.views, e.interests, e.organizer_id,
         v.name AS venue_name, v.area AS venue_area, v.slug AS venue_slug,
         COALESCE((
           SELECT json_agg(json_build_object('name', c.name, 'slug', c.slug, 'icon', c.icon, 'color', c.color) ORDER BY ec.position, c.id)
           FROM event_categories ec JOIN categories c ON c.id = ec.category_id AND c.is_active
           WHERE ec.event_id = e.id
         ), '[]'::json) AS categories
  FROM events e
  LEFT JOIN venues v ON v.id = e.venue_id`;

/** Publicly visible and not yet over. Cancelled events stay listed (with a badge) until their date passes. */
const LIVE = `e.status IN ('published','cancelled') AND e.approval_status = 'approved' AND COALESCE(e.end_date, e.event_date) >= $1::date`;

export type Scope = "upcoming" | "today" | "weekend" | "trending";

export interface ListOptions {
  scope?: Scope;
  category?: string;
  free?: boolean;
  organizerId?: number;
  venueId?: number;
  page?: number;
  perPage?: number;
  today?: string;
}

/**
 * The upcoming set is small (tens to low hundreds of rows), and recurring events need their next
 * occurrence computed before they can be ordered, so ordering and paging happen in memory.
 */
export async function listEvents(opts: ListOptions = {}) {
  const today = opts.today ?? todayIST();
  const params: unknown[] = [today];
  let where = LIVE;
  if (opts.category) { params.push(opts.category); where += ` AND EXISTS (SELECT 1 FROM event_categories ec JOIN categories c ON c.id = ec.category_id WHERE ec.event_id = e.id AND c.slug = $${params.length})`; }
  if (opts.free) where += ` AND e.is_free`;
  if (opts.organizerId) { params.push(opts.organizerId); where += ` AND e.organizer_id = $${params.length}`; }

  if (opts.venueId) { params.push(opts.venueId); where += ` AND e.venue_id = $${params.length}`; }

  let rows = await q<EventCard>(`${CARD_SELECT} WHERE ${where} LIMIT 1000`, params);
  rows.forEach((e) => (e.display_date = displayDate(e, today)));

  const scope = opts.scope ?? "upcoming";
  if (scope === "today") rows = rows.filter((e) => occursOn(e, today));
  if (scope === "weekend") {
    const w = weekendRange(today);
    // The weekend is Saturday–Sunday; a multi-day event that started on Friday still counts, a Friday-only one does not.
    rows = rows.filter((e) => occursOn(e, w.saturday) || occursOn(e, w.sunday));
  }

  const byDate = (a: EventCard, b: EventCard) =>
    a.display_date.localeCompare(b.display_date) || (a.event_time ?? "").localeCompare(b.event_time ?? "") || a.id - b.id;
  rows.sort(scope === "trending" ? (a, b) => b.interests - a.interests || b.views - a.views || byDate(a, b) : byDate);

  const total = rows.length;
  const perPage = Math.min(Math.max(opts.perPage ?? 12, 1), 200);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(opts.page ?? 1, 1), pages);
  return { items: rows.slice((page - 1) * perPage, page * perPage), total, page, pages, per_page: perPage, has_more: page < pages };
}

export async function filterBar(today = todayIST()) {
  const [totals] = await q<{ total: number; free: number }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE e.is_free) AS free FROM events e WHERE ${LIVE}`, [today]);
  const categories = await q<CategoryRef & { count: number }>(
    `SELECT c.name, c.slug, c.icon, c.color, count(e.id) AS count
     FROM categories c
     JOIN event_categories ec ON ec.category_id = c.id
     JOIN events e ON e.id = ec.event_id AND ${LIVE}
     WHERE c.is_active AND NOT c.is_system
     GROUP BY c.id ORDER BY count(e.id) DESC, c.sort_order, c.id`, [today]);
  return { total: totals?.total ?? 0, free: totals?.free ?? 0, categories };
}

export async function getEventBySlug(slug: string) {
  const event = await one<any>(
    `SELECT e.*, v.name AS venue_name, v.area AS venue_area, v.slug AS venue_slug, v.address AS venue_address, v.maps_url AS venue_maps_url,
            o.name AS organizer_name, o.slug AS organizer_slug, o.contact AS organizer_contact, o.is_community AS organizer_is_community,
            o.commission_rate, o.absorption_mode, o.ticketing_enabled,
            COALESCE((SELECT json_agg(json_build_object('name', c.name, 'slug', c.slug, 'icon', c.icon, 'color', c.color) ORDER BY ec.position, c.id)
                      FROM event_categories ec JOIN categories c ON c.id = ec.category_id WHERE ec.event_id = e.id), '[]'::json) AS categories
     FROM events e
     LEFT JOIN venues v ON v.id = e.venue_id
     LEFT JOIN organizers o ON o.id = e.organizer_id
     WHERE e.slug = $1 AND e.status <> 'draft' AND e.approval_status = 'approved'`, [slug]);
  if (!event) return null;
  event.display_date = displayDate(event, todayIST());
  if (event.has_ticketing) {
    event.tiers = await q(`SELECT id, name, price, capacity, sold FROM ticket_tiers WHERE event_id = $1 ORDER BY sort_order, id`, [event.id]);
    event.questions = await q(`SELECT id, label, is_required FROM event_questions WHERE event_id = $1 ORDER BY sort_order, id`, [event.id]);
    event.has_coupons = !!(await one(`SELECT 1 FROM coupons WHERE event_id = $1 AND is_active LIMIT 1`, [event.id]));
  } else {
    event.tiers = []; event.questions = []; event.has_coupons = false;
  }
  return event;
}

/** One view per request; the per-day table feeds the admin analytics charts. */
export async function recordView(eventId: number) {
  await q(`UPDATE events SET views = views + 1 WHERE id = $1`, [eventId]);
  await q(`INSERT INTO event_daily_views (event_id, day, views) VALUES ($1, (now() AT TIME ZONE 'Asia/Kolkata')::date, 1)
           ON CONFLICT (event_id, day) DO UPDATE SET views = event_daily_views.views + 1`, [eventId]);
}

export async function searchEvents(term: string, today = todayIST()) {
  const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const rows = await q<EventCard>(
    `${CARD_SELECT}
     WHERE ${LIVE} AND (e.title ILIKE $2 OR e.short_description ILIKE $2 OR v.name ILIKE $2 OR v.area ILIKE $2
        OR EXISTS (SELECT 1 FROM event_categories ec JOIN categories c ON c.id = ec.category_id WHERE ec.event_id = e.id AND c.name ILIKE $2))
     ORDER BY similarity(e.title, $3) DESC, e.event_date LIMIT 60`, [today, like, term]);
  rows.forEach((e) => (e.display_date = displayDate(e, today)));
  return rows;
}

/** Events that have already finished, newest first. Used by the "Past Events" sections of organiser and venue pages. */
export async function listPastEvents(opts: { organizerId?: number; venueId?: number; limit?: number; today?: string } = {}) {
  const today = opts.today ?? todayIST();
  const params: unknown[] = [today];
  let where = `e.status IN ('published','past') AND e.approval_status = 'approved' AND COALESCE(e.end_date, e.event_date) < $1::date`;
  if (opts.organizerId) { params.push(opts.organizerId); where += ` AND e.organizer_id = $${params.length}`; }
  if (opts.venueId) { params.push(opts.venueId); where += ` AND e.venue_id = $${params.length}`; }
  params.push(Math.min(Math.max(opts.limit ?? 12, 1), 100));
  const rows = await q<EventCard>(
    `${CARD_SELECT} WHERE ${where} ORDER BY COALESCE(e.end_date, e.event_date) DESC, e.event_time DESC NULLS LAST, e.id DESC LIMIT $${params.length}`, params);
  rows.forEach((e) => (e.display_date = (e as any).event_date));
  return rows;
}
