# Adding a Domain Module

Guide for adding a new business domain (e.g. `projects`, `invoices`) to this API. The **users** module is the reference implementation.

For RBAC concepts, system roles, and audit logging, see **[RBAC.md](RBAC.md)**.

---

## Request pipeline

Every HTTP route passes through global guards registered in `src/app.module.ts`:

```mermaid
flowchart TD
  Req[HTTP Request] --> Throttle[ThrottlerGuard]
  Throttle --> JWT[JwtAuthGuard]
  JWT -->|@Public| Handler[Handler]
  JWT -->|Protected| Strategy[JwtStrategy.validate]
  Strategy --> Email[EmailVerifiedGuard]
  Email -->|@AllowUnverifiedEmail| Handler
  Email -->|verified| Perm[PermissionsGuard]
  Email -->|unverified| Forbidden403[403 Email verification required]
  Perm -->|@RequirePermissions or no metadata| Handler
  Perm -->|missing permission| Forbidden403b[403 Insufficient permissions]
```

| Guard                | Purpose                                | Opt-out decorators                                                                          |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ThrottlerGuard`     | Rate limits (Redis-backed)             | `@SkipThrottle()`, `@Throttle({ auth: {} })` on auth routes                                 |
| `JwtAuthGuard`       | JWT authentication                     | `@Public()`                                                                                 |
| `EmailVerifiedGuard` | Deny unverified users on domain routes | `@Public()`, `@AllowUnverifiedEmail()`                                                      |
| `PermissionsGuard`   | RBAC enforcement                       | Omit `@RequirePermissions` for routes with no permission requirement (guard passes through) |

**Do not** add `@UseGuards(JwtAuthGuard, PermissionsGuard)` on controllers — guards are global. Use decorators on individual routes instead.

JWT access tokens carry role **names** only. Permissions are resolved per request via `RbacService.getUserPermissions()` (Redis cache with PostgreSQL fallback).

---

## Permission naming

Use `{resource}:{action}` strings. Keep resources plural and lowercase; use verbs from the table below.

| Action suffix | Typical HTTP / use                                          |
| ------------- | ----------------------------------------------------------- |
| `read`        | List and get (GET)                                          |
| `write`       | Create and update (POST, PATCH)                             |
| `delete`      | Soft/hard delete (DELETE)                                   |
| `manage`      | Admin-only composite operations (attach roles, bulk config) |

**Examples**

| Constant (code) | Action string  | Routes                                  |
| --------------- | -------------- | --------------------------------------- |
| `USERS_READ`    | `users:read`   | `GET /users`                            |
| `USERS_WRITE`   | `users:write`  | `POST /users`, admin `PATCH /users/:id` |
| `USERS_DELETE`  | `users:delete` | `DELETE /users/:id`                     |
| `ROLES_MANAGE`  | `roles:manage` | RBAC mutations                          |

**Conventions**

- Add new permissions only in `src/rbac/permissions.constants.ts` — there is no runtime permission-creation API.
- Export a typed constant on `PERMISSIONS` (e.g. `PROJECTS_READ: 'projects:read'`).
- `ALL_PERMISSIONS` is derived automatically; seed upserts every catalog permission.
- Avoid wildcards (`projects:*`) — not supported by `PermissionsGuard` today.
- Prefer three permissions (`read`, `write`, `delete`) over many fine-grained ones unless you have a clear need.

---

## Module checklist

Use this checklist when adding a domain named `{domain}` (example: `projects`).

### 1. Permissions

- [ ] Add `{domain}:read`, `{domain}:write`, `{domain}:delete` (or subset) to `PERMISSIONS` in [`src/rbac/permissions.constants.ts`](../src/rbac/permissions.constants.ts).
- [ ] If the default `user` role should have access, append to `DEFAULT_USER_PERMISSIONS` in the same file (today only `users:read` is included — add new defaults deliberately).
- [ ] Run seed locally: `npm run prisma:seed:catalog` (upserts permission rows and attaches all permissions to `admin`).

### 2. Database (if the domain has its own tables)

- [ ] Add Prisma models to [`prisma/schema.prisma`](../prisma/schema.prisma).
- [ ] Create migration: `npm run prisma:migrate`.
- [ ] Add indexes and foreign keys as needed; follow existing patterns (`cuid` ids, `createdAt` / `updatedAt`).

### 3. Nest module scaffold

Create `src/{domain}/` mirroring **users**:

| File                       | Role                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `{domain}.module.ts`       | Imports `AuthModule` / `RbacModule` if the service needs auth or permission cache invalidation |
| `{domain}.controller.ts`   | Routes, `@ApiTags`, `@RequirePermissions`, `@ApiBearerAuth`                                    |
| `{domain}.service.ts`      | Business logic, Prisma access, service-level authorization                                     |
| `{domain}.schema.ts`       | Zod schemas + `createZodDto` classes (single source of truth for validation and OpenAPI)       |
| `{domain}.service.spec.ts` | Unit tests for authorization and core behavior                                                 |

- [ ] Register `{Domain}Module` in [`src/app.module.ts`](../src/app.module.ts) `imports` array.

### 4. Controller guards and decorators

- [ ] Protected list/create/delete routes: `@RequirePermissions([PERMISSIONS.{DOMAIN}_READ])` (etc.).
- [ ] Routes that need **any one of** several permissions: `@RequirePermissions([...], 'any')`.
- [ ] Unauthenticated endpoints (webhooks, public catalog): `@Public()`.
- [ ] Authenticated but pre-verification (rare for domains): `@AllowUnverifiedEmail()` — see auth allowlist in [`src/auth/auth.controller.ts`](../src/auth/auth.controller.ts).
- [ ] Do **not** stack redundant `@UseGuards` for JWT or permissions.

### 5. Service-level authorization

Route-level `@RequirePermissions` is not always enough. Mirror [`UsersService`](../src/users/users.service.ts):

- **Self vs admin access** — e.g. `GET /users/:id` has no `@RequirePermissions`; the service allows read when `id === requesterId` or requester has `users:read`.
- **Field gating on PATCH** — restrict which fields a user can change on their own record vs admin `write`.
- **Inject `RbacService`** when you need `getUserPermissions(requesterId)` or `invalidateUserPermissionCache(userId)` after role-affecting changes.

Pass `requesterId` and `requesterPermissions` from the controller via `@CurrentUser()` and `rbac.getUserPermissions()`.

### 6. Seed and roles

[`prisma/seed-catalog.ts`](../prisma/seed-catalog.ts) already:

1. Upserts every entry in `ALL_PERMISSIONS`.
2. Attaches **all** permissions to the `admin` system role.
3. Attaches `DEFAULT_USER_PERMISSIONS` to the `user` system role.

After adding permissions:

- [ ] Run `npm run prisma:seed:catalog` in each environment when the permission catalog changes.
- [ ] Run `npm run prisma:seed:admin` on first deploy only (see [RBAC.md — Production checklist](RBAC.md#production-checklist)).
- [ ] For custom roles, attach new permissions via `POST /roles/permissions/attach` (requires `roles:manage`) or extend seed.
- [ ] If you add to `DEFAULT_USER_PERMISSIONS`, `SYSTEM_ROLE_PROTECTED_PERMISSIONS` in [`src/rbac/roles.constants.ts`](../src/rbac/roles.constants.ts) stays in sync automatically (it references `DEFAULT_USER_PERMISSIONS`).

### 7. Tests

- [ ] Unit tests: permission branches and validation in `{domain}.service.spec.ts`.
- [ ] E2e ([`test/app.e2e-spec.ts`](../test/app.e2e-spec.ts)): verified user without permission gets **403**; user with permission succeeds; unverified user gets **403 Email verification required** on domain routes.
- [ ] Use `registerAndVerifyUser()` (or admin token) patterns from existing e2e helpers.

### 8. Docs and deploy

- [ ] Add the module/routes to the API overview table in [`README.md`](../README.md) (optional but recommended).
- [ ] Deploy order: `prisma migrate deploy` → `prisma:seed:catalog` (when catalog changed) → roll app (see [RBAC.md — Production checklist](RBAC.md#production-checklist)).

---

## Worked example: `projects`

Below is a minimal slice showing how pieces fit together. Adjust paths and fields for your domain.

### 1. Permissions

```typescript
// src/rbac/permissions.constants.ts
export const PERMISSIONS = {
  // ...existing
  PROJECTS_READ: 'projects:read',
  PROJECTS_WRITE: 'projects:write',
  PROJECTS_DELETE: 'projects:delete',
} as const;
```

Do **not** grant `projects:*` to `DEFAULT_USER_PERMISSIONS` unless every signed-up user should list projects.

### 2. Controller

```typescript
@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly rbac: RbacService,
  ) {}

  @RequirePermissions([PERMISSIONS.PROJECTS_READ])
  @Get()
  findAll(@Query() query: ListProjectsQueryDto) {
    return this.projectsService.findAll(query);
  }

  @RequirePermissions([PERMISSIONS.PROJECTS_WRITE])
  @Post()
  create(@Body() body: CreateProjectBodyDto) {
    return this.projectsService.create(body);
  }

  @Get(':id')
  async findOne(
    @Param() params: ProjectParamsDto,
    @CurrentUser() user: { sub: string },
  ) {
    const permissions = await this.rbac.getUserPermissions(user.sub);
    return this.projectsService.findOne(params.id, user.sub, permissions);
  }

  @RequirePermissions([PERMISSIONS.PROJECTS_DELETE])
  @Delete(':id')
  remove(@Param() params: ProjectParamsDto) {
    return this.projectsService.remove(params.id);
  }
}
```

### 3. Service-level check (owner or `projects:read`)

```typescript
async findOne(
  id: string,
  requesterId: string,
  requesterPermissions: string[],
) {
  const canReadAll = requesterPermissions.includes(PERMISSIONS.PROJECTS_READ);
  const project = await this.prisma.project.findUnique({ where: { id } });
  if (!project) throw new NotFoundException('Project not found');

  if (project.ownerId !== requesterId && !canReadAll) {
    throw new ForbiddenException('Insufficient permissions');
  }
  return this.toResponse(project);
}
```

### 4. Module registration

```typescript
// src/projects/projects.module.ts
@Module({
  imports: [RbacModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}

// src/app.module.ts — add to imports
ProjectsModule,
```

### 5. Verify

```bash
npm run prisma:migrate   # if schema changed
npm run prisma:seed:catalog
npm run test             # unit
npm run test:e2e         # integration
```

Attach `projects:read` to a test role via the RBAC API or seed, then confirm:

- Unverified JWT → `403` with `Email verification required` on `GET /projects`.
- Verified user without permission → `403` with `Insufficient permissions`.
- Verified user with `projects:read` → `200`.

---

## Guard decorator quick reference

| Decorator                                               | Effect                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@Public()`                                             | Skip JWT, email verification, and permission checks for this route          |
| `@AllowUnverifiedEmail()`                               | Require JWT; skip email verification (auth self-service only)               |
| `@RequirePermissions(['foo:read'])`                     | Require all listed permissions (default mode `all`)                         |
| `@RequirePermissions(['foo:read', 'bar:write'], 'any')` | Require at least one permission                                             |
| _(none)_                                                | JWT + verified email required; no specific permission unless service checks |

---

## Common mistakes

| Mistake                                                       | Fix                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Permission string only in controller, not in `PERMISSIONS`    | Add to `permissions.constants.ts` and re-seed                 |
| Expecting `@RequirePermissions` on `GET /:id` for self-access | Use service-level checks like `UsersService.findOne`          |
| Adding `@UseGuards(JwtAuthGuard)` on domain controllers       | Remove — global guards already apply                          |
| Forgetting seed after deploy                                  | Permission row missing → guard always denies                  |
| Putting `status` / auth fields on domain PATCH without gating | Follow users self-update pattern; sensitive fields admin-only |

---

## Related files

| Area                          | Path                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Permission catalog            | [`src/rbac/permissions.constants.ts`](../src/rbac/permissions.constants.ts)                                           |
| System role rules             | [`src/rbac/roles.constants.ts`](../src/rbac/roles.constants.ts)                                                       |
| Permissions guard             | [`src/common/guards/permissions.guard.ts`](../src/common/guards/permissions.guard.ts)                                 |
| Require permissions decorator | [`src/common/decorators/require-permissions.decorator.ts`](../src/common/decorators/require-permissions.decorator.ts) |
| Reference domain module       | [`src/users/`](../src/users/)                                                                                         |
| Seed                          | [`prisma/seed-catalog.ts`](../prisma/seed-catalog.ts), [`prisma/seed-admin.ts`](../prisma/seed-admin.ts)              |
| RBAC overview                 | [RBAC.md](RBAC.md)                                                                                                    |
