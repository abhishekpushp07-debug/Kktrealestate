// E. Leads & visits
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, time, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appendOnly, idColumn, mutable, paise, timestamps } from "./_common.js";
import { customers } from "./customers.js";
import { actorTypeEnum, leadSourceEnum, leadStageEnum, visitSourceEnum, visitStatusEnum } from "./enums.js";
import { companies, users } from "./identity.js";
import { projects } from "./inventory.js";
import type { JsonObject, RescheduledFrom, Utm } from "./json.js";
import { flatTypes } from "./masters.js";

const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

export const leads = pgTable(
  "leads",
  {
    id: idColumn(),
    companyId: companyId(),
    leadNumber: text("lead_number").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    projectId: uuid("project_id").references(() => projects.id),
    flatTypeId: uuid("flat_type_id").references(() => flatTypes.id),
    budgetMinPaise: paise("budget_min_paise"),
    budgetMaxPaise: paise("budget_max_paise"),
    source: leadSourceEnum("source").notNull().default("WALK_IN"),
    stage: leadStageEnum("stage").notNull().default("NEW"),
    previousStage: leadStageEnum("previous_stage"),
    lostReason: text("lost_reason"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    customerId: uuid("customer_id").references(() => customers.id),
    /** Set on conversion; no FK to avoid a leads ↔ bookings cycle. */
    bookingId: uuid("booking_id"),
    utm: jsonb("utm").$type<Utm>(),
    message: text("message"),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    isRead: boolean("is_read").notNull().default(false),
    consent: boolean("consent").notNull().default(false),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    ...mutable(),
  },
  (t) => [
    unique("leads_company_number_uq").on(t.companyId, t.leadNumber),
    index("leads_company_phone_project_idx").on(t.companyId, t.phone, t.projectId),
    index("leads_company_stage_idx").on(t.companyId, t.stage),
    index("leads_assigned_follow_up_idx").on(t.assignedUserId, t.nextFollowUpAt),
    index("leads_company_source_created_idx").on(t.companyId, t.source, t.createdAt.desc()),
  ],
);

export const leadStageHistory = pgTable(
  "lead_stage_history",
  {
    id: idColumn(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    fromStage: leadStageEnum("from_stage"),
    toStage: leadStageEnum("to_stage").notNull(),
    byUserId: uuid("by_user_id"),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_stage_history_lead_idx").on(t.leadId, t.at.desc())],
);

export const leadFollowUps = pgTable(
  "lead_follow_ups",
  {
    id: idColumn(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    nextAt: timestamp("next_at", { withTimezone: true }),
    byUserId: uuid("by_user_id"),
    ...timestamps(),
  },
  (t) => [index("lead_follow_ups_lead_idx").on(t.leadId, t.createdAt.desc())],
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: idColumn(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<JsonObject>(),
    actorType: actorTypeEnum("actor_type").notNull().default("SYSTEM"),
    actorId: uuid("actor_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_activities_lead_idx").on(t.leadId, t.at.desc())],
);

export const siteVisits = pgTable(
  "site_visits",
  {
    id: idColumn(),
    companyId: companyId(),
    visitNumber: text("visit_number").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    leadId: uuid("lead_id").references(() => leads.id),
    customerId: uuid("customer_id").references(() => customers.id),
    visitDate: date("visit_date").notNull(),
    slotStart: time("slot_start").notNull(),
    slotEnd: time("slot_end").notNull(),
    visitors: integer("visitors").notNull().default(1),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    message: text("message"),
    status: visitStatusEnum("status").notNull().default("CONFIRMED"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    manageTokenHash: text("manage_token_hash"),
    source: visitSourceEnum("source").notNull().default("ERP"),
    rescheduledFrom: jsonb("rescheduled_from").$type<RescheduledFrom>(),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    outcomeMarkedAt: timestamp("outcome_marked_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [
    unique("site_visits_company_number_uq").on(t.companyId, t.visitNumber),
    index("site_visits_project_slot_idx").on(t.projectId, t.visitDate, t.slotStart, t.status),
    index("site_visits_assignee_date_idx").on(t.assigneeUserId, t.visitDate),
    index("site_visits_lead_status_idx").on(t.leadId, t.status),
    check("site_visits_visitors_chk", sql`${t.visitors} BETWEEN 1 AND 6`),
  ],
);

export const brochureDownloads = pgTable(
  "brochure_downloads",
  {
    id: idColumn(),
    companyId: companyId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    leadId: uuid("lead_id").references(() => leads.id),
    tokenHash: text("token_hash").notNull().unique("brochure_downloads_token_hash_uq"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    ...appendOnly(),
  },
  (t) => [index("brochure_downloads_project_created_idx").on(t.projectId, t.createdAt.desc())],
);

export const enquiries = pgTable(
  "enquiries",
  {
    id: idColumn(),
    companyId: companyId(),
    leadId: uuid("lead_id").references(() => leads.id),
    projectId: uuid("project_id").references(() => projects.id),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    flatTypeId: uuid("flat_type_id").references(() => flatTypes.id),
    message: text("message"),
    sourcePage: text("source_page"),
    utm: jsonb("utm").$type<Utm>(),
    ip: text("ip"),
    referenceNumber: text("reference_number").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("enquiries_company_read_created_idx").on(t.companyId, t.isRead, t.createdAt.desc())],
);
