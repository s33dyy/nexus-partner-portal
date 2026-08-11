# LIVEY PAM CRM

A partner relationship management portal, split into two independently
deployable services.

```
apps/frontend     Vite + TanStack Router SPA
apps/backend      Hono REST API + Postgres
packages/shared   Types and pure domain logic used by both
```

## Getting started

Run the whole stack in Docker — see [DOCKER_SETUP.md](DOCKER_SETUP.md) for
setup, seeding demo data, and login credentials.

To run the services directly with [bun](https://bun.sh):

```bash
bun install
cp .env.example .env                      # backend config; DATABASE_URL is required
echo 'VITE_API_BASE_URL=http://localhost:3000' > apps/frontend/.env.local

bun run db:migrate                        # apply the schema (idempotent)
bun run dev:backend                       # http://localhost:3000
bun run dev:frontend                      # http://localhost:8080
```

## Documentation

- [docs/API.md](docs/API.md) — every REST endpoint, its request/response shape,
  and the frontend function that calls it.
- [docs/architecture/frontend-backend-split.md](docs/architecture/frontend-backend-split.md)
  — topology, auth model, environment variables per service, and the pending
  production cutover checklist.
