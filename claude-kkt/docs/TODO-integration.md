# Cross-cutting items raised by module reviews (resolve during the finishing pass)

1. `apps/api/src/lib/list.ts` keyset cursor: timestamp sort values are serialised with millisecond precision while Postgres stores microseconds → rows written in the same millisecond can be skipped between pages. Fix centrally (microsecond-exact text key, as `modules/documents` does locally) and remove the local workaround.
2. `apps/api/src/plugins/idempotency.ts` hashes `req.body` only, which is empty for multipart routes; add a route-provided fingerprint hook (documents implements its own preValidation workaround; portal attachments should reuse it).
3. `documents` table has no `version` column → PATCH /documents/:id cannot honour If-Match. Add `version` via a new drizzle migration (packages/db) and wire `applyUpdate`.
4. Indexes suggested by reviews (new migration): `site_visits(lead_id, status)`; GIN on `flat_types.rooms`, `flat_types.areas`, `floor_plan_templates.positions`, `blocks.floor_plans` (usage checks); `payment_plan_assignments(plan_id)`; `bookings(payment_plan_id)`; `audit_logs(company_id, created_at)`.
5. `paginate()` always runs an exact `count(*)`; use `pg_class` estimates above 10k rows unless `exact=true` (ARCHITECTURE §6).
6. `money`: other-charge demand notifications are keyed by entity `booking`; key them by `booking_other_charge` so construction undo can withdraw them selectively.
7. `money`: reversal on a COMPLETED booking is allowed and leaves the booking COMPLETED with due > 0 — decide (owner) whether to block or to reopen to ACTIVE.
8. `lib/version.ts` `withOptionalVersion()` rebuilds a strictObject from `.shape` and drops `.refine()` checks; make it wrap instead of rebuild so refinements survive.
9. `PATCH /projects/:id/website` is registered with `project.read` and checks `project.write | cms.write` inside the handler; expose an OR-permission in `route()` so the registry is truthful.
10. `GET /reports/activity` requires `audit.view`; the ERP must gate its link accordingly.
11. `service_requests.category_id` nullable in DB but required in the response schema → seed must always set it (or make the column NOT NULL).
12. Reseed must keep the demo credentials and numbering exactly as docs/SEED.md.
