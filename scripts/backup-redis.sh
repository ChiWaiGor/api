#!/usr/bin/env sh
# Snapshot Redis RDB to backups/redis/ (optional; see docs/DISASTER_RECOVERY.md).
# Usage: npm run backup:redis
set -eu

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${REDIS_HOST:=localhost}"
: "${REDIS_PORT:=6379}"
: "${REDIS_PASSWORD:=}"
: "${REDIS_DB:=0}"
: "${BACKUP_DIR:=backups/redis}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${BACKUP_DIR}/redis_db${REDIS_DB}_${TIMESTAMP}.rdb"

mkdir -p "$BACKUP_DIR"

redis_cli() {
  if [ -n "$REDIS_PASSWORD" ]; then
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" -n "$REDIS_DB" "$@"
  else
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -n "$REDIS_DB" "$@"
  fi
}

if command -v redis-cli >/dev/null 2>&1; then
  redis_cli --rdb "$OUTPUT"
elif docker compose ps redis --status running -q 2>/dev/null | grep -q .; then
  TMP="/data/dump_${TIMESTAMP}.rdb"
  if [ -n "$REDIS_PASSWORD" ]; then
    docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" -n "$REDIS_DB" --rdb "$TMP"
  else
    docker compose exec -T redis redis-cli -n "$REDIS_DB" --rdb "$TMP"
  fi
  docker compose cp "redis:${TMP}" "$OUTPUT"
  docker compose exec -T redis rm -f "$TMP"
else
  echo "redis-cli not found and docker compose redis is not running." >&2
  exit 1
fi

echo "Redis RDB backup written: ${OUTPUT}"
ls -lh "$OUTPUT"
