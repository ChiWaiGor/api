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

### 2. Infrastructure

```bash
docker compose up -d
```

### 3. Database

```bash
npm run prisma:migrate
npm run prisma:seed
```

### 4. Run API

```bash
npm run start:dev
```

- API: [http://localhost:3000](http://localhost:3000)
- Swagger (if `SWAGGER_ENABLED=true`): [http://localhost:3000/docs](http://localhost:3000/docs)
- Health: [http://localhost:3000/health](http://localhost:3000/health)
- Readiness: [http://localhost:3000/health/ready](http://localhost:3000/health/ready)

## Default admin (after seed)

| Field    | Value                                       |
| -------- | ------------------------------------------- |
| Email    | `admin@example.com` (or `SEED_ADMIN_EMAIL`) |
| Password | `Admin123!@#` (or `SEED_ADMIN_PASSWORD`)    |
| Role     | `admin` (all permissions)                   |

## Auth flow example

```bash
# Login
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"Admin123!@#"}'

# Use accessToken from response
curl -s http://localhost:3000/auth/me \
  -H "Authorization: Bearer <accessToken>"

# Refresh
curl -s -X POST http://localhost:3000/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'

# Logout
curl -s -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer <accessToken>" \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'
```

## Production deployment (Docker)

The app ships as a multi-stage image (non-root, slim runtime, native `argon2`
compiled in the build stage). `docker-compose.yml` includes `app` and a one-off
`migrate` service alongside Postgres and Redis.

```bash
# Build + run migrations/seed once, then start the API
docker compose build
docker compose run --rm migrate      # prisma migrate deploy && db seed
docker compose up -d app             # serves on http://localhost:${APP_PORT:-3000}
```

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
- **Logs**: sensitive fields (`authorization` header, passwords, tokens) are
  redacted from structured logs.

## CI

`.github/workflows/ci.yml` runs on pushes/PRs to `main`: install -> Prisma
generate -> lint -> typecheck -> build -> migrate + seed -> unit tests (with
coverage) -> e2e (against Postgres/Redis service containers), plus a job that
builds the Docker image.

## API overview

| Module | Routes                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Auth   | `POST /auth/register`, `login`, `refresh`, `logout`; `GET /auth/me`                                                          |
| Users  | `GET/POST /users`, `GET/PATCH/DELETE /users/:id`                                                                             |
| RBAC   | `GET /roles`, `GET /permissions`, `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id`, `POST /roles/assign`, `POST /roles/unassign`, `POST /roles/permissions/attach`, `POST /roles/permissions/detach` |

Permissions are defined in code (`src/rbac/permissions.constants.ts`) and synced via seed. They include `users:read`, `users:write`, `users:delete`, `roles:read`, `roles:manage`, `permissions:read`, and `permissions:manage` (the last is catalog-only; there is no runtime permission API).

See **[docs/RBAC.md](docs/RBAC.md)** for system roles, mutation rules, audit logging, and a production checklist.

### RBAC audit trail

Mutations (create/update/delete roles, assign/unassign, attach/detach permissions) append rows to `RbacAuditLog` and emit structured logs with action `rbac.audit`. Each entry records the actor, targets, optional metadata, request ID, and client IP.

## Rate limiting

| Variable | Default | Scope |
| -------- | ------- | ----- |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | required | Global default for protected routes |
| `THROTTLE_AUTH_TTL` / `THROTTLE_AUTH_LIMIT` | 60000 ms / 10 | `POST /auth/register`, `POST /auth/login` |
| (derived) | 2× `THROTTLE_AUTH_LIMIT` | `POST /auth/refresh` |

Throttling counters are stored in **Redis** so limits are enforced consistently
across multiple instances (the default in-memory store counts per process). If
Redis is unreachable the throttler fails open (allows the request) to preserve
availability; the auth/RBAC guards still protect the app.

## Redis resilience

Redis operations used for auth security run through a circuit breaker (opens after 5 consecutive failures, half-open retry after 30s):

- **Access-token blacklist checks** fail closed — if Redis is unavailable, tokens are treated as revoked.
- **Permission cache reads** fall back to PostgreSQL when Redis is unavailable.

## Project structure

```
src/
├── config/           # Zod env schema
├── common/           # guards, decorators, shared primitives
├── auth/             # auth.schema.ts, JWT, Argon2
├── users/            # user.schema.ts
├── rbac/             # permissions, roles, audit
├── redis/            # ioredis service
└── prisma/           # Prisma service
```

## Scripts

| Script                   | Description                     |
| ------------------------ | ------------------------------- |
| `npm run start:dev`      | Dev server with watch           |
| `npm run build`          | Production build                |
| `npm run lint`           | ESLint with autofix             |
| `npm run lint:ci`        | ESLint without autofix (CI)     |
| `npm run typecheck`      | `tsc --noEmit` type check       |
| `npm run test`           | Unit tests                      |
| `npm run test:e2e`       | E2E tests (requires DB + Redis) |
| `npm run prisma:migrate` | Apply migrations (dev)          |
| `npm run prisma:deploy`  | Apply migrations (prod)         |
| `npm run prisma:seed`    | Seed roles, permissions, admin  |

## Tests

```bash
docker compose up -d
npm run prisma:migrate
npm run prisma:seed
npm run test
npm run test:e2e
```
