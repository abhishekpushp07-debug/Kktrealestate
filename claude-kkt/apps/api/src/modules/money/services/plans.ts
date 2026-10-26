/**
 * Payment plans ↔ towers (SPEC §8): assignment validation against the tower's stage sequence, the applicable-plan list a booking
 * wizard shows (default first), plan snapshots taken at booking and the live schedule preview.
 */
import { and, asc, eq, inArray, isNull, lte, gte, or, sql, type SQL } from "drizzle-orm";
import type { ApplicablePlanRow, InstallmentRow, SchedulePreviewResponse, TriggerType } from "@kkt/contracts";
import {
  blockStages,
  blocks,
  bookings,
  constructionStages,
  paymentPlanAssignments,
  paymentPlanInstallments,
  paymentPlans,
  projects,
  type Executor,
  type PlanSnapshot,
} from "@kkt/db";
import { missingStagesForTower, schedulePreview, triggerLabel } from "@kkt/domain";
import { ApiError } from "../../../lib/errors.js";
import { loadTowerStages, snapshotInstallments, todayDate } from "../common.js";

export type PlanRecord = typeof paymentPlans.$inferSelect;
export type InstallmentRecord = typeof paymentPlanInstallments.$inferSelect;
export type AssignmentRecord = typeof paymentPlanAssignments.$inferSelect;

/** A plan with its installments (stage names resolved). */
export interface LoadedPlan {
  plan: PlanRecord;
  installments: (InstallmentRecord & { stageName: string | null })[];
}

/** Loads an active plan of the company with its installments; 400 when unknown. */
export async function loadPlan(
  db: Executor,
  companyId: string,
  planId: string,
  opts: { allowInactive?: boolean } = {},
): Promise<LoadedPlan> {
  const [plan] = await db
    .select()
    .from(paymentPlans)
    .where(and(eq(paymentPlans.id, planId), eq(paymentPlans.companyId, companyId)))
    .limit(1);
  if (!plan) throw ApiError.badRequest("plan_id does not exist", { field: "plan_id" });
  if (!plan.isActive && !opts.allowInactive) throw ApiError.rule("Payment plan is inactive", "PLAN_INACTIVE");
  const loaded = await loadPlansInstallments(db, [plan.id]);
  return { plan, installments: loaded.get(plan.id) ?? [] };
}

/** Installments of many plans in one query (with stage names), keyed by plan id. */
export async function loadPlansInstallments(
  db: Executor,
  planIds: readonly string[],
): Promise<Map<string, (InstallmentRecord & { stageName: string | null })[]>> {
  const out = new Map<string, (InstallmentRecord & { stageName: string | null })[]>();
  if (planIds.length === 0) return out;
  const rows = await db
    .select({ i: paymentPlanInstallments, stageName: constructionStages.name })
    .from(paymentPlanInstallments)
    .leftJoin(constructionStages, eq(constructionStages.id, paymentPlanInstallments.triggerStageId))
    .where(inArray(paymentPlanInstallments.planId, [...planIds]))
    .orderBy(asc(paymentPlanInstallments.planId), asc(paymentPlanInstallments.seq));
  for (const r of rows) {
    const list = out.get(r.i.planId) ?? [];
    list.push({ ...r.i, stageName: r.stageName ?? null });
    out.set(r.i.planId, list);
  }
  return out;
}

/** Wire rows of a plan's installments (cumulative percent, labels). */
export function installmentRows(
  installments: readonly (InstallmentRecord & { stageName: string | null })[],
): InstallmentRow[] {
  let cumulative = 0;
  return installments.map((i) => {
    cumulative = Math.round((cumulative + Number(i.percent)) * 100) / 100;
    const inst = {
      seq: i.seq,
      name: i.name,
      percent: Number(i.percent),
      triggerType: i.triggerType as TriggerType,
      triggerDays: i.triggerDays,
      triggerStageId: i.triggerStageId,
      triggerStageName: i.stageName,
      triggerDate: i.triggerDate,
      dueDays: i.dueDays,
    };
    return {
      id: i.id,
      seq: i.seq,
      name: i.name,
      percent: Number(i.percent),
      cumulative_percent: cumulative,
      trigger_type: i.triggerType,
      trigger_days: i.triggerDays,
      trigger_stage_id: i.triggerStageId,
      trigger_stage_name: i.stageName,
      trigger_date: i.triggerDate,
      due_days: i.dueDays,
      trigger_label: triggerLabel(inst, i.stageName),
      notes: i.notes,
    };
  });
}

/** Snapshot of a plan as stored on a booking (installments resolved with stage names; due days defaulted). */
export function buildPlanSnapshot(loaded: LoadedPlan, defaultDueDays: number): PlanSnapshot {
  return {
    plan_id: loaded.plan.id,
    name: loaded.plan.name,
    code: loaded.plan.code,
    plan_type: loaded.plan.planType,
    grace_days: loaded.plan.graceDays,
    installments: loaded.installments.map((i) => ({
      seq: i.seq,
      name: i.name,
      percent: Number(i.percent),
      trigger_type: i.triggerType,
      trigger_days: i.triggerDays,
      trigger_stage_id: i.triggerStageId,
      trigger_stage_name: i.stageName,
      trigger_date: i.triggerDate,
      due_days: i.dueDays ?? defaultDueDays,
    })),
  };
}

/** Stage ids of the blocks an assignment covers: the one block, or every active block of the project. */
async function stageIdsOfScope(
  db: Executor,
  projectId: string,
  blockId: string | null,
): Promise<{ blockId: string; blockName: string; stageIds: string[] }[]> {
  const where: SQL = blockId
    ? eq(blocks.id, blockId)
    : and(eq(blocks.projectId, projectId), eq(blocks.isActive, true))!;
  const rows = await db
    .select({ id: blocks.id, name: blocks.name, stageSequence: blocks.stageSequence })
    .from(blocks)
    .where(where);
  const ids = rows.map((r) => r.id);
  const snap = ids.length
    ? await db
        .select({ blockId: blockStages.blockId, stageId: blockStages.stageId })
        .from(blockStages)
        .where(inArray(blockStages.blockId, ids))
    : [];
  const byBlock = new Map<string, string[]>();
  for (const s of snap) byBlock.set(s.blockId, [...(byBlock.get(s.blockId) ?? []), s.stageId]);
  // A block without snapshot records yet falls back to its configured stage sequence.
  return rows.map((r) => ({ blockId: r.id, blockName: r.name, stageIds: byBlock.get(r.id) ?? r.stageSequence }));
}

/**
 * SPEC §8: a plan with ON_STAGE installments can only be assigned to towers whose stage sequence contains those stages.
 * Throws 409 PLAN_STAGES_MISSING with details.missing_stages [{id, name, block_id, block_name}] otherwise.
 */
export async function assertPlanFitsScope(
  db: Executor,
  loaded: LoadedPlan,
  projectId: string,
  blockId: string | null,
): Promise<void> {
  const scopes = await stageIdsOfScope(db, projectId, blockId);
  if (blockId && scopes.length === 0)
    throw ApiError.badRequest("block_id does not belong to the project", { field: "block_id" });
  const installments = loaded.installments.map((i) => ({
    seq: i.seq,
    triggerType: i.triggerType as TriggerType,
    triggerStageId: i.triggerStageId,
  }));
  const missing: { id: string; name: string; block_id: string; block_name: string }[] = [];
  for (const scope of scopes) {
    for (const id of missingStagesForTower(installments, scope.stageIds)) {
      const name = loaded.installments.find((i) => i.triggerStageId === id)?.stageName ?? id;
      missing.push({ id, name, block_id: scope.blockId, block_name: scope.blockName });
    }
  }
  if (missing.length > 0) {
    const names = [...new Set(missing.map((m) => m.name))].join(", ");
    throw ApiError.conflict(
      "PLAN_STAGES_MISSING",
      `Plan "${loaded.plan.name}" references stages missing from the tower's stage sequence: ${names}`,
      { missing_stages: missing },
    );
  }
}

/** One missing stage of an assignment that no longer fits (details.missing_stages of 409 PLAN_STAGES_MISSING). */
export interface MissingAssignmentStage {
  id: string;
  name: string;
  block_id: string;
  block_name: string;
  plan_id: string;
  plan_name: string;
  assignment_id: string;
}

/**
 * An ACTIVE booking of the tower whose plan SNAPSHOT has an installment the tower could no longer raise (details.stranded_bookings of
 * 409 PLAN_STAGES_MISSING): an ON_STAGE installment on a stage the tower lacks, or an ON_POSSESSION one without a possession stage.
 */
export interface StrandedBookingInstallment {
  booking_id: string;
  booking_number: string;
  installment_seq: number;
  installment_name: string;
  stage_id: string | null;
  stage_name: string | null;
}

function throwMissing(
  missing: readonly MissingAssignmentStage[],
  what: string,
  stranded: readonly StrandedBookingInstallment[] = [],
): void {
  if (missing.length === 0 && stranded.length === 0) return;
  const lines = [
    ...new Set(missing.map((m) => `"${m.plan_name}" needs ${m.name} on ${m.block_name}`)),
    ...new Set(
      stranded.map(
        (s) =>
          `booking ${s.booking_number} installment ${s.installment_seq} "${s.installment_name}" needs ${s.stage_name ?? (s.stage_id ? s.stage_id : "a possession stage")}`,
      ),
    ),
  ].join("; ");
  throw ApiError.conflict(
    "PLAN_STAGES_MISSING",
    `${what} would leave payment plans referencing stages the tower does not have: ${lines}`,
    { missing_stages: missing, stranded_bookings: stranded },
  );
}

/**
 * ACTIVE bookings of a block whose plan snapshot (taken at booking, never re-read from the plan) has an installment the block's CURRENT
 * stage records cannot trigger. Such an installment is never raised and blocks handover forever, so a stage-sequence change that
 * strands one is refused (audit E3: plan ↔ tower fit at every change point — the bookings' own snapshots included).
 */
async function strandedBookingInstallments(db: Executor, blockId: string): Promise<StrandedBookingInstallment[]> {
  const rows = await db
    .select({ id: bookings.id, bookingNumber: bookings.bookingNumber, planSnapshot: bookings.planSnapshot })
    .from(bookings)
    .where(and(eq(bookings.blockId, blockId), eq(bookings.status, "ACTIVE")));
  if (rows.length === 0) return [];
  const stages = await loadTowerStages(db, blockId);
  const stageIds = new Set(stages.map((s) => s.stageId));
  const hasPossession = stages.some((s) => s.isPossession);
  const out: StrandedBookingInstallment[] = [];
  for (const b of rows) {
    for (const i of b.planSnapshot.installments) {
      const missingStage = i.trigger_type === "ON_STAGE" && !!i.trigger_stage_id && !stageIds.has(i.trigger_stage_id);
      const missingPossession = i.trigger_type === "ON_POSSESSION" && !hasPossession;
      if (missingStage || missingPossession) {
        out.push({
          booking_id: b.id,
          booking_number: b.bookingNumber,
          installment_seq: i.seq,
          installment_name: i.name,
          stage_id: missingStage ? (i.trigger_stage_id ?? null) : null,
          stage_name: missingStage ? (i.trigger_stage_name ?? null) : null,
        });
      }
    }
  }
  return out;
}

/**
 * Plan ↔ tower fit at every change point (SPEC §8, audit E3): re-validates every ACTIVE assignment covering `blockId` (block-specific
 * and project-wide) against the block's CURRENT stage records — call it after a block's stage sequence was replaced or a block was
 * created under a project-wide assignment, inside the same transaction, so a misfit rolls the change back with 409 PLAN_STAGES_MISSING.
 */
export async function assertAssignmentsFitBlock(
  db: Executor,
  companyId: string,
  blockId: string,
  what = "This change",
): Promise<void> {
  const [block] = await db
    .select({ id: blocks.id, projectId: blocks.projectId })
    .from(blocks)
    .where(and(eq(blocks.id, blockId), eq(blocks.companyId, companyId)))
    .limit(1);
  if (!block) return;
  // the tower's ACTIVE bookings carry their own plan snapshots: none may be left with an installment the new stages cannot raise
  const stranded = await strandedBookingInstallments(db, blockId);
  const assignments = await db
    .select({ a: paymentPlanAssignments, plan: paymentPlans })
    .from(paymentPlanAssignments)
    .innerJoin(paymentPlans, eq(paymentPlans.id, paymentPlanAssignments.planId))
    .where(
      and(
        eq(paymentPlanAssignments.companyId, companyId),
        eq(paymentPlanAssignments.projectId, block.projectId),
        or(eq(paymentPlanAssignments.blockId, blockId), isNull(paymentPlanAssignments.blockId)),
        eq(paymentPlanAssignments.isActive, true),
      ),
    );
  if (assignments.length === 0) {
    throwMissing([], what, stranded);
    return;
  }
  const scopes = await stageIdsOfScope(db, block.projectId, blockId);
  const installments = await loadPlansInstallments(
    db,
    assignments.map((x) => x.a.planId),
  );
  const missing: MissingAssignmentStage[] = [];
  for (const { a, plan } of assignments) {
    const inst = installments.get(plan.id) ?? [];
    for (const scope of scopes) {
      for (const id of missingStagesForTower(
        inst.map((i) => ({ seq: i.seq, triggerType: i.triggerType as TriggerType, triggerStageId: i.triggerStageId })),
        scope.stageIds,
      )) {
        missing.push({
          id,
          name: inst.find((i) => i.triggerStageId === id)?.stageName ?? id,
          block_id: scope.blockId,
          block_name: scope.blockName,
          plan_id: plan.id,
          plan_name: plan.name,
          assignment_id: a.id,
        });
      }
    }
  }
  throwMissing(missing, what, stranded);
}

/**
 * Re-validates every ACTIVE assignment of a plan (each tower it covers) against the plan's CURRENT installments — call it after the
 * plan's installments were replaced (masters edit), inside the same transaction → 409 PLAN_STAGES_MISSING when an assigned tower lacks a stage.
 */
export async function assertPlanFitsActiveAssignments(
  db: Executor,
  companyId: string,
  planId: string,
  what = "This plan edit",
): Promise<void> {
  const assignments = await db
    .select()
    .from(paymentPlanAssignments)
    .where(
      and(
        eq(paymentPlanAssignments.companyId, companyId),
        eq(paymentPlanAssignments.planId, planId),
        eq(paymentPlanAssignments.isActive, true),
      ),
    );
  if (assignments.length === 0) return;
  const loaded = await loadPlan(db, companyId, planId, { allowInactive: true });
  const inst = loaded.installments.map((i) => ({
    seq: i.seq,
    triggerType: i.triggerType as TriggerType,
    triggerStageId: i.triggerStageId,
  }));
  const missing: MissingAssignmentStage[] = [];
  for (const a of assignments) {
    for (const scope of await stageIdsOfScope(db, a.projectId, a.blockId)) {
      for (const id of missingStagesForTower(inst, scope.stageIds)) {
        missing.push({
          id,
          name: loaded.installments.find((i) => i.triggerStageId === id)?.stageName ?? id,
          block_id: scope.blockId,
          block_name: scope.blockName,
          plan_id: loaded.plan.id,
          plan_name: loaded.plan.name,
          assignment_id: a.id,
        });
      }
    }
  }
  throwMissing(missing, what);
}

/** Active assignments covering a block on a date (block-specific and project-wide), block default first, then project default. */
export async function applicableAssignments(
  db: Executor,
  companyId: string,
  projectId: string,
  blockId: string,
  onDate: string = todayDate(),
): Promise<(AssignmentRecord & { plan: PlanRecord })[]> {
  const rows = await db
    .select({ a: paymentPlanAssignments, plan: paymentPlans })
    .from(paymentPlanAssignments)
    .innerJoin(paymentPlans, eq(paymentPlans.id, paymentPlanAssignments.planId))
    .where(
      and(
        eq(paymentPlanAssignments.companyId, companyId),
        eq(paymentPlanAssignments.projectId, projectId),
        or(eq(paymentPlanAssignments.blockId, blockId), isNull(paymentPlanAssignments.blockId)),
        eq(paymentPlanAssignments.isActive, true),
        eq(paymentPlans.isActive, true),
        or(isNull(paymentPlanAssignments.effectiveFrom), lte(paymentPlanAssignments.effectiveFrom, onDate)),
        or(isNull(paymentPlanAssignments.effectiveTo), gte(paymentPlanAssignments.effectiveTo, onDate)),
      ),
    )
    .orderBy(asc(paymentPlans.name));
  const seen = new Set<string>();
  const list = rows
    .map((r) => ({ ...r.a, plan: r.plan }))
    .sort((x, y) => {
      // block-level default, then project default, then block-specific, then alphabetical
      const rank = (a: AssignmentRecord) => (a.isDefault ? (a.blockId ? 0 : 1) : a.blockId ? 2 : 3);
      return rank(x) - rank(y) || x.plan.name.localeCompare(y.plan.name);
    })
    .filter((a) => (seen.has(a.planId) ? false : (seen.add(a.planId), true)));
  // exactly one plan is flagged default in the response: the highest-ranked default
  let defaultSeen = false;
  return list.map((a) => {
    if (a.isDefault && !defaultSeen) {
      defaultSeen = true;
      return a;
    }
    return { ...a, isDefault: false };
  });
}

/** Applicable plans of a block as the wizard shows them (default first, installments included). */
export async function applicablePlanRows(
  db: Executor,
  companyId: string,
  projectId: string,
  blockId: string,
  onDate?: string,
): Promise<ApplicablePlanRow[]> {
  const assignments = await applicableAssignments(db, companyId, projectId, blockId, onDate);
  const installments = await loadPlansInstallments(
    db,
    assignments.map((a) => a.planId),
  );
  return assignments.map((a) => ({
    plan_id: a.planId,
    name: a.plan.name,
    code: a.plan.code,
    plan_type: a.plan.planType,
    grace_days: a.plan.graceDays,
    is_default: a.isDefault,
    installments: installmentRows(installments.get(a.planId) ?? []),
  }));
}

/** Resolves the plan for a new booking: the given one must be applicable (409 PLAN_NOT_APPLICABLE); omitted → the block's default. */
export async function resolveBookingPlan(
  db: Executor,
  companyId: string,
  projectId: string,
  blockId: string,
  bookingDate: string,
  planId: string | null | undefined,
): Promise<LoadedPlan> {
  const applicable = await applicableAssignments(db, companyId, projectId, blockId, bookingDate);
  if (planId) {
    if (!applicable.some((a) => a.planId === planId)) {
      throw ApiError.conflict(
        "PLAN_NOT_APPLICABLE",
        "This payment plan is not assigned to the booking's tower or project",
        { plan_id: planId, applicable_plan_ids: applicable.map((a) => a.planId) },
      );
    }
    return loadPlan(db, companyId, planId);
  }
  const def = applicable.find((a) => a.isDefault) ?? applicable[0];
  if (!def)
    throw ApiError.conflict(
      "PLAN_NOT_APPLICABLE",
      "No payment plan is assigned to this tower or project; assign one first",
      { applicable_plan_ids: [] },
    );
  return loadPlan(db, companyId, def.planId);
}

/** Live schedule preview for the wizard (SPEC §8): real completed stage dates drive the catch-up figure. */
export async function previewSchedule(
  db: Executor,
  companyId: string,
  input: {
    plan_id: string;
    block_id: string;
    booking_date: string;
    cash_agreed_paise: number;
    account_agreed_paise: number;
  },
  defaultDueDays: number,
): Promise<SchedulePreviewResponse> {
  const [block] = await db
    .select({ id: blocks.id, projectId: blocks.projectId })
    .from(blocks)
    .where(and(eq(blocks.id, input.block_id), eq(blocks.companyId, companyId)))
    .limit(1);
  if (!block) throw ApiError.notFound("Block");
  const loaded = await loadPlan(db, companyId, input.plan_id);
  const snapshot = buildPlanSnapshot(loaded, defaultDueDays);
  const towerStages = await loadTowerStages(db, block.id);
  const today = todayDate();
  const rows = schedulePreview({
    booking: {
      bookingDate: input.booking_date,
      cashAgreedPaise: input.cash_agreed_paise,
      accountAgreedPaise: input.account_agreed_paise,
      planSnapshot: { installments: snapshotInstallments(snapshot) },
    },
    towerStages,
    existingDemands: [],
    today,
    defaultDueDays,
  });
  const inst = snapshotInstallments(snapshot);
  let catchUp = 0;
  const out = rows.map((r) => {
    const i = inst.find((x) => x.seq === r.seq)!;
    // satisfied now = trigger date known and not in the future (ON_BOOKING counts from the booking date itself)
    const satisfied =
      r.expectedTriggerDate !== null && (i.triggerType === "ON_BOOKING" || r.expectedTriggerDate <= today);
    if (satisfied) catchUp += r.totalPaise;
    return {
      seq: r.seq,
      name: r.name,
      percent: Number(r.percent),
      cumulative_percent: Number(r.cumulativePercent),
      trigger_type: r.triggerType,
      trigger_label: r.triggerLabel,
      expected_date: r.expectedTriggerDate,
      already_satisfied: satisfied,
      cash_paise: r.cashPaise,
      account_paise: r.accountPaise,
      total_paise: r.totalPaise,
    };
  });
  return {
    plan_id: loaded.plan.id,
    rows: out,
    totals: {
      cash_paise: out.reduce((s, r) => s + r.cash_paise, 0),
      account_paise: out.reduce((s, r) => s + r.account_paise, 0),
      total_paise: out.reduce((s, r) => s + r.total_paise, 0),
    },
    catch_up_paise: catchUp,
  };
}

/** Clears the previous default of the same scope (block, or project-wide) so exactly one default remains. */
export async function clearOtherDefaults(
  tx: Executor,
  companyId: string,
  projectId: string,
  blockId: string | null,
  exceptId: string | null,
): Promise<void> {
  await tx
    .update(paymentPlanAssignments)
    .set({ isDefault: false, version: sql`${paymentPlanAssignments.version} + 1` })
    .where(
      and(
        eq(paymentPlanAssignments.companyId, companyId),
        eq(paymentPlanAssignments.projectId, projectId),
        blockId ? eq(paymentPlanAssignments.blockId, blockId) : isNull(paymentPlanAssignments.blockId),
        eq(paymentPlanAssignments.isDefault, true),
        exceptId ? sql`${paymentPlanAssignments.id} <> ${exceptId}` : undefined,
      ),
    );
}

/** Project name + block name lookup for assignment rows. */
export async function scopeNames(
  db: Executor,
  projectIds: readonly string[],
  blockIds: readonly string[],
): Promise<{ projects: Map<string, string>; blocks: Map<string, string> }> {
  const pIds = [...new Set(projectIds)];
  const bIds = [...new Set(blockIds)];
  const [p, b] = await Promise.all([
    pIds.length
      ? db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, pIds))
      : Promise.resolve([]),
    bIds.length
      ? db.select({ id: blocks.id, name: blocks.name }).from(blocks).where(inArray(blocks.id, bIds))
      : Promise.resolve([]),
  ]);
  return { projects: new Map(p.map((x) => [x.id, x.name])), blocks: new Map(b.map((x) => [x.id, x.name])) };
}
