import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { todayIST, weekendRange } from "../lib/dates.js";
import { getUser, requireUser } from "../lib/session.js";
import { filterBar, getEventBySlug, listEvents, listPastEvents, recordView, searchEvents } from "../services/events.js";

const listQuery = z.object({
  scope: z.enum(["upcoming", "today", "weekend", "trending"]).default("upcoming"),
  category: z.string().max(80).optional(),
  free: z.enum(["1", "0", "true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(12),
});

const applicationBody = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, "Please enter a valid 10-digit mobile number."),
  email: z.email("Please enter a valid email address.").max(160),
  designation: z.string().trim().max(160).optional(),
  topic: z.string().trim().min(5, "Please describe your topic.").max(300),
  bio: z.string().trim().min(20, "Please tell us a little more about yourself.").max(4000),
  /** Honeypot: real users never fill this. */
  website_url: z.string().optional(),
});

const ORG_PUBLIC = `o.id, o.name, o.slug, o.is_community, o.logo_path, o.about, o.special, o.features`;
const ORG_CATS = `COALESCE((SELECT json_agg(json_build_object('name', c.name, 'slug', c.slug, 'icon', c.icon, 'color', c.color) ORDER BY oc.position, c.id)
  FROM organizer_categories oc JOIN categories c ON c.id = oc.category_id WHERE oc.organizer_id = o.id), '[]'::json) AS categories`;

export default async function publicRoutes(app: FastifyInstance) {
  /** Everything the shared chrome needs: filter bar counts and the calendar context. */
  app.get("/site", async () => {
    const today = todayIST();
    return { today, weekend: weekendRange(today), filters: await filterBar(today) };
  });

  app.get("/events", async (req) => {
    const p = listQuery.parse(req.query);
    return listEvents({ scope: p.scope, category: p.category, free: p.free === "1" || p.free === "true", page: p.page, perPage: p.per_page });
  });

  app.get("/events/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const event = await getEventBySlug(slug);
    if (!event) throw notFound("Event not found.");
    // The organiser's contact line is public on event pages (as on the legacy site); it is gated only on community profiles.
    if ((req.query as any).track === "1") await recordView(event.id);
    return { event };
  });

  /** Logged-in visitor opened an event or its ticket link — feeds the public "Interests" counter. */
  app.post("/events/:slug/interest", async (req) => {
    const user = await requireUser(req);
    const { slug } = req.params as { slug: string };
    const ev = await one<{ id: number }>(`SELECT id FROM events WHERE slug = $1`, [slug]);
    if (!ev) throw notFound("Event not found.");
    const inserted = await q(`INSERT INTO event_interests (user_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id`, [user.id, ev.id]);
    if (inserted.length) await q(`UPDATE events SET interests = interests + 1 WHERE id = $1`, [ev.id]);
    return { success: true };
  });

  app.get("/categories", async () => ({
    categories: await q(`SELECT name, slug, icon, color FROM categories WHERE is_active AND NOT is_system ORDER BY sort_order, id`),
  }));

  app.get("/categories/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const category = await one(`SELECT name, slug, icon, color FROM categories WHERE slug = $1 AND is_active AND NOT is_system`, [slug]);
    if (!category) throw notFound("Category not found.");
    return { category };
  });

  app.get("/organizers", async (req) => {
    const communityOnly = (req.query as any).community !== "0";
    const organizers = await q<any>(
      `SELECT ${ORG_PUBLIC}, o.contact, ${ORG_CATS} FROM organizers o
       WHERE o.is_active AND o.approval_status = 'approved' ${communityOnly ? "AND o.is_community" : ""} ORDER BY o.name`);
    // Phone numbers are for logged-in visitors only; everyone else just learns that one exists.
    const user = await getUser(req);
    for (const o of organizers) { o.has_contact = !!o.contact; if (!user) o.contact = null; }
    return { organizers };
  });

  app.get("/organizers/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const organizer = await one<any>(
      `SELECT ${ORG_PUBLIC}, o.contact, o.social_instagram, o.social_facebook, o.social_twitter, o.social_whatsapp, o.social_website, ${ORG_CATS}
       FROM organizers o WHERE o.slug = $1 AND o.is_active AND o.approval_status = 'approved'`, [slug]);
    if (!organizer) throw notFound("Organiser not found.");
    const user = await getUser(req);
    organizer.has_contact = !!(organizer.contact || organizer.social_instagram || organizer.social_facebook || organizer.social_twitter || organizer.social_whatsapp || organizer.social_website);
    // Which links exist is public (so gated icons can be shown); the links themselves are not.
    organizer.social_available = ["instagram", "facebook", "twitter", "whatsapp", "website"].filter((k) => organizer[`social_${k}`]);
    if (!user) for (const k of ["contact", "social_instagram", "social_facebook", "social_twitter", "social_whatsapp", "social_website"]) organizer[k] = null;
    const events = await listEvents({ organizerId: organizer.id, perPage: 100 });
    const past_events = await listPastEvents({ organizerId: organizer.id });
    return { organizer, events: events.items, past_events };
  });

  app.get("/venues/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const venue = await one<any>(`SELECT id, name, slug, area, address, maps_url FROM venues WHERE slug = $1 AND is_active`, [slug]);
    if (!venue) throw notFound("Venue not found.");
    const { id, ...pub } = venue;
    const [events, past_events] = await Promise.all([listEvents({ venueId: id, perPage: 200 }), listPastEvents({ venueId: id })]);
    return { venue: pub, events: events.items, past_events };
  });

  app.get("/podcast", async () => {
    const episodes = await q(`SELECT id, episode_number, title, youtube_id, youtube_url, guest_name, guest_title, category, description, release_date
                              FROM podcast_episodes WHERE is_active ORDER BY episode_number DESC`);
    const guests = await q(`SELECT id, name, designation, bio, photo_path, socials FROM podcast_guests ORDER BY sort_order, id`);
    return { episodes, guests, featured: episodes[0] ?? null };
  });

  app.post("/podcast/applications", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req) => {
    const b = applicationBody.parse(req.body);
    if (b.website_url) return { success: true }; // bot: accept silently, store nothing
    await q(`INSERT INTO podcast_applications (name, phone, email, designation, topic, bio) VALUES ($1,$2,$3,$4,$5,$6)`,
      [b.name, b.phone, b.email, b.designation || null, b.topic, b.bio]);
    return { success: true };
  });

  /** Search is a members-only feature on the reference site. */
  app.get("/search", async (req) => {
    await requireUser(req);
    const term = String((req.query as any).q ?? "").trim().slice(0, 80);
    if (term.length < 2) throw badRequest("Type at least 2 characters to search.");
    const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const [events, communities] = await Promise.all([
      searchEvents(term),
      q(`SELECT ${ORG_PUBLIC}, ${ORG_CATS} FROM organizers o
         WHERE o.is_active AND o.is_community AND o.approval_status = 'approved' AND (o.name ILIKE $1 OR o.about ILIKE $1) ORDER BY o.name LIMIT 30`, [like]),
    ]);
    return { q: term, events, communities };
  });

  /** Public submissions ("Submit your community") land in the admin queue. */
  app.post("/submissions", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    const user = await requireUser(req);
    const b = z.object({ kind: z.enum(["event", "community"]), payload: z.record(z.string(), z.any()) }).parse(req.body);
    if (JSON.stringify(b.payload).length > 20000) throw badRequest("Submission is too large.");
    await q(`INSERT INTO submissions (kind, user_id, payload) VALUES ($1,$2,$3)`, [b.kind, user.id, JSON.stringify(b.payload)]);
    return { success: true };
  });

  app.get("/sitemap", async () => {
    const today = todayIST();
    const events = await q(`SELECT slug, updated_at FROM events e WHERE e.status = 'published' AND e.approval_status = 'approved' AND COALESCE(e.end_date, e.event_date) >= $1::date ORDER BY e.event_date`, [today]);
    const categories = await q(`SELECT slug FROM categories WHERE is_active AND NOT is_system ORDER BY sort_order, id`);
    const organizers = await q(`SELECT slug FROM organizers WHERE is_active AND is_community AND approval_status = 'approved' ORDER BY name`);
    const venues = await q(`SELECT v.slug FROM venues v WHERE v.is_active AND EXISTS (
      SELECT 1 FROM events e WHERE e.venue_id = v.id AND e.status IN ('published','cancelled') AND e.approval_status = 'approved' AND COALESCE(e.end_date, e.event_date) >= $1::date)
      ORDER BY v.name`, [today]);
    return { events, categories, organizers, venues };
  });
}
