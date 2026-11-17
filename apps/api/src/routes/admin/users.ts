import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../../db.js";

const query = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

const SELECT = `SELECT u.id, u.name, u.whatsapp_number, u.email, u.instagram_username, u.gender, u.dob, u.created_at,
  COALESCE((SELECT json_agg(x) FROM (
    SELECT e.title, e.slug FROM event_interests ei JOIN events e ON e.id = ei.event_id WHERE ei.user_id = u.id ORDER BY ei.created_at DESC LIMIT 5
  ) x), '[]'::json) AS interested_events
  FROM users u`;

function filter(term?: string) {
  if (!term) return { where: "", params: [] as unknown[] };
  const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  return { where: `WHERE (u.name ILIKE $1 OR u.whatsapp_number ILIKE $1 OR u.email::text ILIKE $1 OR u.instagram_username ILIKE $1)`, params: [like] };
}

/** Spreadsheet apps treat cells starting with these characters as formulas. */
const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export default async function (app: FastifyInstance) {
  app.get("/users", async (req) => {
    const qs = query.parse(req.query);
    const f = filter(qs.q);
    const total = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM users u ${f.where}`, f.params))!.n;
    const per = 20;
    const items = await q(`${SELECT} ${f.where} ORDER BY u.created_at DESC, u.id DESC LIMIT ${per} OFFSET ${(qs.page - 1) * per}`, f.params);
    return { items, total, page: qs.page, pages: Math.max(1, Math.ceil(total / per)) };
  });

  app.get("/users/export.csv", async (req, reply) => {
    const qs = query.parse(req.query);
    const f = filter(qs.q);
    const rows = await q(`${SELECT} ${f.where} ORDER BY u.created_at DESC, u.id DESC`, f.params);
    const head = ["ID", "Name", "WhatsApp Number", "Email", "Instagram", "Interested Events", "Gender", "DOB", "Registered On"];
    const lines = [head.map(csvCell).join(",")];
    for (const u of rows) {
      lines.push([
        u.id, u.name, u.whatsapp_number, u.email, u.instagram_username, (u.interested_events as { title: string }[]).map((e) => e.title).join("; "),
        u.gender, u.dob ?? "", u.created_at ? new Date(u.created_at).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "",
      ].map(csvCell).join(","));
    }
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="users-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}.csv"`);
    return "﻿" + lines.join("\r\n") + "\r\n";
  });
}
