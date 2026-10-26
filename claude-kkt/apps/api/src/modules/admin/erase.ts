/**
 * Right to erasure (SPEC §2): anonymises a customer's PII once they have no ACTIVE booking (as primary or co-applicant), keeping every
 * financial row (bookings, demands, payments, ledger) intact and never touching audit history. Co-applicants are anonymised, the portal
 * login is disabled with its sessions revoked, customer documents are soft-deleted and removed from storage, and every other copy of the
 * PII goes too: leads (linked or sharing the phone), site visits, website enquiries with the phone, portal login events (identifier) and
 * testimonials (unpublished). This is the ONLY erasure implementation: POST /customers/:id/erase (crm) delegates here.
 */
import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  AdminCustomerEraseRequestSchema,
  AdminCustomerEraseResponseSchema,
  IdSchema,
  type AdminCustomerEraseResponse,
} from "@kkt/contracts";
import {
  bookingCoApplicants,
  bookings,
  cmsTestimonials,
  coApplicants,
  customers,
  demands,
  documents,
  enquiries,
  leads,
  ledgerEntries,
  loginEvents,
  payments,
  portalUsers,
  siteVisits,
  type Executor,
} from "@kkt/db";
import { z } from "zod";
import { writeAudit } from "../../lib/audit.js";
import { bumpPermVersion } from "../../lib/cache.js";
import { randomToken } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { route } from "../../lib/routes.js";
import { createStorage, type Storage } from "../../lib/storage.js";
import { revokeAllFamilies } from "../auth/index.js";
import { adminMeta, requireSuperAdmin, staff, type AdminMeta } from "./common.js";
import { securityRedis } from "../../plugins/auth.js";

let storageInstance: Storage | null = null;
function storage(): Storage {
  storageInstance ??= createStorage();
  return storageInstance;
}

/**
 * Unique, obviously-fake phone placeholder for an erased record: a leading 0 (no Indian mobile starts with 0, so it can never collide
 * with a real customer or trip the portal's unique (company, phone) key) followed by 9 digits derived from the row id.
 */
export function erasedPhone(id: string): string {
  const n = BigInt(`0x${id.replace(/-/g, "").slice(0, 12)}`) % 1_000_000_000n;
  return `0${n.toString().padStart(9, "0")}`;
}

/** Display name of an erased customer (the code stays so financial rows remain readable). */
export function erasedName(customerCode: string): string {
  return `Erased customer ${customerCode}`;
}

/** Number of ACTIVE bookings the customer is on as primary applicant or co-applicant. */
export async function activeBookingsOf(db: Executor, customerId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "ACTIVE"),
        or(
          eq(bookings.customerId, customerId),
          exists(
            db
              .select({ one: sql`1` })
              .from(bookingCoApplicants)
              .where(
                and(eq(bookingCoApplicants.bookingId, bookings.id), eq(bookingCoApplicants.customerId, customerId)),
              ),
          ),
        ),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/** Input of eraseCustomer(). */
export interface EraseInput {
  companyId: string;
  customerId: string;
  reason: string | null;
  meta: AdminMeta;
}

/**
 * Performs the erasure in one transaction (409 HAS_ACTIVE_BOOKING / 422 ALREADY_ERASED), then removes the documents' bytes from storage
 * and drops the cached portal identity. Other modules (a future portal "delete my account" flow) may call it.
 */
export async function eraseCustomer(app: FastifyInstance, input: EraseInput): Promise<AdminCustomerEraseResponse> {
  const { companyId, customerId } = input;
  const result = await app.db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
      .limit(1)
      .for("update");
    if (!c) throw ApiError.notFound("Customer");
    if (c.erasedAt) throw ApiError.rule("Customer is already erased", "ALREADY_ERASED");
    const active = await activeBookingsOf(tx, customerId);
    if (active > 0)
      throw ApiError.conflict(
        "HAS_ACTIVE_BOOKING",
        `This customer is on ${active} active booking(s); erasure is only possible once none is active`,
        { active_bookings: active },
      );

    const now = new Date();
    const phone = erasedPhone(c.id);
    const name = erasedName(c.customerCode);
    const [updated] = await tx
      .update(customers)
      .set({
        salutation: null,
        fullName: name,
        fatherOrSpouseName: null,
        dob: null,
        gender: null,
        phone,
        altPhone: null,
        email: null,
        addressCurrent: null,
        addressPermanent: null,
        sameAsCurrent: true,
        occupation: null,
        companyName: null,
        incomeBand: null,
        source: null,
        panEnc: null,
        panHash: null,
        panLast4: null,
        aadhaarEnc: null,
        aadhaarHash: null,
        aadhaarLast4: null,
        bank: null,
        nominee: null,
        kycRemarks: null,
        notes: null,
        tags: [],
        isActive: false,
        deactivatedAt: c.deactivatedAt ?? now,
        erasedAt: now,
        version: sql`${customers.version} + 1`,
      })
      .where(eq(customers.id, customerId))
      .returning({ version: customers.version, erasedAt: customers.erasedAt });

    const cas = await tx
      .update(coApplicants)
      .set({
        fullName: "Erased co-applicant",
        relation: null,
        phone: null,
        email: null,
        panEnc: null,
        panHash: null,
        panLast4: null,
        aadhaarEnc: null,
        aadhaarLast4: null,
        updatedAt: now,
      })
      .where(eq(coApplicants.customerId, customerId))
      .returning({ id: coApplicants.id });

    let portalDisabled = false;
    let sessionsRevoked = 0;
    const [pu] = await tx
      .select({ id: portalUsers.id })
      .from(portalUsers)
      .where(eq(portalUsers.customerId, customerId))
      .limit(1)
      .for("update");
    if (pu) {
      sessionsRevoked = await revokeAllFamilies(tx, securityRedis(app), "CUSTOMER", pu.id, "CUSTOMER_ERASED");
      await tx
        .update(portalUsers)
        .set({
          isEnabled: false,
          disabledAt: now,
          phone,
          passwordHash: await hashPassword(randomToken(24)),
          mustChangePassword: true,
          failedAttempts: 0,
          lockedUntil: null,
          version: sql`${portalUsers.version} + 1`,
        })
        .where(eq(portalUsers.id, pu.id));
      portalDisabled = true;
    }

    const docs = await tx
      .select({ id: documents.id, storageKey: documents.storageKey, variants: documents.variants })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.entityType, "CUSTOMER"),
          eq(documents.entityId, customerId),
          eq(documents.isDeleted, false),
        ),
      );
    if (docs.length > 0)
      await tx
        .update(documents)
        .set({ isDeleted: true, deletedAt: now, updatedAt: now })
        .where(
          inArray(
            documents.id,
            docs.map((d) => d.id),
          ),
        );

    // Every other copy of the identity within the tenant: leads linked to the customer or carrying their phone, site visits, website
    // enquiries by phone, testimonials (withdrawn from the site). Business facts (visit status, lead stage, ticket history) stay.
    const phones = [c.phone, c.altPhone].filter((p): p is string => typeof p === "string" && p.length > 0);
    const leadRows = await tx
      .update(leads)
      .set({ fullName: name, phone, email: null, message: null })
      .where(and(eq(leads.companyId, companyId), or(eq(leads.customerId, customerId), inArray(leads.phone, phones))))
      .returning({ id: leads.id });
    const visitRows = await tx
      .update(siteVisits)
      .set({ name, phone, email: null, message: null, notes: null })
      .where(
        and(
          eq(siteVisits.companyId, companyId),
          or(eq(siteVisits.customerId, customerId), inArray(siteVisits.phone, phones)),
        ),
      )
      .returning({ id: siteVisits.id });
    const enquiryRows = await tx
      .update(enquiries)
      .set({ name, phone, email: null, message: null, ip: null })
      .where(and(eq(enquiries.companyId, companyId), inArray(enquiries.phone, phones)))
      .returning({ id: enquiries.id });
    // Portal sign-in history is keyed by phone: keep the events (security history), drop the number.
    const loginRows = await tx
      .update(loginEvents)
      .set({ identifier: phone })
      .where(and(eq(loginEvents.subjectType, "CUSTOMER"), inArray(loginEvents.identifier, phones)))
      .returning({ id: loginEvents.id });
    const testimonialRows = await tx
      .update(cmsTestimonials)
      .set({
        name,
        quote: "Testimonial withdrawn (customer erased)",
        photoDocumentId: null,
        isPublished: false,
        updatedAt: now,
      })
      .where(and(eq(cmsTestimonials.companyId, companyId), eq(cmsTestimonials.customerId, customerId)))
      .returning({ id: cmsTestimonials.id });

    const [kept] = await tx
      .select({
        bookings: sql<number>`(select count(*)::int from ${bookings} where ${bookings.customerId} = ${customerId})`,
        payments: sql<number>`(select count(*)::int from ${payments} where ${payments.customerId} = ${customerId})`,
        demands: sql<number>`(select count(*)::int from ${demands} where ${demands.customerId} = ${customerId})`,
        ledger: sql<number>`(select count(*)::int from ${ledgerEntries} where ${ledgerEntries.bookingId} in (select ${bookings.id} from ${bookings} where ${bookings.customerId} = ${customerId}))`,
      })
      .from(sql`(select 1) as one`);

    await writeAudit(tx, {
      companyId,
      actor: input.meta.actor,
      ip: input.meta.ip,
      requestId: input.meta.requestId,
      action: "customer.erased",
      entityType: "customer",
      entityId: customerId,
      before: {
        customer_code: c.customerCode,
        kyc_status: c.kycStatus,
        is_active: c.isActive,
        had_portal_access: Boolean(pu),
        documents: docs.length,
        co_applicants: cas.length,
      },
      after: {
        reason: input.reason,
        erased_at: now.toISOString(),
        full_name: name,
        documents_removed: docs.length,
        co_applicants_anonymised: cas.length,
        leads_anonymised: leadRows.length,
        site_visits_anonymised: visitRows.length,
        enquiries_anonymised: enquiryRows.length,
        login_events_anonymised: loginRows.length,
        testimonials_withdrawn: testimonialRows.length,
        portal_disabled: portalDisabled,
        sessions_revoked: sessionsRevoked,
        financial_rows_kept: {
          bookings: Number(kept?.bookings ?? 0),
          payments: Number(kept?.payments ?? 0),
          demands: Number(kept?.demands ?? 0),
          ledger_entries: Number(kept?.ledger ?? 0),
        },
      },
    });

    const response: AdminCustomerEraseResponse = {
      id: c.id,
      customer_code: c.customerCode,
      full_name: name,
      erased_at: now.toISOString(),
      version: updated?.version ?? c.version + 1,
      anonymised: {
        co_applicants: cas.length,
        documents: docs.length,
        leads: leadRows.length,
        site_visits: visitRows.length,
        enquiries: enquiryRows.length,
        testimonials: testimonialRows.length,
        portal_disabled: portalDisabled,
        sessions_revoked: sessionsRevoked,
      },
      financial_rows_kept: {
        bookings: Number(kept?.bookings ?? 0),
        payments: Number(kept?.payments ?? 0),
        demands: Number(kept?.demands ?? 0),
        ledger_entries: Number(kept?.ledger ?? 0),
      },
    };
    return { response, docs };
  });

  // After commit: the bytes leave storage (best effort, logged) and the cached portal identity dies with the next request.
  const store = storage();
  for (const d of result.docs) {
    const keys = [d.storageKey, d.variants?.thumb_key, d.variants?.medium_key].filter(
      (k): k is string => typeof k === "string" && k.length > 0,
    );
    for (const k of keys) {
      try {
        await store.remove(k);
      } catch (err) {
        app.log.warn({ err, key: k }, "erase: could not remove document from storage");
      }
    }
  }
  await bumpPermVersion(app.redis);
  return result.response;
}

/** POST /admin/customers/:id/erase. */
export function registerEraseRoutes(app: FastifyInstance): void {
  route(app, {
    method: "POST",
    url: "/admin/customers/:id/erase",
    permission: "admin.tools",
    idempotent: true,
    schema: {
      params: z.object({ id: IdSchema }),
      body: AdminCustomerEraseRequestSchema,
      response: { 200: AdminCustomerEraseResponseSchema },
      summary:
        "Right to erasure (Super Admin): anonymise PII (customer, co-applicants, portal login, documents, leads, site visits, enquiries, testimonials) when no booking is ACTIVE; financial rows and audit history stay (409 HAS_ACTIVE_BOOKING)",
      tags: ["admin"],
    },
    handler: async (req) => {
      const user = staff(req);
      requireSuperAdmin(user);
      return eraseCustomer(app, {
        companyId: user.companyId,
        customerId: req.params.id,
        reason: req.body.reason ?? null,
        meta: adminMeta(req),
      });
    },
  });
}
