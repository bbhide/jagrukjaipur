import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config.js";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, r = 8, p = 1, LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, LEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, rr, pp, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(rr), p: Number(pp) });
  return timingSafeEqual(actual, expected);
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
/** Keyed hash for short secrets (OTP codes) so a leaked table cannot be brute-forced offline without the server secret. */
export const hmac = (v: string) => createHmac("sha256", config.SESSION_SECRET).update(v).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
