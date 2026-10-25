// F (part). Plans ↔ towers, bookings
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appendOnly, idColumn, mutable, paise, percent, timestamps } from "./_common.js";
import { customers } from "./customers.js";
import { bookingStatusEnum, chargeDemandAtEnum, planAcceptanceModeEnum } from "./enums.js";
import { companies, users } from "./identity.js";
import { blocks, flats, projects } from "./inventory.js";
import type { AgreementValues, Cancellation, FlatSnapshot, JsonObject, PlanSnapshot } from "./json.js";
import { leads } from "./leads.js";
import { chargeTypes, paymentPlans } from "./masters.js";

const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

export const paymentPlanAssignments = pgTable(
  "payment_plan_assignments",
  {
    id: idColumn(),
    companyId: companyId(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => paymentPlans.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    /** NULL = the whole project. */
    blockId: uuid("block_id").references(() => blocks.id),
    isDefault: boolean("is_default").notNull().default(false),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [
    unique("payment_plan_assignments_plan_project_block_uq").on(t.planId, t.projectId, t.blockId).nullsNotDistinct(),
    index("payment_plan_assignments_project_block_active_idx").on(t.projectId, t.blockId, t.isActive),
    index("payment_plan_assignments_plan_idx").on(t.planId),
  ],
);

export const bookingDrafts = pgTable(
  "booking_drafts",
  {
    id: idColumn(),
    companyId: companyId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<JsonObject>().notNull().default({}),
    step: integer("step").notNull().default(1),
    ...timestamps(),
  },
  (t) => [index("booking_drafts_user_updated_idx").on(t.userId, t.updatedAt.desc())],
);

export const bookings = pgTable(
  "bookings",
  {
    id: idColumn(),
    companyId: companyId(),
    bookingNumber: text("booking_number").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id),
    flatId: uuid("flat_id")
      .notNull()
      .references(() => flats.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    bookingDate: date("booking_date").notNull(),
    status: bookingStatusEnum("status").notNull().default("ACTIVE"),
    agreementValuePaise: paise("agreement_value_paise").notNull(),
    cashAgreedPaise: paise("cash_agreed_paise").notNull(),
    accountAgreedPaise: paise("account_agreed_paise").notNull(),
    flatSnapshot: jsonb("flat_snapshot").$type<FlatSnapshot>().notNull(),
    ratePerSqftPaise: paise("rate_per_sqft_paise"),
    paymentPlanId: uuid("payment_plan_id")
      .notNull()
      .references(() => paymentPlans.id),
    planSnapshot: jsonb("plan_snapshot").$type<PlanSnapshot>().notNull(),
    planAcceptedOn: date("plan_accepted_on"),
    planAcceptanceMode: planAcceptanceModeEnum("plan_acceptance_mode").notNull().default("IN_PERSON"),
    planAcceptanceDocumentId: uuid("plan_acceptance_document_id"),
    salesUserId: uuid("sales_user_id").references(() => users.id),
    leadId: uuid("lead_id").references(() => leads.id),
    brokerName: text("broker_name"),
    remarks: text("remarks"),
    // summary (materialised, transactional)
    raisedPercent: percent("raised_percent").notNull().default(0),
    cashOrderRaisedPaise: paise("cash_order_raised_paise").notNull().default(0),
    accountOrderRaisedPaise: paise("account_order_raised_paise").notNull().default(0),
    cashPaidPaise: paise("cash_paid_paise").notNull().default(0),
    accountPaidPaise: paise("account_paid_paise").notNull().default(0),
    otherChargesDemandedPaise: paise("other_charges_demanded_paise").notNull().default(0),
    otherChargesPaidPaise: paise("other_charges_paid_paise").notNull().default(0),
    pendingChequesPaise: paise("pending_cheques_paise").notNull().default(0),
    lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
    cancellation: jsonb("cancellation").$type<Cancellation>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    completionNotes: text("completion_notes"),
    ...mutable(),
  },
  (t) => [
    unique("bookings_company_number_uq").on(t.companyId, t.bookingNumber),
    uniqueIndex("bookings_one_active_per_flat_uq").on(t.flatId).where(sql`${t.status} = 'ACTIVE'`),
    index("bookings_company_project_status_date_idx").on(t.companyId, t.projectId, t.status, t.bookingDate.desc()),
    index("bookings_block_status_idx").on(t.blockId, t.status),
    index("bookings_customer_idx").on(t.customerId),
    index("bookings_payment_plan_idx").on(t.paymentPlanId),
  ],
);

export const bookingCoApplicants = pgTable(
  "booking_co_applicants",
  {
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    ...appendOnly(),
  },
  (t) => [
    primaryKey({ name: "booking_co_applicants_pk", columns: [t.bookingId, t.customerId] }),
    index("booking_co_applicants_customer_idx").on(t.customerId),
  ],
);

export const bookingOtherCharges = pgTable(
  "booking_other_charges",
  {
    id: idColumn(),
    companyId: companyId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    chargeTypeId: uuid("charge_type_id").references(() => chargeTypes.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    gstPercent: percent("gst_percent").notNull().default(0),
    gstPaise: paise("gst_paise").notNull().default(0),
    totalPaise: paise("total_paise").notNull(),
    demandAt: chargeDemandAtEnum("demand_at").notNull().default("MANUAL"),
    demandedAt: timestamp("demanded_at", { withTimezone: true }),
    demandNumber: text("demand_number"),
    dueDate: date("due_date"),
    paidPaise: paise("paid_paise").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("booking_other_charges_booking_idx").on(t.bookingId)],
);

export const agreementRevisions = pgTable(
  "agreement_revisions",
  {
    id: idColumn(),
    companyId: companyId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    revisedAt: timestamp("revised_at", { withTimezone: true }).notNull().defaultNow(),
    revisedBy: uuid("revised_by"),
    revisedByName: text("revised_by_name"),
    reason: text("reason").notNull(),
    before: jsonb("before").$type<AgreementValues>().notNull(),
    after: jsonb("after").$type<AgreementValues>().notNull(),
    ...appendOnly(),
  },
  (t) => [index("agreement_revisions_booking_idx").on(t.bookingId, t.revisedAt.desc())],
);

export const bookingPlanRevisions = pgTable(
  "booking_plan_revisions",
  {
    id: idColumn(),
    companyId: companyId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    by: uuid("by"),
    reason: text("reason").notNull(),
    beforePlanSnapshot: jsonb("before_plan_snapshot").$type<PlanSnapshot>().notNull(),
    afterPlanSnapshot: jsonb("after_plan_snapshot").$type<PlanSnapshot>().notNull(),
    ...appendOnly(),
  },
  (t) => [index("booking_plan_revisions_booking_idx").on(t.bookingId, t.at.desc())],
);
