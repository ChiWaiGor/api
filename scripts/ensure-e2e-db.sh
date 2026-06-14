#!/usr/bin/env sh
set -eu

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
: "${POSTGRES_E2E_DB:=app_e2e}"

export PGHOST="${POSTGRES_HOST}"
export PGPORT="${POSTGRES_PORT}"
export POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_E2E_DB

sh docker/postgres/ensure-e2e-db.sh
