// G (part). Report presets, integrity runs
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, mutable } from "./_common.js";
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
