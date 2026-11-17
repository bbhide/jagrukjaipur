# Architecture

```
jagrukjaipur.com/
├── apps/
│   ├── web/                  Astro 7 (SSR, Node adapter) + Vue 3 islands + Tailwind 4
│   │   ├── src/pages/        One file per route. Public pages, /admin/*, /organizer/*
│   │   ├── src/layouts/      Base.astro (public chrome + SEO), Admin.astro (admin shell)
│   │   ├── src/components/   Astro components (server-rendered, no JS)
│   │   ├── src/components/vue/  Interactive islands (login, booking, podcast player…)
│   │   ├── src/lib/          api.ts (the only place that talks to the API), format.ts, types.ts, page.ts, admin.ts
│   │   ├── src/scripts/      Browser code: site.ts (public behaviours), admin.ts, http.ts (fetch helper for islands)
│   │   ├── src/styles/       tokens.css (@theme design tokens), components.css (component layer), admin.css
│   │   └── src/middleware.ts Admin guard + security headers
│   └── api/                  Fastify 5 + PostgreSQL (pg) + zod
│       ├── src/app.ts        App factory: plugins, CSRF origin check, error handler, route registration
│       ├── src/routes/       public.ts, auth.ts, bookings.ts, organizer.ts, admin/*.ts
│       ├── src/services/     Domain logic reused by routes (events, otp, billing…)
│       ├── src/lib/          session, password, uploads, dates, text, errors
│       ├── src/scripts/      migrate.ts, seed.ts
│       └── test/             node:test suites
├── db/migrations/            Versioned SQL, applied in order by `npm run db:migrate`
├── db/seed/                  JSON imported from the legacy site's public pages
├── scripts/                  import-reference.mjs (rebuilds db/seed from the legacy site)
├── docs/                     Recon, design system, architecture, API, deployment, QA
└── reference/                Capture of the legacy site used for visual comparison (git-ignored)
```

## Request flow

```
Browser ──HTML──▶ Astro SSR (apps/web) ──JSON──▶ Fastify API (apps/api) ──SQL──▶ PostgreSQL
   └──────────── fetch /api/* (islands) ────────────▲
```

- Pages are rendered on the server from API data, so content is indexable and nothing is hard-coded.
- Islands call `/api/*` on the same origin. In development Vite proxies `/api` to the API; in production the load balancer routes `/api/*` to the API service.
- The web tier never touches the database.

## Conventions

### API (`apps/api`)
- Routes are Fastify plugins registered under `/api`. Validate every input with zod (`schema.parse(req.body)`); throw `badRequest/notFound/…` from `lib/errors.ts`. The error handler turns these into `{ error, code, fields? }` with the right status.
- SQL goes through `q()`, `one()`, `tx()` from `db.ts`, always parameterised. `DATE`/`TIME` columns are returned as strings (`YYYY-MM-DD`, `HH:MM:SS`); `NUMERIC` as numbers. The connection timezone is `Asia/Kolkata`.
- Auth: `requireUser(req)` / `getUser(req)` for visitors, `requireAdmin(req)` for admins (`lib/session.ts`). Files in `routes/admin/` are auto-registered behind the admin guard with prefix `/api/admin`; each default-exports `async (app: FastifyInstance) => {}`.
- Success responses are plain JSON objects. Mutations return `{ success: true, … }`.
- Uploads: `readMultipart(req)` + `saveImage(file, kind)` from `lib/uploads.ts`.

### Web (`apps/web`)
- Server-side data: `api(path, { request: Astro.request, query, body })` from `lib/api.ts`. Public pages start with `const { siteData, me } = await loadShell(Astro)` and wrap content in `<Base … siteData={siteData} me={me}>`.
- Styling: Tailwind utilities for layout/spacing, plus the component classes in `styles/components.css` (`btn`, `event-card`, `glass-box`, `filter-chip`, `section`, `container`, `empty-state`, …). Design tokens are Tailwind theme values (`text-muted`, `bg-card`, `border-line`, `text-primary-light`, `rounded-lg` = 22px, `rounded-card` = 14px, `rounded-pill`). Breakpoints are used as `max-lg:` (≤900px), `max-md:` (≤768px), `max-sm:` (≤640px), `max-xs:` (≤480px). No inline `onmouseover` handlers; hover states are CSS.
- Members-only actions carry `class="needs-auth-ticket-btn"` with `data-ticket-url`, `data-source-page`, `data-source-button` (and `data-event-slug` for events). `AuthModals.vue` handles them globally.
- Scroll reveal: add `slide-up` or `fade-in`.
- Admin pages use `<Admin title active>` and classic form posts handled in the page frontmatter with `handlePost(Astro, async (form) => …)` (`lib/admin.ts`), which redirects with a flash message. Admin API calls go through `adminApi(Astro, path, opts)`. Destructive buttons/forms carry `data-confirm="…"`.

## Authentication

| Who | Mechanism |
|---|---|
| Visitors | WhatsApp OTP: 4-digit code, 5-minute lifetime, 5 attempts, 3 sends per number per 10 minutes. Codes are stored as HMACs. Session = random 256-bit token in an HttpOnly, SameSite=Lax cookie (`jj_session`), stored hashed in `sessions`. A readable `wa_logged_in=1` flag mirrors the legacy site so the UI can gate actions without a round trip. |
| Admins | Username + password (scrypt), separate HttpOnly SameSite=Strict cookie (`jj_admin`), 12-hour sessions, login rate-limited. |
| CSRF | State-changing API requests must carry an allowed `Origin`; Astro's `checkOrigin` covers form posts to pages. |

OTP delivery is pluggable (`OTP_PROVIDER`): `console` for development, `whatsapp-cloud` for Meta's Cloud API.
