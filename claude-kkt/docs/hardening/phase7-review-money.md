# Phase 7 — adversarial review of the money track

Scope: the MONEY & CONSTRUCTION track of phase 7 (`docs/hardening/phase7-money.md`) and the v3 audit findings it was assigned
(DAILY_DUES isolation and stale read, integrity twice / repair re-check, ledger as a book of record (C7), stage undo and closed bookings,
receipt sequence lock, payment/demand search, money in jsonb). Reviewed against `git diff 34c075e`, SPEC §9–§12 and contract C7.
Databases: `kkt_p7_rmoney` (integration, Redis 16) and `kkt_p7_rmoney_acc` (acceptance / packages/db / unit, Redis 17).

## Verdict per finding

| Finding                                                       | Verdict                      | Notes                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A/E DAILY_DUES: no per-booking isolation, stale pre-lock read | **closed** (after R1/R2)     | Lock-then-read is correct (row FOR UPDATE + advisory, then booking + tower stages re-read; the concurrent-revision test holds). The isolation as delivered over-corrected: every failure, a database outage included, became "a booking failed", the job completed and BullMQ never retried. Fixed below.                                                                                         |
| E integrity runs twice; repair voids without a re-check       | **closed**                   | DAILY_DUES no longer calls `nightlyIntegrity`; repair re-reads booking, stages and demands under the lock and voids only "confirmed AND still unjustified". Residual (not this track's list): NIGHTLY_INTEGRITY still aborts on a booking whose data makes the engine throw.                                                                                                                      |
| B ledger is not a book of record                              | **closed for the staff API** | Append-only triggers bind the owner; rebuild writes a new epoch + `ledger_rebuilds`; DEMAND_VOIDED compensates voids, computed identically live and in the rebuild. Open: the **portal** ledger reader ignores epochs (cross-track item 1). Design residual: a possession undo that un-demands an other-charge line still restates (CONSTRUCTION_CHARGE) instead of appending a compensating row. |
| E stage undo touches closed bookings                          | **closed**                   | CANCELLED skipped, COMPLETED → 409 BOOKING_CLOSED. The "cancelled while the undo waited" window cannot occur: cancellation and undo both lock the block row first.                                                                                                                                                                                                                                |
| C receipt sequence held for the whole posting                 | **closed** (R5 hardening)    | Number allocated by the posting's last statement; gapless under concurrency and same-key races. The audit row written inside that statement bypassed `writeAudit`'s redaction policy; fixed (R5).                                                                                                                                                                                                 |
| B payment/demand search ORs across joins                      | **closed**                   | Two-step search is company-scoped in step 1 and project-scoped by the list's own filters in step 2; no cross-project leak (ids only filter rows the caller may already see). LIKE input escaped; ids are bound as one uuid[] parameter.                                                                                                                                                           |
| B money in jsonb (cancellation)                               | **partly open**              | Detail and ledger read the bigint columns. The cancellations **report** still reads the jsonb (cross-track item 2). flat_snapshot price / price_breakup stay jsonb by design (they are snapshots, not money of record).                                                                                                                                                                           |

## Defects found and fixed

**R1 — a database outage during a dues run was swallowed (regression).** `raiseDuesForAll` caught every error per booking. During a
failover at 00:30 every remaining booking was recorded as "failed", the run returned normally, the job was OK, BullMQ never retried, and
no installment demand was raised until the next night (DUES_CATCHUP only runs at boot). Before phase 7 the job would at least have been
retried. Fix (`services/dues.ts`): `classifyFailure(err)` → `{code, message, retryable, outage}`; an outage (connection refused or
dropped, server shutting down, too many connections — `mapDatabaseError` SERVICE_UNAVAILABLE other than statement timeout) is counted
and **rethrown**: the run stops, the job attempt fails and BullMQ retries it (raising is idempotent); `POST /dues/run` answers
503 SERVICE_UNAVAILABLE.

**R2 — transient per-booking failures were never retried.** A lock timeout (55P03), statement timeout (57014) or a serialization failure
that outlived `withTransactionRetry` left that booking without its demand for a day. Fix: such failures stay isolated (the run goes on)
and are counted in `RunSummary.retryableFailures`; `duesRun` (DAILY_DUES, DUES_CATCHUP) throws `DuesRetryableError` **after** the whole
run so BullMQ retries the attempt. The Super Admin bell goes out once: when the run finishes, or on the job's last attempt (handlers now
receive `finalAttempt = attempt >= maxAttempts`), never once per retried attempt. Codes are now the retryable envelope codes
(LOCK_TIMEOUT, CONFLICT_RETRY, SERVICE_UNAVAILABLE) instead of `SQLSTATE_55P03` etc.

**R3 — raw database / internal error text in an API response.** `POST /dues/run` returned `failures[].message = err.message`, i.e. the
driver's text ("Failed query: update … params: …", constraint names, row values) to the client, unlike every other path where a 500
never shows internals. Fix: ApiError and domain money messages pass through; anything else is "Database error <SQLSTATE> (details in the
server log)" or "Internal error (details in the server log)"; the raw error is logged with the booking id.

**R4 — LEDGER_REBUILD failed silently.** `rebuildAllLedgers` caught every per-booking error without logging it, kept at most 500 in
`failed` with no total, and treated an outage as 200 000 booking failures. Fix (`services/ledgerRebuild.ts`): outage → rethrow (job
retried; only ledgers that still differ are restated, so the retry is safe); every other failure is logged and counted in the new
`failed_count`.

**R5 — the payment.post audit row skipped the audit redaction policy.** The single-statement posting built its audit row with
`stripSensitive` only, while `writeAudit` applies `redactForAudit` (strip + DPDP PII masking, security track). Today the payment
snapshot holds no PII key, so the stored row is unchanged, but the next field added to it would have bypassed masking. Fix: the row is
built with `redactForAudit` (test pins the stored `after` to `redactForAudit(snapshot)`).

## Tests added

- `apps/api/test/integration/money-review-phase7.test.ts` (6 tests; failures are injected with a per-booking trigger that raises a
  chosen SQLSTATE):
  - R1: 57P01 at the 2nd booking → `raiseDuesForAll` rethrows (first booking committed, third untouched, nothing recorded as a booking
    failure); `POST /dues/run` → 503 SERVICE_UNAVAILABLE; a clean re-run raises exactly the missing demands;
  - R2: 55P03 → isolated, `retryableFailures = 1`, code LOCK_TIMEOUT, others raised; DAILY_DUES attempt fails with `DuesRetryableError`
    and no bell (non-final), the final attempt bells and fails, a clean retry completes with `bookings_failed = 0` and no new bell;
  - R3: P0001 via `POST /dues/run` → 200, `SQLSTATE_P0001`, message without the raw text;
  - R4: LEDGER_REBUILD rethrows on 57P01; on P0001 lists + counts the booking and restates the others; clean run restates the last one;
  - R5: payment.post audit `after` = `redactForAudit(...)` with the allocated receipt number.
- `apps/api/test/unit/dues-failure.test.ts` (3 tests): `classifyFailure` for ApiError / MoneyError, outage vs retryable codes (57P01,
  08006, 53300, CONNECTION_ENDED, ECONNREFUSED, 57014, 55P03, 40001) and message sanitising.

## Results (final code)

| Suite                                | Database / Redis            | Result                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api integration, full (60 files)     | kkt_p7_rmoney, Redis 16     | **758/758** (first pass: 41 files green, 19 files aborted in `beforeAll` by another reviewer's in-flight migration edit, `function max(uuid) does not exist`; re-run of those 19 after their fix: 264/264) |
| api acceptance (13 files)            | kkt_p7_rmoney_acc, Redis 17 | **55/55**                                                                                                                                                                                                  |
| api unit (27 files)                  | kkt_p7_rmoney_acc, Redis 17 | **172/172**                                                                                                                                                                                                |
| packages/db                          | kkt_p7_rmoney_acc           | **100/100**                                                                                                                                                                                                |
| packages/domain / packages/contracts | —                           | **139/139** / **244/244**                                                                                                                                                                                  |
| `pnpm -r typecheck`                  | —                           | green (all 7 packages)                                                                                                                                                                                     |
| eslint `--max-warnings 0` + prettier | —                           | clean on every file I touched                                                                                                                                                                              |

## Checked and found sound (no change)

- Lock order: dues (booking → demand sequence), undo (block → bookings ascending → demands), payment (booking → receipt sequence last);
  the receipt CTE is the final statement and a failure anywhere rolls the increment back.
- Ledger ordering: every unit of work uses a `Clock` that observes the newest epoch's last instant after the lock, so live appends and
  the canonical sort agree (DEMAND_VOIDED priority only matters for identical instants, which the clock prevents).
- DEMAND_VOIDED amounts: live (`demandAmountsFor(d, current agreement)`) equals the rebuild (`agreedAt(voidedAt)`); agreement-revision
  adjustments skip demands voided before the revision both live and in the rebuild.
- Guards: `payments_financial_guard` status transitions match the only code paths (clear/bounce from PENDING, reverse from CLEARED); all
  payment FKs are NO ACTION, so no FK action can trip the guard; the TRUNCATE guard admits only a TRUNCATE that also takes `bookings`
  (reseed, test helpers); restore loads insert-only; partition copies keep the triggers.
- Ledger route: `?epoch` > current → 404, project scope enforced through `loadBookingSelect` on both new routes, C7 totals consistent
  with `summary.total_due_paise` (= cash due + account due).

## Not done / follow-ups

- NIGHTLY_INTEGRITY still aborts on a booking whose data makes the engine throw (needs a "check failed" finding type in the shared
  contracts enum; not in this review's file set).
- A possession undo un-demands other-charge lines by clearing `demanded_at`, so the ledger is restated (reason CONSTRUCTION_CHARGE)
  instead of receiving a compensating row. A compensating `OTHER_CHARGE_DEMAND_VOIDED` event needs an `undemanded_at` source column
  (migration) and a new ledger event (shared enum) — a design follow-up, consistent with C7 as it stands (restatements are allowed and
  listed).
- `DuesFailureSchema` has no `retryable` flag (contracts `dues.ts` is outside this review's file set); retryable failures are recognisable
  by their codes (LOCK_TIMEOUT, CONFLICT_RETRY, SERVICE_UNAVAILABLE).

## Cross-track items (exact changes requested)

1. **Portal ledger reads every epoch** (`apps/api/src/modules/portal/bookings.ts`, `portalLedger`, `where: eq(ledgerEntries.bookingId,
owned.booking.id)`): after any restatement (e.g. a possession undo with on-possession charges, an integrity repair, LEDGER_REBUILD) a
   customer sees both epochs interleaved by seq plus the LEDGER_RESTATED marker — wrong running dues on the customer's own ledger. Change
   to `where: and(eq(ledgerEntries.bookingId, owned.booking.id), eq(ledgerEntries.epoch, owned.booking.ledgerEpoch))` (or
   `epochRows(owned.booking.id)` from `../money/index.js`), and add a portal test that restates a booking and expects only current-epoch
   rows. Portal UI: render `DEMAND_VOIDED` rows (negative amount, "voided").
2. **Cancellations report reads the jsonb** (`apps/api/src/modules/reports/services/moneyReports.ts` ~824-825): use
   `r.b.cancellationDeductionPaise ?? c.deduction_paise` and `r.b.cancellationRefundPaise ?? c.refund_paise`.
3. **Admin recompute records no actor** (`apps/api/src/modules/admin/tools.ts` ~162): `rebuild(tx, b.id, { write: true, reason:
"ADMIN_RECOMPUTE", actor })` so `ledger_rebuilds.actor_id` names the admin.
4. **Observability** (`docs/OBSERVABILITY.md` row `kkt_dues_booking_failures_total`): the counter now also counts transient failures
   (codes LOCK_TIMEOUT / CONFLICT_RETRY / SERVICE_UNAVAILABLE) and the outage that stops a run; the DAILY_DUES job now FAILS (and is
   retried) when a booking hit a transient failure, so KktDailyJobStale / the job-failure alert also cover that case. Suggested wording:
   "Bookings a dues run could not process, by code; a transient code makes the attempt fail and retry".

## Contract shapes for other tracks and the frontends

- `POST /api/v1/dues/run` — unchanged shape; `failures[].code` is now LOCK_TIMEOUT / CONFLICT_RETRY / SERVICE_UNAVAILABLE for transient
  database conditions (was `SQLSTATE_<code>`); `failures[].message` is safe to display (never raw database text). A database outage
  answers **503 SERVICE_UNAVAILABLE** (Retry-After 5) instead of 200 with every booking failed.
- Jobs: DAILY_DUES / DUES_CATCHUP attempts **fail** with `DuesRetryableError` ("… hit a transient database condition; the run is
  retried") when any booking hit a transient failure; on success the result shape is unchanged. LEDGER_REBUILD result adds
  `failed_count` (number).
- Module exports (`apps/api/src/modules/money/index.ts`): `classifyFailure(err) → {code, message, retryable, outage}`, type
  `FailureClass`; `RunSummary.retryableFailures`; `dailyDues(db, {finalAttempt?})`, `duesCatchup(db, {finalAttempt?})`.

## Files changed in this review

- `apps/api/src/modules/money/services/dues.ts` — `classifyFailure`, `FailureClass`, `RunSummary.retryableFailures`, outage rethrow,
  sanitised messages.
- `apps/api/src/modules/money/jobs.ts` — `DuesRetryableError`, `DuesRunOptions.finalAttempt`, retry-on-transient, bell once.
- `apps/api/src/modules/money/services/ledgerRebuild.ts` — outage rethrow, logging, `failed_count`.
- `apps/api/src/modules/money/services/payments.ts` — audit row via `redactForAudit`.
- `apps/api/src/modules/money/index.ts` — exports.
- `apps/api/test/integration/money-review-phase7.test.ts`, `apps/api/test/unit/dues-failure.test.ts` (new).
- `docs/DATA-MODEL.md` — demands: dues-run failure semantics; ledger: LEDGER_REBUILD failure handling.
