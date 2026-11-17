/** Image uploads: every image is re-encoded to WebP (which also strips metadata) and stored locally or on S3. */
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { randomBytes } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { config } from "../config.js";
import { badRequest } from "./errors.js";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const dir = resolve(process.cwd(), config.UPLOAD_DIR);

async function put(name: string, data: Buffer): Promise<string> {
  if (config.UPLOAD_DRIVER === "s3") {
    // Loaded lazily so local development does not need the AWS SDK installed.
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3" as string);
    const s3 = new S3Client({ region: config.AWS_REGION });
    await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: `uploads/${name}`, Body: data, ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" }));
  } else {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), data);
  }
  return `${config.UPLOAD_PUBLIC_BASE}/${name}`;
}

export interface SavedImage { path: string; thumb: string | null }

/** `kind` prefixes the filename (event, org_logo, guest). Events also get a 640px card thumbnail. */
export async function saveImage(file: { mimetype: string; buffer: Buffer }, kind: "event" | "org_logo" | "guest"): Promise<SavedImage> {
  if (file.buffer.length > 5 * 1024 * 1024) throw badRequest("Image is too large (max 5 MB).");
  const id = randomBytes(7).toString("hex");
  let img: Sharp;
  // The declared MIME type is only a hint; the decoded format is what counts.
  try {
    img = sharp(file.buffer).rotate();
    const { format } = await img.metadata();
    if (!format || !ALLOWED.has(`image/${format}`)) throw new Error("unsupported");
  } catch { throw badRequest("Please upload a JPEG, PNG, WebP or GIF image."); }
  const main = await img.clone().resize({ width: kind === "event" ? 1600 : 600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const path = await put(`${kind}_${id}.webp`, main);
  let thumb: string | null = null;
  if (kind === "event") thumb = await put(`thumb_event_${id}.webp`, await img.clone().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer());
  return { path, thumb };
}

export async function removeImage(publicPath: string | null | undefined) {
  if (!publicPath || config.UPLOAD_DRIVER !== "local") return;
  await unlink(join(dir, basename(publicPath))).catch(() => {});
}

/** Reads a multipart request into plain fields (repeated names become arrays) and buffered files. */
export async function readMultipart(req: any): Promise<{ fields: Record<string, any>; files: Record<string, { mimetype: string; buffer: Buffer; filename: string }> }> {
  const fields: Record<string, any> = {}; const files: Record<string, any> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (buffer.length) files[part.fieldname] = { mimetype: part.mimetype, buffer, filename: part.filename };
    } else {
      const key = part.fieldname.replace(/\[\]$/, "");
      if (part.fieldname.endsWith("[]")) (fields[key] ??= []).push(part.value);
      else fields[key] = part.value;
    }
  }
  return { fields, files };
}
