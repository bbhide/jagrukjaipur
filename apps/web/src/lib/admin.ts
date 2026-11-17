/** Helpers for the server-rendered admin pages (classic form posts, redirect + flash). */
import type { AstroGlobal } from "astro";
import { api, ApiError, redirectKeepingCookies, type ApiOptions } from "./api";

export interface Flash { type: "success" | "error" | "warning"; message: string }
const FLASH = "jj_flash";

export function setFlash(Astro: AstroGlobal, type: Flash["type"], message: string) {
  Astro.cookies.set(FLASH, JSON.stringify({ type, message }), { path: "/admin", httpOnly: true, sameSite: "lax", maxAge: 60 });
}

export function takeFlash(Astro: AstroGlobal): Flash | null {
  const raw = Astro.cookies.get(FLASH)?.value;
  if (!raw) return null;
  Astro.cookies.delete(FLASH, { path: "/admin" });
  try { return JSON.parse(raw); } catch { return null; }
}

/** Admin API call carrying the admin's cookies. */
export const adminApi = <T = any>(Astro: AstroGlobal, path: string, opts: ApiOptions = {}) =>
  api<T>(`/admin${path}`, { ...opts, request: Astro.request, responseHeaders: Astro.response.headers });

/**
 * Runs a POST handler and turns the outcome into flash + redirect (Post/Redirect/Get).
 * Returns a Response to return from the page, or an error message to render in place when `inline` is set.
 */
export async function handlePost(
  Astro: AstroGlobal,
  run: (form: FormData) => Promise<{ message: string; redirect?: string } | void>,
  opts: { fallback?: string } = {},
): Promise<Response | null> {
  if (Astro.request.method !== "POST") return null;
  const here = Astro.url.pathname + Astro.url.search;
  try {
    const out = await run(await Astro.request.formData());
    if (out?.message) setFlash(Astro, "success", out.message);
    return redirectKeepingCookies(Astro, out?.redirect ?? opts.fallback ?? here);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return Astro.redirect(`/admin/login?redirect=${encodeURIComponent(here)}`, 303);
    setFlash(Astro, "error", e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    return Astro.redirect(here, 303);
  }
}

export const fmtINR = (n: number) => `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
