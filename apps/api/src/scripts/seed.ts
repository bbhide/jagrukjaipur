/**
 * Loads db/seed/*.json (produced by scripts/import-reference.mjs from the legacy site's public pages)
 * and creates the first admin account. Safe to re-run: rows are upserted by slug / natural key.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { one, pool, q, tx } from "../db.js";
import { hashPassword, randomToken } from "../lib/password.js";
import { cleanHtml, slugify } from "../lib/text.js";
import { uniqueVenueSlug } from "../services/venues.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../db/seed");
const load = <T = any>(name: string): T[] => (existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), "utf8")) : []);

export async function seed(log = console.log) {
  await tx(async (c) => {
    const catId = new Map<string, number>();
    for (const cat of load("categories.json")) {
      const r = await one<{ id: number }>(
        `INSERT INTO categories (name, slug, icon, color, sort_order, is_active, is_system) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [cat.name, cat.slug, cat.icon ?? "🎉", cat.color ?? "#7C3AED", cat.sort_order ?? 0, cat.is_active ?? true, cat.is_system ?? false], c);
      catId.set(cat.slug, r!.id);
    }

    const venueId = new Map<string, number>();
    for (const v of load("venues.json")) {
      const existing = await one<{ id: number }>(`SELECT id FROM venues WHERE lower(name) = lower($1)`, [v.name], c);
      const r = existing ?? (await one<{ id: number }>(
        `INSERT INTO venues (name, slug, area, address, maps_url) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [v.name, await uniqueVenueSlug(v.name, c), v.area ?? null, v.address ?? null, v.maps_url ?? null], c));
      venueId.set(v.name.toLowerCase(), r!.id);
    }

    const orgId = new Map<string, number>();
    for (const o of load("organizers.json")) {
      const slug = o.slug ?? slugify(o.name);
      const r = await one<{ id: number }>(
        `INSERT INTO organizers (name, slug, contact, is_community, logo_path, about, special, features,
                                 social_instagram, social_facebook, social_twitter, social_whatsapp, social_website)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, contact = EXCLUDED.contact, is_community = EXCLUDED.is_community,
           logo_path = EXCLUDED.logo_path, about = EXCLUDED.about, special = EXCLUDED.special, features = EXCLUDED.features
         RETURNING id`,
        [o.name, slug, o.contact ?? null, !!o.is_community, o.logo_path ?? null, o.about ?? null, o.special ?? null, JSON.stringify(o.features ?? []),
         o.social_instagram ?? null, o.social_facebook ?? null, o.social_twitter ?? null, o.social_whatsapp ?? null, o.social_website ?? null], c);
      orgId.set(slug, r!.id);
      await q(`DELETE FROM organizer_categories WHERE organizer_id = $1`, [r!.id], c);
      for (const [i, s] of (o.category_slugs ?? []).slice(0, 3).entries()) {
        if (catId.has(s)) await q(`INSERT INTO organizer_categories (organizer_id, category_id, position) VALUES ($1,$2,$3)`, [r!.id, catId.get(s), i], c);
      }
    }

    let events = 0;
    for (const e of load("events.json")) {
      const r = await one<{ id: number }>(
        `INSERT INTO events (title, slug, short_description, description, event_date, event_time, end_date, end_time, organizer_id, venue_id,
                             image_path, thumb_path, is_free, ticket_url, button_text, ticket_price, is_featured, is_exclusive,
                             is_recurring, recurrence_type, recurrence_days, status, views, interests)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, short_description = EXCLUDED.short_description, description = EXCLUDED.description,
           event_date = EXCLUDED.event_date, event_time = EXCLUDED.event_time, end_date = EXCLUDED.end_date, end_time = EXCLUDED.end_time,
           organizer_id = EXCLUDED.organizer_id, venue_id = EXCLUDED.venue_id, image_path = EXCLUDED.image_path, thumb_path = EXCLUDED.thumb_path,
           is_free = EXCLUDED.is_free, ticket_url = EXCLUDED.ticket_url, button_text = EXCLUDED.button_text, ticket_price = EXCLUDED.ticket_price,
           is_exclusive = EXCLUDED.is_exclusive, views = EXCLUDED.views, interests = EXCLUDED.interests
         RETURNING id`,
        [e.title, e.slug, e.short_description ?? null, cleanHtml(e.description), e.event_date, e.event_time ?? null, e.end_date ?? null, e.end_time ?? null,
         e.organizer_slug ? orgId.get(e.organizer_slug) ?? null : null, e.venue_name ? venueId.get(String(e.venue_name).toLowerCase()) ?? null : null,
         e.image_path ?? null, e.thumb_path ?? null, !!e.is_free, e.ticket_url ?? null, e.button_text ?? "Get Tickets", e.ticket_price ?? null,
         !!e.is_featured, !!e.is_exclusive, !!e.is_recurring, e.recurrence_type ?? null, e.recurrence_days ?? [], e.status ?? "published", e.views ?? 0, e.interests ?? 0], c);
      await q(`DELETE FROM event_categories WHERE event_id = $1`, [r!.id], c);
      for (const [i, s] of (e.category_slugs ?? []).slice(0, 3).entries()) {
        if (catId.has(s)) await q(`INSERT INTO event_categories (event_id, category_id, position) VALUES ($1,$2,$3)`, [r!.id, catId.get(s), i], c);
      }
      events++;
    }

    for (const ep of load("podcast_episodes.json")) {
      const exists = await one(`SELECT 1 FROM podcast_episodes WHERE episode_number = $1`, [ep.episode_number], c);
      if (!exists) await q(
        `INSERT INTO podcast_episodes (episode_number, title, youtube_id, youtube_url, guest_name, guest_title, category, description, release_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ep.episode_number, ep.title, ep.youtube_id, ep.youtube_url ?? null, ep.guest_name ?? null, ep.guest_title ?? null, ep.category ?? null, ep.description ?? null, ep.release_date ?? null], c);
    }
    for (const [i, g] of load("podcast_guests.json").entries()) {
      const exists = await one(`SELECT 1 FROM podcast_guests WHERE name = $1`, [g.name], c);
      if (!exists) await q(`INSERT INTO podcast_guests (name, designation, bio, photo_path, socials, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
        [g.name, g.designation ?? null, g.bio ?? null, g.photo_path ?? null, JSON.stringify(g.socials ?? {}), i], c);
    }

    for (const [k, v] of Object.entries({ listing_promo_enabled: "0", admin_notification_emails: "", gemini_model: "gemini-3.5-flash" })) {
      await q(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k, v], c);
    }
    log(`seeded ${catId.size} categories, ${venueId.size} venues, ${orgId.size} organisers, ${events} events`);
  });

  // First admin. The password is taken from ADMIN_PASSWORD, or generated once and printed.
  const username = process.env.ADMIN_USERNAME ?? "admin";
  if (!(await one(`SELECT 1 FROM admins WHERE username = $1`, [username]))) {
    const password = process.env.ADMIN_PASSWORD ?? randomToken(12);
    await q(`INSERT INTO admins (username, password_hash) VALUES ($1,$2)`, [username, await hashPassword(password)]);
    log(process.env.ADMIN_PASSWORD ? `created admin "${username}"` : `created admin "${username}" with generated password: ${password}  (shown once — set ADMIN_PASSWORD to choose your own)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await seed();
  await pool.end();
}
