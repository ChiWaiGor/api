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
: "${POSTGRES_E2E_DB:=app_e2e}"

export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_E2E_DB}?schema=public"
export DIRECT_URL="${DATABASE_URL}"

npm run prisma:deploy
npm run prisma:seed
