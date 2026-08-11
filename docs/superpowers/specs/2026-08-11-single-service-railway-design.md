# Single-Service Railway Deployment Design

## Goal

Run LIVEY as exactly one Railway application service connected to the existing Postgres database, with the production application available at `https://systemforgelabs.xyz`.

## Chosen architecture

The existing `livey-partner-portal` Railway service remains the production application service because it already owns `systemforgelabs.xyz` and the integration environment variables. Its container will run one Bun process. That process will expose the existing Hono API and serve the compiled React single-page application from the same port and origin.

The final Railway canvas will contain only:

1. `livey-partner-portal` — combined frontend and backend application.
2. `Postgres` — existing database and volume.

The redundant `livey-frontend` and `livey-backend` services will be deleted only after the combined service passes every deployment gate.

## Build and runtime

A root production Dockerfile will use multiple stages:

1. Install the Bun workspace dependencies from the root lockfile.
2. Build `apps/frontend` with an empty `VITE_API_BASE_URL`, causing browser API requests to resolve against `window.location.origin`.
3. Assemble the backend runtime with `apps/backend`, `packages/shared`, production dependencies, and the compiled frontend files.
4. Start the existing backend entrypoint, which applies database migrations and then launches the Bun/Hono server on Railway's assigned port.

The root `railway.json` will point Railway at this combined Dockerfile and retain `/health` as the deployment health check.

## HTTP routing

Routing order is explicit:

- `/health` returns the backend health response.
- `/api/**` remains owned by existing API, OAuth, webhook, and document routes.
- Requests for real compiled assets return the corresponding file from the frontend distribution directory.
- Other non-API `GET` or `HEAD` requests return `index.html` so TanStack Router can handle client-side routes.
- Unknown `/api/**` requests remain JSON 404 responses and must never fall through to the SPA.

The frontend distribution directory is configured through `FRONTEND_DIST_PATH` in production and defaults to `apps/frontend/dist` for local combined-mode testing.

## Authentication and integrations

Frontend and API traffic will share `systemforgelabs.xyz`, so the existing HttpOnly, `SameSite=Lax` session cookie remains first-party. Production variables on the retained service will include:

- `FRONTEND_URL=https://systemforgelabs.xyz`
- `CORS_ALLOWED_ORIGIN=https://systemforgelabs.xyz`
- `GOOGLE_REDIRECT_URI=https://systemforgelabs.xyz/api/auth/google/callback`

Existing database and third-party integration secrets remain on the retained service and are not copied into Git or command output. The redundant service variables are not required after the cutover.

## Deployment sequence

1. Add the combined runtime and automated routing tests.
2. Run all unit tests, frontend/backend builds, and a local combined-runtime smoke test.
3. Commit and push the implementation to `main`.
4. Set the three same-origin production variables on `livey-partner-portal` without printing secret-bearing variable lists.
5. Deploy `main` to `livey-partner-portal` and wait for Railway's health check to succeed.
6. Verify `systemforgelabs.xyz`, `/health`, SPA deep links, API 404 behavior, login, and an authenticated dashboard request against the production deployment.
7. Delete `livey-frontend` and `livey-backend` by their verified service IDs.
8. Confirm Railway contains one application service plus Postgres and repeat the public smoke checks.

## Failure and rollback handling

The split services remain online during the combined deployment. If the combined service fails its build, health check, API checks, or authentication checks, no service is deleted. Railway can roll the retained service back to its prior successful deployment while the separate frontend and backend continue to provide a recovery path.

After deletion, the pushed combined-service commit is the durable deployment source. Railway deployment history on `livey-partner-portal` remains available for rollback.

## Verification and acceptance criteria

The change is complete only when all of the following are true:

- Git `main` is clean, pushed, and matches `origin/main`.
- Backend/shared/frontend tests pass.
- Frontend and backend TypeScript/production builds pass.
- Combined-container or combined-runtime checks prove static assets, SPA fallback, `/health`, and `/api/**` isolation.
- Railway reports `livey-partner-portal` online with a successful deployment.
- `https://systemforgelabs.xyz` returns the current frontend.
- `https://systemforgelabs.xyz/health` returns `{ "ok": true }`.
- Login creates a secure HttpOnly session and an authenticated user can reach the dashboard.
- Railway contains only `livey-partner-portal` and `Postgres`.

## Non-goals

- No database reset, reseeding, or destructive data migration.
- No changes to product features or role permissions.
- No rewriting, rebasing, force-pushing, or squashing published Git history.
- No deletion of the Postgres service or its volume.
