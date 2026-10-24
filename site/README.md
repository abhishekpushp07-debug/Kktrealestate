# KKT Marketing Site (standalone)

React (CRA + craco + Tailwind) marketing website. Reads only public endpoints (`/api/public/*`) from the ERP backend.

## Env
| Var | Purpose |
|---|---|
| `REACT_APP_BACKEND_URL` | Backend origin (no trailing slash), e.g. `https://erp.kkt.in` |
| `REACT_APP_PORTAL_URL` | Fallback "Customer Login" link; overridden by Site Settings → `portal_url` from `/api/public/site` |
| `REACT_APP_ERP_URL` | "Staff login" link (`/erp` in preview, `https://erp.kkt.in/erp` in production) |
| `PORT` | Dev port (3002 in preview; the ERP dev server proxies `/` here) |

## Run
```
yarn install
yarn start      # http://localhost:3002
yarn build      # static build in ./build — deploy to any static host
```
Routes are mounted at basename `/`. No code is imported from `/app/frontend`.
