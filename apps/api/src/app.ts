import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { allowedOrigins, config, isProd } from "./config.js";
import { pool } from "./db.js";
import { HttpError } from "./lib/errors.js";
import authRoutes from "./routes/auth.js";
import publicRoutes from "./routes/public.js";

export async function buildApp() {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : {
      level: config.LOG_LEVEL,
      // Never log cookies, auth headers or OTP payloads.
      redact: ["req.headers.cookie", "req.headers.authorization", "req.body.otp", "req.body.password"],
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: false,
    genReqId: (req) => (req.headers["x-request-id"] as string) || crypto.randomUUID(),
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 2 } });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute", allowList: () => config.NODE_ENV === "test" });

  // CSRF defence: state-changing requests must come from our own origin. Cookies are SameSite=Lax/Strict as a second layer.
  app.addHook("onRequest", async (req, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const origin = (req.headers.origin ?? "").replace(/\/$/, "");
    const fromSsr = req.headers["x-internal-ssr"] === config.SESSION_SECRET;
    if (fromSsr || (origin && allowedOrigins.includes(origin))) return;
    if (!origin && !isProd) return; // curl / tests
    reply.code(403).send({ error: "Cross-site request blocked.", code: "bad_origin" });
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Cache-Control", "no-store");
  });

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first?.message ?? "Invalid input.", code: "validation", fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, code: err.code, details: err.details });
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "unhandled error");
    reply.code(status).send({ error: status >= 500 ? "Something went wrong. Please try again." : err.message, code: status === 429 ? "rate_limited" : "error" });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "Not found.", code: "not_found" }));

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => { await pool.query("SELECT 1"); return { ok: true }; });

  await app.register(async (api) => {
    await api.register(publicRoutes);
    await api.register(authRoutes);
    // Feature modules are optional at boot so each can be developed and tested in isolation.
    for (const mod of ["./routes/bookings.js", "./routes/organizer.js", "./routes/admin/index.js"]) {
      try { await api.register((await import(mod)).default); }
      catch (e: any) { if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e; }
    }
  }, { prefix: "/api" });

  return app;
}
