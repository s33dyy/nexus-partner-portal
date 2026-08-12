# Docker Setup Guide

How to run LIVEY PAM CRM entirely in Docker — app + Postgres — and populate it with working demo data and login credentials.

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

You do **not** need to change `DATABASE_URL` — `docker-compose.yml` overrides it at runtime to point the `app` container at the `db` container over the compose network (`postgresql://postgres:postgres@db:5432/livey_partner_portal`), regardless of what's in `.env`.

If you edit `.env` after the stack is already running, restart `app` to pick it up: `docker compose up -d --force-recreate app` (`env_file` is only read at container creation).

## 2. Build and start the stack

```bash
docker compose up --build
```

This starts two services:

| Service | What it is | Port |
|---|---|---|
| `db` | Postgres 16, database `livey_partner_portal`, user/password `postgres`/`postgres` | `localhost:5432` |
| `app` | The built app (Bun runtime, Nitro SSR output) | `localhost:3000` |

`app` waits for `db`'s healthcheck before starting. On every container start, [`docker/entrypoint.sh`](docker/entrypoint.sh) runs `bun run db:migrate` (applies [`db/schema.sql`](db/schema.sql), idempotent — safe to re-run) and then launches the server. **Migrations run automatically; seed data does not** — that's a separate, explicit step so you don't accidentally wipe a database you care about.

Wait for `app` to log that it's listening, then leave this running (or add `-d` to run detached).

## 3. Seed demo data

In a second terminal, with the stack running:

```bash
docker compose exec app bun run db:bootstrap
```

This runs [`scripts/bootstrap-db.ts`](scripts/bootstrap-db.ts), which:

1. Re-applies migrations (no-op if already applied).
2. **Truncates and rebuilds** all core domain tables (profiles, partners, deals, tickets, notifications, etc. — see `RESET_TABLES` in that file for the full list).
3. Seeds 5 super admins and 5 fully-populated partner organizations (admin + user each, plus customers, deals, documents) from [`scripts/prod-demo-fixtures.ts`](scripts/prod-demo-fixtures.ts).
4. Seeds governed reference data (geography, tenants, roles) and feature flags.

⚠️ This is destructive to whatever is currently in the database — only run it against a database you're OK resetting (which, for a fresh `docker compose up`, is the point).

### Optional: richer supplemental data

For a fuller demo (catalogue/pricing, support tickets, learning content, rewards, news, notifications, audit events, real PDF documents, governed product catalogue), run the supplemental seed on top of the bootstrap seed. It's idempotent and additive — safe to run multiple times, and safe to run after the bootstrap seed:

```bash
docker compose exec app bun scripts/seed-phase1-supplement.ts
```

## 4. Log in

Open **http://localhost:3000**.

### Super admin accounts (LIVEY internal, full access)

| Email | Password |
|---|---|
| `maya.admin@livey.tech` | *whatever you set as `BOOTSTRAP_SUPER_ADMIN_PASSWORD`* |
| `arjun.admin@livey.tech` | `Livey-Super-2!` |
| `nisha.admin@livey.tech` | `Livey-Super-3!` |
| `kabir.admin@livey.tech` | `Livey-Super-4!` |
| `sanya.admin@livey.tech` | `Livey-Super-5!` |

### Partner accounts (per-org admin + user)

| Organization | Admin login | Password | User login | Password |
|---|---|---|---|---|
| Northstar Systems | `northstar.admin@livey.tech` | `Northstar-Admin-1!` | `northstar.user@livey.tech` | `Northstar-User-1!` |
| Harbor Logistics | `harbor.admin@livey.tech` | `Harbor-Admin-1!` | `harbor.user@livey.tech` | `Harbor-User-1!` |
| Quantum Mesh Solutions | `quantum.admin@livey.tech` | `Quantum-Admin-1!` | `quantum.user@livey.tech` | `Quantum-User-1!` |
| BluePeak Integrators | `bluepeak.admin@livey.tech` | `BluePeak-Admin-1!` | `bluepeak.user@livey.tech` | `BluePeak-User-1!` |
| SummitFlow Commerce | `summitflow.admin@livey.tech` | `SummitFlow-Admin-1!` | `summitflow.user@livey.tech` | `SummitFlow-User-1!` |

These 14 passwords are fixed in [`scripts/prod-demo-fixtures.ts`](scripts/prod-demo-fixtures.ts) (only the first super admin's password is overridable via `BOOTSTRAP_SUPER_ADMIN_PASSWORD`) — fine for local/demo use, but treat this as demo data, not something to expose on a public deployment.

## Common operations

**Re-seed from scratch** (e.g. after pulling new fixture changes):
```bash
docker compose exec app bun run db:bootstrap
```

**Rebuild after code changes:**
```bash
docker compose up --build
```

**View app logs only:**
```bash
docker compose logs -f app
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

- **`Missing BOOTSTRAP_SUPER_ADMIN_PASSWORD`** when running `db:bootstrap` — this shouldn't happen out of the box (it defaults to `ChangeMe123!`). If you've set a blank value in `.env`, remove that line or set a real password, then restart `app` (`docker compose up -d --force-recreate app`) so it picks up the new value, since `env_file` is only read at container creation.
- **`no configuration file provided: not found`** — you're not in the repo root. `cd` into the folder containing `docker-compose.yml` and re-run.
- **Port already in use (`3000` or `5432`)** — something else on the host is bound to that port. Either stop it, or change the left-hand side of the `ports:` mapping in `docker-compose.yml` (e.g. `"5433:5432"`).
- **`app` can't reach Postgres / SSL errors** — don't edit `DATABASE_URL` inside `docker-compose.yml`'s `environment:` block; it's intentionally pinned to the in-network hostname `db` with `PGSSLMODE=disable`, since this local Postgres doesn't speak TLS and `db` isn't on the app's localhost SSL allow-list ([`scripts/db.ts`](scripts/db.ts), [`src/server/postgres.server.ts`](src/server/postgres.server.ts)).
- **Login works but data looks empty** — you started the stack but never ran the seed step (step 3) — migrations create empty tables, they don't populate them.

## Railway: how migrations actually run (read before changing `railway.json`)

`railway.json` sets `"builder": "RAILPACK"`, which means **Railway does not use the
Dockerfile at all** — `docker/entrypoint.sh` and its `ENTRYPOINT` are only used by
`docker compose` locally. Migrations on Railway run as a **pre-deploy step**:

```
"deploy": {
  "healthcheckPath": "/",
  "preDeployCommand": "bun run db:migrate"
}
```

`preDeployCommand` runs after the build and before the new version takes traffic.
A failure there is reported as a failed migration, which is what you want.

### Do NOT chain migrations into `startCommand`

This was tried and it broke every deploy. `"bun run db:migrate && …start…"` couples
two unrelated failure modes: if the migration exits non-zero for any reason the
`&&` short-circuits, the server never starts, and Railway reports a **five-minute
healthcheck timeout** with no indication the real cause was a migration.

The specific trigger was `scripts/apply-migrations.ts`'s watchdog, which was set to
10 seconds. It exists to kill a held-open Railway TLS socket *after* migrations
finish — it was never meant to bound the migration itself, and `db/schema.sql` is
~2,000 lines, which against a cold remote Postgres takes longer than 10s. It is now
120s, and migrations no longer gate server start regardless.

### Other traps, each hit once already

1. **Removing the migration step and expecting the Dockerfile's ENTRYPOINT to take
   over.** It won't, while the builder is Railpack. Migrations then silently stop
   running, which stays invisible until the next schema change and then breaks the
   app — the generated SQL in `TABLE_COLUMNS` selects columns the deployed database
   doesn't have, including on `profiles`, which is read on every login.
2. **Invoking `node` in a Railway command.** Prefer `bun`. (Railpack does provision
   node, but the Docker runtime image does not.)

If you ever switch `builder` to `DOCKERFILE`, drop `preDeployCommand` — the
ENTRYPOINT already runs migrations before starting the server.
