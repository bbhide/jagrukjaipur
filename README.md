# Jagruk Jaipur

Rebuild of [jagrukjaipur.com](https://jagrukjaipur.com) — Jaipur's event guide, communities directory, podcast hub and ticketing platform — on Astro + Vue, Tailwind CSS, Node.js and PostgreSQL.

| | |
|---|---|
| Frontend | Astro 7 (server-rendered) with Vue 3 islands, Tailwind CSS 4 |
| Backend | Node.js 22, Fastify 5, zod |
| Database | PostgreSQL 16, plain SQL migrations |
| Auth | WhatsApp OTP for visitors, username + password for admins, server-side sessions |
| Deployment | AWS: ECS Fargate, RDS, S3 + CloudFront, ALB |

## Quick start

Requirements: Node.js ≥ 22 and Docker.

```bash
npm install
```

```bash
cp .env.example .env
```

Set `ADMIN_PASSWORD` in `.env` (or leave it empty and the seed prints a generated one), and for local logins set `OTP_DEV_CODE=1234`.

```bash
npm run db:up
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

- Site: http://localhost:4321
- Admin: http://localhost:4321/admin (the admin user from `.env`)
- API: http://localhost:4000/api
- Logging in as a visitor: enter any valid 10-digit mobile number; the OTP is `OTP_DEV_CODE`, or is printed in the API log when that is unset.

`npm run db:seed` loads `db/seed/*.json` — 45 events, 27 organisers, 27 categories, 27 venues and the podcast catalogue, imported from the legacy site's public pages by `scripts/import-reference.mjs`. Event and logo images live in `apps/web/public/uploads/` (git-ignored); re-run the import script to fetch them again.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) and web dev server |
| `npm run build` | Production builds of both apps |
| `npm run db:up` / `db:migrate` / `db:seed` | Start PostgreSQL in Docker, apply migrations, load seed data and create the admin |
| `npm test` | API unit and integration tests (needs the database) |
| `npm run test:e2e` | Playwright browser tests (needs `npm run dev` running and `OTP_DEV_CODE=1234`) |
| `node apps/web/tests/visual-compare.mjs [routes…]` | Side-by-side screenshots of the legacy site and the rebuild at desktop, tablet and mobile widths → `reference/visual/` |
| `npx tsx --env-file=.env apps/api/src/scripts/dev-ticketing-fixture.ts` | Development only: turns one seeded event into a ticketed event (free tier, ₹200 tier, question, coupon `TEST50`) |

## Documentation

1. [Reconnaissance report](docs/01-reconnaissance.md) — routes, components, behaviours and integrations of the legacy site
2. [Admin panel reconnaissance](docs/02-admin-recon.md)
3. [Design system](docs/03-design-system.md)
4. [Architecture](docs/04-architecture.md)
5. [API reference](docs/05-api.md)
6. [Deployment on AWS](docs/06-deployment.md)
7. [QA report and known limitations](docs/07-qa-and-limitations.md)

Database schema: [`db/migrations/001_init.sql`](db/migrations/001_init.sql). Environment variables: [`.env.example`](.env.example).
