/**
 * Admin API. Everything under /api/admin requires an admin session except login.
 * Each sibling file in this folder default-exports a Fastify plugin and is registered automatically.
 */
import type { FastifyInstance } from "fastify";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { one, q } from "../../db.js";
import { HttpError } from "../../lib/errors.js";
import { verifyPassword } from "../../lib/password.js";
import { ADMIN_COOKIE, createSession, destroySession, requireAdmin } from "../../lib/session.js";

const loginBody = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) });

export default async function adminRoutes(app: FastifyInstance) {
  app.post("/admin/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { username, password } = loginBody.parse(req.body);
    const admin = await one<{ id: number; password_hash: string }>(`SELECT id, password_hash FROM admins WHERE username = $1`, [username]);
    // Always run the hash comparison so response time does not reveal whether the username exists.
    const ok = await verifyPassword(password, admin?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    if (!admin || !ok) throw new HttpError(401, "Invalid username or password.", "invalid_credentials");
    await createSession(reply, "admin", admin.id);
    await q(`UPDATE admins SET last_login_at = now() WHERE id = $1`, [admin.id]);
    return { success: true };
  });

  app.post("/admin/logout", async (req, reply) => { await destroySession(req, reply, ADMIN_COOKIE); return { success: true }; });

  await app.register(async (secured) => {
    secured.addHook("preHandler", async (req) => { (req as any).admin = await requireAdmin(req); });
    secured.get("/me", async (req) => ({ admin: (req as any).admin }));
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of readdirSync(here).filter((f) => /\.(ts|js)$/.test(f) && !f.startsWith("index.") && !f.endsWith(".d.ts")).sort()) {
      await secured.register((await import(`./${file.replace(/\.ts$/, ".js")}`)).default);
    }
  }, { prefix: "/admin" });
}
