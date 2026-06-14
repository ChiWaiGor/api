#!/bin/sh
set -eu

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${POSTGRES_USER:=app}"
: "${POSTGRES_PASSWORD:=app}"
: "${POSTGRES_DB:=app}"
: "${POSTGRES_E2E_DB:=app_e2e}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

psql -h "${PGHOST}" -p "${PGPORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 <<EOSQL
SELECT 'CREATE DATABASE "${POSTGRES_E2E_DB}"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${POSTGRES_E2E_DB}')\gexec
EOSQL
