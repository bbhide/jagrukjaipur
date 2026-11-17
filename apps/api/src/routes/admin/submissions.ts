import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../../db.js";
import { notFound } from "../../lib/errors.js";

const id = z.coerce.number().int().positive();
const SELECT = `SELECT s.id, s.kind, s.payload, s.status, s.created_at, u.name AS submitter_name, u.whatsapp_number AS submitter_number, u.email AS submitter_email
  FROM submissions s LEFT JOIN users u ON u.id = s.user_id`;

export default async function (app: FastifyInstance) {
  app.get("/submissions", async () => ({ items: await q(`${SELECT} WHERE s.status = 'pending' ORDER BY s.created_at DESC, s.id DESC`) }));

  app.get("/submissions/:id", async (req) => {
    const { id: sid } = z.object({ id }).parse(req.params);
    const row = await one(`${SELECT} WHERE s.id = $1`, [sid]);
    if (!row) throw notFound("Submission not found.");
    return row;
  });

  app.delete("/submissions/:id", async (req) => {
    const { id: sid } = z.object({ id }).parse(req.params);
    const row = await one(`UPDATE submissions SET status = 'deleted' WHERE id = $1 RETURNING id`, [sid]);
    if (!row) throw notFound("Submission not found.");
    return { success: true };
  });
}
