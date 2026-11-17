import type { APIRoute } from "astro";
export const GET: APIRoute = ({ redirect, url }) => redirect(`/search${url.search}`, 301);
