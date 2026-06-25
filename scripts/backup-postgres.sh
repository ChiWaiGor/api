#!/usr/bin/env sh
# Create a PostgreSQL custom-format dump (pg_dump -Fc) for disaster recovery.
# Usage: npm run backup:postgres
#        BACKUP_DIR=/custom/path npm run backup:postgres
set -eu

cd "$(dirname "$0")/.."

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
: "${BACKUP_DIR:=backups/postgres}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${BACKUP_DIR}/${POSTGRES_DB}_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

run_pg_dump() {
  pg_dump -Fc \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -f "$OUTPUT"
}

if command -v pg_dump >/dev/null 2>&1; then
  export PGPASSWORD="${POSTGRES_PASSWORD}"
  run_pg_dump
else
  if docker compose ps postgres --status running -q 2>/dev/null | grep -q .; then
    docker compose exec -T \
      -e PGPASSWORD="${POSTGRES_PASSWORD}" \
      postgres \
      pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" >"$OUTPUT"
  else
    echo "pg_dump not found and docker compose postgres is not running." >&2
    echo "Start Postgres (docker compose up -d postgres) or install postgresql-client." >&2
    exit 1
  fi
fi

echo "Postgres backup written: ${OUTPUT}"
ls -lh "$OUTPUT"
