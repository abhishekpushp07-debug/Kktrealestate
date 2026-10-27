// F (part). Plans ↔ towers, bookings
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appendOnly, idColumn, mutable, paise, percent, timestamps, trgm, versioned } from "./_common.js";
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
    index("payment_plan_assignments_block_id_idx").on(t.blockId),
    index("payment_plan_assignments_company_id_idx").on(t.companyId),
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
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("booking_drafts_user_updated_idx").on(t.userId, t.updatedAt.desc().nullsFirst()),
    index("booking_drafts_company_id_idx").on(t.companyId),
  ],
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
    /** Flat price offered at booking time (flat_snapshot.price_paise); agreement_value_paise may deviate from it only with a reason. */
    listPricePaise: paise("list_price_paise"),
    priceDeviationReason: text("price_deviation_reason"),
    priceDeviationBy: uuid("price_deviation_by"),
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
    /** Refund and deduction of a cancellation as money columns (migration 0005; `cancellation` jsonb keeps the history text). */
    cancellationRefundPaise: paise("cancellation_refund_paise"),
    cancellationDeductionPaise: paise("cancellation_deduction_paise"),
    /** Current ledger epoch (contract C7): ledger_entries of this booking with `epoch` = this value are the live statement. */
    ledgerEpoch: integer("ledger_epoch").notNull().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    completionNotes: text("completion_notes"),
    ...mutable(),
  },
  (t) => [
    unique("bookings_company_number_uq").on(t.companyId, t.bookingNumber),
    uniqueIndex("bookings_one_active_per_flat_uq")
      .on(t.flatId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index("bookings_company_project_status_date_idx").on(
      t.companyId,
      t.projectId,
      t.status,
      t.bookingDate.desc().nullsFirst(),
    ),
    index("bookings_block_status_idx").on(t.blockId, t.status),
    index("bookings_customer_idx").on(t.customerId),
    index("bookings_payment_plan_idx").on(t.paymentPlanId),
    index("bookings_company_booking_date_idx").on(
      t.companyId,
      t.bookingDate.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    trgm("bookings_booking_number_trgm_idx", t.bookingNumber),
    check(
      "bookings_agreement_split_chk",
      sql`${t.cashAgreedPaise} + ${t.accountAgreedPaise} = ${t.agreementValuePaise}`,
    ),
    check("bookings_agreed_nonneg_chk", sql`${t.cashAgreedPaise} >= 0 AND ${t.accountAgreedPaise} >= 0`),
    check("bookings_list_price_nonneg_chk", sql`${t.listPricePaise} IS NULL OR ${t.listPricePaise} >= 0`),
    // added NOT VALID by migration 0005 and validated by src/sql/online/0005_indexes.sql (no long lock on bookings)
    check(
      "bookings_cancellation_amounts_nonneg_chk",
      sql`(${t.cancellationRefundPaise} IS NULL OR ${t.cancellationRefundPaise} >= 0) AND (${t.cancellationDeductionPaise} IS NULL OR ${t.cancellationDeductionPaise} >= 0)`,
    ),
    check("bookings_ledger_epoch_chk", sql`${t.ledgerEpoch} >= 1`),
    index("bookings_flat_id_idx").on(t.flatId),
    index("bookings_lead_id_idx").on(t.leadId),
    index("bookings_project_id_idx").on(t.projectId),
    index("bookings_sales_user_id_idx").on(t.salesUserId),
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
    ...versioned(),
  },
  (t) => [
    index("booking_other_charges_booking_idx").on(t.bookingId),
    check("booking_other_charges_total_chk", sql`${t.totalPaise} = ${t.amountPaise} + ${t.gstPaise}`),
    check(
      "booking_other_charges_nonneg_chk",
      sql`${t.amountPaise} >= 0 AND ${t.gstPaise} >= 0 AND ${t.totalPaise} >= 0 AND ${t.paidPaise} >= 0`,
    ),
    index("booking_other_charges_charge_type_id_idx").on(t.chargeTypeId),
    index("booking_other_charges_company_id_idx").on(t.companyId),
  ],
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
  (t) => [
    index("agreement_revisions_booking_idx").on(t.bookingId, t.revisedAt.desc().nullsFirst()),
    index("agreement_revisions_company_id_idx").on(t.companyId),
  ],
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
  (t) => [
    index("booking_plan_revisions_booking_idx").on(t.bookingId, t.at.desc().nullsFirst()),
    index("booking_plan_revisions_company_id_idx").on(t.companyId),
  ],
);
