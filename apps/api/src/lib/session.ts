import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { one, q } from "../db.js";
import { randomToken, sha256 } from "./password.js";
import { unauthorized } from "./errors.js";

export const USER_COOKIE = "jj_session";
export const ADMIN_COOKIE = "jj_admin";
/** Readable flag the browser uses to decide whether to open the login modal (mirrors the legacy site). */
export const FLAG_COOKIE = "wa_logged_in";

export interface SessionRow {
  id: string;
  kind: "user" | "admin" | "pending";
  subject_id: number | null;
  data: Record<string, any>;
  expires_at: Date;
}

const baseCookie = { path: "/", httpOnly: true, secure: config.COOKIE_SECURE, sameSite: "lax" as const };

export async function createSession(reply: FastifyReply, kind: SessionRow["kind"], subjectId: number | null, data: object = {}) {
  const token = randomToken();
  const admin = kind === "admin";
  const maxAge = admin ? config.ADMIN_SESSION_HOURS * 3600 : config.SESSION_DAYS * 86400;
  await q(`INSERT INTO sessions (id, kind, subject_id, data, expires_at) VALUES ($1,$2,$3,$4, now() + $5 * interval '1 second')`, [
    sha256(token), kind, subjectId, JSON.stringify(data), maxAge,
  ]);
  reply.setCookie(admin ? ADMIN_COOKIE : USER_COOKIE, token, { ...baseCookie, sameSite: admin ? "strict" : "lax", maxAge });
  return token;
}

export async function readSession(req: FastifyRequest, cookie: string): Promise<SessionRow | null> {
  const token = req.cookies[cookie];
  if (!token) return null;
  return one<SessionRow>(`SELECT * FROM sessions WHERE id = $1 AND expires_at > now()`, [sha256(token)]);
}

export async function updateSession(id: string, patch: { kind?: SessionRow["kind"]; subject_id?: number | null; data?: object }) {
  await q(`UPDATE sessions SET kind = COALESCE($2, kind), subject_id = COALESCE($3, subject_id), data = COALESCE($4, data) WHERE id = $1`, [
    id, patch.kind ?? null, patch.subject_id ?? null, patch.data ? JSON.stringify(patch.data) : null,
  ]);
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply, cookie: string) {
  const token = req.cookies[cookie];
  if (token) await q(`DELETE FROM sessions WHERE id = $1`, [sha256(token)]);
  reply.clearCookie(cookie, { path: "/" });
  if (cookie === USER_COOKIE) reply.clearCookie(FLAG_COOKIE, { path: "/" });
}

export function setLoggedInFlag(reply: FastifyReply) {
  reply.setCookie(FLAG_COOKIE, "1", { path: "/", httpOnly: false, secure: config.COOKIE_SECURE, sameSite: "lax", maxAge: config.SESSION_DAYS * 86400 });
}

export interface AuthUser { id: number; whatsapp_number: string; name: string | null; email: string | null }
export interface AuthAdmin { id: number; username: string; display_name: string }

/** Returns the logged-in user, or null. A session whose profile is incomplete (no name yet) does not count. */
export async function getUser(req: FastifyRequest): Promise<AuthUser | null> {
  const s = await readSession(req, USER_COOKIE);
  if (!s || s.kind !== "user" || !s.subject_id) return null;
  const u = await one<AuthUser>(`SELECT id, whatsapp_number, name, email FROM users WHERE id = $1`, [s.subject_id]);
  return u && u.name ? u : null;
}

export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  const u = await getUser(req);
  if (!u) throw unauthorized();
  return u;
}

export async function getAdmin(req: FastifyRequest): Promise<AuthAdmin | null> {
  const s = await readSession(req, ADMIN_COOKIE);
  if (!s || s.kind !== "admin" || !s.subject_id) return null;
  return one<AuthAdmin>(`SELECT id, username, display_name FROM admins WHERE id = $1`, [s.subject_id]);
}

export async function requireAdmin(req: FastifyRequest): Promise<AuthAdmin> {
  const a = await getAdmin(req);
  if (!a) throw unauthorized("Admin login required.");
  return a;
}
