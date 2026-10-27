/**
 * Integrity report + repair (SPEC §10): per booking (a) demands whose trigger is not satisfied, (b) satisfied triggers with no demand,
 * (c) duplicate installment demands, (d) demands not mapped to an installment, (e) stored summary ≠ recomputation. Repair voids
 * unsatisfied/duplicate/unmapped demands with no money applied, raises the missing ones and rebuilds ledgers. Runs are persisted.
 */
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type {
  IntegrityCounts,
  IntegrityFinding,
  IntegrityFindingType,
  IntegrityRepairResponse,
  IntegrityReportResponse,
} from "@kkt/contracts";
import { bookings, demands, integrityRuns, type DB, type Executor, type Tx } from "@kkt/db";
import { evaluateDues, normalizeLabel, triggerDate, type TowerStage } from "@kkt/domain";
import { writeAudit } from "../../../lib/audit.js";
import { notifyRole } from "../../notifications/index.js";
import {
  Clock,
  INTEGRITY_ROLES,
  loadCompanyRow,
  lockBooking,
  moneyTransaction,
  loadTowerStages,
  snapshotInstallments,
  todayDate,
  type BookingRecord,
  type MoneyActor,
  SYSTEM_MONEY_ACTOR,
} from "../common.js";
import { raiseDues, recomputeDemandStatuses, voidDemand, type DemandRecord } from "./dues.js";
import { rebuild } from "./ledger.js";

/** Scope of a report. */
export interface IntegrityScope {
  companyId: string;
  bookingId?: string | undefined;
  projectId?: string | undefined;
}

/** Findings of one booking (internal, carries the demand rows for repair). */
interface BookingFindings {
  booking: BookingRecord;
  findings: IntegrityFinding[];
  voidable: DemandRecord[];
  missing: number;
  summaryMismatch: boolean;
}

const EMPTY_COUNTS: IntegrityCounts = {
  UNSATISFIED_DEMAND: 0,
  MISSING_DEMAND: 0,
  DUPLICATE_DEMAND: 0,
  UNMAPPED_DEMAND: 0,
  SUMMARY_MISMATCH: 0,
  PLAN_STAGE_MISSING: 0,
};

function finding(
  type: IntegrityFindingType,
  b: BookingRecord,
  detail: string,
  extra: Partial<IntegrityFinding> = {},
): IntegrityFinding {
  return {
    type,
    booking_id: b.id,
    booking_number: b.bookingNumber,
    installment_seq: null,
    installment_name: null,
    demand_id: null,
    demand_number: null,
    detail,
    stored: null,
    recomputed: null,
    repairable: true,
    ...extra,
  };
}

/** Bookings the report covers: ACTIVE and COMPLETED (cancelled ledgers are closed and left alone). */
async function bookingsInScope(db: Executor, scope: IntegrityScope): Promise<BookingRecord[]> {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.companyId, scope.companyId),
        inArray(bookings.status, ["ACTIVE", "COMPLETED"]),
        scope.bookingId ? eq(bookings.id, scope.bookingId) : undefined,
        scope.projectId ? eq(bookings.projectId, scope.projectId) : undefined,
      ),
    )
    .orderBy(asc(bookings.bookingDate), asc(bookings.id));
}

/** Checks one booking against its plan snapshot, tower stages and demands. */
async function checkBooking(
  db: Executor,
  b: BookingRecord,
  towerStages: readonly TowerStage[],
  nonVoid: readonly DemandRecord[],
  today: string,
  defaultDueDays: number,
  opts: { ledger?: boolean } = {},
): Promise<BookingFindings> {
  const out: BookingFindings = { booking: b, findings: [], voidable: [], missing: 0, summaryMismatch: false };
  const installments = snapshotInstallments(b.planSnapshot);
  const bySeq = new Map(installments.map((i) => [i.seq, i]));
  const byName = new Map(installments.map((i) => [normalizeLabel(i.name), i]));
  const seenInstallment = new Set<number>();
  for (const d of nonVoid) {
    const inst = bySeq.get(d.installmentSeq) ?? byName.get(normalizeLabel(d.installmentName));
    const ref = {
      installment_seq: d.installmentSeq,
      installment_name: d.installmentName,
      demand_id: d.id,
      demand_number: d.demandNumber,
      repairable: d.paidPaise === 0,
    };
    if (!inst) {
      out.findings.push(
        finding(
          "UNMAPPED_DEMAND",
          b,
          `Demand ${d.demandNumber} (seq ${d.installmentSeq} "${d.installmentName}") matches no installment of the plan snapshot`,
          ref,
        ),
      );
      out.voidable.push(d);
      continue;
    }
    if (seenInstallment.has(inst.seq)) {
      out.findings.push(
        finding(
          "DUPLICATE_DEMAND",
          b,
          `Demand ${d.demandNumber} duplicates installment ${inst.seq} "${inst.name}"`,
          ref,
        ),
      );
      out.voidable.push(d);
      continue;
    }
    seenInstallment.add(inst.seq);
    if (b.status === "ACTIVE") {
      const date = triggerDate(inst, b.bookingDate, towerStages);
      const satisfied = date !== null && (inst.triggerType === "ON_BOOKING" || date <= today);
      if (!satisfied) {
        out.findings.push(
          finding(
            "UNSATISFIED_DEMAND",
            b,
            `Demand ${d.demandNumber} for installment ${inst.seq} "${inst.name}" was raised but its trigger (${d.triggerLabel ?? inst.triggerType}) is not satisfied`,
            ref,
          ),
        );
        out.voidable.push(d);
      }
    }
  }
  if (b.status === "ACTIVE") {
    // plan ↔ tower drift: an ON_STAGE installment whose stage the tower does not have (or ON_POSSESSION without a possession stage)
    // can never be raised; it is not auto-repairable (change the plan or the tower's stage sequence)
    const towerStageIds = new Set(towerStages.map((s) => s.stageId));
    const hasPossession = towerStages.some((s) => s.isPossession);
    for (const inst of installments) {
      if (seenInstallment.has(inst.seq)) continue;
      const missingStage =
        inst.triggerType === "ON_STAGE" && !!inst.triggerStageId && !towerStageIds.has(inst.triggerStageId);
      const missingPossession = inst.triggerType === "ON_POSSESSION" && !hasPossession;
      if (!missingStage && !missingPossession) continue;
      out.findings.push(
        finding(
          "PLAN_STAGE_MISSING",
          b,
          missingStage
            ? `Installment ${inst.seq} "${inst.name}" is due on stage "${inst.triggerStageName ?? inst.triggerStageId}", which tower's stage sequence does not contain; it can never be raised`
            : `Installment ${inst.seq} "${inst.name}" is due on possession, but the tower has no possession stage; it can never be raised`,
          { installment_seq: inst.seq, installment_name: inst.name, repairable: false },
        ),
      );
    }
    const due = evaluateDues({
      booking: {
        bookingDate: b.bookingDate,
        cashAgreedPaise: b.cashAgreedPaise,
        accountAgreedPaise: b.accountAgreedPaise,
        planSnapshot: { installments },
      },
      towerStages,
      existingDemands: nonVoid.map((d) => ({
        installmentSeq: d.installmentSeq,
        installmentName: d.installmentName,
        status: d.status,
      })),
      today,
      defaultDueDays,
    });
    for (const m of due) {
      out.missing += 1;
      out.findings.push(
        finding(
          "MISSING_DEMAND",
          b,
          `Installment ${m.seq} "${m.name}" is satisfied (${m.triggerLabel}, ${m.triggerDate}) but has no demand`,
          { installment_seq: m.seq, installment_name: m.name },
        ),
      );
    }
  }
  // (e) stored figures AND the stored ledger row by row (order, amounts, running balances) against a rebuild in canonical order
  // (skipped by repair's re-check under the lock: the repair rebuilds the ledger anyway)
  if (opts.ledger === false) return out;
  const rb = await rebuild(db, b.id);
  if (rb.mismatches.length > 0 || rb.rowMismatches.length > 0) {
    out.summaryMismatch = true;
    const parts: string[] = [];
    if (rb.mismatches.length > 0)
      parts.push(
        `Stored summary differs from recomputation: ${rb.mismatches.map((m) => `${m.field} ${m.stored} ≠ ${m.recomputed}`).join(", ")}`,
      );
    if (rb.rowMismatches.length > 0) {
      const shown = rb.rowMismatches
        .slice(0, 5)
        .map((d) => `row ${d.position} ${d.field} ${String(d.stored)} ≠ ${String(d.recomputed)}`)
        .join(", ");
      parts.push(`Stored ledger rows differ from the rebuild: ${shown}${rb.rowMismatches.length > 5 ? ", …" : ""}`);
    }
    const stored = {
      ...rb.stored,
      ledger_row_mismatches: rb.rowMismatches.length > 0 ? rb.rowMismatches[0]!.position : 0,
    };
    const recomputed = { ...rb.recomputed, ledger_row_mismatches: 0 };
    out.findings.push(finding("SUMMARY_MISMATCH", b, parts.join("; "), { stored, recomputed }));
  }
  return out;
}

/** True for a transaction handle (it has rollback()); a plain database handle opens its own transactions. */
function isTransaction(db: Executor): db is Tx {
  return typeof (db as { rollback?: unknown }).rollback === "function";
}

/**
 * Runs `fn` on ONE consistent snapshot: a REPEATABLE READ, READ ONLY transaction, so every table the check reads (booking, tower stages,
 * demands, payments, revisions, stored ledger rows) is seen as of the same instant and a payment committing midway cannot produce a
 * false SUMMARY_MISMATCH. Inside an existing transaction the caller's snapshot is used as is.
 */
export async function onSnapshot<T>(db: Executor, fn: (tx: Executor) => Promise<T>): Promise<T> {
  if (isTransaction(db)) return fn(db);
  return (db as DB).transaction((tx) => fn(tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Checks one booking on its own consistent snapshot (re-reads the booking, its tower stages and demands); null when it left the scope. */
async function checkBookingOnSnapshot(
  db: Executor,
  bookingId: string,
  today: string,
  defaultDueDays: number,
): Promise<BookingFindings | null> {
  return onSnapshot(db, async (tx) => {
    const [b] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), inArray(bookings.status, ["ACTIVE", "COMPLETED"])))
      .limit(1);
    if (!b) return null;
    const stages = await loadTowerStages(tx, b.blockId);
    const nonVoid = await tx
      .select()
      .from(demands)
      .where(and(eq(demands.bookingId, b.id), ne(demands.status, "VOID")))
      .orderBy(asc(demands.postedAt), asc(demands.installmentSeq));
    return checkBooking(tx, b, stages, nonVoid, today, defaultDueDays);
  });
}

/** Runs the report over the scope (no writes except the persisted run); each booking is checked on one consistent snapshot. */
export async function runReport(
  db: Executor,
  scope: IntegrityScope,
  opts: { triggeredBy?: string | null; persist?: boolean; today?: string } = {},
): Promise<{ report: IntegrityReportResponse; perBooking: BookingFindings[] }> {
  const today = opts.today ?? todayDate();
  const company = await loadCompanyRow(db, scope.companyId);
  const rows = await bookingsInScope(db, scope);
  const perBooking: BookingFindings[] = [];
  for (const b of rows) {
    const checked = await checkBookingOnSnapshot(db, b.id, today, company.settings.demand_due_days);
    if (checked) perBooking.push(checked);
  }
  const findings = perBooking.flatMap((p) => p.findings);
  const counts: IntegrityCounts = { ...EMPTY_COUNTS };
  for (const f of findings) counts[f.type] += 1;
  const ranAt = new Date();
  let runId: string | null = null;
  if (opts.persist !== false) {
    const [run] = await db
      .insert(integrityRuns)
      .values({
        companyId: scope.companyId,
        ranAt,
        triggeredBy: opts.triggeredBy ?? null,
        ok: findings.length === 0,
        counts,
        findings: findings as unknown as Record<string, unknown>[],
      })
      .returning({ id: integrityRuns.id });
    runId = run?.id ?? null;
  }
  return {
    report: {
      run_id: runId,
      ran_at: ranAt.toISOString(),
      triggered_by: opts.triggeredBy ?? "system",
      ok: findings.length === 0,
      bookings_checked: perBooking.length,
      counts,
      findings,
    },
    perBooking,
  };
}

/** Admin-confirmed repair: void repairable demands without money applied, raise missing ones, rebuild and recompute; returns the report after. */
export async function repair(
  db: DB,
  scope: IntegrityScope,
  actor: MoneyActor = SYSTEM_MONEY_ACTOR,
  bookingIds?: readonly string[],
): Promise<IntegrityRepairResponse> {
  const before = await runReport(db, scope, { persist: false });
  // PLAN_STAGE_MISSING alone is not repairable here (it needs a plan change or a tower stage sequence change)
  const targets = before.perBooking.filter(
    (p) =>
      p.findings.some((f) => f.type !== "PLAN_STAGE_MISSING") && (!bookingIds || bookingIds.includes(p.booking.id)),
  );
  let voided = 0;
  let raised = 0;
  let rebuilt = 0;
  let summariesFixed = 0;
  const skipped: string[] = [];
  const keptSatisfied: string[] = [];
  const company = await loadCompanyRow(db, scope.companyId);
  for (const p of targets) {
    // counted per committed transaction (the unit of work may be retried on 40001 / 40P01)
    const r = await moneyTransaction(db, async (tx) => {
      const c = { voided: 0, raised: 0, summaryFixed: false, skipped: [] as string[], kept: [] as string[] };
      // lock order (money/common.ts): the booking first, then its demand rows. The report above ran without locks, so the booking is
      // CHECKED AGAIN under its lock — booking row, tower stages and demands re-read — and a demand is voided only when the admin confirmed
      // it (it was in the report) AND it is still unjustified now: a stage completed since the report justifies its demand again, and a
      // payment applied since the report must never be voided away.
      const clock = new Clock();
      await lockBooking(tx, p.booking.id, clock);
      const [fresh] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, p.booking.id), inArray(bookings.status, ["ACTIVE", "COMPLETED"])))
        .limit(1);
      if (!fresh) return c; // cancelled since the report: its ledger is closed and left alone
      const [stages, nonVoid] = await Promise.all([
        loadTowerStages(tx, fresh.blockId),
        tx
          .select()
          .from(demands)
          .where(and(eq(demands.bookingId, fresh.id), ne(demands.status, "VOID")))
          .orderBy(asc(demands.postedAt), asc(demands.installmentSeq)),
      ]);
      const now = await checkBooking(tx, fresh, stages, nonVoid, todayDate(), company.settings.demand_due_days, {
        ledger: false,
      });
      const confirmed = new Set(p.voidable.map((d) => d.id));
      const stillVoidable = new Set(now.voidable.map((d) => d.id));
      for (const d of nonVoid) {
        if (!confirmed.has(d.id)) continue;
        if (!stillVoidable.has(d.id)) {
          c.kept.push(d.demandNumber);
          continue;
        }
        const ok = await voidDemand(tx, d, "Integrity repair: demand not justified by the plan/stages", actor, {
          clock,
        });
        if (ok) c.voided += 1;
        else c.skipped.push(d.demandNumber);
      }
      if (now.missing > 0 && fresh.status === "ACTIVE")
        c.raised += (await raiseDues(tx, fresh, { actor, clock, company, towerStages: stages })).raised.length;
      const rb = await rebuild(tx, p.booking.id, { write: true, reason: "INTEGRITY_REPAIR", actor });
      c.summaryFixed = p.summaryMismatch || rb.mismatches.length > 0 || rb.rowMismatches.length > 0;
      await recomputeDemandStatuses(tx, p.booking.id);
      await writeAudit(tx, {
        companyId: p.booking.companyId,
        actor,
        action: "integrity.repair",
        entityType: "booking",
        entityId: p.booking.id,
        after: {
          findings: p.findings.map((f) => f.type),
          voided: c.voided,
          skipped_with_payments: c.skipped,
          kept_now_satisfied: c.kept,
          missing_raised: c.raised,
        },
        ip: actor.ip ?? null,
        requestId: actor.requestId ?? null,
      });
      return c;
    });
    voided += r.voided;
    raised += r.raised;
    rebuilt += 1;
    if (r.summaryFixed) summariesFixed += 1;
    skipped.push(...r.skipped);
    keptSatisfied.push(...r.kept);
  }
  const after = await runReport(db, scope, { triggeredBy: actor.id ?? null });
  return {
    demands_voided: voided,
    demands_raised: raised,
    ledgers_rebuilt: rebuilt,
    summaries_fixed: summariesFixed,
    skipped_with_payments: [...new Set(skipped)],
    kept_now_satisfied: [...new Set(keptSatisfied)],
    report_after: after.report,
  };
}

/** Nightly job body: report for the whole company; notify Super Admin + Accounts when findings exist. */
export async function nightlyIntegrity(db: DB, companyId: string): Promise<IntegrityReportResponse> {
  const { report } = await runReport(db, { companyId }, { triggeredBy: null });
  if (!report.ok) {
    await db.transaction(async (tx) => {
      await notifyRole(tx, companyId, INTEGRITY_ROLES, {
        type: "INTEGRITY_FINDINGS",
        title: `Integrity report: ${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}`,
        body: Object.entries(report.counts)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}: ${n}`)
          .join(", "),
        entityType: "integrity_run",
        entityId: report.run_id,
        link: "/admin/integrity",
      });
    });
  }
  return report;
}

/** Stored runs (newest first). */
export async function listRuns(
  db: Executor,
  companyId: string,
  limit = 25,
): Promise<(typeof integrityRuns.$inferSelect)[]> {
  return db
    .select()
    .from(integrityRuns)
    .where(eq(integrityRuns.companyId, companyId))
    .orderBy(desc(integrityRuns.ranAt))
    .limit(limit);
}
