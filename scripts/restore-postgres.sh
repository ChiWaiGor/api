#!/usr/bin/env sh
# Restore PostgreSQL from a custom-format pg_dump (-Fc) backup.
# Usage: npm run restore:postgres -- backups/postgres/app_20260625T120000.dump
# Stop app/worker before running. This drops and recreates objects from the dump.
set -eu

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup.dump> [--force]" >&2
  echo "Example: npm run restore:postgres -- backups/postgres/app_20260625T120000.dump" >&2
  exit 1
fi

BACKUP_FILE="$1"
FORCE="${2:-}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${POSTGRES_USER:=app}"
: "${POSTGRES_PASSWORD:=app}"
: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=app}"

if [ "$FORCE" != "--force" ]; then
  echo "WARNING: This will run pg_restore --clean against database '${POSTGRES_DB}'"
  echo "         on ${POSTGRES_HOST}:${POSTGRES_PORT}. Stop app and worker first."
  echo "         Re-run with --force to proceed:"
  echo "         $0 ${BACKUP_FILE} --force"
  exit 1
fi

run_pg_restore() {
  pg_restore \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    "$BACKUP_FILE"
}

if command -v pg_restore >/dev/null 2>&1; then
  export PGPASSWORD="${POSTGRES_PASSWORD}"
  run_pg_restore
else
  if docker compose ps postgres --status running -q 2>/dev/null | grep -q .; then
    docker compose exec -T \
      -e PGPASSWORD="${POSTGRES_PASSWORD}" \
      postgres \
      pg_restore \
      --clean \
      --if-exists \
      --no-owner \
      --no-privileges \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" <"$BACKUP_FILE"
  else
    echo "pg_restore not found and docker compose postgres is not running." >&2
    exit 1
  fi
fi

echo "Postgres restore complete for database '${POSTGRES_DB}'."
echo "Next steps: flush Redis, npm run prisma:deploy, npm run prisma:seed:catalog, start app/worker."
echo "See docs/DISASTER_RECOVERY.md for the full checklist."
