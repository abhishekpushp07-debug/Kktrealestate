// F (part). Demands, payments, ledger, contra entries
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appendOnly, idColumn, mutable, paise, percent, timestamps } from "./_common.js";
import { bookingOtherCharges, bookings } from "./bookings.js";
import { customers } from "./customers.js";
import {
  contraTypeEnum,
  demandStatusEnum,
  ledgerEventEnum,
  paymentAgainstEnum,
  paymentBucketEnum,
  paymentStatusEnum,
  triggerTypeEnum,
} from "./enums.js";
import { companies, users } from "./identity.js";
import { blocks, projects } from "./inventory.js";
import type { Instrument } from "./json.js";
import { bankAccounts, constructionStages, paymentModes } from "./masters.js";

const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

export const demands = pgTable(
  "demands",
  {
    id: idColumn(),
    companyId: companyId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    demandNumber: text("demand_number").notNull(),
    installmentSeq: integer("installment_seq").notNull(),
    installmentName: text("installment_name").notNull(),
    triggerType: triggerTypeEnum("trigger_type").notNull(),
    triggerLabel: text("trigger_label"),
    triggerStageId: uuid("trigger_stage_id").references(() => constructionStages.id),
    percent: percent("percent").notNull(),
    cumulativePercent: percent("cumulative_percent").notNull(),
    cashDemandPaise: paise("cash_demand_paise").notNull(),
    accountDemandPaise: paise("account_demand_paise").notNull(),
    totalDemandPaise: paise("total_demand_paise").notNull(),
    demandDate: date("demand_date").notNull(),
    dueDate: date("due_date").notNull(),
    status: demandStatusEnum("status").notNull().default("OPEN"),
    paidPaise: paise("paid_paise").notNull().default(0),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    unique("demands_company_number_uq").on(t.companyId, t.demandNumber),
    uniqueIndex("demands_booking_seq_nonvoid_uq").on(t.bookingId, t.installmentSeq).where(sql`${t.status} <> 'VOID'`),
    index("demands_company_status_due_idx").on(t.companyId, t.status, t.dueDate),
    index("demands_block_stage_idx").on(t.blockId, t.triggerStageId),
    index("demands_booking_posted_idx").on(t.bookingId, t.postedAt),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: idColumn(),
    companyId: companyId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    receiptNumber: text("receipt_number").notNull(),
    against: paymentAgainstEnum("against").notNull().default("FLAT_VALUE"),
    bucket: paymentBucketEnum("bucket"),
    otherChargeId: uuid("other_charge_id").references(() => bookingOtherCharges.id),
    amountPaise: paise("amount_paise").notNull(),
    paymentDate: date("payment_date").notNull(),
    paymentModeId: uuid("payment_mode_id")
      .notNull()
      .references(() => paymentModes.id),
    modeCode: text("mode_code").notNull(),
    instrument: jsonb("instrument").$type<Instrument>(),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    remarks: text("remarks"),
    receivedBy: uuid("received_by").references(() => users.id),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedBy: uuid("cleared_by"),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    bouncedBy: uuid("bounced_by"),
    bounceReason: text("bounce_reason"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reversalReason: text("reversal_reason"),
    receiptCancelled: boolean("receipt_cancelled").notNull().default(false),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text("idempotency_key"),
    ...mutable(),
  },
  (t) => [
    unique("payments_company_receipt_uq").on(t.companyId, t.receiptNumber),
    index("payments_booking_status_idx").on(t.bookingId, t.status),
    index("payments_company_date_idx").on(t.companyId, t.paymentDate.desc()),
    index("payments_project_date_idx").on(t.projectId, t.paymentDate.desc()),
    index("payments_company_status_date_idx").on(t.companyId, t.status, t.paymentDate),
    check("payments_amount_positive_chk", sql`${t.amountPaise} > 0`),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: idColumn(),
    companyId: companyId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    seq: integer("seq").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    entryDate: date("entry_date").notNull(),
    event: ledgerEventEnum("event").notNull(),
    /** Stage / installment / charge name. */
    label: text("label"),
    bucket: paymentBucketEnum("bucket"),
    amountPaise: paise("amount_paise").notNull(),
    cashPaidCumPaise: paise("cash_paid_cum_paise").notNull(),
    accountPaidCumPaise: paise("account_paid_cum_paise").notNull(),
    cashOrderRaisedPaise: paise("cash_order_raised_paise").notNull(),
    accountOrderRaisedPaise: paise("account_order_raised_paise").notNull(),
    cashDuePaise: paise("cash_due_paise").notNull(),
    accountDuePaise: paise("account_due_paise").notNull(),
    totalDuePaise: paise("total_due_paise").notNull(),
    otherChargesDuePaise: paise("other_charges_due_paise").notNull().default(0),
    refNumber: text("ref_number"),
    refId: uuid("ref_id"),
    note: text("note"),
    ...appendOnly(),
  },
  (t) => [unique("ledger_entries_booking_seq_uq").on(t.bookingId, t.seq), index("ledger_entries_booking_seq_idx").on(t.bookingId, t.seq)],
);

export const contraEntries = pgTable(
  "contra_entries",
  {
    id: idColumn(),
    companyId: companyId(),
    entryDate: date("entry_date").notNull(),
    type: contraTypeEnum("type").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    remarks: text("remarks"),
    byUserId: uuid("by_user_id").references(() => users.id),
    ...appendOnly(),
  },
  (t) => [index("contra_entries_company_date_idx").on(t.companyId, t.entryDate), check("contra_entries_amount_positive_chk", sql`${t.amountPaise} > 0`)],
);
