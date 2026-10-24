/**
 * @kkt/db schema — conventions (see docs/DATA-MODEL.md)
 *
 * - One file per DATA-MODEL section: identity, masters, documents, inventory, customers,
 *   leads, bookings, money, service, cms, misc. `enums.ts` holds every pgEnum (values come
 *   from @kkt/contracts), `json.ts` the TS shapes of jsonb columns, `_common.ts` the helpers.
 * - Table names and column names are snake_case in Postgres; TS property names are camelCase.
 * - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` on every entity table; pure join/child
 *   tables use composite primary keys.
 * - `company_id` on every business table; every business-key UNIQUE is scoped by company_id.
 * - Mutable rows carry `created_at`, `updated_at` (maintained by the `set_updated_at` trigger),
 *   `created_by` (NULL = system) and `version` (optimistic concurrency). Append-only rows carry
 *   `created_at` only. Masters & structure soft-delete via `is_active` + `deactivated_at`.
 * - Money is integer paise: `bigint` columns suffixed `_paise`, read as JS `number`.
 *   Percent = numeric(5,2), area = numeric(10,2) sq ft, both read as `number`.
 *   Business dates are `date` (YYYY-MM-DD strings); event times are `timestamptz`.
 * - Enum values are UPPER_SNAKE strings shared with the wire contract.
 * - Database-enforced invariants: audit_logs immutable (trigger), one ACTIVE booking per flat,
 *   one non-VOID demand per (booking, installment_seq), one ACTIVE rate card per project, one
 *   default bank account and one possession stage per company (partial unique indexes),
 *   payments.amount_paise > 0, site_visits.visitors 1..6, service_requests.rating 1..5,
 *   payment_plan_assignments UNIQUE NULLS NOT DISTINCT (plan_id, project_id, block_id).
 * - Cross-area cycles (flats ↔ bookings, leads ↔ bookings) are broken by storing the back
 *   reference as a plain uuid without an FK; the booking engine owns those writes.
 */
export * from "./enums.js";
export * from "./json.js";
export * from "./identity.js";
export * from "./masters.js";
export * from "./documents.js";
export * from "./inventory.js";
export * from "./customers.js";
export * from "./leads.js";
export * from "./bookings.js";
export * from "./money.js";
export * from "./service.js";
export * from "./cms.js";
export * from "./misc.js";
