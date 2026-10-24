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
