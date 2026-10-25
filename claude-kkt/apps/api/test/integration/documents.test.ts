import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPortalCustomer, createProject } from "./fixtures.js";
import { buildTestApp, freshIp, type ErrorBody, type TestContext } from "./helpers.js";

// Uploads land in a throwaway directory (config reads STORAGE_LOCAL_DIR when the app is first imported).
const STORAGE_DIR = mkdtempSync(join(tmpdir(), "kkt-docs-test-"));
process.env["STORAGE_LOCAL_DIR"] = STORAGE_DIR;

type DocRow = {
  id: string; entity_type: string; entity_id: string; document_type_id: string | null; document_type_name: string | null; is_kyc: boolean; title: string; file_name: string;
  mime: string; size_bytes: number; sha256: string; width: number | null; height: number | null; has_variants: boolean; thumb_url: string | null; medium_url: string | null;
  is_sensitive: boolean; shared_with_customer: boolean; uploaded_by_type: string; uploaded_by: string | null; uploaded_by_name: string | null; is_deleted: boolean; created_at: string;
};
type LinkBody = { download_url: string; expires_at: string; file_name: string; mime: string };
type ListBody = { items: DocRow[]; total: number; page: number; page_size: number; next_cursor: string | null };

let t: TestContext;
let admin: string;
let sales: string;
let marketing: string;
let employee: string;
let projectsUser: string;
let customerId: string;
let projectId: string;
let panTypeId: string;
let agreementTypeId: string;
let floorPlanTypeId: string;
let png: Buffer;
let pdf: Buffer;

const NO_ID = "00000000-0000-4000-8000-000000000000";

async function upload(token: string | null, fields: Record<string, unknown>, file: { name: string; data: Buffer; type?: string } | null, extraHeaders: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  if (file) fd.append("file", new Blob([new Uint8Array(file.data)], { type: file.type ?? "application/octet-stream" }), file.name);
  const encoded = new Response(fd);
  const payload = Buffer.from(await encoded.arrayBuffer());
  const headers: Record<string, string> = { "content-type": encoded.headers.get("content-type")!, "x-forwarded-for": freshIp(), ...extraHeaders };
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await t.app.inject({ method: "POST", url: "/api/v1/documents", headers, payload });
  const ct = String(res.headers["content-type"] ?? "");
  const body = ct.includes("application/json") && res.body ? (JSON.parse(res.body) as unknown) : res.body;
  return { status: res.statusCode, body: body as { document: DocRow } & ErrorBody, text: res.body, headers: res.headers as Record<string, string | string[] | undefined> };
}

async function uploadOk(token: string, fields: Record<string, unknown>, file: { name: string; data: Buffer }): Promise<DocRow> {
  const r = await upload(token, fields, file);
  expect(r.status, r.text).toBe(201);
  return r.body.document;
}

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

async function fetchFile(url: string) {
  return t.app.inject({ method: "GET", url: pathOf(url), headers: { "x-forwarded-for": freshIp() } });
}

async function createDocType(body: Record<string, unknown>): Promise<string> {
  const r = await t.request<{ id: string }>("POST", "/api/v1/masters/document-types", { token: admin, body });
  expect(r.status, r.text).toBe(201);
  return r.body.id;
}

async function auditActions(entityId: string): Promise<string[]> {
  const rows = await t.app.sql<{ action: string }[]>`select action from audit_logs where entity_type = 'document' and entity_id = ${entityId} order by created_at`;
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  sales = (await t.loginAs("sales")).access_token;
  marketing = (await t.loginAs("marketing")).access_token;
  employee = (await t.loginAs("employee")).access_token;
  projectsUser = (await t.loginAs("projects")).access_token;
  customerId = (await createPortalCustomer(t, { phone: "9876501234" })).customerId;
  projectId = await createProject(t, "Shree Ganesh Heights", "SGH");
  panTypeId = await createDocType({ name: "PAN Card", code: "PAN", applies_to: ["CUSTOMER"], is_kyc: true });
  agreementTypeId = await createDocType({ name: "Agreement", code: "AGREEMENT", applies_to: ["BOOKING"] });
  floorPlanTypeId = await createDocType({ name: "Floor Plan", code: "FLOOR_PLAN", applies_to: ["PROJECT", "FLAT"] });
  png = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 30, g: 60, b: 120 } } }).png().toBuffer();
  pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
});
afterAll(async () => { await t?.close(); });

describe("upload", () => {
  it("stores a real PNG with webp thumb/medium variants under a uuid key that never contains the original filename", async () => {
    const doc = await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId, title: "Site photo" }, { name: "My Holiday Photo (final).PNG", data: png });
    expect(doc.mime).toBe("image/png");
    expect(doc.size_bytes).toBe(png.length);
    expect(doc.has_variants).toBe(true);
    expect(doc.width).toBe(1600);
    expect(doc.height).toBe(900);
    expect(doc.is_sensitive).toBe(false);
    expect(doc.shared_with_customer).toBe(false);
    expect(doc.title).toBe("Site photo");
    expect(doc.file_name).toBe("My Holiday Photo (final).PNG");
    expect(doc.uploaded_by_type).toBe("STAFF");
    expect(doc.uploaded_by_name).toBe("Suresh Agarwal");
    expect(doc.thumb_url).toMatch(/\/api\/v1\/files\//);
    expect(doc.medium_url).toMatch(/\/api\/v1\/files\//);
    expect(JSON.stringify(doc)).not.toContain("storage_key");

    const [row] = await t.app.sql<{ storage_key: string; variants: { thumb_key: string; medium_key: string; width: number; height: number }; sha256: string }[]>`select storage_key, variants, sha256 from documents where id = ${doc.id}`;
    expect(row!.storage_key).toMatch(new RegExp(`^${t.companyId}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.png$`));
    expect(row!.storage_key.toLowerCase()).not.toContain("holiday");
    expect(row!.variants.thumb_key).toMatch(/_thumb\.webp$/);
    expect(row!.variants.medium_key).toMatch(/_medium\.webp$/);
    const { createHash } = await import("node:crypto");
    expect(row!.sha256).toBe(createHash("sha256").update(png).digest("hex"));
    expect(existsSync(join(STORAGE_DIR, row!.storage_key))).toBe(true);
    const thumb = await sharp(readFileSync(join(STORAGE_DIR, row!.variants.thumb_key))).metadata();
    expect(thumb.format).toBe("webp");
    expect(thumb.width).toBe(480);
    const medium = await sharp(readFileSync(join(STORAGE_DIR, row!.variants.medium_key))).metadata();
    expect(medium.width).toBe(1080);
    expect(await auditActions(doc.id)).toEqual(["document.upload"]);
  });

  it("stores a PDF without variants and streams it as an attachment through a signed link", async () => {
    const doc = await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "statement.pdf", data: pdf });
    expect(doc.mime).toBe("application/pdf");
    expect(doc.has_variants).toBe(false);
    expect(doc.thumb_url).toBeNull();
    expect(doc.title).toBe("statement.pdf");
    const link = await t.request<LinkBody>("POST", `/api/v1/documents/${doc.id}/link`, { token: admin });
    expect(link.status, link.text).toBe(200);
    expect(link.body.mime).toBe("application/pdf");
    expect(link.body.file_name).toBe("statement.pdf");
    expect(new Date(link.body.expires_at).getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(new Date(link.body.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    const res = await fetchFile(link.body.download_url);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(String(res.headers["content-disposition"])).toMatch(/^attachment; filename="statement.pdf"/);
    expect(String(res.headers["cache-control"])).toMatch(/^private/);
    expect(res.rawPayload.equals(pdf)).toBe(true);
    const thumb = await t.request<ErrorBody>("POST", `/api/v1/documents/${doc.id}/link?variant=thumb`, { token: admin });
    expect(thumb.status).toBe(404);
  });

  it("streams images inline and serves the webp variants", async () => {
    const doc = await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "photo.png", data: png });
    const original = await fetchFile((await t.request<LinkBody>("POST", `/api/v1/documents/${doc.id}/link?variant=original`, { token: admin })).body.download_url);
    expect(original.statusCode).toBe(200);
    expect(original.headers["content-type"]).toBe("image/png");
    expect(String(original.headers["content-disposition"])).toMatch(/^inline/);
    expect(Number(original.headers["content-length"])).toBe(png.length);
    const medium = await t.request<LinkBody>("POST", `/api/v1/documents/${doc.id}/link?variant=medium`, { token: admin });
    expect(medium.body.mime).toBe("image/webp");
    expect(medium.body.file_name).toBe("photo_medium.webp");
    const bytes = await fetchFile(medium.body.download_url);
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers["content-type"]).toBe("image/webp");
    expect((await sharp(bytes.rawPayload).metadata()).width).toBe(1080);
    const viaRow = await fetchFile(doc.thumb_url!);
    expect(viaRow.statusCode).toBe(200);
    expect((await sharp(viaRow.rawPayload).metadata()).width).toBe(480);
    const badVariant = await t.request<ErrorBody>("POST", `/api/v1/documents/${doc.id}/link?variant=huge`, { token: admin });
    expect(badVariant.status).toBe(400);
  });

  it("rejects an EXE or HTML renamed .pdf by magic bytes with 415 UNSUPPORTED_MEDIA", async () => {
    const exe = Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00", "latin1"), Buffer.alloc(600, 0)]);
    const r1 = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "invoice.pdf", data: exe, type: "application/pdf" });
    expect(r1.status, r1.text).toBe(415);
    expect(r1.body.error.code).toBe("UNSUPPORTED_MEDIA");
    const html = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");
    const r2 = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "report.pdf", data: html, type: "application/pdf" });
    expect(r2.status).toBe(415);
    expect(r2.body.error.code).toBe("UNSUPPORTED_MEDIA");
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64, 0)]);
    const r3 = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "anim.gif", data: gif });
    expect(r3.status).toBe(415);
    expect(await t.app.sql`select count(*)::int as n from documents where file_name in ('invoice.pdf', 'report.pdf', 'anim.gif')`).toEqual([{ n: 0 }]);
  });

  it("caps uploads at 15 MB (16 MB → 413 PAYLOAD_TOO_LARGE)", async () => {
    const big = Buffer.alloc(16 * 1024 * 1024, 0x41);
    big.write("%PDF-1.4\n", 0, "latin1");
    const r = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "huge.pdf", data: big });
    expect(r.status, r.text).toBe(413);
    expect(r.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    const { storeBuffer } = await import("../../src/modules/documents/service.js");
    await expect(storeBuffer(t.app.db, { companyId: t.companyId, entityType: "CUSTOMER", entityId: customerId, buffer: big, filename: "huge.pdf", uploadedBy: null, uploadedByType: "SYSTEM" })).rejects.toMatchObject({ statusCode: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("validates the entity, the fields and the file part", async () => {
    expect((await upload(admin, { entity_type: "CUSTOMER", entity_id: NO_ID }, { name: "a.pdf", data: pdf })).status).toBe(404);
    expect((await upload(admin, { entity_type: "BOOKING", entity_id: NO_ID }, { name: "a.pdf", data: pdf })).status).toBe(404);
    expect((await upload(admin, { entity_type: "PROJECT", entity_id: NO_ID }, { name: "a.pdf", data: pdf })).status).toBe(404);
    expect((await upload(admin, { entity_type: "COMPANY", entity_id: NO_ID }, { name: "a.pdf", data: pdf })).status).toBe(404);
    const badType = await upload(admin, { entity_type: "INVOICE", entity_id: customerId }, { name: "a.pdf", data: pdf });
    expect(badType.status).toBe(400);
    expect(badType.body.error.code).toBe("VALIDATION_ERROR");
    const noFile = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId }, null);
    expect(noFile.status).toBe(400);
    const unknownDocType = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId, document_type_id: NO_ID }, { name: "a.pdf", data: pdf });
    expect(unknownDocType.status).toBe(400);
    const notMultipart = await t.request<ErrorBody>("POST", "/api/v1/documents", { token: admin, body: { entity_type: "CUSTOMER", entity_id: customerId } });
    expect(notMultipart.status).toBe(400);
    const company = await uploadOk(admin, { entity_type: "COMPANY", entity_id: t.companyId, title: "Logo" }, { name: "logo.png", data: png });
    expect(company.entity_type).toBe("COMPANY");
  });

  it("replays an identical upload with the same Idempotency-Key", async () => {
    const key = `doc-${Date.now()}`;
    const first = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId, title: "Idem" }, { name: "idem.pdf", data: pdf }, { "idempotency-key": key });
    expect(first.status).toBe(201);
    const again = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId, title: "Idem" }, { name: "idem.pdf", data: pdf }, { "idempotency-key": key });
    expect(again.status).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.document.id).toBe(first.body.document.id);
    const n = await t.app.sql<{ n: number }[]>`select count(*)::int as n from documents where title = 'Idem'`;
    expect(n[0]!.n).toBe(1);
  });
});

describe("KYC and document-type rules", () => {
  it("a KYC type forces is_sensitive and rejects sharing on upload and on update", async () => {
    const shared = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId, document_type_id: panTypeId, shared_with_customer: "true" }, { name: "pan.pdf", data: pdf });
    expect(shared.status, shared.text).toBe(422);
    expect(shared.body.error.code).toBe("BUSINESS_RULE");
    expect(shared.body.error.details?.["rule"]).toBe("KYC_NOT_SHAREABLE");
    const doc = await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId, document_type_id: panTypeId, is_sensitive: "false", shared_with_customer: "false" }, { name: "pan.pdf", data: pdf });
    expect(doc.is_kyc).toBe(true);
    expect(doc.document_type_name).toBe("PAN Card");
    expect(doc.is_sensitive).toBe(true);
    expect(doc.shared_with_customer).toBe(false);
    const share = await t.request<ErrorBody>("PATCH", `/api/v1/documents/${doc.id}`, { token: admin, body: { shared_with_customer: true } });
    expect(share.status).toBe(422);
    expect(share.body.error.details?.["rule"]).toBe("KYC_NOT_SHAREABLE");
    const unsens = await t.request<DocRow>("PATCH", `/api/v1/documents/${doc.id}`, { token: admin, body: { is_sensitive: false, title: "PAN of Rajesh" } });
    expect(unsens.status, unsens.text).toBe(200);
    expect(unsens.body.is_sensitive).toBe(true);
    expect(unsens.body.title).toBe("PAN of Rajesh");
    // Switching a shared document onto a KYC type is refused too.
    const plain = await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId, shared_with_customer: "true" }, { name: "welcome.pdf", data: pdf });
    const retype = await t.request<ErrorBody>("PATCH", `/api/v1/documents/${plain.id}`, { token: admin, body: { document_type_id: panTypeId } });
    expect(retype.status).toBe(422);
    expect(retype.body.error.details?.["rule"]).toBe("KYC_NOT_SHAREABLE");
    const retypeUnshared = await t.request<DocRow>("PATCH", `/api/v1/documents/${plain.id}`, { token: admin, body: { document_type_id: panTypeId, shared_with_customer: false } });
    expect(retypeUnshared.status, retypeUnshared.text).toBe(200);
    expect(retypeUnshared.body.is_sensitive).toBe(true);
    expect(retypeUnshared.body.is_kyc).toBe(true);
    expect(await auditActions(plain.id)).toEqual(["document.upload", "document.update"]);
  });

  it("a document type must apply to the entity kind", async () => {
    const r = await upload(admin, { entity_type: "CUSTOMER", entity_id: customerId, document_type_id: agreementTypeId }, { name: "agreement.pdf", data: pdf });
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.details?.["rule"]).toBe("DOCUMENT_TYPE_NOT_APPLICABLE");
    const ok = await uploadOk(admin, { entity_type: "PROJECT", entity_id: projectId, document_type_id: floorPlanTypeId, title: "Typical floor" }, { name: "floor.png", data: png });
    expect(ok.document_type_name).toBe("Floor Plan");
    const retype = await t.request<ErrorBody>("PATCH", `/api/v1/documents/${ok.id}`, { token: admin, body: { document_type_id: agreementTypeId } });
    expect(retype.status).toBe(422);
    const clear = await t.request<DocRow>("PATCH", `/api/v1/documents/${ok.id}`, { token: admin, body: { document_type_id: null } });
    expect(clear.status, clear.text).toBe(200);
    expect(clear.body.document_type_id).toBeNull();
    expect(clear.body.is_kyc).toBe(false);
  });
});

describe("sensitivity and permissions", () => {
  let sensitiveId: string;
  let plainId: string;
  beforeAll(async () => {
    sensitiveId = (await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId, document_type_id: panTypeId, title: "PAN scan" }, { name: "pan-scan.png", data: png })).id;
    plainId = (await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId, title: "Welcome letter", shared_with_customer: "true" }, { name: "welcome-letter.pdf", data: pdf })).id;
  });

  it("Sales cannot list, read or download sensitive documents but can download non-sensitive ones; admin sees both", async () => {
    const list = await t.request<ListBody>("GET", `/api/v1/documents?entity_type=CUSTOMER&entity_id=${customerId}&page_size=100`, { token: sales });
    expect(list.status, list.text).toBe(200);
    const ids = list.body.items.map((d) => d.id);
    expect(ids).toContain(plainId);
    expect(ids).not.toContain(sensitiveId);
    expect(list.body.items.every((d) => !d.is_sensitive)).toBe(true);
    expect((await t.request("GET", `/api/v1/documents/${sensitiveId}`, { token: sales })).status).toBe(404);
    expect((await t.request("GET", `/api/v1/documents/${plainId}`, { token: sales })).status).toBe(200);
    const denied = await t.request<ErrorBody>("POST", `/api/v1/documents/${sensitiveId}/link`, { token: sales });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    expect(denied.body.error.details?.["permission"]).toBe("customer.kyc_view");
    expect((await t.request("PATCH", `/api/v1/documents/${sensitiveId}`, { token: sales, body: { title: "x" } })).status).toBe(404);
    expect((await t.request("DELETE", `/api/v1/documents/${sensitiveId}`, { token: sales })).status).toBe(404);
    const ok = await t.request<LinkBody>("POST", `/api/v1/documents/${plainId}/link`, { token: sales });
    expect(ok.status, ok.text).toBe(200);
    expect((await fetchFile(ok.body.download_url)).statusCode).toBe(200);

    const adminList = await t.request<ListBody>("GET", `/api/v1/documents?entity_type=CUSTOMER&entity_id=${customerId}&page_size=100`, { token: admin });
    expect(adminList.body.items.map((d) => d.id)).toEqual(expect.arrayContaining([plainId, sensitiveId]));
    const adminLink = await t.request<LinkBody>("POST", `/api/v1/documents/${sensitiveId}/link?variant=thumb`, { token: admin });
    expect(adminLink.status).toBe(200);
    expect((await fetchFile(adminLink.body.download_url)).statusCode).toBe(200);
    expect(await auditActions(sensitiveId)).toEqual(["document.upload", "document.sensitive_link"]);
  });

  it("requires document.write plus the entity permission; Employee has neither", async () => {
    const emp = await upload(employee, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "a.pdf", data: pdf });
    expect(emp.status).toBe(403);
    expect(emp.body.error.details?.["permission"]).toBe("document.write");
    expect((await t.request("GET", `/api/v1/documents?entity_type=CUSTOMER&entity_id=${customerId}`, { token: employee })).status).toBe(403);
    const mkt = await upload(marketing, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "a.pdf", data: pdf });
    expect(mkt.status).toBe(403);
    expect(mkt.body.error.details?.["permission"]).toBe("customer.write");
    const salesCms = await upload(sales, { entity_type: "CMS", entity_id: t.companyId }, { name: "banner.png", data: png });
    expect(salesCms.status).toBe(403);
    expect(salesCms.body.error.details?.["permission"]).toBe("cms.write");
    const mktCms = await uploadOk(marketing, { entity_type: "CMS", entity_id: t.companyId, title: "Hero banner" }, { name: "banner.png", data: png });
    expect(mktCms.thumb_url).toBe(`http://localhost:4000/api/v1/public/media/${mktCms.id}?variant=thumb`);
    expect(mktCms.medium_url).toBe(`http://localhost:4000/api/v1/public/media/${mktCms.id}?variant=medium`);
    const salesCustomer = await uploadOk(sales, { entity_type: "CUSTOMER", entity_id: customerId, title: "Address proof" }, { name: "proof.pdf", data: pdf });
    expect(salesCustomer.uploaded_by_name).toBe("Ankit Verma");
    expect((await t.request("POST", `/api/v1/documents/${plainId}/link`, { token: null })).status).toBe(401);
  });

  it("project scope: a scoped user gets 404 for documents of projects outside their scope", async () => {
    const projectDoc = await uploadOk(admin, { entity_type: "PROJECT", entity_id: projectId, title: "Brochure" }, { name: "brochure.pdf", data: pdf });
    const denied = await upload(projectsUser, { entity_type: "PROJECT", entity_id: projectId }, { name: "x.pdf", data: pdf });
    expect(denied.status).toBe(404);
    expect((await t.request("GET", `/api/v1/documents/${projectDoc.id}`, { token: projectsUser })).status).toBe(404);
    expect((await t.request("POST", `/api/v1/documents/${projectDoc.id}/link`, { token: projectsUser })).status).toBe(404);
    expect((await t.request("GET", `/api/v1/documents?entity_type=PROJECT&entity_id=${projectId}`, { token: projectsUser })).status).toBe(404);
    const all = await t.request<ListBody>("GET", "/api/v1/documents?page_size=200", { token: projectsUser });
    expect(all.status, all.text).toBe(200);
    expect(all.body.items.map((d) => d.id)).not.toContain(projectDoc.id);
    expect(all.body.items.map((d) => d.id)).toContain(plainId);
    const adminAll = await t.request<ListBody>("GET", "/api/v1/documents?page_size=200", { token: admin });
    expect(adminAll.body.items.map((d) => d.id)).toContain(projectDoc.id);
  });
});

describe("signed links", () => {
  it("expired (ttl −1), forged and garbage tokens are 404", async () => {
    const doc = await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId }, { name: "link.pdf", data: pdf });
    const { signedUrl } = await import("../../src/modules/documents/service.js");
    const expired = signedUrl(doc.id, "original", -1);
    expect((await fetchFile(expired.url)).statusCode).toBe(404);
    const valid = signedUrl(doc.id, "original", 60);
    expect((await fetchFile(valid.url)).statusCode).toBe(200);
    const last = valid.url.slice(-1);
    const forged = valid.url.slice(0, -1) + (last === "A" ? "B" : "A");
    expect((await fetchFile(forged)).statusCode).toBe(404);
    const [body] = valid.url.split("/files/")[1]!.split(".");
    const resigned = `${body}.${"x".repeat(43)}`;
    expect((await fetchFile(`http://localhost:4000/api/v1/files/${resigned}`)).statusCode).toBe(404);
    expect((await fetchFile("http://localhost:4000/api/v1/files/not-a-token-at-all-really")).statusCode).toBe(404);
    // A token for a document that does not exist is 404 too.
    expect((await fetchFile(signedUrl(NO_ID, "original", 60).url)).statusCode).toBe(404);
    // A variant the document does not have.
    expect((await fetchFile(signedUrl(doc.id, "thumb", 60).url)).statusCode).toBe(404);
  });
});

describe("soft delete", () => {
  it("hides the document everywhere, invalidates links and writes an audit row", async () => {
    const doc = await uploadOk(admin, { entity_type: "CUSTOMER", entity_id: customerId, title: "To delete" }, { name: "del.pdf", data: pdf });
    const link = await t.request<LinkBody>("POST", `/api/v1/documents/${doc.id}/link`, { token: admin });
    expect((await fetchFile(link.body.download_url)).statusCode).toBe(200);
    expect((await t.request("DELETE", `/api/v1/documents/${doc.id}`, { token: employee })).status).toBe(403);
    const del = await t.request("DELETE", `/api/v1/documents/${doc.id}`, { token: admin });
    expect(del.status, del.text).toBe(204);
    expect((await t.request("GET", `/api/v1/documents/${doc.id}`, { token: admin })).status).toBe(404);
    expect((await t.request("POST", `/api/v1/documents/${doc.id}/link`, { token: admin })).status).toBe(404);
    expect((await t.request("PATCH", `/api/v1/documents/${doc.id}`, { token: admin, body: { title: "x" } })).status).toBe(404);
    expect((await t.request("DELETE", `/api/v1/documents/${doc.id}`, { token: admin })).status).toBe(404);
    expect((await fetchFile(link.body.download_url)).statusCode).toBe(404);
    const list = await t.request<ListBody>("GET", `/api/v1/documents?entity_type=CUSTOMER&entity_id=${customerId}&page_size=200`, { token: admin });
    expect(list.body.items.map((d) => d.id)).not.toContain(doc.id);
    const withDeleted = await t.request<ListBody>("GET", `/api/v1/documents?entity_type=CUSTOMER&entity_id=${customerId}&include_deleted=true&page_size=200`, { token: admin });
    const gone = withDeleted.body.items.find((d) => d.id === doc.id);
    expect(gone?.is_deleted).toBe(true);
    const [row] = await t.app.sql<{ is_deleted: boolean; deleted_at: string | null; storage_key: string }[]>`select is_deleted, deleted_at, storage_key from documents where id = ${doc.id}`;
    expect(row!.is_deleted).toBe(true);
    expect(row!.deleted_at).not.toBeNull();
    expect(existsSync(join(STORAGE_DIR, row!.storage_key))).toBe(true); // soft delete keeps the bytes
    expect(await auditActions(doc.id)).toEqual(["document.upload", "document.delete"]);
    const audit = await t.app.sql<{ actor_name: string; after: { is_deleted: boolean } }[]>`select actor_name, after from audit_logs where entity_type = 'document' and entity_id = ${doc.id} and action = 'document.delete'`;
    expect(audit[0]!.actor_name).toBe("Suresh Agarwal");
    expect(audit[0]!.after.is_deleted).toBe(true);
  });
});

describe("list conventions", () => {
  it("filters, searches, sorts, paginates and exports CSV", async () => {
    const list = await t.request<ListBody>("GET", `/api/v1/documents?entity_type=CUSTOMER&entity_id=${customerId}&shared_with_customer=true&page_size=100`, { token: admin });
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((d) => d.shared_with_customer)).toBe(true);
    expect(list.headers["etag"]).toBeDefined();
    const search = await t.request<ListBody>("GET", `/api/v1/documents?search=welcome`, { token: admin });
    expect(search.body.items.length).toBeGreaterThan(0);
    expect(search.body.items.every((d) => /welcome/i.test(d.title) || /welcome/i.test(d.file_name))).toBe(true);
    const byType = await t.request<ListBody>("GET", `/api/v1/documents?document_type_id=${panTypeId}&page_size=100`, { token: admin });
    expect(byType.body.items.length).toBeGreaterThan(0);
    expect(byType.body.items.every((d) => d.document_type_id === panTypeId && d.is_sensitive)).toBe(true);
    const sorted = await t.request<ListBody>("GET", `/api/v1/documents?sort=size_bytes&page_size=100`, { token: admin });
    const sizes = sorted.body.items.map((d) => d.size_bytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect((await t.request("GET", `/api/v1/documents?sort=storage_key`, { token: admin })).status).toBe(400);
    expect((await t.request("GET", `/api/v1/documents?foo=bar`, { token: admin })).status).toBe(400);
    const p1 = await t.request<ListBody>("GET", `/api/v1/documents?limit=2`, { token: admin });
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.next_cursor).not.toBeNull();
    const p2 = await t.request<ListBody>("GET", `/api/v1/documents?limit=2&cursor=${encodeURIComponent(p1.body.next_cursor!)}`, { token: admin });
    expect(p2.status, p2.text).toBe(200);
    expect(p2.body.items.map((d) => d.id)).not.toEqual(p1.body.items.map((d) => d.id));
    const csv = await t.request("GET", `/api/v1/documents?format=csv`, { token: admin });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.text.split("\r\n")[0]).toContain("sha256");
    expect(csv.text).not.toContain(t.companyId + "/");
  });
});

describe("service functions for other modules", () => {
  it("storeBuffer, listForEntity, documentsSharedWithCustomer, streamDocument and publicMediaUrl", async () => {
    const svc = await import("../../src/modules/documents/service.js");
    const stored = await t.app.db.transaction((tx) => svc.storeBuffer(tx, { companyId: t.companyId, entityType: "CUSTOMER", entityId: customerId, buffer: png, filename: "../../etc/passwd.png", title: "Shared by system", sharedWithCustomer: true, uploadedBy: null, uploadedByType: "SYSTEM" }));
    expect(stored.fileName).toBe("passwd.png");
    expect(stored.storageKey).not.toContain("..");
    expect(stored.uploadedByType).toBe("SYSTEM");
    const rows = await svc.listForEntity(t.app.db, t.companyId, "CUSTOMER", customerId);
    expect(rows.every((r) => !r.is_sensitive)).toBe(true);
    expect(rows.map((r) => r.id)).toContain(stored.id);
    const withSensitive = await svc.listForEntity(t.app.db, t.companyId, "CUSTOMER", customerId, { includeSensitive: true });
    expect(withSensitive.some((r) => r.is_sensitive)).toBe(true);
    expect(withSensitive.length).toBeGreaterThan(rows.length);
    const shared = await svc.documentsSharedWithCustomer(t.app.db, { customerId });
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((r) => r.shared_with_customer && !r.is_sensitive && !r.is_deleted)).toBe(true);
    expect(shared.map((r) => r.id)).toContain(stored.id);
    expect(await svc.documentsSharedWithCustomer(t.app.db, {})).toEqual([]);
    const stream = await svc.streamDocument(t.app.db, stored.id, "thumb");
    expect(stream?.mime).toBe("image/webp");
    const chunks: Buffer[] = [];
    for await (const c of stream!.stream) chunks.push(c as Buffer);
    expect((await sharp(Buffer.concat(chunks)).metadata()).width).toBe(480);
    expect(svc.publicMediaUrl(stored.id)).toBe(`http://localhost:4000/api/v1/public/media/${stored.id}`);
    expect(svc.publicMediaUrl(stored.id, "medium")).toBe(`http://localhost:4000/api/v1/public/media/${stored.id}?variant=medium`);
    await t.app.sql`update documents set is_deleted = true, deleted_at = now() where id = ${stored.id}`;
    expect(await svc.streamDocument(t.app.db, stored.id, "original")).toBeNull();
    expect((await svc.documentsSharedWithCustomer(t.app.db, { customerId })).map((r) => r.id)).not.toContain(stored.id);
    expect(await svc.loadRows(t.app.db, t.companyId, [stored.id, NO_ID])).toEqual([]);
  });
});
