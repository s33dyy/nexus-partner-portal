# syntax=docker/dockerfile:1

FROM oven/bun:1.3-slim AS base
WORKDIR /app

# ---- full deps (build needs devDependencies: vite, nitro, tanstack plugins) ----
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- build the SSR bundle (nitro node-server preset -> .output) ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ---- production-only deps for scripts (migrate/bootstrap/seed use pg, dotenv, zod, etc.) ----
FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- runtime image ----
FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY package.json bun.lock tsconfig.json ./
COPY db ./db
COPY scripts ./scripts
COPY src ./src
COPY tmp/dummy-docs ./tmp/dummy-docs
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && chown -R app:app /app

USER app
ENV HOST=:: PORT=3000
EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.sh"]
