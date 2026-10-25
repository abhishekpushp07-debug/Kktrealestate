# KKT Real Estate — monorepo

Three independently deployable projects share one backend API:

| Path | What | Preview URL | Production deployment |
|---|---|---|---|
| `/app/backend` | FastAPI + MongoDB API (`/api/*`), serves ERP, website and portal | `https://royal-realty-hub-2.preview.emergentagent.com/api` | **Deployment 1** (with the ERP frontend) — e.g. `https://erp.kkt.in` |
| `/app/frontend` | **ERP** React app (staff). Mounted under `REACT_APP_BASE_PATH` (`/erp` in preview, `/` in production). `/portal*` on this origin redirects to Site Settings → `portal_url` (the Expo portal). | `…/erp` | Deployment 1 |
| `/app/site` | **Marketing website** — standalone React app, public endpoints only | `…/` (proxied from the ERP dev server) | **Deployment 2** (static) — e.g. `https://www.kkt.in` |
| `/app/mobile` | **Customer portal** — Expo app (web + iOS/Android), owned by the Expo specialist; consumes `/api/portal/*` | `https://royal-realty-hub-2.expo.preview.emergentagent.com` | **Deployment 3** — e.g. `https://my.kkt.in` |

No code is imported across projects. `/app/frontend/src/setupProxy.js` + `scripts/dev.js` are preview-only glue (see below).

## Environment variables

### backend/.env
| Var | Notes |
|---|---|
| `MONGO_URL`, `DB_NAME` | database |
| `JWT_SECRET`, `ENCRYPTION_KEY`, `REFRESH_TOKEN_DAYS` | auth / field encryption |
| `CORS_ORIGINS` | **comma-separated** browser origins allowed to call the API — must list the ERP, website and portal origins, e.g. `https://erp.kkt.in,https://www.kkt.in,https://my.kkt.in` |
| `PORTAL_PUBLIC_URL` | default for Site Settings → `portal_url` (Customer Login link, Customer-360 share link, `/api/portal/config`) |
| `ERP_PUBLIC_URL` | returned by `/api/portal/config.erp_url` |
| `STORAGE_*` | Emergent object storage |

### frontend/.env (ERP)
| Var | Notes |
|---|---|
| `REACT_APP_BACKEND_URL` | API origin |
| `REACT_APP_BASE_PATH` | router basename: `/erp` in preview, **unset or `/` in production** |
| `REACT_APP_PORTAL_URL` | fallback portal link (Site Settings `portal_url` wins) |

### site/.env (website)
`REACT_APP_BACKEND_URL`, `REACT_APP_PORTAL_URL`, `REACT_APP_ERP_URL` (`/erp` in preview → `https://erp.kkt.in/login` style in production), `PORT=3002` (preview only).

### mobile (Expo)
`EXPO_PUBLIC_BACKEND_URL` = API origin (see `/app/mobile/README.md`).

## Local / preview run
- `sudo supervisorctl status` — `backend` (8001), `frontend` (3000 + spawns the site on 3002), `mobile` (Expo, 3001).
- `cd /app/frontend && yarn start` runs `scripts/dev.js`: starts `/app/site` (`PORT=3002 PUBLIC_URL=/site-assets WDS_SOCKET_PATH=/site-ws`) and the ERP dev server (3000). `setupProxy.js` forwards every request that is not `/erp*`, `/portal*`, `/api*` or ERP dev assets to 3002 (HTTP + websocket), so `/` is the website and `/erp` is the ERP on one origin.
- `yarn start:erp` runs the ERP alone; `SKIP_SITE=true yarn start` also skips the site.
- `cd /app/site && yarn install && yarn start` runs the website standalone on 3002.
- Backend tests: `cd /app/backend && python -m pytest tests/ -q`. Site resolver unit tests were removed with the HOST_MAP resolver (no longer needed: each app is its own project).

## Production deployment recipe
1. **Deployment 1 — ERP + API + DB** (`erp.kkt.in`): deploy `/app/backend` + `/app/frontend` as the main full-stack app. Set `REACT_APP_BASE_PATH=/` (or unset), `REACT_APP_BACKEND_URL=https://erp.kkt.in`, backend `CORS_ORIGINS=https://erp.kkt.in,https://www.kkt.in,https://my.kkt.in`, `PORTAL_PUBLIC_URL=https://my.kkt.in`, `ERP_PUBLIC_URL=https://erp.kkt.in`. Attach the custom domain.
2. **Deployment 2 — Website** (`www.kkt.in`): frontend-only deploy of `/app/site` (`yarn build` → static `build/`). Env: `REACT_APP_BACKEND_URL=https://erp.kkt.in`, `REACT_APP_PORTAL_URL=https://my.kkt.in`, `REACT_APP_ERP_URL=https://erp.kkt.in`. Do **not** set `PUBLIC_URL` (that is preview-only). Attach the domain; SPA fallback to `index.html`.
3. **Deployment 3 — Portal** (`my.kkt.in`): `/app/mobile` Expo app — web build via `npx expo export --platform web` (static `dist/`, SPA fallback), native builds via EAS (`eas build`); env `EXPO_PUBLIC_BACKEND_URL=https://erp.kkt.in`. Full instructions: `/app/mobile/README.md`. Attach the domain. Portal API additions for the app: `GET /api/portal/service-requests/{id}/attachments/{idx}` (customer-scoped, excludes internal-note attachments) and ledger rows carry `bucket` (`Cash` / `Account` / `Other charges` / `null`).
4. In ERP → Website → Site Settings set **Customer portal URL** to `https://my.kkt.in` (drives the website's Customer Login link and the Customer-360 "Share login link").
5. Smoke: `GET https://erp.kkt.in/api/health`, `GET /api/portal/config` (no auth), CORS preflight from `https://my.kkt.in` on `/api/portal/auth/login`.

Portal API contract (`/api/portal/*`) is frozen for the Expo app — see `/app/memory/PRD.md` (Phase 5/6A) for the route list.


## Phase 7 — Construction stages & payment plans
Master data now has **Construction Stages** and **Payment Plans** (milestone templates are retired: `/api/master/milestone-templates*` → 410). Towers track stage completion (`/api/blocks/{id}/construction`); completing a stage auto-raises the linked plan installments for every active booking (`services/dues_engine.py`, idempotent, also daily at 00:30 IST and on startup). Migration from the old milestone model runs automatically at startup (`migrate_phase7.py`) and asserts every booking's ledger totals are unchanged.

## Preview modes (frontend/scripts/dev.js)
- `PREVIEW_MODE=production` in `frontend/.env` (default now): `yarn start` builds (if needed) and serves the **production** builds — ERP at `/erp` (SPA fallback) and the marketing site at `/` — from one express server on :3000 with brotli/gzip, immutable hashed assets and `no-cache` index.html. Rebuild after code changes with `yarn preview:build` (then `sudo supervisorctl restart frontend`).
- `yarn dev` (or any other `PREVIEW_MODE`): CRA dev servers with HMR (ERP :3000, site :3002 proxied).

## Phase 9 — Brochure lead gate & site visits
- Public: `POST /api/public/brochure-requests` → signed 15-min `download_url`; `GET /api/public/site-visits/availability?project_slug=`; `POST /api/public/site-visits`; `GET /api/public/site-visits/{token}(.ics)`; `POST /api/public/site-visits/{token}/cancel`.
- ERP: `/erp/site-visits` (calendar + list), lead timeline activities, dashboard widgets; per-project settings under Project → Website → "Site visits" / "Brochure lead gate".
- Permissions: `visit.read`, `visit.write`. Numbering: `SV-{FY}-{SEQ}`.

## Phase 11A — Canonical backend hardening (ERP v2 foundation)
- **Catalogues**: `GET /api/catalogues` (all dropdown types + compact structured masters, ETag/304, 5-min private cache), `POST /api/catalogues/{type}/items` (inline "+ Add new", permission `catalogue.write`), PATCH/reorder/CSV import+export. Seeded India-ready lists (states, Bihar cities, Patna localities, banks, segments…).
- **Project Setup**: `GET /api/projects/{id}/setup` (towers, stage sequences, plan assignments, pricing, parking, website flags, checklist) and `PUT /api/projects/{id}/setup/{towers|stages|plans|pricing}`.
- **CRM**: `PATCH /api/customers/{id}/profile` (catalogue-backed profiling, preferences, consent, RM), `POST/GET /api/communications`, `GET /api/customers/{id}/timeline` (cursor), `GET /api/bookings/{id}/ledgers` + `GET /api/customers/{id}/ledgers` (Cash / Account / Other charges / combined).
- **Packeting**: `GET /api/bootstrap`; `include=`, `fields=`, cursor pagination (`limit`+`cursor`, `with_total`), `GET /api/search?scope=`; strong ETags on every GET; `Server-Timing` + `X-Request-ID` headers.
- **Read models**: `project_summaries`, `block_summaries`, `customer_summaries`, `dashboard_snapshots` (event-bus debounced + 60 s sweep; `X-Data-Age`); `POST /api/admin/recompute-read-models`.
- **Scale**: tuned Mongo pool (`MONGO_MAX_POOL`, default 50/worker), optional `REDIS_URL` cache, single-leader schedulers via Mongo lease, index audit test (`tests/test_index_audit.py`), startup-migration test on a DB copy (`tests/test_startup_migrations.py`).
- **Load test**: `cd backend && WEB_CONCURRENCY=8 uvicorn server:app --port 8021 --workers 8 --backlog 8192 &` then `locust -f load/locustfile.py --headless -u 5000 -r 100 -t 5m --processes 8 --host http://localhost:8021 --csv load/out/run`. Results + capacity model in `memory/PRD.md`. Production: run `2 × CPU` workers (`WEB_CONCURRENCY`), Redis, Mongo replica set; keep `--reload` off.
- Run backend tests **per file** (`python -m pytest tests/<file>.py -n 0`) — the login limiter (10/min/IP) trips when files run together.
