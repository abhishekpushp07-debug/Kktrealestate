// F (part). Demands, payments, ledger, contra entries
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appendOnly, idColumn, mutable, paise, percent, trgm, versioned } from "./_common.js";
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

/** Never deleted: the `demands_no_delete` trigger raises on DELETE; demands are VOIDed with a reason. */
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
    ...versioned(),
  },
  (t) => [
    unique("demands_company_number_uq").on(t.companyId, t.demandNumber),
    uniqueIndex("demands_booking_seq_nonvoid_uq")
      .on(t.bookingId, t.installmentSeq)
      .where(sql`${t.status} <> 'VOID'`),
    index("demands_company_status_due_idx").on(t.companyId, t.status, t.dueDate),
    index("demands_block_stage_idx").on(t.blockId, t.triggerStageId),
    index("demands_booking_posted_idx").on(t.bookingId, t.postedAt),
    index("demands_company_posted_idx").on(t.companyId, t.postedAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    // migration 0005 (built CONCURRENTLY by src/sql/online/0005_indexes.sql): the demands list search
    trgm("demands_demand_number_trgm_idx", t.demandNumber),
    trgm("demands_installment_name_trgm_idx", t.installmentName),
    check("demands_split_chk", sql`${t.cashDemandPaise} + ${t.accountDemandPaise} = ${t.totalDemandPaise}`),
    check(
      "demands_amounts_nonneg_chk",
      sql`${t.cashDemandPaise} >= 0 AND ${t.accountDemandPaise} >= 0 AND ${t.paidPaise} >= 0`,
    ),
    index("demands_customer_id_idx").on(t.customerId),
    index("demands_project_id_idx").on(t.projectId),
    index("demands_trigger_stage_id_idx").on(t.triggerStageId),
  ],
);

/** Never deleted: the `payments_no_delete` trigger raises on DELETE; payments are REVERSED with a reason. */
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
    index("payments_company_date_idx").on(t.companyId, t.paymentDate.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index("payments_project_date_idx").on(t.projectId, t.paymentDate.desc().nullsFirst()),
    index("payments_company_status_date_idx").on(t.companyId, t.status, t.paymentDate),
    check("payments_amount_positive_chk", sql`${t.amountPaise} > 0`),
    // A retried POST /payments carrying the same Idempotency-Key can never post a second receipt, even if the response cache was lost.
    uniqueIndex("payments_company_idempotency_key_uq")
      .on(t.companyId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    trgm("payments_receipt_number_trgm_idx", t.receiptNumber),
    // migration 0005 (online): the cheque / instrument number searched by GET /payments (`instrument ->> 'number'`)
    index("payments_instrument_number_trgm_idx").using("gin", sql`(${t.instrument} ->> 'number') gin_trgm_ops`),
    index("payments_bank_account_id_idx").on(t.bankAccountId),
    index("payments_block_id_idx").on(t.blockId),
    index("payments_customer_id_idx").on(t.customerId),
    index("payments_other_charge_id_idx").on(t.otherChargeId),
    index("payments_payment_mode_id_idx").on(t.paymentModeId),
    index("payments_received_by_idx").on(t.receivedBy),
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
    /**
     * Rebuild epoch (migration 0005, contract C7): a rebuild never deletes rows, it writes the restated ledger as epoch n+1;
     * `bookings.ledger_epoch` names the current one. `seq` restarts at 1 in every epoch.
     */
    epoch: integer("epoch").notNull().default(1),
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
  // UNIQUE (booking_id, epoch, seq) serves every ledger read (a booking's current epoch in seq order). Migration 0005 replaced
  // UNIQUE (booking_id, seq): the index is built CONCURRENTLY and attached as the constraint by src/sql/online/0005_indexes.sql.
  (t) => [
    unique("ledger_entries_booking_epoch_seq_uq").on(t.bookingId, t.epoch, t.seq),
    index("ledger_entries_company_id_idx").on(t.companyId),
  ],
);

/**
 * One row per ledger rebuild (contract C7): the booking's ledger moved from `from_epoch` to `to_epoch` for `reason` (agreement revision,
 * plan change, stage undo, repair, admin recompute …). `summary` holds the money totals of the restated epoch. Append-only.
 */
export const ledgerRebuilds = pgTable(
  "ledger_rebuilds",
  {
    id: idColumn(),
    companyId: companyId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    fromEpoch: integer("from_epoch").notNull(),
    toEpoch: integer("to_epoch").notNull(),
    reason: text("reason").notNull(),
    /** Staff user who caused the rebuild; NULL = system (jobs, repair runs). */
    actorId: uuid("actor_id").references(() => users.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("ledger_rebuilds_booking_at_idx").on(t.bookingId, t.at.desc().nullsFirst()),
    index("ledger_rebuilds_company_id_idx").on(t.companyId),
    index("ledger_rebuilds_actor_id_idx").on(t.actorId),
    check("ledger_rebuilds_epochs_chk", sql`${t.toEpoch} > ${t.fromEpoch} AND ${t.fromEpoch} >= 1`),
  ],
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
  (t) => [
    index("contra_entries_company_date_idx").on(t.companyId, t.entryDate),
    check("contra_entries_amount_positive_chk", sql`${t.amountPaise} > 0`),
    index("contra_entries_bank_account_id_idx").on(t.bankAccountId),
    index("contra_entries_by_user_id_idx").on(t.byUserId),
  ],
);
