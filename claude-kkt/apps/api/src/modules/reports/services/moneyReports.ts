/**
 * Money reports (SPEC §14): collections, outstanding & ageing, advances, demand vs collection, upcoming dues forecast, cheques,
 * cancellations & refunds, bank-wise receipts. Every figure is derived from the same source rows the ledger uses (payments, demands,
 * booking summary columns) so the reports reconcile with the ledger by construction:
 *   collections  = Σ CLEARED payments (PENDING / BOUNCED / REVERSED never count; a reversed payment is simply no longer CLEARED)
 *   outstanding  = Σ over ACTIVE bookings of the positive part of each bucket's due (raised − paid)
 *   advances     = Σ of the negative parts (money received ahead of the raised demands)
 *   ageing       = remaining (total − paid) of every open demand bucketed by due date (domain ageingBucket), which sums to outstanding
 */
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type {
  AdvancesReportQuery, AdvancesReportResponse, AdvancesReportRow, AgeingAmounts, AgeingBucket, BankwiseReceiptsQuery, BankwiseReceiptsResponse, CancellationsReportQuery, CancellationsReportResponse,
  CancellationsReportRow, ChequeRow, ChequesReportQuery, ChequesReportResponse, CollectionsReportQuery, CollectionsReportResponse, CollectionsReportRow, DemandVsCollectionQuery, DemandVsCollectionResponse,
  DemandVsCollectionRow, MoneyTotals, OutstandingReportQuery, OutstandingReportResponse, OutstandingReportRow, PaymentModeCode, TopOverdueRow, TriggerType, UpcomingDuesQuery, UpcomingDuesResponse, UpcomingDuesRow,
} from "@kkt/contracts";
import { bankAccounts, blockStages, blocks, bookingOtherCharges, bookings, customers, demands, flats, payments, projects, type Executor } from "@kkt/db";
import { addDays, ageingBucket, compareDates, diffDays, formatDateLabel, schedulePreview, type TowerStage } from "@kkt/domain";
import { paginate } from "../../../lib/list.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../../lib/scope.js";
import { snapshotInstallments } from "../../money/common.js";
import { PAYMENT_SELECT, paymentJoins, toPaymentRow, type PaymentSelect } from "../../money/services/views.js";
import { groupBy, monthKey, percentOf, reportPaging, sumBy, today as todayDate, weekStart } from "../common.js";

type Scope = Pick<StaffContext, "companyId" | "allProjects" | "projectIds">;

function defined(conds: (SQL | undefined)[]): SQL | undefined {
  const list = conds.filter((c): c is SQL => c !== undefined);
  return list.length ? and(...list) : undefined;
}

function emptyAgeing(): AgeingAmounts {
  return { NOT_DUE: 0, D0_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0 };
}

function emptyTotals(): MoneyTotals {
  return { cash_paise: 0, account_paise: 0, other_paise: 0, gst_paise: 0, total_paise: 0, count: 0 };
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/** Collections by day/week/month with mode, category, status and project/block filters; GST on other-charge payments is the pro-rata share of the line's GST. */
export async function collectionsReport(db: Executor, user: Scope, q: CollectionsReportQuery): Promise<CollectionsReportResponse> {
  if (q.project_id) ensureProjectAccess(user, q.project_id);
  const periodExpr =
    q.group_by === "DAY" ? sql<string>`to_char(${payments.paymentDate}, 'YYYY-MM-DD')`
    : q.group_by === "WEEK" ? sql<string>`to_char(date_trunc('week', ${payments.paymentDate}), 'YYYY-MM-DD')`
    : sql<string>`to_char(date_trunc('month', ${payments.paymentDate}), 'YYYY-MM-DD')`;
  const gstExpr = sql<string>`coalesce(sum(case when ${payments.against} = 'OTHER_CHARGE' then round(${payments.amountPaise}::numeric * ${bookingOtherCharges.gstPaise} / nullif(${bookingOtherCharges.totalPaise}, 0)) else 0 end), 0)`;
  const where = defined([
    eq(payments.companyId, user.companyId),
    eq(payments.status, q.status),
    gte(payments.paymentDate, q.from),
    lte(payments.paymentDate, q.to),
    scopeFilter(user, payments.projectId),
    q.project_id ? eq(payments.projectId, q.project_id) : undefined,
    q.block_id ? eq(payments.blockId, q.block_id) : undefined,
    q.mode_code ? eq(payments.modeCode, q.mode_code) : undefined,
    q.category === "CASH" ? and(eq(payments.against, "FLAT_VALUE"), eq(payments.bucket, "CASH")) : undefined,
    q.category === "ACCOUNT" ? and(eq(payments.against, "FLAT_VALUE"), eq(payments.bucket, "ACCOUNT")) : undefined,
    q.category === "OTHER" ? eq(payments.against, "OTHER_CHARGE") : undefined,
  ]);
  const agg = await db
    .select({ periodStart: periodExpr, against: payments.against, bucket: payments.bucket, modeCode: payments.modeCode, amount: sql<string>`coalesce(sum(${payments.amountPaise}), 0)`, n: sql<number>`count(*)::int`, gst: gstExpr })
    .from(payments)
    .leftJoin(bookingOtherCharges, eq(bookingOtherCharges.id, payments.otherChargeId))
    .where(where)
    .groupBy(periodExpr, payments.against, payments.bucket, payments.modeCode)
    .orderBy(periodExpr);
  const byPeriod = groupBy(agg, (r) => r.periodStart);
  const rows: CollectionsReportRow[] = [];
  const totals = emptyTotals();
  for (const [periodStart, parts] of byPeriod) {
    const row: CollectionsReportRow = { period: periodLabel(q.group_by, periodStart), period_start: periodStart, cash_paise: 0, account_paise: 0, other_paise: 0, gst_paise: 0, total_paise: 0, count: 0, by_mode: [] };
    const modes = new Map<string, { mode_code: PaymentModeCode; amount_paise: number; count: number }>();
    for (const p of parts) {
      const amount = Number(p.amount);
      if (p.against === "OTHER_CHARGE") { row.other_paise += amount; row.gst_paise += Number(p.gst); }
      else if (p.bucket === "ACCOUNT") row.account_paise += amount;
      else row.cash_paise += amount;
      row.total_paise += amount;
      row.count += Number(p.n);
      const m = modes.get(p.modeCode) ?? { mode_code: p.modeCode as PaymentModeCode, amount_paise: 0, count: 0 };
      m.amount_paise += amount; m.count += Number(p.n); modes.set(p.modeCode, m);
    }
    row.by_mode = [...modes.values()].sort((a, b) => b.amount_paise - a.amount_paise);
    rows.push(row);
    totals.cash_paise += row.cash_paise; totals.account_paise += row.account_paise; totals.other_paise += row.other_paise; totals.gst_paise += row.gst_paise; totals.total_paise += row.total_paise; totals.count += row.count;
  }
  return { query: q, rows, totals };
}

function periodLabel(groupBy: CollectionsReportQuery["group_by"], start: string): string {
  if (groupBy === "DAY") return start;
  if (groupBy === "WEEK") return `Week of ${formatDateLabel(start)}`;
  return monthKey(start);
}

/** Σ CLEARED payments in a date range (project scope applied) – the dashboard figure. */
export async function clearedTotal(db: Executor, user: Scope, from: string, to: string, extra: SQL[] = []): Promise<{ count: number; amount_paise: number }> {
  const [r] = await db.select({ n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` }).from(payments)
    .where(defined([eq(payments.companyId, user.companyId), eq(payments.status, "CLEARED"), gte(payments.paymentDate, from), lte(payments.paymentDate, to), scopeFilter(user, payments.projectId), ...extra]));
  return { count: Number(r?.n ?? 0), amount_paise: Number(r?.amount ?? 0) };
}

// ---------------------------------------------------------------------------
// Outstanding & ageing / advances (shared booking + demand loaders)
// ---------------------------------------------------------------------------

interface BookingDue {
  id: string; bookingNumber: string; projectId: string; projectName: string; blockId: string; blockName: string; flatNumber: string;
  customerId: string; customerName: string; customerPhone: string; cashDue: number; accountDue: number; bookingDate: string;
  cashAgreed: number; accountAgreed: number; planSnapshot: typeof bookings.$inferSelect["planSnapshot"];
}

/** ACTIVE bookings in scope with their derived bucket dues (one joined query). */
async function activeBookingDues(db: Executor, user: Scope, f: { project_id?: string | undefined; block_id?: string | undefined; customer_id?: string | undefined }): Promise<BookingDue[]> {
  if (f.project_id) ensureProjectAccess(user, f.project_id);
  const rows = await db
    .select({
      id: bookings.id, bookingNumber: bookings.bookingNumber, projectId: bookings.projectId, projectName: projects.name, blockId: bookings.blockId, blockName: blocks.name, flatNumber: flats.flatNumber,
      customerId: bookings.customerId, customerName: customers.fullName, customerPhone: customers.phone, bookingDate: bookings.bookingDate,
      cashRaised: bookings.cashOrderRaisedPaise, accountRaised: bookings.accountOrderRaisedPaise, cashPaid: bookings.cashPaidPaise, accountPaid: bookings.accountPaidPaise,
      cashAgreed: bookings.cashAgreedPaise, accountAgreed: bookings.accountAgreedPaise, planSnapshot: bookings.planSnapshot,
    })
    .from(bookings)
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(blocks, eq(blocks.id, bookings.blockId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(defined([
      eq(bookings.companyId, user.companyId), eq(bookings.status, "ACTIVE"), scopeFilter(user, bookings.projectId),
      f.project_id ? eq(bookings.projectId, f.project_id) : undefined, f.block_id ? eq(bookings.blockId, f.block_id) : undefined, f.customer_id ? eq(bookings.customerId, f.customer_id) : undefined,
    ]))
    .orderBy(asc(projects.name), asc(blocks.name), asc(flats.flatNumber));
  return rows.map((r) => ({ ...r, cashDue: r.cashRaised - r.cashPaid, accountDue: r.accountRaised - r.accountPaid }));
}

interface OpenDemand { bookingId: string; dueDate: string; remaining: number; installmentName: string }

/** Open (OPEN / PARTIALLY_PAID) demands of the given bookings with their remaining amount. */
async function openDemands(db: Executor, bookingIds: readonly string[]): Promise<OpenDemand[]> {
  if (bookingIds.length === 0) return [];
  const rows = await db
    .select({ bookingId: demands.bookingId, dueDate: demands.dueDate, total: demands.totalDemandPaise, paid: demands.paidPaise, installmentName: demands.installmentName })
    .from(demands)
    .where(and(inArray(demands.bookingId, [...bookingIds]), inArray(demands.status, ["OPEN", "PARTIALLY_PAID"])))
    .orderBy(asc(demands.dueDate));
  return rows.map((r) => ({ bookingId: r.bookingId, dueDate: r.dueDate, remaining: Math.max(0, r.total - r.paid), installmentName: r.installmentName })).filter((r) => r.remaining > 0);
}

function addAgeing(target: AgeingAmounts, bucket: AgeingBucket, amount: number): void {
  target[bucket] += amount;
}

/** Outstanding & ageing per project / block / customer plus the top overdue customers. */
export async function outstandingReport(db: Executor, user: Scope, q: OutstandingReportQuery): Promise<OutstandingReportResponse> {
  const asOf = q.as_of ?? todayDate();
  const list = await activeBookingDues(db, user, q);
  const open = await openDemands(db, list.map((b) => b.id));
  const demandsByBooking = groupBy(open, (d) => d.bookingId);
  const keyOf = (b: BookingDue): { key_id: string; label: string } => {
    switch (q.group_by) {
      case "BLOCK": return { key_id: b.blockId, label: `${b.projectName} · ${b.blockName}` };
      case "CUSTOMER": return { key_id: b.customerId, label: b.customerName };
      default: return { key_id: b.projectId, label: b.projectName };
    }
  };
  const groups = new Map<string, OutstandingReportRow>();
  const totals: OutstandingReportResponse["totals"] = { bookings: 0, cash_due_paise: 0, account_due_paise: 0, total_due_paise: 0, ageing: emptyAgeing() };
  const overdue: TopOverdueRow[] = [];
  for (const b of list) {
    const k = keyOf(b);
    const row = groups.get(k.key_id) ?? { key_id: k.key_id, label: k.label, bookings: 0, cash_due_paise: 0, account_due_paise: 0, total_due_paise: 0, ageing: emptyAgeing() };
    const cash = Math.max(0, b.cashDue);
    const account = Math.max(0, b.accountDue);
    row.bookings += 1; row.cash_due_paise += cash; row.account_due_paise += account; row.total_due_paise += cash + account;
    totals.bookings += 1; totals.cash_due_paise += cash; totals.account_due_paise += account; totals.total_due_paise += cash + account;
    let overduePaise = 0;
    let oldest: string | null = null;
    for (const d of demandsByBooking.get(b.id) ?? []) {
      const bucket = ageingBucket(d.dueDate, asOf);
      addAgeing(row.ageing, bucket, d.remaining);
      addAgeing(totals.ageing, bucket, d.remaining);
      // "overdue" is exactly "not in the NOT_DUE bucket", so Σ top_overdue (untruncated) = Σ ageing buckets except NOT_DUE
      if (bucket !== "NOT_DUE") {
        overduePaise += d.remaining;
        if (!oldest || compareDates(d.dueDate, oldest) < 0) oldest = d.dueDate;
      }
    }
    groups.set(k.key_id, row);
    if (overduePaise > 0 && oldest) {
      overdue.push({
        booking_id: b.id, booking_number: b.bookingNumber, customer_id: b.customerId, customer_name: b.customerName, customer_phone: b.customerPhone, project_name: b.projectName, flat_number: b.flatNumber,
        overdue_paise: overduePaise, oldest_due_date: oldest, days_overdue: Math.max(0, diffDays(asOf, oldest)), bucket: ageingBucket(oldest, asOf),
      });
    }
  }
  overdue.sort((a, b) => b.overdue_paise - a.overdue_paise || a.oldest_due_date.localeCompare(b.oldest_due_date));
  return { as_of: asOf, rows: [...groups.values()].sort((a, b) => b.total_due_paise - a.total_due_paise || a.label.localeCompare(b.label)), totals, top_overdue: overdue.slice(0, q.top_n) };
}

/** Advances: bookings whose bucket due is negative (money received ahead of raised demands), with the next installment to be raised. */
export async function advancesReport(db: Executor, user: Scope, q: AdvancesReportQuery): Promise<AdvancesReportResponse> {
  const list = (await activeBookingDues(db, user, q)).filter((b) => (q.bucket === "CASH" ? b.cashDue < 0 : q.bucket === "ACCOUNT" ? b.accountDue < 0 : b.cashDue < 0 || b.accountDue < 0));
  const ids = list.map((b) => b.id);
  const raised = ids.length
    ? await db.select({ bookingId: demands.bookingId, seq: demands.installmentSeq }).from(demands).where(and(inArray(demands.bookingId, ids), sql`${demands.status} <> 'VOID'`))
    : [];
  const seqs = new Map<string, Set<number>>();
  for (const r of raised) { const s = seqs.get(r.bookingId) ?? new Set<number>(); s.add(r.seq); seqs.set(r.bookingId, s); }
  const rows: AdvancesReportRow[] = list.map((b) => {
    const done = seqs.get(b.id) ?? new Set<number>();
    const next = [...b.planSnapshot.installments].sort((x, y) => x.seq - y.seq).find((i) => !done.has(i.seq));
    const cash = q.bucket === "ACCOUNT" ? 0 : Math.max(0, -b.cashDue);
    const account = q.bucket === "CASH" ? 0 : Math.max(0, -b.accountDue);
    return { booking_id: b.id, booking_number: b.bookingNumber, customer_name: b.customerName, project_name: b.projectName, block_name: b.blockName, flat_number: b.flatNumber, cash_advance_paise: cash, account_advance_paise: account, total_advance_paise: cash + account, next_installment_name: next?.name ?? null };
  });
  rows.sort((a, b) => b.total_advance_paise - a.total_advance_paise);
  return { rows, totals: { cash_advance_paise: sumBy(rows, (r) => r.cash_advance_paise), account_advance_paise: sumBy(rows, (r) => r.account_advance_paise), total_advance_paise: sumBy(rows, (r) => r.total_advance_paise), count: rows.length } };
}

/** Advance total of the scope (dashboard figure). */
export async function advancesTotal(db: Executor, user: Scope, projectId?: string): Promise<number> {
  const list = await activeBookingDues(db, user, { project_id: projectId });
  return sumBy(list, (b) => Math.max(0, -b.cashDue) + Math.max(0, -b.accountDue));
}

// ---------------------------------------------------------------------------
// Demand vs collection
// ---------------------------------------------------------------------------

const TRIGGER_LABELS: Record<TriggerType, string> = { ON_BOOKING: "On booking", DAYS_AFTER_BOOKING: "Time-linked", ON_DATE: "Fixed date", ON_STAGE: "Stage", ON_POSSESSION: "Possession" };

/** Demanded vs collected per installment or per stage, per tower of a project (ACTIVE and COMPLETED bookings; cancelled/void demands excluded). */
export async function demandVsCollection(db: Executor, user: Scope, q: DemandVsCollectionQuery): Promise<DemandVsCollectionResponse> {
  ensureProjectAccess(user, q.project_id);
  const rows = await db
    .select({
      blockId: demands.blockId, blockName: blocks.name, blockSort: blocks.sortOrder, seq: demands.installmentSeq, name: demands.installmentName, triggerType: demands.triggerType, stageId: demands.triggerStageId,
      stageName: blockStages.name, stageSort: blockStages.sortOrder, n: sql<number>`count(*)::int`, demanded: sql<string>`coalesce(sum(${demands.totalDemandPaise}), 0)`, paid: sql<string>`coalesce(sum(${demands.paidPaise}), 0)`,
    })
    .from(demands)
    .innerJoin(blocks, eq(blocks.id, demands.blockId))
    .leftJoin(blockStages, and(eq(blockStages.blockId, demands.blockId), eq(blockStages.stageId, demands.triggerStageId)))
    .where(defined([eq(demands.companyId, user.companyId), eq(demands.projectId, q.project_id), q.block_id ? eq(demands.blockId, q.block_id) : undefined, inArray(demands.status, ["OPEN", "PARTIALLY_PAID", "PAID"])]))
    .groupBy(demands.blockId, blocks.name, blocks.sortOrder, demands.installmentSeq, demands.installmentName, demands.triggerType, demands.triggerStageId, blockStages.name, blockStages.sortOrder);
  const out = new Map<string, DemandVsCollectionRow & { sort: number }>();
  for (const r of rows) {
    const key = q.group_by === "STAGE" ? `${r.blockId}:${r.stageId ?? r.triggerType}` : `${r.blockId}:${r.seq}`;
    const label = q.group_by === "STAGE" ? (r.stageName ?? TRIGGER_LABELS[r.triggerType]) : r.name;
    const sort = q.group_by === "STAGE" ? (r.stageSort ?? -1) : r.seq;
    const cur = out.get(key) ?? { key, label, block_id: r.blockId, block_name: r.blockName, trigger_type: r.triggerType, demands_count: 0, demanded_paise: 0, collected_paise: 0, outstanding_paise: 0, collection_percent: 0, sort };
    cur.demands_count += Number(r.n); cur.demanded_paise += Number(r.demanded); cur.collected_paise += Number(r.paid);
    out.set(key, cur);
  }
  const list = [...out.values()].map((r) => ({ ...r, outstanding_paise: r.demanded_paise - r.collected_paise, collection_percent: Math.min(100, percentOf(r.collected_paise, r.demanded_paise)) }));
  list.sort((a, b) => (a.block_name ?? "").localeCompare(b.block_name ?? "") || a.sort - b.sort || a.label.localeCompare(b.label));
  const result: DemandVsCollectionRow[] = list.map(({ sort: _s, ...r }) => r);
  return { rows: result, totals: { demanded_paise: sumBy(result, (r) => r.demanded_paise), collected_paise: sumBy(result, (r) => r.collected_paise), outstanding_paise: sumBy(result, (r) => r.outstanding_paise) } };
}

// ---------------------------------------------------------------------------
// Upcoming dues forecast
// ---------------------------------------------------------------------------

/** Days assumed from the start of an IN_PROGRESS stage to its completion when forecasting stage-linked installments. */
export const STAGE_FORECAST_DAYS = 30;

interface StageRow extends TowerStage { blockId: string; startedOn: string | null }

async function stagesForBlocks(db: Executor, blockIds: readonly string[]): Promise<Map<string, StageRow[]>> {
  const out = new Map<string, StageRow[]>();
  if (blockIds.length === 0) return out;
  const rows = await db.select().from(blockStages).where(inArray(blockStages.blockId, [...new Set(blockIds)])).orderBy(asc(blockStages.blockId), asc(blockStages.sortOrder));
  for (const s of rows) {
    const list = out.get(s.blockId) ?? [];
    list.push({ blockId: s.blockId, stageId: s.stageId, name: s.name, isPossession: s.isPossession, status: s.status, completedOn: s.completedOn, startedOn: s.startedOn });
    out.set(s.blockId, list);
  }
  return out;
}

/**
 * Installments not yet demanded whose trigger date falls inside [from, to]: time triggers (ON_BOOKING / DAYS_AFTER_BOOKING / ON_DATE) exactly from the
 * plan snapshot; stage-linked ones estimated only for stages currently IN_PROGRESS (started_on + STAGE_FORECAST_DAYS, never before today) and flagged `is_estimate`.
 */
export async function upcomingDues(db: Executor, user: Scope, q: UpcomingDuesQuery): Promise<UpcomingDuesResponse> {
  const list = await activeBookingDues(db, user, q);
  const ids = list.map((b) => b.id);
  const [raised, stages] = await Promise.all([
    ids.length ? db.select({ bookingId: demands.bookingId, seq: demands.installmentSeq, name: demands.installmentName, status: demands.status, dueDate: demands.dueDate, cash: demands.cashDemandPaise, account: demands.accountDemandPaise, paid: demands.paidPaise }).from(demands).where(and(inArray(demands.bookingId, ids), sql`${demands.status} <> 'VOID'`)) : Promise.resolve([]),
    stagesForBlocks(db, list.map((b) => b.blockId)),
  ]);
  const raisedByBooking = groupBy(raised, (r) => r.bookingId);
  const today = todayDate();
  const rows: UpcomingDuesRow[] = [];
  for (const b of list) {
    const towerStages = stages.get(b.blockId) ?? [];
    const expected: Record<string, string> = {};
    for (const s of towerStages) {
      if (s.status === "IN_PROGRESS") {
        const guess = addDays(s.startedOn ?? today, STAGE_FORECAST_DAYS);
        expected[s.stageId] = compareDates(guess, today) < 0 ? today : guess;
      }
    }
    const schedule = schedulePreview({
      booking: { bookingDate: b.bookingDate, cashAgreedPaise: b.cashAgreed, accountAgreedPaise: b.accountAgreed, planSnapshot: { installments: snapshotInstallments(b.planSnapshot) } },
      towerStages,
      existingDemands: (raisedByBooking.get(b.id) ?? []).map((d) => ({ installmentSeq: d.seq, installmentName: d.name, status: d.status, dueDate: d.dueDate, cashPaise: d.cash, accountPaise: d.account, paidPaise: d.paid })),
      today, expectedStageDates: expected,
    });
    for (const r of schedule) {
      if (r.demanded || !r.expectedTriggerDate) continue;
      if (compareDates(r.expectedTriggerDate, q.from) < 0 || compareDates(r.expectedTriggerDate, q.to) > 0) continue;
      rows.push({
        expected_date: r.expectedTriggerDate, booking_id: b.id, booking_number: b.bookingNumber, customer_name: b.customerName, project_name: b.projectName, block_name: b.blockName, flat_number: b.flatNumber,
        installment_seq: r.seq, installment_name: r.name, trigger_type: r.triggerType, trigger_label: r.triggerLabel, is_estimate: r.triggerType === "ON_STAGE" || r.triggerType === "ON_POSSESSION",
        cash_paise: r.cashPaise, account_paise: r.accountPaise, total_paise: r.totalPaise,
      });
    }
  }
  rows.sort((a, b) => a.expected_date.localeCompare(b.expected_date) || a.booking_number.localeCompare(b.booking_number) || a.installment_seq - b.installment_seq);
  const byMonth = new Map<string, { month: string; total_paise: number; count: number }>();
  for (const r of rows) {
    const m = byMonth.get(monthKey(r.expected_date)) ?? { month: monthKey(r.expected_date), total_paise: 0, count: 0 };
    m.total_paise += r.total_paise; m.count += 1; byMonth.set(m.month, m);
  }
  return { rows, by_month: [...byMonth.values()], totals: { cash_paise: sumBy(rows, (r) => r.cash_paise), account_paise: sumBy(rows, (r) => r.account_paise), total_paise: sumBy(rows, (r) => r.total_paise), count: rows.length } };
}

// ---------------------------------------------------------------------------
// Cheques, cancellations, bank-wise receipts
// ---------------------------------------------------------------------------

/** Payment row → cheque row (instrument date, days in hand = today − receipt date). */
export function toChequeRow(p: ReturnType<typeof toPaymentRow>, today: string): ChequeRow {
  return {
    id: p.id, receipt_number: p.receipt_number, booking_number: p.booking_number, customer_name: p.customer_name, project_name: p.project_name, flat_number: p.flat_number, amount_paise: p.amount_paise,
    payment_date: p.payment_date, mode_code: p.mode_code, instrument: p.instrument, bank_account_label: p.bank_account_label, status: p.status, bounce_reason: p.bounce_reason, version: p.version,
    instrument_date: p.instrument?.date ?? null, days_in_hand: Math.max(0, diffDays(today, p.payment_date)),
  };
}

/** Cheques in hand (PENDING, by instrument date) or bounced, paged, with a totals footer over the whole filtered set. */
export async function chequesReport(db: Executor, user: Scope, q: ChequesReportQuery): Promise<ChequesReportResponse> {
  if (q.project_id) ensureProjectAccess(user, q.project_id);
  const where = defined([
    eq(payments.companyId, user.companyId), eq(payments.status, q.status), scopeFilter(user, payments.projectId),
    q.project_id ? eq(payments.projectId, q.project_id) : undefined, q.from ? gte(payments.paymentDate, q.from) : undefined, q.to ? lte(payments.paymentDate, q.to) : undefined,
  ]);
  const instrumentDateCol = sql<string>`(${payments.instrument} ->> 'date')`;
  const [page, agg] = await Promise.all([
    paginate<PaymentSelect>(db, {
      table: payments, select: { ...PAYMENT_SELECT, instrumentDate: instrumentDateCol }, join: paymentJoins, where,
      search: { columns: [payments.receiptNumber, bookings.bookingNumber, customers.fullName, sql`(${payments.instrument} ->> 'number')`], term: q.search },
      sort: { allowed: { instrument_date: instrumentDateCol as unknown as typeof payments.paymentDate, payment_date: payments.paymentDate, amount_paise: payments.amountPaise, customer_name: customers.fullName, receipt_number: payments.receiptNumber }, default: q.status === "PENDING" ? "instrument_date" : "-payment_date", requested: q.sort },
      ...reportPaging(q),
    }),
    db.select({ n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` }).from(payments).where(where),
  ]);
  const today = todayDate();
  return { ...page, items: page.items.map((s) => toChequeRow(toPaymentRow(s), today)), totals: { count: Number(agg[0]?.n ?? 0), amount_paise: Number(agg[0]?.amount ?? 0) } };
}

/** Cancellations with deduction and refund in a date range (cancelled-at in IST). */
export async function cancellationsReport(db: Executor, user: Scope, q: CancellationsReportQuery): Promise<CancellationsReportResponse> {
  if (q.project_id) ensureProjectAccess(user, q.project_id);
  const cancelledDate = sql`((${bookings.cancellation} ->> 'at')::timestamptz at time zone 'Asia/Kolkata')::date`;
  const list = await db
    .select({ b: bookings, projectName: projects.name, flatNumber: flats.flatNumber, customerName: customers.fullName })
    .from(bookings)
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(defined([
      eq(bookings.companyId, user.companyId), eq(bookings.status, "CANCELLED"), scopeFilter(user, bookings.projectId), q.project_id ? eq(bookings.projectId, q.project_id) : undefined,
      sql`${cancelledDate} >= ${q.from}::date`, sql`${cancelledDate} <= ${q.to}::date`,
    ]))
    .orderBy(desc(sql`${bookings.cancellation} ->> 'at'`));
  const rows: CancellationsReportRow[] = list.map((r) => {
    const c = r.b.cancellation!;
    return {
      booking_id: r.b.id, booking_number: r.b.bookingNumber, customer_name: r.customerName, project_name: r.projectName, flat_number: r.flatNumber, booking_date: r.b.bookingDate,
      cancelled_at: new Date(c.at).toISOString(), cancelled_by_name: c.by_name ?? null, reason: c.reason, paid_paise: r.b.cashPaidPaise + r.b.accountPaidPaise + r.b.otherChargesPaidPaise,
      deduction_paise: c.deduction_paise, refund_paise: c.refund_paise,
    };
  });
  return { rows, totals: { count: rows.length, paid_paise: sumBy(rows, (r) => r.paid_paise), deduction_paise: sumBy(rows, (r) => r.deduction_paise), refund_paise: sumBy(rows, (r) => r.refund_paise) } };
}

/** CLEARED receipts grouped by the company bank account credited (cash receipts have none), with a per-mode split. */
export async function bankwiseReceipts(db: Executor, user: Scope, q: BankwiseReceiptsQuery): Promise<BankwiseReceiptsResponse> {
  if (q.project_id) ensureProjectAccess(user, q.project_id);
  const agg = await db
    .select({ bankAccountId: payments.bankAccountId, bankName: bankAccounts.bankName, last4: bankAccounts.accountNumberLast4, modeCode: payments.modeCode, n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` })
    .from(payments)
    .leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId))
    .where(defined([
      eq(payments.companyId, user.companyId), eq(payments.status, "CLEARED"), gte(payments.paymentDate, q.from), lte(payments.paymentDate, q.to), scopeFilter(user, payments.projectId),
      q.project_id ? eq(payments.projectId, q.project_id) : undefined, q.bank_account_id ? eq(payments.bankAccountId, q.bank_account_id) : undefined,
    ]))
    .groupBy(payments.bankAccountId, bankAccounts.bankName, bankAccounts.accountNumberLast4, payments.modeCode);
  const byBank = new Map<string, BankwiseReceiptsResponse["rows"][number]>();
  for (const r of agg) {
    const key = r.bankAccountId ?? "cash";
    const cur = byBank.get(key) ?? { bank_account_id: r.bankAccountId, bank_account_label: r.bankName ? `${r.bankName} ••${r.last4 ?? ""}` : "Cash in hand (no bank account)", count: 0, amount_paise: 0, by_mode: [] };
    cur.count += Number(r.n); cur.amount_paise += Number(r.amount);
    cur.by_mode.push({ mode_code: r.modeCode as PaymentModeCode, amount_paise: Number(r.amount), count: Number(r.n) });
    byBank.set(key, cur);
  }
  const rows = [...byBank.values()].sort((a, b) => b.amount_paise - a.amount_paise);
  return { rows, totals: { count: sumBy(rows, (r) => r.count), amount_paise: sumBy(rows, (r) => r.amount_paise) } };
}

/** Pending cheques (count + amount) of the scope – dashboard figure. */
export async function pendingChequesTotal(db: Executor, user: Scope, projectId?: string): Promise<{ count: number; amount_paise: number }> {
  const [r] = await db.select({ n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` }).from(payments)
    .where(defined([eq(payments.companyId, user.companyId), eq(payments.status, "PENDING"), scopeFilter(user, payments.projectId), projectId ? eq(payments.projectId, projectId) : undefined]));
  return { count: Number(r?.n ?? 0), amount_paise: Number(r?.amount ?? 0) };
}

/** Week start helper re-exported for the dashboards. */
export { weekStart };
