/** Single entry point for server-side calls from Astro pages to the Node API. */
const BASE = (process.env.API_INTERNAL_URL ?? import.meta.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const SSR_KEY = process.env.SESSION_SECRET ?? import.meta.env.SESSION_SECRET ?? "dev-only-secret-change-me";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error", public fields?: { path: string; message: string }[]) {
    super(message);
  }
}

export interface ApiOptions {
  method?: string;
  /** JSON body, or FormData for uploads. */
  body?: unknown;
  /** Incoming request, so the visitor's cookies and IP reach the API. */
  request?: Request;
  /** Astro response headers; Set-Cookie from the API is copied here. */
  responseHeaders?: Headers;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = new URL(`${BASE}/api${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers = new Headers({ Accept: "application/json", "x-internal-ssr": SSR_KEY });
  const cookie = opts.request?.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const fwd = opts.request?.headers.get("x-forwarded-for");
  if (fwd) headers.set("x-forwarded-for", fwd);
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(opts.body); }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError(503, "The service is temporarily unavailable. Please try again.", "unavailable");
  }
  if (opts.responseHeaders) for (const c of res.headers.getSetCookie()) opts.responseHeaders.append("Set-Cookie", c);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON (CSV etc.) */ data = text; }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data?.fields);
  return data as T;
}

/** Like `api`, but returns null on 401/404 instead of throwing. */
export async function apiOrNull<T = any>(path: string, opts: ApiOptions = {}): Promise<T | null> {
  try { return await api<T>(path, opts); }
  catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 404)) return null; throw e; }
}

/**
 * Redirect that keeps any Set-Cookie the API issued during this request.
 * (`Astro.redirect` builds a fresh Response, so headers collected on `Astro.response` would otherwise be dropped.)
 */
export function redirectKeepingCookies(Astro: { redirect: (path: string, status?: any) => Response; response: { headers: Headers } }, to: string, status = 303): Response {
  const res = Astro.redirect(to, status);
  for (const c of Astro.response.headers.getSetCookie()) res.headers.append("Set-Cookie", c);
  return res;
}
