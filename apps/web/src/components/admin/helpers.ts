import type { AstroGlobal } from "astro";
import { ApiError } from "@/lib/api";
import { setFlash } from "@/lib/admin";

/** Plain-JSON body from a classic form post (checkboxes become booleans; repeated names become arrays). */
export function formToJson(form: FormData, checkboxes: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set([...form.keys()])) {
    const all = form.getAll(key).filter((v): v is string => typeof v === "string");
    out[key.replace(/\[\]$/, "")] = key.endsWith("[]") ? all : all[0];
  }
  for (const c of checkboxes) out[c] = form.has(c);
  return out;
}

/** True when the API answered 404, so a detail page can bounce back to its list. */
export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

/** Fetches a record for an edit page. Returns null (after setting a flash) when it does not exist. */
export async function loadOrFlash<T>(Astro: AstroGlobal, load: () => Promise<T>, message: string): Promise<T | null> {
  try { return await load(); }
  catch (e) {
    if (isNotFound(e)) { setFlash(Astro, "error", message); return null; }
    throw e;
  }
}

export const pageParam = (url: URL) => Math.max(1, Number(url.searchParams.get("page")) || 1);
