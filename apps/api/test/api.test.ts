/**
 * Integration tests against a real PostgreSQL database (DATABASE_URL from .env).
 * Run `npm run db:migrate && npm run db:seed` first. Tests create their own users and clean up after themselves.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { pool, q } from "../src/db.js";
import { setOtpSender } from "../src/services/otp.js";

let app: FastifyInstance;
const sent: Record<string, string> = {};
const NUMBER = "9" + String(Date.now()).slice(-9);
const json = { "content-type": "application/json", origin: "http://localhost:4321" };

before(async () => {
  setOtpSender({ async send(number, code) { sent[number] = code; } });
  app = await buildApp();
});
after(async () => {
  await q(`DELETE FROM users WHERE whatsapp_number = $1`, [`91${NUMBER}`]);
  await q(`DELETE FROM otp_requests WHERE whatsapp_number = $1`, [`91${NUMBER}`]);
  await app.close();
  await pool.end();
});

const cookieOf = (res: { headers: Record<string, any> }, name: string) => {
  const all = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(";")[0] : null;
};

test("health check", async () => {
  const res = await app.inject({ url: "/readyz" });
  assert.equal(res.statusCode, 200);
});

test("event listing is paginated and ordered by date", async () => {
  const res = await app.inject({ url: "/api/events?per_page=5" });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.ok(body.items.length <= 5);
  const dates = body.items.map((e: any) => e.display_date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(body.has_more, body.page < body.pages);
});

test("free filter only returns free events", async () => {
  const body = (await app.inject({ url: "/api/events?free=1&per_page=100" })).json();
  assert.ok(body.items.every((e: any) => e.is_free));
});

test("trending is ordered by interests", async () => {
  const body = (await app.inject({ url: "/api/events?scope=trending&per_page=100" })).json();
  const n = body.items.map((e: any) => e.interests);
  assert.deepEqual(n, [...n].sort((a, b) => b - a));
});

test("filter-bar counts agree with the listing", async () => {
  const site = (await app.inject({ url: "/api/site" })).json();
  const all = (await app.inject({ url: "/api/events?per_page=1" })).json();
  assert.equal(site.filters.total, all.total);
  for (const c of site.filters.categories.slice(0, 3)) {
    const list = (await app.inject({ url: `/api/events?category=${c.slug}&per_page=1` })).json();
    assert.equal(list.total, c.count, c.slug);
  }
});

test("unknown event and category return 404; bad paging is rejected", async () => {
  assert.equal((await app.inject({ url: "/api/events/does-not-exist" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/api/categories/nope" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/api/events?page=0" })).statusCode, 400);
});

test("search requires login", async () => {
  assert.equal((await app.inject({ url: "/api/search?q=music" })).statusCode, 401);
});

test("state-changing requests from another origin are blocked", async () => {
  const res = await app.inject({ method: "POST", url: "/api/auth/otp/send", headers: { "content-type": "application/json", origin: "https://evil.example" }, payload: { whatsapp_number: NUMBER } });
  assert.equal(res.statusCode, 403);
});

test("OTP login: validation, wrong code, success, registration, profile, logout", async () => {
  let res = await app.inject({ method: "POST", url: "/api/auth/otp/send", headers: json, payload: { whatsapp_number: "12345" } });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: "POST", url: "/api/auth/otp/send", headers: json, payload: { whatsapp_number: NUMBER, source_page: "/test", source_button: "Test" } });
  assert.equal(res.statusCode, 200);
  const session = cookieOf(res, "jj_session")!;
  assert.ok(session, "session cookie issued");
  assert.match(res.headers["set-cookie"]!.toString(), /HttpOnly/);
  const code = sent[`91${NUMBER}`];
  assert.match(code, /^\d{4}$/);

  const wrong = code === "0000" ? "1111" : "0000";
  res = await app.inject({ method: "POST", url: "/api/auth/otp/verify", headers: { ...json, cookie: session }, payload: { otp: wrong } });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: "POST", url: "/api/auth/otp/verify", headers: { ...json, cookie: session }, payload: { otp: code } });
  assert.equal(res.json().status, "need_name");
  assert.equal(cookieOf(res, "wa_logged_in"), null, "not fully logged in until registration is complete");
  assert.equal((await app.inject({ url: "/api/me", headers: { cookie: session } })).statusCode, 401);

  // A code cannot be replayed.
  res = await app.inject({ method: "POST", url: "/api/auth/otp/verify", headers: { ...json, cookie: session }, payload: { otp: code } });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: "POST", url: "/api/auth/complete", headers: { ...json, cookie: session }, payload: { name: "Test User", email: "not-an-email" } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: "POST", url: "/api/auth/complete", headers: { ...json, cookie: session }, payload: { name: "Test User", email: "test@example.com" } });
  assert.equal(res.statusCode, 200);
  assert.equal(cookieOf(res, "wa_logged_in"), "wa_logged_in=1");

  res = await app.inject({ method: "PUT", url: "/api/me", headers: { ...json, cookie: session }, payload: { name: "Test User", gender: "Other", dob: "1995-04-12", email: "test@example.com", instagram_username: "https://instagram.com/jagrukjaipur/?hl=en" } });
  assert.equal(res.json().user.instagram_username, "jagrukjaipur");

  res = await app.inject({ url: "/api/search?q=jaipur", headers: { cookie: session } });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.json().events));

  await app.inject({ method: "POST", url: "/api/auth/logout", headers: { ...json, cookie: session }, payload: {} });
  assert.equal((await app.inject({ url: "/api/me", headers: { cookie: session } })).statusCode, 401);
});

test("podcast application: validation and honeypot", async () => {
  const good = { name: "Applicant Test", phone: "9876543210", email: "a@example.com", topic: "Building in Jaipur", bio: "A long enough biography for the form to accept." };
  let res = await app.inject({ method: "POST", url: "/api/podcast/applications", headers: json, payload: { ...good, phone: "123" } });
  assert.equal(res.statusCode, 400);
  const before = (await q(`SELECT count(*) AS n FROM podcast_applications`))[0].n;
  res = await app.inject({ method: "POST", url: "/api/podcast/applications", headers: json, payload: { ...good, website_url: "http://spam.example" } });
  assert.equal(res.statusCode, 200);
  assert.equal((await q(`SELECT count(*) AS n FROM podcast_applications`))[0].n, before, "honeypot submissions are dropped");
});

test("venue page data: known slug returns venue and event lists, unknown slug is 404", async () => {
  const [row] = await q<{ slug: string }>(`SELECT slug FROM venues WHERE is_active ORDER BY id LIMIT 1`);
  assert.ok(row, "seed data has a venue");
  const res = await app.inject({ url: `/api/venues/${row.slug}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.venue.slug, row.slug);
  assert.ok(Array.isArray(body.events) && Array.isArray(body.past_events));
  assert.equal((await app.inject({ url: "/api/venues/no-such-venue-zz" })).statusCode, 404);
});

test("admin API rejects anonymous callers and wrong passwords", async () => {
  assert.equal((await app.inject({ url: "/api/admin/me" })).statusCode, 401);
  const res = await app.inject({ method: "POST", url: "/api/admin/login", headers: json, payload: { username: "admin", password: "definitely-wrong" } });
  assert.equal(res.statusCode, 401);
});
