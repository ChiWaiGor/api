# RBAC

Role-based access control for this API: permissions are defined in code, synced to the database on seed/deploy, and enforced via a global `PermissionsGuard`.

## Concepts

| Concept        | Source                                       | Notes                                                                                       |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Permission** | `apps/api/src/rbac/permissions.constants.ts` | Capability strings (e.g. `users:read`). Add new permissions in code, deploy, then run seed. |
| **Role**       | Database                                     | Named bundles of permissions. `admin` and `user` are system roles (`isSystem: true`).       |
| **Assignment** | `UserRole` / `RolePermission`                | Links users to roles and permissions to roles.                                              |

## System roles

| Role    | `isSystem` | Behavior                                                                                                    |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `admin` | yes        | Seeded with all catalog permissions. Cannot update/delete the role. Catalog permissions cannot be detached. |
| `user`  | yes        | Seeded with `users:read`. Cannot update/delete. `users:read` cannot be detached.                            |

Reserved names (`admin`, `user`) cannot be used for new custom roles.

## Admin API

All mutation routes require `roles:manage` (except read routes).

| Method | Path                        | Permission                                   |
| ------ | --------------------------- | -------------------------------------------- |
| GET    | `/roles`                    | `roles:read`                                 |
| GET    | `/permissions`              | `permissions:read`                           |
| POST   | `/roles`                    | `roles:manage`                               |
| PATCH  | `/roles/:id`                | `roles:manage` (non-system only)             |
| DELETE | `/roles/:id`                | `roles:manage` (non-system, unassigned only) |
| POST   | `/roles/assign`             | `roles:manage`                               |
| POST   | `/roles/unassign`           | `roles:manage`                               |
| POST   | `/roles/permissions/attach` | `roles:manage`                               |
| POST   | `/roles/permissions/detach` | `roles:manage`                               |

Runtime permission creation (`POST /permissions`) is **not** supported. Permissions are provisioned via seed/migration only.

## Guards and enforcement

1. **Route level** — `@RequirePermissions([...])` on controllers.
2. **Service level** — e.g. `UsersService` allows self-access without `users:read` for own profile.
3. **Permission resolution** — `RbacService.getUserPermissions()` loads from Redis cache with PostgreSQL fallback.

JWT access tokens carry **role names** only; permissions are resolved per request from the database/cache.

## Adding a new permission

1. Add to `PERMISSIONS` in `permissions.constants.ts`.
2. Use `@RequirePermissions` (and any service checks) in application code.
3. Deploy and run `npm run prisma:seed:catalog` to upsert the permission row.
4. Attach the permission to roles via API or seed.

## Audit logging

Every RBAC mutation writes an `RbacAuditLog` row and emits a structured log (`rbac.audit`).

| Action                | When                         |
| --------------------- | ---------------------------- |
| `ROLE_CREATED`        | Custom role created          |
| `ROLE_UPDATED`        | Non-system role updated      |
| `ROLE_DELETED`        | Non-system role deleted      |
| `ROLE_ASSIGNED`       | Role assigned to user        |
| `ROLE_UNASSIGNED`     | Role removed from user       |
| `PERMISSION_ATTACHED` | Permission linked to role    |
| `PERMISSION_DETACHED` | Permission removed from role |

Each entry stores `actorId`, `actorEmail`, optional targets (`targetUserId`, `targetRoleId`, `targetPermissionId`), `metadata` (e.g. role name, permission action), `requestId`, and `ipAddress`.

Audit persistence is best-effort: a DB failure is logged but does not roll back the mutation.

Query example:

```sql
SELECT * FROM "RbacAuditLog"
WHERE action = 'ROLE_ASSIGNED'
ORDER BY "createdAt" DESC
LIMIT 50;
```

## Production checklist

- [ ] Run `prisma migrate deploy` on every release.
- [ ] Run `prisma:seed:catalog` on first deploy and when new permissions ship in code.
- [ ] Run `prisma:seed:admin` on first deploy only (not on routine releases).
- [ ] To rotate the bootstrap admin password: `SEED_ADMIN_ROTATE_PASSWORD=true npm run prisma:seed:admin`.
- [ ] Rotate `JWT_*` secrets; set strong `SEED_ADMIN_PASSWORD` for first bootstrap.
- [ ] Restrict who receives `roles:manage` / `admin` role.
- [ ] Monitor `rbac.audit` logs and/or `RbacAuditLog` for suspicious changes.
- [ ] Ensure Redis is available (blacklist fail-closed; permission cache falls back to DB).
- [ ] Postgres backups + PITR (or scheduled `npm run backup:postgres` off-host); see [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).
- [ ] Restore drill completed (monthly pre-launch, quarterly in production) with verification checklist.

## Test coverage

- **Unit tests** enforce 90% lines and 80% branches on `*.service.ts` files
  (`npm run test:cov`). Controllers, modules, schemas, and `main.ts` are
  excluded — HTTP RBAC behavior is covered by e2e instead.
- **E2E** (`test/rbac.e2e-spec.ts`) exercises RBAC mutations end-to-end:
  create/update/delete custom roles, assign/unassign, attach/detach permissions,
  system-role protection, last-admin guard, non-admin forbidden responses, and
  `RbacAuditLog` rows for each mutation.
