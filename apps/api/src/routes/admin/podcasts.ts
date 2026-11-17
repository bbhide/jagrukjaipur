/** Podcast episodes, featured guests and guest applications. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../../db.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { readMultipart, removeImage, saveImage } from "../../lib/uploads.js";

const id = z.object({ id: z.coerce.number().int().positive() });
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const bool = z.preprocess((v) => v === true || v === "true" || v === "1" || v === "on", z.boolean());

/** Accepts a full YouTube URL (watch, youtu.be, embed, shorts, live) or a bare 11-character id. */
export function extractYoutubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let cand: string | undefined;
    if (host === "youtu.be") cand = u.pathname.split("/")[1];
    else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      cand = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/)?.[1];
    }
    return cand && /^[A-Za-z0-9_-]{11}$/.test(cand) ? cand : null;
  } catch { return null; }
}

const episodeBody = z.object({
  episode_number: z.coerce.number().int().min(0).max(100000),
  title: z.string().trim().min(1, "Title is required.").max(300),
  youtube: z.string().trim().min(1, "YouTube URL or video ID is required."),
  guest_name: optText(200), guest_title: optText(200), category: optText(100),
  description: optText(5000),
  release_date: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Release date must be YYYY-MM-DD.").optional()),
  is_active: bool.default(true),
});

const guestFields = z.object({
  name: z.string().trim().min(1, "Guest name is required.").max(200),
  designation: optText(200), bio: optText(3000),
  instagram: optText(300), linkedin: optText(300), twitter: optText(300), website: optText(300),
  sort_order: z.preprocess(blank, z.coerce.number().int().min(0).max(9999).default(0)),
});
const socialsOf = (g: z.infer<typeof guestFields>) =>
  Object.fromEntries((["instagram", "linkedin", "twitter", "website"] as const).filter((k) => g[k]).map((k) => [k, g[k]]));

export default async function podcastRoutes(app: FastifyInstance) {
  // ── Episodes ──
  app.get("/podcasts/episodes", async () => ({ episodes: await q(`SELECT * FROM podcast_episodes ORDER BY episode_number DESC, id DESC`) }));
  app.get("/podcasts/episodes/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    const row = await one(`SELECT * FROM podcast_episodes WHERE id = $1`, [i]);
    if (!row) throw notFound("Episode not found.");
    return { episode: row };
  });
  const episodeValues = (b: z.infer<typeof episodeBody>) => {
    const yt = extractYoutubeId(b.youtube);
    if (!yt) throw badRequest("That does not look like a valid YouTube URL or video ID.");
    return [b.episode_number, b.title, yt, /^https?:/i.test(b.youtube) ? b.youtube : `https://www.youtube.com/watch?v=${yt}`,
      b.guest_name ?? null, b.guest_title ?? null, b.category ?? null, b.description ?? null, b.release_date ?? null, b.is_active];
  };
  app.post("/podcasts/episodes", async (req) => {
    const row = await one(
      `INSERT INTO podcast_episodes (episode_number, title, youtube_id, youtube_url, guest_name, guest_title, category, description, release_date, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, episodeValues(episodeBody.parse(req.body)));
    return { success: true, id: row!.id };
  });
  app.put("/podcasts/episodes/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    const row = await one(
      `UPDATE podcast_episodes SET episode_number=$1, title=$2, youtube_id=$3, youtube_url=$4, guest_name=$5, guest_title=$6, category=$7, description=$8, release_date=$9, is_active=$10
        WHERE id=$11 RETURNING id`, [...episodeValues(episodeBody.parse(req.body)), i]);
    if (!row) throw notFound("Episode not found.");
    return { success: true };
  });
  app.delete("/podcasts/episodes/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    if (!(await one(`DELETE FROM podcast_episodes WHERE id=$1 RETURNING id`, [i]))) throw notFound("Episode not found.");
    return { success: true };
  });

  // ── Guests (multipart for the photo) ──
  app.get("/podcasts/guests", async () => ({ guests: await q(`SELECT * FROM podcast_guests ORDER BY sort_order, id`) }));
  app.get("/podcasts/guests/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    const row = await one(`SELECT * FROM podcast_guests WHERE id = $1`, [i]);
    if (!row) throw notFound("Guest not found.");
    return { guest: row };
  });
  app.post("/podcasts/guests", async (req) => {
    const { fields, files } = await readMultipart(req);
    const g = guestFields.parse(fields);
    const photo = files.photo ? (await saveImage(files.photo, "guest")).path : null;
    const row = await one(
      `INSERT INTO podcast_guests (name, designation, bio, photo_path, socials, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [g.name, g.designation ?? null, g.bio ?? null, photo, JSON.stringify(socialsOf(g)), g.sort_order]);
    return { success: true, id: row!.id };
  });
  app.put("/podcasts/guests/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    const existing = await one<{ photo_path: string | null }>(`SELECT photo_path FROM podcast_guests WHERE id=$1`, [i]);
    if (!existing) throw notFound("Guest not found.");
    const { fields, files } = await readMultipart(req);
    const g = guestFields.parse(fields);
    let photo = existing.photo_path;
    if (files.photo) { photo = (await saveImage(files.photo, "guest")).path; await removeImage(existing.photo_path); }
    await q(`UPDATE podcast_guests SET name=$1, designation=$2, bio=$3, photo_path=$4, socials=$5, sort_order=$6 WHERE id=$7`,
      [g.name, g.designation ?? null, g.bio ?? null, photo, JSON.stringify(socialsOf(g)), g.sort_order, i]);
    return { success: true };
  });
  app.delete("/podcasts/guests/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    const row = await one<{ photo_path: string | null }>(`DELETE FROM podcast_guests WHERE id=$1 RETURNING photo_path`, [i]);
    if (!row) throw notFound("Guest not found.");
    await removeImage(row.photo_path);
    return { success: true };
  });

  // ── Applications ──
  app.get("/podcasts/applications", async (req) => {
    const { status } = z.object({ status: z.enum(["pending", "contacted", "scheduled", "rejected"]).optional() }).parse(req.query);
    const applications = await q(`SELECT * FROM podcast_applications WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC, id DESC`, [status ?? null]);
    return { applications };
  });
  app.put("/podcasts/applications/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    const { status } = z.object({ status: z.enum(["pending", "contacted", "scheduled", "rejected"]) }).parse(req.body);
    if (!(await one(`UPDATE podcast_applications SET status=$1 WHERE id=$2 RETURNING id`, [status, i]))) throw notFound("Application not found.");
    return { success: true };
  });
  app.delete("/podcasts/applications/:id", async (req) => {
    const { id: i } = id.parse(req.params);
    if (!(await one(`DELETE FROM podcast_applications WHERE id=$1 RETURNING id`, [i]))) throw notFound("Application not found.");
    return { success: true };
  });

  app.get("/podcasts/counts", async () => (await one(
    `SELECT (SELECT count(*) FROM podcast_episodes) AS episodes, (SELECT count(*) FROM podcast_guests) AS guests, (SELECT count(*) FROM podcast_applications) AS applications`))!);
}
