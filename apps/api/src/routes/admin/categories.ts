import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../../db.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { slugify } from "../../lib/text.js";

const id = z.coerce.number().int().positive();
const bool = z.preprocess((v) => v === true || v === "on" || v === "1" || v === "true", z.boolean());

const schema = z.object({
  name: z.string().trim().min(1, "Category name is required.").max(80),
  icon: z.string().trim().min(1, "Choose an icon.").max(16),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #7C3AED."),
  sort_order: z.coerce.number().int().min(0, "Sort order must be 0–999.").max(999, "Sort order must be 0–999."),
  is_active: bool,
});
const SELECT = `SELECT id, name, slug, icon, color, sort_order, is_active, is_system FROM categories`;

export default async function (app: FastifyInstance) {
  app.get("/categories", async () => ({ items: await q(`${SELECT} ORDER BY sort_order, id`) }));

  app.get("/categories/:id", async (req) => {
    const { id: cid } = z.object({ id }).parse(req.params);
    const row = await one(`${SELECT} WHERE id = $1`, [cid]);
    if (!row) throw notFound("Category not found.");
    return row;
  });

  app.post("/categories", async (req) => {
    const b = schema.parse(req.body);
    const base = slugify(b.name);
    let slug = base;
    for (let n = 2; await one(`SELECT 1 FROM categories WHERE slug = $1`, [slug]); n++) slug = `${base}-${n}`;
    const row = await one<{ id: number }>(
      `INSERT INTO categories (name, slug, icon, color, sort_order, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.name, slug, b.icon, b.color, b.sort_order, b.is_active]);
    return { success: true, id: row!.id, slug };
  });

  app.put("/categories/:id", async (req) => {
    const { id: cid } = z.object({ id }).parse(req.params);
    const b = schema.parse(req.body);
    const row = await one(`UPDATE categories SET name=$1, icon=$2, color=$3, sort_order=$4, is_active=$5 WHERE id=$6 RETURNING id`,
      [b.name, b.icon, b.color, b.sort_order, b.is_active, cid]);
    if (!row) throw notFound("Category not found.");
    return { success: true, id: cid };
  });

  app.delete("/categories/:id", async (req) => {
    const { id: cid } = z.object({ id }).parse(req.params);
    const row = await one<{ is_system: boolean }>(`SELECT is_system FROM categories WHERE id = $1`, [cid]);
    if (!row) throw notFound("Category not found.");
    if (row.is_system) throw badRequest("This is a system category and cannot be deleted.");
    await q(`DELETE FROM categories WHERE id = $1`, [cid]);
    return { success: true };
  });
}
