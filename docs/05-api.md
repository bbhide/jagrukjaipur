# API reference

Base path `/api`. JSON in, JSON out. Source: `apps/api/src/routes/`.

## Conventions

- **Errors**: `{ "error": "Human readable message", "code": "validation | bad_request | unauthorized | forbidden | not_found | conflict | rate_limited | bad_origin | error", "fields"?: [{ "path", "message" }] }` with the matching HTTP status.
- **Auth**: cookies. `jj_session` (visitors, set by the OTP flow) and `jj_admin` (admins). Access column below: `public`, `user` (logged-in visitor), `organizer` (logged-in visitor with an organiser account), `admin`.
- **CSRF**: `POST/PUT/DELETE` must carry an `Origin` header listed in `ALLOWED_ORIGINS` (browsers send it automatically).
- **Dates**: `YYYY-MM-DD`; times `HH:MM:SS`; timestamps ISO 8601. All calendar logic is in IST.
- **Rate limits**: 600 req/min per IP globally; tighter limits are noted per route. Exceeding returns 429.
- **Health**: `GET /healthz` (process up), `GET /readyz` (database reachable) — outside `/api`.

## Public

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/site` | public | `{ today, weekend: {friday, saturday, sunday}, filters: { total, free, categories: [{name, slug, icon, color, count}] } }` for the filter bar |
| GET | `/events` | public | Query: `scope` = `upcoming` (default) \| `today` \| `weekend` \| `trending`, `category` (slug), `free=1`, `page` (≥1), `per_page` (1–200, default 12). Returns `{ items: EventCard[], total, page, pages, per_page, has_more }` |
| GET | `/events/:slug` | public | `{ event }` with venue, organiser, categories and — when ticketing is on — `tiers`, `questions`, `has_coupons`. `?track=1` records a view. 404 for drafts / unapproved |
| POST | `/events/:slug/interest` | user | Records that the visitor opened the event or its ticket link; bumps the public "Interests" counter once per user |
| GET | `/categories` | public | Active categories |
| GET | `/categories/:slug` | public | `{ category }` or 404 |
| GET | `/organizers` | public | Communities (`?community=0` for all organisers). `contact` only for logged-in visitors; `has_contact` for everyone |
| GET | `/organizers/:slug` | public | `{ organizer, events }`. Contact and social URLs only for logged-in visitors; `social_available` lists which exist |
| GET | `/podcast` | public | `{ episodes, guests, featured }` |
| POST | `/podcast/applications` | public · 5/hour | `{ name, phone (10 digits), email, designation?, topic, bio, website_url? }`. `website_url` is a honeypot: filled submissions are accepted and discarded |
| GET | `/search?q=` | user | `{ q, events, communities }`; `q` ≥ 2 characters |
| POST | `/submissions` | user · 10/hour | `{ kind: "event" \| "community", payload: {…} }` → admin submissions queue |
| GET | `/sitemap` | public | Slugs for `sitemap.xml` |

`EventCard`: `id, title, slug, short_description, event_date, display_date, event_time, end_date, end_time, image_path, thumb_path, is_free, ticket_url, button_text, ticket_price, is_featured, is_exclusive, has_ticketing, status, views, interests, venue_name, venue_area, categories[], is_recurring, recurrence_type, recurrence_days[], recurrence_day_of_month`. `display_date` is the next occurrence for recurring events.

## Authentication and profile

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/otp/send` | public · 8/10 min per IP, 3/10 min per number | `{ whatsapp_number (10 digits), source_page?, source_button? }` → `{ success }`. Starts a pending session |
| POST | `/auth/otp/verify` | pending session · 15/10 min | `{ otp (4 digits) }` → `{ success, status: "logged_in" \| "need_name", name? }`. 5 attempts per code, 5-minute lifetime, single use |
| POST | `/auth/complete` | verified session | `{ name, email }` → completes first-time registration and sets `wa_logged_in=1` |
| POST | `/auth/logout` | any | Destroys the session |
| GET | `/me` | user | `{ user: { id, whatsapp_number, name, gender, dob, email, instagram_username }, organizer }` |
| PUT | `/me` | user | `{ name, gender?, dob?, email?, instagram_username? }` (Instagram URLs/handles are normalised to a bare username) |

## Ticketing

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/coupons/apply` | public | `{ event_id, coupon_code, subtotal }` → `{ success, discount_amount, code }` or 400 |
| POST | `/bookings` | user | `{ event_id, tier_id, quantity (1–10), attendee_name, attendee_email, attendee_phone, answers: [{question_id, answer}], coupon_code? }`. Amounts are computed on the server. Free total → `{ status: "confirmed", reference }`; paid → `{ status: "payment_required", reference, order: { id, amount, currency, key_id } }`; 503 when Razorpay is not configured |
| POST | `/bookings/:reference/verify` | user (owner) | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` → confirms the booking (idempotent) or 400 |
| GET | `/bookings/:reference` | user (owner) | Booking, event summary and tickets (`code` is what the QR encodes) |
| GET | `/me/bookings` | user | The visitor's bookings |

Fee model (`services/billing.ts`): commission = organiser rate × (subtotal − discount); GST = 18 % of commission; `absorption_mode` decides who pays commission + GST — `organiser` (deducted from payout), `customer` (added to the total), `split` (half each).

## Organizer portal

All routes need a logged-in visitor; everything except `register` and `me` also needs that visitor's organiser account.

| Method | Path | Description |
|---|---|---|
| GET / PUT | `/organizer/me` | Organiser profile (bank account number masked on read) |
| POST | `/organizer/register` | `{ name, email, contact, state, gstin?, about?, bank? }`; 409 if one already exists |
| GET | `/organizer/dashboard` | Totals and per-event sales |
| GET | `/organizer/form-options` | Categories and venues for the event form |
| POST | `/organizer/events` | Multipart. Creates a pending event (free listing or ticketing with `tiers`, `questions`, `coupons` JSON fields) |
| GET / PUT / DELETE | `/organizer/events/:id` | Own events only. Tiers with sales cannot change price or be removed; events with bookings cannot be deleted |
| GET | `/organizer/events/:id/bookings` · `/bookings.csv` | Guest list (CSV cells are escaped against formula injection) |
| POST | `/organizer/checkin` | `{ code }` → `{ result: "ok" \| "duplicate" \| "invalid", … }` (always HTTP 200; 120/min) |
| GET | `/organizer/settlements` | Payout ledger and balance |

## Admin

Prefix `/api/admin`. Every route except `login` requires an admin session.

| Area | Routes |
|---|---|
| Session | `POST /login` `{ username, password }` (10 per 15 min) · `POST /logout` · `GET /me` |
| Dashboard | `GET /dashboard` |
| Events | `GET /events?q=&status=&page=` · `GET /events/form-options` · `GET /events/:id` · `POST /events` · `PUT /events/:id` (multipart, image optional) · `DELETE /events/:id` |
| Venues | `GET /venues` · `GET /venues/areas` · `GET/PUT/DELETE /venues/:id` · `POST /venues` |
| Categories | `GET /categories` · `GET/PUT/DELETE /categories/:id` · `POST /categories` (system category cannot be deleted) |
| Organisers | `GET /organizers?type=` · `GET/PUT/DELETE /organizers/:id` · `POST /organizers` (multipart, logo optional) |
| Users | `GET /users?q=&page=` · `GET /users/export.csv` |
| Analytics | `GET /analytics?range=today\|yesterday\|7days\|30days\|custom&start=&end=` |
| Submissions | `GET /submissions` · `GET /submissions/:id` · `DELETE /submissions/:id` |
| Podcast | `GET/POST /podcasts/episodes` · `GET/PUT/DELETE /podcasts/episodes/:id` · `GET/POST /podcasts/guests` · `GET/PUT/DELETE /podcasts/guests/:id` · `GET /podcasts/applications?status=` · `PUT/DELETE /podcasts/applications/:id` · `GET /podcasts/counts` |
| Ticketing | `GET /ticketing/organizers` · `PUT /ticketing/organizers/:id` · `GET /ticketing/events` · `POST /ticketing/events/:id/approve` · `POST /ticketing/events/:id/reject` `{ reason }` · `GET /ticketing/sales` · `GET/POST /ticketing/settlements` · `GET/POST /ticketing/promos` · `PUT/DELETE /ticketing/promos/:id` · `PUT /ticketing/promos-enabled` |
| Settings | `GET /settings` (never returns secrets) · `GET /settings/ai-status` · `PUT /settings/gemini` · `PUT /settings/razorpay` (keys are tested before they are saved) · `PUT /settings/notifications` · `POST /settings/test-email` · `POST /ai/extract-event` (multipart `image` and/or `text`) |
