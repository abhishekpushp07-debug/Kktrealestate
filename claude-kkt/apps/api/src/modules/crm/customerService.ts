import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import type { FastifyRequest } from "fastify";
import type {
  CoApplicantInput,
  CoApplicantRow,
  CustomerCreate,
  CustomerRevealed,
  CustomerRow,
  CustomerUpdate,
  PortalAccessResponse,
} from "@kkt/contracts";
import {
  bookingCoApplicants,
  bookings,
  coApplicants,
  customers,
  portalUsers,
  refreshTokens,
  siteSettings,
  users,
  type Executor,
} from "@kkt/db";
import {
  isValidAadhaar,
  isValidIFSC,
  maskAadhaar,
  maskAccount,
  maskPAN,
  normalizeAadhaar,
  normalizeIFSC,
  normalizeIndianPhone,
  normalizePAN,
  todayIST,
} from "@kkt/domain";
import { config } from "../../config.js";
import { actorFromRequest, writeAudit, type AuditActor } from "../../lib/audit.js";
import { loadCompany } from "../../lib/company.js";
import { decryptField, encryptField, keyedHash, keyedHashes } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { nextNumber } from "../../lib/numbering.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { customerScopeCondition, type StaffContext } from "../../lib/scope.js";
import { applyUpdate } from "../../lib/version.js";
import type { Redis } from "ioredis";

export type DbCustomer = typeof customers.$inferSelect;
export type DbCoApplicant = typeof coApplicants.$inferSelect;
export type DbPortalUser = typeof portalUsers.$inferSelect;

/** Request metadata every audit row of this module carries. */
export interface WriteMeta {
  actor: AuditActor;
  ip: string | null;
  requestId: string | null;
}

/** Builds WriteMeta from a staff/portal request. */
export function metaOf(req: FastifyRequest): WriteMeta {
  return { actor: actorFromRequest(req), ip: req.clientIp, requestId: req.id };
}

// ---------------------------------------------------------------------------
// Canonicalisation + encryption of KYC identifiers
// ---------------------------------------------------------------------------

/** 400 VALIDATION_ERROR with a contract-shaped `details.issues` list. */
export function validationError(path: string, message: string): ApiError {
  return ApiError.badRequest(`${path}: ${message}`, { issues: [{ path, message }] });
}

/** Canonical 10-digit phone or 400. */
export function canonicalPhone(input: string, path = "phone"): string {
  const p = normalizeIndianPhone(input);
  if (!p) throw validationError(path, "Enter a valid 10-digit Indian mobile number");
  return p;
}

/** Encrypted PAN columns (null-safe); 400 on an invalid PAN. */
export function panColumns(
  pan: string | null | undefined,
  path = "pan",
): { panEnc: string | null; panHash: string | null; panLast4: string | null } {
  if (pan === null || pan === undefined || pan === "") return { panEnc: null, panHash: null, panLast4: null };
  const clean = normalizePAN(pan);
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(clean)) throw validationError(path, "Invalid PAN");
  return { panEnc: encryptField(clean), panHash: keyedHash(clean), panLast4: clean.slice(-4) };
}

/** Encrypted Aadhaar columns (null-safe); 400 when the Verhoeff checksum fails. */
export function aadhaarColumns(
  aadhaar: string | null | undefined,
  path = "aadhaar",
): { aadhaarEnc: string | null; aadhaarHash: string | null; aadhaarLast4: string | null } {
  if (aadhaar === null || aadhaar === undefined || aadhaar === "")
    return { aadhaarEnc: null, aadhaarHash: null, aadhaarLast4: null };
  const clean = normalizeAadhaar(aadhaar);
  if (!isValidAadhaar(clean)) throw validationError(path, "Invalid Aadhaar number (checksum failed)");
  return { aadhaarEnc: encryptField(clean), aadhaarHash: keyedHash(clean), aadhaarLast4: clean.slice(-4) };
}

/** Encrypted bank details jsonb; 400 on an invalid IFSC. */
export function bankColumn(bank: CustomerCreate["bank"]): DbCustomer["bank"] {
  if (!bank) return null;
  const ifsc = normalizeIFSC(bank.ifsc);
  if (!isValidIFSC(ifsc)) throw validationError("bank.ifsc", "Invalid IFSC");
  const account = bank.account_number.replace(/\s+/g, "");
  return {
    bank_name: bank.bank_name,
    ifsc,
    holder_name: bank.holder_name,
    account_enc: encryptField(account)!,
    account_last4: account.slice(-4),
  };
}

/** Masked PAN from the ciphertext (decrypted in-process, never returned). */
function maskedPan(enc: string | null): string | null {
  const plain = decryptField(enc);
  return plain ? maskPAN(plain) : null;
}

function maskedAadhaar(enc: string | null): string | null {
  const plain = decryptField(enc);
  return plain ? maskAadhaar(plain) : null;
}

/** Masked bank account ("XXXXXXXXXX9012") from the stored ciphertext; falls back to the stored last-4 digits. */
function maskedAccount(bank: DbCustomer["bank"]): string | null {
  if (!bank) return null;
  const plain = bank.account_enc ? decryptField(bank.account_enc) : null;
  return plain ? maskAccount(plain) : maskAccount(`${"X".repeat(8)}${bank.account_last4}`);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** One row of the joined customer selection used by list and get. */
export interface CustomerSelect {
  c: DbCustomer;
  rmName: string | null;
  kycVerifierName: string | null;
  kycSubmitterName?: string | null;
  activeBookings: number | string;
  portalEnabled: boolean | null;
}

const rm = users;
// Correlated sub-selects spell the outer column as "customers"."id" on purpose: Drizzle renders selected columns unqualified
// when the query has a single table, and an unqualified "id" inside the sub-select would bind to the inner table.
/**
 * Active bookings where the customer is primary or co-applicant: the primary count plus the co-applicant count (bookings where the
 * customer is not also the primary), two index lookups (bookings_customer_idx, booking_co_applicants_customer_idx). The former single
 * `customer_id = … OR EXISTS (…)` could use no index and read every ACTIVE booking of the database for each listed customer (300 ms per
 * customers page at 15,000 bookings, docs/PERFORMANCE.md "Production-size run").
 */
export const activeBookingCountSql = sql<number>`(
  (select count(*)::int from ${bookings} b where b.customer_id = "customers"."id" and b.status = 'ACTIVE')
  + (select count(*)::int from ${bookingCoApplicants} bc join ${bookings} b on b.id = bc.booking_id
     where bc.customer_id = "customers"."id" and b.status = 'ACTIVE' and b.customer_id <> "customers"."id"))`;
const kycVerifierNameSql = sql<
  string | null
>`(select u.name from ${users} u where u.id = "customers"."kyc_verified_by")`;
const kycSubmitterNameSql = sql<
  string | null
>`(select u.name from ${users} u where u.id = "customers"."kyc_submitted_by")`;
const portalEnabledSql = sql<
  boolean | null
>`(select pu.is_enabled from ${portalUsers} pu where pu.customer_id = "customers"."id")`;

/** Drizzle selection for customer rows (join `users` as relationship manager with `joinRm`). */
export const CUSTOMER_SELECT = {
  c: customers,
  rmName: rm.name,
  kycVerifierName: kycVerifierNameSql,
  kycSubmitterName: kycSubmitterNameSql,
  activeBookings: activeBookingCountSql,
  portalEnabled: portalEnabledSql,
};

/** Left-joins the relationship manager (used by the dynamic list query). */
export function joinRm(q: PgSelect): PgSelect {
  return q.leftJoin(users, eq(users.id, customers.relationshipManagerId));
}

/** Co-applicant wire row (masked). */
export function coApplicantRow(r: DbCoApplicant): CoApplicantRow {
  return {
    id: r.id,
    customer_id: r.customerId,
    full_name: r.fullName,
    relation: r.relation ?? "",
    phone: r.phone,
    email: r.email,
    pan_masked: maskedPan(r.panEnc),
    aadhaar_masked: maskedAadhaar(r.aadhaarEnc),
    sort_order: r.sortOrder,
    version: r.version,
  };
}

function prepareCoApplicants(db: Executor) {
  return db
    .select()
    .from(coApplicants)
    .where(sql`${coApplicants.customerId} = any(${sql.placeholder("ids")}::uuid[])`)
    .orderBy(coApplicants.sortOrder, coApplicants.createdAt)
    .prepare("kkt_customer_co_applicants");
}

/** The co-applicant statement prepared once per executor (lists call it on every page). */
const coApplicantQueries = new WeakMap<Executor, ReturnType<typeof prepareCoApplicants>>();

/** Loads co-applicants for many customers in one query (no N+1). */
export async function coApplicantsFor(db: Executor, customerIds: string[]): Promise<Map<string, DbCoApplicant[]>> {
  const map = new Map<string, DbCoApplicant[]>();
  if (customerIds.length === 0) return map;
  let query = coApplicantQueries.get(db);
  if (!query) {
    query = prepareCoApplicants(db);
    coApplicantQueries.set(db, query);
  }
  const rows = await query.execute({ ids: `{${customerIds.join(",")}}` });
  for (const r of rows) {
    const list = map.get(r.customerId) ?? [];
    list.push(r);
    map.set(r.customerId, list);
  }
  return map;
}

/** Converts joined rows into masked wire rows (batch; one extra query for co-applicants). */
export async function toCustomerRows(db: Executor, rows: CustomerSelect[]): Promise<CustomerRow[]> {
  const cas = await coApplicantsFor(
    db,
    rows.map((r) => r.c.id),
  );
  return rows.map((r) => customerRow(r, cas.get(r.c.id) ?? []));
}

/** Masked customer row. */
export function customerRow(r: CustomerSelect, cas: DbCoApplicant[]): CustomerRow {
  const c = r.c;
  const bank = c.bank;
  return {
    id: c.id,
    company_id: c.companyId,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    created_by: c.createdBy,
    version: c.version,
    is_active: c.isActive,
    deactivated_at: c.deactivatedAt ? c.deactivatedAt.toISOString() : null,
    customer_code: c.customerCode,
    salutation: c.salutation,
    full_name: c.fullName,
    father_or_spouse_name: c.fatherOrSpouseName,
    dob: c.dob,
    gender: c.gender,
    phone: c.phone,
    alt_phone: c.altPhone,
    email: c.email,
    address_current: c.addressCurrent ?? null,
    address_permanent: c.addressPermanent ?? null,
    same_as_current: c.sameAsCurrent,
    occupation: c.occupation,
    company_name: c.companyName,
    income_band: c.incomeBand,
    source: (c.source as CustomerRow["source"]) ?? null,
    relationship_manager_id: c.relationshipManagerId,
    relationship_manager_name: r.rmName ?? null,
    pan_masked: maskedPan(c.panEnc),
    aadhaar_masked: maskedAadhaar(c.aadhaarEnc),
    bank: bank
      ? {
          bank_name: bank.bank_name,
          ifsc: bank.ifsc,
          holder_name: bank.holder_name,
          bank_account_masked: maskedAccount(bank) ?? "",
        }
      : null,
    bank_account_masked: maskedAccount(bank),
    nominee: c.nominee
      ? {
          name: c.nominee.name,
          relation: c.nominee.relation,
          phone: c.nominee.phone ?? null,
          dob: c.nominee.dob ?? null,
        }
      : null,
    co_applicants: cas.map(coApplicantRow),
    kyc_status: c.kycStatus,
    kyc_verified_by: c.kycVerifiedBy,
    kyc_verified_by_name: r.kycVerifierName ?? null,
    kyc_verified_at: c.kycVerifiedAt ? c.kycVerifiedAt.toISOString() : null,
    kyc_remarks: c.kycRemarks,
    kyc_submitted_by: c.kycSubmittedBy ?? null,
    kyc_submitted_by_name: r.kycSubmitterName ?? null,
    kyc_submitted_at: c.kycSubmittedAt ? c.kycSubmittedAt.toISOString() : null,
    notes: c.notes,
    tags: c.tags ?? [],
    active_booking_count: Number(r.activeBookings ?? 0),
    portal_enabled: r.portalEnabled === true,
    erased_at: c.erasedAt ? c.erasedAt.toISOString() : null,
  };
}

/** Revealed view: the masked row plus the real identifiers (caller has checked customer.kyc_view and written the audit row). */
export function revealedRow(row: CustomerRow, c: DbCustomer, cas: DbCoApplicant[]): CustomerRevealed {
  return {
    ...row,
    pan: decryptField(c.panEnc),
    aadhaar: decryptField(c.aadhaarEnc),
    bank_account_number: c.bank ? decryptField(c.bank.account_enc) : null,
    co_applicants_revealed: cas.map((ca) => ({
      ...coApplicantRow(ca),
      pan: decryptField(ca.panEnc),
      aadhaar: decryptField(ca.aadhaarEnc),
    })),
    revealed_at: new Date().toISOString(),
  };
}

/** The caller whose project scope limits which customers exist for them (lib/scope.ts customerScopeCondition). */
export type CustomerScope = Pick<StaffContext, "id" | "allProjects" | "projectIds">;

/**
 * Loads the joined selection for one customer of the company; 404 when missing — and, with `scope`, when the customer lies outside the
 * caller's project scope (never 403: other projects' customers stay undiscoverable).
 */
export async function loadCustomerSelect(
  db: Executor,
  companyId: string,
  id: string,
  forUpdate = false,
  scope?: CustomerScope,
): Promise<CustomerSelect> {
  const q = db
    .select(CUSTOMER_SELECT)
    .from(customers)
    .leftJoin(users, eq(users.id, customers.relationshipManagerId))
    .where(
      and(
        eq(customers.id, id),
        eq(customers.companyId, companyId),
        scope ? customerScopeCondition(scope, sql`${id}::uuid`) : undefined,
      ),
    )
    .limit(1);
  const rows = (forUpdate ? await q.for("update", { of: customers }) : await q) as CustomerSelect[];
  const row = rows[0];
  if (!row) throw ApiError.notFound("Customer");
  return row;
}

/** Masked customer row by id; 404 when missing (or outside `scope`). */
export async function getCustomerRow(
  db: Executor,
  companyId: string,
  id: string,
  scope?: CustomerScope,
): Promise<CustomerRow> {
  const sel = await loadCustomerSelect(db, companyId, id, false, scope);
  const cas = await coApplicantsFor(db, [id]);
  return customerRow(sel, cas.get(id) ?? []);
}

// ---------------------------------------------------------------------------
// Duplicate detection (phone, PAN hash)
// ---------------------------------------------------------------------------

/**
 * Serialises customer writes per company + phone and per company + PAN hash with transaction-scoped advisory locks
 * (always phone first, then PAN, so concurrent writers never deadlock). The schema only indexes these columns, so without
 * the lock two simultaneous creates of one phone would both pass the duplicate check and both insert.
 */
export async function lockCustomerKeys(
  tx: Executor,
  companyId: string,
  phone: string | null,
  panHash: string | null,
): Promise<void> {
  if (phone) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer:${companyId}:phone:${phone}`}))`);
  if (panHash) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer:${companyId}:pan:${panHash}`}))`);
}

/** The keyed hashes a PAN may be stored under (every HASH_KEYS ring key, active first); empty for no PAN. */
export function panLookupHashes(pan: string | null | undefined): string[] {
  if (!pan) return [];
  return keyedHashes(normalizePAN(pan));
}

/**
 * 409 DUPLICATE_CUSTOMER (details.existing {id, customer_code, matched_on}) when another live customer carries the phone or PAN.
 * `panHash` is the active-key hash being written; `panHashes` (optional) adds the hashes under older ring keys, so a duplicate stored
 * before a HASH_KEYS rotation is still found.
 */
export async function assertNoDuplicate(
  tx: Executor,
  companyId: string,
  phone: string | null,
  panHash: string | null,
  excludeId: string | null,
  panHashes: readonly string[] = [],
): Promise<void> {
  const conds: SQL[] = [];
  if (phone) conds.push(eq(customers.phone, phone));
  const hashes = [...new Set([...(panHash ? [panHash] : []), ...(panHash ? panHashes : [])])];
  if (hashes.length > 0) conds.push(inArray(customers.panHash, hashes));
  if (conds.length === 0) return;
  const rows = await tx
    .select({
      id: customers.id,
      code: customers.customerCode,
      phone: customers.phone,
      panHash: customers.panHash,
      name: customers.fullName,
    })
    .from(customers)
    .where(
      and(
        eq(customers.companyId, companyId),
        isNull(customers.erasedAt),
        or(...conds),
        excludeId ? ne(customers.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  const hit = rows[0];
  if (!hit) return;
  const matchedOn = phone && hit.phone === phone ? "PHONE" : "PAN";
  throw ApiError.conflict(
    "DUPLICATE_CUSTOMER",
    matchedOn === "PHONE"
      ? `A customer with phone ${phone} already exists (${hit.code})`
      : `A customer with this PAN already exists (${hit.code})`,
    {
      existing: { id: hit.id, customer_code: hit.code, full_name: hit.name, matched_on: matchedOn },
    },
  );
}

/** Partial unique indexes (migration 0002) mirroring assertNoDuplicate: one live customer per (company, phone) and per (company, PAN hash). */
export const CUSTOMER_UNIQUE_CONSTRAINTS = [
  "customers_company_phone_live_uq",
  "customers_company_pan_hash_live_uq",
] as const;

function pgConstraint(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const x = e as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (x.code === "23505") return x.constraint_name ?? x.constraint ?? "";
    e = x.cause;
  }
  return null;
}

/**
 * Runs a customer insert/update in a savepoint and turns a unique violation of the live phone/PAN indexes — a writer that slipped past
 * the advisory lock + assertNoDuplicate (another code path, a direct insert) — into the same 409 DUPLICATE_CUSTOMER with details.existing.
 */
export async function withCustomerUniqueGuard<T>(
  tx: Executor,
  companyId: string,
  phone: string | null,
  panHash: string | null,
  excludeId: string | null,
  write: (sp: Executor) => Promise<T>,
): Promise<T> {
  try {
    return await (tx as Executor & { transaction: <R>(fn: (sp: Executor) => Promise<R>) => Promise<R> }).transaction(
      write,
    );
  } catch (err) {
    const constraint = pgConstraint(err);
    if (constraint === null || !(CUSTOMER_UNIQUE_CONSTRAINTS as readonly string[]).includes(constraint)) throw err;
    // The savepoint rolled back; the conflicting row is committed, so the regular check now finds and names it.
    const onPhone = constraint === "customers_company_phone_live_uq";
    await assertNoDuplicate(tx, companyId, onPhone ? phone : null, onPhone ? null : panHash, excludeId);
    throw ApiError.conflict(
      "DUPLICATE_CUSTOMER",
      onPhone ? `A customer with phone ${phone} already exists` : "A customer with this PAN already exists",
      { existing: null, constraint },
    );
  }
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

/** Column values derived from the create/update body (encrypts identifiers, canonicalises phones). */
export function customerColumns(body: Partial<CustomerCreate>): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (body.salutation !== undefined) v["salutation"] = body.salutation;
  if (body.full_name !== undefined) v["fullName"] = body.full_name;
  if (body.father_or_spouse_name !== undefined) v["fatherOrSpouseName"] = body.father_or_spouse_name;
  if (body.dob !== undefined) v["dob"] = body.dob;
  if (body.gender !== undefined) v["gender"] = body.gender;
  if (body.phone !== undefined) v["phone"] = canonicalPhone(body.phone);
  if (body.alt_phone !== undefined) v["altPhone"] = body.alt_phone ? canonicalPhone(body.alt_phone, "alt_phone") : null;
  if (body.email !== undefined) v["email"] = body.email;
  if (body.address_current !== undefined) v["addressCurrent"] = body.address_current;
  if (body.address_permanent !== undefined) v["addressPermanent"] = body.address_permanent;
  if (body.same_as_current !== undefined) v["sameAsCurrent"] = body.same_as_current;
  if (body.occupation !== undefined) v["occupation"] = body.occupation;
  if (body.company_name !== undefined) v["companyName"] = body.company_name;
  if (body.income_band !== undefined) v["incomeBand"] = body.income_band;
  if (body.source !== undefined) v["source"] = body.source;
  if (body.relationship_manager_id !== undefined) v["relationshipManagerId"] = body.relationship_manager_id;
  if (body.pan !== undefined) Object.assign(v, panColumns(body.pan));
  if (body.aadhaar !== undefined) Object.assign(v, aadhaarColumns(body.aadhaar));
  if (body.bank !== undefined) v["bank"] = bankColumn(body.bank);
  if (body.nominee !== undefined) v["nominee"] = body.nominee;
  if (body.notes !== undefined) v["notes"] = body.notes;
  if (body.tags !== undefined) v["tags"] = [...new Set(body.tags)];
  // The permanent address mirrors the current one when flagged.
  if (v["sameAsCurrent"] === true && v["addressCurrent"] !== undefined) v["addressPermanent"] = v["addressCurrent"];
  return v;
}

/** Relationship manager must be an active staff user of the company (400 otherwise). */
async function assertRm(tx: Executor, companyId: string, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const [u] = await tx
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .limit(1);
  if (!u) throw validationError("relationship_manager_id", "User does not exist");
  if (!u.isActive) throw validationError("relationship_manager_id", "User is inactive");
}

/** Co-applicant column values (encrypts PAN/Aadhaar; canonical phone). */
export function coApplicantColumns(input: Partial<CoApplicantInput>): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (input.full_name !== undefined) v["fullName"] = input.full_name;
  if (input.relation !== undefined) v["relation"] = input.relation;
  if (input.phone !== undefined) v["phone"] = input.phone ? canonicalPhone(input.phone) : null;
  if (input.email !== undefined) v["email"] = input.email;
  if (input.pan !== undefined) Object.assign(v, panColumns(input.pan, "co_applicants.pan"));
  if (input.aadhaar !== undefined) {
    const a = aadhaarColumns(input.aadhaar, "co_applicants.aadhaar");
    v["aadhaarEnc"] = a.aadhaarEnc;
    v["aadhaarLast4"] = a.aadhaarLast4; // co_applicants carries no aadhaar_hash column
  }
  return v;
}

/** Replaces a customer's co-applicant set: rows with a known id are updated, others inserted, missing ones deleted. */
export async function replaceCoApplicants(
  tx: Executor,
  companyId: string,
  customerId: string,
  inputs: CoApplicantInput[],
): Promise<void> {
  const existing = await tx
    .select({ id: coApplicants.id })
    .from(coApplicants)
    .where(eq(coApplicants.customerId, customerId));
  const existingIds = new Set(existing.map((e) => e.id));
  const keep = new Set<string>();
  for (const [i, input] of inputs.entries()) {
    const cols = { ...coApplicantColumns(input), sortOrder: i };
    if (input.id && existingIds.has(input.id)) {
      keep.add(input.id);
      await tx
        .update(coApplicants)
        .set({ ...cols, version: sql`${coApplicants.version} + 1` })
        .where(eq(coApplicants.id, input.id));
    } else {
      const [row] = await tx
        .insert(coApplicants)
        .values({ companyId, customerId, fullName: input.full_name, relation: input.relation, ...cols })
        .returning({ id: coApplicants.id });
      if (row) keep.add(row.id);
    }
  }
  const stale = [...existingIds].filter((id) => !keep.has(id));
  if (stale.length > 0) await tx.delete(coApplicants).where(inArray(coApplicants.id, stale));
}

/** Who creates the customer (staff request or the system, e.g. a lead conversion by a job). */
export interface CustomerWriteContext {
  /** The writer; with `allProjects`/`projectIds` (a staff request) updates are limited to customers in the writer's project scope. */
  user: Pick<StaffContext, "id" | "companyId"> & Partial<Pick<StaffContext, "allProjects" | "projectIds">>;
  redis: Redis;
  meta: WriteMeta;
}

/**
 * Creates a customer inside `tx`: canonical phone, PAN upper-cased, Aadhaar Verhoeff-checked, identifiers encrypted with keyed hashes,
 * duplicate phone/PAN → 409 DUPLICATE_CUSTOMER, code from numbering scope "customer", co-applicants, audit row. Returns the masked row.
 */
export async function createCustomer(
  tx: Executor,
  ctx: CustomerWriteContext,
  body: CustomerCreate,
): Promise<CustomerRow> {
  const cols = customerColumns(body);
  await assertRm(tx, ctx.user.companyId, body.relationship_manager_id);
  await lockCustomerKeys(tx, ctx.user.companyId, cols["phone"] as string, (cols["panHash"] as string | null) ?? null);
  await assertNoDuplicate(
    tx,
    ctx.user.companyId,
    cols["phone"] as string,
    (cols["panHash"] as string | null) ?? null,
    null,
    panLookupHashes(body.pan),
  );
  const company = await loadCompany(tx, ctx.redis, ctx.user.companyId);
  const code = await nextNumber(tx, company, "customer", todayIST());
  const [created] = await withCustomerUniqueGuard(
    tx,
    ctx.user.companyId,
    cols["phone"] as string,
    (cols["panHash"] as string | null) ?? null,
    null,
    (sp) =>
      sp
        .insert(customers)
        .values({
          ...(cols as object),
          companyId: ctx.user.companyId,
          customerCode: code,
          fullName: body.full_name,
          phone: cols["phone"] as string,
          createdBy: ctx.user.id,
        } as typeof customers.$inferInsert)
        .returning(),
  );
  if (!created) throw new Error("customer insert returned no row");
  if (body.co_applicants.length > 0) await replaceCoApplicants(tx, ctx.user.companyId, created.id, body.co_applicants);
  const view = await getCustomerRow(tx, ctx.user.companyId, created.id);
  await writeAudit(tx, {
    companyId: ctx.user.companyId,
    ...ctx.meta,
    action: "customer.create",
    entityType: "customer",
    entityId: created.id,
    after: view as unknown as Record<string, unknown>,
  });
  return view;
}

/** Updates a customer with optimistic concurrency; re-checks duplicates when phone/PAN change; replaces co-applicants when given. */
export async function updateCustomer(
  tx: Executor,
  ctx: CustomerWriteContext,
  id: string,
  version: number,
  body: CustomerUpdate,
): Promise<CustomerRow> {
  const sel = await loadCustomerSelect(tx, ctx.user.companyId, id, true, scopeOf(ctx.user));
  if (sel.c.erasedAt)
    throw ApiError.rule("This customer record was erased and can no longer be edited", "CUSTOMER_ERASED");
  const before = customerRow(sel, (await coApplicantsFor(tx, [id])).get(id) ?? []);
  const { version: _v, co_applicants, ...patch } = body;
  const cols = customerColumns(patch as Partial<CustomerCreate>);
  if (patch.same_as_current === true && cols["addressCurrent"] === undefined)
    cols["addressPermanent"] = sel.c.addressCurrent;
  if (patch.relationship_manager_id !== undefined)
    await assertRm(tx, ctx.user.companyId, patch.relationship_manager_id);
  const phone = (cols["phone"] as string | undefined) ?? null;
  const panHash = patch.pan !== undefined ? ((cols["panHash"] as string | null) ?? null) : null;
  // A submitted or verified KYC vouches for specific identifiers: changing PAN or Aadhaar sends the file back to PENDING, so the new values
  // go through submission and an independent verification again (maker-checker) instead of inheriting the old VERIFIED badge.
  // (compared under every hash key: re-entering the same PAN after a HASH_KEYS rotation is not a change)
  const sameHash = (plain: string | null | undefined, stored: string | null, canon: (v: string) => string) =>
    plain ? stored !== null && keyedHashes(canon(plain)).includes(stored) : stored === null;
  const identifiersChanged =
    (patch.pan !== undefined && !sameHash(patch.pan, sel.c.panHash, normalizePAN)) ||
    (patch.aadhaar !== undefined && !sameHash(patch.aadhaar, sel.c.aadhaarHash, normalizeAadhaar));
  const kycReset = identifiersChanged && (sel.c.kycStatus === "SUBMITTED" || sel.c.kycStatus === "VERIFIED");
  if (kycReset)
    Object.assign(cols, {
      kycStatus: "PENDING",
      kycSubmittedBy: null,
      kycSubmittedAt: null,
      kycVerifiedBy: null,
      kycVerifiedAt: null,
    });
  await lockCustomerKeys(tx, ctx.user.companyId, phone, panHash);
  await assertNoDuplicate(tx, ctx.user.companyId, phone, panHash, id, patch.pan ? panLookupHashes(patch.pan) : []);
  await withCustomerUniqueGuard(tx, ctx.user.companyId, phone, panHash, id, (sp) =>
    applyUpdate(sp, customers, id, version, cols, "customer"),
  );
  if (phone && phone !== sel.c.phone) {
    // The portal login is the customer's phone: keep it in step (another portal login on that phone → 409 DUPLICATE).
    try {
      await tx.update(portalUsers).set({ phone }).where(eq(portalUsers.customerId, id));
    } catch (e) {
      translatePgError(e, `A portal login with phone ${phone}`);
    }
  }
  if (co_applicants !== undefined) await replaceCoApplicants(tx, ctx.user.companyId, id, co_applicants);
  const after = await getCustomerRow(tx, ctx.user.companyId, id);
  await writeAudit(tx, {
    companyId: ctx.user.companyId,
    ...ctx.meta,
    action: "customer.update",
    entityType: "customer",
    entityId: id,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
  });
  if (kycReset) {
    await writeAudit(tx, {
      companyId: ctx.user.companyId,
      ...ctx.meta,
      action: "customer.kyc_reset",
      entityType: "customer",
      entityId: id,
      before: { kyc_status: sel.c.kycStatus, kyc_verified_by: sel.c.kycVerifiedBy },
      after: { kyc_status: "PENDING", reason: "IDENTIFIERS_CHANGED" },
    });
  }
  return after;
}

/** The project scope of a writer, when the context carries one. */
function scopeOf(user: CustomerWriteContext["user"]): CustomerScope | undefined {
  if (user.allProjects === undefined || user.projectIds === undefined) return undefined;
  return { id: user.id, allProjects: user.allProjects, projectIds: user.projectIds };
}

/** Number of ACTIVE bookings where the customer is primary or co-applicant. */
export async function activeBookingCount(db: Executor, customerId: string): Promise<number> {
  const rows = await db.execute<{ n: number | string }>(sql`
    select (select count(*)::int from ${bookings} b where b.customer_id = ${customerId} and b.status = 'ACTIVE')
      + (select count(*)::int from ${bookingCoApplicants} bc join ${bookings} b on b.id = bc.booking_id
         where bc.customer_id = ${customerId} and b.status = 'ACTIVE' and b.customer_id <> ${customerId}) as n`);
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Portal access state
// ---------------------------------------------------------------------------

/** Portal login link: company site settings `portal_url`, else PORTAL_ORIGIN. */
export async function portalLoginUrl(db: Executor, companyId: string): Promise<string | null> {
  const [s] = await db
    .select({ url: siteSettings.portalUrl })
    .from(siteSettings)
    .where(eq(siteSettings.companyId, companyId))
    .limit(1);
  const url = s?.url?.trim() || config.PORTAL_ORIGIN;
  return /^https?:\/\//.test(url) ? url : null;
}

/** Live (unrevoked, unreplaced, unexpired) refresh tokens of a portal user. */
async function liveSessionCount(db: Executor, portalUserId: string): Promise<number> {
  const rows = await db.execute<{ n: number | string }>(sql`
    select count(*)::int as n from ${refreshTokens} r
    where r.subject_type = 'CUSTOMER' and r.subject_id = ${portalUserId} and r.revoked_at is null and r.replaced_by_id is null and r.expires_at > now()`);
  return Number(rows[0]?.n ?? 0);
}

/** Portal access card for a customer (temp password only right after enable/reset). */
export async function portalAccessView(
  db: Executor,
  companyId: string,
  customer: Pick<DbCustomer, "id" | "phone">,
  tempPassword: string | null = null,
): Promise<PortalAccessResponse> {
  const [pu] = await db.select().from(portalUsers).where(eq(portalUsers.customerId, customer.id)).limit(1);
  const loginUrl = await portalLoginUrl(db, companyId);
  if (!pu) {
    return {
      customer_id: customer.id,
      phone: customer.phone,
      is_enabled: false,
      must_change_password: false,
      temp_password: null,
      login_url: loginUrl,
      last_login_at: null,
      enabled_at: null,
      disabled_at: null,
      locked_until: null,
      active_sessions: 0,
    };
  }
  return {
    customer_id: customer.id,
    phone: pu.phone,
    is_enabled: pu.isEnabled,
    must_change_password: pu.mustChangePassword,
    temp_password: tempPassword,
    login_url: loginUrl,
    last_login_at: pu.lastLoginAt ? pu.lastLoginAt.toISOString() : null,
    enabled_at: pu.enabledAt ? pu.enabledAt.toISOString() : null,
    disabled_at: pu.disabledAt ? pu.disabledAt.toISOString() : null,
    locked_until: pu.lockedUntil && pu.lockedUntil.getTime() > Date.now() ? pu.lockedUntil.toISOString() : null,
    active_sessions: pu.isEnabled ? await liveSessionCount(db, pu.id) : 0,
  };
}

/** Latest co-applicant rows of a customer ordered for display. */
export async function listCoApplicants(db: Executor, customerId: string): Promise<DbCoApplicant[]> {
  return db
    .select()
    .from(coApplicants)
    .where(eq(coApplicants.customerId, customerId))
    .orderBy(coApplicants.sortOrder, desc(coApplicants.createdAt));
}
