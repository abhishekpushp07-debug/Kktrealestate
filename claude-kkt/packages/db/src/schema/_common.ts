// Shared column helpers used by every schema file. Keeps the conventions of
// docs/DATA-MODEL.md ("Conventions") in one place so tables stay uniform.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  numeric,
  timestamp,
  uuid,
  type ExtraConfigColumn,
} from "drizzle-orm/pg-core";

/** Postgres `citext` (case-insensitive text), used for e-mail addresses. */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "citext";
  },
});

/** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`. */
export const idColumn = () => uuid("id").primaryKey().defaultRandom();

/** `created_at timestamptz NOT NULL DEFAULT now()`. */
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** `updated_at timestamptz NOT NULL DEFAULT now()` (maintained by the `set_updated_at` trigger). */
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Append-only rows: `created_at` only. */
export const appendOnly = () => ({ createdAt: createdAt() });

/** Rows that change but carry no optimistic-concurrency version (child/engine rows). */
export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/** Every mutable business row: created_at, updated_at, created_by (NULL = system), version. */
export const mutable = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: uuid("created_by"),
  version: integer("version").notNull().default(1),
});

/** Soft delete for masters & structure: `is_active`, `deactivated_at`. */
export const softDelete = () => ({
  isActive: boolean("is_active").notNull().default(true),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
});

/** Money column in integer paise (bigint in Postgres, number in TS; all amounts fit in 2^53). */
export const paise = (name: string) => bigint(name, { mode: "number" });

/** Percent column `numeric(5,2)` read as a number. */
export const percent = (name: string) => numeric(name, { precision: 5, scale: 2, mode: "number" });

/** Area column `numeric(10,2)` (sq ft) read as a number. */
export const sqft = (name: string) => numeric(name, { precision: 10, scale: 2, mode: "number" });

/**
 * Trigram GIN index (`pg_trgm`, `gin_trgm_ops`) so `ILIKE '%term%'` and `ILIKE 'term%'` searches use an index instead of a
 * sequential scan. Every column a list/search route ORs together needs one, or the planner falls back to a scan for the whole OR.
 */
export const trgm = (name: string, column: ExtraConfigColumn) => index(name).using("gin", column.op("gin_trgm_ops"));

/** Business-date default of today's date. */
export const currentDate = sql`CURRENT_DATE`;
