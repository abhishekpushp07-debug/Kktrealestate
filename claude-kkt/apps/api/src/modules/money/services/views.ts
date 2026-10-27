/**
 * Wire-shape mappers for bookings, payments, demands, other charges, ledger rows and schedules. Everything here is batch-oriented
 * (one query per related table for a whole page) so lists never run N+1 queries.
 */
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import type { PgSelect, PgTable } from "drizzle-orm/pg-core";
import type {
  AgreementRevisionRow,
  BookingDetailResponse,
  BookingFullRow,
  BookingRow,
  BookingSummary,
  DemandRow,
  LedgerRow,
  OtherChargeRow,
  PaymentRow,
  PlanRevisionRow,
  ScheduleRow,
} from "@kkt/contracts";
import {
  agreementRevisions,
  bankAccounts,
  blocks,
  blockStages,
  bookingCoApplicants,
  bookingOtherCharges,
  bookingPlanRevisions,
  bookings,
  customers,
  demands,
  flats,
  parkingSlots,
  paymentModes,
  payments,
  projects,
  users,
  type Executor,
} from "@kkt/db";
import { compareDates, diffDays, schedulePreview, type TowerStage } from "@kkt/domain";
import { compileSql } from "../../../lib/compiledSql.js";
import { ApiError } from "../../../lib/errors.js";
import { ensureProjectAccess, type StaffContext } from "../../../lib/scope.js";
import { groupBy, iso, snapshotInstallments, todayDate, type BookingRecord } from "../common.js";
import type { LedgerEntryRecord } from "./ledger.js";

type PaymentRecord = typeof payments.$inferSelect;
type DemandRecord = typeof demands.$inferSelect;
type OtherChargeRecord = typeof bookingOtherCharges.$inferSelect;

/** Joined selection used by booking lists and detail. */
export interface BookingSelect {
  booking: BookingRecord;
  projectName: string;
  blockName: string;
  flatNumber: string;
  customerCode: string;
  customerName: string;
  customerPhone: string;
  salesUserName: string | null;
}

export const BOOKING_SELECT = {
  booking: bookings,
  projectName: projects.name,
  blockName: blocks.name,
  flatNumber: flats.flatNumber,
  customerCode: customers.customerCode,
  customerName: customers.fullName,
  customerPhone: customers.phone,
  salesUserName: users.name,
};

/** Joins for BOOKING_SELECT (dynamic query builder). */
export function bookingJoins(q: PgSelect): PgSelect {
  return q
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(blocks, eq(blocks.id, bookings.blockId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .leftJoin(users, eq(users.id, bookings.salesUserId));
}

function prepareBookingSelect(db: Executor) {
  return bookingJoins(db.select(BOOKING_SELECT).from(bookings).$dynamic())
    .where(and(eq(bookings.id, sql.placeholder("id")), eq(bookings.companyId, sql.placeholder("companyId"))))
    .limit(1)
    .prepare("kkt_booking_select");
}

/** The booking-select statement prepared once per executor (Drizzle builds the five-join query text once, not per request). */
const bookingSelectQueries = new WeakMap<Executor, ReturnType<typeof prepareBookingSelect>>();

/** Loads one booking's joined selection (404 when missing or out of the user's project scope). */
export async function loadBookingSelect(
  db: Executor,
  user: Pick<StaffContext, "companyId" | "allProjects" | "projectIds">,
  id: string,
): Promise<BookingSelect> {
  let query = bookingSelectQueries.get(db);
  if (!query) {
    query = prepareBookingSelect(db);
    bookingSelectQueries.set(db, query);
  }
  const rows = (await query.execute({ id, companyId: user.companyId })) as unknown as BookingSelect[];
  const row = rows[0];
  if (!row) throw ApiError.notFound("Booking");
  ensureProjectAccess(user, row.booking.projectId, "Booking");
  return row;
}

/** Other-charge line → wire row. */
export function toOtherChargeRow(c: OtherChargeRecord): OtherChargeRow {
  return {
    id: c.id,
    booking_id: c.bookingId,
    charge_type_id: c.chargeTypeId ?? c.id,
    name: c.name,
    code: c.code,
    amount_paise: c.amountPaise,
    gst_percent: Number(c.gstPercent),
    gst_paise: c.gstPaise,
    total_paise: c.totalPaise,
    demand_at: c.demandAt,
    demanded_at: iso(c.demandedAt),
    demand_number: c.demandNumber,
    due_date: c.dueDate,
    paid_paise: c.paidPaise,
    due_paise: c.demandedAt ? c.totalPaise - c.paidPaise : 0,
    sort_order: c.sortOrder,
    version: c.version,
  };
}

/** Ledger entry → wire row. */
export function toLedgerRow(e: LedgerEntryRecord): LedgerRow {
  return {
    id: e.id,
    booking_id: e.bookingId,
    seq: e.seq,
    at: e.at.toISOString(),
    entry_date: e.entryDate,
    event: e.event,
    label: e.label,
    bucket: e.bucket,
    amount_paise: e.amountPaise,
    cash_paid_cum_paise: e.cashPaidCumPaise,
    account_paid_cum_paise: e.accountPaidCumPaise,
    cash_order_raised_paise: e.cashOrderRaisedPaise,
    account_order_raised_paise: e.accountOrderRaisedPaise,
    cash_due_paise: e.cashDuePaise,
    account_due_paise: e.accountDuePaise,
    total_due_paise: e.totalDuePaise,
    other_charges_due_paise: e.otherChargesDuePaise,
    ref_number: e.refNumber,
    ref_id: e.refId,
    note: e.note,
  };
}

/** Schedule rows of a booking from its plan snapshot, tower stages and non-void demands (domain schedulePreview + demand references). */
export function scheduleRows(
  booking: BookingRecord,
  towerStages: readonly TowerStage[],
  nonVoid: readonly DemandRecord[],
  today = todayDate(),
): ScheduleRow[] {
  const rows = schedulePreview({
    booking: {
      bookingDate: booking.bookingDate,
      cashAgreedPaise: booking.cashAgreedPaise,
      accountAgreedPaise: booking.accountAgreedPaise,
      planSnapshot: { installments: snapshotInstallments(booking.planSnapshot) },
    },
    towerStages,
    existingDemands: nonVoid.map((d) => ({
      installmentSeq: d.installmentSeq,
      installmentName: d.installmentName,
      status: d.status,
      dueDate: d.dueDate,
      cashPaise: d.cashDemandPaise,
      accountPaise: d.accountDemandPaise,
      paidPaise: d.paidPaise,
    })),
    today,
  });
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return rows.map((r) => {
    const d =
      nonVoid.find((x) => x.installmentSeq === r.seq) ?? nonVoid.find((x) => norm(x.installmentName) === norm(r.name));
    return {
      seq: r.seq,
      name: r.name,
      percent: Number(r.percent),
      cumulative_percent: Number(r.cumulativePercent),
      trigger_type: r.triggerType,
      trigger_label: r.triggerLabel,
      expected_date: r.expectedTriggerDate,
      status: r.status,
      demand_id: d?.id ?? null,
      demand_number: d?.demandNumber ?? null,
      demand_date: d?.demandDate ?? null,
      due_date: d?.dueDate ?? r.expectedDueDate,
      cash_paise: r.cashPaise,
      account_paise: r.accountPaise,
      total_paise: r.totalPaise,
      paid_paise: r.paidPaise,
    };
  });
}

/** Everything the summary needs beyond the booking row. */
interface SummaryExtras {
  pendingCash: number;
  pendingAccount: number;
  otherChargesTotal: number;
  schedule: ScheduleRow[];
}

function bucket(agreed: number, raised: number, paid: number, pending: number) {
  const due = raised - paid;
  return {
    agreed_paise: agreed,
    order_raised_paise: raised,
    paid_paise: paid,
    due_paise: due,
    advance_paise: Math.max(0, -due),
    pending_paise: pending,
  };
}

/** Materialised + derived booking summary (SPEC §11 figures). */
export function toSummary(b: BookingRecord, x: SummaryExtras): BookingSummary {
  const cash = bucket(b.cashAgreedPaise, b.cashOrderRaisedPaise, b.cashPaidPaise, x.pendingCash);
  const account = bucket(b.accountAgreedPaise, b.accountOrderRaisedPaise, b.accountPaidPaise, x.pendingAccount);
  const next = x.schedule.find((r) => r.status === "NOT_YET_DUE") ?? null;
  return {
    raised_percent: Number(b.raisedPercent),
    cash,
    account,
    total_order_raised_paise: cash.order_raised_paise + account.order_raised_paise,
    total_paid_paise: cash.paid_paise + account.paid_paise,
    total_due_paise: cash.due_paise + account.due_paise,
    other_charges_total_paise: x.otherChargesTotal,
    other_charges_demanded_paise: b.otherChargesDemandedPaise,
    other_charges_paid_paise: b.otherChargesPaidPaise,
    other_charges_due_paise: b.otherChargesDemandedPaise - b.otherChargesPaidPaise,
    pending_cheques_paise: b.pendingChequesPaise,
    last_payment_at: iso(b.lastPaymentAt),
    next_installment: next
      ? {
          seq: next.seq,
          name: next.name,
          trigger_label: next.trigger_label,
          expected_date: next.expected_date,
          cash_paise: next.cash_paise,
          account_paise: next.account_paise,
        }
      : null,
  };
}

/** Related data of a page of bookings, loaded in one query per table. */
export interface BookingRelated {
  coApplicants: Map<string, { customer_id: string; full_name: string; phone: string }[]>;
  parking: Map<string, { id: string; number: string; slot_type: "COVERED" | "OPEN" | "STILT" | "BASEMENT" }[]>;
  revisionCounts: Map<string, number>;
  pending: Map<string, { cash: number; account: number }>;
  charges: Map<string, OtherChargeRecord[]>;
  demands: Map<string, DemandRecord[]>;
  stages: Map<string, TowerStage[]>;
  completedByNames: Map<string, string>;
}

/** JSON shapes produced by the single related-data query. */
interface RelatedJson {
  co: { bookingId: string; customerId: string; fullName: string; phone: string }[];
  park: { bookingId: string; id: string; number: string; slotType: "COVERED" | "OPEN" | "STILT" | "BASEMENT" }[];
  revs: { bookingId: string; n: number }[];
  pend: { bookingId: string; bucket: "CASH" | "ACCOUNT" | null; n: number | string }[];
  charges: Record<string, unknown>[];
  dem: Record<string, unknown>[];
  stages: {
    blockId: string;
    stageId: string;
    name: string;
    isPossession: boolean;
    status: TowerStage["status"];
    completedOn: string | null;
  }[];
  names: { id: string; name: string }[];
}

/**
 * Maps a `to_jsonb(row)` object (database column names, JSON scalars) onto the record shape Drizzle would return for `table`:
 * TS property names, `Date` for timestamp columns, numbers/strings/booleans/json as-is.
 */
export function recordFromJson<T extends PgTable>(table: T, json: Record<string, unknown>): T["$inferSelect"] {
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    const v = json[col.name];
    if (v != null && col.columnType === "PgTimestamp") {
      const withTz = (col as unknown as { withTimezone?: boolean }).withTimezone === true;
      out[key] = new Date(withTz || /[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? String(v) : `${String(v)}Z`);
    } else out[key] = v === undefined ? null : v;
  }
  return out as T["$inferSelect"];
}

/** A `uuid[]` parameter value: the array literal `{a,b}`, bound as one text parameter and cast in SQL. */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(",")}}`;
}

/** Placeholder of a `uuid[]` value (see uuidArray). */
const ids$ = sql`${sql.placeholder("ids")}::uuid[]`;

/** The per-table JSON aggregates of the related-data statement; every one is filtered by the `ids` (booking ids) placeholder. */
const RELATED_COLUMNS = {
  co: sql`(select coalesce(json_agg(json_build_object('bookingId', ca.booking_id, 'customerId', c.id, 'fullName', c.full_name, 'phone', c.phone)), '[]'::json)
         from ${bookingCoApplicants} ca join ${customers} c on c.id = ca.customer_id where ca.booking_id = any(${ids$})) as co`,
  park: sql`(select coalesce(json_agg(json_build_object('bookingId', p.booking_id, 'id', p.id, 'number', p.number, 'slotType', p.slot_type)), '[]'::json)
         from ${parkingSlots} p where p.booking_id = any(${ids$})) as park`,
  revs: sql`(select coalesce(json_agg(json_build_object('bookingId', r.booking_id, 'n', r.n)), '[]'::json)
         from (select booking_id, count(*)::int as n from ${agreementRevisions} where booking_id = any(${ids$}) group by booking_id) r) as revs`,
  pend: sql`(select coalesce(json_agg(json_build_object('bookingId', x.booking_id, 'bucket', x.bucket, 'n', x.n)), '[]'::json)
         from (select booking_id, bucket, coalesce(sum(amount_paise), 0)::bigint as n from ${payments}
               where booking_id = any(${ids$}) and status = 'PENDING' and against = 'FLAT_VALUE' group by booking_id, bucket) x) as pend`,
  charges: sql`(select coalesce(json_agg(to_jsonb(c) order by c.sort_order, c.created_at), '[]'::json) from ${bookingOtherCharges} c where c.booking_id = any(${ids$})) as charges`,
  dem: sql`(select coalesce(json_agg(to_jsonb(d) order by d.posted_at, d.installment_seq), '[]'::json) from ${demands} d where d.booking_id = any(${ids$}) and d.status <> 'VOID') as dem`,
  stages: sql`(select coalesce(json_agg(json_build_object('blockId', s.block_id, 'stageId', s.stage_id, 'name', s.name, 'isPossession', s.is_possession, 'status', s.status, 'completedOn', s.completed_on) order by s.block_id, s.sort_order), '[]'::json)
         from ${blockStages} s where s.block_id = any(${sql.placeholder("blockIds")}::uuid[])) as stages`,
  names: sql`(select coalesce(json_agg(json_build_object('id', u.id, 'name', u.name)), '[]'::json) from ${users} u where u.id = any(${sql.placeholder("userIds")}::uuid[])) as names`,
};

/**
 * Related data of a page of bookings in ONE round trip: every per-table load is a JSON-aggregated scalar subquery of the same statement
 * (a page used to fan out eight parallel queries, each taking a pool connection, which multiplied pool contention under load). Compiled
 * once (lib/compiledSql.ts): building this template per request cost more CPU than running it.
 */
const RELATED_SQL = compileSql<RelatedJson>(sql`select ${sql.join(Object.values(RELATED_COLUMNS), sql`, `)}`);

/** The booking detail's statement: the related data plus both revision histories (one round trip instead of three). */
const DETAIL_SQL = compileSql<RelatedJson & DetailJson>(sql`select ${sql.join(Object.values(RELATED_COLUMNS), sql`, `)},
      (select coalesce(json_agg(to_jsonb(r) order by r.revised_at), '[]'::json) from ${agreementRevisions} r where r.booking_id = any(${ids$})) as arevs,
      (select coalesce(json_agg(json_build_object('r', to_jsonb(p), 'byName', u.name) order by p.at), '[]'::json)
         from ${bookingPlanRevisions} p left join ${users} u on u.id = p.by where p.booking_id = any(${ids$})) as prevs`);

/** What the money summary of one booking needs beyond its row (GET /bookings/:id/ledger): pending cheques, charge total, stages, demands. */
const SUMMARY_SQL = compileSql<
  Pick<RelatedJson, "pend" | "dem" | "stages"> & { charges_total: number | string }
>(sql`select
      ${RELATED_COLUMNS.pend}, ${RELATED_COLUMNS.dem}, ${RELATED_COLUMNS.stages},
      (select coalesce(sum(c.total_paise), 0)::bigint from ${bookingOtherCharges} c where c.booking_id = any(${ids$})) as charges_total`);

/** JSON shapes of the detail-only columns. */
interface DetailJson {
  arevs: Record<string, unknown>[];
  prevs: { r: Record<string, unknown>; byName: string | null }[];
}

function relatedValues(rows: readonly BookingRecord[]): Record<string, string> {
  return {
    ids: uuidArray([...new Set(rows.map((b) => b.id))]),
    blockIds: uuidArray([...new Set(rows.map((b) => b.blockId))]),
    userIds: uuidArray([...new Set(rows.map((b) => b.completedBy).filter((x): x is string => !!x))]),
  };
}

function pendingByBooking(pend: RelatedJson["pend"]): Map<string, { cash: number; account: number }> {
  const pending = new Map<string, { cash: number; account: number }>();
  for (const p of pend) {
    const cur = pending.get(p.bookingId) ?? { cash: 0, account: 0 };
    if (p.bucket === "CASH") cur.cash += Number(p.n);
    if (p.bucket === "ACCOUNT") cur.account += Number(p.n);
    pending.set(p.bookingId, cur);
  }
  return pending;
}

function stagesByBlock(rows: RelatedJson["stages"]): Map<string, TowerStage[]> {
  const stages = new Map<string, TowerStage[]>();
  for (const s of rows) {
    const list = stages.get(s.blockId) ?? [];
    list.push({
      stageId: s.stageId,
      name: s.name,
      isPossession: s.isPossession,
      status: s.status,
      completedOn: s.completedOn,
    });
    stages.set(s.blockId, list);
  }
  return stages;
}

function emptyRelated(): BookingRelated {
  return {
    coApplicants: new Map(),
    parking: new Map(),
    revisionCounts: new Map(),
    pending: new Map(),
    charges: new Map(),
    demands: new Map(),
    stages: new Map(),
    completedByNames: new Map(),
  };
}

function toRelated(j: RelatedJson): BookingRelated {
  return {
    coApplicants: groupBy(
      j.co.map((c) => ({ bookingId: c.bookingId, customer_id: c.customerId, full_name: c.fullName, phone: c.phone })),
      (c) => c.bookingId,
    ),
    parking: groupBy(
      j.park.map((p) => ({ bookingId: p.bookingId, id: p.id, number: p.number, slot_type: p.slotType })),
      (p) => p.bookingId,
    ),
    revisionCounts: new Map(j.revs.map((r) => [r.bookingId, Number(r.n)])),
    pending: pendingByBooking(j.pend),
    charges: groupBy(
      j.charges.map((c) => recordFromJson(bookingOtherCharges, c)),
      (c) => c.bookingId,
    ),
    demands: groupBy(
      j.dem.map((d) => recordFromJson(demands, d)),
      (d) => d.bookingId,
    ),
    stages: stagesByBlock(j.stages),
    completedByNames: new Map(j.names.map((n) => [n.id, n.name])),
  };
}

/** Related data of a page of bookings (one statement; see RELATED_SQL). */
export async function loadBookingRelated(db: Executor, rows: readonly BookingRecord[]): Promise<BookingRelated> {
  if (rows.length === 0) return emptyRelated();
  const j = (await RELATED_SQL.run(db, relatedValues(rows)))[0];
  return j ? toRelated(j) : emptyRelated();
}

/** The money summary of one booking (GET /bookings/:id/ledger): one statement with only what toSummary needs. */
export async function loadBookingSummary(db: Executor, b: BookingRecord, today = todayDate()): Promise<BookingSummary> {
  const j = (await SUMMARY_SQL.run(db, relatedValues([b])))[0];
  const pend = (j ? pendingByBooking(j.pend) : new Map<string, { cash: number; account: number }>()).get(b.id) ?? {
    cash: 0,
    account: 0,
  };
  const schedule = scheduleRows(
    b,
    (j ? stagesByBlock(j.stages) : new Map<string, TowerStage[]>()).get(b.blockId) ?? [],
    (j?.dem ?? []).map((d) => recordFromJson(demands, d)),
    today,
  );
  return toSummary(b, {
    pendingCash: pend.cash,
    pendingAccount: pend.account,
    otherChargesTotal: Number(j?.charges_total ?? 0),
    schedule,
  });
}

/** The stored flat snapshot in wire shape (full: rooms, areas and price breakup included). */
function fullFlatSnapshot(b: BookingRecord): BookingDetailResponse["flat_snapshot"] {
  const snap = b.flatSnapshot as unknown as BookingDetailResponse["flat_snapshot"];
  return {
    ...snap,
    floor_label: snap.floor_label ?? String(snap.floor),
    flat_type_name: snap.flat_type_name ?? snap.flat_type_code,
    facing: snap.facing ?? null,
    carpet_sqft: snap.carpet_sqft ?? null,
    builtup_sqft: snap.builtup_sqft ?? null,
  };
}

/** Booking selection + related → full wire row (every field; detail, `view=full`, CSV). */
export function toBookingRow(
  s: BookingSelect,
  rel: BookingRelated,
  today = todayDate(),
  schedule = scheduleRows(
    s.booking,
    rel.stages.get(s.booking.blockId) ?? [],
    rel.demands.get(s.booking.id) ?? [],
    today,
  ),
): BookingFullRow {
  const b = s.booking;
  const charges = rel.charges.get(b.id) ?? [];
  const pend = rel.pending.get(b.id) ?? { cash: 0, account: 0 };
  return {
    id: b.id,
    company_id: b.companyId,
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
    created_by: b.createdBy,
    version: b.version,
    booking_number: b.bookingNumber,
    project_id: b.projectId,
    project_name: s.projectName,
    block_id: b.blockId,
    block_name: s.blockName,
    flat_id: b.flatId,
    flat_number: s.flatNumber,
    customer_id: b.customerId,
    customer_code: s.customerCode,
    customer_name: s.customerName,
    customer_phone: s.customerPhone,
    co_applicants: (rel.coApplicants.get(b.id) ?? []).map((c) => ({
      customer_id: c.customer_id,
      full_name: c.full_name,
      phone: c.phone,
    })),
    booking_date: b.bookingDate,
    status: b.status,
    agreement_value_paise: b.agreementValuePaise,
    cash_agreed_paise: b.cashAgreedPaise,
    account_agreed_paise: b.accountAgreedPaise,
    flat_snapshot: fullFlatSnapshot(b),
    rate_per_sqft_paise: b.ratePerSqftPaise,
    payment_plan_id: b.paymentPlanId,
    plan_snapshot: b.planSnapshot as BookingFullRow["plan_snapshot"],
    plan_accepted_on: b.planAcceptedOn,
    plan_acceptance_mode: b.planAcceptanceMode,
    plan_acceptance_document_id: b.planAcceptanceDocumentId,
    sales_user_id: b.salesUserId,
    sales_user_name: s.salesUserName,
    lead_id: b.leadId,
    broker_name: b.brokerName,
    remarks: b.remarks,
    parking_slots: (rel.parking.get(b.id) ?? []).map((p) => ({ id: p.id, number: p.number, slot_type: p.slot_type })),
    summary: toSummary(b, {
      pendingCash: pend.cash,
      pendingAccount: pend.account,
      otherChargesTotal: charges.reduce((t, c) => t + c.totalPaise, 0),
      schedule,
    }),
    cancellation: b.cancellation
      ? {
          at: b.cancellation.at,
          by: b.cancellation.by,
          by_name: b.cancellation.by_name,
          reason: b.cancellation.reason,
          // money columns (migration 0005) first; the jsonb copy is history only
          deduction_paise: b.cancellationDeductionPaise ?? b.cancellation.deduction_paise,
          refund_paise: b.cancellationRefundPaise ?? b.cancellation.refund_paise,
        }
      : null,
    completed_at: iso(b.completedAt),
    completed_by_name: b.completedBy ? (rel.completedByNames.get(b.completedBy) ?? null) : null,
    completion_notes: b.completionNotes,
    revision_count: rel.revisionCounts.get(b.id) ?? 0,
  };
}

/**
 * Compact list row (GET /bookings default view, audit C: ≈ 1 KB instead of ≈ 5 KB per row): what list screens, pickers and the payment
 * dialog read — ids, numbers, names, status, agreement value, plan name and the bucket summary (agreed / raised / paid / due / pending per bucket). Needs only co-applicants and pending
 * cheques (no schedule, stages, demands or charges are loaded for a page).
 */
export function toCompactBookingRow(
  s: BookingSelect,
  rel: Pick<BookingRelated, "coApplicants" | "pending">,
): BookingRow {
  const b = s.booking;
  const pend = rel.pending.get(b.id) ?? { cash: 0, account: 0 };
  const cash = bucket(b.cashAgreedPaise, b.cashOrderRaisedPaise, b.cashPaidPaise, pend.cash);
  const account = bucket(b.accountAgreedPaise, b.accountOrderRaisedPaise, b.accountPaidPaise, pend.account);
  const plan = b.planSnapshot as BookingFullRow["plan_snapshot"];
  return {
    id: b.id,
    version: b.version,
    booking_number: b.bookingNumber,
    status: b.status,
    booking_date: b.bookingDate,
    project_id: b.projectId,
    project_name: s.projectName,
    block_name: s.blockName,
    flat_id: b.flatId,
    flat_number: s.flatNumber,
    customer_id: b.customerId,
    customer_code: s.customerCode,
    customer_name: s.customerName,
    customer_phone: s.customerPhone,
    co_applicants: (rel.coApplicants.get(b.id) ?? []).map((c) => ({
      customer_id: c.customer_id,
      full_name: c.full_name,
      phone: c.phone,
    })),
    agreement_value_paise: b.agreementValuePaise,
    plan_snapshot: { name: plan.name },
    summary: {
      raised_percent: Number(b.raisedPercent),
      cash,
      account,
      total_paid_paise: cash.paid_paise + account.paid_paise,
      total_due_paise: cash.due_paise + account.due_paise,
      other_charges_due_paise: b.otherChargesDemandedPaise - b.otherChargesPaidPaise,
      pending_cheques_paise: b.pendingChequesPaise,
    },
  };
}

/** Co-applicants and pending cheques of a page of bookings (all a compact row needs), compiled once. */
const COMPACT_SQL = compileSql<Pick<RelatedJson, "co" | "pend">>(
  sql`select ${RELATED_COLUMNS.co}, ${RELATED_COLUMNS.pend}`,
);

/** Co-applicants and pending cheques of a page of bookings in one round trip (all a compact row needs). */
export async function loadCompactRelated(
  db: Executor,
  rows: readonly BookingRecord[],
): Promise<Pick<BookingRelated, "coApplicants" | "pending">> {
  if (rows.length === 0) return { coApplicants: new Map(), pending: new Map() };
  const j = (await COMPACT_SQL.run(db, { ids: uuidArray([...new Set(rows.map((b) => b.id))]) }))[0] ?? {
    co: [],
    pend: [],
  };
  return {
    coApplicants: groupBy(
      j.co.map((c) => ({ bookingId: c.bookingId, customer_id: c.customerId, full_name: c.fullName, phone: c.phone })),
      (c) => c.bookingId,
    ),
    pending: pendingByBooking(j.pend),
  };
}

/** Full booking rows for a page of selections (batch related loads). */
export async function toBookingRows(db: Executor, selections: readonly BookingSelect[]): Promise<BookingFullRow[]> {
  const rel = await loadBookingRelated(
    db,
    selections.map((s) => s.booking),
  );
  const today = todayDate();
  return selections.map((s) => toBookingRow(s, rel, today));
}

/** Compact booking rows for a list page (see toCompactBookingRow). */
export async function toCompactBookingRows(db: Executor, selections: readonly BookingSelect[]): Promise<BookingRow[]> {
  const rel = await loadCompactRelated(
    db,
    selections.map((s) => s.booking),
  );
  return selections.map((s) => toCompactBookingRow(s, rel));
}

export function toAgreementRevisionRow(r: typeof agreementRevisions.$inferSelect): AgreementRevisionRow {
  return {
    id: r.id,
    booking_id: r.bookingId,
    revised_at: r.revisedAt.toISOString(),
    revised_by: r.revisedBy,
    revised_by_name: r.revisedByName,
    reason: r.reason,
    before: r.before,
    after: r.after,
  };
}

export function toPlanRevisionRow(r: typeof bookingPlanRevisions.$inferSelect, byName: string | null): PlanRevisionRow {
  return {
    id: r.id,
    booking_id: r.bookingId,
    at: r.at.toISOString(),
    by: r.by,
    by_name: byName,
    reason: r.reason,
    before_plan_snapshot: r.beforePlanSnapshot as PlanRevisionRow["before_plan_snapshot"],
    after_plan_snapshot: r.afterPlanSnapshot as PlanRevisionRow["after_plan_snapshot"],
  };
}

/**
 * Full booking detail (row + other charges + schedule + revisions): the joined booking row plus ONE statement for everything related
 * (DETAIL_SQL), and the schedule is computed once (it feeds both `schedule` and `summary.next_installment`).
 */
export async function bookingDetail(db: Executor, s: BookingSelect): Promise<BookingDetailResponse> {
  const j = (await DETAIL_SQL.run(db, relatedValues([s.booking])))[0];
  const rel = j ? toRelated(j) : emptyRelated();
  const today = todayDate();
  const b = s.booking;
  const schedule = scheduleRows(b, rel.stages.get(b.blockId) ?? [], rel.demands.get(b.id) ?? [], today);
  const row = toBookingRow(s, rel, today, schedule);
  return {
    ...row,
    list_price_paise: b.listPricePaise ?? null,
    price_deviation_reason: b.priceDeviationReason ?? null,
    price_deviation_by: b.priceDeviationBy ?? null,
    other_charges: (rel.charges.get(b.id) ?? []).map(toOtherChargeRow),
    schedule,
    agreement_revisions: (j?.arevs ?? []).map((r) => toAgreementRevisionRow(recordFromJson(agreementRevisions, r))),
    plan_revisions: (j?.prevs ?? []).map((x) =>
      toPlanRevisionRow(recordFromJson(bookingPlanRevisions, x.r), x.byName ?? null),
    ),
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface PaymentSelect {
  payment: PaymentRecord;
  bookingNumber: string;
  projectName: string;
  blockName: string;
  flatNumber: string;
  customerName: string;
  modeName: string;
  receivedByName: string | null;
  bankName: string | null;
  bankLast4: string | null;
  otherChargeName: string | null;
}

export const PAYMENT_SELECT = {
  payment: payments,
  bookingNumber: bookings.bookingNumber,
  projectName: projects.name,
  blockName: blocks.name,
  flatNumber: flats.flatNumber,
  customerName: customers.fullName,
  modeName: paymentModes.name,
  receivedByName: users.name,
  bankName: bankAccounts.bankName,
  bankLast4: bankAccounts.accountNumberLast4,
  otherChargeName: bookingOtherCharges.name,
};

export function paymentJoins(q: PgSelect): PgSelect {
  return q
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .innerJoin(projects, eq(projects.id, payments.projectId))
    .innerJoin(blocks, eq(blocks.id, payments.blockId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .innerJoin(paymentModes, eq(paymentModes.id, payments.paymentModeId))
    .leftJoin(users, eq(users.id, payments.receivedBy))
    .leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId))
    .leftJoin(bookingOtherCharges, eq(bookingOtherCharges.id, payments.otherChargeId));
}

/** Label of a company bank account for receipts and lists. */
export function bankLabel(bankName: string | null, last4: string | null): string | null {
  return bankName ? `${bankName} ••${last4 ?? ""}`.trim() : null;
}

export function toPaymentRow(s: PaymentSelect): PaymentRow {
  const p = s.payment;
  return {
    id: p.id,
    company_id: p.companyId,
    booking_id: p.bookingId,
    booking_number: s.bookingNumber,
    project_id: p.projectId,
    project_name: s.projectName,
    block_id: p.blockId,
    block_name: s.blockName,
    flat_number: s.flatNumber,
    customer_id: p.customerId,
    customer_name: s.customerName,
    receipt_number: p.receiptNumber,
    against: p.against,
    bucket: p.bucket,
    other_charge_id: p.otherChargeId,
    other_charge_name: s.otherChargeName,
    amount_paise: p.amountPaise,
    payment_date: p.paymentDate,
    payment_mode_id: p.paymentModeId,
    mode_code: p.modeCode as PaymentRow["mode_code"],
    mode_name: s.modeName,
    instrument: p.instrument?.number
      ? {
          number: p.instrument.number,
          date: p.instrument.date ?? null,
          bank_name: p.instrument.bank_name ?? null,
          branch: p.instrument.branch ?? null,
        }
      : null,
    bank_account_id: p.bankAccountId,
    bank_account_label: bankLabel(s.bankName, s.bankLast4),
    remarks: p.remarks,
    received_by: p.receivedBy,
    received_by_name: s.receivedByName,
    status: p.status,
    cleared_at: iso(p.clearedAt),
    bounced_at: iso(p.bouncedAt),
    bounce_reason: p.bounceReason,
    reversed_at: iso(p.reversedAt),
    reversal_reason: p.reversalReason,
    receipt_cancelled: p.receiptCancelled,
    posted_at: p.postedAt.toISOString(),
    created_at: p.createdAt.toISOString(),
    version: p.version,
  };
}

/** Loads one payment's joined selection (404 when missing / out of scope). */
export async function loadPaymentSelect(
  db: Executor,
  user: Pick<StaffContext, "companyId" | "allProjects" | "projectIds">,
  id: string,
): Promise<PaymentSelect> {
  const rows = (await paymentJoins(db.select(PAYMENT_SELECT).from(payments).$dynamic())
    .where(and(eq(payments.id, id), eq(payments.companyId, user.companyId)))
    .limit(1)) as unknown as PaymentSelect[];
  const row = rows[0];
  if (!row) throw ApiError.notFound("Payment");
  ensureProjectAccess(user, row.payment.projectId, "Payment");
  return row;
}

// ---------------------------------------------------------------------------
// Demands
// ---------------------------------------------------------------------------

export interface DemandSelect {
  demand: DemandRecord;
  bookingNumber: string;
  projectName: string;
  blockName: string;
  flatNumber: string;
  customerName: string;
}

export const DEMAND_SELECT = {
  demand: demands,
  bookingNumber: bookings.bookingNumber,
  projectName: projects.name,
  blockName: blocks.name,
  flatNumber: flats.flatNumber,
  customerName: customers.fullName,
};

export function demandJoins(q: PgSelect): PgSelect {
  return q
    .innerJoin(bookings, eq(bookings.id, demands.bookingId))
    .innerJoin(projects, eq(projects.id, demands.projectId))
    .innerJoin(blocks, eq(blocks.id, demands.blockId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .innerJoin(customers, eq(customers.id, demands.customerId));
}

export function toDemandRow(s: DemandSelect, today = todayDate()): DemandRow {
  const d = s.demand;
  // days_overdue = today − due date (diffDays(a, b) is a − b)
  const overdue =
    (d.status === "OPEN" || d.status === "PARTIALLY_PAID") && compareDates(today, d.dueDate) > 0
      ? diffDays(today, d.dueDate)
      : 0;
  return {
    id: d.id,
    company_id: d.companyId,
    booking_id: d.bookingId,
    booking_number: s.bookingNumber,
    project_id: d.projectId,
    project_name: s.projectName,
    block_id: d.blockId,
    block_name: s.blockName,
    flat_number: s.flatNumber,
    customer_id: d.customerId,
    customer_name: s.customerName,
    demand_number: d.demandNumber,
    installment_seq: d.installmentSeq,
    installment_name: d.installmentName,
    trigger_type: d.triggerType,
    trigger_label: d.triggerLabel ?? "",
    trigger_stage_id: d.triggerStageId,
    percent: Number(d.percent),
    cumulative_percent: Number(d.cumulativePercent),
    cash_demand_paise: d.cashDemandPaise,
    account_demand_paise: d.accountDemandPaise,
    total_demand_paise: d.totalDemandPaise,
    demand_date: d.demandDate,
    due_date: d.dueDate,
    status: d.status,
    paid_paise: d.paidPaise,
    days_overdue: Math.max(0, overdue),
    voided_at: iso(d.voidedAt),
    void_reason: d.voidReason,
    posted_at: d.postedAt.toISOString(),
    created_at: d.createdAt.toISOString(),
    version: d.version,
  };
}
