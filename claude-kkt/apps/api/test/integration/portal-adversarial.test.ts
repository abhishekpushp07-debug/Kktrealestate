import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@kkt/domain";
import { insertImageDocument } from "./fixtures/construction.js";
import { createMoneyWorld, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, freshIp, type ErrorBody, type LoginResult, type TestContext } from "./helpers.js";

/**
 * Adversarial review of the portal module (SPEC §16 rules, §2, §18 scenario 10): IDOR through nested ids (a payment / demand / document of
 * ANOTHER booking of the SAME customer, and of another customer), customer-bound file links, sensitive documents behind a forced share
 * flag, hidden construction photos, attachment smuggling through the request thread, the home screen's query budget, portal login rate
 * limiting, strict query keys and co-applicant boundaries.
 *
 * World: customer A owns TWO bookings (A1 = SGH A-101 with co-applicant C, A2 = SGH A-102); customer B owns B1 = GGV G-101.
 */

const STORAGE_DIR = mkdtempSync(join(tmpdir(), "kkt-portal-adv-"));
process.env["STORAGE_LOCAL_DIR"] = STORAGE_DIR;
process.env["KKT_MODULES"] ??= "portal,inventory,money,construction,documents,service,reports";

const L = 10_000_000;
const CR = 100 * L;
const NO_ID = "00000000-0000-4000-8000-000000000000";
const PASSWORD = "Welcome@123";

type PdfLink = { download_url: string; expires_at: string; file_name: string };
type Switcher = { booking_id: string; role: string };
type Home = {
  bookings: Switcher[];
  booking: { project_image_url: string | null };
  notices_unread: number;
  notifications_unread: number;
  relationship_manager: unknown;
};
type Receipt = { payment_id: string };
type Demand = { demand_id: string };
type Doc = { document_id: string };
type Timeline = { stages: { name: string; photos: { thumb_url: string; medium_url: string }[] }[] };
type Request = { id: string; messages: { attachments: { id: string; thumb_url: string | null }[] }[] };
type Flat = { floor_plan_url: string | null };

let t: TestContext;
let admin: LoginResult;
let sales: LoginResult;
let accounts: LoginResult;
let w: MoneyWorld;
let today: string;
let A: string;
let B: string;
let C: string;
let tokenA: string;
let tokenB: string;
let tokenC: string;
let A1: string;
let A2: string;
let B1: string;
let payA1: string;
let payA2: string;
let payB1: string;
let demandA1: string;
let demandA2: string;
let docA1: string;
let docA2: string;
let docA1Sensitive: string;
let docA1Unshared: string;
let docB1: string;
let visiblePhotoDoc: string;
let hiddenPhotoDoc: string;
let snagCat: string;
let keyCounter = 0;
const key = () => `portal-adv-${Date.now()}-${++keyCounter}`;

async function phoneOf(customerId: string): Promise<string> {
  const [r] = await t.app.sql<{ phone: string }[]>`select phone from customers where id = ${customerId}`;
  return r!.phone;
}

async function enablePortal(customerId: string): Promise<string> {
  const { hashPassword } = await import("../../src/lib/password.js");
  const phone = await phoneOf(customerId);
  await t.app
    .sql`insert into portal_users (company_id, customer_id, phone, password_hash, must_change_password) values (${t.companyId}, ${customerId}, ${phone}, ${await hashPassword(PASSWORD)}, false)`;
  return phone;
}

async function portalLogin(phone: string): Promise<string> {
  const r = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", {
    body: { phone, password: PASSWORD },
  });
  if (r.status !== 200) throw new Error(`portal login failed (${r.status}): ${r.text}`);
  return r.body.access_token;
}

async function get<T>(url: string, token: string) {
  const r = await t.request<T & ErrorBody>("GET", url, { token });
  return { status: r.status, body: r.body, text: r.text };
}

async function ok<T>(url: string, token: string): Promise<T> {
  const r = await get<T>(url, token);
  expect(r.status, `${url} → ${r.text}`).toBe(200);
  return r.body;
}

async function post<T>(url: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await t.request<T & ErrorBody>("POST", url, {
    token,
    body,
    headers: { "idempotency-key": key(), ...headers },
  });
  return { status: r.status, body: r.body, text: r.text };
}

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

/** Fetches a file link, optionally with a bearer (the way an authenticated in-app fetch would). */
async function fetchFile(url: string, bearer?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": freshIp() };
  if (bearer !== undefined) headers["authorization"] = bearer;
  return t.app.inject({ method: "GET", url: pathOf(url), headers });
}

async function insertDoc(
  entityType: string,
  entityId: string,
  opts: { shared?: boolean; sensitive?: boolean; name?: string } = {},
): Promise<string> {
  const n = Math.floor(Math.random() * 1e9);
  const [row] = await t.app.sql<
    { id: string }[]
  >`insert into documents (company_id, entity_type, entity_id, title, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, uploaded_by, is_sensitive, shared_with_customer)
    values (${t.companyId}, ${entityType}, ${entityId}, ${opts.name ?? `Document ${n}`}, ${`doc-${n}.pdf`}, 'application/pdf', 2048, ${`sha-${n}`}, ${`t/${n}.pdf`}, 'STAFF', ${admin.user.id}, ${opts.sensitive ?? false}, ${opts.shared ?? false}) returning id`;
  return row!.id;
}

async function uploadAttachment(token: string, requestId: string, data: Buffer, name = "photo.jpg") {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(data)], { type: "image/jpeg" }), name);
  const encoded = new Response(fd);
  const payload = Buffer.from(await encoded.arrayBuffer());
  const res = await t.app.inject({
    method: "POST",
    url: `/api/v1/portal/requests/${requestId}/attachments`,
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      "x-forwarded-for": freshIp(),
      authorization: `Bearer ${token}`,
    },
    payload,
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as { document_id: string } & ErrorBody };
}

/** Counts the SQL statements Drizzle runs on the (shared, in tests) primary handle while `fn` runs. */
async function countQueries(fn: () => Promise<unknown>): Promise<number> {
  const session = (t.app.dbReplica as unknown as { session: { logger: { logQuery(q: string, p: unknown[]): void } } })
    .session;
  const previous = session.logger;
  let n = 0;
  session.logger = {
    logQuery: () => {
      n += 1;
    },
  };
  try {
    await fn();
  } finally {
    session.logger = previous;
  }
  return n;
}

async function createBooking(
  flatNumber: string,
  project: "sgh" | "ggv",
  customerId: string,
  coApplicants: string[] = [],
): Promise<string> {
  const flat = w[project].flats.get(flatNumber)!;
  const r = await post<{ id: string }>("/api/v1/bookings", sales.access_token, {
    flat_id: flat.id,
    customer_id: customerId,
    co_applicant_ids: coApplicants,
    booking_date: today,
    agreement_value_paise: CR,
    cash_agreed_paise: 60 * L,
    account_agreed_paise: 40 * L,
    plan_acceptance_mode: "IN_PERSON",
    plan_accepted_on: today,
  });
  expect(r.status, r.text).toBe(201);
  return r.body.id;
}

async function payCash(bookingId: string): Promise<string> {
  const r = await post<{ payment: { id: string } }>("/api/v1/payments", accounts.access_token, {
    booking_id: bookingId,
    against: "FLAT_VALUE",
    bucket: "CASH",
    amount_paise: 2 * L,
    payment_date: today,
    payment_mode_id: w.modes.CASH,
  });
  expect(r.status, r.text).toBe(201);
  return r.body.payment.id;
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  admin = await t.loginAs("admin");
  sales = await t.loginAs("sales");
  accounts = await t.loginAs("accounts");
  w = await createMoneyWorld(t, admin.access_token);
  [A, B, C] = w.customers as [string, string, string];
  tokenA = await portalLogin(await enablePortal(A));
  tokenB = await portalLogin(await enablePortal(B));
  tokenC = await portalLogin(await enablePortal(C));

  A1 = await createBooking("A-101", "sgh", A, [C]);
  A2 = await createBooking("A-102", "sgh", A);
  B1 = await createBooking("G-101", "ggv", B);
  payA1 = await payCash(A1);
  payA2 = await payCash(A2);
  payB1 = await payCash(B1);

  // Tower A reaches Excavation → one demand per SGH booking; one photo for buyers, one internal
  const c0 = await ok<{ version: number; stages: { id: string; stage_id: string }[] }>(
    `/api/v1/blocks/${w.sgh.towerId}/construction`,
    admin.access_token,
  );
  const st = await post(`/api/v1/blocks/${w.sgh.towerId}/construction/status`, admin.access_token, {
    version: c0.version,
    stage_id: w.stages.EXCAVATION,
    completed_on: today,
  });
  expect(st.status, st.text).toBe(200);
  const excavation = c0.stages.find((s) => s.stage_id === w.stages.EXCAVATION)!;
  visiblePhotoDoc = await insertImageDocument(t, "STAGE", excavation.id);
  hiddenPhotoDoc = await insertImageDocument(t, "STAGE", excavation.id);
  expect(
    (
      await post(`/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.EXCAVATION}/photos`, admin.access_token, {
        document_id: visiblePhotoDoc,
        caption: "for buyers",
        visible_to_buyers: true,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post(`/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.EXCAVATION}/photos`, admin.access_token, {
        document_id: hiddenPhotoDoc,
        caption: "internal",
        visible_to_buyers: false,
      })
    ).status,
  ).toBe(201);
  const [dA1] = await t.app.sql<
    { id: string }[]
  >`select id from demands where booking_id = ${A1} and installment_name = 'Excavation'`;
  const [dA2] = await t.app.sql<
    { id: string }[]
  >`select id from demands where booking_id = ${A2} and installment_name = 'Excavation'`;
  demandA1 = dA1!.id;
  demandA2 = dA2!.id;

  docA1 = await insertDoc("BOOKING", A1, { shared: true, name: "A1 agreement" });
  docA2 = await insertDoc("BOOKING", A2, { shared: true, name: "A2 agreement" });
  docA1Sensitive = await insertDoc("BOOKING", A1, { shared: true, sensitive: true, name: "A1 PAN card" });
  docA1Unshared = await insertDoc("BOOKING", A1, { shared: false, name: "A1 internal note" });
  docB1 = await insertDoc("BOOKING", B1, { shared: true, name: "B1 agreement" });

  const cat = await post<{ id: string }>("/api/v1/masters/service-categories", admin.access_token, {
    name: "Defect/Snag",
    sort_order: 1,
    default_priority: "HIGH",
  });
  expect(cat.status, cat.text).toBe(201);
  snagCat = cat.body.id;
});

afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------

describe("IDOR through nested ids", () => {
  it("a payment, demand or document of the customer's OTHER booking is 404 under this booking's path", async () => {
    // sanity: each id is reachable under its own booking
    expect((await get(`/api/v1/portal/bookings/${A1}/receipts/${payA1}/pdf`, tokenA)).status).toBe(200);
    expect((await get(`/api/v1/portal/bookings/${A2}/receipts/${payA2}/pdf`, tokenA)).status).toBe(200);
    expect((await get(`/api/v1/portal/bookings/${A1}/demands/${demandA1}/pdf`, tokenA)).status).toBe(200);
    expect((await get(`/api/v1/portal/bookings/${A2}/documents/${docA2}/download`, tokenA)).status).toBe(200);
    // crossed within the same customer
    for (const url of [
      `/api/v1/portal/bookings/${A1}/receipts/${payA2}/pdf`,
      `/api/v1/portal/bookings/${A2}/receipts/${payA1}/pdf`,
      `/api/v1/portal/bookings/${A1}/demands/${demandA2}/pdf`,
      `/api/v1/portal/bookings/${A2}/demands/${demandA1}/pdf`,
      `/api/v1/portal/bookings/${A1}/documents/${docA2}/download`,
      `/api/v1/portal/bookings/${A2}/documents/${docA1}/download`,
    ]) {
      const r = await get(url, tokenA);
      expect(r.status, url).toBe(404);
      expect(r.body.error.code, url).toBe("NOT_FOUND");
    }
    // crossed across customers
    for (const url of [
      `/api/v1/portal/bookings/${A1}/receipts/${payB1}/pdf`,
      `/api/v1/portal/bookings/${A1}/documents/${docB1}/download`,
      `/api/v1/portal/bookings/${B1}/receipts/${payB1}/pdf`,
    ]) {
      expect((await get(url, tokenA)).status, url).toBe(404);
    }
    // lists never mix bookings
    const r1 = await ok<{ items: Receipt[] }>(`/api/v1/portal/bookings/${A1}/receipts`, tokenA);
    expect(r1.items.map((r) => r.payment_id)).toEqual([payA1]);
    const d2 = await ok<{ items: Demand[] }>(`/api/v1/portal/bookings/${A2}/demands`, tokenA);
    expect(d2.items.some((d) => d.demand_id === demandA1)).toBe(false);
    const docs1 = await ok<{ items: Doc[] }>(`/api/v1/portal/bookings/${A1}/documents`, tokenA);
    expect(docs1.items.map((d) => d.document_id)).toEqual([docA1]);
  });

  it("the co-applicant sees only the booking they are on; the switcher never lists another customer's booking", async () => {
    const c = await ok<Switcher[]>("/api/v1/portal/bookings", tokenC);
    expect(c.map((b) => [b.booking_id, b.role])).toEqual([[A1, "CO_APPLICANT"]]);
    const a = await ok<Switcher[]>("/api/v1/portal/bookings", tokenA);
    expect(a.map((b) => b.booking_id).sort()).toEqual([A1, A2].sort());
    expect(a.every((b) => b.role === "PRIMARY")).toBe(true);
    const b = await ok<Switcher[]>("/api/v1/portal/bookings", tokenB);
    expect(b.map((x) => x.booking_id)).toEqual([B1]);
    // C is on A1, not on A2 or B1
    expect((await get(`/api/v1/portal/bookings/${A1}/receipts/${payA1}/pdf`, tokenC)).status).toBe(200);
    for (const suffix of [
      "home",
      "receipts",
      `receipts/${payA2}/pdf`,
      "statement.pdf",
      "documents",
      "construction",
      "bank-details",
    ]) {
      expect((await get(`/api/v1/portal/bookings/${A2}/${suffix}`, tokenC)).status, suffix).toBe(404);
    }
    expect((await get(`/api/v1/portal/bookings/${B1}/home`, tokenC)).status).toBe(404);
    // the home switcher of C carries only A1
    const home = await ok<Home>(`/api/v1/portal/bookings/${A1}/home`, tokenC);
    expect(home.bookings.map((x) => x.booking_id)).toEqual([A1]);
  });

  it("a co-applicant may raise a request on the shared booking but not on the primary's other booking", async () => {
    const okReq = await post<Request>("/api/v1/portal/requests", tokenC, {
      booking_id: A1,
      category_id: snagCat,
      subject: "Lift noise at night",
      description: "Grinding noise.",
    });
    expect(okReq.status, okReq.text).toBe(201);
    const bad = await post<Request>("/api/v1/portal/requests", tokenC, {
      booking_id: A2,
      category_id: snagCat,
      subject: "Not my booking",
      description: "x",
    });
    expect(bad.status).toBe(404);
    // and the primary cannot read the co-applicant's ticket (tickets belong to who raised them)
    expect((await get(`/api/v1/portal/requests/${okReq.body.id}`, tokenA)).status).toBe(404);
  });
});

describe("customer-bound file links", () => {
  async function tokenOf(link: string): Promise<string> {
    return link.split("/portal/files/")[1]!;
  }

  it("every link the portal hands out encodes the requesting customer and is refused for any other bearer", async () => {
    const { verifyPortalFileToken } = await import("../../src/modules/portal/index.js");
    const statement = await ok<PdfLink>(`/api/v1/portal/bookings/${A1}/statement.pdf`, tokenA);
    const receipt = await ok<PdfLink>(`/api/v1/portal/bookings/${A1}/receipts/${payA1}/pdf`, tokenA);
    const docLink = await ok<PdfLink>(`/api/v1/portal/bookings/${A1}/documents/${docA1}/download`, tokenA);
    const timeline = await ok<Timeline>(`/api/v1/portal/bookings/${A1}/construction`, tokenA);
    const photo = timeline.stages.find((s) => s.name === "Excavation")!.photos[0]!;
    const links = [
      statement.download_url,
      receipt.download_url,
      docLink.download_url,
      photo.thumb_url,
      photo.medium_url,
    ];
    for (const link of links) {
      expect(link).toMatch(/\/api\/v1\/portal\/files\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const decoded = verifyPortalFileToken(await tokenOf(link));
      expect(decoded, link).not.toBeNull();
      expect(decoded!.customerId).toBe(A);
      expect(link).not.toContain(docA1);
      expect(link).not.toContain(visiblePhotoDoc);
    }
    // PDF / document bytes (a really stored shared image; docA1 above is a metadata-only fixture): no bearer (viewer, share sheet) and the owner's bearer work …
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#0B1F3A" } })
      .png()
      .toBuffer();
    const { uploadDocument } = await import("../../src/modules/documents/index.js");
    const stored = await uploadDocument(
      t.app,
      {
        companyId: t.companyId,
        entityType: "BOOKING",
        entityId: A1,
        buffer: png,
        filename: "site.png",
        uploadedBy: admin.user.id,
        uploadedByType: "STAFF",
        sharedWithCustomer: true,
      },
      async (_tx, row) => row,
    );
    const storedLink = await ok<PdfLink>(`/api/v1/portal/bookings/${A1}/documents/${stored.id}/download`, tokenA);
    for (const link of [statement.download_url, storedLink.download_url]) {
      expect((await fetchFile(link)).statusCode, link).toBe(200);
      expect((await fetchFile(link, `Bearer ${tokenA}`)).statusCode, link).toBe(200);
      // … another buyer, the co-applicant (the link was issued to A), a staff user, a garbage bearer and a non-bearer scheme are 404
      for (const bearer of [
        `Bearer ${tokenB}`,
        `Bearer ${tokenC}`,
        `Bearer ${admin.access_token}`,
        "Bearer not.a.jwt",
        "Basic abc",
      ]) {
        const r = await fetchFile(link, bearer);
        expect(r.statusCode, `${bearer.slice(0, 12)} ${link}`).toBe(404);
        expect(JSON.parse(r.body).error.code).toBe("NOT_FOUND");
      }
    }
    // the co-applicant gets their own links, bound to C, which A cannot open with A's bearer
    const forC = await ok<PdfLink>(`/api/v1/portal/bookings/${A1}/statement.pdf`, tokenC);
    expect(verifyPortalFileToken(await tokenOf(forC.download_url))!.customerId).toBe(C);
    expect((await fetchFile(forC.download_url, `Bearer ${tokenC}`)).statusCode).toBe(200);
    expect((await fetchFile(forC.download_url, `Bearer ${tokenA}`)).statusCode).toBe(404);
  });

  it("a valid token never opens a sensitive or deleted document; forged, tampered or expired tokens are 404", async () => {
    const { signPortalFile } = await import("../../src/modules/portal/index.js");
    const url = (token: string) => `http://localhost:4000/api/v1/portal/files/${token}`;
    // a token for the sensitive document (as if a share flag had slipped through) is refused at stream time
    expect((await fetchFile(url(signPortalFile(A, "DOCUMENT", docA1Sensitive).token))).statusCode).toBe(404);
    // a soft-deleted document behind a still-valid link
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#C9A227" } })
      .png()
      .toBuffer();
    const { uploadDocument } = await import("../../src/modules/documents/index.js");
    const doc = await uploadDocument(
      t.app,
      {
        companyId: t.companyId,
        entityType: "BOOKING",
        entityId: A1,
        buffer: png,
        filename: "plan.png",
        uploadedBy: admin.user.id,
        uploadedByType: "STAFF",
        sharedWithCustomer: true,
      },
      async (_tx, row) => row,
    );
    const live = await ok<PdfLink>(`/api/v1/portal/bookings/${A1}/documents/${doc.id}/download`, tokenA);
    expect((await fetchFile(live.download_url)).statusCode).toBe(200);
    await t.app.sql`update documents set is_deleted = true where id = ${doc.id}`;
    expect((await fetchFile(live.download_url)).statusCode).toBe(404);
    // expired, tampered, foreign-kind-byte and documents-module tokens
    expect((await fetchFile(url(signPortalFile(A, "DOCUMENT", docA1, "original", -5).token))).statusCode).toBe(404);
    const good = signPortalFile(A, "DOCUMENT", docA1).token;
    const [body, sig] = good.split(".") as [string, string];
    const flip = (ch: string) => (ch === "A" ? "B" : "A");
    expect((await fetchFile(url(`${body}.${sig.slice(0, -1)}${flip(sig.slice(-1))}`))).statusCode).toBe(404);
    expect((await fetchFile(url(`${flip(body[0]!)}${body.slice(1)}.${sig}`))).statusCode).toBe(404);
    expect((await fetchFile(url("x"))).statusCode).toBe(404);
    const { signedUrl } = await import("../../src/modules/documents/index.js");
    expect((await fetchFile(signedUrl(docA1).url.replace("/api/v1/files/", "/api/v1/portal/files/"))).statusCode).toBe(
      404,
    );
  });

  it("the floor plan and an unpublished project's hero image are signed for the customer; a sensitive hero is omitted", async () => {
    const plan = await insertImageDocument(t, "BLOCK", w.sgh.towerId);
    await t.app
      .sql`update documents set entity_type = 'FLAT', entity_id = ${w.sgh.flats.get("A-101")!.id}, title = 'Floor plan' where id = ${plan}`;
    const flat = await ok<Flat>(`/api/v1/portal/bookings/${A1}/flat`, tokenA);
    expect(flat.floor_plan_url).toMatch(/\/api\/v1\/portal\/files\//);
    expect((await fetchFile(flat.floor_plan_url!, `Bearer ${tokenB}`)).statusCode).toBe(404);
    // the co-applicant's copy of the same screen is bound to C
    const { verifyPortalFileToken } = await import("../../src/modules/portal/index.js");
    const flatC = await ok<Flat>(`/api/v1/portal/bookings/${A1}/flat`, tokenC);
    expect(verifyPortalFileToken(flatC.floor_plan_url!.split("/portal/files/")[1]!)!.customerId).toBe(C);

    const hero = await insertImageDocument(t, "PROJECT", w.sgh.id);
    await t.app
      .sql`insert into project_website_settings (project_id, is_published, hero_document_ids) values (${w.sgh.id}, false, array[${hero}]::uuid[])`;
    let home = await ok<Home>(`/api/v1/portal/bookings/${A1}/home`, tokenA);
    expect(home.booking.project_image_url).toMatch(/\/api\/v1\/portal\/files\//);
    expect(verifyPortalFileToken(home.booking.project_image_url!.split("/portal/files/")[1]!)!.customerId).toBe(A);
    await t.app.sql`update documents set is_sensitive = true where id = ${hero}`;
    home = await ok<Home>(`/api/v1/portal/bookings/${A1}/home`, tokenA);
    expect(home.booking.project_image_url).toBeNull();
    await t.app.sql`delete from project_website_settings where project_id = ${w.sgh.id}`;
  });
});

describe("visibility rules", () => {
  it("a sensitive document never appears or downloads even with shared_with_customer forced true; unshared ones neither", async () => {
    const docs = await ok<{ items: Doc[] }>(`/api/v1/portal/bookings/${A1}/documents`, tokenA);
    const ids = docs.items.map((d) => d.document_id);
    expect(ids).toContain(docA1);
    expect(ids).not.toContain(docA1Sensitive);
    expect(ids).not.toContain(docA1Unshared);
    for (const hidden of [docA1Sensitive, docA1Unshared, NO_ID])
      expect((await get(`/api/v1/portal/bookings/${A1}/documents/${hidden}/download`, tokenA)).status, hidden).toBe(
        404,
      );
    // a sensitive document uploaded by the customer themselves is still hidden
    const own = await insertDoc("CUSTOMER", A, { shared: true, sensitive: true, name: "Aadhaar" });
    await t.app.sql`update documents set uploaded_by_type = 'CUSTOMER', uploaded_by = ${A} where id = ${own}`;
    expect(
      (await ok<{ items: Doc[] }>(`/api/v1/portal/bookings/${A1}/documents`, tokenA)).items.some(
        (d) => d.document_id === own,
      ),
    ).toBe(false);
    expect((await get(`/api/v1/portal/bookings/${A1}/documents/${own}/download`, tokenA)).status).toBe(404);
  });

  it("construction photos not flagged visible to buyers never appear, for the primary or the co-applicant", async () => {
    const { verifyPortalFileToken } = await import("../../src/modules/portal/index.js");
    for (const token of [tokenA, tokenC]) {
      const tl = await ok<Timeline>(`/api/v1/portal/bookings/${A1}/construction`, token);
      const photos = tl.stages.flatMap((s) => s.photos);
      expect(photos).toHaveLength(1);
      const refs = photos
        .flatMap((p) => [p.thumb_url, p.medium_url])
        .map((u) => verifyPortalFileToken(u.split("/portal/files/")[1]!)!.refId);
      expect(refs.every((r) => r === visiblePhotoDoc)).toBe(true);
      expect(refs).not.toContain(hiddenPhotoDoc);
      expect(JSON.stringify(tl)).not.toContain(hiddenPhotoDoc);
    }
    // flipping the flag off hides the photo immediately
    await t.app.sql`update stage_photos set visible_to_buyers = false where document_id = ${visiblePhotoDoc}`;
    const tl = await ok<Timeline>(`/api/v1/portal/bookings/${A1}/construction`, tokenA);
    expect(tl.stages.flatMap((s) => s.photos)).toHaveLength(0);
    await t.app.sql`update stage_photos set visible_to_buyers = true where document_id = ${visiblePhotoDoc}`;
  });
});

describe("request thread attachment smuggling", () => {
  let reqA1: string;
  let reqB1: string;
  let bPhoto: string;

  it("only documents the customer uploaded or can already see may be attached; everything else is 400 on attachment_ids", async () => {
    const r = await post<Request>("/api/v1/portal/requests", tokenA, {
      booking_id: A1,
      category_id: snagCat,
      subject: "Seepage",
      description: "Water marks.",
    });
    expect(r.status, r.text).toBe(201);
    reqA1 = r.body.id;
    const rb = await post<Request>("/api/v1/portal/requests", tokenB, {
      booking_id: B1,
      category_id: snagCat,
      subject: "Gate",
      description: "Broken latch.",
    });
    expect(rb.status, rb.text).toBe(201);
    reqB1 = rb.body.id;
    const jpg = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#0B1F3A" } })
      .jpeg()
      .toBuffer();
    const upB = await uploadAttachment(tokenB, reqB1, jpg);
    expect(upB.status).toBe(201);
    bPhoto = upB.body.document_id;

    const attempt = async (ids: string[]) =>
      post<Request>(`/api/v1/portal/requests/${reqA1}/messages`, tokenA, { body: "see attached", attachment_ids: ids });
    for (const [label, ids] of [
      ["unshared booking document", [docA1Unshared]],
      ["sensitive shared document", [docA1Sensitive]],
      ["another booking's shared document", [docA2]],
      ["another buyer's uploaded photo", [bPhoto]],
      ["another buyer's shared document", [docB1]],
      ["unknown id", [NO_ID]],
    ] as [string, string[]][]) {
      const res = await attempt(ids);
      expect(res.status, label).toBe(400);
      expect(res.body.error.code, label).toBe("VALIDATION_ERROR");
      expect((res.body.error.details?.["issues"] as { path: string }[] | undefined)?.[0]?.path, label).toBe(
        "attachment_ids",
      );
    }
    // nothing leaked into the thread
    const d = await ok<Request>(`/api/v1/portal/requests/${reqA1}`, tokenA);
    expect(d.messages.flatMap((m) => m.attachments)).toHaveLength(0);
    // what IS allowed: a shared document of this booking, and the customer's own upload (thumb link bound to A)
    expect((await attempt([docA1])).status).toBe(201);
    const upA = await uploadAttachment(tokenA, reqA1, jpg);
    expect(upA.status).toBe(201);
    const own = await attempt([upA.body.document_id]);
    expect(own.status, own.text).toBe(201);
    const last = own.body.messages[own.body.messages.length - 1]!;
    expect(last.attachments[0]!.thumb_url).toMatch(/\/api\/v1\/portal\/files\//);
    const { verifyPortalFileToken } = await import("../../src/modules/portal/index.js");
    expect(verifyPortalFileToken(last.attachments[0]!.thumb_url!.split("/portal/files/")[1]!)!.customerId).toBe(A);
    expect((await fetchFile(last.attachments[0]!.thumb_url!, `Bearer ${tokenB}`)).statusCode).toBe(404);
    // the same rule on create: an unshared document cannot seed a new request; a shared one can
    expect(
      (
        await post<Request>("/api/v1/portal/requests", tokenA, {
          booking_id: A1,
          category_id: snagCat,
          subject: "Smuggle",
          description: "x",
          attachment_ids: [docA1Unshared],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post<Request>("/api/v1/portal/requests", tokenA, {
          booking_id: A1,
          category_id: snagCat,
          subject: "Legit",
          description: "x",
          attachment_ids: [docA1],
        })
      ).status,
    ).toBe(201);
    // ownership still wins over validation: B attaching to A's request is 404, not 400
    expect(
      (
        await post<Request>(`/api/v1/portal/requests/${reqA1}/messages`, tokenB, {
          body: "x",
          attachment_ids: [bPhoto],
        })
      ).status,
    ).toBe(404);
  });
});

describe("budget, limits and strictness", () => {
  it("the home screen runs at most 6 SQL statements", async () => {
    await ok<Home>(`/api/v1/portal/bookings/${A1}/home`, tokenA); // warm the auth cache
    const n = await countQueries(() => ok<Home>(`/api/v1/portal/bookings/${A1}/home`, tokenA));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(6);
    // and its counters agree with the dedicated endpoints
    const home = await ok<Home>(`/api/v1/portal/bookings/${A1}/home`, tokenA);
    const unread = await ok<{ count: number }>("/api/v1/portal/notifications/unread-count", tokenA);
    expect(home.notifications_unread).toBe(unread.count); // Appendix C: {count}
  });

  it("portal login is rate limited per IP (10/min → 429 with Retry-After) without locking anybody out", async () => {
    const ip = freshIp();
    // a different (unknown) phone per attempt: 5 failures for one phone from one IP would lock that pair (423) before the rate limit
    for (let i = 0; i < 10; i += 1) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
        ip,
        body: { phone: `90000000${String(i + 10)}`, password: "Wrong@12345" },
      });
      expect(r.status, `attempt ${i + 1}`).toBe(401);
    }
    const blocked = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
      ip,
      body: { phone: "9000000001", password: "Wrong@12345" },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // another IP is unaffected and a real customer still logs in
    expect(
      (await t.request("POST", "/api/v1/portal/auth/login", { body: { phone: await phoneOf(A), password: PASSWORD } }))
        .status,
    ).toBe(200);
  });

  it("unknown query keys are 400 on every portal list", async () => {
    for (const url of [
      `/api/v1/portal/bookings/${A1}/ledger?foo=1`,
      `/api/v1/portal/bookings/${A1}/receipts?csv=true`,
      `/api/v1/portal/bookings/${A1}/demands?search=x`,
      "/api/v1/portal/requests?foo=1",
      "/api/v1/portal/notices?project_id=x",
    ]) {
      const r = await get(url, tokenA);
      expect(r.status, url).toBe(400);
      expect(r.body.error.code, url).toBe("VALIDATION_ERROR");
    }
  });

  it("response envelopes never carry undefined where contracts expect null", async () => {
    const home = await ok<Home>(`/api/v1/portal/bookings/${B1}/home`, tokenB);
    expect(home).toHaveProperty("relationship_manager", null);
    expect(home.booking).toHaveProperty("project_image_url", null);
    const flat = await ok<Flat & { facing: unknown }>(`/api/v1/portal/bookings/${B1}/flat`, tokenB);
    expect(flat).toHaveProperty("floor_plan_url", null);
    expect(flat).toHaveProperty("facing");
    const d = await ok<Request & { booking_id: unknown; rating: unknown; last_message_at: unknown }>(
      `/api/v1/portal/requests`,
      tokenB,
    );
    for (const row of (d as unknown as { items: Record<string, unknown>[] }).items) {
      for (const k of ["booking_id", "rating", "last_message_at", "description"]) expect(row, k).toHaveProperty(k);
    }
  });
});
