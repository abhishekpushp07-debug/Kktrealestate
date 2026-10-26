# Archive — parked surfaces (Phase C refocus, 2026-10-26)

KKT Constructions' product is now the **ERP only** (React app in `/app/frontend`, served at `/`; FastAPI in `/app/backend`).
The two other surfaces were zipped and removed from the working tree. They remain in git history and in these zips.

| Zip | Contents | Original path |
|---|---|---|
| `kkt-marketing-site-<date>.zip` | Public marketing website (standalone CRA app, README included). `node_modules/`, `build/` excluded. | `/app/site` |
| `kkt-customer-portal-expo-<date>.zip` | Customer portal (Expo web/iOS/Android, README included). `node_modules/`, `.expo/`, `dist/`, `build/` excluded. | `/app/mobile` |
| `deploy-assets-<date>.zip` | Pre-built static bundles that the old three-surface packager stitched under `/` and `/portal`. | `/app/frontend/deploy-assets` |

## Restore
1. `unzip archive/kkt-marketing-site-<date>.zip -d site && cd site && yarn install && yarn build` (same for `mobile` with `yarn expo start`).
2. Backend: set `PUBLIC_SURFACES_ENABLED=true` in `backend/.env` (non-secret) and restart — `/api/public/*` and `/api/portal/*` come back; `GET /api/bootstrap` reports `surfaces.public_website / customer_portal = true`, which re-shows the Website module and the Customer-360 portal access card in the ERP.
3. Re-add a supervisor program for Expo if you want it in preview (the `[program:mobile]` entry was removed from `/etc/supervisor/conf.d/supervisord.conf`).

## Gate behaviour while parked
- `PUBLIC_SURFACES_ENABLED` defaults to **false**. Every `/api/public/*` and `/api/portal/*` request returns `404 {"error":{"code":"NOT_FOUND",…}}` from the observability middleware before routing.
- Nothing is deleted: routers, seeds, PDFs and tests for public/portal are intact. The backend test suite exercises them because requests carrying the process-env test token (`LOGIN_RATE_LIMIT_BYPASS_TOKEN`, never in `.env`/production) see surfaces as enabled.
- Scheduler: portal/public-only background jobs (visit nudges, overdue-demand notifications) keep running — they are cheap (one indexed query every few hours) and harmless with no portal traffic.
- Staff-entered **Leads & Site Visits** stay fully available in the ERP; only the website intake (public enquiry/brochure/visit forms) is parked.
