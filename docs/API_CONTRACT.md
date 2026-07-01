# API contract (frontend / SDK)

This document describes the HTTP contract for browser and mobile clients integrating
with the API. For local setup, auth curl examples, and operational runbooks, see
**[README.md](../README.md)**. For RBAC semantics see **[RBAC.md](./RBAC.md)**.

## Base URL and versioning

| Scope              | Path prefix     | Notes                                   |
| ------------------ | --------------- | --------------------------------------- |
| Versioned REST API | `/api/v1`       | All business routes (auth, users, rbac) |
| Liveness           | `/health`       | Unversioned; `{ "status": "ok" }`       |
| Readiness          | `/health/ready` | Unversioned; dependency checks          |

Health and metrics endpoints are **not** included in the public client OpenAPI spec
(`openapi/client.json`).

## Error contract

Business routes (`/api/v1/*`) return a consistent JSON error body on failure.
Operational routes (`/health`, `/metrics`) may use different shapes and are excluded
from this contract.

### `ApiErrorBody` shape

Defined in `apps/api/src/common/filters/api-error.util.ts` and documented in OpenAPI
as `ApiErrorDto` (`apps/api/src/common/filters/api-error.dto.ts`).

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "Validation failed",
  "details": [
    {
      "path": "email",
      "code": "invalid_string",
      "message": "Invalid email"
    }
  ],
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-06-30T12:00:00.000Z",
  "path": "/api/v1/auth/login"
}
```

| Field        | Type   | Required | Description                                         |
| ------------ | ------ | -------- | --------------------------------------------------- |
| `statusCode` | number | yes      | HTTP status code                                    |
| `code`       | string | yes      | Stable machine-readable code (see below)            |
| `message`    | string | yes      | Human-readable summary                              |
| `details`    | array  | no       | Field-level validation or contextual errors         |
| `requestId`  | string | no       | Correlation id (`X-Request-Id` or server-generated) |
| `timestamp`  | string | yes      | ISO-8601 UTC                                        |
| `path`       | string | yes      | Request path that produced the error                |

### Error codes (`code` enum)

| Code                  | Typical HTTP status |
| --------------------- | ------------------- |
| `VALIDATION_FAILED`   | 400                 |
| `BAD_REQUEST`         | 400                 |
| `UNAUTHORIZED`        | 401                 |
| `FORBIDDEN`           | 403                 |
| `NOT_FOUND`           | 404                 |
| `CONFLICT`            | 409                 |
| `TOO_MANY_REQUESTS`   | 429                 |
| `INTERNAL_ERROR`      | 500                 |
| `SERVICE_UNAVAILABLE` | 503                 |

`details[]` entries may include `path` (dot-separated field), `code` (e.g. Zod issue
code), and `message`.

## Authentication (dual mode)

The API supports two client profiles on the same routes.

### Bearer tokens (mobile / default)

- Omit `X-Auth-Client` or send any value other than `web`.
- `POST /api/v1/auth/login`, `register`, and `refresh` return tokens in the JSON body:

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>"
}
```

- Protected routes: `Authorization: Bearer <accessToken>`.
- `refresh` / `logout` bodies may include `{ "refreshToken": "..." }`.

### Web cookies (`X-Auth-Client: web`)

For browser SPAs, send **`X-Auth-Client: web`** on:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/refresh`

The server sets cookies (see `apps/api/src/auth/auth-cookie.service.ts`) and returns
**`{}`** in the body (no tokens in JSON).

| Cookie          | httpOnly | Purpose                                    |
| --------------- | -------- | ------------------------------------------ |
| `access_token`  | yes      | JWT access token                           |
| `refresh_token` | yes      | JWT refresh token                          |
| `csrf_token`    | no       | Double-submit CSRF secret (readable by JS) |

Cookie attributes (`Secure`, `SameSite`, `Domain`) are configured via env — see
`.env.example` and `apps/api/src/app-config.ts`.

Protected routes accept the access token from the `access_token` cookie automatically
(Bearer header takes precedence when both are present).

`POST /api/v1/auth/refresh` and `logout` read `refresh_token` from the cookie when the
body omits `refreshToken`.

### CSRF (cookie clients only)

`apps/api/src/auth/guards/csrf.guard.ts` enforces double-submit CSRF for **mutating**
requests when auth cookies are present and no `Authorization: Bearer` header is sent.

| Rule                                    | Behavior                                                 |
| --------------------------------------- | -------------------------------------------------------- |
| Safe methods (`GET`, `HEAD`, `OPTIONS`) | No CSRF check                                            |
| Bearer auth                             | CSRF skipped (not cookie-vulnerable)                     |
| No auth cookies                         | CSRF skipped                                             |
| Cookie auth + mutation                  | **`X-CSRF-Token` header must equal `csrf_token` cookie** |

Header name: **`X-CSRF-Token`** (lowercase `x-csrf-token` also accepted by Express).

CSRF-exempt routes include login, register, and public password-reset / email-verification
confirm endpoints (no session yet).

On failure: `403` with `code: "FORBIDDEN"`, message `"Invalid or missing CSRF token"`.

## CORS

Configured in `apps/api/src/app-config.ts`:

- `credentials: true` — browsers may send cookies cross-origin when the SPA origin is
  listed in `CORS_ORIGINS`.

Client requirement: use `fetch(..., { credentials: 'include' })` or equivalent. Read the
CSRF value from the `csrf_token` cookie (non-httpOnly) and send it as the `X-CSRF-Token`
request header on mutating requests.

## Success response shapes

Responses are **raw DTOs** (no `{ data: ... }` envelope).

| Operation type                                                          | Mobile (Bearer)                 | Web (`X-Auth-Client: web`)  |
| ----------------------------------------------------------------------- | ------------------------------- | --------------------------- |
| login / register / refresh                                              | `{ accessToken, refreshToken }` | `{}`                        |
| logout, password reset, email verification, RBAC mutations, user delete | `{ "success": true }`           | same                        |
| `GET /auth/me`, user/role reads                                         | Resource DTO                    | same (cookies authenticate) |

List endpoints return paginated objects (e.g. `{ items, total, page, pageSize }` for
users). See route handlers under `apps/api/src/` or the generated OpenAPI spec.

## OpenAPI client spec

Generate a public spec for typed SDK tooling:

```bash
npm run openapi:client-spec
```

Output: **`openapi/client.json`**

- `servers`: `[{ "url": "/api/v1" }]`
- Path keys are relative to that server (e.g. `/auth/login`, not `/api/v1/auth/login`)
- Operational routes excluded
- `ApiErrorDto` included in `components.schemas`
- Interactive Swagger at `/docs` (when `SWAGGER_ENABLED=true`) uses the full internal
  document without the client-spec path rewrite

## Related documentation

| Document                                   | Topic                                    |
| ------------------------------------------ | ---------------------------------------- |
| [README.md](../README.md)                  | Quick start, curl auth examples, scripts |
| [RBAC.md](./RBAC.md)                       | Roles, permissions, audit trail          |
| [OBSERVABILITY.md](./OBSERVABILITY.md)     | Metrics and tracing                      |
| [ADDING_A_DOMAIN.md](./ADDING_A_DOMAIN.md) | Extending the API                        |
