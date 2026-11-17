/** Browser-side API helper shared by every island. */
export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function call<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new RequestError(0, "Network error. Please try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RequestError(res.status, data?.error ?? "Something went wrong. Please try again.");
  return data as T;
}

export const isLoggedIn = () => document.cookie.includes("wa_logged_in=1");
export const isInternal = (url: string) => url.startsWith("/") || url.startsWith("./") || url.includes(window.location.hostname);
