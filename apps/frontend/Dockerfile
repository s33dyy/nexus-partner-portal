# syntax=docker/dockerfile:1
# Build context is the repo root — bun workspaces needs the root manifest and
# lockfile to resolve @livey/shared.

FROM oven/bun:1.3-slim AS base
WORKDIR /app

FROM base AS deps
# Every workspace manifest must be present or bun considers the lockfile stale.
COPY package.json bun.lock bunfig.toml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/frontend ./apps/frontend

# Vite inlines import.meta.env.VITE_* at build time, so this must be a build
# argument — a runtime env var would arrive too late to reach the bundle.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN cd apps/frontend && bun run build

FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

COPY --from=build /app/apps/frontend/dist ./dist
COPY apps/frontend/serve.ts ./serve.ts
RUN chown -R app:app /app

USER app
ENV HOST=:: PORT=3000
EXPOSE 3000
ENTRYPOINT ["bun", "serve.ts"]
