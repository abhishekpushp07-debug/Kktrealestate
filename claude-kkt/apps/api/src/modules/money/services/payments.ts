/**
 * Payment posting algorithm (SPEC §11): validate → bucket cap (the only block) → insert payment → ledger PAYMENT row + summary → receipt →
 * notifications; clearing, bouncing and reversal of instruments; receipt and demand-letter data.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DemandLetterData, PaymentBounce, PaymentClear, PaymentCreate, PaymentReverse, ReceiptData } from "@kkt/contracts";
import { bankAccounts, blocks, bookingOtherCharges, bookings, companies, customers, demands, flats, paymentModes, payments, projects, users, type DB, type Executor, type Tx } from "@kkt/db";
import { amountInWords, bucketCapCheck, formatINR, type Bucket } from "@kkt/domain";
import { writeAudit } from "../../../lib/audit.js";
import { decryptField } from "../../../lib/crypto.js";
import { ApiError } from "../../../lib/errors.js";
import { nextNumber } from "../../../lib/numbering.js";
import { ensureProjectAccess, type StaffContext } from "../../../lib/scope.js";
import { applyUpdate } from "../../../lib/version.js";
import { notify, notifyRole } from "../../notifications/service.js";
import { ACCOUNTS_ROLES, Clock, formatAddress, loadBooking, loadCompanyRow, lockBooking, numberingOf, todayDate, type BookingRecord, type MoneyActor } from "../common.js";
import { bookingRecipients, recomputeDemandStatuses } from "./dues.js";
import { appendEvent, events } from "./ledger.js";
import { bankLabel } from "./views.js";

export type PaymentRecord = typeof payments.$inferSelect;

/** Σ CLEARED flat-value payments of a bucket (reversed ones are REVERSED, so excluded). */
async function clearedInBucket(tx: Executor, bookingId: string, bucket: Bucket): Promise<number> {
  const [r] = await tx.select({ n: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` }).from(payments)
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "CLEARED"), eq(payments.against, "FLAT_VALUE"), eq(payments.bucket, bucket)));
  return Number(r?.n ?? 0);
}

/** Σ CLEARED payments against one other-charge line. */
async function clearedOnCharge(tx: Executor, chargeId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` }).from(payments).where(and(eq(payments.otherChargeId, chargeId), eq(payments.status, "CLEARED")));
  return Number(r?.n ?? 0);
}

/** BUCKET CAP RULE: 409 BUCKET_CAP_EXCEEDED with the exact message and {bucket, agreed_paise, paid_paise, amount_paise}. */
async function assertBucketCap(tx: Executor, b: BookingRecord, bucket: Bucket, amount: number): Promise<void> {
  const paid = await clearedInBucket(tx, b.id, bucket);
  const agreed = bucket === "CASH" ? b.cashAgreedPaise : b.accountAgreedPaise;
  const check = bucketCapCheck({ bucket, bucketAgreedPaise: agreed, bucketPaidPaise: paid, amountPaise: amount });
  if (!check.ok) throw ApiError.conflict(check.code, check.message, { bucket, agreed_paise: agreed, paid_paise: paid, amount_paise: amount, headroom_paise: check.details.headroomPaise });
}

/** Other-charge payments cannot exceed the line total (409 CHARGE_CAP_EXCEEDED). */
async function assertChargeCap(tx: Executor, line: typeof bookingOtherCharges.$inferSelect, amount: number): Promise<void> {
  const paid = await clearedOnCharge(tx, line.id);
  if (paid + amount > line.totalPaise) {
    throw ApiError.conflict("CHARGE_CAP_EXCEEDED", `${line.name} total ${formatINR(line.totalPaise)}; already received ${formatINR(paid)}; cannot accept ${formatINR(amount)}`, { other_charge_id: line.id, total_paise: line.totalPaise, paid_paise: paid, amount_paise: amount });
  }
}

/** Applies a CLEARED payment to the ledger and summary (shared by posting and clearing). */
async function applyCleared(tx: Tx, b: BookingRecord, p: PaymentRecord, at: Date): Promise<number> {
  let seq: number;
  if (p.against === "FLAT_VALUE") {
    seq = (await appendEvent(tx, b.id, events.payment(p, at))).row.seq;
  } else {
    const [line] = await tx.select().from(bookingOtherCharges).where(eq(bookingOtherCharges.id, p.otherChargeId!)).limit(1);
    seq = (await appendEvent(tx, b.id, events.otherChargePayment(p, line?.name ?? "Other charge", at))).row.seq;
    await tx.update(bookingOtherCharges).set({ paidPaise: sql`${bookingOtherCharges.paidPaise} + ${p.amountPaise}` }).where(eq(bookingOtherCharges.id, p.otherChargeId!));
  }
  await tx.update(bookings).set({ lastPaymentAt: at }).where(eq(bookings.id, b.id));
  await recomputeDemandStatuses(tx, b.id);
  return seq;
}

/** Posting result (payment id + the ledger seq it produced). */
export interface PostResult { paymentId: string; ledgerSeq: number | null }

/** POSTING ALGORITHM (one transaction; Idempotency-Key enforced by the route). */
export async function postPayment(db: DB, user: StaffContext, body: PaymentCreate, actor: MoneyActor, idempotencyKey: string | null): Promise<PostResult> {
  const today = todayDate();
  return db.transaction(async (tx) => {
    const b = await loadBooking(tx, user.companyId, body.booking_id, true);
    ensureProjectAccess(user, b.projectId, "Booking");
    if (b.status !== "ACTIVE") throw ApiError.conflict("BOOKING_NOT_ACTIVE", `Booking ${b.bookingNumber} is ${b.status.toLowerCase()}; payments are no longer accepted`, { status: b.status });
    await lockBooking(tx, b.id);
    if (body.payment_date > today) throw ApiError.rule("Payment date cannot be in the future", "PAYMENT_DATE_FUTURE", { today });
    if (body.payment_date < b.bookingDate) throw ApiError.rule("Payment date cannot be before the booking date", "PAYMENT_DATE_BEFORE_BOOKING", { booking_date: b.bookingDate });
    const [mode] = await tx.select().from(paymentModes).where(and(eq(paymentModes.id, body.payment_mode_id), eq(paymentModes.companyId, user.companyId))).limit(1);
    if (!mode) throw ApiError.badRequest("payment_mode_id does not exist", { field: "payment_mode_id" });
    if (!mode.isActive) throw ApiError.rule(`Payment mode ${mode.name} is inactive`, "PAYMENT_MODE_INACTIVE");
    if (mode.requiresInstrument) {
      if (!body.instrument?.number) throw ApiError.badRequest(`${mode.name} needs an instrument reference number`, { field: "instrument.number" });
      if (!mode.clearsImmediately && !body.instrument.date) throw ApiError.badRequest(`${mode.name} needs the instrument date`, { field: "instrument.date" });
    }
    let bankAccountId: string | null = null;
    if (!mode.isCash) {
      if (!body.bank_account_id) throw ApiError.badRequest("Pick the company bank account credited for non-cash payments", { field: "bank_account_id" });
      const [acct] = await tx.select({ id: bankAccounts.id, isActive: bankAccounts.isActive }).from(bankAccounts).where(and(eq(bankAccounts.id, body.bank_account_id), eq(bankAccounts.companyId, user.companyId))).limit(1);
      if (!acct) throw ApiError.badRequest("bank_account_id does not exist", { field: "bank_account_id" });
      if (!acct.isActive) throw ApiError.rule("Bank account is inactive", "BANK_ACCOUNT_INACTIVE");
      bankAccountId = acct.id;
    }
    let line: typeof bookingOtherCharges.$inferSelect | null = null;
    if (body.against === "FLAT_VALUE") {
      await assertBucketCap(tx, b, body.bucket!, body.amount_paise);
    } else {
      const [l] = await tx.select().from(bookingOtherCharges).where(and(eq(bookingOtherCharges.id, body.other_charge_id!), eq(bookingOtherCharges.bookingId, b.id))).limit(1);
      if (!l) throw ApiError.badRequest("other_charge_id does not belong to this booking", { field: "other_charge_id" });
      await assertChargeCap(tx, l, body.amount_paise);
      line = l;
    }
    // validation passed → the receipt number is allocated (numbers are never burnt by rejected postings)
    const company = await loadCompanyRow(tx, user.companyId);
    const receiptNumber = await nextNumber(tx, numberingOf(company), "receipt", body.payment_date);
    const clock = new Clock();
    const postedAt = clock.next();
    const cleared = mode.clearsImmediately;
    const [p] = await tx.insert(payments).values({
      companyId: b.companyId, bookingId: b.id, projectId: b.projectId, blockId: b.blockId, customerId: b.customerId, receiptNumber, against: body.against,
      bucket: body.against === "FLAT_VALUE" ? body.bucket! : null, otherChargeId: line?.id ?? null, amountPaise: body.amount_paise, paymentDate: body.payment_date,
      paymentModeId: mode.id, modeCode: mode.code, instrument: body.instrument ?? null, bankAccountId, remarks: body.remarks ?? null, receivedBy: user.id,
      status: cleared ? "CLEARED" : "PENDING", clearedAt: cleared ? postedAt : null, clearedBy: cleared ? user.id : null, postedAt, idempotencyKey, createdBy: user.id,
    }).returning();
    if (!p) throw new Error("payment insert returned no row");
    let ledgerSeq: number | null = null;
    if (cleared) {
      ledgerSeq = await applyCleared(tx, b, p, postedAt);
    } else {
      await tx.update(bookings).set({ pendingChequesPaise: sql`${bookings.pendingChequesPaise} + ${p.amountPaise}` }).where(eq(bookings.id, b.id));
    }
    await writeAudit(tx, { companyId: b.companyId, actor, action: "payment.post", entityType: "payment", entityId: p.id, after: { receipt_number: receiptNumber, booking_id: b.id, against: p.against, bucket: p.bucket, amount_paise: p.amountPaise, payment_date: p.paymentDate, mode_code: p.modeCode, status: p.status, instrument: p.instrument }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
    await notify(tx, { companyId: b.companyId, recipients: await bookingRecipients(tx, b), type: "PAYMENT_RECEIVED", title: `Payment of ${formatINR(p.amountPaise)} received (receipt ${receiptNumber})`, body: cleared ? `${mode.name} – ${p.bucket ?? line?.name ?? ""}`.trim() : `${mode.name} – subject to realisation`, entityType: "payment", entityId: p.id, link: `/bookings/${b.id}/payments` });
    return { paymentId: p.id, ledgerSeq };
  });
}

/** Loads a payment of the company inside the user's scope, locked, with its booking. */
async function loadPaymentForUpdate(tx: Tx, user: StaffContext, id: string): Promise<{ p: PaymentRecord; b: BookingRecord }> {
  const [p] = await tx.select().from(payments).where(and(eq(payments.id, id), eq(payments.companyId, user.companyId))).limit(1).for("update");
  if (!p) throw ApiError.notFound("Payment");
  ensureProjectAccess(user, p.projectId, "Payment");
  const b = await loadBooking(tx, user.companyId, p.bookingId, true);
  await lockBooking(tx, b.id);
  return { p, b };
}

/** PENDING → CLEARED (bucket cap re-checked at clearing). */
export async function clearPayment(db: DB, user: StaffContext, id: string, body: PaymentClear, actor: MoneyActor): Promise<void> {
  await db.transaction(async (tx) => {
    const { p, b } = await loadPaymentForUpdate(tx, user, id);
    if (p.status !== "PENDING") throw ApiError.conflict("PAYMENT_NOT_PENDING", `Receipt ${p.receiptNumber} is ${p.status.toLowerCase()}, not pending`, { status: p.status });
    if (b.status !== "ACTIVE") throw ApiError.conflict("BOOKING_NOT_ACTIVE", `Booking ${b.bookingNumber} is ${b.status.toLowerCase()}`, { status: b.status });
    if (p.against === "FLAT_VALUE") await assertBucketCap(tx, b, p.bucket!, p.amountPaise);
    else {
      const [line] = await tx.select().from(bookingOtherCharges).where(eq(bookingOtherCharges.id, p.otherChargeId!)).limit(1);
      if (line) await assertChargeCap(tx, line, p.amountPaise);
    }
    const clearedAt = new Clock().next();
    const updated = await applyUpdate(tx, payments, p.id, body.version, { status: "CLEARED", clearedAt, clearedBy: user.id, remarks: body.remarks ?? p.remarks }, "payment");
    await tx.update(bookings).set({ pendingChequesPaise: sql`greatest(0, ${bookings.pendingChequesPaise} - ${p.amountPaise})` }).where(eq(bookings.id, b.id));
    await applyCleared(tx, b, updated, clearedAt);
    await writeAudit(tx, { companyId: b.companyId, actor, action: "payment.clear", entityType: "payment", entityId: p.id, before: { status: "PENDING" }, after: { status: "CLEARED", cleared_on: body.cleared_on ?? todayDate() }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
    await notify(tx, { companyId: b.companyId, recipients: await bookingRecipients(tx, b), type: "PAYMENT_RECEIVED", title: `Receipt ${p.receiptNumber} realised`, body: `${formatINR(p.amountPaise)} has been credited`, entityType: "payment", entityId: p.id, link: `/bookings/${b.id}/payments` });
  });
}

/** PENDING → BOUNCED (never counts; Accounts notified). */
export async function bouncePayment(db: DB, user: StaffContext, id: string, body: PaymentBounce, actor: MoneyActor): Promise<void> {
  await db.transaction(async (tx) => {
    const { p, b } = await loadPaymentForUpdate(tx, user, id);
    if (p.status !== "PENDING") throw ApiError.conflict("PAYMENT_NOT_PENDING", `Receipt ${p.receiptNumber} is ${p.status.toLowerCase()}, not pending`, { status: p.status });
    await applyUpdate(tx, payments, p.id, body.version, { status: "BOUNCED", bouncedAt: new Date(), bouncedBy: user.id, bounceReason: body.reason, receiptCancelled: true }, "payment");
    await tx.update(bookings).set({ pendingChequesPaise: sql`greatest(0, ${bookings.pendingChequesPaise} - ${p.amountPaise})` }).where(eq(bookings.id, b.id));
    await writeAudit(tx, { companyId: b.companyId, actor, action: "payment.bounce", entityType: "payment", entityId: p.id, before: { status: "PENDING" }, after: { status: "BOUNCED", reason: body.reason }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
    await notifyRole(tx, b.companyId, ACCOUNTS_ROLES, { type: "CHEQUE_BOUNCED", title: `Cheque bounced on ${b.bookingNumber} (${p.receiptNumber})`, body: `${formatINR(p.amountPaise)} – ${body.reason}`, entityType: "payment", entityId: p.id, link: `/bookings/${b.id}/payments` });
    await notify(tx, { companyId: b.companyId, recipients: await bookingRecipients(tx, b), type: "CHEQUE_BOUNCED", title: `Your instrument ${p.instrument?.number ?? ""} was returned unpaid`.trim(), body: body.reason, entityType: "payment", entityId: p.id, link: `/bookings/${b.id}/payments` });
  });
}

/** CLEARED → REVERSED: negative REVERSAL row, summary decremented, receipt cancelled (never deleted). */
export async function reversePayment(db: DB, user: StaffContext, id: string, body: PaymentReverse, actor: MoneyActor): Promise<void> {
  await db.transaction(async (tx) => {
    const { p, b } = await loadPaymentForUpdate(tx, user, id);
    if (p.status !== "CLEARED") throw ApiError.conflict("PAYMENT_NOT_CLEARED", `Receipt ${p.receiptNumber} is ${p.status.toLowerCase()}; only cleared payments can be reversed`, { status: p.status });
    // a cancelled booking's ledger is closed (SPEC §12): nothing more can be appended to it
    if (b.status === "CANCELLED") throw ApiError.conflict("BOOKING_NOT_ACTIVE", `Booking ${b.bookingNumber} is cancelled; its ledger is closed`, { status: b.status });
    const reversedAt = new Clock().next();
    const updated = await applyUpdate(tx, payments, p.id, body.version, { status: "REVERSED", reversedAt, reversedBy: user.id, reversalReason: body.reason, receiptCancelled: true }, "payment");
    if (p.against === "FLAT_VALUE") {
      await appendEvent(tx, b.id, events.reversal(updated, reversedAt));
    } else {
      await appendEvent(tx, b.id, events.otherChargeReversal(updated, reversedAt));
      await tx.update(bookingOtherCharges).set({ paidPaise: sql`greatest(0, ${bookingOtherCharges.paidPaise} - ${p.amountPaise})` }).where(eq(bookingOtherCharges.id, p.otherChargeId!));
    }
    await recomputeDemandStatuses(tx, b.id);
    await writeAudit(tx, { companyId: b.companyId, actor, action: "payment.reverse", entityType: "payment", entityId: p.id, before: { status: "CLEARED" }, after: { status: "REVERSED", reason: body.reason, receipt_cancelled: true }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
    await notifyRole(tx, b.companyId, ACCOUNTS_ROLES, { type: "PAYMENT_RECEIVED", title: `Receipt ${p.receiptNumber} reversed on ${b.bookingNumber}`, body: `${formatINR(p.amountPaise)} – ${body.reason}`, entityType: "payment", entityId: p.id, link: `/bookings/${b.id}/payments` });
  });
}

/** Data behind the printable receipt (company letterhead, amount in words, realisation / cancelled flags). */
export async function receiptData(db: Executor, user: StaffContext, paymentId: string): Promise<ReceiptData> {
  const rows = await db
    .select({ p: payments, c: customers, b: bookings, projectName: projects.name, blockName: blocks.name, flatNumber: flats.flatNumber, modeName: paymentModes.name, receivedBy: users.name, bankName: bankAccounts.bankName, bankLast4: bankAccounts.accountNumberLast4, chargeName: bookingOtherCharges.name, co: companies })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .innerJoin(projects, eq(projects.id, payments.projectId))
    .innerJoin(blocks, eq(blocks.id, payments.blockId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .innerJoin(paymentModes, eq(paymentModes.id, payments.paymentModeId))
    .innerJoin(companies, eq(companies.id, payments.companyId))
    .leftJoin(users, eq(users.id, payments.receivedBy))
    .leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId))
    .leftJoin(bookingOtherCharges, eq(bookingOtherCharges.id, payments.otherChargeId))
    .where(and(eq(payments.id, paymentId), eq(payments.companyId, user.companyId)))
    .limit(1);
  const r = rows[0];
  if (!r) throw ApiError.notFound("Payment");
  ensureProjectAccess(user, r.p.projectId, "Payment");
  const lh = r.co.letterhead;
  return {
    receipt_number: r.p.receiptNumber, payment_id: r.p.id, status: r.p.status, is_cancelled: r.p.receiptCancelled, subject_to_realisation: r.p.status === "PENDING", payment_date: r.p.paymentDate,
    customer_name: r.c.fullName, customer_address: formatAddress(r.c.addressCurrent), booking_number: r.b.bookingNumber, project_name: r.projectName, block_name: r.blockName, flat_number: r.flatNumber,
    against: r.p.against, bucket: r.p.bucket, other_charge_name: r.chargeName ?? null, amount_paise: r.p.amountPaise, amount_words: amountInWords(r.p.amountPaise), mode_name: r.modeName,
    instrument: r.p.instrument?.number ? { number: r.p.instrument.number, date: r.p.instrument.date ?? null, bank_name: r.p.instrument.bank_name ?? null } : null,
    bank_account_label: bankLabel(r.bankName, r.bankLast4), received_by_name: r.receivedBy ?? null, remarks: r.p.remarks,
    company: { name: r.co.name, legal_name: r.co.legalName, address: formatAddress(r.co.address), phone: lh.phone ?? r.co.phone, email: lh.email ?? r.co.email, gstin: r.co.gstin, signatory_name: lh.signatory_name ?? null, signatory_title: lh.signatory_title ?? null },
  };
}

/** Data behind a demand letter: both buckets, due date, the default company bank account (full number, decrypted) for Account transfers. */
export async function demandLetterData(db: Executor, user: StaffContext, bookingId: string, demandId: string): Promise<DemandLetterData> {
  const rows = await db
    .select({ d: demands, c: customers, b: bookings, projectName: projects.name, blockName: blocks.name, flatNumber: flats.flatNumber })
    .from(demands)
    .innerJoin(customers, eq(customers.id, demands.customerId))
    .innerJoin(bookings, eq(bookings.id, demands.bookingId))
    .innerJoin(projects, eq(projects.id, demands.projectId))
    .innerJoin(blocks, eq(blocks.id, demands.blockId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .where(and(eq(demands.id, demandId), eq(demands.bookingId, bookingId), eq(demands.companyId, user.companyId)))
    .limit(1);
  const r = rows[0];
  if (!r) throw ApiError.notFound("Demand");
  ensureProjectAccess(user, r.d.projectId, "Demand");
  const [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, user.companyId), eq(bankAccounts.isDefault, true), eq(bankAccounts.isActive, true))).limit(1);
  let account: string | null = null;
  if (bank) { try { account = decryptField(bank.accountNumberEnc); } catch { account = null; } }
  return {
    demand_number: r.d.demandNumber, demand_date: r.d.demandDate, due_date: r.d.dueDate, customer_name: r.c.fullName, customer_address: formatAddress(r.c.addressCurrent),
    booking_number: r.b.bookingNumber, project_name: r.projectName, block_name: r.blockName, flat_number: r.flatNumber, installment_name: r.d.installmentName, trigger_label: r.d.triggerLabel ?? "",
    percent: Number(r.d.percent), cash_demand_paise: r.d.cashDemandPaise, account_demand_paise: r.d.accountDemandPaise, total_demand_paise: r.d.totalDemandPaise, total_words: amountInWords(r.d.totalDemandPaise),
    cash_due_paise: r.b.cashOrderRaisedPaise - r.b.cashPaidPaise, account_due_paise: r.b.accountOrderRaisedPaise - r.b.accountPaidPaise,
    bank: bank && account ? { bank_name: bank.bankName, branch: bank.branch, account_name: bank.accountName, account_number: account, ifsc: bank.ifsc } : null,
  };
}
