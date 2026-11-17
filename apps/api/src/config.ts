import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("postgres://jagruk:jagruk@127.0.0.1:5433/jagruk"),
  DATABASE_SSL: bool.default(false),
  PUBLIC_SITE_URL: z.string().default("http://localhost:4321"),
  /** Comma-separated origins allowed to send state-changing requests. Defaults to PUBLIC_SITE_URL. */
  ALLOWED_ORIGINS: z.string().optional(),
  SESSION_SECRET: z.string().min(16).default("dev-only-secret-change-me"),
  COOKIE_SECURE: bool.default(false),
  SESSION_DAYS: z.coerce.number().default(30),
  ADMIN_SESSION_HOURS: z.coerce.number().default(12),

  /** OTP delivery: `console` logs the code (development), `whatsapp-cloud` uses Meta's Cloud API. */
  OTP_PROVIDER: z.enum(["console", "whatsapp-cloud"]).default("console"),
  /** Development/test only: every OTP is this value. Ignored in production. */
  OTP_DEV_CODE: z.string().regex(/^\d{4}$/).optional(),
  OTP_TTL_SECONDS: z.coerce.number().default(300),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_OTP_TEMPLATE: z.string().default("login_otp"),

  /** Uploads: local directory in development, S3 bucket in production. */
  UPLOAD_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("../web/public/uploads"),
  UPLOAD_PUBLIC_BASE: z.string().default("/uploads"),
  S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().default("ap-south-1"),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Jagruk Jaipur <no-reply@jagrukjaipur.com>"),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", z.prettifyError(parsed.error));
    process.exit(1);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production") {
    if (cfg.SESSION_SECRET === "dev-only-secret-change-me") throw new Error("SESSION_SECRET must be set in production");
    if (cfg.OTP_PROVIDER === "console") throw new Error("OTP_PROVIDER=console is not allowed in production");
  }
  return cfg;
}

export const config = loadConfig();
export const isProd = config.NODE_ENV === "production";
export const allowedOrigins = (config.ALLOWED_ORIGINS ?? config.PUBLIC_SITE_URL).split(",").map((s) => s.trim().replace(/\/$/, ""));
