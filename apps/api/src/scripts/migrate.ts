/** Applies db/migrations/*.sql in filename order, once each, inside a transaction. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, tx } from "../db.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../db/migrations");

export async function migrate(log = console.log) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await pool.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    await tx(async (c) => {
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
    });
    log(`applied ${file}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await migrate();
  await pool.end();
}
