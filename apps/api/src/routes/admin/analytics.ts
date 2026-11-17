/** Admin analytics. All day boundaries are Asia/Kolkata (the pool's session timezone). */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../../db.js";
import { badRequest } from "../../lib/errors.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD.");
const query = z.object({
  range: z.enum(["today", "yesterday", "7days", "30days", "custom"]).default("7days"),
  start: date.optional(),
  end: date.optional(),
});

const IST_DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;

export default async function analyticsRoutes(app: FastifyInstance) {
  app.get("/analytics", async (req) => {
    const { range, start, end } = query.parse(req.query);
    let s: string, e: string;
    if (range === "custom") {
      if (!start || !end) throw badRequest("Choose both a start and an end date.");
      s = start; e = end;
    } else {
      const off = { today: [0, 0], yesterday: [1, 1], "7days": [6, 0], "30days": [29, 0] }[range]!;
      const r = await one<{ s: string; e: string }>(`SELECT (current_date - $1::int)::text AS s, (current_date - $2::int)::text AS e`, off);
      s = r!.s; e = r!.e;
    }
    if (s > e) throw badRequest("The start date must not be after the end date.");
    const days = await one<{ n: number }>(`SELECT ($2::date - $1::date + 1) AS n`, [s, e]);
    if (days!.n > 366) throw badRequest("Please choose a range of at most 366 days.");
    const p = [s, e];

    const [stats] = await q(
      `SELECT
        (SELECT count(*) FROM users WHERE ${IST_DAY("created_at")} BETWEEN $1 AND $2) AS new_users,
        (SELECT count(*) FROM otp_requests WHERE ${IST_DAY("created_at")} BETWEEN $1 AND $2) AS otps_sent,
        (SELECT COALESCE(sum(views),0) FROM event_daily_views WHERE day BETWEEN $1 AND $2) AS event_views,
        (SELECT count(*) FROM events WHERE ${IST_DAY("created_at")} BETWEEN $1 AND $2) AS events_added,
        (SELECT count(*) FROM events WHERE COALESCE(end_date, event_date) BETWEEN $1 AND $2) AS events_ended,
        (SELECT count(*) FROM submissions WHERE kind='event' AND ${IST_DAY("created_at")} BETWEEN $1 AND $2) AS event_submissions,
        (SELECT count(*) FROM submissions WHERE kind='community' AND ${IST_DAY("created_at")} BETWEEN $1 AND $2) AS community_submissions`, p);

    const series = (sql: string) => q(sql, p);
    const views = await series(
      `SELECT d::date::text AS day, COALESCE(v.n,0)::int AS views
         FROM generate_series($1::date, $2::date, '1 day') d
         LEFT JOIN (SELECT day, sum(views) AS n FROM event_daily_views WHERE day BETWEEN $1 AND $2 GROUP BY day) v ON v.day = d::date
        ORDER BY d`);
    const registrations = await series(
      `SELECT d::date::text AS day, COALESCE(u.n,0)::int AS registrations
         FROM generate_series($1::date, $2::date, '1 day') d
         LEFT JOIN (SELECT ${IST_DAY("created_at")} AS day, count(*) AS n FROM users WHERE ${IST_DAY("created_at")} BETWEEN $1 AND $2 GROUP BY 1) u ON u.day = d::date
        ORDER BY d`);
    const submissions = await series(
      `SELECT d::date::text AS day, COALESCE(s.events,0)::int AS events, COALESCE(s.communities,0)::int AS communities
         FROM generate_series($1::date, $2::date, '1 day') d
         LEFT JOIN (SELECT ${IST_DAY("created_at")} AS day, count(*) FILTER (WHERE kind='event') AS events, count(*) FILTER (WHERE kind='community') AS communities
                      FROM submissions WHERE ${IST_DAY("created_at")} BETWEEN $1 AND $2 GROUP BY 1) s ON s.day = d::date
        ORDER BY d`);

    const most_viewed_events = await q(
      `SELECT e.id, e.title, e.slug, sum(v.views)::int AS views FROM event_daily_views v JOIN events e ON e.id = v.event_id
        WHERE v.day BETWEEN $1 AND $2 GROUP BY e.id HAVING sum(v.views) > 0 ORDER BY views DESC, e.title LIMIT 10`, p);
    const top_categories = await q(
      `SELECT c.id, c.name, c.icon, sum(v.views)::int AS engagement FROM event_daily_views v
         JOIN event_categories ec ON ec.event_id = v.event_id JOIN categories c ON c.id = ec.category_id
        WHERE v.day BETWEEN $1 AND $2 AND NOT c.is_system GROUP BY c.id HAVING sum(v.views) > 0 ORDER BY engagement DESC, c.name LIMIT 10`, p);
    const top_otp_pages = await q(
      `SELECT COALESCE(NULLIF(source_page,''),'(unknown)') AS source_page, count(*)::int AS otps FROM otp_requests
        WHERE ${IST_DAY("created_at")} BETWEEN $1 AND $2 GROUP BY 1 ORDER BY otps DESC, 1 LIMIT 10`, p);
    const top_otp_buttons = await q(
      `SELECT COALESCE(NULLIF(source_button,''),'(unknown)') AS source_button, count(*)::int AS otps FROM otp_requests
        WHERE ${IST_DAY("created_at")} BETWEEN $1 AND $2 GROUP BY 1 ORDER BY otps DESC, 1 LIMIT 10`, p);
    const recent_otp_logs = await q(
      `SELECT whatsapp_number AS number, source_page, source_button, created_at, status FROM otp_requests ORDER BY created_at DESC, id DESC LIMIT 50`);

    return { range, start: s, end: e, stats, views, registrations, submissions, most_viewed_events, top_categories, top_otp_pages, top_otp_buttons, recent_otp_logs };
  });
}
