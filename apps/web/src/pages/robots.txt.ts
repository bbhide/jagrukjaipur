import type { APIRoute } from "astro";
import { site } from "@/lib/format";

export const GET: APIRoute = () => {
  const body = ["User-agent: *", "Allow: /", "Disallow: /admin/", "Disallow: /api/", "Disallow: /search", "", `Sitemap: ${site.url}/sitemap.xml`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};
