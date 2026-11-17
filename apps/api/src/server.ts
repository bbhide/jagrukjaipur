import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool, q } from "./db.js";

const app = await buildApp();

// Expired sessions and stale OTP rows are swept hourly.
const sweep = setInterval(() => {
  q(`DELETE FROM sessions WHERE expires_at < now()`).catch((e) => app.log.error(e));
  q(`UPDATE otp_requests SET status = 'expired' WHERE status = 'sent' AND expires_at < now()`).catch((e) => app.log.error(e));
  q(`UPDATE events SET status = 'past' WHERE status = 'published' AND COALESCE(end_date, event_date) < (now() AT TIME ZONE 'Asia/Kolkata')::date`).catch((e) => app.log.error(e));
}, 3600_000);
sweep.unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => { clearInterval(sweep); await app.close(); await pool.end(); process.exit(0); });
}

await app.listen({ port: config.API_PORT, host: config.API_HOST });
