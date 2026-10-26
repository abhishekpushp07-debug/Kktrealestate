# KKT v2 after the phase-5 hardening round

Phase 5 closed the gaps that the v2 80-factor audit (`docs/AUDIT-80-FACTORS-V2.md`) found. It ran in stages, each with its own
databases and Redis indexes so the stages never shared state, and each track was reviewed adversarially before integration. This
page links every report of the round and records the final verification.

## Stages and reports

| Stage                         | What it did                                                                                                                                                                                                                                                        | Reports                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation                    | production config (`_FILE` secrets, `TRUST_PROXY`, DB/Redis limits, key rings), migration lock, `withTransactionRetry`, CHECK constraints and partial unique indexes, sort and trigram indexes (migration 0002), tolerant error registry, ESLint/Prettier baseline | [foundation-report.md](foundation-report.md)                                                                                                                                                                        |
| Track: security & privacy     | escalation guards, gated search, CSV formula neutralising, proxy-aware client IP, lockout in Postgres, production bootstrap, single erasure path, KYC maker-checker, key rotation                                                                                  | [track-security.md](track-security.md), review: [review-security.md](review-security.md)                                                                                                                            |
| Track: money rules            | posting-order ledger, price-deviation guard, flat reservation + `HOLD_EXPIRY`, handover completeness, reversal on COMPLETED bookings, compact bookings list, retrying money transactions                                                                           | [track-money.md](track-money.md), review: [review-money.md](review-money.md)                                                                                                                                        |
| Track: platform reliability   | standalone worker, retries + failure alerts, schedules and boot jobs, `NOTIFICATION_SWEEP`, durable idempotency, staff PATCH version policy, async CSV exports, backup/restore                                                                                     | [track-platform.md](track-platform.md), review: [review-platform.md](review-platform.md)                                                                                                                            |
| Track: deploy & observability | production Compose + PgBouncer, Kubernetes manifests, database roles, S3 storage, prom-client metrics, OpenTelemetry, error webhook, graceful shutdown, API versioning gate                                                                                        | [track-deploy.md](track-deploy.md), review: [review-deploy.md](review-deploy.md)                                                                                                                                    |
| Track: frontend quality       | contrast and axe in every QA runner, 48 px targets, form aria wiring, IST in the ERP, PDF fonts + worker pool, website CSP                                                                                                                                         | [track-frontend.md](track-frontend.md), review: [review-frontend.md](review-frontend.md)                                                                                                                            |
| Integration: front ends       | ERP, website and portal wired to every new API capability; browser QA re-run                                                                                                                                                                                       | [integrate-frontends.md](integrate-frontends.md), checklist: [frontend-wiring.json](frontend-wiring.json)                                                                                                           |
| Integration: cross-track      | first boot, one-time secrets never replayed, API docs gating, trace ids in logs, job sweeps, Redis outage budget, `LEDGER_REBUILD`, snapshot-consistent integrity                                                                                                  | [integrate-crosscut.md](integrate-crosscut.md)                                                                                                                                                                      |
| Verify (this page)            | format and lint to zero, module boundaries enforced, last integration leftovers, every suite re-run, docs, load re-run                                                                                                                                             | this page; open items in [../STATUS.md](../STATUS.md), finished items in [../TODO-integration.md](../TODO-integration.md) (13 and 15), numbers in [../PERFORMANCE.md](../PERFORMANCE.md) ("Hardening round re-run") |

## Verify stage: what changed

- **Formatting:** Prettier now covers the whole repository (`pnpm format:check` passes). Two paths are excluded in `.prettierignore`:
  `docs/SPEC.md`, the owner's plain-text spec whose `====` banners and indented lists Markdown formatting would mangle, and
  `scripts/workflows/`, the orchestration scripts the workflow runner executes.
- **Lint:** ESLint reports 0 errors and 0 warnings in all 7 packages and in the root files, and every package lint script runs with
  `--max-warnings 0`.
  - `kkt/module-boundaries` is now an error. The 30 cross-module deep imports in `apps/api/src/modules` go through each module's
    `index.ts`, which re-exports what other modules use.
  - The React Compiler rules (`react-hooks` v7) were fixed in the code, with no blanket disables:
    - state resets moved out of effects into render-time adjustment (`useOnChange` in `apps/erp/src/lib/utils.ts`; the same pattern
      inline in the website and portal);
    - async loads tag their result with the request it answers, so loading flags are derived instead of set in effects;
    - `Date.now()` during render became a shared `useNow()` clock;
    - react-hook-form `watch()` became `useWatch`;
    - Reanimated shared values use `get()`/`set()`;
    - hydration guards use `useSyncExternalStore`;
    - the brochure gate mounts per opening.
  - The `@next/next/no-img-element` disable comments are gone: that plugin is not installed. Each of the 23 `eslint-disable` comments
    left gives its reason.
- **API:**
  - The version-policy exemptions for `PATCH /construction/photos/:photoId` and `PATCH /payment-plan-assignments/:id` are removed, and
    stage-photo rows always return `version`.
  - Rotated site-visit links answer 410 `LINK_EXPIRED`. Migration 0004 adds `site_visits.superseded_token_hashes`, which keeps hashes
    only.
  - Portal bells for demands, other-charge lines and payments carry their `booking_id`.
  - The OpenAPI snapshot was regenerated for the round's additive changes; nothing breaking.
- **Fix to an existing test:** the migration-lock test in `packages/db` counted a fixed four migrations. It now counts the committed
  journal.

## Final verification (2026-10-26)

| Check                                                                     | Result                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`                                                       | pass                                                                                                                                                                                                                                                               |
| `pnpm lint` (7 packages + root files, `--max-warnings 0`)                 | 0 errors, 0 warnings                                                                                                                                                                                                                                               |
| `pnpm typecheck`                                                          | 7/7 packages                                                                                                                                                                                                                                                       |
| Unit: domain / contracts / db / api / erp / web / portal                  | 130 / 183 / 71 / 114 / 162 / 17 / 13, all passing                                                                                                                                                                                                                  |
| API integration (46 files, serial)                                        | 588/588                                                                                                                                                                                                                                                            |
| Acceptance (13 owner scenarios)                                           | 55/55                                                                                                                                                                                                                                                              |
| OpenAPI compatibility gate                                                | no breaking change (snapshot regenerated for additive changes)                                                                                                                                                                                                     |
| Builds                                                                    | API bundle, ERP, website (Next.js), portal web export: all green                                                                                                                                                                                                   |
| Endpoints (route registry)                                                | 482 (404 staff, 35 portal, 43 public/system)                                                                                                                                                                                                                       |
| Browser QA re-run (Playwright + axe, 1440/390 px)                         | ERP 575 page checks, 178/179 assertions (the kanban drag gesture flaked once in the full walk, 18/18 on two `crm` re-runs), 523/524 axe scans clean (known transient cheques `target-size`); website 128/128, 0 serious/critical; portal 0 defects, 46 clean scans |
| Load re-run, 200 and 1,000 connections (`NODE_ENV=production`, 4 workers) | appended to `docs/PERFORMANCE.md`; see "Open" below for the throughput regression                                                                                                                                                                                  |

## Open after this round

These are listed in full in [../STATUS.md](../STATUS.md).

- **Request-pipeline throughput regression.** Every endpoint except the compact bookings list lost 30–55 % of its throughput compared
  with the end of the tuning round. This includes Redis-cached routes, so the cost is per request rather than in SQL. It has not been
  bisected yet; the candidates are listed in `docs/PERFORMANCE.md`.
- **Infra follow-ups from the cross-track stage:**
  - grant `kkt_app` read access on `drizzle.__drizzle_migrations` (until then the backup manifest's schema version is null);
  - set `DEPLOY_ID` from the deploy pipeline;
  - decide `DOCS_PUBLIC` per environment.
- **Not done this round:**
  - Hindi (Devanagari) text in PDFs needs a Noto font package.
  - The worker has no health or heartbeat port.
  - `PARTITIONING_ENABLED`, `JOB_BACKOFF_MS`, `PDF_WORKER_*` and `SHUTDOWN_*` are read straight from the environment instead of the
    validated config.
- **Product decisions still open:** these are listed at the end of [integrate-crosscut.md](integrate-crosscut.md).
