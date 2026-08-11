# Frontend / Backend Split

## Why

The portal used to be one TanStack Start app: React routes and server logic
compiled into a single Nitro bundle and deployed as one process. The boundary
between "frontend" and "backend" existed only in folder names — TanStack's
`createServerFn` generated the network call invisibly, so there was no API you
could read, document, or test on its own.

It is now two independently deployable services with a real HTTP contract
between them.

## Topology

```
┌─────────────────────────┐     HTTPS + HttpOnly cookie        ┌────────────────────────┐
│  apps/frontend          │  ────────────────────────────────► │  apps/backend          │
│  Vite + TanStack Router │                                    │  Hono REST API         │
│  static SPA (Bun serve) │  ◄──────────────────────────────── │  (Bun)                 │
└─────────────────────────┘            JSON responses          └───────────┬────────────┘
                                                                           │ pg
                                        ┌──────────────────────────────────▼───────────┐
      Zoho Sign · Google OAuth ────────►│  Postgres                                    │
      Twilio Voice · WhatsApp  ────────►│                                              │
        (webhooks hit the backend)      └──────────────────────────────────────────────┘

              packages/shared — types + pure domain logic, imported by both
```

- **apps/frontend** — client-rendered SPA. No SSR: the portal is entirely
  behind a login, so there was nothing for server rendering to buy. Built by
  Vite into `dist/`, served in production by a ~20-line `Bun.serve()` static
  server (`apps/frontend/serve.ts`) that falls back to `index.html` so
  client-side routes survive a hard refresh.
- **apps/backend** — Hono API. Owns `db/`, `scripts/`, `supabase/`, and every
  `*.server.ts` module. Hono was chosen because the pre-existing webhook
  handlers already spoke Web-standard `Request`/`Response`, so they ported by
  wrapping `c.req.raw`.
- **packages/shared** — types and pure functions with no I/O. Both apps alias
  `@/domain/contracts/*` here, so the pre-split import paths still resolve.

## Auth

Browser sessions use a `SameSite=Lax`, `HttpOnly` cookie issued by the backend.
The SPA calls the API with `credentials: "include"`; the reusable session token
is never returned in JSON, placed in a URL, or stored in browser storage. Hono's
request middleware resolves that cookie into an `AsyncLocalStorage` context for
the existing service layer. A bearer fallback remains only for trusted
non-browser/direct-handler callers.

In production, deploy the frontend and API beneath the same registrable domain
(for example `systemforgelabs.xyz` and `api.systemforgelabs.xyz`) so the Lax
cookie remains first-party. The explicit CORS allow-list permits credentials
only from the configured frontend origin.

**Google OAuth keeps an explicit linking hop.** Settings' "Connect Google"
flow uses a single-use ticket so the callback intent does not depend on an
ambient browser session:

1. The SPA calls `POST /api/auth/google/link-ticket` (cookie-authenticated) and gets a
   single-use, 5-minute ticket.
2. It navigates to `/api/auth/google/connect?ticket=…`.
3. `/connect` consumes the ticket and sets a short-lived `google_oauth_actor`
   cookie.
4. `/callback` reads that cookie to distinguish "link to this user" from
   "fresh sign-in". On fresh sign-in it sets the normal HttpOnly session cookie
   and redirects to `FRONTEND_URL/auth/callback` without placing credentials in
   the URL.

## Environment variables

### Backend (`apps/backend`) — runtime

| Variable                                                                                                                                                                                 | Purpose                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                                                                                           | Postgres connection string                                                         |
| `FRONTEND_URL`                                                                                                                                                                           | Origin the backend redirects to after OAuth, and the base for password-reset links |
| `CORS_ALLOWED_ORIGIN`                                                                                                                                                                    | Allow-listed browser origin(s), comma-separated                                    |
| `BOOTSTRAP_SUPER_ADMIN_PASSWORD`                                                                                                                                                         | Only read by the manual `db:bootstrap` seed script                                 |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET`                                                                                                                                     | Image uploads                                                                      |
| `ZOHO_SIGN_CLIENT_ID` / `_CLIENT_SECRET` / `ZOHO_ACCOUNTS_URL` / `ZOHO_SIGN_API_URL` / `ZOHO_SIGN_REDIRECT_URI` / `ZOHO_SIGN_TEMPLATE_ID` / `ZOHO_SIGN_WEBHOOK_SECRET` / `SIGN_PROVIDER` | Agreement e-signing                                                                |
| `GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`                                                                                                                            | Google Sign-In                                                                     |
| `OPENROUTER_API_KEY`                                                                                                                                                                     | In-app Assistant                                                                   |
| `TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_VERIFY_SERVICE_SID` / `_WHATSAPP_FROM`                                                                                                          | WhatsApp Assistant                                                                 |
| `TWILIO_VOICE_NUMBER` / `_TWIML_APP_SID` / `_VOICE_API_KEY_SID` / `_VOICE_API_KEY_SECRET`                                                                                                | Browser softphone                                                                  |

### Frontend (`apps/frontend`) — **build time only**

| Variable            | Purpose        |
| ------------------- | -------------- |
| `VITE_API_BASE_URL` | Backend origin |

Vite inlines `import.meta.env.VITE_*` into the bundle during `vite build`, so
this must be set **when the image is built**, not when it runs. It is a Docker
build `ARG` and must be a Railway **build** variable. Setting it as a plain
runtime variable silently produces a bundle that calls the wrong origin.

Locally, put it in `apps/frontend/.env.local`. All other variables live in a
single `.env` at the repo root; `apps/backend/src/lib/load-env.ts` loads it
from the workspace.

## Deployment

Both Railway services build from the **repo root** so bun workspaces can
resolve `@livey/shared`, and each is pointed at its own Dockerfile via the
`RAILWAY_DOCKERFILE_PATH` service variable:

| Service          | Dockerfile                 | Health check  |
| ---------------- | -------------------------- | ------------- |
| `livey-backend`  | `apps/backend/Dockerfile`  | `GET /health` |
| `livey-frontend` | `apps/frontend/Dockerfile` | `GET /`       |

The backend entrypoint runs `db:migrate` then starts the server. Migrations
apply `db/schema.sql`, which is additive and idempotent (`CREATE … IF NOT
EXISTS`, `ALTER TYPE … ADD VALUE IF NOT EXISTS`), so re-running it on every
boot is safe. `db:bootstrap` **truncates and reseeds** and is never run
automatically — only by hand against a disposable database.

`.railwayignore` keeps `railway up` uploads small; without it the 790 MB
`remotion-training-videos/` directory makes the upload time out.

## Cutover checklist — NOT yet done

The new services run alongside the original `livey-partner-portal`, which is
still serving `systemforgelabs.xyz`. External providers still point at that
domain, and each provider allows only one callback URL, so these can only be
switched at cutover — doing it early breaks the live app.

- [ ] **Google Cloud Console** — authorized redirect URI → `<backend>/api/auth/google/callback`
- [ ] **Zoho Sign console** — redirect URI → `<backend>/api/integrations/zoho-sign/callback`, webhook → `<backend>/api/integrations/zoho-sign/webhook`
- [ ] **Twilio** — WhatsApp webhook → `<backend>/api/integrations/whatsapp/webhook`
- [ ] **Twilio TwiML app** — voice request/status URLs → `<backend>/api/integrations/twilio/voice/{incoming,outgoing,status}`
- [ ] **DNS** — point `systemforgelabs.xyz` at the frontend service
- [ ] Set the backend's `FRONTEND_URL` and `CORS_ALLOWED_ORIGIN` to the real domain, rebuild the frontend with `VITE_API_BASE_URL` set to the backend's final domain
- [ ] Verify a real partner login, a Zoho signature round-trip, and an inbound Twilio call
- [ ] Retire `livey-partner-portal`

Until then the webhook routes are reachable at the new backend and their code
paths are correct, but no external provider is calling them.
