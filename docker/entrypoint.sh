#!/bin/sh
set -eu

echo "[entrypoint] applying migrations..."
bun run db:migrate

echo "[entrypoint] starting server..."
# Run the built server directly with bun rather than `bun run start` (which
# shells out to a `node` binary the oven/bun base image doesn't ship).
export HOST="${HOST:-::}"
export PORT="${PORT:-3000}"
exec bun .output/server/index.mjs
