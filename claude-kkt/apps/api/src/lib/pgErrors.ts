import { sql } from "drizzle-orm";
import type { Executor } from "@kkt/db";
import { ApiError } from "./errors.js";

/** The fields of a Postgres error (postgres.js names them like libpq) that the mappings read. */
export interface PgLikeError {
  code?: string;
  constraint_name?: string;
  constraint?: string;
  table_name?: string;
  column_name?: string;
  detail?: string;
  message?: string;
  cause?: unknown;
}

/** The Postgres error inside `err` (Drizzle wraps driver errors in `cause`), or null. */
export function pgError(err: unknown, depth = 0): PgLikeError | null {
  if (!err || typeof err !== "object" || depth > 5) return null;
  const e = err as PgLikeError;
  if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && typeof e.message === "string") return e;
  if (e.cause && typeof e.cause === "object") return pgError(e.cause, depth + 1);
  return null;
}

/** True for a Postgres unique-violation error (23505), including when wrapped by Drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  return pgError(err)?.code === "23505";
}

/** True for a Postgres foreign-key violation (23503). */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgError(err)?.code === "23503";
}

/**
 * Readable messages for the CHECK constraints (23514 → 422 CONSTRAINT_VIOLATION). A constraint missing here still maps to 422 with a
 * generic message; apps/api/test/integration/pg-errors.test.ts fails when a constraint of the schema has no entry.
 */
export const CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  audit_seals_row_count_chk: "An audit seal must cover at least one audit row",
  booking_other_charges_nonneg_chk: "Other-charge amounts, GST and paid amounts cannot be negative",
  booking_other_charges_total_chk: "An other-charge total must equal its amount plus GST",
  bookings_agreed_nonneg_chk: "Cash and account agreed amounts cannot be negative",
  bookings_agreement_split_chk: "Cash agreed plus account agreed must equal the agreement value",
  bookings_cancellation_amounts_nonneg_chk: "Cancellation refund and deduction cannot be negative",
  bookings_ledger_epoch_chk: "A booking's ledger epoch starts at 1",
  bookings_list_price_nonneg_chk: "The list price cannot be negative",
  companies_slug_format_chk: "A company slug is lowercase letters and digits separated by single hyphens",
  contra_entries_amount_positive_chk: "A contra entry amount must be greater than zero",
  demands_amounts_nonneg_chk: "Demand amounts and the paid amount cannot be negative",
  demands_split_chk: "A demand's cash plus account amounts must equal its total",
  exports_row_count_nonneg_chk: "An export row count cannot be negative",
  flats_price_nonneg_chk: "A flat price and rate per sq ft cannot be negative",
  ledger_rebuilds_epochs_chk: "A ledger rebuild moves to a later epoch",
  parking_slots_price_nonneg_chk: "A parking slot price cannot be negative",
  payments_amount_positive_chk: "A payment amount must be greater than zero",
  project_visit_settings_slot_minutes_chk: "Site-visit slots are 30 or 60 minutes long",
  service_requests_rating_chk: "A rating is between 1 and 5",
  site_visits_visitors_chk: "A site visit is for 1 to 6 visitors",
  storage_deletions_attempts_chk: "A storage deletion attempt count cannot be negative",
};

/** Readable messages for the data-exception SQLSTATEs (class 22 → 400 VALIDATION_ERROR). */
const DATA_EXCEPTION_MESSAGES: Readonly<Record<string, string>> = {
  "22P02": "A value has an invalid format",
  "22003": "A number is out of range",
  "22007": "A date or time has an invalid format",
  "22008": "A date or time is out of range",
  "22023": "A parameter has an invalid value",
  "2201X": "The requested page or row offset is invalid",
  "2201W": "The requested row limit is invalid",
  "22001": "A text value is too long",
  "22012": "Division by zero",
  "22004": "A required value is missing",
  "22025": "A search pattern has an invalid escape sequence",
  "2201B": "A search pattern is not a valid regular expression",
  "22021": "A text value contains invalid characters",
};

const constraintOf = (e: PgLikeError): string | null => e.constraint_name ?? e.constraint ?? null;

/** `… is still referenced from table "bookings"` → bookings (the referencing table of a 23503 on DELETE/UPDATE of the parent). */
function referencedBy(e: PgLikeError): string | null {
  return /is still referenced from table "([^"]+)"/.exec(e.detail ?? "")?.[1] ?? null;
}

/**
 * Maps a constraint or data error onto the API envelope (audit v3 A5/E):
 * - 23514 check_violation → 422 CONSTRAINT_VIOLATION (`details.constraint`, readable message from {@link CONSTRAINT_MESSAGES});
 * - 23503 foreign_key_violation on DELETE/UPDATE of a referenced row → 409 IN_USE (`details.constraint`, `details.referenced_by`,
 *   `details.usage_count` ≥ 1 — the error handler counts the referencing rows when it can); on INSERT/UPDATE of a reference that does
 *   not exist → 422 CONSTRAINT_VIOLATION (`details.kind: "foreign_key"`);
 * - 23505 unique_violation that no route translated → 409 DUPLICATE (`details.constraint`);
 * - 23502 not_null_violation → 422 CONSTRAINT_VIOLATION (`details.column`);
 * - every class-22 data exception (22P02 bad uuid/number syntax, 22003 out of range, 22007/22008 dates, 22023, 2201X …) → 400
 *   VALIDATION_ERROR with `details.issues` (the request carried a value the database cannot read).
 * Null for anything else (connection/timeout trouble is mapDatabaseError's job; the rest stays 500).
 */
export function mapIntegrityError(err: unknown): ApiError | null {
  const e = pgError(err);
  if (!e?.code) return null;
  const constraint = constraintOf(e);
  const table = e.table_name ?? null;
  switch (e.code) {
    case "23514":
      return new ApiError(
        422,
        "CONSTRAINT_VIOLATION",
        (constraint && CONSTRAINT_MESSAGES[constraint]) ?? "The change breaks a data rule of the database",
        { kind: "check", constraint, table },
      );
    case "23503": {
      const by = referencedBy(e);
      if (by !== null || /^update or delete on table/.test(e.message ?? ""))
        return ApiError.conflict(
          "IN_USE",
          `This record is still used by ${by ?? "other records"} and cannot be removed or re-keyed`,
          { usage_count: 1, used_by: by ? [by] : [], constraint, referenced_by: by, table },
        );
      const target = /is not present in table "([^"]+)"/.exec(e.detail ?? "")?.[1] ?? null;
      return new ApiError(
        422,
        "CONSTRAINT_VIOLATION",
        `A referenced ${target ? target.replace(/_/g, " ").replace(/s$/, "") : "record"} does not exist`,
        { kind: "foreign_key", constraint, table, references: target },
      );
    }
    case "23505":
      return ApiError.conflict("DUPLICATE", "A record with the same unique value already exists", {
        constraint,
        table,
      });
    case "23502":
      return new ApiError(
        422,
        "CONSTRAINT_VIOLATION",
        `${e.column_name ? `"${e.column_name}"` : "A required value"} must not be empty`,
        { kind: "not_null", constraint, table, column: e.column_name ?? null },
      );
    default:
      if (e.code.startsWith("22")) {
        const message = DATA_EXCEPTION_MESSAGES[e.code] ?? "A value is invalid";
        return new ApiError(400, "VALIDATION_ERROR", message, {
          issues: [{ path: "", message, code: `sqlstate_${e.code}` }],
          sqlstate: e.code,
        });
      }
      return null;
  }
}

/** Highest `usage_count` an IN_USE mapped from a 23503 reports (the count is "at least this many" beyond it). */
export const USAGE_COUNT_CAP = 10_000;

/**
 * For a 409 IN_USE mapped from a 23503: counts the rows of the referencing table that still point at the key named in the error
 * detail (`Key (id)=(…) is still referenced from table "bookings"`), using the constraint's own column. Falls back to the mapped error
 * (usage_count 1 = "at least one") when anything is unknown. Runs after the failed transaction rolled back.
 */
export async function withUsageCount(db: Executor, err: unknown, mapped: ApiError): Promise<ApiError> {
  const e = pgError(err);
  const constraint = e ? constraintOf(e) : null;
  const key = /Key \([^)]+\)=\(([^)]*)\)/.exec(e?.detail ?? "")?.[1];
  if (mapped.code !== "IN_USE" || !constraint || key === undefined) return mapped;
  try {
    const rows = (await db.execute(sql`
      SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col, format_type(a.atttypid, a.atttypmod) AS typ
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.conname = ${constraint} AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
      LIMIT 1`)) as unknown as { tbl: string; col: string; typ: string }[];
    const ref = rows[0];
    if (
      !ref ||
      !/^[a-z_][a-z0-9_]*$/.test(ref.tbl) ||
      !/^[a-z_][a-z0-9_]*$/.test(ref.col) ||
      !/^[a-z][a-z0-9 _]*(\(\d+(,\d+)?\))?$/.test(ref.typ)
    )
      return mapped;
    // The key is cast to the column's type (never the column to text): the comparison then uses the index every FK column has
    // (online/0005_indexes.sql), and the count stops at USAGE_COUNT_CAP so a hugely referenced row never turns the 409 into a long scan.
    const counted = (await db.execute(
      sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${sql.identifier(ref.tbl)} WHERE ${sql.identifier(ref.col)} = CAST(${key} AS ${sql.raw(ref.typ)}) LIMIT ${USAGE_COUNT_CAP}) AS used`,
    )) as unknown as { n: number }[];
    const n = Number(counted[0]?.n ?? 0);
    if (n < 1) return mapped;
    return new ApiError(mapped.statusCode, mapped.code, mapped.message, { ...mapped.details, usage_count: n });
  } catch {
    return mapped;
  }
}

/**
 * Converts a unique violation into 409 DUPLICATE ("<what> already exists"); any other constraint or data error is rethrown for the
 * error handler's central mapping ({@link mapIntegrityError}: 23503 → 409 IN_USE / 422 CONSTRAINT_VIOLATION, 23514 → 422 …).
 */
export function translatePgError(err: unknown, what: string): never {
  const e = pgError(err);
  if (e?.code === "23505")
    throw ApiError.conflict("DUPLICATE", `${what} already exists`, {
      constraint: constraintOf(e),
    });
  throw err;
}
