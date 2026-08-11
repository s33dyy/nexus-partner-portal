#!/bin/sh
set -eu

echo "[entrypoint] applying migrations..."
bun run db:migrate

echo "[entrypoint] starting server..."
export HOST="${HOST:-::}"
export PORT="${PORT:-3000}"
exec bun src/index.ts
