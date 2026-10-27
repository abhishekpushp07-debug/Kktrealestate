import { and, desc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ActiveStateResponseSchema,
  AdminCustomerEraseRequestSchema,
  AdminCustomerEraseResponseSchema,
  CoApplicantInputSchema,
  CoApplicantListResponseSchema,
  CoApplicantRowSchema,
  CoApplicantUpdateSchema,
  Customer360ResponseSchema,
  CustomerCreateSchema,
  CustomerDuplicateCheckResponseSchema,
  CustomerDuplicateCheckSchema,
  CustomerFilterSchema,
  CustomerGetQuerySchema,
  CustomerKycUpdateSchema,
  CustomerListResponseSchema,
  CustomerRevealedSchema,
  CustomerPatchSchema,
  CustomerRowSchema,
  IdSchema,
  VersionedSchema,
  type Customer360Response,
  type CustomerDuplicateMatch,
} from "@kkt/contracts";
import {
  blocks,
  bookingCoApplicants,
  bookings,
  coApplicants,
  customers,
  documentTypes,
  documents,
  leads,
  payments,
  portalUsers,
  projects,
  serviceRequests,
  users,
  type Executor,
} from "@kkt/db";
import { normalizePAN } from "@kkt/domain";
import { writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { keyedHashes } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import {
  assertPermission,
  customerScopeCondition,
  ensureProjectAccess,
  isSuperAdmin,
  scopeFilter,
  type StaffContext,
} from "../../lib/scope.js";
import { maskPhone } from "../../lib/audit.js";
import { applyUpdate, assertVersion, expectedVersion, withOptionalVersion } from "../../lib/version.js";
import { eraseCustomer } from "../admin/index.js";
import { revokeAllFamilies } from "../auth/index.js";
import { bumpAuthVersions } from "../../lib/cache.js";
import { leadScopeCondition } from "./leadService.js";
import {
  CUSTOMER_SELECT,
  activeBookingCount,
  canonicalPhone,
  coApplicantColumns,
  coApplicantRow,
  coApplicantsFor,
  createCustomer,
  customerRow,
  getCustomerRow,
  joinRm,
  listCoApplicants,
  loadCustomerSelect,
  metaOf,
  portalAccessView,
  revealedRow,
  toCustomerRows,
  updateCustomer,
  type CustomerSelect,
  type CustomerWriteContext,
} from "./customerService.js";
import { securityRedis } from "../../plugins/auth.js";

const idParams = z.object({ id: IdSchema });
const coParams = z.object({ id: IdSchema, caId: IdSchema });

function ctxOf(app: FastifyInstance, req: FastifyRequest): CustomerWriteContext {
  return { user: req.user!, redis: app.redis, meta: metaOf(req) };
}

/** Customer 360: profile + bookings + recent payments + documents + leads + tickets + portal state (joins only; no N+1). */
async function customer360(
  db: Executor,
  companyId: string,
  id: string,
  user: StaffContext,
): Promise<Customer360Response> {
  // 404 for a customer outside the caller's project scope; every section below is limited to the scope as well
  const sel = await loadCustomerSelect(db, companyId, id, false, user);
  const cas = await coApplicantsFor(db, [id]);
  const customer = customerRow(sel, cas.get(id) ?? []);
  const scope = scopeFilter(user, bookings.projectId);
  const paymentScope = scopeFilter(user, payments.projectId);
  // tickets: those raised on a booking in scope, plus booking-less tickets of this (in-scope) customer
  // (the aliased sub-select spells the scope on `tb.project_id`; a Drizzle column condition would render "bookings"."project_id")
  const scopeIds = sql.join(
    user.projectIds.map((pid) => sql`${pid}::uuid`),
    sql`, `,
  );
  const ticketScope = user.allProjects
    ? undefined
    : user.projectIds.length === 0
      ? sql`${serviceRequests.bookingId} is null`
      : sql`(${serviceRequests.bookingId} is null or exists (select 1 from ${bookings} tb where tb.id = ${serviceRequests.bookingId} and tb.project_id in (${scopeIds})))`;
  const [bookingRows, paymentRows, docRows, leadRows, ticketRows, portal] = await Promise.all([
    db
      .select({
        b: bookings,
        projectName: projects.name,
        blockName: blocks.name,
        role: sql<
          "PRIMARY" | "CO_APPLICANT"
        >`case when ${bookings.customerId} = ${id} then 'PRIMARY' else 'CO_APPLICANT' end`,
      })
      .from(bookings)
      .innerJoin(projects, eq(projects.id, bookings.projectId))
      .innerJoin(blocks, eq(blocks.id, bookings.blockId))
      .where(
        and(
          eq(bookings.companyId, companyId),
          scope,
          or(
            eq(bookings.customerId, id),
            sql`exists (select 1 from ${bookingCoApplicants} bc where bc.booking_id = ${bookings.id} and bc.customer_id = ${id})`,
          ),
        ),
      )
      .orderBy(desc(bookings.bookingDate)),
    db
      .select({ p: payments, bookingNumber: bookings.bookingNumber })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(and(eq(payments.companyId, companyId), eq(payments.customerId, id), paymentScope))
      .orderBy(desc(payments.paymentDate), desc(payments.postedAt))
      .limit(10),
    db
      .select({ d: documents, typeName: documentTypes.name })
      .from(documents)
      .leftJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.entityType, "CUSTOMER"),
          eq(documents.entityId, id),
          eq(documents.isDeleted, false),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(50),
    db
      .select({ l: leads, projectName: projects.name })
      .from(leads)
      .leftJoin(projects, eq(projects.id, leads.projectId))
      .where(
        and(
          eq(leads.companyId, companyId),
          or(eq(leads.customerId, id), eq(leads.phone, sel.c.phone)),
          leadScopeCondition(user),
        ),
      )
      .orderBy(desc(leads.createdAt))
      .limit(50),
    db
      .select()
      .from(serviceRequests)
      .where(and(eq(serviceRequests.companyId, companyId), eq(serviceRequests.customerId, id), ticketScope))
      .orderBy(desc(serviceRequests.createdAt))
      .limit(50),
    portalAccessView(db, companyId, sel.c),
  ]);
  const [payCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.companyId, companyId), eq(payments.customerId, id), paymentScope));
  return {
    customer,
    bookings: bookingRows.map((r) => ({
      booking_id: r.b.id,
      booking_number: r.b.bookingNumber,
      project_name: r.projectName,
      block_name: r.blockName,
      flat_number: String((r.b.flatSnapshot as { flat_number?: string } | null)?.flat_number ?? ""),
      status: r.b.status,
      plan_name: String((r.b.planSnapshot as { name?: string } | null)?.name ?? ""),
      agreement_value_paise: Number(r.b.agreementValuePaise),
      total_paid_paise: Number(r.b.cashPaidPaise) + Number(r.b.accountPaidPaise),
      total_due_paise:
        Number(r.b.cashOrderRaisedPaise) +
        Number(r.b.accountOrderRaisedPaise) -
        Number(r.b.cashPaidPaise) -
        Number(r.b.accountPaidPaise),
      role: r.role,
    })),
    payments_recent: paymentRows.map((r) => ({
      payment_id: r.p.id,
      booking_id: r.p.bookingId,
      booking_number: r.bookingNumber,
      receipt_number: r.p.receiptNumber,
      amount_paise: Number(r.p.amountPaise),
      payment_date: r.p.paymentDate,
      mode_code: r.p.modeCode,
      bucket: r.p.bucket,
      against: r.p.against,
      status: r.p.status,
    })),
    documents: docRows.map((r) => ({
      document_id: r.d.id,
      title: r.d.title,
      file_name: r.d.fileName,
      mime: r.d.mime,
      document_type_name: r.typeName ?? null,
      is_sensitive: r.d.isSensitive,
      shared_with_customer: r.d.sharedWithCustomer,
      created_at: r.d.createdAt.toISOString(),
    })),
    leads: leadRows.map((r) => ({
      lead_id: r.l.id,
      lead_number: r.l.leadNumber,
      stage: r.l.stage,
      source: r.l.source,
      project_name: r.projectName ?? null,
      created_at: r.l.createdAt.toISOString(),
    })),
    tickets: ticketRows.map((t) => ({
      ticket_id: t.id,
      ticket_number: t.ticketNumber,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      created_at: t.createdAt.toISOString(),
    })),
    payments_count: Number(payCount?.n ?? 0),
    documents_count: docRows.length,
    leads_count: leadRows.length,
    tickets_open: ticketRows.filter((t) => t.status !== "CLOSED" && t.status !== "RESOLVED").length,
    portal: portal.is_enabled || portal.enabled_at ? portal : null,
  };
}

/** Allowed KYC moves (target → sources); anything else is 409 KYC_TRANSITION_INVALID. VERIFIED → * is the settings.manage override. */
const KYC_FROM: Record<"SUBMITTED" | "VERIFIED" | "REJECTED", readonly string[]> = {
  SUBMITTED: ["PENDING", "REJECTED", "VERIFIED"],
  VERIFIED: ["SUBMITTED"],
  REJECTED: ["SUBMITTED", "VERIFIED"],
};

/** What is missing for a KYC submission: PAN, Aadhaar and at least one live KYC document (sensitive, or of a KYC document type). */
async function kycMissing(tx: Executor, c: typeof customers.$inferSelect): Promise<string[]> {
  const missing: string[] = [];
  if (!c.panEnc) missing.push("pan");
  if (!c.aadhaarEnc) missing.push("aadhaar");
  const [doc] = await tx
    .select({ id: documents.id })
    .from(documents)
    .leftJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(
      and(
        eq(documents.companyId, c.companyId),
        eq(documents.entityType, "CUSTOMER"),
        eq(documents.entityId, c.id),
        eq(documents.isDeleted, false),
        or(eq(documents.isSensitive, true), eq(documentTypes.isKyc, true)),
      ),
    )
    .limit(1);
  if (!doc) missing.push("kyc_document");
  return missing;
}

/**
 * Checks one KYC move against the maker-checker workflow and returns whether it re-opens a VERIFIED file. Errors: 409 KYC_TRANSITION_INVALID
 * (move not allowed, or a rejected file resubmitted without any edit since the rejection), 422 KYC_INCOMPLETE (details.missing),
 * 403 FORBIDDEN with details.reason KYC_VERIFIED_LOCKED (VERIFIED changed without settings.manage) or KYC_MAKER_CHECKER (the submitter
 * verifying their own submission), 400 when the reason for changing a VERIFIED status is missing.
 */
async function kycTransition(
  tx: Executor,
  user: StaffContext,
  c: typeof customers.$inferSelect,
  to: "SUBMITTED" | "VERIFIED" | "REJECTED",
  reason: string | undefined,
): Promise<{ reopened: boolean }> {
  const from = c.kycStatus;
  // Only someone allowed to see the unmasked identifiers can vouch for (or reject) them (checked before the workflow: 403 first).
  if (to === "VERIFIED" || to === "REJECTED") assertPermission(user, "customer.kyc_view");
  if (!KYC_FROM[to].includes(from)) {
    throw ApiError.conflict("KYC_TRANSITION_INVALID", `KYC cannot move from ${from} to ${to}`, {
      from,
      to,
      allowed_from: KYC_FROM[to],
    });
  }
  const reopened = from === "VERIFIED";
  if (reopened) {
    if (!user.permissions.has("settings.manage"))
      throw ApiError.forbidden("Only an administrator (settings.manage) can change a VERIFIED KYC status", {
        reason: "KYC_VERIFIED_LOCKED",
        permission: "settings.manage",
      });
    if (!reason)
      throw ApiError.invalid("reason", "Give a reason for changing a verified KYC status", "invalid", {
        issues: [{ path: "reason", message: "Required when changing a VERIFIED status" }],
      });
  }
  if (to === "VERIFIED" || to === "REJECTED") {
    // …and never the person who submitted them (maker-checker).
    if (!reopened && c.kycSubmittedBy === user.id)
      throw ApiError.forbidden("KYC must be verified by someone other than the person who submitted it", {
        reason: "KYC_MAKER_CHECKER",
        submitted_by: c.kycSubmittedBy,
      });
    return { reopened };
  }
  // → SUBMITTED
  if (from === "REJECTED" && c.kycVerifiedAt && c.updatedAt.getTime() <= c.kycVerifiedAt.getTime()) {
    const [doc] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.entityType, "CUSTOMER"),
          eq(documents.entityId, c.id),
          eq(documents.isDeleted, false),
          gt(documents.createdAt, c.kycVerifiedAt),
        ),
      )
      .limit(1);
    if (!doc)
      throw ApiError.conflict(
        "KYC_TRANSITION_INVALID",
        "Correct the customer's details or upload a new KYC document before resubmitting a rejected KYC",
        { from, to, reason: "UNCHANGED_SINCE_REJECTION" },
      );
  }
  const missing = await kycMissing(tx, c);
  if (missing.length > 0)
    throw new ApiError(422, "KYC_INCOMPLETE", `KYC cannot be submitted yet: missing ${missing.join(", ")}`, {
      missing,
    });
  return { reopened };
}

/** POST /customers/:id/erase is a deprecated alias of POST /admin/customers/:id/erase. */
export const CUSTOMER_ERASE_ALIAS_DEPRECATION = {
  since: "2026-10-26",
  sunset: "2027-04-24",
  replacement: "POST /api/v1/admin/customers/:id/erase",
} as const;

/** /customers routes: list, create, get (masked / audited reveal), update, KYC, co-applicants, 360, deactivate/activate, erase, duplicate check. */
export function customerRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/customers",
    permission: "customer.read",
    schema: {
      querystring: CustomerFilterSchema,
      response: { 200: CustomerListResponseSchema },
      summary: "List customers (masked KYC)",
    },
    handler: async (req, reply) => {
      const q = req.query;
      const user = req.user!;
      // project scope (SPEC §1): a scoped user lists only customers linked to their projects (or their own unlinked records)
      const where: (SQL | undefined)[] = [eq(customers.companyId, user.companyId), customerScopeCondition(user)];
      if (!q.include_inactive) where.push(eq(customers.isActive, true));
      if (q.kyc_status) where.push(eq(customers.kycStatus, q.kyc_status));
      if (q.relationship_manager_id) where.push(eq(customers.relationshipManagerId, q.relationship_manager_id));
      if (q.source) where.push(eq(customers.source, q.source));
      if (q.tag) where.push(sql`${q.tag} = any(${customers.tags})`);
      if (q.phone) where.push(eq(customers.phone, q.phone));
      if (q.project_id) {
        ensureProjectAccess(user, q.project_id); // scoped users cannot probe foreign projects (404)
        where.push(
          // primary or co-applicant as two index lookups (an OR inside one EXISTS reads every booking of the project per customer)
          sql`(exists (select 1 from ${bookings} b where b.customer_id = ${customers.id} and b.project_id = ${q.project_id})
            or exists (select 1 from ${bookingCoApplicants} bc join ${bookings} b on b.id = bc.booking_id
              where bc.customer_id = ${customers.id} and b.project_id = ${q.project_id}))`,
        );
      }
      if (q.has_active_booking === true) where.push(gt(CUSTOMER_SELECT.activeBookings, 0));
      if (q.has_active_booking === false) where.push(eq(CUSTOMER_SELECT.activeBookings, 0));
      if (q.portal_enabled === true)
        where.push(
          sql`exists (select 1 from ${portalUsers} pu where pu.customer_id = ${customers.id} and pu.is_enabled)`,
        );
      if (q.portal_enabled === false)
        where.push(
          sql`not exists (select 1 from ${portalUsers} pu where pu.customer_id = ${customers.id} and pu.is_enabled)`,
        );
      const result = await paginate<CustomerSelect>(app.dbReplica, {
        table: customers,
        select: CUSTOMER_SELECT,
        join: (qb) => joinRm(qb),
        countJoin: false, // the relationship manager is a to-one left join that no filter reads
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: {
          columns: [customers.fullName, customers.phone, customers.customerCode, customers.email],
          term: q.search,
        },
        sort: {
          allowed: {
            full_name: customers.fullName,
            customer_code: customers.customerCode,
            created_at: customers.createdAt,
            kyc_status: customers.kycStatus,
            phone: customers.phone,
          },
          default: "-created_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const items = await toCustomerRows(app.dbReplica, result.items);
      if (q.format === "csv") {
        const cols = [
          "customer_code",
          "full_name",
          "phone",
          "email",
          "kyc_status",
          "pan_masked",
          "aadhaar_masked",
          "relationship_manager_name",
          "source",
          "active_booking_count",
          "portal_enabled",
          "is_active",
          "created_at",
        ];
        return sendCsv(
          reply,
          "customers.csv",
          cols.map((k) => ({
            key: k,
            header: k,
            value: (r: Record<string, unknown>) => (Array.isArray(r[k]) ? (r[k] as unknown[]).join("|") : r[k]),
          })),
          items as unknown as Record<string, unknown>[],
        );
      }
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST",
    url: "/customers",
    permission: "customer.write",
    idempotent: true,
    schema: {
      body: CustomerCreateSchema,
      response: { 201: CustomerRowSchema },
      summary: "Create a customer (KYC encrypted at rest; duplicate phone/PAN → 409 DUPLICATE_CUSTOMER)",
    },
    handler: async (req, reply) => {
      const ctx = ctxOf(app, req);
      const row = await app.db.transaction((tx) => createCustomer(tx, ctx, req.body));
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "POST",
    url: "/customers/duplicate-check",
    permission: "customer.read",
    schema: {
      body: CustomerDuplicateCheckSchema,
      response: { 200: CustomerDuplicateCheckResponseSchema },
      summary: "Find customers sharing a phone or PAN",
    },
    handler: async (req) => {
      const user = req.user!;
      const companyId = user.companyId;
      const conds: SQL[] = [];
      const phone = req.body.phone ? canonicalPhone(req.body.phone) : null;
      // every key of the HASH_KEYS ring: a PAN hashed before a rotation is still found
      const panHashes = req.body.pan ? keyedHashes(normalizePAN(req.body.pan)) : [];
      if (phone) conds.push(eq(customers.phone, phone));
      if (panHashes.length > 0) conds.push(inArray(customers.panHash, panHashes));
      const visible = customerScopeCondition(user);
      const rows = await app.dbReplica
        .select({
          id: customers.id,
          code: customers.customerCode,
          name: customers.fullName,
          phone: customers.phone,
          panHash: customers.panHash,
          inScope: visible ? sql<boolean>`${visible}` : sql<boolean>`true`,
        })
        .from(customers)
        .where(
          and(
            eq(customers.companyId, companyId),
            isNull(customers.erasedAt),
            or(...conds),
            req.body.exclude_customer_id ? sql`${customers.id} <> ${req.body.exclude_customer_id}` : undefined,
          ),
        )
        .limit(20);
      // A duplicate outside the caller's project scope is still reported (one person, one record), but without the name and the full
      // phone: the caller learns that the person exists, not who they are or where they booked.
      const matches: CustomerDuplicateMatch[] = rows.map((r) => ({
        customer_id: r.id,
        customer_code: r.code,
        full_name: r.inScope ? r.name : "Existing customer (outside your projects)",
        phone: r.inScope ? r.phone : (maskPhone(r.phone) ?? ""),
        matched_on: phone && r.phone === phone ? "PHONE" : "PAN",
      }));
      return { matches };
    },
  });

  route(app, {
    method: "GET",
    url: "/customers/:id",
    permission: "customer.read",
    schema: {
      params: idParams,
      querystring: CustomerGetQuerySchema,
      response: {
        200: CustomerRevealedSchema.partial({
          pan: true,
          aadhaar: true,
          bank_account_number: true,
          co_applicants_revealed: true,
          revealed_at: true,
        }),
      },
      summary: "Get a customer; ?reveal=true needs customer.kyc_view and is audited",
    },
    handler: async (req) => {
      const user = req.user!;
      if (!req.query.reveal) return getCustomerRow(app.dbReplica, user.companyId, req.params.id, user);
      assertPermission(user, "customer.kyc_view");
      return app.db.transaction(async (tx) => {
        // scope first: a customer of another project is 404 even for a customer.kyc_view holder
        const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, false, user);
        const cas = await listCoApplicants(tx, req.params.id);
        const masked = customerRow(sel, cas);
        await writeAudit(tx, {
          companyId: user.companyId,
          ...metaOf(req),
          action: "customer.kyc_reveal",
          entityType: "customer",
          entityId: req.params.id,
          after: {
            fields: ["pan", "aadhaar", "bank_account_number", "co_applicants"],
            customer_code: sel.c.customerCode,
            filters: { customer_id: req.params.id, reveal: true },
            row_count: 1 + cas.length,
          },
        });
        return revealedRow(masked, sel.c, cas);
      });
    },
  });

  route(app, {
    method: "PATCH",
    url: "/customers/:id",
    permission: "customer.write",
    schema: {
      params: idParams,
      body: CustomerPatchSchema,
      response: { 200: CustomerRowSchema },
      summary: "Update a customer (version required)",
    },
    handler: async (req) => {
      const ctx = ctxOf(app, req);
      const version = expectedVersion(req, req.body);
      return app.db.transaction((tx) => updateCustomer(tx, ctx, req.params.id, version, { ...req.body, version }));
    },
  });

  route(app, {
    method: "POST",
    url: "/customers/:id/kyc",
    permission: "customer.write",
    schema: {
      params: idParams,
      body: withOptionalVersion(CustomerKycUpdateSchema),
      response: { 200: CustomerRowSchema },
      summary:
        "KYC workflow (maker-checker): SUBMITTED needs PAN + Aadhaar + a KYC document; VERIFIED/REJECTED only from SUBMITTED by a customer.kyc_view holder who is not the submitter; changing VERIFIED needs settings.manage + reason",
    },
    handler: async (req) => {
      const version = expectedVersion(req, req.body);
      const user = req.user!;
      const body = req.body;
      return app.db.transaction(async (tx) => {
        const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, true, user);
        const c = sel.c;
        if (c.erasedAt)
          throw ApiError.rule("This customer record was erased and can no longer be edited", "CUSTOMER_ERASED");
        const to = body.kyc_status;
        if (to === "PENDING")
          throw ApiError.rule("KYC can be set to SUBMITTED, VERIFIED or REJECTED", "KYC_STATUS_INVALID");
        await assertVersion(tx, customers, c.id, c.version, version, "customer"); // a stale form is a conflict before any workflow rule
        const decision = await kycTransition(tx, user, c, to, body.reason);
        const changes: Record<string, unknown> = { kycStatus: to, kycRemarks: body.kyc_remarks ?? null };
        if (to === "SUBMITTED")
          Object.assign(changes, {
            kycSubmittedBy: user.id,
            kycSubmittedAt: sql`now()`,
            kycVerifiedBy: null,
            kycVerifiedAt: null,
          });
        // DB time on purpose: the same clock as updated_at, so "edited since the rejection" compares like with like.
        else Object.assign(changes, { kycVerifiedBy: user.id, kycVerifiedAt: sql`now()` });
        await applyUpdate(tx, customers, req.params.id, version, changes, "customer");
        const after = await getCustomerRow(tx, user.companyId, req.params.id, user);
        await writeAudit(tx, {
          companyId: user.companyId,
          ...metaOf(req),
          action: decision.reopened ? "customer.kyc_reopened" : "customer.kyc",
          entityType: "customer",
          entityId: req.params.id,
          before: { kyc_status: c.kycStatus, kyc_submitted_by: c.kycSubmittedBy, kyc_verified_by: c.kycVerifiedBy },
          after: {
            kyc_status: to,
            kyc_remarks: body.kyc_remarks ?? null,
            ...(to === "SUBMITTED" ? { kyc_submitted_by: user.id } : { kyc_verified_by: user.id }),
            ...(body.reason ? { reason: body.reason } : {}),
          },
        });
        return after;
      });
    },
  });

  // ---- co-applicants -------------------------------------------------------
  route(app, {
    method: "GET",
    url: "/customers/:id/co-applicants",
    permission: "customer.read",
    schema: {
      params: idParams,
      response: { 200: CoApplicantListResponseSchema },
      summary: "Co-applicants of a customer (masked)",
    },
    handler: async (req) => {
      await loadCustomerSelect(app.dbReplica, req.user!.companyId, req.params.id, false, req.user!);
      return { items: (await listCoApplicants(app.dbReplica, req.params.id)).map(coApplicantRow) };
    },
  });

  route(app, {
    method: "POST",
    url: "/customers/:id/co-applicants",
    permission: "customer.write",
    idempotent: true,
    schema: {
      params: idParams,
      body: CoApplicantInputSchema.omit({ id: true }),
      response: { 201: CoApplicantRowSchema },
      summary: "Add a co-applicant (PAN/Aadhaar encrypted)",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const row = await app.db.transaction(async (tx) => {
        const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, true, user);
        if (sel.c.erasedAt)
          throw ApiError.rule("This customer record was erased and can no longer be edited", "CUSTOMER_ERASED");
        const [agg] = await tx
          .select({ n: sql<number>`coalesce(max(${coApplicants.sortOrder}), -1)::int` })
          .from(coApplicants)
          .where(eq(coApplicants.customerId, req.params.id));
        const [created] = await tx
          .insert(coApplicants)
          .values({
            companyId: user.companyId,
            customerId: req.params.id,
            fullName: req.body.full_name,
            relation: req.body.relation,
            ...coApplicantColumns(req.body),
            sortOrder: Number(agg?.n ?? -1) + 1,
          })
          .returning();
        if (!created) throw new Error("co-applicant insert returned no row");
        const view = coApplicantRow(created);
        await writeAudit(tx, {
          companyId: user.companyId,
          ...metaOf(req),
          action: "customer.co_applicant_add",
          entityType: "customer",
          entityId: req.params.id,
          after: view as unknown as Record<string, unknown>,
        });
        return view;
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "PATCH",
    url: "/customers/:id/co-applicants/:caId",
    permission: "customer.write",
    schema: {
      params: coParams,
      body: CoApplicantUpdateSchema,
      response: { 200: CoApplicantRowSchema },
      summary: "Update a co-applicant (version required: body.version or If-Match; stale → 409 VERSION_CONFLICT)",
    },
    handler: async (req) => {
      const user = req.user!;
      const { version: _v, ...patch } = req.body;
      const version = expectedVersion(req, req.body);
      return app.db.transaction(async (tx) => {
        const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, true, user);
        if (sel.c.erasedAt)
          throw ApiError.rule("This customer record was erased and can no longer be edited", "CUSTOMER_ERASED");
        const [existing] = await tx
          .select()
          .from(coApplicants)
          .where(and(eq(coApplicants.id, req.params.caId), eq(coApplicants.customerId, req.params.id)))
          .limit(1);
        if (!existing) throw ApiError.notFound("Co-applicant");
        const updated = await applyUpdate(
          tx,
          coApplicants,
          existing.id,
          version,
          coApplicantColumns(patch),
          "co_applicant",
        );
        const view = coApplicantRow(updated);
        await writeAudit(tx, {
          companyId: user.companyId,
          ...metaOf(req),
          action: "customer.co_applicant_update",
          entityType: "customer",
          entityId: req.params.id,
          before: coApplicantRow(existing) as unknown as Record<string, unknown>,
          after: view as unknown as Record<string, unknown>,
        });
        return view;
      });
    },
  });

  route(app, {
    method: "DELETE",
    url: "/customers/:id/co-applicants/:caId",
    permission: "customer.write",
    schema: { params: coParams, response: { 204: z.null() }, summary: "Remove a co-applicant" },
    handler: async (req, reply) => {
      const user = req.user!;
      await app.db.transaction(async (tx) => {
        const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, true, user);
        if (sel.c.erasedAt)
          throw ApiError.rule("This customer record was erased and can no longer be edited", "CUSTOMER_ERASED");
        const [existing] = await tx
          .select()
          .from(coApplicants)
          .where(and(eq(coApplicants.id, req.params.caId), eq(coApplicants.customerId, req.params.id)))
          .limit(1);
        if (!existing) throw ApiError.notFound("Co-applicant");
        await assertVersion(
          tx,
          coApplicants,
          existing.id,
          existing.version,
          expectedVersion(req, null),
          "co_applicant",
        );
        await tx.delete(coApplicants).where(eq(coApplicants.id, existing.id));
        await writeAudit(tx, {
          companyId: user.companyId,
          ...metaOf(req),
          action: "customer.co_applicant_remove",
          entityType: "customer",
          entityId: req.params.id,
          before: coApplicantRow(existing) as unknown as Record<string, unknown>,
        });
      });
      return reply.code(204).send();
    },
  });

  // ---- 360 -----------------------------------------------------------------
  route(app, {
    method: "GET",
    url: "/customers/:id/360",
    permission: "customer.read",
    schema: {
      params: idParams,
      response: { 200: Customer360ResponseSchema },
      summary: "Customer 360: profile, bookings, payments, documents, leads, tickets, portal",
    },
    handler: async (req) => customer360(app.dbReplica, req.user!.companyId, req.params.id, req.user!),
  });

  // ---- deactivate / activate / erase ----------------------------------------
  for (const action of ["deactivate", "activate"] as const) {
    route(app, {
      method: "POST",
      url: `/customers/:id/${action}`,
      permission: "customer.write",
      schema: {
        params: idParams,
        body: VersionedSchema.partial().optional(),
        response: { 200: ActiveStateResponseSchema },
        summary: `${action === "deactivate" ? "Deactivate" : "Restore"} a customer (only without ACTIVE bookings)`,
      },
      handler: async (req) => {
        const user = req.user!;
        let portalUserId: string | null = null;
        const result = await app.db.transaction(async (tx) => {
          const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, true, user);
          if (sel.c.erasedAt)
            throw ApiError.rule("An erased customer record cannot be reactivated or deactivated", "CUSTOMER_ERASED");
          if (action === "deactivate") {
            const n = await activeBookingCount(tx, req.params.id);
            if (n > 0)
              throw ApiError.conflict("IN_USE", `This customer has ${n} active booking(s) and cannot be deactivated`, {
                usage_count: n,
                used_by: [{ entity_type: "bookings", count: n }],
              });
          }
          const version = expectedVersion(req, req.body);
          const updated = await applyUpdate(
            tx,
            customers,
            req.params.id,
            version,
            action === "deactivate"
              ? { isActive: false, deactivatedAt: new Date() }
              : { isActive: true, deactivatedAt: null },
            "customer",
          );
          if (action === "deactivate") {
            // Portal login is switched off with the customer (re-enable it explicitly after restoring); live sessions die now.
            const [pu] = await tx
              .select({ id: portalUsers.id, isEnabled: portalUsers.isEnabled })
              .from(portalUsers)
              .where(eq(portalUsers.customerId, req.params.id))
              .limit(1)
              .for("update");
            if (pu) {
              portalUserId = pu.id;
              await revokeAllFamilies(tx, securityRedis(app), "CUSTOMER", pu.id, "CUSTOMER_DEACTIVATED");
              if (pu.isEnabled)
                await tx
                  .update(portalUsers)
                  .set({ isEnabled: false, disabledAt: new Date(), version: sql`${portalUsers.version} + 1` })
                  .where(eq(portalUsers.id, pu.id));
            }
          }
          await writeAudit(tx, {
            companyId: user.companyId,
            ...metaOf(req),
            action: `customer.${action}`,
            entityType: "customer",
            entityId: req.params.id,
            before: { is_active: sel.c.isActive },
            after: { is_active: updated.isActive },
          });
          return { id: updated.id, is_active: updated.isActive, version: updated.version };
        });
        // only this customer's cached portal identity is re-read (its sessions are already revoked above)
        if (portalUserId) await bumpAuthVersions(app.redis, { portalUsers: [portalUserId] }, req.log);
        return result;
      },
    });
  }

  // Deprecated alias of POST /admin/customers/:id/erase (audit F: two contracts for one destructive operation). It delegates to the one
  // erasure implementation (admin eraseCustomer) with the canonical route's request and response schemas and idempotency, and sends
  // Deprecation / Sunset / Link headers until its sunset (docs/VERSIONING.md).
  route(app, {
    method: "POST",
    url: "/customers/:id/erase",
    permission: "admin.tools",
    idempotent: true,
    deprecated: CUSTOMER_ERASE_ALIAS_DEPRECATION,
    schema: {
      params: idParams,
      body: AdminCustomerEraseRequestSchema,
      response: { 200: AdminCustomerEraseResponseSchema },
      summary:
        "Right to erasure (deprecated alias of POST /admin/customers/:id/erase; same request, response and idempotency)",
    },
    handler: async (req) => {
      const user = req.user!;
      if (!isSuperAdmin(user))
        throw new ApiError(403, "SUPER_ADMIN_ONLY", "Only the Super Admin role may perform this action");
      return eraseCustomer(app, {
        companyId: user.companyId,
        customerId: req.params.id,
        reason: req.body.reason ?? null,
        meta: metaOf(req),
      });
    },
  });

  // Relationship managers for the RM dropdown (active Sales users) — tiny helper used by the ERP customer form.
  route(app, {
    method: "GET",
    url: "/customers/relationship-managers",
    permission: "customer.read",
    schema: {
      response: { 200: z.object({ items: z.array(z.object({ id: IdSchema, name: z.string(), email: z.string() })) }) },
      summary: "Active staff selectable as relationship manager",
    },
    handler: async (req) => {
      const rows = await app.dbReplica
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(and(eq(users.companyId, req.user!.companyId), eq(users.isActive, true)))
        .orderBy(users.name);
      return { items: rows };
    },
  });
}
