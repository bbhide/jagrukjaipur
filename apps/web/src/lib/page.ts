import type { AstroGlobal } from "astro";
import { api, apiOrNull } from "./api";
import type { Me, SiteData } from "./types";

/** Data every public page needs: filter-bar counts and, when the login flag is present, the visitor's profile. */
export async function loadShell(Astro: AstroGlobal): Promise<{ siteData: SiteData; me: Me | null }> {
  const hasFlag = Astro.cookies.get("wa_logged_in")?.value === "1";
  const [siteData, meRes] = await Promise.all([
    api<SiteData>("/site"),
    hasFlag ? apiOrNull<{ user: Me }>("/me", { request: Astro.request }) : Promise.resolve(null),
  ]);
  // A stale flag (session expired server-side) is cleared so the UI and the server agree.
  if (hasFlag && !meRes) Astro.cookies.delete("wa_logged_in", { path: "/" });
  return { siteData, me: meRes?.user ?? null };
}
