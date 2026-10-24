// A. Identity & platform
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appendOnly, citext, idColumn, mutable, softDelete } from "./_common.js";
import { actorTypeEnum, jobRunStatusEnum, userTypeEnum } from "./enums.js";
import type { Address, CompanySettings, JsonObject, Letterhead, Numbering } from "./json.js";

export const companies = pgTable("companies", {
  id: idColumn(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  gstin: text("gstin"),
  phone: text("phone"),
  email: text("email"),
  address: jsonb("address").$type<Address>(),
  logoDocumentId: uuid("logo_document_id"),
  letterhead: jsonb("letterhead").$type<Letterhead>().notNull().default({}),
  fyStartMonth: integer("fy_start_month").notNull().default(4),
  numbering: jsonb("numbering")
    .$type<Numbering>()
    .notNull()
    .default({
      customer: { prefix: "CUST-" },
      booking: { prefix: "BK-" },
      demand: { prefix: "DM-" },
      receipt: { prefix: "SGB/" },
      ticket: { prefix: "SR-" },
      visit: { prefix: "SV-" },
    }),
  settings: jsonb("settings")
    .$type<CompanySettings>()
    .notNull()
    .default({
      demand_due_days: 15,
      default_gst_percent: 5,
      round_robin_enabled: true,
      force_mfa_for_admins: false,
      sla_hours: { LOW: 72, MEDIUM: 48, HIGH: 24, URGENT: 8 },
      booking_hold_hours: 48,
    }),
  ...mutable(),
});

export const roles = pgTable(
  "roles",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    isSystem: boolean("is_system").notNull().default(false),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("roles_company_name_uq").on(t.companyId, t.name)],
);

export const users = pgTable(
  "users",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    email: citext("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    allProjects: boolean("all_projects").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecretEnc: text("mfa_secret_enc"),
    mfaPendingSecretEnc: text("mfa_pending_secret_enc"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    avatarDocumentId: uuid("avatar_document_id"),
    ...mutable(),
  },
  (t) => [unique("users_company_email_uq").on(t.companyId, t.email), index("users_role_idx").on(t.roleId)],
);

export const passwordHistory = pgTable(
  "password_history",
  {
    id: idColumn(),
    userType: userTypeEnum("user_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    passwordHash: text("password_hash").notNull(),
    ...appendOnly(),
  },
  (t) => [index("password_history_subject_idx").on(t.subjectId, t.createdAt.desc())],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    subjectType: userTypeEnum("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique("refresh_tokens_token_hash_uq"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    replacedById: uuid("replaced_by_id"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    index("refresh_tokens_subject_idx").on(t.subjectType, t.subjectId),
    index("refresh_tokens_family_idx").on(t.familyId),
  ],
);

export const loginEvents = pgTable(
  "login_events",
  {
    id: idColumn(),
    companyId: uuid("company_id").references(() => companies.id),
    subjectType: userTypeEnum("subject_type").notNull(),
    identifier: text("identifier").notNull(),
    success: boolean("success").notNull(),
    reason: text("reason"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    ...appendOnly(),
  },
  (t) => [index("login_events_created_idx").on(t.createdAt.desc()), index("login_events_identifier_idx").on(t.identifier)],
);

/** Append-only: the `audit_logs_immutable` trigger (src/sql/0001_triggers.sql) raises on UPDATE/DELETE. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before").$type<JsonObject>(),
    after: jsonb("after").$type<JsonObject>(),
    ip: text("ip"),
    requestId: text("request_id"),
    ...appendOnly(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt.desc()),
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt.desc()),
    index("audit_logs_created_idx").on(t.createdAt.desc()),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: idColumn(),
    scopeKey: text("scope_key").notNull(),
    key: text("key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    responseBody: jsonb("response_body").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique("idempotency_keys_scope_key_uq").on(t.scopeKey, t.key), index("idempotency_keys_expires_idx").on(t.expiresAt)],
);

/** Per-company, per-scope, per-financial-year counters; incremented atomically by `nextSequence`. */
export const sequences = pgTable(
  "sequences",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    scope: text("scope").notNull(),
    fy: text("fy").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ name: "sequences_pk", columns: [t.companyId, t.scope, t.fy] })],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: idColumn(),
    jobName: text("job_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: jobRunStatusEnum("status").notNull().default("RUNNING"),
    result: jsonb("result").$type<JsonObject>(),
    error: text("error"),
  },
  (t) => [index("job_runs_name_started_idx").on(t.jobName, t.startedAt.desc())],
);
