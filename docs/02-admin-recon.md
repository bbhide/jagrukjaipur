# Admin panel reconnaissance

Inspected read-only on 17 Nov 2026 while signed in as `admin`. Record values (names, phones, emails) were masked during capture and are not stored anywhere in this repo. Styles come from `reference/snapshot/admin.css`; behaviour from `reference/assets/admin.js`.

## Shell

- `.admin-layout` = fixed left sidebar (`.admin-sidebar`, logo, link list, user chip footer) + `.admin-main` (sticky `.admin-topbar` with ☰ toggle, breadcrumb `Admin / <Page>`, and a `+ Add Event` button) + `.admin-content`.
- Sidebar, in order: 📊 Dashboard · 🎉 Events · 📍 Venues · 🏷 Categories · 🎤 Organisers · 👥 Users · 📈 Analytics · 📥 Submissions · 🎙️ Podcasts & Guests · 🎫 Ticket Organisers · ⏳ Ticketing Events · 💰 Ticket Sales · 💸 Payout Settlements · 🏷️ Listing Promo Codes · ⚙️ Settings & Integrations — then "Site": 🌐 View Public Site (new tab) · 🚪 Sign Out (`confirm('Sign out?')`).
- Building blocks: `.page-title-row` (title, subtitle, primary action), `.stats-grid` / `.stat-card`, `.a-card` (+ `.a-card-header`, `.a-card-title`), `.a-table-wrap` > `.a-table`, `.status-badge.status-{draft,published,cancelled,past}`, `.a-badge.a-badge-{success,danger,muted}`, `.a-btn` + `-primary | -outline | -danger | -sm | -lg`, `.a-search`, `.form-group`, `.form-label`, `.form-input`, `.form-select`, `.actions-cell`, flash message slot at the top of content.
- Login: `/admin/login.php`, username + password, hidden CSRF token, redirect param back to the requested page.
- All mutations are classic form POSTs to the same page with a hidden `action` field and a CSRF token; deletes are GET links or POST forms guarded by `confirm()`.

## Screens

### Dashboard `/admin/index.php`
Title "Welcome back, admin 👋". Six stat cards: Total Events, Published, Upcoming, Total Views, Featured Active, Venues. Two columns (`1fr 320px`, stacks ≤900px): **Recent Events** table (Event · Date · Status · Views · Actions ✏️ 👁) with "View All"; **This Week** list (title, `📅 17 Nov · 11:00 AM · Venue`) followed by quick actions: + Add Event, + Add Venue, 🏷 Manage Categories.

### Events `/admin/events/list.php`
Subtitle "N events total". Filters (GET): search `q`, status select (All / Draft / Published / Cancelled / Past, auto-submit), Filter button. Table: Image · Title (+ flag chips) · Category · Date · Venue · Status · Featured · Views · Actions (✏️ edit, 👁 view on site, 🗑 delete with confirm). 20 rows per page, "Page 1 of N" + Next/Prev.

### Event add / edit `/admin/events/add.php`, `edit.php?id=`
Multipart form. Add page has two submit buttons (🚀 Publish Event, 💾 Save as Draft); edit has 💾 Update Event, 👁 View Live, 🗑 Delete Event. `add.php?submission_id=` pre-fills from a public submission.

| Section | Fields |
|---|---|
| ✨ Gemini AI assistant | poster upload (drag & drop) and/or pasted text → `POST /admin/api/ai_extract_event.php` → fills the form |
| 📝 Basic Information | `title`* (max 300) · `category_id[]`* multi-select, up to 3 · `status` (draft / published / cancelled, + past on edit) · `short_description` (max 500) |
| 📄 Full Description | `description` (rich text / HTML) |
| 📅 Date & Time | `event_date`* · `event_time` · `end_date` · `end_time` |
| 🎤 Organiser | `organizer_id` select (name + contact) |
| 🖼 Event Image | `image` (jpeg, png, webp, gif) with preview |
| 📍 Venue | `venue_id` select, "No venue / TBA" allowed |
| 🎟 Ticket Info | `is_free` · `ticket_url` (button appears only when set) · `button_text` (Get Tickets / Register Now / Buy Now / Book Now / Donate) · `ticket_price` free-text label |
| ⚙️ Options | `is_featured` · `is_exclusive` · `is_recurring` → `recurrence_type` weekly/monthly, `recurrence_days[]` 0–6, `recurrence_day_of_month` 1–31 |

### Venues
List: Venue Name · Area · Address · Maps · Status · Actions (✏️ 🗑). Form: `name`*, `area` (select of Jaipur localities), `is_active`, `address`, `maps_url`* (Google Maps share link), hidden `google_place_id`, `lat`, `lng` (Places autocomplete when a Maps key is configured; manual mode otherwise).

### Categories
List: # · Icon · Name · Slug · Color (swatch + hex) · Order · Status · Actions. 27 categories; the "All Events" pseudo-category (id 1) cannot be deleted. Form: `name`*, `icon` (emoji, 25 quick-pick buttons), `color` (colour input + hex readout), `sort_order` 0–999 ("lower numbers appear first in the filter bar"), `is_active`.

### Organisers
Filter by type (All / Organisers Only / Communities Only). List: # · Name · Type badge · Contact · Status · Actions. Form (multipart): `name`*, `contact`, `is_active`, `is_community`, `logo` (square, ≤5 MB), `category_id[]` themes up to 3, `about`, `features[]` (Paid Events, Group Chat, Workshops, Kid Friendly, Free Events, Networking, Open Mic + custom emoji/name pairs), `social_instagram`, `social_facebook`, `social_twitter`, `social_whatsapp`, `social_website`.

### Users
"N users total", 📥 Export CSV, search `q`. Columns: ID · Name · WhatsApp Number (wa.me link) · Email · Instagram · Interested Events (links) · Gender · DOB · Registered On. Read-only, 20 per page.

### Analytics
Range filter: today / yesterday / 7days / 30days / custom (start, end). Stat cards: New Users, OTPs Sent, Event Views, Events Added, Events Ended, Event Submissions, Community Submissions. Chart.js line charts: View Trends, Registration Trends, Submissions Trends (events vs communities). Tables: Most Viewed Events (event, views in period), Top Categories (category, engagement), Top OTP Pages (source page, OTPs sent), Top Triggers / Buttons (CTA, OTPs sent), Recent OTP Verification Logs (number, source page, trigger button, time requested, SENT / VERIFIED).

### Submissions
Public event submissions: ID · Submitted On · Submitter Info · Event Title & Date · Actions (➕ Add Event → pre-filled add form, 🗑 Delete).

### Podcasts & Guests
Three tabs with counts.
- **Episodes**: Ep # · Thumbnail · Title · Guest · Category · Release Date · Status · Actions (YouTube link, Edit, Delete).
- **Featured Guests**: Photo · Guest Name · Title / Designation · Bio · Social Links · Actions.
- **Guest Applications**: status filter chips (All / Pending / Contacted / Scheduled / Rejected), Applicant · Contact Info · Proposed Topic & Pitch · Submitted · Status & Action (status select + Update, "View Full Pitch" modal, delete).
- Add/edit forms for episodes and guests were not captured; fields are inferred from the list columns and the public page **[A]**.

### Ticket Organisers
Registry: ID · Brand / Entity Name · Contact info · GSTIN / State · Commission Rate · Absorption Mode · Ticketing Sales (Enabled/Disabled) · Status (Approved…) · Edit (inline form; exact fields not captured **[A]**).

### Ticketing Events (moderation queue)
Submitted Event (title, date, submitted time) · Organizer · Type (🎟️ Ticketing / Free Listing) · Listing Fee Status (Paid / Unpaid / Free Listing) · Razorpay Reference · Approval (Pending / Approved / Rejected) · Action (Approve, Reject). Reject opens a modal with a required reason ("emailed to organiser") → "Confirm Reject & Refund".

### Ticket Sales
Stat cards: Total Tickets Sold, Gross Ticket Sales, Platform Commission, GST Collected (18 % on commission), Organizer Payouts. Tables: Sales Performance by Event; Sales Performance by Organiser (Organiser · Commission Rate · Tickets Sold · Gross Sales · Platform Commission · Net Payout Due · Settled Amount · Outstanding Balance).

### Payout Settlements
Organizer Balances (Organizer · Total Earned · Total Settled · Outstanding Due · quick-fill action). **Record Payout Transfer** form: `organizer_id`*, `amount`* (≥0.01), `payment_mode`* (UPI / Bank Transfer / NetBanking / Cash), `summary`*. Settlement Payout Ledger table below.

### Listing Promo Codes
Global switch `listing_promo_enabled`. Create form: `code`*, `discount_type` (percent / fixed), `discount_value`*, `max_uses`, `valid_until`, `is_active`. Table: ID · Promo Code · Discount · Uses / Max Limit · Expiry Date · Status · Created At · Actions (Activate/Deactivate, Delete).

### Settings & Integrations
Four independent forms: Google Gemini (`gemini_api_key`, `gemini_model`; save + test connection), Razorpay (`razorpay_key_id`, `razorpay_key_secret`; save + test), Submission notification recipients (`admin_notification_emails`, comma-separated), Send Test Email. Plus a link to a database migration runner (PHP-specific; replaced by versioned SQL migrations in the rebuild).

## Not captured

Organizer-side portal (dashboard, event submission with tiers / coupons / questions, QR scanner, payouts view) — the Chrome profile was not signed in through WhatsApp OTP on the public site. What the rebuild implements there is derived from the admin's ticketing screens, the public booking form and the marketing copy, and is marked as assumption in the code and docs.

## Note on the capture

During the scripted capture one GET request reached `/admin/migrate.php` (linked from Settings). Its response was a normal page render; whether a bare GET executes pending migrations on the legacy site is unknown.
