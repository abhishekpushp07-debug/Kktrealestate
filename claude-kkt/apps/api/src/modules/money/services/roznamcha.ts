/**
 * Roznamcha (day book, SPEC §11): opening cash in hand carried from every prior day (Σ cleared CASH-mode receipts − Σ deposits + Σ withdrawals),
 * the range's cleared receipts grouped by mode / category / project, contra entries and the closing cash in hand.
 */
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { ContraEntryCreate, ContraEntryRow, MoneyCategory, PaymentModeCode, RoznamchaReceiptRow, RoznamchaResponse } from "@kkt/contracts";
import { bankAccounts, blocks, bookings, contraEntries, customers, flats, paymentModes, payments, projects, users, type DB, type Executor } from "@kkt/db";
import { formatINR } from "@kkt/domain";
import { writeAudit } from "../../../lib/audit.js";
import { ApiError } from "../../../lib/errors.js";
import { scopeFilter, type StaffContext } from "../../../lib/scope.js";
import type { MoneyActor } from "../common.js";
import { bankLabel } from "./views.js";

/** Cash in hand before `date` (exclusive): cleared cash receipts − deposits + withdrawals dated earlier. */
export async function cashInHandBefore(db: Executor, companyId: string, date: string): Promise<number> {
  const [r] = await db.execute<{ cash: string; dep: string; wd: string }>(sql`
    select (select coalesce(sum(p.amount_paise), 0) from payments p join payment_modes m on m.id = p.payment_mode_id
             where p.company_id = ${companyId}::uuid and p.status = 'CLEARED' and m.is_cash and p.payment_date < ${date}::date) as cash,
           (select coalesce(sum(amount_paise), 0) from contra_entries where company_id = ${companyId}::uuid and type = 'DEPOSIT' and entry_date < ${date}::date) as dep,
           (select coalesce(sum(amount_paise), 0) from contra_entries where company_id = ${companyId}::uuid and type = 'WITHDRAWAL' and entry_date < ${date}::date) as wd`);
  return Number(r?.cash ?? 0) - Number(r?.dep ?? 0) + Number(r?.wd ?? 0);
}

/** Cash in hand at the end of `date` (inclusive). */
export async function cashInHandThrough(db: Executor, companyId: string, date: string): Promise<number> {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return cashInHandBefore(db, companyId, next.toISOString().slice(0, 10));
}

function categoryOf(p: { against: "FLAT_VALUE" | "OTHER_CHARGE"; bucket: "CASH" | "ACCOUNT" | null }): MoneyCategory {
  if (p.against === "OTHER_CHARGE") return "OTHER";
  return p.bucket === "ACCOUNT" ? "ACCOUNT" : "CASH";
}

export function toContraRow(c: typeof contraEntries.$inferSelect, bank: { name: string; last4: string } | undefined, byName: string | null): ContraEntryRow {
  return { id: c.id, entry_date: c.entryDate, type: c.type, amount_paise: c.amountPaise, bank_account_id: c.bankAccountId ?? "", bank_account_label: bank ? (bankLabel(bank.name, bank.last4) ?? "") : "", remarks: c.remarks, by_user_id: c.byUserId, by_user_name: byName, created_at: c.createdAt.toISOString() };
}

/** Contra entries of a date range with bank labels and user names. */
export async function contraRows(db: Executor, companyId: string, from: string, to: string): Promise<ContraEntryRow[]> {
  const rows = await db.select({ c: contraEntries, bankName: bankAccounts.bankName, last4: bankAccounts.accountNumberLast4, byName: users.name }).from(contraEntries)
    .leftJoin(bankAccounts, eq(bankAccounts.id, contraEntries.bankAccountId)).leftJoin(users, eq(users.id, contraEntries.byUserId))
    .where(and(eq(contraEntries.companyId, companyId), gte(contraEntries.entryDate, from), lte(contraEntries.entryDate, to))).orderBy(asc(contraEntries.entryDate), asc(contraEntries.createdAt));
  return rows.map((r) => toContraRow(r.c, r.bankName ? { name: r.bankName, last4: r.last4 ?? "" } : undefined, r.byName ?? null));
}

/** The day book for a date range (project filter applies to receipts; cash in hand is the company's single till). */
export async function roznamcha(db: Executor, user: StaffContext, from: string, to: string, projectId: string | undefined): Promise<RoznamchaResponse> {
  const companyId = user.companyId;
  const scope = scopeFilter(user, payments.projectId);
  const rows = await db
    .select({ p: payments, customerName: customers.fullName, bookingNumber: bookings.bookingNumber, projectId: projects.id, projectName: projects.name, flatNumber: flats.flatNumber, modeName: paymentModes.name, isCash: paymentModes.isCash, bankName: bankAccounts.bankName, bankLast4: bankAccounts.accountNumberLast4 })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .innerJoin(projects, eq(projects.id, payments.projectId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .innerJoin(paymentModes, eq(paymentModes.id, payments.paymentModeId))
    .leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId))
    .where(and(eq(payments.companyId, companyId), eq(payments.status, "CLEARED"), gte(payments.paymentDate, from), lte(payments.paymentDate, to), projectId ? eq(payments.projectId, projectId) : undefined, scope))
    .orderBy(asc(payments.paymentDate), asc(payments.receiptNumber));
  const receipts: RoznamchaReceiptRow[] = rows.map((r) => ({
    payment_id: r.p.id, receipt_number: r.p.receiptNumber, payment_date: r.p.paymentDate, customer_name: r.customerName, booking_number: r.bookingNumber, project_name: r.projectName, flat_number: r.flatNumber,
    mode_code: r.p.modeCode as PaymentModeCode, mode_name: r.modeName, category: categoryOf(r.p), instrument_number: r.p.instrument?.number ?? null, bank_account_label: bankLabel(r.bankName, r.bankLast4), amount_paise: r.p.amountPaise,
  }));
  const byMode = new Map<string, { mode_code: PaymentModeCode; mode_name: string; count: number; amount_paise: number }>();
  const byCategory = new Map<MoneyCategory, { category: MoneyCategory; count: number; amount_paise: number }>();
  const byProject = new Map<string, { project_id: string; project_name: string; count: number; amount_paise: number }>();
  let cashReceived = 0;
  for (const [i, r] of rows.entries()) {
    const rec = receipts[i]!;
    if (r.isCash) cashReceived += r.p.amountPaise;
    const m = byMode.get(rec.mode_code) ?? { mode_code: rec.mode_code, mode_name: rec.mode_name, count: 0, amount_paise: 0 };
    m.count += 1; m.amount_paise += rec.amount_paise; byMode.set(rec.mode_code, m);
    const c = byCategory.get(rec.category) ?? { category: rec.category, count: 0, amount_paise: 0 };
    c.count += 1; c.amount_paise += rec.amount_paise; byCategory.set(rec.category, c);
    const pj = byProject.get(r.projectId) ?? { project_id: r.projectId, project_name: r.projectName, count: 0, amount_paise: 0 };
    pj.count += 1; pj.amount_paise += rec.amount_paise; byProject.set(r.projectId, pj);
  }
  const contra = await contraRows(db, companyId, from, to);
  const deposited = contra.filter((c) => c.type === "DEPOSIT").reduce((s, c) => s + c.amount_paise, 0);
  const withdrawn = contra.filter((c) => c.type === "WITHDRAWAL").reduce((s, c) => s + c.amount_paise, 0);
  const opening = await cashInHandBefore(db, companyId, from);
  // cash in hand is one till: recompute the day's cash from every cleared cash receipt (not only the filtered project's)
  const [allCash] = projectId || scope
    ? await db.select({ n: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` }).from(payments).innerJoin(paymentModes, eq(paymentModes.id, payments.paymentModeId))
      .where(and(eq(payments.companyId, companyId), eq(payments.status, "CLEARED"), eq(paymentModes.isCash, true), gte(payments.paymentDate, from), lte(payments.paymentDate, to)))
    : [{ n: String(cashReceived) }];
  const tillCash = Number(allCash?.n ?? cashReceived);
  const [pending] = await db.select({ n: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` }).from(payments)
    .where(and(eq(payments.companyId, companyId), eq(payments.status, "PENDING"), lte(payments.paymentDate, to), projectId ? eq(payments.projectId, projectId) : undefined, scope));
  return {
    from, to, project_id: projectId ?? null,
    opening_cash_paise: opening, cash_received_paise: cashReceived, cash_deposited_paise: deposited, cash_withdrawn_paise: withdrawn,
    closing_cash_paise: opening + tillCash - deposited + withdrawn,
    receipts, by_mode: [...byMode.values()], by_category: [...byCategory.values()], by_project: [...byProject.values()], contra_entries: contra,
    totals: { receipts_count: receipts.length, receipts_paise: receipts.reduce((s, r) => s + r.amount_paise, 0), pending_cheques_paise: Number(pending?.n ?? 0) },
  };
}

/** Records a contra entry; a deposit may not exceed the cash in hand at the end of that day (409 INSUFFICIENT_CASH). */
export async function createContra(db: DB, user: StaffContext, body: ContraEntryCreate, actor: MoneyActor): Promise<string> {
  return db.transaction(async (tx) => {
    const [acct] = await tx.select({ id: bankAccounts.id, isActive: bankAccounts.isActive }).from(bankAccounts).where(and(eq(bankAccounts.id, body.bank_account_id), eq(bankAccounts.companyId, user.companyId))).limit(1);
    if (!acct) throw ApiError.badRequest("bank_account_id does not exist", { field: "bank_account_id" });
    if (!acct.isActive) throw ApiError.rule("Bank account is inactive", "BANK_ACCOUNT_INACTIVE");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`contra:${user.companyId}`}))`);
    if (body.type === "DEPOSIT") {
      const inHand = await cashInHandThrough(tx, user.companyId, body.entry_date);
      if (body.amount_paise > inHand) throw ApiError.conflict("INSUFFICIENT_CASH", `Cash in hand on ${body.entry_date} is ${formatINR(inHand)}; cannot deposit ${formatINR(body.amount_paise)}`, { cash_in_hand_paise: inHand, amount_paise: body.amount_paise });
    }
    const [row] = await tx.insert(contraEntries).values({ companyId: user.companyId, entryDate: body.entry_date, type: body.type, amountPaise: body.amount_paise, bankAccountId: acct.id, remarks: body.remarks ?? null, byUserId: user.id }).returning({ id: contraEntries.id });
    if (!row) throw new Error("contra insert returned no row");
    await writeAudit(tx, { companyId: user.companyId, actor, action: "contra.create", entityType: "contra_entry", entityId: row.id, after: { ...body }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
    return row.id;
  });
}

/** One contra entry (wire row). */
export async function contraRow(db: Executor, companyId: string, id: string): Promise<ContraEntryRow> {
  const [r] = await db.select({ c: contraEntries, bankName: bankAccounts.bankName, last4: bankAccounts.accountNumberLast4, byName: users.name }).from(contraEntries)
    .leftJoin(bankAccounts, eq(bankAccounts.id, contraEntries.bankAccountId)).leftJoin(users, eq(users.id, contraEntries.byUserId))
    .where(and(eq(contraEntries.id, id), eq(contraEntries.companyId, companyId))).limit(1);
  if (!r) throw ApiError.notFound("Contra entry");
  return toContraRow(r.c, r.bankName ? { name: r.bankName, last4: r.last4 ?? "" } : undefined, r.byName ?? null);
}

export { blocks, inArray, lt };
