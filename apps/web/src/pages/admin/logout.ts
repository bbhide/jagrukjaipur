import type { APIRoute } from "astro";
import { api } from "@/lib/api";

export const POST: APIRoute = async ({ request, redirect }) => {
  const headers = new Headers();
  await api("/admin/logout", { method: "POST", body: {}, request, responseHeaders: headers }).catch(() => {});
  const res = redirect("/admin/login", 303);
  for (const c of headers.getSetCookie()) res.headers.append("Set-Cookie", c);
  return res;
};
