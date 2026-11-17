import pg from "pg";
import { config } from "./config.js";

// DATE / TIME / NUMERIC come back as plain strings so nothing is shifted by the server's timezone.
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1083, (v) => v); // time
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
pg.types.setTypeParser(20, (v) => Number(v)); // bigint (counts)

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
  // The site is Jaipur-local: "today", "this weekend" and timestamps are all IST.
  options: "-c timezone=Asia/Kolkata",
});

export type Queryable = Pick<pg.PoolClient, "query">;

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const res = await db.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
