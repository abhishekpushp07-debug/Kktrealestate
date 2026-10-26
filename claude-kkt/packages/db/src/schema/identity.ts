// A. Identity & platform
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appendOnly, citext, idColumn, mutable, softDelete, trgm } from "./_common.js";
import { actorTypeEnum, jobRunStatusEnum, userTypeEnum } from "./enums.js";
import type { Address, CompanySettings, JsonObject, Letterhead, Numbering } from "./json.js";

export const companies = pgTable(
  "companies",
  {
    id: idColumn(),
    name: text("name").notNull(),
    /**
     * URL-safe tenant key (lowercase kebab, globally unique; migration 0005): `x-kkt-company: <slug>` and login bodies' `company` name the
     * company (contract C4, apps/api/src/lib/tenant.ts). The trigger `companies_set_slug` (src/sql/0001_triggers.sql) derives it from
     * `name` when an insert leaves it NULL or empty, so Drizzle sends '' by default.
     */
    slug: text("slug")
      .notNull()
      .$defaultFn(() => ""),
    /** Hostnames that resolve to this company (contract C4 step 3), e.g. `{www.sgb.in, my.sgb.in}`; GIN-indexed. */
    hosts: text("hosts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
        force_mfa_for_admins: true,
        sla_hours: { LOW: 72, MEDIUM: 48, HIGH: 24, URGENT: 8 },
        booking_hold_hours: 48,
      }),
    ...mutable(),
  },
  (t) => [
    unique("companies_slug_uq").on(t.slug),
    index("companies_hosts_idx").using("gin", t.hosts),
    check("companies_slug_format_chk", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
    /** Last accepted TOTP time step (unix seconds / 30): a code is accepted once, never replayed inside the ±1 window (migration 0005). */
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    avatarDocumentId: uuid("avatar_document_id"),
    ...mutable(),
  },
  (t) => [
    unique("users_company_email_uq").on(t.companyId, t.email),
    index("users_role_idx").on(t.roleId),
    trgm("users_name_trgm_idx", t.name),
    trgm("users_phone_trgm_idx", t.phone),
    // citext has no trigram operator class: the index is on email::text, so searches must compare `email::text ILIKE …`.
    index("users_email_trgm_idx").using("gin", sql`(${t.email}::text) gin_trgm_ops`),
  ],
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
    /**
     * When the family's first token was issued (migration 0005, contract C1): rotation copies it to every successor, so the absolute
     * session lifetime (REFRESH_ABSOLUTE_TTL_DAYS) is never extended. Backfilled with the family's earliest created_at.
     */
    familyStartedAt: timestamp("family_started_at", { withTimezone: true }).notNull().defaultNow(),
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
    index("refresh_tokens_company_id_idx").on(t.companyId),
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
  (t) => [
    index("login_events_created_idx").on(t.createdAt.desc()),
    index("login_events_identifier_idx").on(t.identifier),
    index("login_events_company_id_idx").on(t.companyId),
  ],
);

/** Append-only: `audit_logs_immutable` raises on UPDATE/DELETE and `audit_logs_no_truncate` on TRUNCATE (src/sql/0001_triggers.sql). */
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
    index("audit_logs_company_created_idx").on(t.companyId, t.createdAt.desc(), t.id.desc()),
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
    /** Set when the handler's transaction committed (migration 0005): a committed key is never released for re-execution. */
    committedAt: timestamp("committed_at", { withTimezone: true }),
    /** An IN_PROGRESS claim is owned until this instant; the running request extends it (heartbeat), a retry may take it over after. */
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("idempotency_keys_scope_key_uq").on(t.scopeKey, t.key),
    index("idempotency_keys_expires_idx").on(t.expiresAt),
  ],
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
    /** Last liveness beat of the worker running this job (migration 0005, contract C8); a stale beat marks an abandoned run. */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    /** Resume point of a heavy job interrupted by a deploy (e.g. last processed id); job-specific JSON. */
    checkpoint: jsonb("checkpoint").$type<JsonObject>(),
  },
  (t) => [index("job_runs_name_started_idx").on(t.jobName, t.startedAt.desc())],
);

/**
 * Hash chain over audit_logs (migration 0005): each seal covers the rows `first_audit_id`..`last_audit_id` (`row_count` rows, in
 * (created_at, id) order) and `hash = sha256(prev_hash ‖ rows)`, so a changed, removed or inserted audit row breaks every later seal.
 * `company_id` NULL = a seal over every company's rows. Append-only like audit_logs.
 */
export const auditSeals = pgTable(
  "audit_seals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: uuid("company_id").references(() => companies.id),
    firstAuditId: uuid("first_audit_id").notNull(),
    lastAuditId: uuid("last_audit_id").notNull(),
    rowCount: integer("row_count").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_seals_company_sealed_idx").on(t.companyId, t.sealedAt.desc()),
    check("audit_seals_row_count_chk", sql`${t.rowCount} > 0`),
  ],
);
