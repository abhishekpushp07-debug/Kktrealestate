// G (part). Report presets, integrity runs, asynchronous exports
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { idColumn, mutable } from "./_common.js";
import { exportStatusEnum } from "./enums.js";
import { companies, users } from "./identity.js";
import type { JsonObject } from "./json.js";

export const reportPresets = pgTable(
  "report_presets",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    name: text("name").notNull(),
    params: jsonb("params").$type<JsonObject>().notNull().default({}),
    ...mutable(),
  },
  (t) => [index("report_presets_user_report_idx").on(t.userId, t.reportKey)],
);

export const integrityRuns = pgTable(
  "integrity_runs",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    triggeredBy: uuid("triggered_by"),
    ok: boolean("ok").notNull(),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    findings: jsonb("findings").$type<JsonObject[]>().notNull().default([]),
  },
  (t) => [index("integrity_runs_company_ran_idx").on(t.companyId, t.ranAt.desc())],
);

/**
 * Asynchronous CSV exports: a list request with `format=csv` above the synchronous limit (or any explicit export) is queued here, a
 * worker streams the file to storage under `storage_key`, and the requester downloads it until `expires_at`. `path` + `query` replay the
 * list route exactly (same filters, sort and permission scope as the requesting user).
 */
export const exports = pgTable(
  "exports",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** List route path, e.g. `/api/v1/bookings`. */
    path: text("path").notNull(),
    /** The list query string as parsed key → value. */
    query: jsonb("query").$type<JsonObject>().notNull().default({}),
    status: exportStatusEnum("status").notNull().default("QUEUED"),
    rowCount: integer("row_count"),
    storageKey: text("storage_key"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    index("exports_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("exports_status_expires_idx").on(t.status, t.expiresAt),
    check("exports_row_count_nonneg_chk", sql`${t.rowCount} IS NULL OR ${t.rowCount} >= 0`),
  ],
);
