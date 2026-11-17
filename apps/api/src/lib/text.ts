import sanitizeHtml from "sanitize-html";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "item";
}

/** Rich event descriptions are stored as HTML; only a conservative tag set survives. */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const out = sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h2", "h3", "h4", "a", "blockquote", "span"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }) },
  }).trim();
  return out || null;
}

export const normaliseInstagram = (v: string | null | undefined) => {
  if (!v) return null;
  let s = v.trim().split("?")[0]!.replace(/\/$/, "");
  if (s.includes("/")) s = s.split("/").pop()!;
  s = s.replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : null;
};

/** 10-digit Indian mobile → stored as 91XXXXXXXXXX. */
export function normaliseMobile(v: string): string | null {
  const digits = v.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : null;
}
