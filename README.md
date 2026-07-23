# NestJS Auth & RBAC API

Production-oriented backend with NestJS, TypeScript, Prisma (PostgreSQL), Redis (ioredis), Zod validation, Argon2 password hashing, and JWT access/refresh authentication with role-based permissions.

## Stack

- **NestJS 11** + TypeScript (strict)
- **Zod** + **nestjs-zod** — env config, request validation, OpenAPI schemas (single source of truth)
- **Prisma 6** + PostgreSQL 16
- **ioredis** — permission cache and access-token denylist (with circuit breaker; auth checks fail closed when Redis is unavailable)
- **Argon2id** — password hashing
- **JWT** — access + refresh token rotation

## Quick start

### 1. Environment

```bash
cp .env.example .env
# Edit secrets (JWT_* must be at least 32 characters)
```

### 2. Infrastructure & database

One-shot bootstrap (postgres, redis, mailpit — no app container; migrations + seed on dev and e2e DBs):

```bash
npm run dev:bootstrap
```

### 3. Run API

```bash
npm run start:dev
```

- API: [http://localhost:3000](http://localhost:3000)
- Swagger (if `SWAGGER_ENABLED=true`): [http://localhost:3000/docs](http://localhost:3000/docs)
- Health: [http://localhost:3000/health](http://localhost:3000/health)
- Readiness: [http://localhost:3000/health/ready](http://localhost:3000/health/ready)
- Mailpit UI (if running): [http://localhost:8025](http://localhost:8025)

## Local mail testing (Mailpit)

Outbound mail (password reset, email verification) is enqueued by the API and
sent asynchronously by the **worker** via `MailService`. By default the worker
writes messages to the logger (`MAIL_TRANSPORT=log`). To capture real SMTP
traffic locally:

```bash
docker compose up -d mailpit redis
```

In one terminal start the API; in another start the worker:

```bash
npm run start:dev          # API
npm run start:dev:worker   # mail worker
```

Set in `.env`:

```env
MAIL_TRANSPORT=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
```

Trigger a mail flow (e.g. `POST /api/v1/auth/password-reset/request`), then open
[http://localhost:8025](http://localhost:8025) to read the message.

The same SMTP adapter works in production with your provider's host, port,
credentials, and TLS settings (SendGrid, Amazon SES, Postmark, etc.). With
`docker compose up`, the `worker` service sets `MAIL_TRANSPORT=smtp` and
`SMTP_HOST=mailpit`; scale API and worker independently as needed.

| Variable                  | Default                | Description                                        |
| ------------------------- | ---------------------- | -------------------------------------------------- |
| `MAIL_TRANSPORT`          | `log`                  | `log` or `smtp` (worker only)                      |
| `MAIL_FROM`               | `no-reply@example.com` | From address                                       |
| `MAIL_WORKER_CONCURRENCY` | `5`                    | Parallel mail jobs per worker instance             |
| `MAIL_JOB_ATTEMPTS`       | `3`                    | BullMQ retry attempts for failed sends             |
| `QUEUE_PREFIX`            | _(empty)_              | Optional BullMQ Redis key prefix                   |
| `SMTP_HOST`               | `localhost`            | SMTP server host                                   |
| `SMTP_PORT`               | `1025`                 | SMTP server port                                   |
| `SMTP_USER`               | _(empty)_              | SMTP username (optional for Mailpit)               |
| `SMTP_PASSWORD`           | _(empty)_              | SMTP password                                      |
| `SMTP_SECURE`             | `false`                | Use TLS on connect (typically `true` for port 465) |

## Redis

Local Docker Redis uses `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` /
`REDIS_DB`. For managed providers with in-transit encryption (ElastiCache,
Upstash, Redis Cloud, etc.), set `REDIS_TLS=true` alongside the provider's
host, port, and password.

| Variable         | Default      | Description                                 |
| ---------------- | ------------ | ------------------------------------------- |
| `REDIS_HOST`     | _(required)_ | Redis hostname                              |
| `REDIS_PORT`     | _(required)_ | Redis port (often `6379` or `6380` for TLS) |
| `REDIS_PASSWORD` | _(empty)_    | Redis AUTH password                         |
| `REDIS_DB`       | `0`          | Redis logical database index                |
| `REDIS_TLS`      | `false`      | Enable TLS (`true` for managed Redis)       |

## Default admin (after seed)

| Field    | Value                                       |
| -------- | ------------------------------------------- |
| Email    | `admin@example.com` (or `SEED_ADMIN_EMAIL`) |
| Password | `Admin123!@#` (or `SEED_ADMIN_PASSWORD`)    |
| Role     | `admin` (all permissions)                   |

## Auth flow examples

### Bearer tokens (mobile / default)

Native and mobile clients omit `X-Auth-Client` and receive tokens in the JSON body.
Use `Authorization: Bearer <accessToken>` on protected routes.

```bash
# Login
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"Admin123!@#"}'

# Use accessToken from response
curl -s http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer <accessToken>"

# Refresh
curl -s -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'

# Logout
curl -s -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer <accessToken>" \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'
```

### Web cookies + CSRF (browser / SPA)

Browser clients send `X-Auth-Client: web` on `POST /api/v1/auth/login`, `register`,
and `refresh`. The API sets httpOnly cookies (`access_token`, `refresh_token`) and
a readable `csrf_token` cookie for double-submit CSRF protection. The JSON body is
`{}` — tokens are not returned in the response.

Mutating requests (`POST`, `PATCH`, `DELETE`, …) that use cookie auth must include
`X-CSRF-Token` with the same value as the `csrf_token` cookie. Safe methods (`GET`,
`HEAD`, `OPTIONS`) do not require CSRF. Login, register, and password-reset flows
are CSRF-exempt.

Send cookies on every request (`credentials: 'include'` in `fetch`, or `withCredentials`
in axios). CORS is configured with `credentials: true` — see
`apps/api/src/app-config.ts`.

Implementation: `apps/api/src/auth/auth-cookie.service.ts` (cookie set/clear),
`apps/api/src/auth/guards/csrf.guard.ts` (CSRF validation).

```bash
# Login — save cookies to a jar
curl -s -c cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Auth-Client: web' \
  -d '{"email":"admin@example.com","password":"Admin123!@#"}'
# Response body: {}

# Authenticated read — cookies sent automatically
curl -s -b cookies.txt http://localhost:3000/api/v1/auth/me

# Mutating request — CSRF header must match csrf_token cookie
CSRF=$(awk '$6 == "csrf_token" {print $7}' cookies.txt)
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -H 'X-Auth-Client: web' \
  -H "X-CSRF-Token: $CSRF" \
  -d '{}'

# Logout (CSRF required when using cookies)
CSRF=$(awk '$6 == "csrf_token" {print $7}' cookies.txt)
curl -s -b cookies.txt -X POST http://localhost:3000/api/v1/auth/logout \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -d '{}'
```

See **[docs/API_CONTRACT.md](docs/API_CONTRACT.md)** for the full frontend-facing
contract (errors, auth modes, session management, response shapes). Generate a typed client spec with
`npm run openapi:client-spec` → `openapi/client.json`.

## Production deployment (Docker)

The app ships as a multi-stage image (non-root, slim runtime, native `argon2`
compiled in the build stage). `docker-compose.yml` includes `app`, `worker`, and
one-off `migrate` / seed services alongside Postgres and Redis.

```bash
# Build, migrate, seed (first deploy), then start the API and mail worker
docker compose build
docker compose run --rm migrate           # prisma migrate deploy (every release)
docker compose run --rm seed-catalog      # permissions + roles (first deploy; after catalog changes)
docker compose run --rm seed-admin        # bootstrap admin (first deploy only)
docker compose up -d app worker           # API on http://localhost:${APP_PORT:-3000}
```

The **worker** processes outbound mail (password reset, email verification) from
the BullMQ queue. Set `MAIL_TRANSPORT=smtp` and your SMTP credentials in `.env`
for production; the compose `worker` service defaults to Mailpit for local
testing. Scale API and worker independently as needed.

**Routine releases** (no schema or permission catalog changes): run `migrate` only, then roll `app` and `worker`.

**Releases with new permissions** in code: `migrate` → `seed-catalog` → roll app.

**Admin password rotation**: `SEED_ADMIN_ROTATE_PASSWORD=true docker compose run --rm seed-admin`

The container exposes a Docker `HEALTHCHECK` against `/health`, binds to
`0.0.0.0`, and enables graceful shutdown hooks so Prisma/Redis disconnect on
`SIGTERM` during rolling deploys.

### Production hardening notes

- **Swagger** defaults to **off**. Only set `SWAGGER_ENABLED=true` where you want
  `/docs` exposed (typically non-production).
- **Secrets**: rotate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (>= 32 chars) and
  set a strong `SEED_ADMIN_PASSWORD`. Inject env from your orchestrator/secret
  manager; never bake secrets into the image (`.env` is git- and docker-ignored).
- **Database pooling**: tune `connection_limit` / `pool_timeout` on `DATABASE_URL`
  so total connections across instances stay under Postgres `max_connections`.
  Front with PgBouncer (transaction pooling) for higher fan-out; see
  `.env.example`.
- **Migrations** run as a discrete release step (`migrate` service /
  `npm run prisma:deploy`), not at app boot.
- **Seed split**: `prisma:seed:catalog` syncs permissions/roles (safe to re-run
  when the catalog changes). `prisma:seed:admin` creates the bootstrap admin
  once; set `SEED_ADMIN_ROTATE_PASSWORD=true` only for intentional password
  rotation. `prisma:seed` runs both (local dev / CI only).
- **Logs**: sensitive fields (`authorization` header, passwords, tokens) are
  redacted from structured logs.
- **Trust proxy**: set `TRUST_PROXY=false` for local/direct connections (default).
  Behind one cloud load balancer use `TRUST_PROXY=1`. For stricter production,
  use comma-separated trusted proxy CIDRs/IPs (e.g. `10.0.0.0/8,172.16.0.0/12`)
  so `req.ip` and RBAC audit IPs reflect the real client, not the LB.
- **Backups & DR**: default RPO 15 minutes / RTO 1 hour. See
  **[docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md)** for Postgres/Redis
  policies, restore order, and drill cadence. Local snapshots:
  `npm run backup:postgres`, `npm run backup:redis`.

## CI

`.github/workflows/ci.yml` runs on pushes/PRs to `main`: install -> Prisma
generate -> lint -> typecheck -> build -> migrate + seed -> unit tests with
**service coverage gates** (`npm run test:cov`) -> e2e (against Postgres/Redis
service containers), plus a job that builds the Docker image.

### Coverage policy

Unit tests enforce **90% lines and 80% branches** on `*.service.ts` files only
(see the `jest` config in `package.json`). Controllers, `main.ts`, modules, and
schemas are excluded from coverage collection — HTTP and validation behavior is
covered by e2e tests instead.

The **pre-push** hook runs `npm run test:cov` (not plain `npm run test`) so
coverage gates apply locally before push.

## API overview

| Module | Routes                                                                                                                                                                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth   | `POST /api/v1/auth/register`, `login`, `refresh`, `logout`, `change-password`, `password-reset/request`, `password-reset/confirm`, `email-verification/request`, `email-verification/confirm`, `sessions/revoke-all`; `GET /api/v1/auth/me`, `sessions`; `DELETE /api/v1/auth/sessions/:sessionId` |
| Users  | `GET/POST /api/v1/users`, `GET/PATCH/DELETE /api/v1/users/:id`                                                                                                                                                                                                                                     |
| RBAC   | `GET /api/v1/roles`, `GET /api/v1/permissions`, `POST /api/v1/roles`, `PATCH /api/v1/roles/:id`, `DELETE /api/v1/roles/:id`, `POST /api/v1/roles/assign`, `POST /api/v1/roles/unassign`, `POST /api/v1/roles/permissions/attach`, `POST /api/v1/roles/permissions/detach`                          |

Permissions are defined in code (`apps/api/src/rbac/permissions.constants.ts`) and synced via seed. They include `users:read`, `users:write`, `users:delete`, `roles:read`, `roles:manage`, `permissions:read`, and `permissions:manage` (the last is catalog-only; there is no runtime permission API).

See **[docs/RBAC.md](docs/RBAC.md)** for system roles, mutation rules, audit logging, and a production checklist. See **[docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)** for metrics, traces, and extending instrumentation.

### RBAC audit trail

Mutations (create/update/delete roles, assign/unassign, attach/detach permissions) append rows to `RbacAuditLog` and emit structured logs with action `rbac.audit`. Each entry records the actor, targets, optional metadata, request ID, and client IP.

## Rate limiting

| Variable                                    | Default                  | Scope                                                   |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `THROTTLE_TTL` / `THROTTLE_LIMIT`           | required                 | Global default for protected routes                     |
| `THROTTLE_AUTH_TTL` / `THROTTLE_AUTH_LIMIT` | 60000 ms / 10            | `POST /api/v1/auth/register`, `POST /api/v1/auth/login` |
| (derived)                                   | 2× `THROTTLE_AUTH_LIMIT` | `POST /api/v1/auth/refresh`                             |

Throttling counters are stored in **Redis** so limits are enforced consistently
across multiple instances (the default in-memory store counts per process). If
Redis is unreachable the throttler fails open (allows the request) to preserve
availability; the auth/RBAC guards still protect the app.

## Redis resilience

Redis operations used for auth security run through a circuit breaker (opens after 5 consecutive failures, half-open retry after 30s):

- **Access-token blacklist checks** fail closed — if Redis is unavailable, tokens are treated as revoked.
- **Permission cache reads** fall back to PostgreSQL when Redis is unavailable.

## Observability (OpenTelemetry + Prometheus)

Tracing and metrics are **opt-in** (disabled by default). See **[docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)** for:

- Local quick start (metrics-only, Jaeger, Prometheus/Grafana)
- Full metric catalog and example PromQL alerts
- How to add custom metrics/spans for new domains and workers
- Production scrape and OTLP collector setup

| Variable                      | Default          | Description                                           |
| ----------------------------- | ---------------- | ----------------------------------------------------- |
| `OTEL_TRACES_ENABLED`         | `false`          | Export distributed traces via OTLP                    |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(unset)_        | Collector base URL (e.g. `http://localhost:4318`)     |
| `OTEL_TRACES_SAMPLER_ARG`     | `0.1`            | Trace sampling ratio (0–1)                            |
| `OTEL_SERVICE_NAME`           | `api` / `worker` | Service name in traces                                |
| `METRICS_ENABLED`             | `false`          | Start Prometheus scrape server on `METRICS_PORT`      |
| `METRICS_PORT`                | `9464`           | Metrics HTTP port (`/metrics`); use `9465` for worker |

Built-in metrics include HTTP RED (`http_requests_total`, `http_request_duration_seconds`), auth counters, Redis health, and mail job stats. Logs include `trace_id` / `span_id` when observability is enabled. Sentry (`SENTRY_DSN`) complements OTel for error tracking.

## Project structure

```
apps/
├── api/              # HTTP API (auth, users, rbac, health)
└── worker/           # Background job processors (mail, future workers)
libs/
├── shared/           # config, prisma, redis
├── mail/             # MailService (log + SMTP transports)
└── queue/            # BullMQ module, job contracts, producers
```

The API enqueues jobs (e.g. outbound email) via `libs/queue`; the worker consumes them from Redis/BullMQ and runs the actual side effects.

## Scripts

| Script                        | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `npm run dev:bootstrap`       | Start infra, migrate/seed dev + e2e DBs                     |
| `npm run start:dev`           | API dev server with watch                                   |
| `npm run start:dev:worker`    | Worker dev process with watch                               |
| `npm run build`               | Production build (api + worker)                             |
| `npm run openapi:client-spec` | Export public OpenAPI spec → `openapi/client.json`          |
| `npm run start:prod:api`      | Run compiled API                                            |
| `npm run start:prod:worker`   | Run compiled worker                                         |
| `npm run lint`                | ESLint with autofix                                         |
| `npm run lint:ci`             | ESLint without autofix (CI)                                 |
| `npm run typecheck`           | `tsc --noEmit` type check                                   |
| `npm run validate`            | Lint, typecheck, and unit tests with service coverage gates |
| `npm run test`                | Unit tests                                                  |
| `npm run test:e2e`            | E2E tests (requires DB + Redis)                             |
| `npm run e2e:prepare`         | Migrate/seed E2E database                                   |
| `npm run prisma:migrate`      | Apply migrations (dev)                                      |
| `npm run prisma:deploy`       | Apply migrations (prod)                                     |
| `npm run prisma:seed`         | Seed catalog + admin (dev / CI)                             |
| `npm run prisma:seed:catalog` | Sync permissions and system roles                           |
| `npm run prisma:seed:admin`   | Bootstrap admin (or rotate with env flag)                   |
| `npm run backup:postgres`     | Postgres `pg_dump` snapshot → `backups/postgres/`           |
| `npm run backup:redis`        | Redis RDB snapshot → `backups/redis/`                       |
| `npm run restore:postgres`    | Restore from `.dump` file (pass `--force` as second arg)    |

## Git hooks

Hooks install automatically when you run `npm install` (via the `prepare` script).

| Hook           | Runs                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| **pre-commit** | ESLint `--fix` and Prettier on staged files under `{src,apps,libs,test,prisma}`        |
| **pre-push**   | `npm run lint:ci`, `npm run typecheck` and `npm run test:cov` (service coverage gates) |

Run the same checks manually without pushing:

```bash
npm run validate
```

To skip hooks in an emergency (use sparingly):

```bash
git commit --no-verify
git push --no-verify
```

## Tests

```bash
npm run dev:bootstrap   # or: docker compose up -d && migrate/seed steps below
npm run test:cov        # unit tests with service coverage gates
npm run test:e2e        # domain-split e2e suites
```

E2E tests are split by domain under `test/`:

| File                 | Scope                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| `auth.e2e-spec.ts`   | Register/login/refresh, email verification, password reset, account lockout |
| `rbac.e2e-spec.ts`   | Role/permission reads, RBAC mutations, audit log verification               |
| `users.e2e-spec.ts`  | User listing, self-update guards, deactivation                              |
| `health.e2e-spec.ts` | Liveness and readiness probes                                               |

Shared setup lives in `test/e2e-helpers.ts` (app bootstrap, admin login, verified
user factory, teardown). `test/e2e-setup.ts` loads env and isolates the e2e DB.

E2E uses `POSTGRES_E2E_DB` (default `app_e2e`, ensured on every `docker compose up`)
and `REDIS_E2E_DB` (default `15`) in both local and CI. Unit tests use the `app`
database and Redis DB `0`.
