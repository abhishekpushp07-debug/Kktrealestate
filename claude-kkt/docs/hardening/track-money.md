# Money & business-rules track (H2): report

All 12 items are done. Every test run passes, including the full integration suite (34 files, 491 tests), the full acceptance suite (13 files, 55 tests) and the new `money-hardening.test.ts` (18 tests). Typecheck passes for api, contracts, domain, erp, portal and web. Lint on my paths shows 0 errors and 2 warnings (portal → documents/service imports with no index export). Nothing is committed.

## Changes (all under /home/user/Kktrealestate/claude-kkt)

**packages/domain**

- `src/ledger.ts`: the canonical ledger order is now posting order. `sortLedgerEvents` sorts by posting instant, then event kind, then source id. A bare date counts as midnight IST. The business date is for display only. Adds `diffLedgerRows` / `LEDGER_ROW_COMPARED_FIELDS` for row-by-row comparison.
- `src/holds.ts` (new): `isHoldExpired`, `effectiveFlatStatus`, `reserveUntil`.
- `src/index.ts`.

**packages/contracts** (targeted edits)

- `errors.ts`: added `BOOKING_COMPLETED` (409).
- `enums.ts`:
  - integrity finding type `PLAN_STAGE_MISSING`, with its label;
  - `JOB_NAMES` adds `HOLD_EXPIRY` and `DUES_CATCHUP`, with labels;
  - `NOTIFICATION_TYPES` adds `HOLD_EXPIRED`, with a label.
- `modules/bookings.ts`:
  - `price_deviation_reason` on create;
  - `BookingFullRowSchema`, a compact `BookingRowSchema`, `BookingRowSummarySchema`, and lite flat/plan snapshot schemas;
  - a `view` filter on the list;
  - list price and deviation fields on the detail.
- `modules/flats.ts`: `FlatReserveSchema`, `FlatReleaseSchema`.
- `modules/dues.ts`: `IntegrityCounts.PLAN_STAGE_MISSING` (defaults to 0).
- `test/adversarial.test.ts`: points at `BookingFullRowSchema`.

**apps/api/src/modules/money**

- `common.ts`:
  - `Clock.observe` and `lockBooking(tx, id, clock?)`, so a booking's event instants always increase in posting order;
  - `lockBookingsInOrder`, `lockFlatAndBlockOf`;
  - `moneyTransaction`, which wraps `withTransactionRetry` (4 retries).
- `services/bookings.ts`:
  - agreement value guard `priceDeviation`;
  - booking creation takes locks as flat → block → parking, and allocates numbers last;
  - handover now requires every installment raised and no shortfall in either bucket;
  - `reopenCompletedBooking`.
- `services/payments.ts`: the idempotency key on the payments row is the fallback when the replay record is lost; reversal locks payment → flat → block → booking and handles COMPLETED bookings.
- `services/dues.ts`: a stage completion locks all of the tower's bookings first; other-charge bells are keyed by `booking_other_charge`.
- `services/ledger.ts`: rebuild also returns `rowMismatches`.
- `services/integrity.ts`: the new `PLAN_STAGE_MISSING` finding (not auto-repairable); finding (e) now includes row differences; repair counters are safe under retry.
- `services/plans.ts`: `assertAssignmentsFitBlock`, `assertPlanFitsActiveAssignments`.
- `services/views.ts`: compact rows plus `loadCompactRelated`.
- `services/roznamcha.ts`: wrapped in the retry transaction.
- `jobs.ts`: `DUES_CATCHUP`; the overdue-notice claim is now made after the commit, with a database guard.
- `routes/bookings.ts`: compact rows by default (CSV and `view=full` give full rows); draft upsert; `routes/payments.ts`; `routes/dues.ts`; `index.ts` exports.

**Other modules**

- `construction/service.ts`, `construction/routes.ts`: undo locks every affected booking in id order, withdraws other-charge bells, and status/undo/patch use the retry transaction.
- `inventory/holds.ts` (new): job, reserve and release. `inventory/flats.ts`: reserve/release routes, and a lapsed hold no longer needs `settings.manage` to change. `inventory/blocks.ts`: plan fit checked on block create and stage-sequence change; the grid shows a lapsed hold as AVAILABLE. `inventory/index.ts`: `registerInventoryJobs`. `inventory/rateCards.ts`: lint fix.
- `masters/kinds.ts`: plan edits are checked against the plan's active assignments.
- `portal/bookings.ts`, `portal/common.ts`: lint fixes.

**Tests and docs**

- Tests: new `test/integration/money-hardening.test.ts` and `packages/domain/test/hardening.test.ts`. The money and construction fixtures now price flats at ₹1 Cr. The acceptance harness gets a `listAtCr` helper, used in scenarios 03 and 05–09.
- Docs: `API-CONVENTIONS.md` (idempotency, lock order), `DATA-MODEL.md` (ledger order, deviation columns), `ARCHITECTURE.md` (list payload), `TODO-integration.md` (items #6 and #7 marked done).

## Tests and results

- **Domain:** 130/130 pass (6 new). One reproduces the case of a payment dated before an earlier-posted demand: the rebuild gives the same rows as the live append.
- **Contracts:** 183/183. **API unit:** 48/48.
- **`money-hardening.test.ts`:** 18/18. It covers all 12 items, including:
  - **Concurrency:** 3 rounds of stage completion, 2 dues runs, 3 payments and a booking creation in parallel; no 5xx, and the integrity report stays clean.
  - **Lost replay record:** the idempotency row and Redis key are deleted, and a retry returns the same receipt.
  - **Overdue notices:** a simulated database outage (a trigger) leaves no Redis claim.
- **Payload:** 25 rows are 24,199 bytes in the compact view (4,130 gzipped), against 129,951 bytes in the full view. That is under the 25 KB target, but with little margin: longer real-world names could push it over.
- **Full suites:** integration 491/491 (34 files, kkt_h2, Redis 17); acceptance 55/55 (kkt_h2_acc, Redis 17).

## Decisions and deviations

- **Notification type outside my brief:** I added `HOLD_EXPIRED` to `NOTIFICATION_TYPES`; my brief only covered the integrity and job enums. The staff bell response checks types against that enum, so a holder notification with an unknown type could break `GET /notifications`.
- **Agreement value guard:**
  - It compares with the flat's current `price_paise`.
  - It runs before plan resolution, so a deviating booking on a plan that does not apply gets 422, not 409.
  - The test fixtures and acceptance flats are priced at ₹1 Cr through the price API, so existing expectations hold.
- **`GET /bookings` defaults to compact rows.**
  - The compact row omits `flat_snapshot`, the plan installments, `next_installment`, the audit fields, `block_id`, `payment_plan_id`, the duplicate agreed fields and the nullable extras.
  - `view=full`, CSV exports and the detail still carry every field.
  - The ERP typechecks against the new types.
- **Lapsed holds:** any user with `booking.create` may release one. Reserving never shortens a longer hold the same user already has.
- **Existing ledgers:** ledgers rebuilt by the old date order will be flagged `SUMMARY_MISMATCH` once. The repair rebuilds them in posting order.
- **Undo response:** `withdrawn_notifications` now also counts other-charge bells.

## Not done (outside my paths)

- The public availability grid (`web/publicContent.ts`) still shows a lapsed hold as not available. It should map each flat through `effectiveFlatStatus(flat)` from `@kkt/domain` before `toPublicAvailability`.
- The portal notification screen map (`notifications/index.ts` `SCREEN_BY_ENTITY`) should send `booking_other_charge` to `"DEMANDS"`. Today it falls back to HOME, and `booking_id` comes back null for these bells.

## For other tracks and the integration stage

**Platform / worker:**

- The standalone worker must call `registerMoneyJobs(null)` (from `modules/money/index.ts`) and `registerInventoryJobs()` (from `modules/inventory/index.ts`).
- At worker boot, enqueue `DUES_CATCHUP` (or `DAILY_DUES`) and `STARTUP_RECONCILIATION`.
- Schedule `HOLD_EXPIRY` every 5 minutes (`*/5 * * * *`, Asia/Kolkata).

**Frontend (ERP):**

- **`POST /api/v1/bookings`:**
  - New optional `price_deviation_reason` (3–500 characters).
  - Without `agreement.edit` and a reason, a deviation is 422 `BUSINESS_RULE` with details `{rule:"PRICE_DEVIATION_NOT_ALLOWED", field, list_price_paise, agreement_value_paise, deviation_paise, needs:["agreement.edit permission"|"price_deviation_reason"]}`.
  - StepAgreement should show a reason input whenever the total differs from the list price.
  - The detail now has `list_price_paise`, `price_deviation_reason` and `price_deviation_by`.
- **`POST /api/v1/flats/:id/reserve`** `{minutes?: 1–30, default 15}` (permission `booking.create`) returns a `FlatRow`.
  - Repeating the call extends the caller's own hold.
  - If someone else holds the flat, it returns 409 `FLAT_NOT_AVAILABLE` with details `{flat_id, current_status, booking_number:null, hold_by_user_id, hold_until}`.
  - Call it when a flat is picked and refresh it periodically.
- **`POST /api/v1/flats/:id/release`** `{reason?}` returns a `FlatRow`. Not the holder: 403. Not on hold: 422 rule `NOT_ON_HOLD`. Call it when a draft is discarded.
- **`PUT /api/v1/booking-drafts`:** the client must generate `id` (uuid) when the wizard starts and send it on every save. The server upserts on (id, user); an id owned by another user is 404.
- **`GET /api/v1/bookings`:**
  - Compact rows by default, `view=full` for every field.
  - The compact row has: `id, version, booking_number, status, booking_date, project_id, project_name, block_name, flat_id, flat_number, customer_id, customer_code, customer_name, customer_phone, co_applicants, agreement_value_paise, plan_snapshot{name}`.
  - Its `summary` has `cash`, `account`, `total_paid_paise`, `total_due_paise`, `pending_cheques_paise`, `other_charges_due_paise` and `raised_percent`.
- **Payment reversal on a COMPLETED booking:** 409 `BOOKING_COMPLETED` for users without `settings.manage`. For an admin, the booking reopens to ACTIVE.
- **New error details:**
  - `HANDOVER_BLOCKED` adds `unraised_installments[{seq,name}]`, `cash_short_paise` and `account_short_paise`.
  - `PLAN_STAGES_MISSING` items, from the block create / stage-sequence / PATCH checks and plan edits, add `plan_id`, `plan_name` and `assignment_id`.
- **Integrity:** new finding type `PLAN_STAGE_MISSING`, always `repairable:false`.
- **Bells:** the new staff type `HOLD_EXPIRED` has entity `flat`. Other-charge `DEMAND_RAISED` bells now have entity `booking_other_charge` (the line id) with link `/bookings/:id`.
