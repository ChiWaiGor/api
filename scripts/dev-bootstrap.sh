#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

echo "Starting infrastructure (postgres, redis, mailpit)..."
docker compose up -d postgres redis mailpit ensure-e2e-db

echo "Waiting for postgres and redis health..."
docker compose up --wait postgres redis

echo "Waiting for E2E database setup..."
for _ in $(seq 1 60); do
  cid=$(docker compose ps -q ensure-e2e-db 2>/dev/null || true)
  if [ -n "$cid" ]; then
    status=$(docker inspect -f '{{.State.Status}}' "$cid")
    if [ "$status" = "exited" ]; then
      exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$cid")
      if [ "$exit_code" != "0" ]; then
        echo "ensure-e2e-db failed with exit code ${exit_code}" >&2
        docker compose logs ensure-e2e-db >&2
        exit 1
      fi
      break
    fi
  fi
  sleep 1
done

echo "Applying migrations and seeding dev database..."
npm run prisma:migrate
npm run prisma:seed

echo "Preparing E2E database..."
npm run e2e:prepare

echo "Bootstrap complete. Run: npm run start:dev"
