import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../../db.js";
import { notFound } from "../../lib/errors.js";
import { uniqueVenueSlug } from "../../services/venues.js";

const id = z.coerce.number().int().positive();
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(blank, s.optional());
const bool = z.preprocess((v) => v === true || v === "on" || v === "1" || v === "true", z.boolean());

const JAIPUR_AREAS = [
  "Adarsh Nagar", "Ajmer Road", "Amer", "Bani Park", "Bapu Nagar", "C-Scheme", "Civil Lines", "Jagatpura", "Jawahar Nagar", "Jhotwara",
  "Kalwar Road", "Malviya Nagar", "Mansarovar", "MI Road", "Murlipura", "Pink City", "Raja Park", "Sanganer", "Sikar Road", "Sirsi Road",
  "Sodala", "Tonk Road", "Vaishali Nagar", "Vidhyadhar Nagar",
];

const venueSchema = z.object({
  name: z.string().trim().min(1, "Venue name is required.").max(200),
  area: opt(z.string().trim().max(120)),
  address: opt(z.string().trim().max(500)),
  maps_url: opt(z.string().trim().url("Maps link must be a valid URL.").max(1000)),
  google_place_id: opt(z.string().trim().max(300)),
  lat: opt(z.coerce.number().min(-90).max(90)),
  lng: opt(z.coerce.number().min(-180).max(180)),
  is_active: bool,
});
const COLS = ["name", "area", "address", "maps_url", "google_place_id", "lat", "lng", "is_active"] as const;
const SELECT = `SELECT id, name, area, address, maps_url, google_place_id, lat, lng, is_active FROM venues`;

export default async function (app: FastifyInstance) {
  app.get("/venues/areas", async () => {
    const rows = await q<{ area: string }>(`SELECT DISTINCT area FROM venues WHERE area IS NOT NULL AND area <> '' ORDER BY area`);
    const areas = [...new Set([...JAIPUR_AREAS, ...rows.map((r) => r.area)])].sort((a, b) => a.localeCompare(b));
    return { areas };
  });

  app.get("/venues", async () => ({ items: await q(`${SELECT} ORDER BY name, id`) }));

  app.get("/venues/:id", async (req) => {
    const { id: vid } = z.object({ id }).parse(req.params);
    const row = await one(`${SELECT} WHERE id = $1`, [vid]);
    if (!row) throw notFound("Venue not found.");
    return row;
  });

  app.post("/venues", async (req) => {
    const b = venueSchema.parse(req.body) as Record<string, unknown>;
    const params = [...COLS.map((c) => b[c] ?? null), await uniqueVenueSlug(b.name as string)];
    const row = await one<{ id: number }>(`INSERT INTO venues (${COLS.join(",")}, slug) VALUES (${params.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, params);
    return { success: true, id: row!.id };
  });

  app.put("/venues/:id", async (req) => {
    const { id: vid } = z.object({ id }).parse(req.params);
    const b = venueSchema.parse(req.body) as Record<string, unknown>;
    const params = [...COLS.map((c) => b[c] ?? null), vid];
    const row = await one(`UPDATE venues SET ${COLS.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${params.length} RETURNING id`, params);
    if (!row) throw notFound("Venue not found.");
    return { success: true, id: vid };
  });

  app.delete("/venues/:id", async (req) => {
    const { id: vid } = z.object({ id }).parse(req.params);
    const row = await one(`DELETE FROM venues WHERE id = $1 RETURNING id`, [vid]);
    if (!row) throw notFound("Venue not found.");
    return { success: true };
  });
}
