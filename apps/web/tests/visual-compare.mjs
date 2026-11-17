/**
 * Visual comparison: captures the reference site and the rebuild at three viewports and writes
 * side-by-side sheets to reference/visual/. Usage:
 *   node tests/visual-compare.mjs [route ...]        (defaults to the main public routes)
 *   REF=https://jagrukjaipur.com NEW=http://localhost:4321 node tests/visual-compare.mjs /podcast
 */
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REF = process.env.REF ?? "https://jagrukjaipur.com";
const NEW = process.env.NEW ?? "http://127.0.0.1:4321";
const out = join(dirname(fileURLToPath(import.meta.url)), "../../../reference/visual");
mkdirSync(out, { recursive: true });

const routes = process.argv.slice(2).length ? process.argv.slice(2) : [
  "/", "/events-in-jaipur-today", "/events-this-weekend-in-jaipur", "/trending-events-in-jaipur", "/category/music",
  "/communities", "/organizer/kythera", "/podcast", "/tickiting", "/about", "/contact", "/privacy", "/search", "/organizer",
  "/event/jaipur-design-festival",
];
const viewports = { desktop: [1440, 900], tablet: [820, 1180], mobile: [390, 844] };
const only = process.env.VIEWPORTS?.split(",");
const MAX_H = Number(process.env.MAX_H ?? 6000);

// Freeze motion and reveal everything so both captures are deterministic.
const freeze = `*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
.slide-up,.fade-in{opacity:1!important;transform:none!important}.hero-slide.slide-1{opacity:1!important}
.wa-bubble,.install-banner,#ios-install-banner{display:none!important}`;

const browser = await chromium.launch();
for (const [name, [width, height]] of Object.entries(viewports)) {
  if (only && !only.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: name === "mobile", hasTouch: name === "mobile" });
  for (const route of routes) {
    const shots = [];
    for (const base of [REF, NEW]) {
      const page = await ctx.newPage();
      try {
        await page.goto(base + route, { waitUntil: "networkidle", timeout: 45000 });
        await page.addStyleTag({ content: freeze });
        // Trigger lazy images.
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(400);
        const h = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), MAX_H);
        shots.push({ buf: await page.screenshot({ clip: { x: 0, y: 0, width, height: h }, fullPage: true }), h, full: await page.evaluate(() => document.documentElement.scrollHeight) });
      } catch (e) {
        shots.push({ buf: await sharp({ create: { width, height: 200, channels: 3, background: "#400" } }).png().toBuffer(), h: 200, full: -1 });
        console.error(`  ! ${base}${route}: ${e.message.split("\n")[0]}`);
      }
      await page.close();
    }
    const H = Math.max(shots[0].h, shots[1].h), gap = 24;
    const file = join(out, `${name}${route === "/" ? "_home" : route.replace(/[^a-z0-9]+/gi, "_")}.png`);
    await sharp({ create: { width: width * 2 + gap, height: H, channels: 3, background: "#ff00ff" } })
      .composite([{ input: shots[0].buf, left: 0, top: 0 }, { input: shots[1].buf, left: width + gap, top: 0 }]).png().toFile(file);
    console.log(`${name} ${route}  ref=${shots[0].full}px new=${shots[1].full}px  Δ=${shots[1].full - shots[0].full}px`);
  }
  await ctx.close();
}
await browser.close();
