# syntax=docker/dockerfile:1
# Build context is the repo root — bun workspaces needs the root manifest and
# lockfile to resolve @livey/shared.

FROM oven/bun:1.3-slim AS base
WORKDIR /app

FROM base AS deps
# Every workspace manifest must be present or bun considers the lockfile stale.
# Only the backend's own node_modules are carried into the runtime stage below.
COPY package.json bun.lock bunfig.toml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

RUN chmod +x ./apps/backend/docker/entrypoint.sh && chown -R app:app /app

USER app
WORKDIR /app/apps/backend
ENV HOST=:: PORT=3000
EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.sh"]
