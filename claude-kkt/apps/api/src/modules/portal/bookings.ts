/**
 * Portal booking screens (SPEC §16; API-CONVENTIONS Appendix C): switcher, home, my flat, ledger, receipts, demands, schedule, the four
 * generated PDFs, construction timeline, shared documents and bank details. Every `:id` goes through loadOwnedBooking() first — a booking
 * the customer is not primary or co-applicant on is 404 everywhere, PDF links included. Money figures come from the money module's
 * materialised summary and exported views; nothing here re-implements ledger or schedule maths.
 */
import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  LEDGER_EVENT_LABELS,
  PortalBankDetailsSchema, PortalBookingSwitcherItemSchema, PortalConstructionTimelineResponseSchema, PortalDemandListResponseSchema, PortalDocumentListResponseSchema,
  PortalHomeResponseSchema, PortalLedgerResponseSchema, PortalMyFlatResponseSchema, PortalPdfLinkResponseSchema, PortalReceiptListResponseSchema, PortalScheduleResponseSchema,
  type DocumentRow, type PortalBankDetails, type PortalBucketCard, type PortalConstructionTimelineResponse, type PortalDemandRow, type PortalDocumentRow, type PortalHomeResponse,
  type PortalLedgerRow, type PortalMyFlatResponse, type PortalPdfLinkResponse, type PortalReceiptRow, type PortalRelationshipManager, type PortalScheduleResponse,
} from "@kkt/contracts";
import {
  agreementRevisions, bankAccounts, blockStages, bookingOtherCharges, customers, demands, documentTypes, documents, ledgerEntries, notices, notifications, parkingSlots, paymentModes, payments,
  projectWebsiteSettings, projects, specCategories, specItems, users, type Executor,
} from "@kkt/db";
import { compareDates, todayIST, type TowerStage } from "@kkt/domain";
import { decryptField } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { paginate, type ListResult } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import type { PortalContext } from "../../lib/scope.js";
import { blockStageTimeline, constructionPercent, deriveProgress } from "../construction/index.js";
import { documentsSharedWithCustomer, loadRows, publicMediaUrl, type DocumentRecord } from "../documents/index.js";
import { nonVoidDemands, scheduleRows } from "../money/index.js";
import { allotmentLetterPdf, customerStatementPdf, demandLetterPdf, receiptPdf } from "../reports/index.js";
import { customerProjectIdsSubquery } from "../service/ticketService.js";
import { PortalListQuerySchema, customerOf, idParams, listOwnedBookings, loadOwnedBooking, scopedReader, toReceiptRow, toSwitcherItem, type OwnedBooking } from "./common.js";
import { portalDocumentUrl, storeTempFile } from "./files.js";

const bookingParams = idParams;
const paymentParams = z.object({ id: z.uuid(), paymentId: z.uuid() });
const demandParams = z.object({ id: z.uuid(), demandId: z.uuid() });
const docParams = z.object({ id: z.uuid(), docId: z.uuid() });

// ---------------------------------------------------------------------------
// Counts & lookups shared by home
// ---------------------------------------------------------------------------

/** Unread, non-withdrawn bell notifications of the customer. */
export async function unreadNotificationCount(db: Executor, customerId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientType, "CUSTOMER"), eq(notifications.recipientId, customerId), eq(notifications.isRead, false), eq(notifications.isWithdrawn, false)));
  return Number(r?.n ?? 0);
}

/** SQL: live notices the customer may see (company-wide or in a project of their bookings) that they have not read through the bell. */
function unreadNoticesSql(customer: Pick<PortalContext, "customerId" | "companyId">, now: Date): SQL {
  const read = sql`exists (select 1 from ${notifications} nt where nt.recipient_type = 'CUSTOMER' and nt.recipient_id = ${customer.customerId}::uuid and nt.entity_type = 'notice' and nt.entity_id = ${notices.id} and nt.is_read = true and nt.is_withdrawn = false)`;
  return and(
    eq(notices.companyId, customer.companyId), eq(notices.isPublished, true),
    or(isNull(notices.publishAt), lte(notices.publishAt, now)), or(isNull(notices.expiresAt), gt(notices.expiresAt, now)),
    or(isNull(notices.projectId), sql`${notices.projectId} in ${customerProjectIdsSubquery(customer.customerId)}`),
    sql`not ${read}`,
  )!;
}

/** Live notices the customer may see (company-wide or in a project of their bookings) that they have not read through the bell. */
export async function unreadNoticeCount(db: Executor, customer: Pick<PortalContext, "customerId" | "companyId">, now = new Date()): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(notices).where(unreadNoticesSql(customer, now));
  return Number(r?.n ?? 0);
}

/** The home screen's counters and the relationship manager card in ONE query (two scalar subqueries + the RM join on the customer row). */
async function homeCounters(db: Executor, customer: PortalContext, now = new Date()): Promise<{ noticesUnread: number; notificationsUnread: number; rm: PortalRelationshipManager | null }> {
  const noticesUnread = db.select({ n: sql<number>`count(*)::int` }).from(notices).where(unreadNoticesSql(customer, now));
  const notificationsUnread = db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.recipientType, "CUSTOMER"), eq(notifications.recipientId, customer.customerId), eq(notifications.isRead, false), eq(notifications.isWithdrawn, false)));
  const [row] = await db
    .select({ noticesUnread: sql<number>`(${noticesUnread})`, notificationsUnread: sql<number>`(${notificationsUnread})`, rmName: users.name, rmPhone: users.phone, rmEmail: users.email, rmActive: users.isActive })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.relationshipManagerId))
    .where(eq(customers.id, customer.customerId))
    .limit(1);
  const rm: PortalRelationshipManager | null = row?.rmName && row.rmActive ? { name: row.rmName, phone: row.rmPhone ?? null, whatsapp: row.rmPhone ?? null, email: row.rmEmail ?? null } : null;
  return { noticesUnread: Number(row?.noticesUnread ?? 0), notificationsUnread: Number(row?.notificationsUnread ?? 0), rm };
}

/**
 * Hero image of the booking's project in one query: the website's first hero document (live, not sensitive, an image) — public media when
 * the project page is published, else a link signed for this customer.
 */
async function projectImageUrl(db: Executor, customer: PortalContext, projectId: string): Promise<string | null> {
  const [w] = await db
    .select({ published: projectWebsiteSettings.isPublished, docId: documents.id, mime: documents.mime, variants: documents.variants })
    .from(projectWebsiteSettings)
    .leftJoin(documents, and(eq(documents.id, sql`(${projectWebsiteSettings.heroDocumentIds})[1]`), eq(documents.isDeleted, false), eq(documents.isSensitive, false)))
    .where(eq(projectWebsiteSettings.projectId, projectId))
    .limit(1);
  if (!w?.docId || !w.mime?.startsWith("image/")) return null;
  const variant = w.variants?.medium_key ? "medium" : "original";
  return w.published ? publicMediaUrl(w.docId, variant) : portalDocumentUrl(customer.customerId, w.docId, variant).url;
}

function bucketCard(agreed: number, raised: number, paid: number): PortalBucketCard {
  const due = raised - paid;
  return { agreed_paise: agreed, raised_paise: raised, paid_paise: paid, due_paise: Math.max(0, due), advance_paise: Math.max(0, -due) };
}

/** Block stages as stored (progress ring) and as the dues engine reads them (schedule) from one query. */
async function towerStages(db: Executor, blockId: string): Promise<{ rows: (typeof blockStages.$inferSelect)[]; stages: TowerStage[] }> {
  const rows = await db.select().from(blockStages).where(eq(blockStages.blockId, blockId)).orderBy(asc(blockStages.sortOrder));
  return { rows, stages: rows.map((s) => ({ stageId: s.stageId, name: s.name, isPossession: s.isPossession, status: s.status, completedOn: s.completedOn })) };
}

function floorLabelOf(o: OwnedBooking): string {
  const snap = o.booking.flatSnapshot as { floor: number; floor_label?: string | null };
  return o.flatFloorLabel ?? snap.floor_label ?? String(snap.floor);
}

function flatTypeNameOf(o: OwnedBooking): string {
  const snap = o.booking.flatSnapshot as { flat_type_code: string; flat_type_name?: string | null };
  return o.flatTypeName ?? snap.flat_type_name ?? snap.flat_type_code;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/**
 * The portal home of one booking (SPEC §16 Home) in five queries: the owned bookings (switcher AND ownership check in one), the tower's
 * stages, the booking's demands, the hero image, and the counters + relationship manager. 404 when the booking is not the customer's.
 */
export async function portalHome(db: Executor, customer: PortalContext, bookingId: string): Promise<PortalHomeResponse> {
  const all = await listOwnedBookings(db, customer);
  const owned = all.find((o) => o.booking.id === bookingId);
  if (!owned) throw ApiError.notFound("Booking");
  const b = owned.booking;
  const [tower, nonVoid, image, counters] = await Promise.all([
    towerStages(db, b.blockId),
    nonVoidDemands(db, b.id),
    projectImageUrl(db, customer, b.projectId),
    homeCounters(db, customer),
  ]);
  const progress = deriveProgress(tower.rows);
  const schedule = scheduleRows(b, tower.stages, nonVoid);
  const next = schedule.find((r) => r.status === "RAISED" || r.status === "OVERDUE" || r.status === "PARTIALLY_PAID") ?? schedule.find((r) => r.status === "NOT_YET_DUE") ?? null;
  const cash = bucketCard(b.cashAgreedPaise, b.cashOrderRaisedPaise, b.cashPaidPaise);
  const account = bucketCard(b.accountAgreedPaise, b.accountOrderRaisedPaise, b.accountPaidPaise);
  return {
    greeting_name: customer.name.split(/\s+/)[0] ?? customer.name,
    bookings: all.map(toSwitcherItem),
    booking: {
      booking_id: b.id, booking_number: b.bookingNumber, booking_date: b.bookingDate, status: b.status, project_name: owned.projectName, project_image_url: image,
      block_name: owned.blockName, flat_number: owned.flatNumber, floor_label: floorLabelOf(owned), flat_type_name: flatTypeNameOf(owned),
    },
    construction: { percent: constructionPercent(tower.rows), current_stage: progress.current?.name ?? progress.latestCompleted?.name ?? null, next_stage: progress.next?.name ?? null },
    money: {
      cash, account,
      total_due_paise: (b.cashOrderRaisedPaise - b.cashPaidPaise) + (b.accountOrderRaisedPaise - b.accountPaidPaise),
      other_charges_due_paise: b.otherChargesDemandedPaise - b.otherChargesPaidPaise,
    },
    plan: { name: b.planSnapshot.name, plan_type: b.planSnapshot.plan_type, accepted_on: b.planAcceptedOn },
    next_installment: next ? { name: next.name, trigger_label: next.trigger_label, expected_date: next.expected_date, cash_paise: next.cash_paise, account_paise: next.account_paise, total_paise: next.total_paise } : null,
    notices_unread: counters.noticesUnread,
    notifications_unread: counters.notificationsUnread,
    pending_cheques_paise: b.pendingChequesPaise,
    relationship_manager: counters.rm,
  };
}

// ---------------------------------------------------------------------------
// My flat
// ---------------------------------------------------------------------------

/** True for a document that is a floor plan (type code FLOOR_PLAN or a "floor plan" title / file name) and an image. */
function isFloorPlan(doc: Pick<DocumentRecord, "title" | "fileName" | "mime">, typeCode: string | null): boolean {
  if (!doc.mime.startsWith("image/")) return false;
  if (typeCode && /floor_?plan/i.test(typeCode)) return true;
  return /floor[\s_-]?plan/i.test(`${doc.title ?? ""} ${doc.fileName}`);
}

/** Floor-plan image of the flat: a FLAT document first, then the block's, then the project's (live, not sensitive). Link signed for the customer. */
async function floorPlanUrl(db: Executor, customer: PortalContext, b: OwnedBooking["booking"]): Promise<string | null> {
  const rows = await db
    .select({ doc: documents, typeCode: documentTypes.code })
    .from(documents)
    .leftJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(and(
      eq(documents.companyId, b.companyId), eq(documents.isDeleted, false), eq(documents.isSensitive, false),
      or(and(eq(documents.entityType, "FLAT"), eq(documents.entityId, b.flatId)), and(eq(documents.entityType, "BLOCK"), eq(documents.entityId, b.blockId)), and(eq(documents.entityType, "PROJECT"), eq(documents.entityId, b.projectId))),
    ))
    .orderBy(sql`case ${documents.entityType} when 'FLAT' then 0 when 'BLOCK' then 1 else 2 end`, asc(documents.createdAt));
  const hit = rows.find((r) => isFloorPlan(r.doc, r.typeCode));
  if (!hit) return null;
  return portalDocumentUrl(customer.customerId, hit.doc.id, hit.doc.variants?.medium_key ? "medium" : "original").url;
}

/** Specifications of the flat type grouped by category (name – description). */
async function specifications(db: Executor, specItemIds: readonly string[]): Promise<PortalMyFlatResponse["specifications"]> {
  if (specItemIds.length === 0) return [];
  const rows = await db
    .select({ category: specCategories.name, categorySort: specCategories.sortOrder, name: specItems.name, description: specItems.description, sort: specItems.sortOrder })
    .from(specItems)
    .innerJoin(specCategories, eq(specCategories.id, specItems.categoryId))
    .where(inArray(specItems.id, [...specItemIds]))
    .orderBy(asc(specCategories.sortOrder), asc(specCategories.name), asc(specItems.sortOrder), asc(specItems.name));
  const groups = new Map<string, string[]>();
  for (const r of rows) groups.set(r.category, [...(groups.get(r.category) ?? []), r.description ? `${r.name} – ${r.description}` : r.name]);
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

/** My Flat (SPEC §16): rooms & areas snapshot, specifications, parking, floor plan, price breakup, agreement & revisions. */
export async function portalFlat(db: Executor, customer: PortalContext, bookingId: string): Promise<PortalMyFlatResponse> {
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const b = owned.booking;
  const [parking, plan, specs, revisions] = await Promise.all([
    db.select({ number: parkingSlots.number, slotType: parkingSlots.slotType, level: parkingSlots.level }).from(parkingSlots).where(eq(parkingSlots.bookingId, b.id)).orderBy(asc(parkingSlots.number)),
    floorPlanUrl(db, customer, b),
    specifications(db, owned.flatTypeSpecItemIds),
    db.select().from(agreementRevisions).where(eq(agreementRevisions.bookingId, b.id)).orderBy(asc(agreementRevisions.revisedAt)),
  ]);
  const snap = b.flatSnapshot;
  return {
    booking_id: b.id, flat_number: owned.flatNumber, floor_label: floorLabelOf(owned), block_name: owned.blockName, project_name: owned.projectName, flat_type_name: flatTypeNameOf(owned),
    bhk: owned.flatTypeBhk ?? 0, facing: owned.flatFacing ?? snap.facing ?? null,
    rooms: snap.rooms.map((r) => ({ label: r.label, room_type: r.room_type_name, length_ft: Number(r.length_ft), width_ft: Number(r.width_ft), sqft: Number(r.sqft) })),
    areas: snap.areas.map((a) => ({ name: a.area_type_name, code: a.area_type_code, sqft: Number(a.sqft) })),
    specifications: specs,
    parking: parking.map((p) => ({ number: p.number, slot_type: p.slotType, level: p.level })),
    floor_plan_url: plan,
    price_breakup: snap.price_breakup.map((l) => ({ label: l.label, amount_paise: l.amount_paise })),
    agreement: {
      agreement_value_paise: b.agreementValuePaise, cash_agreed_paise: b.cashAgreedPaise, account_agreed_paise: b.accountAgreedPaise,
      revisions: revisions.map((r) => ({
        revised_at: r.revisedAt.toISOString(), reason: r.reason,
        before_value_paise: r.before.agreement_value_paise, after_value_paise: r.after.agreement_value_paise,
        before_cash_paise: r.before.cash_agreed_paise, after_cash_paise: r.after.cash_agreed_paise,
        before_account_paise: r.before.account_agreed_paise, after_account_paise: r.after.account_agreed_paise,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Ledger, receipts, demands, schedule
// ---------------------------------------------------------------------------

type LedgerEntryRecord = typeof ledgerEntries.$inferSelect;

function toPortalLedgerRow(e: LedgerEntryRecord): PortalLedgerRow {
  return {
    seq: e.seq, entry_date: e.entryDate, event: e.event, label: e.label ?? LEDGER_EVENT_LABELS[e.event], bucket: e.bucket, amount_paise: e.amountPaise,
    cash_paid_paise: e.cashPaidCumPaise, account_paid_paise: e.accountPaidCumPaise, cash_due_paise: e.cashDuePaise, account_due_paise: e.accountDuePaise, total_due_paise: e.totalDuePaise, ref_number: e.refNumber,
  };
}

/** Customer-friendly ledger rows of an owned booking (running paid per bucket, due / advance). */
export async function portalLedger(db: Executor, customer: PortalContext, bookingId: string, q: z.infer<typeof PortalListQuerySchema>): Promise<ListResult<PortalLedgerRow>> {
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const result = await paginate<LedgerEntryRecord>(db, {
    table: ledgerEntries, where: eq(ledgerEntries.bookingId, owned.booking.id),
    sort: { allowed: { seq: ledgerEntries.seq, entry_date: ledgerEntries.entryDate }, default: "seq", requested: q.sort },
    page: q.page, page_size: q.page_size, cursor: q.cursor, limit: q.limit,
  });
  return { ...result, items: result.items.map(toPortalLedgerRow) };
}

interface PaymentSel { p: typeof payments.$inferSelect; modeName: string; chargeName: string | null }
const PAYMENT_SEL = { p: payments, modeName: paymentModes.name, chargeName: bookingOtherCharges.name };

/** Receipts (every payment of the booking, pending / bounced / reversed included, flagged). */
export async function portalReceipts(db: Executor, customer: PortalContext, bookingId: string, q: z.infer<typeof PortalListQuerySchema>): Promise<ListResult<PortalReceiptRow>> {
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const result = await paginate<PaymentSel>(db, {
    table: payments, select: PAYMENT_SEL,
    join: (qb) => qb.innerJoin(paymentModes, eq(paymentModes.id, payments.paymentModeId)).leftJoin(bookingOtherCharges, eq(bookingOtherCharges.id, payments.otherChargeId)),
    where: eq(payments.bookingId, owned.booking.id),
    sort: { allowed: { payment_date: payments.paymentDate, posted_at: payments.postedAt, amount_paise: payments.amountPaise }, default: "-payment_date", requested: q.sort },
    page: q.page, page_size: q.page_size, cursor: q.cursor, limit: q.limit,
  });
  return { ...result, items: result.items.map(toReceiptRow) };
}

type DemandRecord = typeof demands.$inferSelect;

function toPortalDemandRow(d: DemandRecord, today: string): PortalDemandRow {
  return {
    demand_id: d.id, demand_number: d.demandNumber, installment_name: d.installmentName, trigger_label: d.triggerLabel ?? "", demand_date: d.demandDate, due_date: d.dueDate,
    cash_demand_paise: d.cashDemandPaise, account_demand_paise: d.accountDemandPaise, total_demand_paise: d.totalDemandPaise, paid_paise: d.paidPaise, status: d.status,
    is_overdue: (d.status === "OPEN" || d.status === "PARTIALLY_PAID") && compareDates(today, d.dueDate) > 0,
  };
}

/** Demands of the booking (voided ones never shown). */
export async function portalDemands(db: Executor, customer: PortalContext, bookingId: string, q: z.infer<typeof PortalListQuerySchema>): Promise<ListResult<PortalDemandRow>> {
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const result = await paginate<DemandRecord>(db, {
    table: demands, where: and(eq(demands.bookingId, owned.booking.id), ne(demands.status, "VOID")),
    sort: { allowed: { installment_seq: demands.installmentSeq, demand_date: demands.demandDate, due_date: demands.dueDate }, default: "installment_seq", requested: q.sort },
    page: q.page, page_size: q.page_size, cursor: q.cursor, limit: q.limit,
  });
  const today = todayIST();
  return { ...result, items: result.items.map((d) => toPortalDemandRow(d, today)) };
}

/** Installment timeline with progress and the cheques still subject to realisation. */
export async function portalSchedule(db: Executor, customer: PortalContext, bookingId: string): Promise<PortalScheduleResponse> {
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const b = owned.booking;
  const [tower, nonVoid, pending] = await Promise.all([
    towerStages(db, b.blockId),
    nonVoidDemands(db, b.id),
    db.select(PAYMENT_SEL).from(payments).innerJoin(paymentModes, eq(paymentModes.id, payments.paymentModeId)).leftJoin(bookingOtherCharges, eq(bookingOtherCharges.id, payments.otherChargeId))
      .where(and(eq(payments.bookingId, b.id), eq(payments.status, "PENDING"))).orderBy(asc(payments.paymentDate), asc(payments.postedAt)),
  ]);
  const rows = scheduleRows(b, tower.stages, nonVoid).map((r) => ({
    seq: r.seq, name: r.name, percent: r.percent, trigger_type: r.trigger_type, trigger_label: r.trigger_label, expected_date: r.expected_date, status: r.status,
    cash_paise: r.cash_paise, account_paise: r.account_paise, total_paise: r.total_paise, paid_paise: r.paid_paise, due_date: r.due_date,
  }));
  const paid = b.cashPaidPaise + b.accountPaidPaise;
  const progress = b.agreementValuePaise > 0 ? Math.min(100, Math.max(0, Math.round((paid / b.agreementValuePaise) * 10000) / 100)) : 0;
  return { rows, progress_percent: progress, pending_cheques: (pending as PaymentSel[]).map(toReceiptRow) };
}

// ---------------------------------------------------------------------------
// PDFs (generated on demand, served through signed temporary links)
// ---------------------------------------------------------------------------

type PdfKind = "receipt" | "demand" | "statement" | "allotment";

/** Renders one of the four portal PDFs for an owned booking and returns its signed 15-minute link. */
export async function portalPdfLink(app: FastifyInstance, customer: PortalContext, bookingId: string, kind: PdfKind, refId?: string): Promise<PortalPdfLinkResponse> {
  const db = app.dbReplica;
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const reader = scopedReader(customer, owned.booking.projectId);
  let pdf: { bytes: Buffer; filename: string };
  switch (kind) {
    case "receipt": {
      const [p] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.id, refId ?? ""), eq(payments.bookingId, owned.booking.id))).limit(1);
      if (!p) throw ApiError.notFound("Receipt");
      pdf = await receiptPdf(db, reader, p.id);
      break;
    }
    case "demand": {
      const [d] = await db.select({ id: demands.id }).from(demands).where(and(eq(demands.id, refId ?? ""), eq(demands.bookingId, owned.booking.id), ne(demands.status, "VOID"))).limit(1);
      if (!d) throw ApiError.notFound("Demand");
      pdf = await demandLetterPdf(db, reader, owned.booking.id, d.id);
      break;
    }
    case "statement":
      pdf = await customerStatementPdf(db, reader, owned.booking.id);
      break;
    case "allotment":
      pdf = await allotmentLetterPdf(db, reader, owned.booking.id);
      break;
  }
  return storeTempFile(app.redis, customer.customerId, { bytes: pdf.bytes, filename: pdf.filename, mime: "application/pdf" });
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The buyer's own tower only; photos flagged visible to buyers only; image links signed for the customer (webp renditions when present). */
export async function portalConstruction(db: Executor, customer: PortalContext, bookingId: string): Promise<PortalConstructionTimelineResponse> {
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const timeline = await blockStageTimeline(db, owned.booking.blockId, { visibleToBuyersOnly: true });
  if (!timeline) throw ApiError.notFound("Booking");
  const link = (documentId: string, variant: "original" | "thumb" | "medium") => portalDocumentUrl(customer.customerId, documentId, variant).url;
  return {
    block_name: timeline.block_name, percent: timeline.construction_percent, current_stage: timeline.current_stage_name,
    stages: timeline.stages.map((s) => ({
      name: s.name, status: s.status, started_on: s.started_on, completed_on: s.completed_on, notes: s.notes, is_possession: s.is_possession,
      photos: s.photos.filter((p) => p.visible_to_buyers).map((p) => {
        // the timeline's own urls are documents-module links; they only tell us whether renditions exist
        const hasVariants = p.thumb_url !== null && p.medium_url !== null;
        return { thumb_url: link(p.document_id, hasVariants ? "thumb" : "original"), medium_url: link(p.document_id, hasVariants ? "medium" : "original"), caption: p.caption, taken_on: p.taken_on };
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function toPortalDocumentRow(d: DocumentRow, kind: PortalDocumentRow["kind"]): PortalDocumentRow {
  return { document_id: d.id, kind, title: d.title, document_type_name: d.document_type_name, file_name: d.file_name, mime: d.mime, size_bytes: d.size_bytes, shared_at: d.created_at };
}

/** Documents the customer may see for the booking: shared (never sensitive) booking / payment / own-customer documents plus the plan acceptance copy. */
export async function portalDocuments(db: Executor, customer: PortalContext, bookingId: string): Promise<PortalDocumentRow[]> {
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const b = owned.booking;
  const [shared, acceptance] = await Promise.all([
    documentsSharedWithCustomer(db, { bookingId: b.id, customerId: customer.customerId }),
    b.planAcceptanceDocumentId ? loadRows(db, b.companyId, [b.planAcceptanceDocumentId]) : Promise.resolve([] as DocumentRow[]),
  ]);
  const rows = shared.map((d) => toPortalDocumentRow(d, "SHARED"));
  for (const d of acceptance) if (!d.is_sensitive && !rows.some((r) => r.document_id === d.id)) rows.unshift(toPortalDocumentRow(d, "PLAN_ACCEPTANCE"));
  return rows;
}

/** Signed download link of one visible document; 404 for anything not in the customer's visible set. */
export async function portalDocumentLink(db: Executor, customer: PortalContext, bookingId: string, docId: string): Promise<PortalPdfLinkResponse> {
  const rows = await portalDocuments(db, customer, bookingId);
  const row = rows.find((r) => r.document_id === docId);
  if (!row) throw ApiError.notFound("Document");
  const link = portalDocumentUrl(customer.customerId, row.document_id, "original");
  return { download_url: link.url, expires_at: link.expires_at, file_name: row.file_name };
}

// ---------------------------------------------------------------------------
// Bank details
// ---------------------------------------------------------------------------

/** The builder's receiving account for the booking's project (escrow account, else the company default); the full number is meant to be shown. */
export async function portalBankDetails(db: Executor, customer: PortalContext, bookingId: string): Promise<PortalBankDetails> {
  const owned = await loadOwnedBooking(db, customer, bookingId);
  const [project] = await db.select({ escrow: projects.escrowBankAccountId }).from(projects).where(eq(projects.id, owned.booking.projectId)).limit(1);
  const active = and(eq(bankAccounts.companyId, customer.companyId), eq(bankAccounts.isActive, true));
  let [bank] = project?.escrow ? await db.select().from(bankAccounts).where(and(active, eq(bankAccounts.id, project.escrow))).limit(1) : [];
  if (!bank) [bank] = await db.select().from(bankAccounts).where(and(active, eq(bankAccounts.isDefault, true))).limit(1);
  if (!bank) throw ApiError.notFound("Bank details");
  let number: string | null = null;
  try { number = decryptField(bank.accountNumberEnc); } catch { number = null; }
  if (!number) throw ApiError.notFound("Bank details");
  return {
    bank_name: bank.bankName, branch: bank.branch, account_name: bank.accountName, account_number: number, ifsc: bank.ifsc,
    note: `Transfer Account-bucket payments only to this account and quote booking ${owned.booking.bookingNumber} in the remarks. Cheques / DDs in favour of "${bank.accountName}" are credited subject to realisation.`,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Registers the /portal/bookings routes. */
export function registerBookingRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/portal/bookings", audience: "portal",
    schema: { response: { 200: z.array(PortalBookingSwitcherItemSchema) }, summary: "Bookings the customer may switch to (primary or co-applicant)" },
    handler: async (req) => (await listOwnedBookings(app.dbReplica, customerOf(req))).map(toSwitcherItem),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/home", audience: "portal",
    schema: { params: bookingParams, response: { 200: PortalHomeResponseSchema }, summary: "Portal home for one booking" },
    handler: async (req) => portalHome(app.dbReplica, customerOf(req), req.params.id),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/flat", audience: "portal",
    schema: { params: bookingParams, response: { 200: PortalMyFlatResponseSchema }, summary: "My flat: rooms, areas, specifications, parking, floor plan, price breakup, agreement" },
    handler: async (req) => portalFlat(app.dbReplica, customerOf(req), req.params.id),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/ledger", audience: "portal",
    schema: { params: bookingParams, querystring: PortalListQuerySchema, response: { 200: PortalLedgerResponseSchema }, summary: "Customer-friendly ledger" },
    handler: async (req) => portalLedger(app.dbReplica, customerOf(req), req.params.id, req.query),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/receipts", audience: "portal",
    schema: { params: bookingParams, querystring: PortalListQuerySchema, response: { 200: PortalReceiptListResponseSchema }, summary: "Receipts" },
    handler: async (req) => portalReceipts(app.dbReplica, customerOf(req), req.params.id, req.query),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/receipts/:paymentId/pdf", audience: "portal",
    schema: { params: paymentParams, response: { 200: PortalPdfLinkResponseSchema }, summary: "Signed 15-minute link to the receipt PDF" },
    handler: async (req) => portalPdfLink(app, customerOf(req), req.params.id, "receipt", req.params.paymentId),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/demands", audience: "portal",
    schema: { params: bookingParams, querystring: PortalListQuerySchema, response: { 200: PortalDemandListResponseSchema }, summary: "Demands" },
    handler: async (req) => portalDemands(app.dbReplica, customerOf(req), req.params.id, req.query),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/demands/:demandId/pdf", audience: "portal",
    schema: { params: demandParams, response: { 200: PortalPdfLinkResponseSchema }, summary: "Signed 15-minute link to the demand letter PDF" },
    handler: async (req) => portalPdfLink(app, customerOf(req), req.params.id, "demand", req.params.demandId),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/schedule", audience: "portal",
    schema: { params: bookingParams, response: { 200: PortalScheduleResponseSchema }, summary: "Installment schedule, progress and pending cheques" },
    handler: async (req) => portalSchedule(app.dbReplica, customerOf(req), req.params.id),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/statement.pdf", audience: "portal",
    schema: { params: bookingParams, response: { 200: PortalPdfLinkResponseSchema }, summary: "Signed 15-minute link to the statement of account PDF" },
    handler: async (req) => portalPdfLink(app, customerOf(req), req.params.id, "statement"),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/allotment-letter.pdf", audience: "portal",
    schema: { params: bookingParams, response: { 200: PortalPdfLinkResponseSchema }, summary: "Signed 15-minute link to the allotment letter PDF" },
    handler: async (req) => portalPdfLink(app, customerOf(req), req.params.id, "allotment"),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/construction", audience: "portal",
    schema: { params: bookingParams, response: { 200: PortalConstructionTimelineResponseSchema }, summary: "Construction timeline of the buyer's own tower (photos visible to buyers only)" },
    handler: async (req) => portalConstruction(app.dbReplica, customerOf(req), req.params.id),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/documents", audience: "portal",
    schema: { params: bookingParams, response: { 200: PortalDocumentListResponseSchema }, summary: "Documents shared with the customer (never sensitive)" },
    handler: async (req) => ({ items: await portalDocuments(app.dbReplica, customerOf(req), req.params.id) }),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/documents/:docId/download", audience: "portal",
    schema: { params: docParams, response: { 200: PortalPdfLinkResponseSchema }, summary: "Signed 15-minute download link of a shared document" },
    handler: async (req) => portalDocumentLink(app.dbReplica, customerOf(req), req.params.id, req.params.docId),
  });

  route(app, {
    method: "GET", url: "/portal/bookings/:id/bank-details", audience: "portal",
    schema: { params: bookingParams, response: { 200: PortalBankDetailsSchema }, summary: "Bank account for Account-bucket transfers (project escrow or company default)" },
    handler: async (req) => portalBankDetails(app.dbReplica, customerOf(req), req.params.id),
  });
}
