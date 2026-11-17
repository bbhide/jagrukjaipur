#!/usr/bin/env node
// Imports public reference data from jagrukjaipur.com into db/seed/*.json and
// downloads referenced images into apps/web/public/uploads/.
// Plain Node 22 ESM, no dependencies. Idempotent: existing files are never refetched.
// Only plain GETs of public pages/images are issued.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = path.join(ROOT, 'reference/snapshot');
const PAGES = path.join(SNAP, 'pages');
const SEED = path.join(ROOT, 'db/seed');
const UPLOADS = path.join(ROOT, 'apps/web/public/uploads');
const ORIGIN = 'https://jagrukjaipur.com';
const UA = 'Mozilla/5.0';
const DEFAULT_COLOR = '#7C3AED';

for (const d of [PAGES, SEED, UPLOADS]) fs.mkdirSync(d, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const stats = { pagesFetched: 0, imagesDownloaded: 0, imageBytes: 0, imagesExisting: 0, imageFailures: [] };

// ───────────── fetch helpers ─────────────
async function get(url, binary = false) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(600);
    }
  }
  throw lastErr;
}

async function fetchPage(urlPath, file) {
  const dest = path.join(PAGES, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return false;
  await sleep(300);
  const html = await get(ORIGIN + urlPath);
  fs.writeFileSync(dest, html);
  stats.pagesFetched++;
  return true;
}

const imageQueue = new Map(); // filename -> absolute url
function queueImage(src) {
  if (!src) return null;
  let url;
  try {
    url = new URL(decode(src), ORIGIN + '/');
  } catch {
    return null;
  }
  if (url.hostname !== 'jagrukjaipur.com' && url.hostname !== 'www.jagrukjaipur.com') return null;
  const filename = decodeURIComponent(path.basename(url.pathname));
  if (!filename) return null;
  if (!imageQueue.has(filename)) imageQueue.set(filename, ORIGIN + url.pathname);
  return '/uploads/' + filename;
}

async function downloadImages() {
  for (const [filename, url] of imageQueue) {
    const dest = path.join(UPLOADS, filename);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      stats.imagesExisting++;
      continue;
    }
    try {
      await sleep(300);
      const buf = await get(url, true);
      fs.writeFileSync(dest, buf);
      stats.imagesDownloaded++;
      stats.imageBytes += buf.length;
    } catch (e) {
      stats.imageFailures.push(`${filename} (${e.message})`);
    }
  }
}

// ───────────── text helpers ─────────────
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™',
  bull: '•', middot: '·', laquo: '«', raquo: '»', times: '×', deg: '°', eacute: 'é',
};
function decode(s) {
  if (s == null) return s;
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
// HTML -> plain text. <br> becomes newline; block ends become newlines.
function text(html, keepNewlines = false) {
  if (html == null) return '';
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decode(s).replace(/ /g, ' ');
  if (keepNewlines) {
    return s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return s.replace(/\s+/g, ' ').trim();
}
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3]) : null;
};
const slugify = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const read = (file) => fs.readFileSync(path.join(PAGES, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(PAGES, file));

// Balanced <div> inner HTML starting at index of the opening tag.
function divInner(html, openIdx) {
  const openEnd = html.indexOf('>', openIdx) + 1;
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = openEnd;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(openEnd, m.index);
  }
  return html.slice(openEnd);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(s) {
  if (!s) return null;
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(s);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${String(mon).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}
function parseTime(s) {
  if (!s) return null;
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
const upperHex = (c) => c.toUpperCase();

// ───────────── step 1: discover + fetch pages ─────────────
const sitemap = fs.readFileSync(path.join(SNAP, 'sitemap.xml'), 'utf8');
const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1].trim()));
const sitemapEventSlugs = sitemapLocs.map((u) => /\/event\/([^/?#]+)$/.exec(u)?.[1]).filter(Boolean);
const sitemapCatSlugs = sitemapLocs.map((u) => /\/category\/([^/?#]+)$/.exec(u)?.[1]).filter(Boolean);

const trendingHtml = read('trending-events-in-jaipur.html');
const trendingSlugs = [...trendingHtml.matchAll(/data-ticket-url="\/event\/([^"]+)"/g)].map((m) => decode(m[1]));
const extraEventSlugs = trendingSlugs.filter((s) => !sitemapEventSlugs.includes(s));
const eventSlugs = [...new Set([...sitemapEventSlugs, ...trendingSlugs])];

const communitiesHtml = read('communities.html');
const communitySlugs = [...new Set([...communitiesHtml.matchAll(/href="\/organizer\/([^"/?#]+)"/g)].map((m) => decode(m[1])))];

async function safeFetch(urlPath, file, label) {
  try { await fetchPage(urlPath, file); return true; }
  catch (e) { failures.push(`${label}: fetch failed (${e.message})`); return false; }
}

for (const slug of eventSlugs) await safeFetch(`/event/${slug}`, `event_${slug}.html`, `event ${slug}`);
for (const slug of communitySlugs) await safeFetch(`/organizer/${slug}`, `organizer_${slug}.html`, `organizer ${slug}`);
for (const slug of sitemapCatSlugs) await safeFetch(`/category/${slug}`, `category_${slug}.html`, `category ${slug}`);

// ───────────── listing cards (home, trending, today, weekend, category pages…) ─────────────
const listingFiles = ['trending-events-in-jaipur.html', 'events-in-jaipur-today.html', 'events-this-weekend-in-jaipur.html',
  '_free_1.html', '_page_2.html', 'organizer_kythera.html',
  ...fs.readdirSync(PAGES).filter((f) => /^category_.*\.html$/.test(f))];
const listingSources = [{ name: 'index.html', html: fs.readFileSync(path.join(SNAP, 'index.html'), 'utf8') },
  ...listingFiles.filter(exists).map((f) => ({ name: f, html: read(f) }))];

function parseCards(html) {
  const cards = new Map();
  const parts = html.split(/<a\b(?=[^>]*class="event-card[\s"])/).slice(1);
  for (const part of parts) {
    const head = part.slice(0, part.indexOf('>') + 1);
    const slug = (/data-ticket-url="\/event\/([^"]+)"/.exec(head) || /href="\/event\/([^"]+)"/.exec(head) || [])[1];
    if (!slug) continue;
    const endIdx = part.indexOf('</a>\n');
    const body = endIdx > 0 ? part.slice(0, endIdx) : part;
    const desc = /class="event-card-desc"[^>]*>([\s\S]*?)<\/p>/.exec(body);
    const interests = /([\d,]+)\s*Interests/.exec(body);
    const thumb = /<div class="event-card-image">\s*<img[^>]*src="([^"]+)"/.exec(body);
    const cats = [...body.matchAll(/<span class="badge badge-cat"[^>]*style="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => {
      const t = text(m[2]);
      const mm = /^(\S+)\s+(.+)$/.exec(t);
      const color = /(?:^|[;\s])color:\s*(#[0-9a-fA-F]{6})/.exec(m[1]);
      return { icon: mm ? mm[1] : '', name: mm ? mm[2] : t, color: color ? upperHex(color[1]) : null };
    });
    const btn = /<span class="btn btn-accent btn-sm[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(body);
    const priceM = /<span class="event-price[^"]*">([\s\S]*?)<\/span>/.exec(body);
    cards.set(decode(slug), {
      slug: decode(slug),
      short_description: desc ? text(desc[1]) : null,
      interests: interests ? parseInt(interests[1].replace(/,/g, ''), 10) : null,
      thumb_src: thumb ? thumb[1] : null,
      cats,
      is_exclusive: /ribbon-exclusive/.test(body),
      is_free: /badge-free/.test(body),
      price_text: priceM ? text(priceM[1]) : '',
      button_text: btn ? text(btn[1]) : null,
      date_text: text((/class="event-card-date"[^>]*>([\s\S]*?)<\/div>/.exec(body) || [])[1] || '').replace(/\d[\d,]*\s*Interests/, '').replace(/👍🏻?/, '').trim(),
    });
  }
  return cards;
}
const cardBySlug = new Map();
const nameColor = new Map(); // category display name -> color (from badges anywhere)
for (const src of listingSources) {
  for (const [slug, c] of parseCards(src.html)) {
    if (!cardBySlug.has(slug)) cardBySlug.set(slug, c);
    else { const prev = cardBySlug.get(slug); for (const k of Object.keys(c)) if (prev[k] == null || prev[k] === '') prev[k] = c[k]; }
    for (const cat of c.cats) if (cat.color) nameColor.set(cat.name, cat.color);
  }
}
// community-card / other badges with colors
for (const f of fs.readdirSync(PAGES).filter((f) => f.endsWith('.html'))) {
  const html = read(f);
  for (const m of html.matchAll(/<span class="badge[^"]*"\s+style="([^"]*)"[^>]*>\s*([^<\s]+)\s+([^<]+?)\s*<\/span>/g)) {
    const color = /(?:^|[;\s])color:\s*(#[0-9a-fA-F]{6})/.exec(m[1]);
    const name = decode(m[3]).trim();
    if (color && !nameColor.has(name)) nameColor.set(name, upperHex(color[1]));
  }
}

// ───────────── categories ─────────────
const indexHtml = listingSources[0].html;
const filterBar = [];
{
  const fb = indexHtml.slice(indexHtml.indexOf('id="filter-bar"'));
  const end = fb.indexOf('id="filter-scroll"') >= 0 ? fb.search(/<\/div>\s*<\/div>\s*<\/div>/) : -1;
  const seg = end > 0 ? fb.slice(0, end) : fb.slice(0, 20000);
  for (const m of seg.matchAll(/<a href="\/category\/([^"]+)"[\s\S]*?<\/a>/g)) {
    const color = /cat-count"\s+style="background:\s*(#[0-9a-fA-F]{6})/.exec(m[0]);
    const icon = /<span aria-hidden="true">([^<]+)<\/span>/.exec(m[0]);
    filterBar.push({ slug: decode(m[1]), color: color ? upperHex(color[1]) : null, icon: icon ? text(icon[1]) : null });
  }
}
const chipColor = new Map();
for (const f of fs.readdirSync(PAGES).filter((f) => f.endsWith('.html'))) {
  const html = read(f);
  for (const m of html.matchAll(/<a href="\/category\/([^"]+)"[^>]*class="filter-chip[^"]*"[\s\S]*?<\/a>/g)) {
    const color = /cat-count"\s+style="background:\s*(#[0-9a-fA-F]{6})/.exec(m[0]);
    if (color && !chipColor.has(decode(m[1]))) chipColor.set(decode(m[1]), upperHex(color[1]));
  }
}
for (const f of filterBar) if (f.color) chipColor.set(f.slug, f.color);

const categories = [];
{
  const order = [...filterBar.map((f) => f.slug).filter((s) => sitemapCatSlugs.includes(s)), ...sitemapCatSlugs];
  const seen = [...new Set(order)];
  const catPageInfo = {};
  for (const slug of sitemapCatSlugs) {
    const file = `category_${slug}.html`;
    if (!exists(file)) { failures.push(`category ${slug}: page missing`); continue; }
    const html = read(file);
    const h1 = /<h1[^>]*class="heading-lg"[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    const icon = /category-icon-lg"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    const name = h1 ? text(h1[1].replace(/<span[\s\S]*?<\/span>/g, '')) : null;
    if (!name) failures.push(`category ${slug}: no name`);
    catPageInfo[slug] = { name, icon: icon ? text(icon[1]) : null };
  }
  seen.forEach((slug, i) => {
    const info = catPageInfo[slug] || {};
    const bar = filterBar.find((f) => f.slug === slug);
    const name = info.name || slug;
    const color = chipColor.get(slug) || nameColor.get(name) || DEFAULT_COLOR;
    categories.push({ name, slug, icon: info.icon || bar?.icon || '🎉', color, sort_order: i + 1, is_active: true, is_system: false });
  });
  categories.unshift({ name: 'All Events', slug: 'all', icon: '🌟', color: '#6C3BE4', sort_order: 0, is_active: true, is_system: true });
}
const catSlugByName = new Map(categories.map((c) => [c.name, c.slug]));

// ───────────── events ─────────────
const venues = new Map(); // key -> venue
const organizers = new Map(); // slug -> organizer
const events = [];

function sidebarSections(aside) {
  const out = {};
  const parts = aside.split(/class="sidebar-section-label">/).slice(1);
  for (const p of parts) {
    const label = text(p.slice(0, p.indexOf('</div>')));
    out[label] = p.slice(p.indexOf('</div>') + 6);
  }
  return out;
}
const sectionBy = (sections, needle) => {
  const k = Object.keys(sections).find((l) => l.includes(needle));
  return k ? sections[k] : null;
};
const DAY_IDX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const cutAt = (s, re) => { const i = s.search(re); return i > 0 ? s.slice(0, i) : s; };

for (const slug of eventSlugs) {
  const file = `event_${slug}.html`;
  if (!exists(file)) { failures.push(`event ${slug}: no saved page`); continue; }
  try {
    const html = read(file);
    const card = cardBySlug.get(slug) || {};
    const main = html.slice(html.indexOf('class="event-detail"'));
    const title = text((/<h1[^>]*class="event-title"[^>]*>([\s\S]*?)<\/h1>/.exec(main) || [])[1]);
    if (!title) throw new Error('empty title');

    const hero = /class="event-hero-img"[\s\S]*?<img[^>]*src="([^"]+)"/.exec(main);
    const heroSrc = hero ? decode(hero[1]) : null;
    const image_path = queueImage(heroSrc);
    let thumb_path = null;
    if (card.thumb_src) thumb_path = queueImage(card.thumb_src);
    else if (heroSrc) {
      const b = path.basename(heroSrc);
      thumb_path = queueImage(heroSrc.replace(b, 'thumb_' + b));
    }
    const head = main.slice(0, main.indexOf('event-title'));
    const is_exclusive = /ribbon-exclusive/.test(head);

    // categories (displayed order, max 3)
    const catNames = [...head.matchAll(/<span class="badge badge-cat"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => {
      const t = text(m[1]);
      const mm = /^(\S+)\s+(.+)$/.exec(t);
      return mm ? mm[2] : t;
    });
    const category_slugs = [];
    for (const n of catNames) {
      const s = catSlugByName.get(n);
      if (!s) failures.push(`event ${slug}: unknown category "${n}"`);
      else if (!category_slugs.includes(s)) category_slugs.push(s);
    }
    category_slugs.splice(3);

    const views = /([\d,]+)\s+views/.exec(main);
    const aside = /<aside[\s\S]*?<\/aside>/.exec(main)?.[0] || '';
    const sections = sidebarSections(aside);

    // date / time
    const dateSec = cutAt(sectionBy(sections, 'Date') || '', /sidebar-divider/);
    const dateVal = text((/class="sidebar-value[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(dateSec) || [])[1]);
    const event_date = parseDate(dateVal) || parseDate(card.date_text);
    const subs = [...dateSec.matchAll(/<div class="sidebar-sub"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => text(m[1]));
    let event_time = null, end_date = null, end_time = null;
    let is_recurring = false, recurrence_type = null, recurrence_days = [], recurrence_day_of_month = null;
    for (const s of subs) {
      if (s.startsWith('🕐')) {
        const times = [...s.matchAll(/\d{1,2}:\d{2}\s*[AP]M/gi)].map((m) => parseTime(m[0]));
        event_time = times[0] || null;
        if (times[1]) end_time = times[1];
      } else if (/^Ends:/i.test(s)) {
        end_date = parseDate(s);
        const t = parseTime(s);
        if (t) end_time = t;
      } else if (/Recurring:/i.test(s)) {
        is_recurring = true;
        const rt = s.replace(/^.*Recurring:\s*/i, '');
        const days = [...rt.matchAll(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g)].map((m) => DAY_IDX[m[1].toLowerCase()]);
        if (days.length) { recurrence_type = 'weekly'; recurrence_days = [...new Set(days)].sort(); }
        else {
          const dm = /(\d{1,2})(?:st|nd|rd|th)/.exec(rt);
          if (dm && /month/i.test(rt)) { recurrence_type = 'monthly'; recurrence_day_of_month = parseInt(dm[1], 10); }
          else failures.push(`event ${slug}: unrecognised recurrence "${rt}"`);
        }
      }
    }
    if (!event_date) throw new Error('no event_date');

    // venue
    let venue_name = null;
    const venueSec = sectionBy(sections, 'Venue');
    if (venueSec) {
      const vblock = cutAt(venueSec, /sidebar-divider/);
      const nameHtml = (/class="sidebar-value"[^>]*>([\s\S]*?)<\/div>/.exec(vblock) || [])[1];
      venue_name = nameHtml ? text(nameHtml) : null;
      if (venue_name) {
        const vsubs = [...vblock.matchAll(/<div class="sidebar-sub"([^>]*)>([\s\S]*?)<\/div>/g)];
        const area = vsubs[0] ? text(vsubs[0][2]).replace(/,?\s*Jaipur$/i, '').trim() : null;
        const addr = vsubs[1] ? text(vsubs[1][2]) : null;
        const mapTag = /<a\b[^>]*id="view-on-maps-btn"[^>]*>/.exec(vblock)?.[0];
        const maps_url = mapTag ? attr(mapTag, 'data-ticket-url') : null;
        const key = venue_name.toLowerCase();
        if (!venues.has(key)) venues.set(key, { name: venue_name, area: area || null, address: addr || null, maps_url: maps_url || null });
        else { const v = venues.get(key); v.area ||= area; v.address ||= addr; v.maps_url ||= maps_url; }
      }
    }

    // price
    let ticket_price = null, is_free = /badge-free/.test(head);
    const priceSec = sectionBy(sections, 'Price');
    if (priceSec) {
      const pv = text((/class="sidebar-value([^"]*)"[^>]*>([\s\S]*?)<\/div>/.exec(priceSec) || [])[2]);
      if (/free/i.test(pv)) is_free = true;
      else if (pv) {
        // Only "₹ <label>" is a real price label; anything else (e.g. "Check organiser") is the site's no-price fallback.
        const pm = /^(?:🎟\s*)?₹\s*(.+)$/.exec(pv);
        ticket_price = pm ? pm[1].trim() : null;
      }
    }
    if (is_free) ticket_price = null;

    // CTA
    const ctaTag = /<a\b[^>]*id="get-tickets-btn"[^>]*>([\s\S]*?)<\/a>/.exec(aside) || /<a\b[^>]*btn-accent[^>]*>([\s\S]*?)<\/a>/.exec(aside);
    let ticket_url = null, button_text = card.button_text || 'Get Tickets';
    if (ctaTag) {
      const tag = ctaTag[0].slice(0, ctaTag[0].indexOf('>') + 1);
      const raw = attr(tag, 'data-ticket-url');
      if (raw && /^https?:\/\//i.test(raw)) ticket_url = raw;
      const bt = text(ctaTag[1]).replace(/^🎟\s*/, '').trim();
      if (bt) button_text = bt;
    }

    // organiser
    let organizer_slug = null;
    const orgSec = sectionBy(sections, 'Organiser');
    if (orgSec) {
      const oblock = cutAt(orgSec, /<!--|class="event-share-row/);
      const link = /<a href="\/organizer\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(oblock);
      const plain = /class="sidebar-value"[^>]*>([\s\S]*?)<\/div>/.exec(oblock);
      const oname = link ? text(link[2]) : plain ? text(plain[1]) : null;
      if (oname) {
        organizer_slug = link ? decode(link[1]) : slugify(oname);
        const contact = (/class="sidebar-sub"[^>]*>([\s\S]*?)<\/div>/.exec(oblock) || [])[1];
        const c = contact ? text(contact) || null : null;
        if (!organizers.has(organizer_slug)) organizers.set(organizer_slug, { name: oname, slug: organizer_slug, contact: c, is_community: false });
        else if (c && !organizers.get(organizer_slug).contact) organizers.get(organizer_slug).contact = c;
      }
    }

    // description (inner HTML)
    let description = null;
    const dm = /<div class="event-desc"[^>]*>/.exec(main);
    if (dm) description = divInner(main, dm.index).trim() || null;

    events.push({
      title, slug, short_description: card.short_description ?? null, description, event_date, event_time, end_date, end_time,
      organizer_slug, venue_name, image_path, thumb_path, is_free, ticket_url, button_text, ticket_price,
      is_featured: false, is_exclusive, status: 'published', views: views ? parseInt(views[1].replace(/,/g, ''), 10) : 0,
      interests: card.interests ?? 0, category_slugs,
      is_recurring, recurrence_type, recurrence_days, recurrence_day_of_month,
    });
    if (!card.short_description) failures.push(`event ${slug}: no short_description (card not found)`);
  } catch (e) {
    failures.push(`event ${slug}: ${e.message}`);
  }
}

// ───────────── organisers ─────────────
const SOCIAL_KEYS = { instagram: 'social_instagram', facebook: 'social_facebook', twitter: 'social_twitter', x: 'social_twitter', whatsapp: 'social_whatsapp', website: 'social_website', web: 'social_website' };
const communityCards = new Map();
for (const part of communitiesHtml.split(/<a href="\/organizer\//).slice(1)) {
  const slug = decode(part.slice(0, part.indexOf('"')));
  const body = part.slice(0, part.indexOf('</a>'));
  const name = text((/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(body) || [])[1]);
  const logo = (/<img[^>]*src="([^"]+)"/.exec(body) || [])[1];
  const cats = [...body.matchAll(/<span class="badge"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => {
    const t = text(m[1]); const mm = /^(\S+)\s+(.+)$/.exec(t); return mm ? mm[2] : t;
  });
  const para = /<p[^>]*>([\s\S]*?)<\/p>/.exec(body);
  const contact = /View Profile →<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/.exec(body);
  communityCards.set(slug, { name, logo, cats, para: para ? text(para[1], true) : '', contact: contact ? text(contact[1]) : null });
}

function splitSpecial(full) {
  const m = /What makes us Special\?/i.exec(full);
  if (!m) return { about: full.trim() || null, special: null };
  return { about: full.slice(0, m.index).trim() || null, special: full.slice(m.index + m[0].length).trim() || null };
}

const profileSlugs = [...new Set([...communitySlugs, ...organizers.keys()])];
for (const slug of profileSlugs) {
  const isCommunityListed = communitySlugs.includes(slug);
  const base = organizers.get(slug) || { slug, name: null, contact: null };
  const card = communityCards.get(slug);
  // plain organisers: fetch the public profile too (for logo/about/socials)
  if (!isCommunityListed) await safeFetch(`/organizer/${slug}`, `organizer_${slug}.html`, `organizer ${slug}`);
  const file = `organizer_${slug}.html`;
  const html = exists(file) ? read(file) : null;
  const o = {
    name: base.name || card?.name || slug, slug, contact: base.contact || card?.contact || null,
    is_community: isCommunityListed, logo_path: null, about: null, special: null, features: [],
    social_instagram: null, social_facebook: null, social_twitter: null, social_whatsapp: null, social_website: null,
    category_slugs: [],
  };
  if (card) {
    o.name = card.name || o.name;
    const { about, special } = splitSpecial(card.para);
    o.about = about; o.special = special;
    o.category_slugs = card.cats.map((n) => catSlugByName.get(n)).filter(Boolean);
    for (const n of card.cats) if (!catSlugByName.get(n)) failures.push(`organizer ${slug}: unknown category "${n}"`);
  }
  if (html) {
    const h1 = text((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1]);
    if (h1) o.name = h1;
    if (/class="community-badge"/.test(html)) o.is_community = true;
    const logo = /<div class="community-header"[\s\S]*?<img[^>]*src="([^"]+)"/.exec(html);
    if (logo) o.logo_path = queueImage(logo[1]);
    const about = /class="community-about"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    if (about) {
      const { about: a, special } = splitSpecial(text(about[1], true));
      if (a) o.about = a;
      if (special) o.special = special;
    }
    for (const m of html.matchAll(/<span class="community-feature-tag">([\s\S]*?)<\/span>/g)) {
      const t = text(m[1]);
      const mm = /^(\S+)\s+(.+)$/.exec(t);
      o.features.push(mm ? { icon: mm[1], label: mm[2] } : { icon: '', label: t });
    }
    for (const m of html.matchAll(/<a\b[^>]*class="social-icon-btn[^>]*>/g)) {
      const url = attr(m[0], 'data-ticket-url') || attr(m[0], 'href');
      const label = (attr(m[0], 'aria-label') || (attr(m[0], 'data-source-button') || '').replace(/^Social:\s*/i, '')).toLowerCase().trim();
      const key = SOCIAL_KEYS[label];
      if (key && url && url !== '#') o[key] = url;
      else if (!key) failures.push(`organizer ${slug}: unknown social "${label}"`);
    }
  }
  if (!o.logo_path && card?.logo) o.logo_path = queueImage(card.logo);
  if (!o.name) failures.push(`organizer ${slug}: empty name`);
  organizers.set(slug, o);
}
const organizerList = [
  ...communitySlugs.map((s) => organizers.get(s)),
  ...[...organizers.values()].filter((o) => !communitySlugs.includes(o.slug)).sort((a, b) => a.name.localeCompare(b.name)),
].map((o) => ({
  name: o.name, slug: o.slug, contact: o.contact, is_community: o.is_community, logo_path: o.logo_path, about: o.about,
  special: o.special, features: o.features, social_instagram: o.social_instagram, social_facebook: o.social_facebook,
  social_twitter: o.social_twitter, social_whatsapp: o.social_whatsapp, social_website: o.social_website,
  category_slugs: o.category_slugs,
}));

// ───────────── podcast ─────────────
const podcastEpisodes = [], podcastGuests = [];
if (exists('podcast.html')) {
  const ph = read('podcast.html');
  const gridStart = ph.indexOf('class="podcast-grid"');
  const gridEnd = ph.indexOf('FEATURED GUESTS', gridStart);
  const grid = ph.slice(gridStart, gridEnd > 0 ? gridEnd : undefined);
  for (const part of grid.split('<div class="podcast-card glass-box">').slice(1)) {
    try {
      const yt = /openPodcastModal\('([^']+)'/.exec(part)?.[1];
      const ep = /EP #(\d+)/.exec(part)?.[1];
      const title = text((/<h3 class="podcast-card-title"[^>]*>([\s\S]*?)<\/h3>/.exec(part) || [])[1]);
      const cat = text((/class="podcast-cat-tag">([\s\S]*?)<\/span>/.exec(part) || [])[1]);
      const date = parseDate(text((/podcast-cat-tag">[\s\S]*?<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/.exec(part) || [])[1]));
      const guestBlock = /class="podcast-card-guest">([\s\S]*?)<\/div>/.exec(part)?.[1] || '';
      const gt = /<span[^>]*>\(([\s\S]*?)\)<\/span>/.exec(guestBlock);
      const guest_name = text(guestBlock.replace(/<span[\s\S]*?<\/span>/g, '').replace(/<strong>[\s\S]*?<\/strong>/, '').replace(/👤/, ''));
      const desc = text((/class="podcast-card-desc"[^>]*>([\s\S]*?)<\/p>/.exec(part) || [])[1]);
      const ytUrl = /href="(https:\/\/youtu\.be\/[^"]+)"/.exec(part)?.[1];
      if (!yt || !ep || !title) throw new Error('missing id/episode/title');
      podcastEpisodes.push({
        episode_number: parseInt(ep, 10), title, youtube_id: yt, youtube_url: ytUrl ? decode(ytUrl) : `https://youtu.be/${yt}`,
        guest_name: guest_name || null, guest_title: gt ? text(gt[1]) : null,
        category: cat || null, description: desc || null, release_date: date,
      });
    } catch (e) { failures.push(`podcast episode: ${e.message}`); }
  }
  podcastEpisodes.sort((a, b) => b.episode_number - a.episode_number);
  const gs = ph.indexOf('class="guests-grid"');
  if (gs > 0) {
    const gsec = ph.slice(gs, ph.indexOf('</section>', gs));
    let order = 0;
    for (const part of gsec.split('<div class="guest-card glass-box">').slice(1)) {
      const name = text((/class="guest-name"[^>]*>([\s\S]*?)<\/h3>/.exec(part) || [])[1]);
      if (!name) continue;
      const img = /<img[^>]*class="guest-avatar-img"/.test(part) ? /<img[^>]*src="([^"]+)"[^>]*class="guest-avatar-img"/.exec(part)?.[1] : null;
      const socials = {};
      const sblock = /class="guest-socials">([\s\S]*?)<\/div>/.exec(part)?.[1] || '';
      for (const m of sblock.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)) {
        const host = (() => { try { return new URL(decode(m[1])).hostname.replace(/^www\./, '').split('.')[0]; } catch { return 'link'; } })();
        socials[host] = decode(m[1]);
      }
      podcastGuests.push({
        name, designation: text((/class="guest-title"[^>]*>([\s\S]*?)<\/div>/.exec(part) || [])[1]) || null,
        bio: text((/class="guest-bio"[^>]*>([\s\S]*?)<\/p>/.exec(part) || [])[1]) || null,
        photo_path: img ? queueImage(img) : null, socials, sort_order: order++,
      });
    }
  }
}

// ───────────── images + write ─────────────
await downloadImages();

const venueList = [...venues.values()];
const write = (name, data) => fs.writeFileSync(path.join(SEED, name), JSON.stringify(data, null, 2) + '\n');
events.sort((a, b) => a.event_date.localeCompare(b.event_date) || a.title.localeCompare(b.title));
write('categories.json', categories);
write('venues.json', venueList);
write('organizers.json', organizerList);
write('events.json', events);
write('podcast_episodes.json', podcastEpisodes);
write('podcast_guests.json', podcastGuests);

const orgSlugs = new Set(organizerList.map((o) => o.slug));
const venueNames = new Set(venueList.map((v) => v.name));
for (const e of events) {
  if (e.organizer_slug && !orgSlugs.has(e.organizer_slug)) failures.push(`event ${e.slug}: organizer ${e.organizer_slug} not in organizers.json`);
  if (e.venue_name && !venueNames.has(e.venue_name)) failures.push(`event ${e.slug}: venue missing`);
}

console.log('── import-reference summary ──');
console.log(`pages fetched this run: ${stats.pagesFetched}`);
console.log(`categories.json        ${categories.length}`);
console.log(`venues.json            ${venueList.length}`);
console.log(`organizers.json        ${organizerList.length} (${organizerList.filter((o) => o.is_community).length} communities)`);
console.log(`events.json            ${events.length} (sitemap ${sitemapEventSlugs.length}, extra from trending: ${extraEventSlugs.length})`);
console.log(`podcast_episodes.json  ${podcastEpisodes.length}`);
console.log(`podcast_guests.json    ${podcastGuests.length}`);
console.log(`images: ${imageQueue.size} referenced, ${stats.imagesDownloaded} downloaded (${(stats.imageBytes / 1048576).toFixed(2)} MB), ${stats.imagesExisting} already present, ${stats.imageFailures.length} failed`);
if (stats.imageFailures.length) console.log('image failures:\n  ' + stats.imageFailures.join('\n  '));
console.log(failures.length ? `parse/fetch problems (${failures.length}):\n  ` + failures.join('\n  ') : 'no parse failures');
