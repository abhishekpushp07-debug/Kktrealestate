/**
 * Portal module shared pieces (SPEC §16, §2 buyer rules, API-CONVENTIONS Appendix C): the ownership rule — a booking is visible only
 * when the customer is its primary applicant or a co-applicant, anything else is 404 — plus the synthetic, project-scoped reader
 * context the portal hands to the staff-side services it reuses (money views, report PDFs), and small wire mappers.
 */
import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ListQuerySchema, type PaymentBucket, type PortalBookingSwitcherItem, type PortalReceiptRow, type PortalRelationshipManager } from "@kkt/contracts";
import { blocks, bookingCoApplicants, bookings, customers, flatTypes, flats, payments, projects, users, type Executor } from "@kkt/db";
import { ApiError } from "../../lib/errors.js";
import type { PortalContext, StaffContext } from "../../lib/scope.js";
import type { BookingRecord } from "../money/common.js";

/** Portal list query: paging only (search/sort allow-lists are per route; csv is not a portal feature). */
export const PortalListQuerySchema = ListQuerySchema.pick({ page: true, page_size: true, cursor: true, limit: true, sort: true });
export type PortalListQuery = z.infer<typeof PortalListQuerySchema>;

/** `:id` params. */
export const idParams = z.object({ id: z.uuid() });

/** A booking the customer may see, with the joined display fields every portal screen needs. */
export interface OwnedBooking {
  booking: BookingRecord;
  role: "PRIMARY" | "CO_APPLICANT";
  projectName: string;
  blockName: string;
  flatNumber: string;
  flatFacing: string | null;
  flatFloorLabel: string | null;
  flatTypeName: string | null;
  flatTypeBhk: number | null;
  flatTypeSpecItemIds: string[];
}

/** Condition: the customer is the booking's primary applicant or one of its co-applicants. */
export function memberCondition(customerId: string): SQL {
  return or(eq(bookings.customerId, customerId), sql`exists (select 1 from ${bookingCoApplicants} bc where bc.booking_id = ${bookings.id} and bc.customer_id = ${customerId})`)!;
}

function ownedSelect(customerId: string) {
  return {
    booking: bookings,
    projectName: projects.name,
    blockName: blocks.name,
    flatNumber: flats.flatNumber,
    flatFacing: flats.facing,
    flatFloorLabel: flats.floorLabel,
    flatTypeName: flatTypes.name,
    flatTypeBhk: flatTypes.bhk,
    flatTypeSpecItemIds: flatTypes.specItemIds,
    isPrimary: sql<boolean>`${bookings.customerId} = ${customerId}::uuid`,
  };
}

type OwnedRow = Omit<OwnedBooking, "role"> & { isPrimary: boolean };

function toOwned(r: OwnedRow): OwnedBooking {
  const { isPrimary, ...rest } = r;
  return { ...rest, role: isPrimary ? "PRIMARY" : "CO_APPLICANT" };
}

function ownedQuery(db: Executor, customer: Pick<PortalContext, "customerId" | "companyId">, extra?: SQL) {
  return db
    .select(ownedSelect(customer.customerId))
    .from(bookings)
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(blocks, eq(blocks.id, bookings.blockId))
    .innerJoin(flats, eq(flats.id, bookings.flatId))
    .leftJoin(flatTypes, eq(flatTypes.id, flats.flatTypeId))
    .where(and(eq(bookings.companyId, customer.companyId), memberCondition(customer.customerId), extra));
}

/** Loads one booking the customer may see; 404 NOT_FOUND for anything else (another buyer's booking, a foreign company, an unknown id). */
export async function loadOwnedBooking(db: Executor, customer: Pick<PortalContext, "customerId" | "companyId">, bookingId: string): Promise<OwnedBooking> {
  const rows = await ownedQuery(db, customer, eq(bookings.id, bookingId)).limit(1);
  const row = rows[0];
  if (!row) throw ApiError.notFound("Booking");
  return toOwned(row as OwnedRow);
}

/** Every booking the customer may see: ACTIVE first, then COMPLETED, then CANCELLED; newest booking date first within a group. */
export async function listOwnedBookings(db: Executor, customer: Pick<PortalContext, "customerId" | "companyId">): Promise<OwnedBooking[]> {
  const rows = await ownedQuery(db, customer).orderBy(
    sql`case ${bookings.status} when 'ACTIVE' then 0 when 'COMPLETED' then 1 else 2 end`,
    desc(bookings.bookingDate),
    asc(bookings.bookingNumber),
  );
  return (rows as OwnedRow[]).map(toOwned);
}

/** Switcher item of an owned booking. */
export function toSwitcherItem(o: OwnedBooking): PortalBookingSwitcherItem {
  return { booking_id: o.booking.id, booking_number: o.booking.bookingNumber, project_name: o.projectName, block_name: o.blockName, flat_number: o.flatNumber, role: o.role, status: o.booking.status };
}

/**
 * The staff-side services the portal reuses (money views, receipt / demand / statement / allotment PDFs) take a StaffContext and apply
 * project scope with 404. The portal has already proven ownership of the booking, so it hands them a synthetic reader scoped to exactly
 * that booking's project: no user id, no permissions, nothing a staff member has. Never use it for writes.
 */
export function scopedReader(customer: PortalContext, projectId: string): StaffContext {
  return {
    id: customer.customerId, companyId: customer.companyId, name: customer.name, email: "", roleId: "", roleName: "Customer", isSystemRole: false,
    permissions: new Set<string>(), allProjects: false, projectIds: [projectId], mustChangePassword: false, mfaEnabled: false, sessionId: customer.sessionId,
  };
}

/** The customer behind an authenticated portal request (the auth plugin sets it on every `audience: "portal"` route). */
export function customerOf(req: Pick<FastifyRequest, "customer">): PortalContext {
  const c = req.customer;
  if (!c) throw ApiError.unauthenticated();
  return c;
}

/** ISO string of a Date or null. */
export function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

/** Customer-facing label of what a payment was towards. */
export function againstLabel(bucket: PaymentBucket | null, otherChargeName: string | null): string {
  if (otherChargeName) return `Other charge – ${otherChargeName}`;
  return bucket === "ACCOUNT" ? "Flat value – Account" : "Flat value – Cash";
}

/** A payments row with the names the receipt row needs. */
export interface PaymentWithNames {
  p: typeof payments.$inferSelect;
  modeName: string;
  chargeName: string | null;
}

/** Payment → customer-facing receipt row (no staff ids, no bank account ids). */
export function toReceiptRow(r: PaymentWithNames): PortalReceiptRow {
  return {
    payment_id: r.p.id, receipt_number: r.p.receiptNumber, payment_date: r.p.paymentDate, amount_paise: r.p.amountPaise, bucket: r.p.bucket,
    against_label: againstLabel(r.p.bucket, r.chargeName), mode_name: r.modeName, instrument_number: r.p.instrument?.number ?? null, status: r.p.status, is_cancelled: r.p.receiptCancelled,
  };
}

/** The customer's relationship manager as the portal shows it: name and contact details only, never the user id. */
export async function relationshipManagerOf(db: Executor, customerId: string): Promise<PortalRelationshipManager | null> {
  const [row] = await db
    .select({ name: users.name, phone: users.phone, email: users.email, active: users.isActive })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.relationshipManagerId))
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!row || !row.active) return null;
  return { name: row.name, phone: row.phone ?? null, whatsapp: row.phone ?? null, email: row.email ?? null };
}
