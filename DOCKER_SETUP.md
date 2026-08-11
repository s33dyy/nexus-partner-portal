# Docker Setup Guide

How to run LIVEY PAM CRM entirely in Docker — frontend + backend + Postgres — and populate it with working demo data and login credentials.

The stack is a bun-workspaces monorepo: `apps/frontend` (Vite SPA), `apps/backend`
(Hono REST API), and `packages/shared`. See
[docs/architecture/frontend-backend-split.md](docs/architecture/frontend-backend-split.md)
for the topology and environment-variable reference.

## Prerequisites

- Docker Desktop (or another Docker Engine + Compose v2) running locally.
- Nothing else. Postgres, the app runtime (Bun), and the build all happen inside containers — you don't need Bun/Node/Postgres installed on the host.

## 1. Clone and build

```bash
git clone https://github.com/s33dyy/nexus-partner-portal.git
cd nexus-partner-portal
docker compose up --build
```

Run this from the repo root (the folder containing `docker-compose.yml`) — if you see `no configuration file provided: not found`, you're one directory up from where you think you are.

**No `.env` file is required to run this.** The stack ships with working defaults (including a default `BOOTSTRAP_SUPER_ADMIN_PASSWORD`) baked into `docker-compose.yml`, so a fresh clone runs as-is.

### Optional: configure environment variables

Only needed if you want to change the seeded super admin password or enable an integration (Cloudinary, Zoho Sign, Google Sign-In, OpenRouter, Twilio):

```bash
cp .env.example .env
```

Then edit `.env` — e.g.:

```bash
BOOTSTRAP_SUPER_ADMIN_PASSWORD=<choose a password>
```

This becomes the login password for the primary seeded super admin account (`maya.admin@livey.tech`); if you skip this, it defaults to `ChangeMe123!`. Everything else in `.env` is optional — leave it blank to run the core app; the corresponding integration features simply stay disabled/inactive until you fill them in.

You do **not** need to change `DATABASE_URL` — `docker-compose.yml` overrides it at runtime to point the `backend` container at the `db` container over the compose network (`postgresql://postgres:postgres@db:5432/livey_partner_portal`), regardless of what's in `.env`.

If you edit `.env` after the stack is already running, restart `backend` to pick it up: `docker compose up -d --force-recreate backend` (`env_file` is only read at container creation).

## 2. Build and start the stack

```bash
docker compose up --build
```

This starts two services:

| Service    | What it is                                                                        | Port             |
| ---------- | --------------------------------------------------------------------------------- | ---------------- |
| `db`       | Postgres 16, database `livey_partner_portal`, user/password `postgres`/`postgres` | `localhost:5432` |
| `backend`  | Hono REST API (Bun)                                                               | `localhost:3000` |
| `frontend` | Built SPA, served statically                                                      | `localhost:8080` |

`backend` waits for `db`'s healthcheck before starting. On every container start, [`apps/backend/docker/entrypoint.sh`](apps/backend/docker/entrypoint.sh) runs `bun run db:migrate` (applies [`apps/backend/db/schema.sql`](apps/backend/db/schema.sql), idempotent — safe to re-run) and then launches the server. **Migrations run automatically; seed data does not** — that's a separate, explicit step so you don't accidentally wipe a database you care about.

Wait for `backend` to log that it's listening, then leave this running (or add `-d` to run detached).

## 3. Seed demo data

In a second terminal, with the stack running:

```bash
docker compose exec backend bun run db:bootstrap
```

This runs [`apps/backend/scripts/bootstrap-db.ts`](apps/backend/scripts/bootstrap-db.ts), which:

1. Re-applies migrations (no-op if already applied).
2. **Truncates and rebuilds** all core domain tables (profiles, partners, deals, tickets, notifications, etc. — see `RESET_TABLES` in that file for the full list).
3. Seeds 5 super admins and 5 fully-populated partner organizations (admin + user each, plus customers, deals, documents) from [`apps/backend/scripts/prod-demo-fixtures.ts`](apps/backend/scripts/prod-demo-fixtures.ts).
4. Seeds governed reference data (geography, tenants, roles) and feature flags.

⚠️ This is destructive to whatever is currently in the database — only run it against a database you're OK resetting (which, for a fresh `docker compose up`, is the point).

### Optional: richer supplemental data

For a fuller demo (catalogue/pricing, support tickets, learning content, rewards, news, notifications, audit events, real PDF documents, governed product catalogue), run the supplemental seed on top of the bootstrap seed. It's idempotent and additive — safe to run multiple times, and safe to run after the bootstrap seed:

```bash
docker compose exec backend bun scripts/seed-phase1-supplement.ts
```

## 4. Log in

Open **http://localhost:8080** (the frontend; it calls the backend on `localhost:3000`).

### `super_admin` (LIVEY internal, full access)

| Email                    | Password         |
| ------------------------ | ---------------- |
| `arjun.admin@livey.tech` | `Livey-Super-2!` |
| `nisha.admin@livey.tech` | `Livey-Super-3!` |
| `kabir.admin@livey.tech` | `Livey-Super-4!` |

### `partner_admin`

| Organization           | Email                        | Password             |
| ---------------------- | ---------------------------- | -------------------- |
| Northstar Systems      | `northstar.admin@livey.tech` | `Northstar-Admin-1!` |
| Harbor Logistics       | `harbor.admin@livey.tech`    | `Harbor-Admin-1!`    |
| Quantum Mesh Solutions | `quantum.admin@livey.tech`   | `Quantum-Admin-1!`   |

### `partner_user`

| Organization           | Email                       | Password            |
| ---------------------- | --------------------------- | ------------------- |
| Northstar Systems      | `northstar.user@livey.tech` | `Northstar-User-1!` |
| Harbor Logistics       | `harbor.user@livey.tech`    | `Harbor-User-1!`    |
| Quantum Mesh Solutions | `quantum.user@livey.tech`   | `Quantum-User-1!`   |

These fixed demo passwords come from [`apps/backend/scripts/prod-demo-fixtures.ts`](apps/backend/scripts/prod-demo-fixtures.ts). The seed also creates additional demo accounts, including the primary `maya.admin@livey.tech` account whose password is set through `BOOTSTRAP_SUPER_ADMIN_PASSWORD`. Treat every account in this section as local/demo data, not credentials to expose on a public deployment.

## Common operations

**Re-seed from scratch** (e.g. after pulling new fixture changes):

```bash
docker compose exec backend bun run db:bootstrap
```

**Rebuild after code changes:**

```bash
docker compose up --build
```

**View app logs only:**

```bash
docker compose logs -f backend
```

**Stop the stack (keeps data):**

```bash
docker compose down
```

**Stop and wipe the database volume (full reset):**

```bash
docker compose down -v
```

**Open a psql shell against the containerized database:**

```bash
docker compose exec db psql -U postgres -d livey_partner_portal
```

## Troubleshooting

- **`Missing BOOTSTRAP_SUPER_ADMIN_PASSWORD`** when running `db:bootstrap` — this shouldn't happen out of the box (it defaults to `ChangeMe123!`). If you've set a blank value in `.env`, remove that line or set a real password, then restart `backend` (`docker compose up -d --force-recreate backend`) so it picks up the new value, since `env_file` is only read at container creation.
- **`no configuration file provided: not found`** — you're not in the repo root. `cd` into the folder containing `docker-compose.yml` and re-run.
- **Port already in use (`3000` or `5432`)** — something else on the host is bound to that port. Either stop it, or change the left-hand side of the `ports:` mapping in `docker-compose.yml` (e.g. `"5433:5432"`).
- **`backend` can't reach Postgres / SSL errors** — don't edit `DATABASE_URL` inside `docker-compose.yml`'s `environment:` block; it's intentionally pinned to the in-network hostname `db` with `PGSSLMODE=disable`, since this local Postgres doesn't speak TLS and `db` isn't on the app's localhost SSL allow-list ([`apps/backend/scripts/db.ts`](apps/backend/scripts/db.ts), [`apps/backend/src/server/postgres.server.ts`](apps/backend/src/server/postgres.server.ts)).
- **Login works but data looks empty** — you started the stack but never ran the seed step (step 3) — migrations create empty tables, they don't populate them.
