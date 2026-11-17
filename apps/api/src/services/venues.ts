import { one, type Queryable } from "../db.js";
import { pool } from "../db.js";
import { slugify } from "../lib/text.js";

/** A venue slug derived from its name that no other venue uses; collisions get `-<n>` appended. */
export async function uniqueVenueSlug(name: string, db: Queryable = pool, excludeId?: number): Promise<string> {
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await one(`SELECT 1 FROM venues WHERE slug = $1 AND ($2::int IS NULL OR id <> $2)`, [slug, excludeId ?? null], db);
    if (!taken) return slug;
  }
}
