/**
 * Portal profile (SPEC §16 Profile, §2 KYC rules): the customer sees their own record with PAN / Aadhaar masked even to themselves, their
 * co-applicants and relationship manager (name and contact only), and may edit contact details — e-mail, alternate phone, current address
 * (the permanent address is shown but, per the fixed PortalProfileUpdate contract, edited by staff only).
 * Every edit bumps the customer's version and writes an audit row with actor type CUSTOMER.
 */
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PortalProfileResponseSchema, PortalProfileUpdateSchema, type PortalProfileResponse, type PortalProfileUpdate } from "@kkt/contracts";
import { coApplicants, customers, portalUsers, type Executor } from "@kkt/db";
import { maskAadhaar, maskPAN } from "@kkt/domain";
import { writeAudit } from "../../lib/audit.js";
import { decryptField } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import type { PortalContext } from "../../lib/scope.js";
import { applyUpdate, optionalExpectedVersion } from "../../lib/version.js";
import { customerOf, iso, relationshipManagerOf } from "./common.js";

type CustomerRecord = typeof customers.$inferSelect;

/** Masked PAN ("XXXXX1234X") from the stored ciphertext; the last-4 column is the fallback when the key cannot decrypt. */
function maskedPan(c: Pick<CustomerRecord, "panEnc" | "panLast4">): string | null {
  if (!c.panEnc) return null;
  try {
    const plain = decryptField(c.panEnc);
    return plain ? maskPAN(plain) : null;
  } catch {
    return c.panLast4 ? `XXXXX${c.panLast4.slice(0, 4).padStart(4, "X")}X` : null;
  }
}

/** Masked Aadhaar ("XXXX XXXX 1234"). */
function maskedAadhaar(c: Pick<CustomerRecord, "aadhaarEnc" | "aadhaarLast4">): string | null {
  if (!c.aadhaarEnc) return null;
  try {
    const plain = decryptField(c.aadhaarEnc);
    return plain ? maskAadhaar(plain) : null;
  } catch {
    return c.aadhaarLast4 ? `XXXX XXXX ${c.aadhaarLast4.padStart(4, "X")}` : null;
  }
}

/** The customer's own profile view. */
export async function portalProfile(db: Executor, customer: PortalContext): Promise<PortalProfileResponse> {
  const [row] = await db.select({ c: customers, pu: portalUsers }).from(customers).innerJoin(portalUsers, eq(portalUsers.customerId, customers.id)).where(eq(customers.id, customer.customerId)).limit(1);
  if (!row) throw ApiError.notFound("Profile");
  const [cas, rm] = await Promise.all([
    db.select({ fullName: coApplicants.fullName, relation: coApplicants.relation, phone: coApplicants.phone }).from(coApplicants).where(eq(coApplicants.customerId, customer.customerId)).orderBy(asc(coApplicants.sortOrder), asc(coApplicants.createdAt)),
    relationshipManagerOf(db, customer.customerId),
  ]);
  const c = row.c;
  return {
    customer_id: c.id, customer_code: c.customerCode, full_name: c.fullName, phone: c.phone, alt_phone: c.altPhone, email: c.email,
    address_current: c.addressCurrent ?? null, address_permanent: c.sameAsCurrent ? (c.addressCurrent ?? null) : (c.addressPermanent ?? null),
    pan_masked: maskedPan(c), aadhaar_masked: maskedAadhaar(c), kyc_status: c.kycStatus,
    co_applicants: cas.map((a) => ({ full_name: a.fullName, relation: a.relation ?? "", phone: a.phone })),
    relationship_manager: rm, must_change_password: row.pu.mustChangePassword, last_login_at: iso(row.pu.lastLoginAt),
  };
}

/** Editable contact details → column changes (only keys present in the body). */
function profileChanges(body: PortalProfileUpdate): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (body.email !== undefined) changes["email"] = body.email ?? null;
  if (body.alt_phone !== undefined) changes["altPhone"] = body.alt_phone ?? null;
  if (body.address_current !== undefined) changes["addressCurrent"] = body.address_current ?? null;
  return changes;
}

/** Updates the customer's contact details (version bump; audit with actor CUSTOMER). */
export async function updatePortalProfile(app: FastifyInstance, req: FastifyRequest, customer: PortalContext, body: PortalProfileUpdate): Promise<PortalProfileResponse> {
  const changes = profileChanges(body);
  if (Object.keys(changes).length === 0) throw ApiError.badRequest("Nothing to update");
  await app.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(customers).where(eq(customers.id, customer.customerId)).limit(1).for("update");
    if (!cur) throw ApiError.notFound("Profile");
    const expected = optionalExpectedVersion(req, null, cur.version);
    await applyUpdate(tx, customers, cur.id, expected, changes, "customer");
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const snapshot: Record<string, unknown> = { email: cur.email, altPhone: cur.altPhone, addressCurrent: cur.addressCurrent };
    for (const [k, v] of Object.entries(changes)) { before[k] = snapshot[k] ?? null; after[k] = v; }
    await writeAudit(tx, { companyId: customer.companyId, actor: { type: "CUSTOMER", id: customer.customerId, name: customer.name }, action: "customer.portal_profile_update", entityType: "customer", entityId: cur.id, before, after, ip: req.clientIp, requestId: req.id });
  });
  return portalProfile(app.db, customer);
}

/** Registers GET / PATCH /portal/profile. */
export function registerProfileRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/portal/profile", audience: "portal",
    schema: { response: { 200: PortalProfileResponseSchema }, summary: "The customer's profile (KYC masked)" },
    handler: async (req) => portalProfile(app.dbReplica, customerOf(req)),
  });

  route(app, {
    method: "PATCH", url: "/portal/profile", audience: "portal",
    schema: { body: PortalProfileUpdateSchema, response: { 200: PortalProfileResponseSchema }, summary: "Edit contact details (e-mail, alternate phone, addresses); audited as the customer" },
    handler: async (req) => updatePortalProfile(app, req as unknown as FastifyRequest, customerOf(req), req.body),
  });
}
