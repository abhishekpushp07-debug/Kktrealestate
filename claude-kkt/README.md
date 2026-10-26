# KKT v2 — Real-estate ERP for Indian builders

One backend, three front doors, built from the owner's specification in [`docs/SPEC.md`](docs/SPEC.md):

| Surface           | App           | Stack                                                                | URL (prod)              |
| ----------------- | ------------- | -------------------------------------------------------------------- | ----------------------- |
| Marketing website | `apps/web`    | Next.js 15 (App Router, ISR, SEO, brochure gate, site-visit booking) | `www.`                  |
| Staff ERP         | `apps/erp`    | Vite + React 19 + Tailwind 4, dense navy/gold data-first UI          | `erp.`                  |
| Customer portal   | `apps/portal` | Expo (web + iOS + Android), cached-first                             | `my.`                   |
| API + jobs        | `apps/api`    | Fastify 5 + Zod, PostgreSQL 16 (Drizzle), Redis 7, BullMQ            | `/api/v1` on every host |

Shared packages: `packages/contracts` (Zod wire schemas, enums, permissions — one source of truth for all four apps), `packages/domain` (pure, fully unit-tested business engines: money, pricing, flat generation, payment plans, auto-dues with telescoping rounding, two-bucket ledger, site-visit availability), `packages/db` (schema, migrations, append-only audit trigger, database invariants).

## Start here

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack decisions with reasons, module map, security, scale plan to 5 lakh users, phase plan.
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md) — every table, constraint and index.
- [docs/API-CONVENTIONS.md](docs/API-CONVENTIONS.md) — envelopes, headers, idempotency, versions, fixed auth/public/portal surfaces.
- [docs/SECURITY.md](docs/SECURITY.md), [docs/DEPLOY.md](docs/DEPLOY.md), [docs/SEED.md](docs/SEED.md) (demo logins), [docs/PERFORMANCE.md](docs/PERFORMANCE.md), [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
- [docs/STATUS.md](docs/STATUS.md) — what is built, all verification evidence (588 integration + 55 acceptance tests, browser QA, load test) and the honest open-items list; [docs/hardening/STATUS-after-phase5.md](docs/hardening/STATUS-after-phase5.md) summarises the hardening round.
- [docs/AUDIT-80-FACTORS.md](docs/AUDIT-80-FACTORS.md) — the 80-factor audit of the previous implementation that motivated this rebuild; [docs/AUDIT-80-FACTORS-V2.md](docs/AUDIT-80-FACTORS-V2.md) scores this implementation on the same factors.

## Run locally

```bash
pnpm install && cp .env.example .env
pnpm db:migrate && pnpm api        # API on :4000 (seeds the demo builder on first boot)
pnpm erp                           # ERP on :5173   → admin@sgb.in / Admin@12345
pnpm web                           # website on :3000
pnpm portal                        # portal (web) on :8081 → phone 9876543210 / Welcome@123
```

Needs Node 22, pnpm 10, PostgreSQL 16 and Redis 7 (`docker compose up postgres redis` works). Full production recipe: `docs/DEPLOY.md`.

## Quality gates

Every push runs these in CI (`.github/workflows/ci.yml`); all pass at the end of the phase-5 hardening round:

| Gate              | Command                                             | State                                                                                                        |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Formatting        | `pnpm format:check`                                 | Prettier, whole repo (`docs/SPEC.md` and generated files excluded)                                           |
| Lint              | `pnpm lint`                                         | ESLint 0 errors / 0 warnings (`--max-warnings 0`), React Compiler rules, `kkt/module-boundaries` as an error |
| Types             | `pnpm typecheck`                                    | 7/7 packages                                                                                                 |
| Unit tests        | `pnpm test`, `pnpm --filter @kkt/db test`           | domain 130 · contracts 183 · db 71 · api 114 · erp 162 · web 17 · portal 13                                  |
| API integration   | `pnpm --filter @kkt/api test:integration`           | 588 tests / 46 files against PostgreSQL 16 + Redis 7                                                         |
| Acceptance        | `pnpm test:acceptance`                              | the 13 owner scenarios, 55 tests                                                                             |
| API compatibility | `pnpm --filter @kkt/api openapi:check`              | no breaking change against `docs/openapi/v1.json`                                                            |
| Builds            | `pnpm build`, `pnpm --filter @kkt/portal build:web` | API bundle, ERP, website; portal web export                                                                  |

Nightly (`.github/workflows/nightly.yml`): the load-test smoke (`pnpm loadtest`, numbers in `docs/PERFORMANCE.md`) and the three
browser QA runners with axe (`docs/qa`). Current numbers and open items: [docs/STATUS.md](docs/STATUS.md).
