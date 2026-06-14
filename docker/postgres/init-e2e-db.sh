#!/bin/sh
set -eu

# Runs only on first volume init; ensure-e2e-db.sh handles existing volumes.
: "${POSTGRES_E2E_DB:=app_e2e}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	SELECT 'CREATE DATABASE "${POSTGRES_E2E_DB}"'
	WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${POSTGRES_E2E_DB}')\gexec
EOSQL
