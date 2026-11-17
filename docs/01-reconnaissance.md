# Reconnaissance report — jagrukjaipur.com

Snapshot taken 17 Nov 2026. Raw HTML/CSS/JS of every page listed here is in `reference/snapshot/`.

Legend: **[O]** observed directly in markup, scripts or network responses · **[A]** assumed / inferred, not verified.

## 1. What the site is

An events-discovery and ticketing platform for Jaipur. Server-rendered PHP behind nginx + Varnish-style cache, one global stylesheet (`style.css`, 42 KB), two scripts (`main.js`, `auth.js`), and heavy use of inline `style=""` attributes for page-specific layout. Dark "premium" theme, mobile-first, installable as a PWA.

## 2. Route inventory

| Route | Purpose | Gate |
|---|---|---|
| `/` (`?page=N`, `?free=1`) | Hero, upcoming events grid (12/page, "Load More"), ticketing CTA banner, communities spotlight | public |
| `/event/:slug` | Event detail: breadcrumb, banner, meta, rich description, auto-FAQ, T&C, sticky sidebar (date, venue, map link, price, tickets, organiser), share row, booking form | card click is login-gated |
| `/category/:slug` | Category header (icon, title, count) + events grid; 26 slugs in sitemap, 15 with live events | public |
| `/events-in-jaipur-today` | Events active today | public |
| `/events-this-weekend-in-jaipur` | Weekend events grouped by day heading | public |
| `/trending-events-in-jaipur` | All upcoming events ordered by popularity | public |
| `/communities` | Directory of 17 organiser/community profiles | public |
| `/organizer/:slug` | Community profile: logo, type, description, feature tags, "Show Contact Info" (gated), upcoming events | public |
| `/organizer` → `/organizer/register.php` | Organizer signup | WhatsApp login |
| `/organizer/dashboard.php` etc. | Organizer portal (events, tiers, coupons, questions, sales, scanner, payouts) | organizer login — **not inspected** |
| `/podcast` | Podcast landing: hero stats, featured episode embed, about, 12 episode cards (YouTube modal), guest application form | public |
| `/tickiting` (sic) | Organizer marketing page: stats, 6 features, 5 steps, FAQ accordion, CTAs | public |
| `/search.php?q=` (`/search`) | Search events & communities | WhatsApp login |
| `/about`, `/contact`, `/privacy` (`.php` variants 301 → clean URL) | Static content in a glass card | public |
| `/admin/*` | Admin panel, username + password, CSRF token, own stylesheet `admin.css` | admin login — **not inspected** |
| `/api/*.php` | JSON endpoints (see §5) | mixed |
| `/sitemap.xml`, `/robots.txt`, `/sw.js`, `/favicon/site.webmanifest` | SEO + PWA | public |
| anything else | Falls through to the homepage with HTTP 200 (no 404 page) **[O]** | — |

## 3. Shared chrome

- **Navbar** (sticky, 64 px, blurred): logo · pill search (max 380 px) · `🎙️ Podcast` (orange outline) · `🎟️ Sell Tickets` (violet outline) · `👤 Sign In` / profile name · mobile search icon · hamburger. ≤768 px hides the desktop buttons and shows the hamburger; ≤640 px hides the search field.
- **Mobile drawer** (right, 86 % / max 360 px, overlay blur): auth card or user card → two highlight cards (tickets, podcast) → three link groups → WhatsApp channel + Instagram/YouTube. Closes on overlay, ✕, Esc, internal link, or resize >768 px.
- **Category filter bar** (sticky under navbar, horizontal scroll): All Events, Trending, Podcast, Free Events, then every category that has upcoming events, each with a coloured count pill; active chip auto-scrolls to centre.
- **Footer**: brand + blurb + YouTube/Instagram, "Explore" (11 links), "Info" (7 links), bottom bar.
- **Floating**: WhatsApp channel bubble (pops in after 1.5 s; icon-only ≤480 px), scroll-to-top (after 400 px), Android install banner (`beforeinstallprompt`), iOS Safari install sheet (after 3 s), copy toast.
- **Modals**: WhatsApp login (3 steps), Edit Profile.

## 4. Interactions and motion

| Behaviour | Detail |
|---|---|
| Scroll reveal | `.fade-in` / `.slide-up` gain `.is-visible` via IntersectionObserver (threshold 0.1) |
| Hero | Two background photos cross-fade on a 12 s loop with slow zoom; gradient overlay + two radial glows |
| Event card hover | lift −6 px, border lighten, image zoom 1.06, interest chip glows |
| Buttons | lift −2 px + stronger coloured shadow |
| Counters | `[data-count]` count up over 2 s when 50 % visible |
| Load more | fetches `/?page=N`, appends cards, swaps pagination; at the end shows "That's all, folks!" with category chips |
| Share | `navigator.share`, falling back to clipboard + toast |
| Form submit | global handler swaps the submit button for a spinner + contextual label, blocks double submit, 25 s safety reset |
| Flash messages | auto-collapse after 4 s |
| FAQ | accordion on event and ticketing pages |
| Podcast | episode card opens a YouTube embed modal with autoplay |

States: empty state block (icon, heading, text, CTA), "Login Required" card on gated pages, `.shimmer` skeleton utility (defined, unused on public pages), payment "Verifying Ticket Reservation…" overlay.

## 5. Functionality

### 5.1 WhatsApp OTP login **[O]**
- Any element with `.needs-auth-ticket-btn` (event cards, Get Tickets, search, map link, contact info, sell tickets…) is intercepted in the capture phase. If cookie `wa_logged_in=1` is absent, the login modal opens and remembers the target URL plus `source_page` / `source_button` (lead attribution). Modal copy changes with the source (tickets, search, community, maps, contact).
- Step 1 `POST /api/auth_send_otp.php {whatsapp_number, source_page, source_button}` — 10 digits, `pattern=[0-9]{10}`.
- Step 2 `POST /api/auth_verify_otp.php {otp}` — 4 digits → `{success, status: "logged_in" | "need_name"}`.
- Step 3 (new users) `POST /api/auth_set_name.php {name, email}` — both required.
- On success: internal targets navigate, external targets open in a new tab and the page reloads.
- Errors: inline red text under the form; `data.error` from the server or "Network error. Please try again."
- Session: PHP session cookie `jagruk_session` (HttpOnly, 30 days) + readable flag cookie `wa_logged_in`. **[A]** OTP is delivered through a WhatsApp Business provider; expiry, retry limits and rate limiting are not observable.

### 5.2 Profile **[O]**
`GET /api/profile_get.php` → `{success, user:{whatsapp_number, name, gender, dob, email, instagram_username}}`; 401 clears the flag cookie and reloads. `POST /api/profile_update.php` with the same fields. The modal refuses to close until gender, DOB and email are filled. Instagram input is normalised to a bare username. Name is cached in `localStorage.jj_user_name`.

### 5.3 Events
- Fields seen: title, slug, banner + thumbnail (webp), 1–3 categories (emoji, colour), start date/time, optional end date, venue name, area, full address, map link, short + rich description, price label (`Free`, `₹ 199`, `₹ Registration`), external ticket URL, CTA label (`Get Tickets` / `Book Now`), organiser name + phone, view count, "interests" count, "JJ Exclusive" ribbon, cancelled badge. **[O]**
- Listing rules: 12 per page; today = events whose date range covers today; weekend = Fri–Sun grouped by day; trending = by popularity. **[A]** exact ordering formula and how "interests" is computed.
- Detail page auto-generates four FAQs and `Event` JSON-LD from event fields. **[O]**

### 5.4 Native ticketing **[O]** (form), **[A]** (server)
Booking form on events that sell through the platform: tier select (price per tier), quantity, attendee info, up to 3 custom questions, coupon (`POST /api/apply_coupon.php {event_id, coupon_code, subtotal}` → `{discount_amount}` or `{error}`), bill breakdown. Fee maths runs client-side: commission rate (default 15 %) + 18 % GST on the fee, absorbed by `organiser`, `customer` or `split` 50/50. Total ₹0 → "Complete Free Registration", otherwise Razorpay Checkout → verification overlay. Tickets are delivered as PDF + QR over WhatsApp and email; organisers scan QR at the door; weekly payouts — all per marketing copy, not verified.

### 5.5 Other forms
- **Podcast guest application** `POST /podcast` `action=apply_podcast_guest`: name*, phone*, email*, designation, topic*, bio*, plus a hidden honeypot `website_url`.
- **Contact**: no form — an email address and social links. `?subject=` query is accepted but unused in the markup.
- **Search**: GET form, `q`, blocked client-side until logged in; server also renders "Login Required".

### 5.6 Integrations **[O]**
Google Fonts (Outfit, DM Sans) · Microsoft Clarity · Razorpay Checkout · YouTube embeds · Google Maps links · WhatsApp channel link · Instagram/YouTube profiles · service worker (network-first HTML, stale-while-revalidate assets).

### 5.7 SEO **[O]**
Per-page title, description, keywords, canonical, robots, Open Graph, Twitter card; JSON-LD `WebSite` + `SearchAction`, `ItemList` of `SiteNavigationElement`, `ItemList` of events on listings, `Event` on detail; `sitemap.xml` (62 URLs), `robots.txt` disallowing `/admin/`, `/api/`, search.

## 6. Not yet inspected (needs a login)

1. Admin panel — every screen behind `/admin/login.php`.
2. Organizer portal — registration form after OTP, dashboard, event editor, tiers/coupons/questions, sales, scanner, payouts.
3. Logged-in user views — search results, ticket confirmation, any "my tickets" screen.
4. Server-side rules — OTP lifetime, rate limits, payment verification, payout calculation.

Nothing in these areas will be invented; they are built only after inspection or marked as assumptions.
