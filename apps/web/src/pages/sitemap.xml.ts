import type { APIRoute } from "astro";
import { api } from "@/lib/api";
import { site } from "@/lib/format";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const GET: APIRoute = async () => {
  const data = await api<{ events: { slug: string; updated_at: string }[]; categories: { slug: string }[]; organizers: { slug: string }[]; venues: { slug: string }[] }>("/sitemap");
  const now = new Date().toISOString();
  const urls: { loc: string; lastmod: string; changefreq: string; priority: string }[] = [];
  const add = (path: string, changefreq: string, priority: string, lastmod = now) => urls.push({ loc: site.url + path, lastmod, changefreq, priority });

  add("/", "always", "1.0");
  add("/events-in-jaipur-today", "always", "1.0");
  add("/events-this-weekend-in-jaipur", "daily", "0.9");
  add("/trending-events-in-jaipur", "always", "0.9");
  add("/about", "monthly", "0.5");
  add("/contact", "monthly", "0.5");
  add("/tickiting", "weekly", "0.9");
  add("/podcast", "weekly", "0.8");
  for (const c of data.categories) add(`/category/${c.slug}`, "daily", "0.9");
  for (const e of data.events) add(`/event/${e.slug}`, "daily", "0.8", e.updated_at ? new Date(e.updated_at).toISOString() : now);
  add("/communities", "weekly", "0.7");
  for (const o of data.organizers) add(`/organizer/${o.slug}`, "weekly", "0.6");
  for (const v of data.venues) add(`/venue/${v.slug}`, "weekly", "0.6");

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url>\n    <loc>${esc(u.loc)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};
