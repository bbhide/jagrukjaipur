import { randomInt } from "node:crypto";
import { config, isProd } from "../config.js";
import { one, q } from "../db.js";
import { hmac, safeEqual } from "../lib/password.js";
import { badRequest, tooMany } from "../lib/errors.js";

export interface OtpSender { send(number: string, code: string): Promise<void> }

const consoleSender: OtpSender = {
  async send(number, code) { console.info(`[otp] ${number} → ${code}`); },
};

/** Meta WhatsApp Cloud API, authentication-template message. */
const whatsappCloudSender: OtpSender = {
  async send(number, code) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: number, type: "template",
        template: {
          name: config.WHATSAPP_OTP_TEMPLATE, language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  },
};

let sender: OtpSender = config.OTP_PROVIDER === "whatsapp-cloud" ? whatsappCloudSender : consoleSender;
export const setOtpSender = (s: OtpSender) => { sender = s; };

const MAX_PER_NUMBER = 3;   // sends per 10 minutes
const MAX_PER_IP = 12;      // sends per hour
const MAX_ATTEMPTS = 5;

export async function sendOtp(number: string, meta: { sourcePage?: string; sourceButton?: string; ip?: string }) {
  const [{ n }] = await q<{ n: number }>(`SELECT count(*) AS n FROM otp_requests WHERE whatsapp_number = $1 AND created_at > now() - interval '10 minutes'`, [number]);
  if (n >= MAX_PER_NUMBER) throw tooMany("Too many OTP requests for this number. Please wait a few minutes.");
  if (meta.ip) {
    const [{ n: byIp }] = await q<{ n: number }>(`SELECT count(*) AS n FROM otp_requests WHERE ip = $1 AND created_at > now() - interval '1 hour'`, [meta.ip]);
    if (byIp >= MAX_PER_IP) throw tooMany();
  }
  const code = !isProd && config.OTP_DEV_CODE ? config.OTP_DEV_CODE : String(randomInt(0, 10000)).padStart(4, "0");
  const row = await one<{ id: number }>(
    `INSERT INTO otp_requests (whatsapp_number, otp_hash, source_page, source_button, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + $6 * interval '1 second') RETURNING id`,
    [number, hmac(`${number}:${code}`), meta.sourcePage?.slice(0, 200) ?? null, meta.sourceButton?.slice(0, 200) ?? null, meta.ip ?? null, config.OTP_TTL_SECONDS]);
  try {
    await sender.send(number, code);
  } catch (err) {
    await q(`UPDATE otp_requests SET status = 'failed' WHERE id = $1`, [row!.id]);
    throw err;
  }
  return row!.id;
}

export async function verifyOtp(requestId: number, number: string, code: string) {
  const row = await one<{ id: number; otp_hash: string; attempts: number; expired: boolean; status: string }>(
    `SELECT id, otp_hash, attempts, status, expires_at < now() AS expired FROM otp_requests WHERE id = $1 AND whatsapp_number = $2`, [requestId, number]);
  if (!row || row.status !== "sent") throw badRequest("Please request a new OTP.");
  if (row.expired) { await q(`UPDATE otp_requests SET status = 'expired' WHERE id = $1`, [row.id]); throw badRequest("OTP expired. Please request a new one."); }
  if (row.attempts >= MAX_ATTEMPTS) throw tooMany("Too many incorrect attempts. Please request a new OTP.");
  if (!safeEqual(row.otp_hash, hmac(`${number}:${code}`))) {
    await q(`UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    throw badRequest("Invalid OTP.");
  }
  await q(`UPDATE otp_requests SET status = 'verified', verified_at = now() WHERE id = $1`, [row.id]);
}
