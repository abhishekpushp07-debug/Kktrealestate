/**
 * Construction module services (SPEC §9): tower stage records, jump-ahead completion, the UNDO RULE, photos with buyer/website flags,
 * derived construction % and the notifications that go with it. Money maths never lives here – stage completion hands the tower to
 * money.raiseDuesForBlock() and undo to money.voidDemandsForStage() inside the same transaction; undoing the possession stage also
 * un-demands the on-possession other charges the engine demanded (a paid one blocks the undo) and rebuilds those ledgers.
 */
import { and, asc, eq, exists, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type {
  BlockConstructionResponse, BlockStageRow, BlockStageTimeline, ConstructionStatusUpdateResponse, ConstructionUndoResponse,
  ProjectConstructionBlockRow, ProjectConstructionResponse, StagePhotoCreate, StagePhotoRow, StagePhotoUpdate, StageStatus, StageTimelinePhoto,
} from "@kkt/contracts";
import { blockStages, blocks, bookingOtherCharges, bookings, demands, documents, projects, roles, stagePhotos, userProjectScopes, users, type Executor, type Tx } from "@kkt/db";
import { formatINR, todayIST } from "@kkt/domain";
import { writeAudit, type AuditActor } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { ensureProjectAccess, type StaffContext } from "../../lib/scope.js";
import { applyUpdate, assertVersion } from "../../lib/version.js";
import { signedUrl } from "../documents/index.js";
import { OTHER_CHARGE_ENTITY_TYPE, lockBookingsInOrder, raiseDuesForBlock, rebuild, voidDemandsForStage } from "../money/index.js";
import { notify, withdraw } from "../notifications/index.js";

export type BlockRecord = typeof blocks.$inferSelect;
export type BlockStageRecord = typeof blockStages.$inferSelect;
export type StagePhotoRecord = typeof stagePhotos.$inferSelect;

/** Who is acting (request metadata optional for jobs / seed). */
export interface ConstructionActor extends AuditActor {
  ip?: string | null;
  requestId?: string | null;
}

/** Scope fields the loaders need. */
export type ScopedUser = Pick<StaffContext, "companyId" | "allProjects" | "projectIds">;

/** Notification entity type used for stage completion (withdrawn by entity on undo). */
export const STAGE_ENTITY_TYPE = "block_stage";
/** Staff roles whose bell shows "stage completed" (scoped Project Admins only for their projects). */
export const STAGE_STAFF_ROLES = ["Super Admin", "Project Admin"] as const;
/** Document kinds a stage photo may come from (the stage itself, or the block / project gallery). */
const PHOTO_ENTITY_TYPES = new Set(["STAGE", "BLOCK", "PROJECT"]);

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Loads a block the user may see (404 for unknown or out-of-scope), optionally locked FOR UPDATE. */
export async function loadBlockScoped(db: Executor, user: ScopedUser, blockId: string, forUpdate = false): Promise<BlockRecord> {
  const q = db.select().from(blocks).where(and(eq(blocks.id, blockId), eq(blocks.companyId, user.companyId))).limit(1).$dynamic();
  const [row] = await (forUpdate ? q.for("update") : q);
  if (!row) throw ApiError.notFound("Block");
  ensureProjectAccess(user, row.projectId, "Block");
  return row;
}

/** Stage records of a block in sequence order (locked when the caller is about to change them). */
export async function loadStages(db: Executor, blockId: string, forUpdate = false): Promise<BlockStageRecord[]> {
  const q = db.select().from(blockStages).where(eq(blockStages.blockId, blockId)).orderBy(asc(blockStages.sortOrder), asc(blockStages.id)).$dynamic();
  return forUpdate ? q.for("update") : q;
}

/** Resolves a stage of the block by its master stage id or by the block_stages row id. */
export function findStage(stages: readonly BlockStageRecord[], ref: string): BlockStageRecord | undefined {
  return stages.find((s) => s.stageId === ref || s.id === ref);
}

/** Like findStage() but 404 when absent. */
export function requireStage(stages: readonly BlockStageRecord[], ref: string): BlockStageRecord {
  const s = findStage(stages, ref);
  if (!s) throw ApiError.notFound("Stage");
  return s;
}

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

/** completed / total × 100, two decimals (display only – money never depends on it). */
export function constructionPercent(stages: readonly Pick<BlockStageRecord, "status">[]): number {
  if (stages.length === 0) return 0;
  const done = stages.filter((s) => s.status === "COMPLETED").length;
  return Math.round((done / stages.length) * 10000) / 100;
}

/** Current stage (the IN_PROGRESS one, else the latest COMPLETED), the one up next and the latest completed (undo candidate). */
export function deriveProgress(stages: readonly BlockStageRecord[]): { current: BlockStageRecord | null; next: BlockStageRecord | null; latestCompleted: BlockStageRecord | null } {
  const inProgress = stages.find((s) => s.status === "IN_PROGRESS") ?? null;
  const completed = stages.filter((s) => s.status === "COMPLETED");
  const latestCompleted = completed.length > 0 ? completed[completed.length - 1]! : null;
  const current = inProgress ?? latestCompleted;
  const next = stages.find((s) => s.status !== "COMPLETED" && s.id !== current?.id && (current ? s.sortOrder > current.sortOrder : true)) ?? null;
  return { current, next, latestCompleted };
}

/** Writes the derived % onto the block, bumping its version (optimistic concurrency on the construction aggregate). */
export async function recomputeBlockPercent(tx: Executor, blockId: string, expectedVersion: number): Promise<BlockRecord> {
  const stages = await loadStages(tx, blockId);
  return applyUpdate(tx, blocks, blockId, expectedVersion, { constructionPercent: constructionPercent(stages) }, "block");
}

// ---------------------------------------------------------------------------
// Photo views
// ---------------------------------------------------------------------------

interface PhotoDoc { id: string; mime: string; hasVariants: boolean; isDeleted: boolean }

async function loadPhotoDocs(db: Executor, ids: readonly string[]): Promise<Map<string, PhotoDoc>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: documents.id, mime: documents.mime, variants: documents.variants, isDeleted: documents.isDeleted }).from(documents).where(inArray(documents.id, unique));
  return new Map(rows.map((d) => [d.id, { id: d.id, mime: d.mime, hasVariants: Boolean(d.variants?.thumb_key && d.variants?.medium_key), isDeleted: d.isDeleted }]));
}

function photoUrls(doc: PhotoDoc | undefined, ttl?: number): { thumb: string | null; medium: string | null } {
  if (!doc || doc.isDeleted || !doc.hasVariants) return { thumb: null, medium: null };
  return { thumb: signedUrl(doc.id, "thumb", ttl).url, medium: signedUrl(doc.id, "medium", ttl).url };
}

/** Wire rows of stage photos (signed thumb/medium urls; null when the image has no renditions or its document was deleted). */
export async function toPhotoRows(db: Executor, photos: readonly StagePhotoRecord[], ttl?: number): Promise<StagePhotoRow[]> {
  const docs = await loadPhotoDocs(db, photos.map((p) => p.documentId));
  return photos.map((p) => {
    const u = photoUrls(docs.get(p.documentId), ttl);
    return { id: p.id, block_stage_id: p.blockStageId, document_id: p.documentId, caption: p.caption, visible_to_buyers: p.visibleToBuyers, show_on_website: p.showOnWebsite, sort_order: p.sortOrder, thumb_url: u.thumb, medium_url: u.medium, created_at: p.createdAt.toISOString(), version: p.version };
  });
}

async function loadPhotosOfStages(db: Executor, stageRowIds: readonly string[], filter: { visibleToBuyersOnly?: boolean; websiteOnly?: boolean } = {}): Promise<StagePhotoRecord[]> {
  if (stageRowIds.length === 0) return [];
  return db.select().from(stagePhotos)
    .where(and(inArray(stagePhotos.blockStageId, [...stageRowIds]), filter.visibleToBuyersOnly ? eq(stagePhotos.visibleToBuyers, true) : undefined, filter.websiteOnly ? eq(stagePhotos.showOnWebsite, true) : undefined))
    .orderBy(asc(stagePhotos.sortOrder), asc(stagePhotos.createdAt), asc(stagePhotos.id));
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Non-void demand counts per stage of the block (ON_STAGE by trigger stage; ON_POSSESSION attributed to the possession stage). */
async function demandCounts(db: Executor, blockId: string, stages: readonly BlockStageRecord[]): Promise<Map<string, number>> {
  const rows = await db.select({ stageId: demands.triggerStageId, triggerType: demands.triggerType, n: sql<number>`count(*)::int` }).from(demands)
    .where(and(eq(demands.blockId, blockId), ne(demands.status, "VOID"))).groupBy(demands.triggerStageId, demands.triggerType);
  const possession = stages.find((s) => s.isPossession);
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = r.triggerType === "ON_POSSESSION" ? possession?.stageId ?? r.stageId : r.stageId;
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + Number(r.n));
  }
  return out;
}

/** The staff view of a tower's construction (GET /blocks/:id/construction): stages with photos, dates, demand counts and the undo candidate. */
export async function blockConstruction(db: Executor, block: BlockRecord, stages?: BlockStageRecord[]): Promise<BlockConstructionResponse> {
  const rows = stages ?? (await loadStages(db, block.id));
  const stageRowIds = rows.map((s) => s.id);
  const userIds = [...new Set(rows.map((s) => s.completedBy).filter((x): x is string => !!x))];
  const [photos, names, counts] = await Promise.all([
    loadPhotosOfStages(db, stageRowIds),
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([] as { id: string; name: string }[]),
    demandCounts(db, block.id, rows),
  ]);
  const photoRows = await toPhotoRows(db, photos);
  const byStage = new Map<string, StagePhotoRow[]>();
  for (const p of photoRows) byStage.set(p.block_stage_id, [...(byStage.get(p.block_stage_id) ?? []), p]);
  const nameOf = new Map(names.map((u) => [u.id, u.name]));
  const { current, next, latestCompleted } = deriveProgress(rows);
  const stageRows: BlockStageRow[] = rows.map((s) => ({
    id: s.id, block_id: s.blockId, stage_id: s.stageId, sort_order: s.sortOrder, name: s.name, is_possession: s.isPossession, status: s.status,
    started_on: s.startedOn, completed_on: s.completedOn, completed_by: s.completedBy, completed_by_name: s.completedBy ? nameOf.get(s.completedBy) ?? null : null,
    completed_at: s.completedAt ? s.completedAt.toISOString() : null, notes: s.notes, photos: byStage.get(s.id) ?? [],
    demands_raised: counts.get(s.stageId) ?? 0, can_undo: latestCompleted?.id === s.id,
  }));
  return {
    block_id: block.id, block_name: block.name, project_id: block.projectId, construction_percent: constructionPercent(rows),
    current_stage_id: current?.stageId ?? null, next_stage_id: next?.stageId ?? null, stages: stageRows, version: block.version,
  };
}

/** Options of blockStageTimeline(). */
export interface TimelineOptions {
  /** Portal: only photos flagged visible to buyers. */
  visibleToBuyersOnly?: boolean;
  /** Website: only photos flagged show on website. */
  websiteOnly?: boolean;
  /** Lifetime of the signed image links (default: the documents module's 15 minutes). */
  linkTtlSeconds?: number;
}

/**
 * The tower's stage timeline for the portal / public modules: stages in order with dates, notes and the photos that pass the flag filter
 * (signed thumb/medium urls; photos whose document was deleted are dropped). Null when the block does not exist. No scope check – callers
 * decide whose tower it is (portal: the buyer's own booking; public: a published project).
 */
export async function blockStageTimeline(executor: Executor, blockId: string, opts: TimelineOptions = {}): Promise<BlockStageTimeline | null> {
  const [block] = await executor.select().from(blocks).where(eq(blocks.id, blockId)).limit(1);
  if (!block) return null;
  const stages = await loadStages(executor, blockId);
  const photos = await loadPhotosOfStages(executor, stages.map((s) => s.id), { visibleToBuyersOnly: opts.visibleToBuyersOnly, websiteOnly: opts.websiteOnly });
  const docs = await loadPhotoDocs(executor, photos.map((p) => p.documentId));
  const byStage = new Map<string, StageTimelinePhoto[]>();
  const completedOn = new Map(stages.map((s) => [s.id, s.completedOn]));
  for (const p of photos) {
    const doc = docs.get(p.documentId);
    if (!doc || doc.isDeleted) continue;
    const u = photoUrls(doc, opts.linkTtlSeconds);
    const row: StageTimelinePhoto = { id: p.id, document_id: p.documentId, caption: p.caption, thumb_url: u.thumb, medium_url: u.medium, taken_on: completedOn.get(p.blockStageId) ?? null, visible_to_buyers: p.visibleToBuyers, show_on_website: p.showOnWebsite, sort_order: p.sortOrder };
    byStage.set(p.blockStageId, [...(byStage.get(p.blockStageId) ?? []), row]);
  }
  const { current, next } = deriveProgress(stages);
  return {
    block_id: block.id, block_name: block.name, project_id: block.projectId, construction_percent: constructionPercent(stages),
    current_stage_id: current?.stageId ?? null, current_stage_name: current?.name ?? null, next_stage_id: next?.stageId ?? null, next_stage_name: next?.name ?? null,
    stages: stages.map((s) => ({ id: s.id, stage_id: s.stageId, name: s.name, sort_order: s.sortOrder, is_possession: s.isPossession, status: s.status, started_on: s.startedOn, completed_on: s.completedOn, notes: s.notes, photos: byStage.get(s.id) ?? [] })),
  };
}

/** All towers of a project for dashboards / the website (GET /projects/:id/construction); scoped 404. */
export async function projectConstruction(db: Executor, user: ScopedUser, projectId: string): Promise<ProjectConstructionResponse> {
  const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.id, projectId), eq(projects.companyId, user.companyId))).limit(1);
  if (!project) throw ApiError.notFound("Project");
  ensureProjectAccess(user, project.id, "Project");
  const blockRows = await db.select().from(blocks).where(and(eq(blocks.projectId, project.id), eq(blocks.isActive, true))).orderBy(asc(blocks.sortOrder), asc(blocks.name), asc(blocks.id));
  const blockIds = blockRows.map((b) => b.id);
  const [stageRows, bookingCounts] = blockIds.length
    ? await Promise.all([
        db.select().from(blockStages).where(inArray(blockStages.blockId, blockIds)).orderBy(asc(blockStages.blockId), asc(blockStages.sortOrder), asc(blockStages.id)),
        db.select({ blockId: bookings.blockId, n: sql<number>`count(*)::int` }).from(bookings).where(and(inArray(bookings.blockId, blockIds), eq(bookings.status, "ACTIVE"))).groupBy(bookings.blockId),
      ])
    : [[], []];
  const stagesByBlock = new Map<string, BlockStageRecord[]>();
  for (const s of stageRows) stagesByBlock.set(s.blockId, [...(stagesByBlock.get(s.blockId) ?? []), s]);
  const activeBookings = new Map(bookingCounts.map((c) => [c.blockId, Number(c.n)]));
  const rows: ProjectConstructionBlockRow[] = blockRows.map((b) => {
    const stages = stagesByBlock.get(b.id) ?? [];
    const { current, next, latestCompleted } = deriveProgress(stages);
    const inProgress = stages.find((s) => s.status === "IN_PROGRESS") ?? null;
    return {
      block_id: b.id, block_name: b.name, block_code: b.code, status: b.status, construction_percent: constructionPercent(stages),
      total_stages: stages.length, completed_stages: stages.filter((s) => s.status === "COMPLETED").length,
      current_stage_id: current?.stageId ?? null, current_stage_name: current?.name ?? null, next_stage_id: next?.stageId ?? null, next_stage_name: next?.name ?? null,
      in_progress_stage_name: inProgress?.name ?? null, last_completed_on: latestCompleted?.completedOn ?? null, active_bookings: activeBookings.get(b.id) ?? 0,
    };
  });
  const percent = rows.length ? Math.round((rows.reduce((a, r) => a + r.construction_percent, 0) / rows.length) * 100) / 100 : 0;
  return { project_id: project.id, project_name: project.name, construction_percent: percent, blocks: rows };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Customers of every ACTIVE booking on the tower (primary applicants + co-applicants), deduplicated. */
async function towerBuyers(tx: Executor, blockId: string): Promise<{ type: "CUSTOMER"; id: string }[]> {
  const rows = await tx.execute<{ customer_id: string }>(sql`
    select b.customer_id from bookings b where b.block_id = ${blockId}::uuid and b.status = 'ACTIVE'
    union
    select c.customer_id from booking_co_applicants c join bookings b on b.id = c.booking_id where b.block_id = ${blockId}::uuid and b.status = 'ACTIVE'`);
  return rows.map((r) => ({ type: "CUSTOMER" as const, id: r.customer_id }));
}

/** Stage row ids (of the given ones) that currently carry at least one photo visible to buyers. */
async function stagesWithVisiblePhotos(tx: Executor, stageRowIds: readonly string[]): Promise<Set<string>> {
  if (stageRowIds.length === 0) return new Set();
  const rows = await tx.select({ id: stagePhotos.blockStageId }).from(stagePhotos).where(and(inArray(stagePhotos.blockStageId, [...stageRowIds]), eq(stagePhotos.visibleToBuyers, true))).groupBy(stagePhotos.blockStageId);
  return new Set(rows.map((r) => r.id));
}

/** Buyer bell (SPEC §13): "stage completed on their tower" – only when the stage has photos visible to buyers. Returns notifications written. */
async function notifyBuyersStageCompleted(tx: Executor, block: BlockRecord, stage: BlockStageRecord, recipients: { type: "CUSTOMER"; id: string }[]): Promise<number> {
  if (recipients.length === 0) return 0;
  return notify(tx, {
    companyId: block.companyId, recipients, type: "STAGE_COMPLETED",
    title: `${stage.name} completed – ${block.name}`,
    body: `${stage.name} of ${block.name} was completed on ${stage.completedOn ?? todayIST()}. New construction photos are available.`,
    entityType: STAGE_ENTITY_TYPE, entityId: stage.id, link: `/construction/${block.id}`,
  });
}

/** Staff who get the "stage completed" bell: Super Admins and the Project Admins scoped to the block's project (the acting user is skipped). Loaded once per update. */
async function stageStaffRecipients(tx: Executor, block: BlockRecord, actorId: string | null): Promise<{ type: "STAFF"; id: string }[]> {
  const scoped = exists(tx.select({ one: sql`1` }).from(userProjectScopes).where(and(eq(userProjectScopes.userId, users.id), eq(userProjectScopes.projectId, block.projectId))));
  const staff = await tx.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.companyId, block.companyId), eq(users.isActive, true), inArray(roles.name, [...STAGE_STAFF_ROLES]), or(eq(users.allProjects, true), scoped), actorId ? ne(users.id, actorId) : undefined));
  return staff.map((s) => ({ type: "STAFF" as const, id: s.id }));
}

/** Staff bell for one completed stage. */
async function notifyStaffStageCompleted(tx: Executor, block: BlockRecord, stage: BlockStageRecord, recipients: { type: "STAFF"; id: string }[]): Promise<number> {
  if (recipients.length === 0) return 0;
  return notify(tx, {
    companyId: block.companyId, recipients, type: "STAGE_COMPLETED",
    title: `${block.name}: ${stage.name} completed`, body: `Completed on ${stage.completedOn ?? todayIST()}.`,
    entityType: STAGE_ENTITY_TYPE, entityId: stage.id, link: `/blocks/${block.id}/construction`,
  });
}

/** True when buyers already hold a live "stage completed" notification for the stage. */
async function buyersAlreadyNotified(tx: Executor, stageRowId: string): Promise<boolean> {
  const rows = await tx.execute<{ one: number }>(sql`select 1 as one from notifications where entity_type = ${STAGE_ENTITY_TYPE} and entity_id = ${stageRowId}::uuid and recipient_type = 'CUSTOMER' and is_withdrawn = false limit 1`);
  return rows.length > 0;
}

/**
 * When the first buyer-visible photo lands on an already COMPLETED stage, the buyers get their bell entry then (photos usually follow the
 * status update). The stage row is locked first so two photos arriving together cannot both ring the bell.
 */
async function notifyBuyersOnFirstVisiblePhoto(tx: Executor, block: BlockRecord, stage: BlockStageRecord): Promise<number> {
  const [current] = await tx.select().from(blockStages).where(eq(blockStages.id, stage.id)).for("update");
  if (!current || current.status !== "COMPLETED") return 0;
  if (await buyersAlreadyNotified(tx, current.id)) return 0;
  return notifyBuyersStageCompleted(tx, block, current, await towerBuyers(tx, block.id));
}

// ---------------------------------------------------------------------------
// Status update (jump-ahead)
// ---------------------------------------------------------------------------

/** Input of updateConstructionStatus(). */
export interface StatusUpdateInput {
  /** Stage reached (master stage id or block_stages row id). */
  stageRef: string;
  completedOn: string;
  /** Dates of the intermediate stages (keyed by master stage id or row id); an undated stage takes the date of the next dated one (ultimately completedOn). */
  intermediateDates: Record<string, string>;
  notes?: string | null | undefined;
  notifyBuyers: boolean;
  /** Optional later stage to mark IN_PROGRESS. */
  markInProgressRef?: string | null | undefined;
  expectedVersion: number;
}

function assertNotFuture(date: string, today: string, field: string): void {
  if (date > today) throw ApiError.badRequest(`${field} cannot be in the future`, { field, today });
}

/**
 * Marks the reached stage and every not-yet-completed stage before it COMPLETED (dates from intermediate_dates, default completed_on),
 * optionally marks a later stage IN_PROGRESS, recomputes the block %, raises dues for every ACTIVE booking of the tower (money engine,
 * same transaction), notifies buyers (only for stages with photos visible to buyers) and the project's admins, and audits everything.
 */
export async function updateConstructionStatus(tx: Tx, user: StaffContext, actor: ConstructionActor, blockId: string, input: StatusUpdateInput): Promise<ConstructionStatusUpdateResponse> {
  const today = todayIST();
  assertNotFuture(input.completedOn, today, "completed_on");
  const block = await loadBlockScoped(tx, user, blockId, true);
  await assertVersion(tx, blocks, block.id, block.version, input.expectedVersion, "block");
  const stages = await loadStages(tx, block.id, true);
  const target = requireStage(stages, input.stageRef);
  if (target.status === "COMPLETED") throw ApiError.rule(`${target.name} is already completed`, "STAGE_ALREADY_COMPLETED", { stage_id: target.stageId });
  const toComplete = stages.filter((s) => s.sortOrder <= target.sortOrder && s.status !== "COMPLETED");

  // intermediate dates must name stages that are being completed and must not lie in the future
  const dates = new Map<string, string>();
  for (const [ref, date] of Object.entries(input.intermediateDates)) {
    const s = findStage(toComplete, ref);
    if (!s) throw ApiError.badRequest("intermediate_dates names a stage that is not being completed", { field: "intermediate_dates", stage_id: ref });
    assertNotFuture(date, today, `intermediate_dates.${ref}`);
    if (date > input.completedOn) throw ApiError.badRequest("Intermediate stage dates cannot be after the reached stage's date", { field: "intermediate_dates", stage_id: ref });
    if (s.id === target.id && date !== input.completedOn) throw ApiError.badRequest("intermediate_dates gives the reached stage a date different from completed_on", { field: "intermediate_dates", stage_id: ref });
    dates.set(s.id, date);
  }
  // stages are built in order: completion dates must be non-decreasing along the sequence; an undated stage takes the date of the next dated one
  const resolvedDates = new Map<string, string>();
  let nextDate = input.completedOn;
  for (let i = toComplete.length - 1; i >= 0; i -= 1) {
    const s = toComplete[i]!;
    const date = s.id === target.id ? input.completedOn : dates.get(s.id) ?? nextDate;
    if (date > nextDate) throw ApiError.badRequest(`${s.name} cannot be completed after the stage that follows it`, { field: "intermediate_dates", stage_id: s.stageId, date, next_stage_date: nextDate });
    resolvedDates.set(s.id, date);
    nextDate = date;
  }
  let inProgress: BlockStageRecord | undefined;
  if (input.markInProgressRef) {
    inProgress = requireStage(stages, input.markInProgressRef);
    if (inProgress.sortOrder <= target.sortOrder || inProgress.status === "COMPLETED") throw ApiError.badRequest("mark_in_progress_stage_id must be a stage after the reached one that is not completed", { field: "mark_in_progress_stage_id" });
  }

  const now = new Date();
  const completed: BlockStageRecord[] = [];
  for (const s of toComplete) {
    const completedOn = resolvedDates.get(s.id) ?? input.completedOn;
    const notes = s.id === target.id && input.notes !== undefined ? input.notes : s.notes;
    const [row] = await tx.update(blockStages).set({ status: "COMPLETED", completedOn, completedBy: user.id, completedAt: now, notes, version: sql`${blockStages.version} + 1` }).where(eq(blockStages.id, s.id)).returning();
    if (!row) throw new Error("block stage vanished");
    completed.push(row);
    await writeAudit(tx, { companyId: block.companyId, actor, action: "block_stage.complete", entityType: STAGE_ENTITY_TYPE, entityId: s.id, before: { status: s.status, completed_on: s.completedOn }, after: { status: "COMPLETED", completed_on: completedOn, stage_id: s.stageId, name: s.name, block_id: block.id }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
  }
  if (inProgress) {
    await tx.update(blockStages).set({ status: "IN_PROGRESS", startedOn: inProgress.startedOn ?? input.completedOn, version: sql`${blockStages.version} + 1` }).where(eq(blockStages.id, inProgress.id));
    await writeAudit(tx, { companyId: block.companyId, actor, action: "block_stage.in_progress", entityType: STAGE_ENTITY_TYPE, entityId: inProgress.id, before: { status: inProgress.status }, after: { status: "IN_PROGRESS", started_on: inProgress.startedOn ?? input.completedOn, stage_id: inProgress.stageId, block_id: block.id }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
  }
  const updatedBlock = await recomputeBlockPercent(tx, block.id, block.version);

  // money: raise every installment the newly completed stages satisfy, for every ACTIVE booking of the tower (demand notifications are money's)
  const dues = await raiseDuesForBlock(tx, block.id, { today, actor });

  // bells
  let buyersNotified = 0;
  const visible = await stagesWithVisiblePhotos(tx, completed.map((s) => s.id));
  const buyers = input.notifyBuyers && visible.size > 0 ? await towerBuyers(tx, block.id) : [];
  const staff = await stageStaffRecipients(tx, block, user.id);
  for (const s of completed) {
    if (input.notifyBuyers && visible.has(s.id)) buyersNotified += await notifyBuyersStageCompleted(tx, block, s, buyers);
    await notifyStaffStageCompleted(tx, block, s, staff);
  }

  await writeAudit(tx, {
    companyId: block.companyId, actor, action: "construction.status_update", entityType: "block", entityId: block.id,
    before: { construction_percent: Number(block.constructionPercent) },
    after: { reached_stage_id: target.stageId, completed_stage_ids: completed.map((s) => s.stageId), completed_on: input.completedOn, intermediate_dates: input.intermediateDates, in_progress_stage_id: inProgress?.stageId ?? null, demands_raised: dues.raised.length, demand_numbers: dues.raised.map((d) => d.demandNumber), construction_percent: Number(updatedBlock.constructionPercent) },
    ip: actor.ip ?? null, requestId: actor.requestId ?? null,
  });
  return {
    block_id: block.id, completed_stage_ids: completed.map((s) => s.stageId), demands_raised: dues.raised.length, demand_numbers: dues.raised.map((d) => d.demandNumber),
    buyers_notified: buyersNotified, construction_percent: Number(updatedBlock.constructionPercent), version: updatedBlock.version,
  };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

const BLOCKING_RE = /^Demand (\S+) has been paid by receipt (\S+) dated (\d{4}-\d{2}-\d{2})/;

/** Parses the money engine's undo-rule sentences into structured receipts (best effort; the sentences themselves are always returned). */
export function parseBlockingReasons(reasons: readonly string[]): { receipt_number: string; payment_date: string; demand_number: string }[] {
  return reasons.flatMap((r) => {
    const m = BLOCKING_RE.exec(r);
    return m ? [{ demand_number: m[1]!, receipt_number: m[2]!, payment_date: m[3]! }] : [];
  });
}

type PossessionChargeLine = { line: typeof bookingOtherCharges.$inferSelect; booking: Pick<typeof bookings.$inferSelect, "id" | "bookingNumber" | "companyId"> };

/**
 * Other-charge lines demanded "on possession" on the tower's ACTIVE bookings (the possession stage's completion raised them through the
 * money engine). Each booking is locked (row + advisory, in id order like money does) before the lines are read.
 */
async function possessionChargeLines(tx: Tx, blockId: string): Promise<PossessionChargeLine[]> {
  const active = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.blockId, blockId), eq(bookings.status, "ACTIVE"))).orderBy(asc(bookings.id));
  await lockBookingsInOrder(tx, active.map((b) => b.id));
  if (active.length === 0) return [];
  return tx.select({ line: bookingOtherCharges, booking: { id: bookings.id, bookingNumber: bookings.bookingNumber, companyId: bookings.companyId } }).from(bookingOtherCharges)
    .innerJoin(bookings, eq(bookings.id, bookingOtherCharges.bookingId))
    .where(and(inArray(bookingOtherCharges.bookingId, active.map((b) => b.id)), eq(bookingOtherCharges.demandAt, "ON_POSSESSION"), isNotNull(bookingOtherCharges.demandedAt)))
    .orderBy(asc(bookings.id), asc(bookingOtherCharges.sortOrder), asc(bookingOtherCharges.id));
}

/**
 * UNDO RULE (SPEC §9): only the latest completed stage (409 UNDO_NOT_LATEST); money.voidDemandsForStage decides whether a payment dated
 * on/after one of its demands blocks it (409 UNDO_BLOCKED with details.reasons); otherwise demands are void, ledgers rebuilt, the stage's
 * completion data cleared, % recomputed, "stage completed" notifications withdrawn (unread deleted, read flagged) and the undo audited.
 * For the possession stage the on-possession other charges it demanded are un-demanded as well (a paid one blocks the undo), and the
 * affected ledgers are rebuilt from source.
 */
export async function undoStage(tx: Tx, user: StaffContext, actor: ConstructionActor, blockId: string, input: { stageRef: string; reason: string; expectedVersion: number }): Promise<ConstructionUndoResponse> {
  const block = await loadBlockScoped(tx, user, blockId, true);
  await assertVersion(tx, blocks, block.id, block.version, input.expectedVersion, "block");
  const stages = await loadStages(tx, block.id, true);
  const stage = requireStage(stages, input.stageRef);
  if (stage.status !== "COMPLETED") throw ApiError.rule(`${stage.name} is not completed`, "STAGE_NOT_COMPLETED", { stage_id: stage.stageId, status: stage.status });
  const { latestCompleted } = deriveProgress(stages);
  if (!latestCompleted || latestCompleted.id !== stage.id) {
    throw ApiError.conflict("UNDO_NOT_LATEST", `Only the latest completed stage (${latestCompleted?.name ?? "none"}) can be undone`, { latest_stage_id: latestCompleted?.stageId ?? null, latest_stage_name: latestCompleted?.name ?? null });
  }
  // lock order (money/common.ts): block row (held) → every booking the undo may touch, ascending id, before any of them is read
  const touched = await tx.select({ id: bookings.id }).from(bookings)
    .where(and(eq(bookings.blockId, block.id), or(eq(bookings.status, "ACTIVE"), exists(tx.select({ one: sql`1` }).from(demands).where(and(eq(demands.bookingId, bookings.id), ne(demands.status, "VOID")))))));
  await lockBookingsInOrder(tx, touched.map((b) => b.id));
  const chargeLines = stage.isPossession ? await possessionChargeLines(tx, block.id) : [];
  const chargeReasons = chargeLines.filter((c) => c.line.paidPaise > 0).map((c) => `Other charge ${c.line.name} (${c.line.demandNumber}) of ${c.booking.bookingNumber} has been paid ${formatINR(c.line.paidPaise)} since it was demanded on possession`);
  const result = await voidDemandsForStage(tx, block.id, stage.stageId, `Stage ${stage.name} undone: ${input.reason}`, actor);
  const reasons = [...(result.blocked ? result.reasons : []), ...chargeReasons];
  if (result.blocked || reasons.length > 0) {
    throw ApiError.conflict("UNDO_BLOCKED", `Cannot undo ${stage.name}: a demand it raised has been paid on/after its date`, { reasons, blocking_payments: parseBlockingReasons(reasons) });
  }
  const undemanded: string[] = [];
  let chargeBells = 0;
  for (const { line, booking } of chargeLines) {
    await tx.update(bookingOtherCharges).set({ demandedAt: null, demandNumber: null, dueDate: null }).where(eq(bookingOtherCharges.id, line.id));
    undemanded.push(line.demandNumber ?? line.id);
    // the charge's own demand bell (keyed by the line since TODO-integration #6) is withdrawn with it
    const bell = await withdraw(tx, OTHER_CHARGE_ENTITY_TYPE, line.id);
    chargeBells += bell.deleted + bell.withdrawn;
    await writeAudit(tx, {
      companyId: booking.companyId, actor, action: "other_charge.undemand", entityType: "booking_other_charge", entityId: line.id,
      before: { demand_number: line.demandNumber, demanded_at: line.demandedAt?.toISOString() ?? null, due_date: line.dueDate },
      after: { demand_number: null, demanded_at: null, due_date: null, booking_id: booking.id, reason: `Stage ${stage.name} undone: ${input.reason}` },
      ip: actor.ip ?? null, requestId: actor.requestId ?? null,
    });
  }
  for (const bookingId of new Set(chargeLines.map((c) => c.booking.id))) await rebuild(tx, bookingId, { write: true });
  await tx.update(blockStages).set({ status: "PENDING", completedOn: null, completedBy: null, completedAt: null, version: sql`${blockStages.version} + 1` }).where(eq(blockStages.id, stage.id));
  const updatedBlock = await recomputeBlockPercent(tx, block.id, block.version);
  const withdrawn = await withdraw(tx, STAGE_ENTITY_TYPE, stage.id);
  await writeAudit(tx, {
    companyId: block.companyId, actor, action: "construction.undo", entityType: STAGE_ENTITY_TYPE, entityId: stage.id,
    before: { status: "COMPLETED", completed_on: stage.completedOn, completed_by: stage.completedBy, construction_percent: Number(block.constructionPercent) },
    after: { status: "PENDING", reason: input.reason, stage_id: stage.stageId, name: stage.name, block_id: block.id, voided_demand_numbers: result.voided.map((d) => d.demandNumber), undemanded_charge_numbers: undemanded, notifications_deleted: withdrawn.deleted, notifications_withdrawn: withdrawn.withdrawn, construction_percent: Number(updatedBlock.constructionPercent) },
    ip: actor.ip ?? null, requestId: actor.requestId ?? null,
  });
  return {
    block_id: block.id, stage_id: stage.stageId, voided_demand_numbers: result.voided.map((d) => d.demandNumber), undemanded_charge_numbers: undemanded, withdrawn_notifications: withdrawn.deleted + withdrawn.withdrawn + chargeBells,
    construction_percent: Number(updatedBlock.constructionPercent), version: updatedBlock.version,
  };
}

// ---------------------------------------------------------------------------
// Non-financial stage edits
// ---------------------------------------------------------------------------

/** Input of patchStage(). */
export interface StagePatchInput {
  notes?: string | null | undefined;
  startedOn?: string | null | undefined;
  status?: Extract<StageStatus, "PENDING" | "IN_PROGRESS"> | undefined;
  expectedVersion: number;
}

/** PATCH /blocks/:id/construction/:stageId – notes, started_on and the PENDING ↔ IN_PROGRESS marker; COMPLETED is never set or unset here. */
export async function patchStage(tx: Tx, user: StaffContext, actor: ConstructionActor, blockId: string, stageRef: string, input: StagePatchInput): Promise<BlockConstructionResponse> {
  const today = todayIST();
  const block = await loadBlockScoped(tx, user, blockId, true);
  await assertVersion(tx, blocks, block.id, block.version, input.expectedVersion, "block");
  const stages = await loadStages(tx, block.id, true);
  const stage = requireStage(stages, stageRef);
  const changes: Partial<typeof blockStages.$inferInsert> = {};
  if (input.status !== undefined && input.status !== stage.status) {
    if (stage.status === "COMPLETED") throw ApiError.rule(`${stage.name} is completed; use undo to reopen it`, "STAGE_COMPLETED", { stage_id: stage.stageId });
    changes.status = input.status;
    changes.startedOn = input.status === "IN_PROGRESS" ? input.startedOn ?? stage.startedOn ?? today : input.startedOn ?? null;
  } else if (input.startedOn !== undefined) {
    changes.startedOn = input.startedOn;
  }
  if (changes.startedOn) assertNotFuture(changes.startedOn, today, "started_on");
  if (input.notes !== undefined) changes.notes = input.notes;
  if (Object.keys(changes).length === 0) throw ApiError.badRequest("Nothing to update");
  await tx.update(blockStages).set({ ...changes, version: sql`${blockStages.version} + 1` }).where(eq(blockStages.id, stage.id));
  const updatedBlock = await applyUpdate(tx, blocks, block.id, block.version, {}, "block");
  await writeAudit(tx, {
    companyId: block.companyId, actor, action: "block_stage.update", entityType: STAGE_ENTITY_TYPE, entityId: stage.id,
    before: { status: stage.status, started_on: stage.startedOn, notes: stage.notes }, after: { ...changes, stage_id: stage.stageId, block_id: block.id },
    ip: actor.ip ?? null, requestId: actor.requestId ?? null,
  });
  return blockConstruction(tx, updatedBlock);
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Loads a photo with its stage and block (company + scope → 404). */
export async function loadPhotoScoped(db: Executor, user: ScopedUser, photoId: string, forUpdate = false): Promise<{ photo: StagePhotoRecord; stage: BlockStageRecord; block: BlockRecord }> {
  const q = db.select({ photo: stagePhotos, stage: blockStages, block: blocks }).from(stagePhotos)
    .innerJoin(blockStages, eq(blockStages.id, stagePhotos.blockStageId)).innerJoin(blocks, eq(blocks.id, blockStages.blockId))
    .where(and(eq(stagePhotos.id, photoId), eq(stagePhotos.companyId, user.companyId))).limit(1).$dynamic();
  const [row] = await (forUpdate ? q.for("update", { of: stagePhotos }) : q);
  if (!row) throw ApiError.notFound("Photo");
  ensureProjectAccess(user, row.block.projectId, "Photo");
  return row;
}

/** The document must be a live, non-sensitive image attached to this stage (STAGE), its block (BLOCK) or its project (PROJECT). */
async function assertPhotoDocument(tx: Executor, block: BlockRecord, stageRowIds: readonly string[], documentId: string): Promise<void> {
  const [doc] = await tx.select({ entityType: documents.entityType, entityId: documents.entityId, mime: documents.mime, isSensitive: documents.isSensitive }).from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.companyId, block.companyId), eq(documents.isDeleted, false))).limit(1);
  if (!doc) throw ApiError.badRequest("document_id does not exist", { field: "document_id" });
  if (!doc.mime.startsWith("image/")) throw ApiError.badRequest("Stage photos must be images", { field: "document_id", mime: doc.mime });
  if (doc.isSensitive) throw ApiError.badRequest("Sensitive documents cannot be stage photos", { field: "document_id" });
  const attachedHere = (doc.entityType === "STAGE" && stageRowIds.includes(doc.entityId)) || (doc.entityType === "BLOCK" && doc.entityId === block.id) || (doc.entityType === "PROJECT" && doc.entityId === block.projectId);
  if (!PHOTO_ENTITY_TYPES.has(doc.entityType) || !attachedHere) throw ApiError.badRequest("Document must be attached to this stage, its block or its project", { field: "document_id", entity_type: doc.entityType });
}

/** POST /blocks/:id/construction/:stageId/photos. */
export async function addPhoto(tx: Tx, user: StaffContext, actor: ConstructionActor, blockId: string, stageRef: string, input: StagePhotoCreate): Promise<StagePhotoRow> {
  const block = await loadBlockScoped(tx, user, blockId);
  const stages = await loadStages(tx, block.id);
  const stage = requireStage(stages, stageRef);
  await assertPhotoDocument(tx, block, stages.map((s) => s.id), input.document_id);
  const [row] = await tx.insert(stagePhotos).values({
    companyId: block.companyId, blockStageId: stage.id, documentId: input.document_id, caption: input.caption ?? null, visibleToBuyers: input.visible_to_buyers, showOnWebsite: input.show_on_website, sortOrder: input.sort_order, createdBy: user.id,
  }).returning();
  if (!row) throw new Error("insert returned no row");
  await writeAudit(tx, { companyId: block.companyId, actor, action: "stage_photo.create", entityType: "stage_photo", entityId: row.id, after: { block_stage_id: stage.id, stage_id: stage.stageId, block_id: block.id, document_id: row.documentId, caption: row.caption, visible_to_buyers: row.visibleToBuyers, show_on_website: row.showOnWebsite, sort_order: row.sortOrder }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
  if (row.visibleToBuyers) await notifyBuyersOnFirstVisiblePhoto(tx, block, stage);
  const [view] = await toPhotoRows(tx, [row]);
  return view!;
}

/** PATCH /construction/photos/:photoId – caption and flags (version via If-Match, else the current one). */
export async function updatePhoto(tx: Tx, user: StaffContext, actor: ConstructionActor, photoId: string, input: StagePhotoUpdate, expectedVersion: (current: number) => number): Promise<StagePhotoRow> {
  const { photo, stage, block } = await loadPhotoScoped(tx, user, photoId, true);
  const changes: Partial<typeof stagePhotos.$inferInsert> = {};
  if (input.caption !== undefined) changes.caption = input.caption ?? null;
  if (input.visible_to_buyers !== undefined) changes.visibleToBuyers = input.visible_to_buyers;
  if (input.show_on_website !== undefined) changes.showOnWebsite = input.show_on_website;
  if (input.sort_order !== undefined) changes.sortOrder = input.sort_order;
  const row = await applyUpdate(tx, stagePhotos, photo.id, expectedVersion(photo.version), changes, "stage_photo");
  await writeAudit(tx, { companyId: block.companyId, actor, action: "stage_photo.update", entityType: "stage_photo", entityId: photo.id, before: { caption: photo.caption, visible_to_buyers: photo.visibleToBuyers, show_on_website: photo.showOnWebsite, sort_order: photo.sortOrder }, after: { ...changes, block_stage_id: stage.id, block_id: block.id }, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
  if (!photo.visibleToBuyers && row.visibleToBuyers) await notifyBuyersOnFirstVisiblePhoto(tx, block, stage);
  const [view] = await toPhotoRows(tx, [row]);
  return view!;
}

/** DELETE /construction/photos/:photoId – removes the link row; the document itself stays (soft delete lives in the documents module). */
export async function deletePhoto(tx: Tx, user: StaffContext, actor: ConstructionActor, photoId: string): Promise<void> {
  const { photo, stage, block } = await loadPhotoScoped(tx, user, photoId, true);
  await tx.delete(stagePhotos).where(eq(stagePhotos.id, photo.id));
  await writeAudit(tx, { companyId: block.companyId, actor, action: "stage_photo.delete", entityType: "stage_photo", entityId: photo.id, before: { block_stage_id: stage.id, block_id: block.id, document_id: photo.documentId, caption: photo.caption, visible_to_buyers: photo.visibleToBuyers, show_on_website: photo.showOnWebsite }, after: null, ip: actor.ip ?? null, requestId: actor.requestId ?? null });
}
