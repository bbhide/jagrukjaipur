import type { FastifyInstance } from "fastify";
import { one, q } from "../../db.js";
import { addDays, todayIST } from "../../lib/dates.js";

export default async function (app: FastifyInstance) {
  app.get("/dashboard", async () => {
    const today = todayIST();
    const stats = await one(
      `SELECT count(*)::int AS total_events,
              count(*) FILTER (WHERE status = 'published')::int AS published,
              count(*) FILTER (WHERE status = 'published' AND COALESCE(end_date, event_date) >= $1::date)::int AS upcoming,
              COALESCE(sum(views), 0)::int AS total_views,
              count(*) FILTER (WHERE is_featured AND status = 'published' AND COALESCE(end_date, event_date) >= $1::date)::int AS featured_active,
              (SELECT count(*)::int FROM venues) AS venues
       FROM events`, [today]);
    const cols = `e.id, e.title, e.slug, e.event_date, e.event_time, e.end_date, e.status, e.views, v.name AS venue_name`;
    const recent_events = await q(`SELECT ${cols} FROM events e LEFT JOIN venues v ON v.id = e.venue_id ORDER BY e.created_at DESC, e.id DESC LIMIT 10`);
    const this_week = await q(
      `SELECT ${cols} FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.status = 'published' AND e.event_date BETWEEN $1::date AND $2::date
       ORDER BY e.event_date, e.event_time NULLS LAST, e.id`, [today, addDays(today, 7)]);
    return { stats, recent_events, this_week };
  });
}
