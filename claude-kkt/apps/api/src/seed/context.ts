/**
 * Shared state and helpers of the demo seed (docs/SEED.md). Every step drives the REAL API in-process through `app.inject`
 * (Idempotency-Key on every create, If-Match where the API asks for it) so numbering, snapshots, ledgers, demands, notifications
 * and audit rows come from the same code paths the ERP uses. Direct SQL is used only where no endpoint can express something
 * historical; every such fallback is listed in run.ts (`SEED_FALLBACKS`).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import type { Sql } from "postgres";
import type { DB } from "@kkt/db";
import { addDays, dayOfWeek, financialYear, todayIST, type FinancialYear } from "@kkt/domain";

/** ₹1,00,000 in paise. */
export const LAKH = 10_000_000;
/** ₹1 crore in paise. */
export const CRORE = 100 * LAKH;

/** Navy / gold theme used for every generated placeholder image. */
export const NAVY = "#0B1F3A";
export const GOLD = "#C9A227";

/** Staff logins created by bootstrap (docs/SEED.md). */
export const STAFF = {
  admin: { email: "admin@sgb.in", password: "Admin@12345" },
  projects: { email: "projects@sgb.in", password: "Project@12345" },
  accounts: { email: "accounts@sgb.in", password: "Accounts@12345" },
  sales: { email: "sales@sgb.in", password: "Sales@12345" },
  marketing: { email: "marketing@sgb.in", password: "Marketing@12345" },
  employee: { email: "employee@sgb.in", password: "Employee@12345" },
} as const;
export type StaffKey = keyof typeof STAFF;

/** Portal password every seeded customer ends up with (already changed, no forced change). */
export const PORTAL_PASSWORD = "Welcome@123";

/** Thrown when the API answers with an unexpected status; carries the response for the report. */
export class SeedError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "SeedError";
  }
}

/** Options of one API call. */
export interface CallOptions {
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  /** Idempotency-Key is sent on every POST unless explicitly disabled. */
  idempotent?: boolean;
  /** Sends `If-Match: "<version>"`. */
  ifMatch?: number;
  /** Fake client IP (per-IP rate limits on public/login routes). */
  ip?: string;
  /** Accepted status codes (default 200/201/204). */
  expect?: number | readonly number[];
  /** Multipart upload (fields + one file); the JSON body is ignored. */
  multipart?: { fields: Record<string, string>; file: { name: string; data: Buffer; type?: string } };
}

export interface StaffUser { id: string; name: string; email: string; version: number; roleName: string }
export interface SeedFlat { id: string; flat_number: string; floor: number; position: number; price_paise: number; status: string; version: number; flat_type_code: string }
export interface SeedBlock { id: string; code: string; name: string; flats: Map<string, SeedFlat> }
export interface SeedProject { id: string; code: string; slug: string; name: string; blocks: Record<string, SeedBlock>; parking: Map<string, string>; brochureDocId: string | null }
export interface SeedCustomer { id: string; code: string; name: string; phone: string; email: string; version: number }
export interface SeedBooking { id: string; number: string; flat: string; customerPhone: string; version: number }
export interface SeedLead { id: string; number: string; phone: string; version: number; stage: string }

/** Everything the steps share. */
export class SeedContext {
  readonly sql: Sql;
  readonly db: DB;
  readonly today: string;
  readonly fy: FinancialYear;
  readonly runId = randomUUID().slice(0, 8);
  private counter = 0;
  private ipCounter = 0;
  readonly tokens: Partial<Record<StaffKey, string>> = {};
  readonly users = new Map<string, StaffUser>();
  readonly ids: Record<string, string> = {};
  readonly stages: Record<string, string> = {};
  stageOrder: string[] = [];
  readonly projects: Record<string, SeedProject> = {};
  readonly customers: Record<string, SeedCustomer> = {};
  readonly customerOrder: string[] = [];
  readonly bookings: Record<number, SeedBooking> = {};
  readonly leads: Record<string, SeedLead> = {};
  readonly serviceCategories: Record<string, string> = {};
  readonly counts: Record<string, number> = {};
  readonly log: (msg: string) => void;

  constructor(readonly app: FastifyInstance, readonly companyId: string, log?: (msg: string) => void) {
    this.sql = app.sql;
    this.db = app.db;
    this.today = todayIST();
    this.fy = financialYear(this.today, 4);
    this.log = log ?? ((msg) => app.log.info({ seed: true }, msg));
  }

  /** `n` days before today (business date, IST). */
  D(n: number): string {
    return addDays(this.today, -n);
  }

  /** `n` days after today. */
  future(n: number): string {
    return addDays(this.today, n);
  }

  /** The next `count` dates ≥ `fromDaysAhead` days ahead that fall on the given weekdays (0 = Sunday). */
  nextVisitDays(fromDaysAhead: number, count: number, weekdays: readonly number[] = [1, 2, 3, 4, 5, 6], skip: readonly string[] = []): string[] {
    const out: string[] = [];
    for (let i = fromDaysAhead; out.length < count && i < fromDaysAhead + 60; i++) {
      const d = this.future(i);
      if (weekdays.includes(dayOfWeek(d)) && !skip.includes(d)) out.push(d);
    }
    return out;
  }

  /** A fresh fake client IP (per-IP limits on public and login routes never trip). */
  freshIp(): string {
    this.ipCounter += 1;
    return `10.77.${(this.ipCounter >> 8) & 255}.${this.ipCounter & 255}`;
  }

  /** Deterministic-per-run idempotency key. */
  idemKey(): string {
    this.counter += 1;
    return `seed-${this.runId}-${this.counter}`;
  }

  token(key: StaffKey): string {
    const t = this.tokens[key];
    if (!t) throw new SeedError(`Not logged in as ${key}`);
    return t;
  }

  /** Project by code (SGH / GGV). */
  project(code: string): SeedProject {
    const p = this.projects[code];
    if (!p) throw new SeedError(`Project ${code} not seeded yet`);
    return p;
  }

  /** Block by project + block code. */
  block(project: string, code: string): SeedBlock {
    const b = this.project(project).blocks[code];
    if (!b) throw new SeedError(`Block ${project}/${code} not seeded yet`);
    return b;
  }

  /** Flat by project / block code / number. */
  flat(project: string, block: string, number: string): SeedFlat {
    const f = this.block(project, block).flats.get(number);
    if (!f) throw new SeedError(`Flat ${project}/${block}/${number} not found`);
    return f;
  }

  customer(phone: string): SeedCustomer {
    const c = this.customers[phone];
    if (!c) throw new SeedError(`Customer ${phone} not seeded yet`);
    return c;
  }

  staffUser(email: string): StaffUser {
    const u = this.users.get(email);
    if (!u) throw new SeedError(`Staff user ${email} not found`);
    return u;
  }

  /** One API call through app.inject; throws SeedError on an unexpected status. */
  async call<T = Record<string, unknown>>(method: InjectOptions["method"], url: string, opts: CallOptions = {}): Promise<T> {
    // The fake client IP is the socket address itself, so it holds whatever TRUST_PROXY says (no X-Forwarded-For needed).
    const ip = opts.ip ?? "10.77.0.1";
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
    if (method === "POST" && opts.idempotent !== false && !headers["idempotency-key"]) headers["idempotency-key"] = this.idemKey();
    if (opts.ifMatch !== undefined) headers["if-match"] = `"${opts.ifMatch}"`;
    let payload: string | Buffer | undefined;
    if (opts.multipart) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(opts.multipart.fields)) fd.append(k, v);
      fd.append("file", new Blob([new Uint8Array(opts.multipart.file.data)], { type: opts.multipart.file.type ?? "application/octet-stream" }), opts.multipart.file.name);
      const encoded = new Response(fd);
      payload = Buffer.from(await encoded.arrayBuffer());
      headers["content-type"] = encoded.headers.get("content-type")!;
    } else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    const res = await this.app.inject({ method, url, headers, remoteAddress: ip, ...(payload !== undefined ? { payload } : {}) });
    const expected = opts.expect === undefined ? [200, 201, 204] : Array.isArray(opts.expect) ? opts.expect : [opts.expect as number];
    const ct = String(res.headers["content-type"] ?? "");
    let body: unknown = res.body;
    if (ct.includes("application/json") && res.body) { try { body = JSON.parse(res.body); } catch { body = res.body; } }
    if (!expected.includes(res.statusCode)) {
      throw new SeedError(`${method} ${url} → ${res.statusCode}: ${res.body.slice(0, 600)}`, { status: res.statusCode, body });
    }
    return body as T;
  }

  /** GET helper. */
  get<T = Record<string, unknown>>(url: string, token: StaffKey = "admin"): Promise<T> {
    return this.call<T>("GET", url, { token: this.token(token) });
  }

  /** POST that must answer 201/200 (idempotent by default). */
  post<T = Record<string, unknown>>(url: string, body: unknown, token: StaffKey = "admin", extra: Omit<CallOptions, "body" | "token"> = {}): Promise<T> {
    return this.call<T>("POST", url, { token: this.token(token), body, ...extra });
  }

  /** PATCH with the version in the body (or If-Match). */
  patch<T = Record<string, unknown>>(url: string, body: unknown, token: StaffKey = "admin", extra: Omit<CallOptions, "body" | "token"> = {}): Promise<T> {
    return this.call<T>("PATCH", url, { token: this.token(token), body, ...extra });
  }

  /** Logs the six staff users in and caches their ids/versions. */
  async loginStaff(): Promise<void> {
    for (const key of Object.keys(STAFF) as StaffKey[]) {
      const creds = STAFF[key];
      const r = await this.call<{ access_token: string; user: { id: string; name: string; email: string; role_name: string } }>("POST", "/api/v1/auth/login", { body: { email: creds.email, password: creds.password }, ip: this.freshIp(), idempotent: false });
      this.tokens[key] = r.access_token;
    }
    const list = await this.get<{ items: { id: string; name: string; email: string; version: number; role_name: string }[] }>("/api/v1/users?page_size=100");
    for (const u of list.items) this.users.set(u.email, { id: u.id, name: u.name, email: u.email, version: u.version, roleName: u.role_name });
  }

  /** Current `version` of a resource (fresh GET). */
  async versionOf(url: string, token: StaffKey = "admin"): Promise<number> {
    const r = await this.get<{ version: number }>(url, token);
    return r.version;
  }

  /** Uploads a document through POST /documents (multipart) and returns its id. */
  async uploadDocument(fields: { entity_type: string; entity_id: string; title?: string; document_type_id?: string; shared_with_customer?: boolean; is_sensitive?: boolean }, file: { name: string; data: Buffer; type?: string }, token: StaffKey = "admin"): Promise<string> {
    const f: Record<string, string> = { entity_type: fields.entity_type, entity_id: fields.entity_id };
    if (fields.title) f["title"] = fields.title;
    if (fields.document_type_id) f["document_type_id"] = fields.document_type_id;
    if (fields.shared_with_customer !== undefined) f["shared_with_customer"] = String(fields.shared_with_customer);
    if (fields.is_sensitive !== undefined) f["is_sensitive"] = String(fields.is_sensitive);
    const r = await this.call<{ document: { id: string } }>("POST", "/api/v1/documents", { token: this.token(token), multipart: { fields: f, file } });
    return r.document.id;
  }

  /** Uploads website media through POST /cms/media and returns the document id. */
  async uploadMedia(title: string, file: { name: string; data: Buffer; type?: string }): Promise<string> {
    const r = await this.call<{ document: { id: string } }>("POST", "/api/v1/cms/media", { token: this.token("marketing"), multipart: { fields: { title }, file } });
    return r.document.id;
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

const imageCache = new Map<string, Promise<Buffer>>();

/**
 * A 1600×1000 navy placeholder PNG with a gold caption (project / stage / subject) rendered by sharp — the demo has no external
 * image dependencies. Identical captions share one encode per run.
 */
export function placeholderPng(caption: string, subtitle = "Shree Ganesh Builders · Patna", width = 1600, height = 1000): Promise<Buffer> {
  const key = `${width}x${height}:${caption}|${subtitle}`;
  let p = imageCache.get(key);
  if (!p) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="${NAVY}"/>
      <rect x="0" y="${height - 14}" width="${width}" height="14" fill="${GOLD}"/>
      <rect x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.42)}" width="${Math.round(width * 0.12)}" height="6" fill="${GOLD}"/>
      <text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.55)}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${Math.round(width / 20)}" font-weight="700" fill="${GOLD}">${escapeXml(caption)}</text>
      <text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.63)}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${Math.round(width / 48)}" fill="#F3EBD3">${escapeXml(subtitle)}</text>
    </svg>`;
    p = sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();
    imageCache.set(key, p);
  }
  return p;
}

/** A small branded A4 PDF (pdfkit) with a title and a few lines of text. */
export function placeholderPdf(title: string, lines: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: title, Author: "Shree Ganesh Builders" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.rect(0, 0, doc.page.width, 110).fill(NAVY);
    doc.fillColor(GOLD).fontSize(22).text("Shree Ganesh Builders", 56, 36);
    doc.fillColor("#F3EBD3").fontSize(10).text("SGB House, Boring Road, Patna 800001 · info@sgb.in · +91 612 2200000", 56, 66);
    doc.moveDown(3);
    doc.fillColor(NAVY).fontSize(18).text(title, 56, 140);
    doc.moveDown();
    doc.fillColor("#222").fontSize(11);
    for (const line of lines) doc.text(line, { lineGap: 4 });
    doc.end();
  });
}

/** Rounds paise down to whole lakhs. */
export function wholeLakhs(paise: number): number {
  return Math.floor(paise / LAKH) * LAKH;
}
