import type { APIRoute } from "astro";
import { api, ApiError } from "@/lib/api";

/** Streams the API's CSV export to the browser as a download (the admin cookie is forwarded). */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const csv = await api<string>("/admin/users/export.csv", { request, query: { q: url.searchParams.get("q") ?? undefined } });
    const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="users-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return Response.redirect(new URL("/admin/login", url), 302);
    return new Response("Could not export users.", { status: 502 });
  }
};
