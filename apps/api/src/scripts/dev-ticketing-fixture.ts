/**
 * Development fixture: turns one seeded FREE event into a ticketed one so the booking flow can be exercised end to end.
 *   cd apps/api && npx tsx --env-file=../../.env src/scripts/dev-ticketing-fixture.ts [event-slug]
 * Idempotent: running it again changes nothing that is already in place. Never run it against production.
 */
import { one, pool, q, tx } from "../db.js";
import { config } from "../config.js";
import { todayIST } from "../lib/dates.js";

if (config.NODE_ENV === "production") throw new Error("Refusing to run the ticketing fixture in production.");

const slugArg = process.argv[2];
const TIERS = [
  { name: "General Entry (Free)", price: 0, capacity: 200, sort: 1 },
  { name: "Supporter Pass", price: 200, capacity: 50, sort: 2 },
];

const result = await tx(async (db) => {
  const today = todayIST();
  const ev = slugArg
    ? await one<any>(`SELECT id, slug, title, organizer_id FROM events WHERE slug = $1`, [slugArg], db)
    : // Prefer an event that already carries the fixture, otherwise the first live free event.
      await one<any>(
        `SELECT e.id, e.slug, e.title, e.organizer_id FROM events e
         WHERE e.is_free AND e.status = 'published' AND e.approval_status = 'approved' AND COALESCE(e.end_date, e.event_date) >= $1::date
         ORDER BY EXISTS (SELECT 1 FROM ticket_tiers t WHERE t.event_id = e.id AND t.name = $2) DESC, e.event_date, e.id LIMIT 1`,
        [today, TIERS[0]!.name], db);
  if (!ev) throw new Error("No suitable free event found. Run `npm run db:seed` first.");

  // Organiser: attach one if the event has none.
  let organizerId: number | null = ev.organizer_id;
  if (!organizerId) {
    const o = await one<{ id: number }>(
      `INSERT INTO organizers (name, slug) VALUES ('Dev Fixture Organiser', 'dev-fixture-organiser')
       ON CONFLICT (slug) DO UPDATE SET name = organizers.name RETURNING id`, [], db);
    organizerId = o!.id;
    await q(`UPDATE events SET organizer_id = $2 WHERE id = $1`, [ev.id, organizerId], db);
  }
  // 15 % commission split 50/50 so the fee rows are visible in the bill breakdown.
  await q(`UPDATE organizers SET ticketing_enabled = TRUE, approval_status = 'approved', is_active = TRUE, commission_rate = 15, absorption_mode = 'split' WHERE id = $1`, [organizerId], db);
  await q(`UPDATE events SET has_ticketing = TRUE WHERE id = $1`, [ev.id], db);

  for (const t of TIERS) {
    await q(`INSERT INTO ticket_tiers (event_id, name, price, capacity, sort_order)
             SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM ticket_tiers WHERE event_id = $1 AND name = $2)`, [ev.id, t.name, t.price, t.capacity, t.sort], db);
  }
  await q(`INSERT INTO event_questions (event_id, label, is_required, sort_order)
           SELECT $1, 'How did you hear about this event?', TRUE, 1 WHERE NOT EXISTS (SELECT 1 FROM event_questions WHERE event_id = $1)`, [ev.id], db);
  await q(`INSERT INTO coupons (event_id, code, discount_type, discount_value, is_active) VALUES ($1, 'TEST50', 'percent', 50, TRUE)
           ON CONFLICT (event_id, code) DO UPDATE SET discount_type = 'percent', discount_value = 50, is_active = TRUE, max_uses = NULL, valid_until = NULL`, [ev.id], db);
  return ev as { id: number; slug: string; title: string };
});

console.log(`Ticketing fixture ready: ${result.title}`);
console.log(`  slug:    ${result.slug}`);
console.log(`  event_id: ${result.id}`);
console.log(`  url:     ${config.PUBLIC_SITE_URL}/event/${result.slug}`);
console.log(`  tiers:   ${TIERS.map((t) => `${t.name} (₹${t.price})`).join(", ")} · coupon TEST50 (50%)`);
await pool.end();
