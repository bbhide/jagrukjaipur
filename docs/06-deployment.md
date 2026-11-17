# Deployment on AWS

## Target topology

```
Route 53 ─▶ CloudFront ─┬─▶ /uploads/*  ─▶ S3 bucket (private, Origin Access Control)
                        └─▶ everything else ─▶ Application Load Balancer (HTTPS, ACM cert)
                                                 ├─ /api/*  ─▶ ECS Fargate service "api"  (port 4000, 2+ tasks)
                                                 └─ default ─▶ ECS Fargate service "web"  (port 4321, 2+ tasks)
                                                                     │  API_INTERNAL_URL (Service Connect / internal ALB)
                                                                     ▼
                                                   RDS PostgreSQL 16 (Multi-AZ, private subnets)
```

| Concern | Service | Notes |
|---|---|---|
| Containers | ECR + ECS Fargate | Images from `apps/api/Dockerfile` and `apps/web/Dockerfile`, both built from the repo root |
| Database | RDS PostgreSQL 16 | Private subnets, security group open only to the API tasks, automated backups + PITR, `DATABASE_SSL=true` |
| Uploads | S3 + CloudFront | `UPLOAD_DRIVER=s3`, `S3_BUCKET=…`, `UPLOAD_PUBLIC_BASE=/uploads`; API task role needs `s3:PutObject` on `uploads/*`. Add `@aws-sdk/client-s3` to `apps/api` when enabling this driver |
| Secrets | Secrets Manager / SSM Parameter Store | `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD`, WhatsApp token, Razorpay keys — injected as ECS task secrets, never baked into images |
| TLS / DNS | ACM + Route 53 | Certificate on CloudFront (us-east-1) and on the ALB |
| Logs | CloudWatch Logs | Both services log JSON to stdout (`awslogs` driver). API logs carry a request id and redact cookies, OTPs and passwords |
| Metrics / alarms | CloudWatch | ALB 5xx rate, target response time, ECS CPU/memory, RDS connections/storage; alarm to SNS |
| Health checks | ALB target groups | API `GET /healthz` (liveness) and `/readyz` (checks the database); web `GET /favicon/favicon.ico` |
| WAF | AWS WAF on CloudFront | Managed common rule set + a rate rule on `/api/auth/*` as defence in depth on top of the app's own limits |

## Environment

Every variable is documented in `.env.example`. Production essentials:

```
NODE_ENV=production
PUBLIC_SITE_URL=https://jagrukjaipur.com
ALLOWED_ORIGINS=https://jagrukjaipur.com,https://www.jagrukjaipur.com
COOKIE_SECURE=true
SESSION_SECRET=<64 random bytes>          # must be identical on web and api (signs internal SSR calls)
DATABASE_URL=postgres://…  DATABASE_SSL=true
OTP_PROVIDER=whatsapp-cloud  WHATSAPP_PHONE_NUMBER_ID=…  WHATSAPP_ACCESS_TOKEN=…  WHATSAPP_OTP_TEMPLATE=…
UPLOAD_DRIVER=s3  S3_BUCKET=…  AWS_REGION=ap-south-1
API_INTERNAL_URL=http://api.jagruk.internal:4000     # web service only
```

The API refuses to start in production with the default `SESSION_SECRET` or with `OTP_PROVIDER=console`.

## Release procedure

1. Build and push both images, tagged with the git SHA.
2. Run migrations as a one-off ECS task using the new API image: `node dist/scripts/migrate.js`. Migrations are forward-only SQL files recorded in `schema_migrations`.
3. First deploy only: `node dist/scripts/seed.js` with `ADMIN_USERNAME` / `ADMIN_PASSWORD` set, to create the admin account (and optionally load `db/seed`).
4. Update the `api` service, wait for healthy targets, then update `web` (rolling deployment, minimum healthy 100 %).
5. Smoke test: `/readyz`, home page, one event page, admin login.

Rollback: redeploy the previous task definition. Migrations must stay backward compatible for one release.

## Cut-over from the legacy PHP site

1. Export legacy MySQL data and load it into PostgreSQL (events, venues, organisers, users, podcast tables). `scripts/import-reference.mjs` only covers what is publicly visible; a full migration script needs the legacy schema.
2. Copy `/assets/img/uploads/*` to the S3 bucket under `uploads/`.
3. Legacy URLs keep working: `/about.php`, `/contact.php`, `/privacy.php`, `/search.php` redirect to their clean URLs; `/event/:slug`, `/category/:slug`, `/organizer/:slug`, `/tickiting`, `/podcast` are unchanged.
4. Register the WhatsApp OTP template and Razorpay webhook/keys for the new origin, then switch DNS.
