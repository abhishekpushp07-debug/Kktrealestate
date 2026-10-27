# Phase 7 — money & construction track report

Scope: the MONEY & CONSTRUCTION task of phase 7 (v3 audit, docs/AUDIT-80-FACTORS-V3.md findings A/E "DAILY_DUES isolation", E
"integrity twice / repair re-check", B "ledger is not a book of record", E "stage undo and closed bookings", C "receipt sequence lock",
B "payment/demand search", B "money in jsonb"). Everything is in the working tree under /home/user/Kktrealestate/claude-kkt; nothing is
committed. Databases used: kkt_p7_m (integration, Redis 4), kkt_p7_m_acc (acceptance / packages/db tests, Redis 5).

## Changes (file list)

**packages/db**

- `src/sql/0006_money_guards.sql` (new) — triggers, binding every role (owner included):
  - `ledger_entries_append_only`, `ledger_rebuilds_append_only` (BEFORE UPDATE OR DELETE, row) → `restrict_violation` (23001);
  - `ledger_entries_no_truncate`, `ledger_rebuilds_no_truncate` (BEFORE TRUNCATE, statement) → refused unless the same transaction holds
    `bookings` in ACCESS EXCLUSIVE mode, i.e. the bookings are truncated in the same statement (the guarded reseed's full reset; TRUNCATE
    locks every relation, cascaded ones included, before any trigger fires);
  - `payments_financial_guard` (BEFORE UPDATE, row): id, company/booking/project/block/customer, receipt_number, against, bucket,
    other_charge_id, amount, payment_date, payment_mode_id, mode_code, instrument, bank_account_id, received_by, posted_at,
    idempotency_key, created_at/by never change; status only PENDING → CLEARED | BOUNCED and CLEARED → REVERSED. Lifecycle
    timestamps/actors/reasons, receipt_cancelled, remarks, version, updated_at stay writable.
- `test/migrate.test.ts`, `test/online.test.ts` — the expected list of hand-written SQL files now includes `0006_money_guards.sql`
  (only those lines changed).

**packages/domain**

- `src/ledger.ts` — new event `DEMAND_VOIDED {cashPaise, accountPaise}` (positive magnitudes; takes the amounts back out of the order raised;
  row amount = −(cash + account)); kind priority DEMAND < OTHER_CHARGE_DEMAND < AGREEMENT_CHANGE < PLAN_CHANGE < DEMAND_VOIDED < PAYMENT <
  OTHER_CHARGE_PAYMENT < REVERSAL < OTHER_CHARGE_REVERSAL < CANCELLATION (relative order of the existing kinds unchanged).
- `test/ledger.test.ts` — 4 tests (compensation, advance returns to credit, sort position + append = derive, guards).
- `src/dues.ts` — unchanged (nothing needed).

**packages/contracts**

- `src/modules/bookings.ts` — `LedgerTotalsSchema`, `LedgerListQuerySchema` (`?epoch=`), `LedgerResponseSchema` (+`epoch`, `current_epoch`,
  `summary` extended with the six C7 totals, `epoch_totals`), `LEDGER_REBUILD_REASONS` / `LedgerRebuildReasonSchema`,
  `LedgerRowDifferenceSchema`, `LedgerRebuildSummarySchema`, `LedgerRebuildRowSchema`, `LedgerRebuildListResponseSchema`.
- `src/modules/dues.ts` — `DuesFailureSchema`; `RunDuesResponseSchema` + optional `bookings_failed`, `failures`;
  `IntegrityRepairResponseSchema` + optional `kept_now_satisfied`.
- `src/errors.ts` — `BOOKING_CLOSED` (409), two targeted edits (ERROR_CODES, ERROR_STATUS).
- `test/money-ledger.test.ts` (new, 7 tests).

**apps/api — money module** (`src/modules/money/**`)

- `services/ledger.ts` — book of record: `appendEvent` / new `prepareAppend` append to the current epoch; `rebuild()` never deletes —
  a differing canonical result is written as epoch n + 1 with a `ledger_rebuilds` row and a `LEDGER_RESTATED` row closing epoch n, an
  identical one writes nothing (summary columns are still corrected when they drift); options `{write, reason, actor}`, result adds
  `{written, restated, epoch, rebuildId}`; `sourceEvents` includes voided demands (DEMAND + DEMAND_VOIDED; a void after a cancellation
  is not an event) and reads the cancellation money columns; helpers `currentEpochOf`, `epochRows`, `ledgerTotals`, `ledgerRebuildRows`;
  `ledgerRows(db, id, epoch?)` reads the current epoch; `writeSummary` exported.
- `services/dues.ts` — `raiseDuesForAll`: one transaction per booking, **lock first** (`lockBooking`: row FOR UPDATE + advisory) **then**
  read the booking and its tower stages; a throwing booking is rolled back, logged, counted (`kkt_dues_booking_failures_total{code}`) and
  listed in `RunSummary.failures` (booking id/number, code, message) — the run continues. `failureCode()` (ApiError code, INVALID_AMOUNT,
  `SQLSTATE_<code>`, INTERNAL_ERROR). `voidDemandsForStage`: only ACTIVE bookings are rewritten, CANCELLED are skipped, COMPLETED → 409
  `BOOKING_CLOSED`; every void (stage undo, plan change, repair) appends a `DEMAND_VOIDED` row (`voidAndRecord`); `voidDemand(…, {clock})`.
- `services/integrity.ts` — repair re-checks each booking under its lock (booking, stages and demands re-read, `checkBooking` re-run) and
  voids only demands that were in the confirmed report AND are still unjustified; others are reported in `kept_now_satisfied`; missing
  demands are raised from the fresh check; rebuild reason INTEGRITY_REPAIR.
- `services/bookings.ts` — agreement revision appends AGREEMENT_CHANGE **before** the booking's agreed values change (the row's amount is
  now the agreement delta the rebuild derives; before, the live row said 0 and every revision was silently rewritten), rebuild reason
  AGREEMENT_REVISION; plan change voids with DEMAND_VOIDED rows and appends PLAN_CHANGE itself (reason PLAN_CHANGE).
- `services/payments.ts` + `services/receipts.ts` (new) — posting writes everything that does not carry the receipt number first; the LAST
  statement (`insertWithNumber`: one CTE) increments the receipt sequence, formats the number in SQL exactly like `formatNumber` and
  inserts the payment, its ledger row, its audit row and its notifications; COMMIT follows. Replay lookup reads the current epoch.
- `services/search.ts` (new) + `routes/payments.ts` — two-step search for GET /payments and GET /demands (below).
- `services/views.ts` — cancellation refund/deduction from the bigint columns (jsonb = history).
- `services/ledgerRebuild.ts` — LEDGER_REBUILD restates (reason LEDGER_REBUILD), per-booking error isolation (`failed` list).
- `routes/bookings.ts` — GET /bookings/:id/ledger (`?epoch=`, `epoch`, `current_epoch`, C7 totals, `epoch_totals`; epoch > current → 404),
  new GET /bookings/:id/ledger/rebuilds. `routes/dues.ts` — run response/audit carry `bookings_failed` / `failures`.
- `jobs.ts` — DAILY_DUES no longer runs the integrity report (NIGHTLY_INTEGRITY at 00:45 is the only one); DAILY_DUES and DUES_CATCHUP
  report `bookings_failed` (per company and total) and `failures`, and send ONE `JOB_FAILED` bell per company and run to Super Admins.
- `metrics.ts` (new) — `kkt_dues_booking_failures_total{code}` on the shared registry. `common.ts` — the clock observes the newest
  epoch's last row. `index.ts` — exports the new helpers.

**apps/api — construction** — `src/modules/construction/service.ts`: undo locks ACTIVE + COMPLETED bookings only (CANCELLED left alone),
possession-charge restatement with reason CONSTRUCTION_CHARGE, doc comment.

**Tests** — `test/integration/money-ledger-record.test.ts` (new, 17 tests); updated for contract C7: `money.test.ts` (void leaves
DEMAND + DEMAND_VOIDED; plan change ledger), `money-review.test.ts` (undo appends instead of rewriting), `construction.test.ts`
(possession undo: epoch 2, old epoch closed, rebuild list), `money-hardening.test.ts` / `cross-track-money.test.ts` (legacy-ledger
manufacture now goes below the guard with `session_replication_role = replica`; repair/LEDGER_REBUILD restate as epoch 2),
`test/acceptance/09-stage-jump-undo-integrity.test.ts` (one assertion: the voided slab demand shows DEMAND + DEMAND_VOIDED).

**Docs** — `docs/DATA-MODEL.md` (bookings cancellation columns, payments guard + receipt numbering, ledger_entries book of record,
ledger_rebuilds summary shape, invariant 12, payment/demand search).

## The fixes, decisions and reasons

1. **DAILY_DUES** — per booking: `moneyTransaction` → `lockBooking` (row lock first, then advisory) → read booking + tower stages → raise.
   Stages are read after the lock too (a stage undo committed while the run waited is seen); one indexed query per booking. Failures are
   isolated; the run **completes** (no throw), so BullMQ does not re-run every booking three times; the alert signal is the counter
   (`increase(kkt_dues_booking_failures_total[1d]) > 0`), the job result (`bookings_failed`) and the Super Admin bell. Admin
   `POST /dues/run` answers 200 with `failures` instead of failing the whole request on the first bad booking.
2. **Integrity once a night** — the duplicate was DAILY_DUES calling `nightlyIntegrity` while jobs/index.ts schedules NIGHTLY_INTEGRITY;
   the money-module call is removed (jobs/index.ts untouched). Repair re-check: see above; the intersection rule (confirmed AND still
   unjustified) means a repair never voids something the admin did not see.
3. **Book of record (C7)** — design: the live path is the canonical path. Every event the canonical derivation produces is appended live
   (including DEMAND_VOIDED and the PLAN_CHANGE marker), so agreement revision, plan change and stage undo restate nothing — rebuild is a
   check. A restatement happens only when the canonical rows differ (legacy order, manufactured anomalies, admin recompute, a charge
   un-demanded by a possession undo — reason CONSTRUCTION_CHARGE, which has no compensating event). DEMAND_VOIDED takes back what the
   ledger raised for the demand (telescoping amounts under the agreement in force at the void), computed identically live and in the
   rebuild — a demand inserted behind the API with inconsistent stored amounts is restated coherently (test). The superseded epoch is
   closed by a LEDGER_RESTATED row so `?epoch=n` is self-describing; the current epoch never contains restatement markers (so the
   worked example stays 10 rows). TRUNCATE guard via the bookings lock instead of a session flag: reseed (seed/run.ts, not mine) keeps
   working unchanged, and a TRUNCATE of the books alone is refused.
4. **Stage undo and closed bookings** — SPEC §10 runs the engine for "every Active booking", SPEC §12 closes a cancelled ledger and allows
   handover only "when the possession stage is complete". So: CANCELLED bookings are **skipped** (their demands are already CANCELLED with
   the ledger; paid or unpaid, they no longer block an undo nor get rewritten); COMPLETED bookings are **never rewritten**: an undo that
   would void one of their demands — or undo the possession stage a handover rests on — answers **409 BOOKING_CLOSED** with
   `details.bookings = [{booking_id, booking_number, status, demand_numbers}]` (reopen the booking first). Possession charges keep their
   existing rule (a paid one blocks).
5. **Receipt sequence lock** — held for one statement + COMMIT (was: insert, ledger append, summary, demand statuses, audit, notification).
   Numbers stay gapless (the increment rolls back with any failure; a same-key race or a cap failure consumes nothing — tested).
6. **Search** — step 1: bookings by number or by the number of their flat, customers by name, each through its trigram index, company
   scoped, bounded to 1,000 ids per kind; step 2: `booking_id = ANY(ids) OR customer_id = ANY(ids) OR own trigram columns ILIKE`.
   Above the bound a kind falls back to a semi-join (same rows). Tested against the old joined OR for every searched column, the fallback
   against the fast path, and EXPLAIN (seqscan off) shows a BitmapOr over `payments_receipt_number_trgm_idx`,
   `payments_instrument_number_trgm_idx`, `payments_booking_status_idx`, `payments_customer_id_idx` and no Seq Scan on payments.
7. **Cancellation money** — read from `cancellation_refund_paise` / `cancellation_deduction_paise` (writes already went there); a drifted
   jsonb copy no longer changes the detail or the ledger (test).
8. **Versions** — nothing left: the foundation's list (demands, other charges, rate-card rows, plan installments) is covered by
   `line_version` and parent versions; no route writes a demand row individually.

## Tests and results

| Suite                                                                                                                                                                                                                                                               | Database / Redis      | Result                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/domain                                                                                                                                                                                                                                                     | —                     | **134/134** (+4)                                                                                                                                                                                                                                                  |
| packages/contracts                                                                                                                                                                                                                                                  | —                     | **203/203** (+7)                                                                                                                                                                                                                                                  |
| packages/db                                                                                                                                                                                                                                                         | kkt_p7_m_acc          | **94/94**                                                                                                                                                                                                                                                         |
| api integration — money, construction, money-hardening, money-review, cross-track-money, money-ledger-record                                                                                                                                                        | kkt_p7_m, Redis 4     | **99/99**                                                                                                                                                                                                                                                         |
| api integration — reports, reports-adversarial, seed (reseed), db-roles, partitions, admin (erasure, recompute), admin-adversarial, portal, portal-adversarial, numbering, idempotency, foundation, backup-restore, cross-track, search, notifications, conventions | kkt_p7_m, Redis 4     | **172/173** — the one failure is portal.test.ts "profile … audit row" (audit PII masking, security track's in-progress change)                                                                                                                                    |
| api integration — full suite (51 files, final code)                                                                                                                                                                                                                 | kkt_p7_m, Redis 4     | **660/662** — both failures are crm-adversarial.test.ts (the deprecated `/customers/:id/erase` alias: security track's in-progress route deprecation)                                                                                                             |
| api acceptance (13 files, final code)                                                                                                                                                                                                                               | kkt_p7_m_acc, Redis 5 | **55/55** (09 needed one assertion updated for C7: the voided slab demand now shows DEMAND + DEMAND_VOIDED)                                                                                                                                                       |
| api unit                                                                                                                                                                                                                                                            | kkt_p7_m_acc, Redis 5 | 125/137 — the 12 failures are config/deploy-config/key-rotation (security track's C9 work in progress) and openapi-compat (breaking entries are auth `refresh_token` optional and the erase response, both security track; my additions are reported as additive) |
| typecheck — domain, contracts, db, erp; api (only other tracks' in-progress errors in admin/erase.ts and audit/seal.ts)                                                                                                                                             | —                     | green for my files                                                                                                                                                                                                                                                |
| eslint `--max-warnings 0` + prettier --check on every file I touched                                                                                                                                                                                                | —                     | clean                                                                                                                                                                                                                                                             |

New integration tests (money-ledger-record.test.ts): a poison booking (3-decimal percent in its plan snapshot) does not stop the others
and is reported with INVALID_AMOUNT; the nightly job result + one bell per Super Admin; a concurrent agreement revision (row held by an
open transaction) is respected — the demand is cut on the revised amounts; exactly one integrity schedule and DAILY_DUES writes no
integrity run; repair keeps a demand whose stage was completed again between the report and the lock; repair of a raw-inserted demand
restates coherently; agreement revision + stage undo append without restating; restatement (epoch 2, LEDGER_RESTATED, ledger_rebuilds with
actor and diff, `?epoch=1`, `?epoch=3` → 404, identical rebuild writes nothing, later payments append to epoch 2); database refusals
(UPDATE amount/bucket/date/instrument of a cleared payment, CLEARED → PENDING, BOUNCED → CLEARED, UPDATE/DELETE/TRUNCATE of
ledger_entries and ledger_rebuilds) while remarks, clear, bounce, reversal and a full reset still work; CANCELLED bookings (paid and
unpaid) untouched by an undo; a COMPLETED booking whose possession demand was funded by earlier advances → 409 BOOKING_CLOSED and
nothing changes; SQL number formatting = formatNumber for five pattern shapes; gapless contiguous receipts under concurrency with a
same-key race; ledger/audit/notification rows carry the allocated number; search equality + fallback + EXPLAIN; cancellation columns.

### Payment throughput (item 5)

`apps/api/loadtest/run.ts` payment scenario (one booking, 50 connections, 20 s, my database, demo seed): **before 90 req/s, p50 604 ms,
p95 769 ms, p99 782 ms → after 89 req/s, p50 587 ms, p95 786 ms, p99 862 ms** — unchanged, as expected: every payment of ONE booking is
serialised by the booking lock, not the receipt sequence.

The receipt lock matters when payments hit different bookings, so I also measured POST /payments spread round-robin over the 8 ACTIVE
seed bookings (50 connections, 15 s), alternating the HEAD money module ("before", a scratch copy of apps/api with only the money and
construction files reverted) and the new one, each from the same seeded database template, while sampling `pg_stat_activity` every
100 ms. The box was shared with other agents' test runs (load average 3.9–5.5 on 4 vCPU), so absolute numbers are noisy; the A/B pairs
are comparable:

| run    | req/s | p50 ms | p97.5 ms | p99 ms | backends waiting on the receipt sequence (avg) | backends waiting on any lock (avg) |
| ------ | ----- | ------ | -------- | ------ | ---------------------------------------------- | ---------------------------------- |
| before | 70    | 612    | 1,639    | 1,745  | 5.35                                           | 17.6                               |
| after  | 100   | 431    | 962      | 1,154  | 1.91                                           | 12.3                               |
| before | 78    | 530    | 1,475    | 1,857  | 4.92                                           | 17.4                               |
| after  | 96    | 469    | 921      | 1,136  | 1.84                                           | 11.9                               |

≈ +30 % throughput, −40 % p97.5 and −63 % backends queued on the receipt sequence. (Earlier unpaired runs on a quieter box: 120 → 152
req/s, p97.5 793 → 522–562 ms.) Script: scratchpad `paymentload.mjs` (autocannon, round-robin bookings, fresh Idempotency-Key).

## Contract shapes for other tracks and the frontends

- **GET /api/v1/bookings/:id/ledger** `?epoch=n` (optional, ≥ 1; > current → 404) — list envelope of `LedgerRow` (unchanged row shape;
  `event` may now be `DEMAND_VOIDED` (negative amount, ref = the demand) or, in an older epoch only, `LEDGER_RESTATED` (amount 0, note =
  reason)) plus `epoch`, `current_epoch`, `summary` = BookingSummary + `{cash_due_paise, account_due_paise, total_due_paise,
other_charges_due_paise, cash_paid_paise, account_paid_paise}` (current book) and `epoch_totals` (same six, end of the epoch returned).
  **Clients must display dues from `summary` (or `epoch_totals` for history), never from the last row of a page.**
- **GET /api/v1/bookings/:id/ledger/rebuilds** — list envelope (newest first; `sort` at | to_epoch) of
  `{id, booking_id, from_epoch, to_epoch, reason, actor: {id, name} | null, at, summary: {rows_before, rows_after, differences:
[{position, field, stored, recomputed}], before: totals, after: totals}}`; reasons AGREEMENT_REVISION, PLAN_CHANGE, STAGE_UNDO,
  CONSTRUCTION_CHARGE, INTEGRITY_REPAIR, ADMIN_RECOMPUTE, LEDGER_REBUILD.
- **POST /api/v1/dues/run** — adds `bookings_failed`, `failures: [{booking_id, booking_number, code, message}]` (200 even when some
  bookings failed). **POST /api/v1/dues/integrity/repair** — adds `kept_now_satisfied: string[]` (demand numbers).
- **POST /api/v1/blocks/:id/construction/undo** — new 409 `BOOKING_CLOSED`, `details.bookings: [{booking_id, booking_number, status,
demand_numbers}]`.
- **Jobs** — DAILY_DUES / DUES_CATCHUP result: `{as_of, bookings_failed, <company_id>: {bookings_checked, demands_raised, demand_numbers,
bookings_failed, failures: [{booking_id, booking_number, code}]}}` (no `integrity_*` keys any more). LEDGER_REBUILD result + `failed`.
- **Metric** — `kkt_dues_booking_failures_total{code}` (counter, shared registry).
- **Database** — UPDATE/DELETE/TRUNCATE of ledger_entries / ledger_rebuilds and edits of a payment's financial columns raise SQLSTATE
  23001; ledger readers must filter `epoch = bookings.ledger_epoch` (`epochRows()` / `ledgerRows()` from the money module).

## Needs from other tracks

1. **Portal (apps/api/src/modules/portal/bookings.ts:485, `portalLedger`)** — must read the current epoch only, otherwise a restated
   booking shows both epochs interleaved by seq. Exact change: `where: and(eq(ledgerEntries.bookingId, owned.booking.id),
eq(ledgerEntries.epoch, owned.booking.ledgerEpoch))` (or `epochRows(owned.booking.id)` from `../money/index.js`); the portal ledger
   response could also carry the C7 totals.
2. **Reports (apps/api/src/modules/reports/services/moneyReports.ts:824-825, cancellations report)** — read
   `r.b.cancellationDeductionPaise ?? c.deduction_paise` and `r.b.cancellationRefundPaise ?? c.refund_paise` (money columns first).
3. **Admin tools (apps/api/src/modules/admin/tools.ts:162, recompute)** — pass the actor: `rebuild(tx, b.id, { write: true, reason:
"ADMIN_RECOMPUTE", actor })` so ledger_rebuilds records who restated (today it is recorded as the system). Note: recompute now restates
   only ledgers that differ; identical ones write nothing.
4. **Observability (docs/OBSERVABILITY.md + infra/prometheus rules)** — add `kkt_dues_booking_failures_total{code}` to the catalogue and an
   alert `increase(kkt_dues_booking_failures_total[1d]) > 0` (warning: "DAILY_DUES skipped N bookings").
5. **ERP / portal frontends** — use `summary` / `epoch_totals` (C7) instead of the last ledger row; render `DEMAND_VOIDED` (negative,
   "voided") and offer the epoch history (`?epoch=`, `/ledger/rebuilds`); handle 409 `BOOKING_CLOSED` on stage undo (list
   `details.bookings`).
6. **Security track (DPDP erasure)** — a payment's `instrument` and `received_by` are frozen by `payments_financial_guard`; `remarks` stays
   writable. If erasure must scrub instrument text, it needs an agreed exception in 0006 (not added).
7. **Partitions (packages/db/partitions)** — `kkt_partition_table` carries the row triggers to the partitioned parent and copies the
   statement triggers, so the new guards survive partitioning; a TRUNCATE aimed at one partition of ledger_entries is refused by the copied
   statement trigger like on the parent (partitions.test.ts passes).

## Not done / follow-ups

- docs/openapi/v1.json was not regenerated (task rule); the new route and fields are additive (`openapi-compat` lists them as additive).
- NIGHTLY_INTEGRITY still aborts on a booking whose data makes the engine throw (e.g. the poison plan snapshot used in the dues test); it
  now fails loudly as its own job (alert) instead of silently inside DAILY_DUES. Per-booking isolation there needs a finding type for
  "check failed" in the contracts enum (shared file) — not added.
- Possession other charges still block an undo on any paid amount (unchanged; the audit's dated-funding remark for charges is not in my
  task list).
- The official loadtest payment scenario still targets one booking; a round-robin variant (like the scratch script) would make the receipt
  path visible in docs/PERFORMANCE.md (loadtest/run.ts is not mine).
