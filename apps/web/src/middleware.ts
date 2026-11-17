import { defineMiddleware } from "astro:middleware";
import { apiOrNull } from "./lib/api";

/** Guards /admin: every page except the login screen needs a valid admin session. */
export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname, search } = ctx.url;
  if (pathname.startsWith("/admin")) {
    const isLogin = pathname === "/admin/login";
    const me = await apiOrNull<{ admin: { id: number; username: string; display_name: string } }>("/admin/me", { request: ctx.request });
    if (!me && !isLogin) return ctx.redirect(`/admin/login?redirect=${encodeURIComponent(pathname + search)}`, 302);
    if (me && isLogin) return ctx.redirect("/admin", 302);
    ctx.locals.admin = me?.admin ?? null;
  }
  const res = await next();
  if (pathname.startsWith("/admin")) {
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("Cache-Control", "no-store");
  }
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
});
