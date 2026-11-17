import type { APIRoute } from "astro";
import { api, ApiError } from "@/lib/api";

/** Proxies the API's CSV guest list with the visitor's cookies, so ownership is enforced by the API. */
export const GET: APIRoute = async ({ params, request }) => {
  try {
    const csv = await api<string>(`/organizer/events/${encodeURIComponent(params.id ?? "")}/bookings.csv`, { request });
    const slug = String(params.id ?? "event").replace(/[^0-9]/g, "") || "event";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="guestlist-event-${slug}.csv"`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return new Response(status === 401 ? "Please log in." : "Not found.", { status: [401, 403, 404].includes(status) ? status : 502 });
  }
};
