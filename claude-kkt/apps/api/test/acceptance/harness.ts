/**
 * Acceptance-suite harness (docs/SPEC.md §18, docs/ACCEPTANCE.md).
 *
 * Two ways to run every scenario file, selected by the environment:
 *   (a) in-process (default): boots `buildApp` on its own database (ACCEPTANCE_DATABASE_URL, default kkt_acceptance) and Redis
 *       (ACCEPTANCE_REDIS_URL, default redis://localhost:6379/12), truncates everything, runs the bootstrap + the demo seed
 *       (docs/SEED.md) once per file and exercises the scenario through `app.inject`;
 *   (b) remote: with ACCEPTANCE_BASE_URL set (e.g. http://localhost:4000) the same calls go over HTTP with `fetch`; the server is
 *       reseeded through POST /admin/reseed at the start of every file unless ACCEPTANCE_RESEED=0, so files stay independent.
 *       Steps that need direct SQL (manufacturing integrity anomalies) run only when ACCEPTANCE_DATABASE_URL points at the
 *       server's database; otherwise they are skipped and reported as such.
 *
 * Every scenario file is self-contained: it boots the harness in `beforeAll`, creates whatever extra records it needs through
 * the API and never depends on another file having run.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import postgres, { type Sql } from "postgres";
import { todayIST } from "@kkt/domain";

/** ₹1,00,000 in paise. */
export const L = 10_000_000;
/** ₹1 crore in paise. */
export const CR = 100 * L;
/** A well-formed uuid that never exists. */
export const NO_ID = "00000000-0000-4000-8000-000000000000";

/** Seeded staff logins (docs/SEED.md). */
export const CREDS = {
  admin: { email: "admin@sgb.in", password: "Admin@12345" },
  projects: { email: "projects@sgb.in", password: "Project@12345" },
  accounts: { email: "accounts@sgb.in", password: "Accounts@12345" },
  sales: { email: "sales@sgb.in", password: "Sales@12345" },
  marketing: { email: "marketing@sgb.in", password: "Marketing@12345" },
  employee: { email: "employee@sgb.in", password: "Employee@12345" },
} as const;
export type RoleKey = keyof typeof CREDS;
/** Every seeded customer logs into the portal with this password (docs/SEED.md). */
export const PORTAL_PASSWORD = "Welcome@123";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Normalised response of one call. */
export interface Res<T = unknown> {
  status: number;
  body: T;
  text: string;
  headers: Record<string, string>;
  raw: Buffer;
}

/** Options of one call. */
export interface ReqOpts {
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  /** Fake client IP (x-forwarded-for); a fresh one per call unless given, so per-IP limits never trip by accident. */
  ip?: string;
}

/** Error envelope (docs/API-CONVENTIONS.md). */
export interface ErrorBody { error: { code: string; message: string; details?: Record<string, unknown>; request_id?: string } }

/** Staff login result (API-CONVENTIONS Appendix A). */
export interface Login { access_token: string; refresh_token: string; user: { id: string; name: string; email: string; role_name: string; permissions: string[]; all_projects: boolean; project_ids: string[] }; must_change_password: boolean }

/** What every scenario file gets. */
export interface Harness {
  mode: "in-process" | "remote";
  /** Business date (IST). */
  today: string;
  request<T = unknown>(method: Method, url: string, opts?: ReqOpts): Promise<Res<T>>;
  login(email: string, password: string): Promise<Login>;
  loginAs(role: RoleKey): Promise<Login>;
  /** Portal login (phone + Welcome@123). */
  portalLogin(phone: string, password?: string): Promise<{ access_token: string; user: { customer_id?: string; must_change_password: boolean } }>;
  /** Direct SQL when available (always in-process; remote only with ACCEPTANCE_DATABASE_URL). */
  sql: Sql | null;
  /** The in-process app (null in remote mode). */
  app: FastifyInstance | null;
  close(): Promise<void>;
}

let ipCounter = 0;
/** A fresh fake client IP. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

let keyCounter = 0;
/** A unique Idempotency-Key. */
export function key(prefix = "acc"): string {
  keyCounter += 1;
  return `${prefix}-${Date.now()}-${process.pid}-${keyCounter}`;
}

function parseBody(contentType: string, raw: Buffer): { body: unknown; text: string } {
  const text = raw.toString("utf8");
  if (contentType.includes("application/json") && text) {
    try { return { body: JSON.parse(text), text }; } catch { return { body: text, text }; }
  }
  return { body: text, text };
}

function flattenHeaders(h: Record<string, string | string[] | number | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  return out;
}

async function bootInProcess(): Promise<Harness> {
  process.env["TEST_DATABASE_URL"] = process.env["ACCEPTANCE_DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/kkt_acceptance";
  process.env["TEST_REDIS_URL"] = process.env["ACCEPTANCE_REDIS_URL"] ?? "redis://localhost:6379/12";
  process.env["STORAGE_LOCAL_DIR"] ??= mkdtempSync(join(tmpdir(), "kkt-acceptance-"));
  delete process.env["KKT_MODULES"];
  const { buildTestApp } = await import("../integration/helpers.js");
  const t = await buildTestApp();
  const { seedDemo } = await import("../../src/seed/run.js");
  const seeded = await seedDemo(t.app, { log: () => undefined });
  if (seeded.skipped || !seeded.integrity?.ok) throw new Error(`demo seed failed: ${JSON.stringify({ skipped: seeded.skipped, integrity: seeded.integrity })}`);
  const app = t.app;

  async function request<T>(method: Method, url: string, o: ReqOpts = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { "x-forwarded-for": o.ip ?? freshIp(), ...(o.headers ?? {}) };
    if (o.token) headers["authorization"] = `Bearer ${o.token}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url, headers, ...(o.body !== undefined ? { payload: JSON.stringify(o.body) } : {}) });
    const raw = res.rawPayload;
    const { body, text } = parseBody(String(res.headers["content-type"] ?? ""), raw);
    return { status: res.statusCode, body: body as T, text, headers: flattenHeaders(res.headers as Record<string, string | string[] | number | undefined>), raw };
  }
  return finish({ mode: "in-process", request, sql: app.sql, app, close: async () => { await app.close(); } });
}

async function bootRemote(baseUrl: string): Promise<Harness> {
  const base = baseUrl.replace(/\/+$/, "");
  async function request<T>(method: Method, url: string, o: ReqOpts = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { "x-forwarded-for": o.ip ?? freshIp(), ...(o.headers ?? {}) };
    if (o.token) headers["authorization"] = `Bearer ${o.token}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(base + url, { method, headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}), redirect: "manual" });
    const raw = Buffer.from(await res.arrayBuffer());
    const { body, text } = parseBody(res.headers.get("content-type") ?? "", raw);
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
    return { status: res.status, body: body as T, text, headers: h, raw };
  }
  const dbUrl = process.env["ACCEPTANCE_DATABASE_URL"];
  const sql = dbUrl ? postgres(dbUrl, { max: 2, onnotice: () => undefined }) : null;
  const h = finish({ mode: "remote", request, sql, app: null, close: async () => { if (sql) await sql.end({ timeout: 5 }); } });
  if (process.env["ACCEPTANCE_RESEED"] !== "0") {
    const admin = await h.loginAs("admin");
    const r = await request<{ integrity?: { ok: boolean } } & ErrorBody>("POST", "/api/v1/admin/reseed", { token: admin.access_token, body: { confirm: "RESEED" }, headers: { "idempotency-key": key("reseed") } });
    if (r.status !== 200 || !r.body.integrity?.ok) throw new Error(`remote reseed failed (${r.status}): ${r.text.slice(0, 400)}`);
  }
  return h;
}

function finish(partial: Pick<Harness, "mode" | "request" | "sql" | "app" | "close">): Harness {
  const h: Harness = {
    ...partial,
    today: todayIST(),
    async login(email, password) {
      const r = await partial.request<Login>("POST", "/api/v1/auth/login", { body: { email, password } });
      if (r.status !== 200) throw new Error(`login ${email} failed (${r.status}): ${r.text}`);
      return r.body;
    },
    loginAs(role) { return h.login(CREDS[role].email, CREDS[role].password); },
    async portalLogin(phone, password = PORTAL_PASSWORD) {
      const r = await partial.request<{ access_token: string; user: { customer_id?: string; must_change_password: boolean } }>("POST", "/api/v1/portal/auth/login", { body: { phone, password } });
      if (r.status !== 200) throw new Error(`portal login ${phone} failed (${r.status}): ${r.text}`);
      return r.body;
    },
  };
  return h;
}

/** Boots the harness for one scenario file (seeded demo state either way). */
export async function bootAcceptance(): Promise<Harness> {
  const remote = process.env["ACCEPTANCE_BASE_URL"];
  return remote ? bootRemote(remote) : bootInProcess();
}

/** Boot timeout generous enough for a full seed (≈25 s locally). */
export const BOOT_TIMEOUT = 10 * 60_000;

// ---------------------------------------------------------------------------
// Shared lookups and actions (all through the API)
// ---------------------------------------------------------------------------

export type List<T> = { items: T[]; total: number; page?: number; page_size?: number; next_cursor?: string | null };
export type Bucket = { agreed_paise: number; order_raised_paise: number; paid_paise: number; due_paise: number; advance_paise: number; pending_paise: number };
export type Summary = { raised_percent: number; cash: Bucket; account: Bucket; total_due_paise: number; total_paid_paise: number; other_charges_demanded_paise: number; other_charges_paid_paise: number; other_charges_due_paise: number; pending_cheques_paise: number; next_installment: { seq: number } | null };
export type ScheduleRow = { seq: number; name?: string; status: string; demand_number: string | null; paid_paise: number; cash_paise: number; account_paise: number };
export type Booking = {
  id: string; version: number; status: string; booking_number: string; booking_date: string; flat_id: string; flat_number?: string; block_id?: string; project_id?: string; customer_id: string; customer_phone?: string;
  agreement_value_paise: number; cash_agreed_paise: number; account_agreed_paise: number; payment_plan_id: string; plan_snapshot: { name: string; code?: string };
  summary: Summary; schedule: ScheduleRow[]; other_charges: { id: string; name: string; code?: string; total_paise: number; demand_number: string | null; paid_paise: number; due_paise: number }[];
  agreement_revisions?: { reason: string }[]; completed_at: string | null;
};
export type Payment = { id: string; version: number; receipt_number: string; status: string; amount_paise: number; bucket: string | null; payment_date: string; receipt_cancelled: boolean; booking_id?: string };
export type PostPaymentResponse = { payment: Payment; ledger_seq: number | null; receipt_url: string; summary: { cash_due_paise: number; account_due_paise: number; total_due_paise: number; other_charges_due_paise: number } };
export type LedgerRow = { seq: number; event: string; entry_date: string; bucket: string | null; amount_paise: number; cash_paid_paise?: number; account_paid_paise?: number; cash_due_paise: number; account_due_paise: number; total_due_paise: number; ref_number: string | null };
export type Demand = { id: string; demand_number: string; installment_seq: number; installment_name: string; status: string; paid_paise: number; cash_demand_paise: number; account_demand_paise: number; total_demand_paise?: number; demand_date: string; due_date?: string; trigger_stage_id: string | null };
export type Flat = { id: string; version: number; flat_number: string; floor: number; position: number; status: string; flat_type_code: string; is_corner: boolean; facing: string | null; price_paise: number; rate_per_sqft_paise: number | null; super_builtup_sqft: number; carpet_sqft: number; builtup_sqft: number; rooms_snapshot: { label: string; sqft: number }[]; areas_snapshot: { area_type_code: string; sqft: number }[]; price_breakup: { label: string; amount_paise: number }[]; booking_id: string | null };
export type Block = { id: string; version: number; code: string; name: string; project_id: string; floors: number; has_flats?: boolean; unit_counts: { available: number; hold: number; blocked: number; booked: number; sold: number; total: number }; stage_sequence?: string[] };
export type Project = { id: string; version: number; code: string; name: string };
export type Construction = { block_id: string; version: number; construction_percent: number; current_stage_id: string | null; next_stage_id: string | null; stages: { id: string; stage_id: string; name: string; status: string; is_possession: boolean; completed_on: string | null; demands_raised: number; can_undo: boolean }[] };
export type Customer = { id: string; version: number; customer_code: string; full_name: string; phone: string; pan_masked: string | null; aadhaar_masked: string | null; bank_account_masked?: string | null; kyc_status: string };

/** `expect`-free status guard usable inside helpers (throws with the body). */
export function must<T>(r: Res<T>, status: number | number[], what: string): T {
  const ok = Array.isArray(status) ? status : [status];
  if (!ok.includes(r.status)) throw new Error(`${what} → ${r.status} (expected ${ok.join("/")}): ${r.text.slice(0, 600)}`);
  return r.body;
}

export async function projectByCode(h: Harness, token: string, code: string): Promise<Project> {
  const r = must(await h.request<List<Project>>("GET", `/api/v1/projects?page_size=50`, { token }), 200, "GET /projects");
  const p = r.items.find((x) => x.code === code);
  if (!p) throw new Error(`project ${code} not found in ${r.items.map((x) => x.code).join(",")}`);
  return p;
}

export async function blockByCode(h: Harness, token: string, projectId: string, code: string): Promise<Block> {
  const r = must(await h.request<List<Block>>("GET", `/api/v1/blocks?project_id=${projectId}&page_size=50`, { token }), 200, "GET /blocks");
  const b = r.items.find((x) => x.code === code);
  if (!b) throw new Error(`block ${code} not found`);
  return b;
}

export async function flatsOf(h: Harness, token: string, blockId: string): Promise<Map<string, Flat>> {
  const r = must(await h.request<List<Flat>>("GET", `/api/v1/flats?block_id=${blockId}&page_size=200&sort=flat_number`, { token }), 200, "GET /flats");
  return new Map(r.items.map((f) => [f.flat_number, f]));
}

export async function getFlat(h: Harness, token: string, id: string): Promise<Flat> {
  return must(await h.request<Flat>("GET", `/api/v1/flats/${id}`, { token }), 200, "GET /flats/:id");
}

export async function customerByPhone(h: Harness, token: string, phone: string): Promise<Customer> {
  const r = must(await h.request<List<Customer>>("GET", `/api/v1/customers?search=${phone}&page_size=10`, { token }), 200, "GET /customers");
  const c = r.items.find((x) => x.phone === phone);
  if (!c) throw new Error(`customer ${phone} not found`);
  return c;
}

/** Seeded booking by its 4-digit sequence (BK-<fy>/000n). */
export async function bookingBySeq(h: Harness, token: string, seq: number): Promise<Booking> {
  const r = must(await h.request<List<Booking>>("GET", `/api/v1/bookings?page_size=100`, { token }), 200, "GET /bookings");
  const row = r.items.find((b) => b.booking_number.endsWith(`/${String(seq).padStart(4, "0")}`));
  if (!row) throw new Error(`booking #${seq} not found`);
  return getBooking(h, token, row.id);
}

export async function getBooking(h: Harness, token: string, id: string): Promise<Booking> {
  return must(await h.request<Booking>("GET", `/api/v1/bookings/${id}`, { token }), 200, "GET /bookings/:id");
}

export async function ledgerOf(h: Harness, token: string, bookingId: string): Promise<LedgerRow[]> {
  return must(await h.request<List<LedgerRow>>("GET", `/api/v1/bookings/${bookingId}/ledger?page_size=200`, { token }), 200, "GET ledger").items;
}

export async function demandsOf(h: Harness, token: string, bookingId: string, includeVoid = true): Promise<Demand[]> {
  return must(await h.request<List<Demand>>("GET", `/api/v1/bookings/${bookingId}/demands?include_inactive=${includeVoid}&page_size=200&sort=posted_at`, { token }), 200, "GET demands").items;
}

/** Master lookups by code. */
export async function masterByCode<T extends { id: string; code: string }>(h: Harness, token: string, kind: string, code: string): Promise<T> {
  const r = must(await h.request<List<T>>("GET", `/api/v1/masters/${kind}?page_size=200`, { token }), 200, `GET /masters/${kind}`);
  const m = r.items.find((x) => x.code === code);
  if (!m) throw new Error(`${kind} ${code} not found`);
  return m;
}

export async function stagesByName(h: Harness, token: string): Promise<Map<string, string>> {
  const r = must(await h.request<List<{ id: string; name: string; sort_order: number }>>("GET", "/api/v1/masters/construction-stages?page_size=200&sort=sort_order", { token }), 200, "GET stages");
  return new Map(r.items.map((s) => [s.name, s.id]));
}

export async function defaultBankAccount(h: Harness, token: string): Promise<{ id: string }> {
  const r = must(await h.request<List<{ id: string; is_default: boolean }>>("GET", "/api/v1/masters/bank-accounts?page_size=50", { token }), 200, "GET bank accounts");
  const b = r.items.find((x) => x.is_default) ?? r.items[0];
  if (!b) throw new Error("no bank account");
  return b;
}

/** Payment modes by code (CASH, CHEQUE, NEFT_RTGS, UPI, DD, LOAN_DISBURSEMENT). */
export async function paymentModes(h: Harness, token: string): Promise<Record<string, string>> {
  const r = must(await h.request<List<{ id: string; code: string }>>("GET", "/api/v1/masters/payment-modes?page_size=50", { token }), 200, "GET modes");
  return Object.fromEntries(r.items.map((m) => [m.code, m.id]));
}

export interface PayInput { bucket?: "CASH" | "ACCOUNT"; otherChargeId?: string; amount: number; date?: string; mode: "CASH" | "CHEQUE" | "NEFT_RTGS" | "UPI" | "DD" | "LOAN_DISBURSEMENT"; instrument?: { number: string; date?: string; bank_name?: string }; remarks?: string }

/** Body of POST /payments. */
export function paymentBody(h: Harness, bookingId: string, modes: Record<string, string>, bankAccountId: string, p: PayInput): Record<string, unknown> {
  const body: Record<string, unknown> = { booking_id: bookingId, amount_paise: p.amount, payment_date: p.date ?? h.today, payment_mode_id: modes[p.mode] };
  if (p.otherChargeId) { body["against"] = "OTHER_CHARGE"; body["other_charge_id"] = p.otherChargeId; }
  else { body["against"] = "FLAT_VALUE"; body["bucket"] = p.bucket ?? "CASH"; }
  if (p.mode !== "CASH") {
    body["bank_account_id"] = bankAccountId;
    body["instrument"] = p.instrument ?? { number: `${p.mode === "UPI" ? "UPI" : "UTR"}${Date.now()}${++keyCounter}`, ...(p.mode === "CHEQUE" || p.mode === "DD" ? { date: p.date ?? h.today, bank_name: "State Bank of India" } : {}) };
  }
  if (p.remarks) body["remarks"] = p.remarks;
  return body;
}

/**
 * Lists the given flats at exactly ₹1 Cr (POST /flats/:id/price as a flat.write holder) so the scenarios' ₹1 Cr agreements are at list
 * price: POST /bookings rejects a deviation from the flat's list price without agreement.edit + price_deviation_reason (audit E9).
 */
export async function listAtCr(h: Harness, token: string, flatIds: readonly string[]): Promise<void> {
  for (const id of flatIds) {
    const f = await getFlat(h, token, id);
    if (f.price_paise === CR) continue;
    must(await h.request("POST", `/api/v1/flats/${id}/price`, { token, body: { version: f.version, price_paise: CR, reason: "Acceptance scenario list price" } }), 200, "POST /flats/:id/price");
  }
}

/** Booking body (SPEC §12 wizard payload): ₹1 Cr / 60 L cash / 40 L account unless overridden (list the flat at ₹1 Cr first: listAtCr). */
export function bookingBody(h: Harness, flatId: string, customerId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { flat_id: flatId, customer_id: customerId, booking_date: h.today, agreement_value_paise: CR, cash_agreed_paise: 60 * L, account_agreed_paise: 40 * L, plan_acceptance_mode: "IN_PERSON", plan_accepted_on: h.today, ...extra };
}

export async function construction(h: Harness, token: string, blockId: string): Promise<Construction> {
  return must(await h.request<Construction>("GET", `/api/v1/blocks/${blockId}/construction`, { token }), 200, "GET construction");
}

/** Marks a tower stage completed through the ERP endpoint (the dues engine runs inside). */
export async function completeStage(h: Harness, token: string, blockId: string, stageId: string, completedOn: string, intermediate: Record<string, string> = {}, notes?: string): Promise<{ completed_stage_ids: string[]; demands_raised: number; demand_numbers: string[]; buyers_notified: number; construction_percent: number; version: number }> {
  const c = await construction(h, token, blockId);
  return must(await h.request<{ completed_stage_ids: string[]; demands_raised: number; demand_numbers: string[]; buyers_notified: number; construction_percent: number; version: number }>("POST", `/api/v1/blocks/${blockId}/construction/status`, { token, body: { version: c.version, stage_id: stageId, completed_on: completedOn, intermediate_dates: intermediate, notes: notes ?? null, notify_buyers: true }, headers: { "idempotency-key": key("stage") } }), 200, "POST construction/status");
}

/** Creates a customer through the API (unique phone / PAN); returns the row. */
export async function createCustomer(h: Harness, token: string, name: string, phone: string, extra: Record<string, unknown> = {}): Promise<Customer> {
  const body = { full_name: name, phone, email: `${phone}@example.com`, address_current: { line1: "12 Boring Road", locality: "Sri Krishna Puri", city: "Patna", state: "Bihar", pincode: "800001" }, same_as_current: true, source: "WALK_IN", ...extra };
  return must(await h.request<Customer>("POST", "/api/v1/customers", { token, body, headers: { "idempotency-key": key("cust") } }), 201, "POST /customers");
}

/** Walks a JSON value and returns every key path matching the predicate. */
export function findKeys(value: unknown, pred: (k: string, v: unknown) => boolean, path = ""): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => hits.push(...findKeys(v, pred, `${path}[${i}]`)));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (pred(k, v)) hits.push(p);
      hits.push(...findKeys(v, pred, p));
    }
  }
  return hits;
}

/** Asserts a PDF download: 200, application/pdf, bytes start with %PDF. */
export async function fetchPdf(h: Harness, url: string, token: string | null): Promise<Buffer> {
  const r = await h.request("GET", url, { token });
  if (r.status !== 200) throw new Error(`${url} → ${r.status}: ${r.text.slice(0, 300)}`);
  if (!r.headers["content-type"]?.includes("application/pdf")) throw new Error(`${url}: content-type ${r.headers["content-type"]}`);
  if (r.raw.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error(`${url}: not a PDF (${r.raw.subarray(0, 8).toString("latin1")})`);
  return r.raw;
}

/** Path + query of an absolute URL (links the API hands out). */
export function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}
