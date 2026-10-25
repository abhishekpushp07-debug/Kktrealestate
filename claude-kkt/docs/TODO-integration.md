# Cross-cutting items raised by module reviews (resolve during the finishing pass)

1. `apps/api/src/lib/list.ts` keyset cursor: timestamp sort values are serialised with millisecond precision while Postgres stores microseconds → rows written in the same millisecond can be skipped between pages. Fix centrally (microsecond-exact text key, as `modules/documents` does locally) and remove the local workaround.
   → **done** (finishing pass): `paginate()` now pages timestamp sorts on a microsecond-exact text key (`to_char(... 'YYYY-MM-DD HH24:MI:SS.US')`) selected alongside the row and compares against the column with a typed parameter (index-friendly); the documents module's local `CREATED_AT_SORT` workaround was removed. Test: `test/integration/central.test.ts`.
2. `apps/api/src/plugins/idempotency.ts` hashes `req.body` only, which is empty for multipart routes; add a route-provided fingerprint hook (documents implements its own preValidation workaround; portal attachments should reuse it).
   → **done**: `plugins/idempotency.ts` exports `setIdempotencyFingerprint(req, value)`; `lib/multipart.ts` (`installMultipartIdempotency`, `uploadOf`) parses the upload in preValidation and registers a digest of fields + file bytes. Used by `POST /documents` and `POST /portal/requests/:id/attachments` (now `idempotent: true`).
3. `documents` table has no `version` column → PATCH /documents/:id cannot honour If-Match. Add `version` via a new drizzle migration (packages/db) and wire `applyUpdate`.
   → **done**: migration `packages/db/drizzle/0001_central_fixes.sql` adds `documents.version`; `PATCH /documents/:id` goes through `applyUpdate` and honours `If-Match` / `body.version` (409 VERSION_CONFLICT when stale); `DocumentRow` carries `version`.
4. Indexes suggested by reviews (new migration): `site_visits(lead_id, status)`; GIN on `flat_types.rooms`, `flat_types.areas`, `floor_plan_templates.positions`, `blocks.floor_plans` (usage checks); `payment_plan_assignments(plan_id)`; `bookings(payment_plan_id)`; `audit_logs(company_id, created_at)`.
   → **done**: same migration creates `site_visits(lead_id, status)`, GIN on `flat_types.rooms/areas`, `floor_plan_templates.positions`, `blocks.floor_plans`, `payment_plan_assignments(plan_id)`, `bookings(payment_plan_id)`, `audit_logs(company_id, created_at desc)`.
5. `paginate()` always runs an exact `count(*)`; use `pg_class` estimates above 10k rows unless `exact=true` (ARCHITECTURE §6).
   → **done**: `paginate()` reads `pg_class.reltuples`; above `COUNT_ESTIMATE_ABOVE` (10 000) the `total` is the planner's estimate of the filtered query (`EXPLAIN (FORMAT JSON)`) unless the caller passes `exact=true` (new `ListQuery.exact`, always exact for CSV exports).
6. `money`: other-charge demand notifications are keyed by entity `booking`; key them by `booking_other_charge` so construction undo can withdraw them selectively.
   → **deferred** (money module owner): keying other-charge demand notifications by `booking_other_charge` touches the construction undo path (withdraw by entity) and the portal bell; not a central fix, left for the module pass.
7. `money`: reversal on a COMPLETED booking is allowed and leaves the booking COMPLETED with due > 0 — decide (owner) whether to block or to reopen to ACTIVE.
   → **deferred** (owner decision pending): reversal on a COMPLETED booking is still allowed; the seed never reverses on a completed booking.
8. `lib/version.ts` `withOptionalVersion()` rebuilds a strictObject from `.shape` and drops `.refine()` checks; make it wrap instead of rebuild so refinements survive.
   → **done**: `withOptionalVersion()` uses Zod's `safeExtend` (refinements survive) with a `preprocess` fallback; covered by `central.test.ts`.
9. `PATCH /projects/:id/website` is registered with `project.read` and checks `project.write | cms.write` inside the handler; expose an OR-permission in `route()` so the registry is truthful.
   → **done**: `route()` accepts `permission: Permission | Permission[]` (any-of), registered as `"a|b"` in the registry; the auth plugin checks the alternatives (403 carries `details.alternatives`). `PATCH /projects/:id/website` and `/visit-settings` are registered as `project.write|cms.write`.
10. `GET /reports/activity` requires `audit.view`; the ERP must gate its link accordingly.
   → **deferred** (ERP app): gate the Activity report link on `audit.view`.
11. `service_requests.category_id` nullable in DB but required in the response schema → seed must always set it (or make the column NOT NULL).
   → **done**: `service_requests.category_id` is `NOT NULL` (migration 0001); the service module always resolves a category.
12. Reseed must keep the demo credentials and numbering exactly as docs/SEED.md.
   → **done**: `apps/api/src/seed/run.ts` `reseed(db, { app })` truncates every business table (incl. sequences and idempotency keys), keeps companies/roles/users/audit_logs, re-bootstraps the staff logins when missing, writes an `admin.reseed` audit row and runs `seedDemo` (numbering restarts at …/0001).
