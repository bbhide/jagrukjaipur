# QA report and known limitations

Run on 17 Nov 2026 against the local stack (web `127.0.0.1:4321`, API `127.0.0.1:4000`, PostgreSQL 16 in Docker, seed data imported from the legacy site that morning).

## Automated checks

| Check | Command | Result |
|---|---|---|
| API type check | `npx tsc --noEmit` in `apps/api` | 0 errors |
| Web type check | `npx astro check` in `apps/web` | 0 errors, 0 warnings |
| API unit + integration tests | `npm test` | 31 passed, 0 failed |
| Browser end-to-end tests | `npm run test:e2e` | 28 passed, 0 failed (27 desktop, 1 mobile) |
| Production builds | `npm run build` | API and web both build |

What the tests cover:

- **API** (`apps/api/test`): IST date maths, weekend window, weekly/monthly recurrence; fee calculation for all three absorption modes with discounts and rounding; listing order, paging, free filter, trending order, filter-bar counts vs listings; 404s and input validation; cross-origin POST blocked; the full OTP flow (bad number, wrong code, replay, registration, profile update, Instagram normalisation, logout); search gating; podcast application validation and honeypot; venue endpoint; admin API rejecting anonymous callers and wrong passwords.
- **Browser** (`apps/web/tests/e2e`): 15 public routes load with no console errors and no failed same-origin requests; every internal link on five hub pages resolves; real 404s; legacy `.php` redirects; sitemap/robots/manifest; homepage "Load More" to the end of the lineup; free filter; mobile drawer; login dialog copy per trigger; wrong OTP, registration, search and profile editing; opening an event as a logged-in visitor; event detail content and `Event` JSON-LD; podcast form validation with values preserved; admin guard, bad credentials, all 15 admin sections, sign-out.

Checked by hand or by the builders with curl, not covered by the automated suites: admin create/edit/delete for events (with image upload), venues, categories, organisers, podcast episodes/guests, promo codes, settlements and event moderation; CSV exports (including formula-injection escaping); a free booking end to end with QR passes; coupon application; Razorpay signature verification with a test secret; organizer registration, event submission, guest list and check-in (ok / duplicate / invalid); cross-organizer access denial.

## Visual comparison

`node apps/web/tests/visual-compare.mjs` captures the live legacy site and the rebuild at 1440, 820 and 390 px and writes side-by-side sheets to `reference/visual/`. Full-page height difference (rebuild − legacy), in px:

| Route | Desktop | Tablet | Mobile |
|---|---|---|---|
| `/` | +4 | +4 | +6 |
| `/events-in-jaipur-today` | 0 | 0 | 0 |
| `/communities` | 0 | 0 | 0 |
| `/organizer/kythera` | −1 | −1 | 0 |
| `/podcast` | −6 | −7 | −6 |
| `/tickiting` | 0 | 0 | 0 |
| `/about`, `/contact`, `/privacy` | 0 | 0 | 0 |
| `/search` (logged out) | 0 | 0 | 0 |
| `/organizer` (logged out) | +6 | +5 | +5 |
| `/event/jaipur-design-festival` | 0 | −2 | −1 |
| `/event/late-night-comedy` | 0 | −2 | −1 |
| `/events-this-weekend-in-jaipur`, `/trending-events-in-jaipur`, `/category/music` | not comparable — see below | | |

The homepage, event detail, podcast and admin dashboard sheets were also reviewed by eye: structure, spacing, type and colour match.

The three listing routes marked "not comparable" differ only because the live site gained events during the day (its "All Events" count went from 28 to 41 between the morning import and the final run), so it lists more cards than the local seed. Card markup and per-card dimensions match. Re-running `scripts/import-reference.mjs` and `npm run db:seed` brings the data back in line.

## Known limitations and unimplemented functionality

**Not observable on the legacy site, so built from inference (marked in code comments)**
- The organizer portal after login (registration form, dashboard, event editor, guest list, scanner, payouts, profile). The data model and rules come from the admin's ticketing screens, the public booking form and the marketing copy. Assumptions: no listing fee is charged; editing a rejected event resubmits it; tiers with sales cannot be repriced or removed.
- Logged-in search results, the booking confirmation / pass page, podcast admin add/edit forms, the ticket-organiser edit form, success/error wording of the podcast application, and the venue page's empty state.
- Server rules that cannot be seen from outside: OTP lifetime and retry limits, how "Interests" are counted (here: once per logged-in visitor who opens an event or its ticket link), the exact ordering of events that share a date and time.

**Integrations that need real credentials before they can be verified**
- WhatsApp OTP delivery (`whatsapp-cloud` provider) — written against Meta's Cloud API template format, never exercised with a live account.
- Razorpay — order creation, signature verification and idempotent confirmation are implemented and the signature path is tested with a dummy secret; a real payment was not made. Refunds on event rejection are a logged stub.
- Gemini event auto-fill — implemented; only the "not configured" and "bad key" paths were exercised.
- Ticket delivery by WhatsApp / e-mail (PDF + QR), rejection e-mails to organisers and the "Send Test Email" button are stubs: there is no mail or messaging transport yet. Passes are available on the `/booking/<reference>` page.
- S3 uploads: the driver is written but `@aws-sdk/client-s3` is not installed; local disk is used in development.
- Microsoft Clarity loads only when `PUBLIC_CLARITY_ID` is set.

**Deliberate differences from the legacy site**
- Unknown URLs return a real 404 page (the legacy site serves the homepage with HTTP 200).
- Search lives at `/search`; `/search.php` redirects. Admin URLs are clean (`/admin/events`, `/admin/events/new`) rather than `.php` files.
- Deletes in the admin are POST forms, not GET links. The PHP migration runner page is replaced by `npm run db:migrate`.
- The camera QR scanner was compiled and served but not exercised with a real camera.
- Google Places autocomplete on the venue form is not implemented (manual entry, as the legacy admin does when no Maps key is configured). Searchable select boxes (TomSelect) in the admin are plain selects.
- The admin "Category" multi-select is a set of pill checkboxes limited to three.

**Data**
- The seed contains only what is public: 28 upcoming events, no past events, no users, bookings or analytics history. Podcast descriptions are the ~100-character excerpts shown on the public page. A full migration needs an export of the legacy MySQL database (see the cut-over section of the deployment guide).

**Operational notes**
- In the Astro standalone build, files uploaded at runtime to the local `public/uploads` directory are not part of the built client bundle; production is expected to use the S3 driver behind CloudFront.
- Upcoming-event ordering and paging happen in memory because recurring events need their next occurrence computed first. That is fine for hundreds of live events; beyond that the next-occurrence date should be materialised in SQL.
- No AWS infrastructure-as-code is included; the deployment guide describes the target topology and release steps.
