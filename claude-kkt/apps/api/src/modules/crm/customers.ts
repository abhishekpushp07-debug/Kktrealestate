import { and, desc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ActiveStateResponseSchema,
  CoApplicantInputSchema,
  CoApplicantListResponseSchema,
  CoApplicantRowSchema,
  CoApplicantUpdateSchema,
  Customer360ResponseSchema,
  CustomerCreateSchema,
  CustomerDuplicateCheckResponseSchema,
  CustomerDuplicateCheckSchema,
  CustomerEraseSchema,
  CustomerFilterSchema,
  CustomerGetQuerySchema,
  CustomerKycUpdateSchema,
  CustomerListResponseSchema,
  CustomerRevealedSchema,
  CustomerRowSchema,
  CustomerUpdateSchema,
  IdSchema,
  VersionedSchema,
  type Customer360Response,
  type CustomerDuplicateMatch,
} from "@kkt/contracts";
import { blocks, bookingCoApplicants, bookings, coApplicants, customers, documentTypes, documents, leads, payments, portalUsers, projects, serviceRequests, users, type Executor } from "@kkt/db";
import { normalizePAN } from "@kkt/domain";
import { writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { keyedHash } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { assertPermission, ensureProjectAccess, scopeFilter } from "../../lib/scope.js";
import { applyUpdate, expectedVersion, optionalExpectedVersion, withOptionalVersion } from "../../lib/version.js";
import { revokeAllFamilies } from "../auth/service.js";
import { bumpPermVersion } from "../../lib/cache.js";
import {
  CUSTOMER_SELECT, activeBookingCount, canonicalPhone, coApplicantColumns, coApplicantRow, coApplicantsFor, createCustomer, customerRow, getCustomerRow, joinRm, listCoApplicants, loadCustomerSelect,
  metaOf, portalAccessView, revealedRow, toCustomerRows, updateCustomer, type CustomerSelect, type CustomerWriteContext,
} from "./customerService.js";

const idParams = z.object({ id: IdSchema });
const coParams = z.object({ id: IdSchema, caId: IdSchema });

function ctxOf(app: FastifyInstance, req: FastifyRequest): CustomerWriteContext {
  return { user: req.user!, redis: app.redis, meta: metaOf(req) };
}

/** Customer 360: profile + bookings + recent payments + documents + leads + tickets + portal state (joins only; no N+1). */
async function customer360(db: Executor, companyId: string, id: string, user: FastifyRequest["user"]): Promise<Customer360Response> {
  const sel = await loadCustomerSelect(db, companyId, id);
  const cas = await coApplicantsFor(db, [id]);
  const customer = customerRow(sel, cas.get(id) ?? []);
  const scope = user ? scopeFilter(user, bookings.projectId) : undefined;
  const [bookingRows, paymentRows, docRows, leadRows, ticketRows, portal] = await Promise.all([
    db
      .select({
        b: bookings, projectName: projects.name, blockName: blocks.name,
        role: sql<"PRIMARY" | "CO_APPLICANT">`case when ${bookings.customerId} = ${id} then 'PRIMARY' else 'CO_APPLICANT' end`,
      })
      .from(bookings)
      .innerJoin(projects, eq(projects.id, bookings.projectId))
      .innerJoin(blocks, eq(blocks.id, bookings.blockId))
      .where(and(eq(bookings.companyId, companyId), scope, or(eq(bookings.customerId, id), sql`exists (select 1 from ${bookingCoApplicants} bc where bc.booking_id = ${bookings.id} and bc.customer_id = ${id})`)))
      .orderBy(desc(bookings.bookingDate)),
    db
      .select({ p: payments, bookingNumber: bookings.bookingNumber })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(and(eq(payments.companyId, companyId), eq(payments.customerId, id), scope ? scopeFilter(user!, payments.projectId) : undefined))
      .orderBy(desc(payments.paymentDate), desc(payments.postedAt))
      .limit(10),
    db
      .select({ d: documents, typeName: documentTypes.name })
      .from(documents)
      .leftJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.companyId, companyId), eq(documents.entityType, "CUSTOMER"), eq(documents.entityId, id), eq(documents.isDeleted, false)))
      .orderBy(desc(documents.createdAt))
      .limit(50),
    db
      .select({ l: leads, projectName: projects.name })
      .from(leads)
      .leftJoin(projects, eq(projects.id, leads.projectId))
      .where(and(eq(leads.companyId, companyId), or(eq(leads.customerId, id), eq(leads.phone, sel.c.phone))))
      .orderBy(desc(leads.createdAt))
      .limit(50),
    db.select().from(serviceRequests).where(and(eq(serviceRequests.companyId, companyId), eq(serviceRequests.customerId, id))).orderBy(desc(serviceRequests.createdAt)).limit(50),
    portalAccessView(db, companyId, sel.c),
  ]);
  const [payCount] = await db.select({ n: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.companyId, companyId), eq(payments.customerId, id)));
  return {
    customer,
    bookings: bookingRows.map((r) => ({
      booking_id: r.b.id, booking_number: r.b.bookingNumber, project_name: r.projectName, block_name: r.blockName,
      flat_number: String((r.b.flatSnapshot as { flat_number?: string } | null)?.flat_number ?? ""), status: r.b.status,
      plan_name: String((r.b.planSnapshot as { name?: string } | null)?.name ?? ""), agreement_value_paise: Number(r.b.agreementValuePaise),
      total_paid_paise: Number(r.b.cashPaidPaise) + Number(r.b.accountPaidPaise),
      total_due_paise: Number(r.b.cashOrderRaisedPaise) + Number(r.b.accountOrderRaisedPaise) - Number(r.b.cashPaidPaise) - Number(r.b.accountPaidPaise),
      role: r.role,
    })),
    payments_recent: paymentRows.map((r) => ({
      payment_id: r.p.id, booking_id: r.p.bookingId, booking_number: r.bookingNumber, receipt_number: r.p.receiptNumber, amount_paise: Number(r.p.amountPaise), payment_date: r.p.paymentDate,
      mode_code: r.p.modeCode, bucket: r.p.bucket, against: r.p.against, status: r.p.status,
    })),
    documents: docRows.map((r) => ({ document_id: r.d.id, title: r.d.title, file_name: r.d.fileName, mime: r.d.mime, document_type_name: r.typeName ?? null, is_sensitive: r.d.isSensitive, shared_with_customer: r.d.sharedWithCustomer, created_at: r.d.createdAt.toISOString() })),
    leads: leadRows.map((r) => ({ lead_id: r.l.id, lead_number: r.l.leadNumber, stage: r.l.stage, source: r.l.source, project_name: r.projectName ?? null, created_at: r.l.createdAt.toISOString() })),
    tickets: ticketRows.map((t) => ({ ticket_id: t.id, ticket_number: t.ticketNumber, subject: t.subject, status: t.status, priority: t.priority, created_at: t.createdAt.toISOString() })),
    payments_count: Number(payCount?.n ?? 0),
    documents_count: docRows.length,
    leads_count: leadRows.length,
    tickets_open: ticketRows.filter((t) => t.status !== "CLOSED" && t.status !== "RESOLVED").length,
    portal: portal.is_enabled || portal.enabled_at ? portal : null,
  };
}

/** /customers routes: list, create, get (masked / audited reveal), update, KYC, co-applicants, 360, deactivate/activate, erase, duplicate check. */
export function customerRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/customers", permission: "customer.read",
    schema: { querystring: CustomerFilterSchema, response: { 200: CustomerListResponseSchema }, summary: "List customers (masked KYC)" },
    handler: async (req, reply) => {
      const q = req.query;
      const user = req.user!;
      const where: (SQL | undefined)[] = [eq(customers.companyId, user.companyId)];
      if (!q.include_inactive) where.push(eq(customers.isActive, true));
      if (q.kyc_status) where.push(eq(customers.kycStatus, q.kyc_status));
      if (q.relationship_manager_id) where.push(eq(customers.relationshipManagerId, q.relationship_manager_id));
      if (q.source) where.push(eq(customers.source, q.source));
      if (q.tag) where.push(sql`${q.tag} = any(${customers.tags})`);
      if (q.phone) where.push(eq(customers.phone, q.phone));
      if (q.project_id) {
        ensureProjectAccess(user, q.project_id); // scoped users cannot probe foreign projects (404)
        where.push(sql`exists (select 1 from ${bookings} b where b.project_id = ${q.project_id} and (b.customer_id = ${customers.id} or exists (select 1 from ${bookingCoApplicants} bc where bc.booking_id = b.id and bc.customer_id = ${customers.id})))`);
      }
      if (q.has_active_booking === true) where.push(gt(CUSTOMER_SELECT.activeBookings, 0));
      if (q.has_active_booking === false) where.push(eq(CUSTOMER_SELECT.activeBookings, 0));
      if (q.portal_enabled === true) where.push(sql`exists (select 1 from ${portalUsers} pu where pu.customer_id = ${customers.id} and pu.is_enabled)`);
      if (q.portal_enabled === false) where.push(sql`not exists (select 1 from ${portalUsers} pu where pu.customer_id = ${customers.id} and pu.is_enabled)`);
      const result = await paginate<CustomerSelect>(app.dbReplica, {
        table: customers,
        select: CUSTOMER_SELECT,
        join: (qb) => joinRm(qb),
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [customers.fullName, customers.phone, customers.customerCode, customers.email], term: q.search },
        sort: { allowed: { full_name: customers.fullName, customer_code: customers.customerCode, created_at: customers.createdAt, kyc_status: customers.kycStatus, phone: customers.phone }, default: "-created_at", requested: q.sort },
        ...listPaging(q),
      });
      const items = await toCustomerRows(app.dbReplica, result.items);
      if (q.format === "csv") {
        const cols = ["customer_code", "full_name", "phone", "email", "kyc_status", "pan_masked", "aadhaar_masked", "relationship_manager_name", "source", "active_booking_count", "portal_enabled", "is_active", "created_at"];
        return sendCsv(reply, "customers.csv", cols.map((k) => ({ key: k, header: k, value: (r: Record<string, unknown>) => (Array.isArray(r[k]) ? (r[k] as unknown[]).join("|") : r[k]) })), items as unknown as Record<string, unknown>[]);
      }
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST", url: "/customers", permission: "customer.write", idempotent: true,
    schema: { body: CustomerCreateSchema, response: { 201: CustomerRowSchema }, summary: "Create a customer (KYC encrypted at rest; duplicate phone/PAN → 409 DUPLICATE_CUSTOMER)" },
    handler: async (req, reply) => {
      const ctx = ctxOf(app, req);
      const row = await app.db.transaction((tx) => createCustomer(tx, ctx, req.body));
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "POST", url: "/customers/duplicate-check", permission: "customer.read",
    schema: { body: CustomerDuplicateCheckSchema, response: { 200: CustomerDuplicateCheckResponseSchema }, summary: "Find customers sharing a phone or PAN" },
    handler: async (req) => {
      const companyId = req.user!.companyId;
      const conds: SQL[] = [];
      const phone = req.body.phone ? canonicalPhone(req.body.phone) : null;
      const panHash = req.body.pan ? keyedHash(normalizePAN(req.body.pan)) : null;
      if (phone) conds.push(eq(customers.phone, phone));
      if (panHash) conds.push(eq(customers.panHash, panHash));
      const rows = await app.dbReplica
        .select({ id: customers.id, code: customers.customerCode, name: customers.fullName, phone: customers.phone, panHash: customers.panHash })
        .from(customers)
        .where(and(eq(customers.companyId, companyId), isNull(customers.erasedAt), or(...conds), req.body.exclude_customer_id ? sql`${customers.id} <> ${req.body.exclude_customer_id}` : undefined))
        .limit(20);
      const matches: CustomerDuplicateMatch[] = rows.map((r) => ({ customer_id: r.id, customer_code: r.code, full_name: r.name, phone: r.phone, matched_on: phone && r.phone === phone ? "PHONE" : "PAN" }));
      return { matches };
    },
  });

  route(app, {
    method: "GET", url: "/customers/:id", permission: "customer.read",
    schema: { params: idParams, querystring: CustomerGetQuerySchema, response: { 200: CustomerRevealedSchema.partial({ pan: true, aadhaar: true, bank_account_number: true, co_applicants_revealed: true, revealed_at: true }) }, summary: "Get a customer; ?reveal=true needs customer.kyc_view and is audited" },
    handler: async (req) => {
      const user = req.user!;
      if (!req.query.reveal) return getCustomerRow(app.dbReplica, user.companyId, req.params.id);
      assertPermission(user, "customer.kyc_view");
      return app.db.transaction(async (tx) => {
        const sel = await loadCustomerSelect(tx, user.companyId, req.params.id);
        const cas = await listCoApplicants(tx, req.params.id);
        const masked = customerRow(sel, cas);
        await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: "customer.kyc_reveal", entityType: "customer", entityId: req.params.id, after: { fields: ["pan", "aadhaar", "bank_account_number", "co_applicants"], customer_code: sel.c.customerCode } });
        return revealedRow(masked, sel.c, cas);
      });
    },
  });

  route(app, {
    method: "PATCH", url: "/customers/:id", permission: "customer.write",
    schema: { params: idParams, body: withOptionalVersion(CustomerUpdateSchema), response: { 200: CustomerRowSchema }, summary: "Update a customer (version required)" },
    handler: async (req) => {
      const ctx = ctxOf(app, req);
      const version = expectedVersion(req, req.body);
      return app.db.transaction((tx) => updateCustomer(tx, ctx, req.params.id, version, { ...req.body, version }));
    },
  });

  route(app, {
    method: "POST", url: "/customers/:id/kyc", permission: "customer.write",
    schema: { params: idParams, body: CustomerKycUpdateSchema, response: { 200: CustomerRowSchema }, summary: "Set KYC status (verifier recorded)" },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, true);
        const status = req.body.kyc_status;
        if (status === "PENDING") throw ApiError.rule("KYC can be set to SUBMITTED, VERIFIED or REJECTED", "KYC_STATUS_INVALID");
        const verified = status === "VERIFIED" || status === "REJECTED";
        await applyUpdate(tx, customers, req.params.id, req.body.version, { kycStatus: status, kycRemarks: req.body.kyc_remarks ?? null, kycVerifiedBy: verified ? user.id : null, kycVerifiedAt: verified ? new Date() : null }, "customer");
        const after = await getCustomerRow(tx, user.companyId, req.params.id);
        await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: "customer.kyc", entityType: "customer", entityId: req.params.id, before: { kyc_status: sel.c.kycStatus }, after: { kyc_status: status, kyc_remarks: req.body.kyc_remarks ?? null, kyc_verified_by: verified ? user.id : null } });
        return after;
      });
    },
  });

  // ---- co-applicants -------------------------------------------------------
  route(app, {
    method: "GET", url: "/customers/:id/co-applicants", permission: "customer.read",
    schema: { params: idParams, response: { 200: CoApplicantListResponseSchema }, summary: "Co-applicants of a customer (masked)" },
    handler: async (req) => {
      await loadCustomerSelect(app.dbReplica, req.user!.companyId, req.params.id);
      return { items: (await listCoApplicants(app.dbReplica, req.params.id)).map(coApplicantRow) };
    },
  });

  route(app, {
    method: "POST", url: "/customers/:id/co-applicants", permission: "customer.write", idempotent: true,
    schema: { params: idParams, body: CoApplicantInputSchema.omit({ id: true }), response: { 201: CoApplicantRowSchema }, summary: "Add a co-applicant (PAN/Aadhaar encrypted)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const row = await app.db.transaction(async (tx) => {
        await loadCustomerSelect(tx, user.companyId, req.params.id, true);
        const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${coApplicants.sortOrder}), -1)::int` }).from(coApplicants).where(eq(coApplicants.customerId, req.params.id));
        const [created] = await tx.insert(coApplicants).values({ companyId: user.companyId, customerId: req.params.id, fullName: req.body.full_name, relation: req.body.relation, ...coApplicantColumns(req.body), sortOrder: Number(n) + 1 }).returning();
        if (!created) throw new Error("co-applicant insert returned no row");
        const view = coApplicantRow(created);
        await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: "customer.co_applicant_add", entityType: "customer", entityId: req.params.id, after: view as unknown as Record<string, unknown> });
        return view;
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "PATCH", url: "/customers/:id/co-applicants/:caId", permission: "customer.write",
    schema: { params: coParams, body: CoApplicantUpdateSchema, response: { 200: CoApplicantRowSchema }, summary: "Update a co-applicant" },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        await loadCustomerSelect(tx, user.companyId, req.params.id, true);
        const [existing] = await tx.select().from(coApplicants).where(and(eq(coApplicants.id, req.params.caId), eq(coApplicants.customerId, req.params.id))).limit(1);
        if (!existing) throw ApiError.notFound("Co-applicant");
        const [updated] = await tx.update(coApplicants).set(coApplicantColumns(req.body)).where(eq(coApplicants.id, existing.id)).returning();
        const view = coApplicantRow(updated!);
        await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: "customer.co_applicant_update", entityType: "customer", entityId: req.params.id, before: coApplicantRow(existing) as unknown as Record<string, unknown>, after: view as unknown as Record<string, unknown> });
        return view;
      });
    },
  });

  route(app, {
    method: "DELETE", url: "/customers/:id/co-applicants/:caId", permission: "customer.write",
    schema: { params: coParams, response: { 204: z.null() }, summary: "Remove a co-applicant" },
    handler: async (req, reply) => {
      const user = req.user!;
      await app.db.transaction(async (tx) => {
        await loadCustomerSelect(tx, user.companyId, req.params.id, true);
        const [existing] = await tx.select().from(coApplicants).where(and(eq(coApplicants.id, req.params.caId), eq(coApplicants.customerId, req.params.id))).limit(1);
        if (!existing) throw ApiError.notFound("Co-applicant");
        await tx.delete(coApplicants).where(eq(coApplicants.id, existing.id));
        await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: "customer.co_applicant_remove", entityType: "customer", entityId: req.params.id, before: coApplicantRow(existing) as unknown as Record<string, unknown> });
      });
      return reply.code(204).send();
    },
  });

  // ---- 360 -----------------------------------------------------------------
  route(app, {
    method: "GET", url: "/customers/:id/360", permission: "customer.read",
    schema: { params: idParams, response: { 200: Customer360ResponseSchema }, summary: "Customer 360: profile, bookings, payments, documents, leads, tickets, portal" },
    handler: async (req) => customer360(app.dbReplica, req.user!.companyId, req.params.id, req.user!),
  });

  // ---- deactivate / activate / erase ----------------------------------------
  for (const action of ["deactivate", "activate"] as const) {
    route(app, {
      method: "POST", url: `/customers/:id/${action}`, permission: "customer.write",
      schema: { params: idParams, body: VersionedSchema.partial().optional(), response: { 200: ActiveStateResponseSchema }, summary: `${action === "deactivate" ? "Deactivate" : "Restore"} a customer (only without ACTIVE bookings)` },
      handler: async (req) => {
        const user = req.user!;
        const result = await app.db.transaction(async (tx) => {
          const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, true);
          if (action === "deactivate") {
            const n = await activeBookingCount(tx, req.params.id);
            if (n > 0) throw ApiError.conflict("IN_USE", `This customer has ${n} active booking(s) and cannot be deactivated`, { usage_count: n, used_by: [{ entity_type: "bookings", count: n }] });
          }
          const version = optionalExpectedVersion(req, req.body, sel.c.version);
          const updated = await applyUpdate(tx, customers, req.params.id, version, action === "deactivate" ? { isActive: false, deactivatedAt: new Date() } : { isActive: true, deactivatedAt: null }, "customer");
          if (action === "deactivate") {
            const [pu] = await tx.select({ id: portalUsers.id }).from(portalUsers).where(eq(portalUsers.customerId, req.params.id)).limit(1);
            if (pu) await revokeAllFamilies(tx, app.redis, "CUSTOMER", pu.id, "CUSTOMER_DEACTIVATED");
          }
          await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: `customer.${action}`, entityType: "customer", entityId: req.params.id, before: { is_active: sel.c.isActive }, after: { is_active: updated.isActive } });
          return { id: updated.id, is_active: updated.isActive, version: updated.version };
        });
        await bumpPermVersion(app.redis);
        return result;
      },
    });
  }

  route(app, {
    method: "POST", url: "/customers/:id/erase", permission: "admin.tools",
    schema: { params: idParams, body: CustomerEraseSchema, response: { 200: CustomerRowSchema }, summary: "Right to erasure: anonymise PII (no active booking); financial records stay" },
    handler: async (req) => {
      const user = req.user!;
      const result = await app.db.transaction(async (tx) => {
        const sel = await loadCustomerSelect(tx, user.companyId, req.params.id, true);
        if (sel.c.erasedAt) throw ApiError.rule("Customer is already erased", "ALREADY_ERASED");
        const n = await activeBookingCount(tx, req.params.id);
        if (n > 0) throw ApiError.conflict("IN_USE", `This customer has ${n} active booking(s); erasure is only possible without active bookings`, { usage_count: n, used_by: [{ entity_type: "bookings", count: n }] });
        const before = await getCustomerRow(tx, user.companyId, req.params.id);
        const anon = `Erased customer ${sel.c.customerCode}`;
        await tx.update(customers).set({
          salutation: null, fullName: anon, fatherOrSpouseName: null, dob: null, gender: null, phone: `0000${sel.c.customerCode.replace(/\D/g, "").slice(-6).padStart(6, "0")}`, altPhone: null, email: null,
          addressCurrent: null, addressPermanent: null, occupation: null, companyName: null, incomeBand: null, panEnc: null, panHash: null, panLast4: null, aadhaarEnc: null, aadhaarHash: null, aadhaarLast4: null,
          bank: null, nominee: null, notes: null, tags: [], isActive: false, deactivatedAt: new Date(), erasedAt: new Date(), version: sql`${customers.version} + 1`,
        }).where(eq(customers.id, req.params.id));
        await tx.delete(coApplicants).where(eq(coApplicants.customerId, req.params.id));
        const [pu] = await tx.select({ id: portalUsers.id }).from(portalUsers).where(eq(portalUsers.customerId, req.params.id)).limit(1);
        if (pu) {
          await revokeAllFamilies(tx, app.redis, "CUSTOMER", pu.id, "CUSTOMER_ERASED");
          await tx.update(portalUsers).set({ isEnabled: false, disabledAt: new Date() }).where(eq(portalUsers.id, pu.id));
        }
        const after = await getCustomerRow(tx, user.companyId, req.params.id);
        await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: "customer.erase", entityType: "customer", entityId: req.params.id, before: { customer_code: before.customer_code, kyc_status: before.kyc_status }, after: { reason: req.body.reason, erased_at: after.erased_at } });
        return after;
      });
      await bumpPermVersion(app.redis);
      return result;
    },
  });

  // Relationship managers for the RM dropdown (active Sales users) — tiny helper used by the ERP customer form.
  route(app, {
    method: "GET", url: "/customers/relationship-managers", permission: "customer.read",
    schema: { response: { 200: z.object({ items: z.array(z.object({ id: IdSchema, name: z.string(), email: z.string() })) }) }, summary: "Active staff selectable as relationship manager" },
    handler: async (req) => {
      const rows = await app.dbReplica.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.companyId, req.user!.companyId), eq(users.isActive, true))).orderBy(users.name);
      return { items: rows };
    },
  });
}
