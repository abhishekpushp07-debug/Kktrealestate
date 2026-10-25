# KKT v2 — Acceptance suite (SPEC §18)

The acceptance suite lives in `apps/api/test/acceptance/`: one file per SPEC §18 scenario 1–13, every assertion annotated with the
SPEC line it proves (`// SPEC L167: …`). Scenario 14 (production builds, 390 px layouts, contrast, console errors, settle times,
the booking wizard on a phone, the portal shell) is a browser-QA stage and is not part of this suite.

Every file is independent: it boots the demo state (docs/SEED.md) on its own, creates whatever extra records it needs through the
API (new customers, bookings, a villa block, a tower, plans, visits …) and never relies on another file having run. Files run
serially (`--no-file-parallelism`) because they share one database.

| # | Scenario (SPEC L242–L254) | Test file | Status | Notes |
|---|---|---|---|---|
| 1 | Roles see only permitted menus/APIs; a project-scoped user cannot discover other projects | `01-roles-and-scope.test.ts` | PASS | `/auth/me` bundles equal SPEC §1; 19 endpoints × 6 roles answer 200/403 by permission; Sales 403 on `POST /payments`, Marketing 403 on bookings; Project Admin (SGH) sees only SGH in lists/search and gets 404 NOT_FOUND on 14 GGV routes. |
| 2 | 15-floor tower, skip 13, refuge 7 → 52 flats, numbering, snapshots, PLC breakups; regenerate blocked once a flat is on Hold | `02-tower-generation.test.ts` | PASS | Asserted on the seeded Tower C and on a new Tower T generated through `POST /blocks` (prices from the SGH rate card: base, Floor Rise, Corner, Top Floor; Σ lines = total); `REGENERATE_BLOCKED` with a HOLD flat, regenerate succeeds when all Available. |
| 3 | Two simultaneous bookings for one flat → exactly one succeeds | `03-concurrent-booking.test.ts` | PASS | 2 and 5 concurrent `POST /bookings`: one 201, the rest 409 `FLAT_NOT_AVAILABLE` naming the winner; flat BOOKED by the winner only. |
| 4 | The worked ledger reproduces all 10 rows to the rupee; final due ₹0; booking Completed; flat Sold | `04-worked-ledger.test.ts` | PASS | Seeded booking #1 (GGV P1) AND a replay on a fresh villa block R (Villa CLP assigned, stages completed one by one, ten payments posted, handover → COMPLETED / SOLD, integrity clean). |
| 5 | Bucket cap message; audited revision; same payment succeeds; Sales cannot revise | `05-bucket-cap-revision.test.ts` | PASS | Exact message `Account agreed ₹40,00,000; already received ₹5,00,000; cannot accept ₹36,00,000 – revise the agreement first`; Sales 403 (`agreement.edit`); BELOW_PAID / bad sum / stale version refused; revision audited (`booking.agreement_revise`), AGREEMENT_CHANGE ledger row; the same ₹36 L then lands as an advance; cap re-applies at ₹45 L. |
| 6 | Cheques pending/cleared/bounced; reversal; missing Idempotency-Key 400; replay identical | `06-cheques-reversal-idempotency.test.ts` | PASS | PENDING excluded from paid/due and listed as cheques in hand (receipt "subject to realisation"); clearing applies it; bounced never counts and cancels the receipt; REVERSAL row −₹2 L + cancelled receipt; `IDEMPOTENCY_KEY_REQUIRED`; replay returns the identical body with `Idempotent-Replayed: true`; different body → 422 `IDEMPOTENCY_MISMATCH`. |
| 7 | Plan dropdown shows only assigned plans; missing-stage assignment rejected; percents ≠ 100 rejected | `07-plan-assignments.test.ts` | PASS | Towers A/B/C → Standard CLP (default) + DP + Flexi; GGV P → Villa CLP only; a Tower-B-only plan appears on B alone and disappears when its assignment is deactivated; booking on a non-applicable plan → `PLAN_NOT_APPLICABLE`; new "Landscaping" stage → `PLAN_STAGES_MISSING` listing it; 99.5 / 100.01 / 110 % refused (422 `PAYMENT_PLAN_INVALID`). |
| 8 | Flexi: 10 % immediately; 40 % raised exactly once at day 60, never twice | `08-flexi-time-trigger.test.ts` | PASS | Fresh Flexi booking and the seeded #7: `POST /dues/run` with `as_of` day 59 → 0, two concurrent day-60 runs → exactly 1, days 61/90/120 → 0; amounts 40 % × agreed per bucket; far-future `as_of` → 400. |
| 9 | Stage jump two ahead; installments for every active booking per bucket; buyers notified; undo blocked after a dated payment else voids + withdraws; integrity zero / flags / repairs | `09-stage-jump-undo-integrity.test.ts` | PASS | Tower B Foundation → 1st Slab marks Plinth too; 4 demands (2 Standard CLP bookings × 2 stages, telescoped % × agreed), none for the Flexi booking; DEMAND_RAISED bells on the buyer's portal; `UNDO_NOT_LATEST`; undo voids demands, rebuilds ledgers and withdraws bells (read → withdrawn, unread → deleted); after a payment dated today funds the slab demand → `UNDO_BLOCKED` with the receipt; integrity clean on seed, flags SUMMARY_MISMATCH + UNSATISFIED_DEMAND on manufactured anomalies, REPAIR voids/fixes, clean again. The anomaly part needs direct SQL (in-process, or `ACCEPTANCE_DATABASE_URL` in remote mode) and is skipped otherwise. |
| 10 | KYC masked for Sales; revealed + audited for permitted; portal never unmasked; public API no internal fields; buyer isolation | `10-kyc-privacy-isolation.test.ts` | PASS | Sales: masked only, `?reveal=true` 403 (`customer.kyc_view`) and no audit row; Super Admin: real PAN/Aadhaar/bank with `customer.kyc_reveal` audit rows (secrets stripped from audit); portal profile/home masked; 7 public endpoints carry no `id`/`*_id`/storage/cost keys and no HOLD/BOOKED/BLOCKED/SOLD; 13 portal routes of another buyer's booking are 404 incl. PDFs; signed file links bound to the issuing customer; staff token on portal → 401 `INVALID_AUDIENCE`. |
| 11 | Website: unpublished project 404s everywhere; show_prices off removes prices; enquiry → lead + inbox; 6th/min → 429; honeypot dropped | `11-website-publish-enquiries.test.ts` | PASS | Unpublished GGV absent from list/sitemap/gallery/site, 404 on detail/availability/brochure/visit, 400 on enquiry; republish restores; `show_prices=false` → no non-null price key anywhere, back on re-enable; enquiry → WEBSITE lead with UTM, inbox row (unread), staff bell, dedupe by phone+project; 6th enquiry from one IP → 429 `RATE_LIMITED` + `Retry-After`; honeypot → fake 200, nothing stored. |
| 12 | Brochure gate (details, no duplicate lead, forged link) + site visits (availability rules, SLOT_FULL, .ics IST, cancel, ERP reschedule, Completed → Site Visit Done) | `12-brochure-site-visits.test.ts` | PASS | Link only after valid details (15-min signed, counted once per link, `attachment` PDF); same phone reuses the lead; tampered/unknown links 404. Availability within today…+30 days, no Sundays, no slot before now + 12 h IST, blackout date disappears; 3 seats then 409 `SLOT_FULL`; `.ics` with `TZID=Asia/Kolkata` DTSTART/DTEND and `TRIGGER:-PT1H`; manage-link cancel frees the seat and reverts the lead to NEW; ERP reschedule into the full slot 409, into a free slot RESCHEDULED; complete → lead SITE_VISIT_DONE. |
| 13 | Reports reconcile with the ledger; PDFs download for receipt, demand letter, allotment letter, statement | `13-reports-pdfs.test.ts` | PASS | Collections = Σ CLEARED payments (pending/bounced/reversed excluded; rows add up by category and mode); outstanding = Σ positive bucket dues of ACTIVE bookings (ageing sums), advances = Σ negative parts; demand-vs-collection = Σ live demands / paid; cheques = Σ PENDING; statement = booking; receipt / demand letter / allotment letter / statement + report PDFs: `application/pdf`, `%PDF` header, attachment; portal signed links stream the same PDFs. |
| 14 | Quality bar (builds, 390 px, WCAG-AA, console, settle times, wizard on a phone, portal shell) | — | browser QA stage | Not an API scenario. |

Counts: 13 files, 55 tests, 696 `expect(…)` sites (many inside loops over roles, endpoints, flats and ledger rows), 200+ SPEC line citations.

## How to run

Prerequisites: PostgreSQL at `postgres://postgres:postgres@localhost:5432` (the suite creates and migrates its own database),
Redis at `redis://localhost:6379`, dependencies installed.

```bash
# in-process (default): boots the API on database kkt_acceptance + Redis db 12, seeds the demo once per file, calls app.inject
pnpm --filter @kkt/api test:acceptance            # = vitest run --dir test/acceptance --no-file-parallelism
pnpm --filter @kkt/api exec vitest run test/acceptance/09-stage-jump-undo-integrity.test.ts   # one scenario

# against a running server (fetch): the server is reseeded through POST /admin/reseed at the start of every file
ACCEPTANCE_BASE_URL=http://localhost:4000 pnpm --filter @kkt/api test:acceptance
ACCEPTANCE_BASE_URL=http://localhost:4000 ACCEPTANCE_DATABASE_URL=postgres://postgres:postgres@localhost:5432/kkt pnpm --filter @kkt/api test:acceptance   # also runs the SQL-only anomaly step of scenario 9
```

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `ACCEPTANCE_BASE_URL` | unset | When set, run over HTTP against that server instead of in-process. The server must trust `X-Forwarded-For` (`TRUST_PROXY=true`, the default) so per-IP limits can be exercised, and must not be `NODE_ENV=production` (reseed is disabled there). |
| `ACCEPTANCE_RESEED` | `1` | Remote mode only: `0` skips the reseed per file (files then depend on whatever state the server has and may not be independent). |
| `ACCEPTANCE_DATABASE_URL` | `postgres://…/kkt_acceptance` (in-process) / unset (remote) | In-process: the database to create/migrate/seed. Remote: an optional direct connection to the server's database for the SQL-only step of scenario 9. |
| `ACCEPTANCE_REDIS_URL` | `redis://localhost:6379/12` | In-process Redis database (flushed per file). |
| `STORAGE_LOCAL_DIR` | a fresh temp dir | Where the in-process seed stores uploaded documents. |

Timing: one in-process file takes ≈ 25 s to seed plus a few seconds of scenario; the whole suite runs in ≈ 6–7 minutes.

## Defects found and fixed while writing the suite

* `packages/contracts/src/common.ts` `updateOf()`: Zod 4 keeps applying create-time `.default()` values inside `.partial()`, so every
  partial PATCH built from an Update schema silently reset defaulted fields — e.g. `PATCH /projects/:id/website {show_prices:false}`
  unpublished the project and wiped its hero images, highlights, videos, tours and FAQs. `updateOf` now strips the defaults before
  making fields optional (a key the client did not send stays untouched); regression test in `packages/contracts/test/common.test.ts`.
  All 35 Update schemas (masters, CMS, notices, blocks, leads, customers, company settings) benefit; the API handlers already treated
  `undefined` as "leave as is".
* `apps/api/src/seed/run.ts` `seedDemo()`: the seed drives the API in-process as the staff logins, which bumped their per-user
  write-rate counters (`rl:w:<userId>`) in Redis by several hundred. The seed lifts the limit while it runs but the counters stayed,
  so the Super Admin who triggered `POST /admin/reseed` on a live server was throttled (429) for the next minute — found by running
  this suite in remote mode. The counters are now cleared when the seed finishes, together with the lifted limit.

Remote mode was verified against a live `tsx src/server.ts` (scenarios 3, 4, 9, 11 over HTTP with a reseed per file; the SQL-only
anomaly step of scenario 9 is reported as skipped without `ACCEPTANCE_DATABASE_URL`).
