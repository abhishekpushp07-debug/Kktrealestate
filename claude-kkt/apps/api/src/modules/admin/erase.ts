/**
 * Right to erasure (SPEC §2, DPDP): anonymises a customer's PII once they have no ACTIVE booking (as primary or co-applicant), keeping
 * every financial row (bookings, demands, payments, ledger) intact. Co-applicants are anonymised, the portal login is disabled with its
 * sessions revoked, customer documents are soft-deleted, and every other copy of the PII goes too: leads (linked or sharing the phone),
 * site visits, website enquiries with the phone, portal login events (identifier), testimonials (unpublished), booking-wizard drafts that
 * name the customer, the customer's notifications (withdrawn) and staff notifications about them (scrubbed), the text of their service
 * requests (subject, description, rating comment, their own messages; staff messages are scrubbed of the name/phone/e-mail), and export
 * files made before the erasure (withdrawn). Every storage object involved (documents and renditions, ticket attachments, export files) is
 * queued in `storage_deletions` inside the same transaction, so a failed delete is retried by STORAGE_SWEEP instead of being forgotten.
 *
 * Audit history is immutable (DB trigger + revoked privileges): rows written before the erasure keep what they recorded (new rows mask
 * PII, lib/audit.ts). One `customer.erased` row records counts and the reason, never the PII. This is the ONLY erasure implementation:
 * POST /admin/customers/:id/erase is canonical; POST /customers/:id/erase (crm) is a deprecated alias that delegates here.
 */
import { and, eq, exists, inArray, isNotNull, isNull, like, lt, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  AdminCustomerEraseRequestSchema,
  AdminCustomerEraseResponseSchema,
  IdSchema,
  type AdminCustomerEraseResponse,
} from "@kkt/contracts";
import {
  bookingCoApplicants,
  bookingDrafts,
  bookings,
  cmsTestimonials,
  coApplicants,
  customers,
  demands,
  documents,
  enquiries,
  exports as exportsTable,
  leads,
  ledgerEntries,
  loginEvents,
  notifications,
  payments,
  portalUsers,
  serviceRequestMessages,
  serviceRequests,
  siteVisits,
  storageDeletions,
  type Executor,
} from "@kkt/db";
import { z } from "zod";
import { writeAudit } from "../../lib/audit.js";
import { bumpAuthVersions } from "../../lib/cache.js";
import { decryptField, randomToken } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { route, type Deprecation } from "../../lib/routes.js";
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

    // The customer's service requests (their text is scrubbed below; their attachments go with the customer's documents).
    const tickets = await tx
      .select({ id: serviceRequests.id })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.companyId, companyId), eq(serviceRequests.customerId, customerId)));
    const ticketIds = tickets.map((t) => t.id);
    const docs = await tx
      .select({ id: documents.id, storageKey: documents.storageKey, variants: documents.variants })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.isDeleted, false),
          or(
            and(eq(documents.entityType, "CUSTOMER"), eq(documents.entityId, customerId)),
            ticketIds.length > 0
              ? and(
                  eq(documents.entityType, "SERVICE_REQUEST"),
                  inArray(documents.entityId, ticketIds),
                  eq(documents.uploadedByType, "CUSTOMER"),
                )
              : undefined,
          ),
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
    // Identifiers as they may appear in free text and drafts: the old name, phones, e-mail and the plaintext PAN/Aadhaar (decrypted here,
    // in-process, from the values being erased; never stored or logged).
    const plainIds = [safeDecrypt(c.panEnc), safeDecrypt(c.aadhaarEnc)].filter(
      (v): v is string => typeof v === "string" && v.length >= 4,
    );
    const textIds = [c.fullName, ...phones, ...(c.email ? [c.email] : [])].filter((v) => v.trim().length >= 3);
    const draftRows = await scrubDrafts(tx, companyId, [
      customerId,
      ...phones,
      ...plainIds,
      ...(c.email ? [c.email] : []),
    ]);
    const notificationRows = await scrubNotifications(tx, companyId, customerId, textIds, name);
    const ticketRows = await scrubTickets(tx, ticketIds, textIds, name);
    const exportRows = await withdrawExports(tx, companyId, now);

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

    // Every storage object of the erasure is queued in the same transaction (contract with the platform track's STORAGE_SWEEP): an object
    // whose delete fails right after commit is retried by the sweep instead of being forgotten.
    const keys = [
      ...docs.flatMap((d) => [d.storageKey, d.variants?.thumb_key, d.variants?.medium_key]),
      ...exportRows.map((e) => e.storageKey),
    ].filter((k): k is string => typeof k === "string" && k.length > 0);
    const queued =
      keys.length > 0
        ? await tx
            .insert(storageDeletions)
            .values(keys.map((key) => ({ key, companyId, reason: "CUSTOMER_ERASED" })))
            .returning({ id: storageDeletions.id, key: storageDeletions.key })
        : [];

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
        booking_drafts_scrubbed: draftRows,
        notifications_scrubbed: notificationRows,
        service_requests_scrubbed: ticketRows,
        exports_withdrawn: exportRows.length,
        storage_deletions_queued: queued.length,
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
        booking_drafts: draftRows,
        notifications: notificationRows,
        service_requests: ticketRows,
        exports_removed: exportRows.length,
        storage_deletions_queued: queued.length,
      },
      financial_rows_kept: {
        bookings: Number(kept?.bookings ?? 0),
        payments: Number(kept?.payments ?? 0),
        demands: Number(kept?.demands ?? 0),
        ledger_entries: Number(kept?.ledger ?? 0),
      },
    };
    return { response, queued, portalUserId: pu?.id ?? null };
  });

  // After commit: try the deletes right away; each success is marked done, each failure stays queued for STORAGE_SWEEP (retried with
  // backoff) — nothing is forgotten when storage is briefly unavailable.
  const store = storage();
  for (const q of result.queued) {
    try {
      await store.remove(q.key);
      await app.db.update(storageDeletions).set({ doneAt: new Date() }).where(eq(storageDeletions.id, q.id));
    } catch (err) {
      app.log.warn({ err, key: q.key }, "erase: storage delete failed; left queued for the storage sweep");
      await app.db
        .update(storageDeletions)
        .set({
          attempts: sql`${storageDeletions.attempts} + 1`,
          lastError: String((err as Error).message).slice(0, 500),
        })
        .where(eq(storageDeletions.id, q.id))
        .catch(() => undefined);
    }
  }
  if (result.portalUserId) await bumpAuthVersions(app.redis, { portalUsers: [result.portalUserId] }, app.log);
  return result.response;
}

/** Plaintext of a ciphertext, or null when it cannot be read (its key is gone or it is malformed): erasure never fails on it. */
function safeDecrypt(token: string | null): string | null {
  try {
    return decryptField(token);
  } catch {
    return null;
  }
}

/**
 * PostgreSQL regex matching `id` as a whole token, case-insensitively with the `i` flag: not preceded or followed by a letter or digit, so
 * erasing "Ravi Kumar" never rewrites "Ravi Kumaran", and an e-mail never matches inside a longer one.
 */
function tokenPattern(id: string): string {
  return `(?<![[:alnum:]_])${escapeRegex(id)}(?![[:alnum:]_])`;
}

/** `text` with every identifier (a whole token, case-insensitive) replaced by `replacement`. */
function scrubText(column: SQL | ReturnType<typeof sql.raw>, ids: readonly string[], replacement: string): SQL {
  let expr: SQL = sql`${column}`;
  for (const id of ids) expr = sql`regexp_replace(${expr}, ${tokenPattern(id)}, ${replacement}, 'gi')`;
  return expr;
}

/** True when `column` mentions `id` as a whole token (case-insensitive). */
function mentions(column: SQL, id: string): SQL {
  return sql`(${column} ~* ${tokenPattern(id)})`;
}

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Booking-wizard drafts of the company whose payload mentions the customer (id, phone, e-mail, PAN, Aadhaar): payload emptied. */
async function scrubDrafts(tx: Executor, companyId: string, needles: readonly string[]): Promise<number> {
  const terms = needles.filter((n) => n.length >= 4);
  if (terms.length === 0) return 0;
  const rows = await tx
    .update(bookingDrafts)
    .set({ payload: { erased: true }, step: 1, version: sql`${bookingDrafts.version} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(bookingDrafts.companyId, companyId),
        or(...terms.map((t) => mentions(sql`${bookingDrafts.payload}::text`, t))),
      ),
    )
    .returning({ id: bookingDrafts.id });
  return rows.length;
}

/**
 * The customer's own notifications are withdrawn and emptied; staff notifications about the customer (entity = the customer, or text
 * naming them) keep their event but lose the name, phone and e-mail.
 */
async function scrubNotifications(
  tx: Executor,
  companyId: string,
  customerId: string,
  textIds: readonly string[],
  erasedName: string,
): Promise<number> {
  const own = await tx
    .update(notifications)
    .set({ title: "Notification withdrawn", body: null, link: null, isWithdrawn: true })
    .where(
      and(
        eq(notifications.companyId, companyId),
        eq(notifications.recipientType, "CUSTOMER"),
        eq(notifications.recipientId, customerId),
      ),
    )
    .returning({ id: notifications.id });
  const named = textIds.map(
    (t) =>
      sql`(${mentions(sql`${notifications.title}`, t)} or ${mentions(sql`coalesce(${notifications.body}, '')`, t)})`,
  );
  const staff = await tx
    .update(notifications)
    .set({
      title: scrubText(sql`${notifications.title}`, textIds, erasedName),
      body: sql`case when ${notifications.body} is null then null else ${scrubText(sql`${notifications.body}`, textIds, erasedName)} end`,
    })
    .where(
      and(
        eq(notifications.companyId, companyId),
        eq(notifications.recipientType, "STAFF"),
        or(and(eq(notifications.entityType, "customer"), eq(notifications.entityId, customerId)), ...named),
      ),
    )
    .returning({ id: notifications.id });
  return own.length + staff.length;
}

/** The customer's service requests: subject/description/rating comment replaced, their own messages emptied, staff messages scrubbed. */
async function scrubTickets(
  tx: Executor,
  ticketIds: readonly string[],
  textIds: readonly string[],
  erasedName: string,
): Promise<number> {
  if (ticketIds.length === 0) return 0;
  const ids = [...ticketIds];
  const rows = await tx
    .update(serviceRequests)
    .set({
      subject: "Service request (customer erased)",
      description: null,
      ratingComment: null,
      version: sql`${serviceRequests.version} + 1`,
    })
    .where(inArray(serviceRequests.id, ids))
    .returning({ id: serviceRequests.id });
  await tx
    .update(serviceRequestMessages)
    .set({ body: "[removed: customer erased]", authorName: erasedName, attachmentIds: sql`'{}'::uuid[]` })
    .where(and(inArray(serviceRequestMessages.ticketId, ids), eq(serviceRequestMessages.authorType, "CUSTOMER")));
  if (textIds.length > 0)
    await tx
      .update(serviceRequestMessages)
      .set({ body: scrubText(sql`${serviceRequestMessages.body}`, textIds, erasedName) })
      .where(
        and(inArray(serviceRequestMessages.ticketId, ids), sql`${serviceRequestMessages.authorType} <> 'CUSTOMER'`),
      );
  return rows.length;
}

/**
 * Export files of the company made before the erasure that are still stored (list exports: any of them may hold the customer's row):
 * marked FAILED with the reason and their files queued for deletion. Backups (`admin:backup`) are not touched: they keep the encrypted
 * identifiers and expire with their own retention (docs/SECURITY.md).
 */
async function withdrawExports(
  tx: Executor,
  companyId: string,
  before: Date,
): Promise<{ id: string; storageKey: string | null }[]> {
  return tx
    .update(exportsTable)
    .set({
      status: "FAILED",
      error: "Withdrawn: a customer it may contain was erased (DPDP); export again",
      expiresAt: before,
    })
    .where(
      and(
        eq(exportsTable.companyId, companyId),
        like(exportsTable.path, "/api/v1/%"),
        isNotNull(exportsTable.storageKey),
        lt(exportsTable.createdAt, before),
        or(isNull(exportsTable.expiresAt), sql`${exportsTable.expiresAt} > ${before.toISOString()}::timestamptz`),
      ),
    )
    .returning({ id: exportsTable.id, storageKey: exportsTable.storageKey });
}

/**
 * Registers the erasure route at `url`: one definition (Super Admin, idempotent, AdminCustomerEraseRequest → AdminCustomerEraseResponse)
 * shared by the canonical route and the deprecated alias, so both answer identically (the alias adds Deprecation/Sunset/Link headers).
 */
export function registerCustomerEraseRoute(app: FastifyInstance, url: string, deprecated?: Deprecation): void {
  route(app, {
    method: "POST",
    url,
    permission: "admin.tools",
    idempotent: true,
    ...(deprecated ? { deprecated } : {}),
    schema: {
      params: z.object({ id: IdSchema }),
      body: AdminCustomerEraseRequestSchema,
      response: { 200: AdminCustomerEraseResponseSchema },
      summary: deprecated
        ? "Right to erasure (deprecated alias of POST /admin/customers/:id/erase; same request, response and idempotency)"
        : "Right to erasure (Super Admin): anonymise PII (customer, co-applicants, portal login, documents, leads, site visits, enquiries, testimonials, drafts, notifications, service-request text, prior exports) when no booking is ACTIVE; financial rows and audit history stay (409 HAS_ACTIVE_BOOKING)",
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

/**
 * POST /admin/customers/:id/erase (canonical). Its deprecated alias POST /customers/:id/erase is registered by the CRM module (so a
 * CRM-only build keeps it) and delegates to eraseCustomer with the same request/response schemas and idempotency.
 */
export function registerEraseRoutes(app: FastifyInstance): void {
  registerCustomerEraseRoute(app, "/admin/customers/:id/erase");
}
