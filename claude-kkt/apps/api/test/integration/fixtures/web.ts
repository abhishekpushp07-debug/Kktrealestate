import sharp from "sharp";
import { createBasics, type Basics } from "../fixtures.js";
import { freshIp, type TestContext } from "../helpers.js";

/** Minimal valid PDF bytes (file-type sniffs the %PDF- magic). */
export const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");

/** A real PNG (sharp) so the documents module generates webp variants. */
export async function pngBytes(width = 1200, height = 800): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 11, g: 31, b: 58 } } }).png().toBuffer();
}

/** Multipart upload to a documents-style route; returns status + parsed body. */
export async function uploadMultipart(t: TestContext, token: string, url: string, fields: Record<string, unknown>, file: { name: string; data: Buffer; type?: string }, extraHeaders: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  fd.append("file", new Blob([new Uint8Array(file.data)], { type: file.type ?? "application/octet-stream" }), file.name);
  const encoded = new Response(fd);
  const payload = Buffer.from(await encoded.arrayBuffer());
  const headers: Record<string, string> = { "content-type": encoded.headers.get("content-type")!, "x-forwarded-for": freshIp(), authorization: `Bearer ${token}`, ...extraHeaders };
  const res = await t.app.inject({ method: "POST", url, headers, payload });
  const ct = String(res.headers["content-type"] ?? "");
  const body = ct.includes("application/json") && res.body ? (JSON.parse(res.body) as unknown) : res.body;
  return { status: res.statusCode, body: body as { document: { id: string; file_name: string; mime: string } } & { error?: { code: string } }, text: res.body, headers: res.headers };
}

/** Uploads one document and returns its id (throws on failure). */
export async function uploadDoc(t: TestContext, token: string, fields: Record<string, unknown>, file: { name: string; data: Buffer }): Promise<string> {
  const r = await uploadMultipart(t, token, "/api/v1/documents", fields, file);
  if (r.status !== 201) throw new Error(`upload ${file.name} → ${r.status} ${r.text}`);
  return r.body.document.id;
}

/** Everything the web/visits tests need: a project with a tower, flats in every status, stages with photos, hero + brochure documents. */
export interface WebProject {
  basics: Basics;
  projectId: string;
  blockId: string;
  slug: string;
  flatTypeCode: string;
  heroDocId: string;
  brochureDocId: string;
  websitePhotoDocId: string;
  hiddenPhotoDocId: string;
  flats: Record<string, string>;
  websiteVersion: number;
}

/** Creates the inventory directly in SQL (inventory module is built by another phase) and the documents through the API. */
export async function createWebProject(t: TestContext, admin: string, opts: { name: string; code: string; suffix: string; description?: string | null; address?: boolean }): Promise<WebProject> {
  const basics = await createBasics(t, admin, opts.suffix);
  const bt = await t.request<{ id: string }>("POST", "/api/v1/masters/block-types", { token: admin, body: { name: `Tower${opts.suffix}`, code: `TOWER${opts.suffix}`, has_floors: true } });
  if (bt.status !== 201) throw new Error(`block type: ${bt.text}`);
  const address = opts.address === false ? null : { line1: "Bailey Road", locality: "Raja Bazar", city: "Patna", state: "Bihar", pincode: "800014" };
  const [p] = await t.app.sql<{ id: string }[]>`
    insert into projects (company_id, name, code, project_type, status, description, address, city, rera_number, possession_date, landmarks, approvals)
    values (${t.companyId}, ${opts.name}, ${opts.code}, 'RESIDENTIAL', 'UNDER_CONSTRUCTION', ${opts.description === undefined ? "Premium 3 BHK homes on Bailey Road." : opts.description}, ${address ? JSON.stringify(address) : null}::jsonb, 'Patna', 'BRERAP00123-1/23', '2027-03-31',
            ${JSON.stringify([{ name: "Patna Junction", distance_km: 4.5 }])}::jsonb, ${JSON.stringify([{ name: "RERA", number: "BRERAP00123-1/23", status: "APPROVED" }])}::jsonb)
    returning id`;
  const projectId = p!.id;
  const [b] = await t.app.sql<{ id: string }[]>`
    insert into blocks (company_id, project_id, block_type_id, name, code, floors, construction_percent, status, stage_sequence)
    values (${t.companyId}, ${projectId}, ${bt.body.id}, 'Tower A', 'A', 2, 45.5, 'UNDER_CONSTRUCTION', ${basics.stageIds}::uuid[]) returning id`;
  const blockId = b!.id;
  const flatTypeCode = `3BHK-A${opts.suffix}`;
  const flatDefs: [string, number, number, string, number][] = [
    ["A-101", 1, 1, "AVAILABLE", 5_000_000_00], ["A-102", 1, 2, "HOLD", 5_100_000_00], ["A-103", 1, 3, "BOOKED", 5_200_000_00],
    ["A-201", 2, 1, "AVAILABLE", 4_800_000_00], ["A-202", 2, 2, "SOLD", 5_300_000_00], ["A-203", 2, 3, "BLOCKED", 5_400_000_00],
  ];
  const flats: Record<string, string> = {};
  for (const [num, floor, pos, status, price] of flatDefs) {
    const [f] = await t.app.sql<{ id: string }[]>`
      insert into flats (company_id, project_id, block_id, flat_number, floor, floor_label, position, flat_type_id, flat_type_code, facing, status, price_paise, carpet_sqft, builtup_sqft, super_builtup_sqft)
      values (${t.companyId}, ${projectId}, ${blockId}, ${num}, ${floor}, ${String(floor)}, ${pos}, ${basics.flatTypeId}, ${flatTypeCode}, 'East', ${status}::flat_status, ${price}, 1050, 1250, 1520) returning id`;
    flats[num] = f!.id;
  }
  await t.app.sql`update blocks set unit_counts = jsonb_build_object('available', 2, 'hold', 1, 'blocked', 1, 'booked', 1, 'sold', 1, 'total', 6) where id = ${blockId}`;
  const stageRows: { id: string }[] = [];
  for (const [i, stageId] of basics.stageIds.entries()) {
    const status = i === 0 ? "COMPLETED" : i === 1 ? "IN_PROGRESS" : "PENDING";
    const [s] = await t.app.sql<{ id: string }[]>`
      insert into block_stages (company_id, block_id, stage_id, sort_order, name, status, started_on, completed_on, completed_at)
      values (${t.companyId}, ${blockId}, ${stageId}, ${(i + 1) * 10}, ${["Excavation", "Foundation", "Plinth"][i]!}, ${status}::stage_status, ${i <= 1 ? "2025-06-01" : null}::date, ${i === 0 ? "2025-07-15" : null}::date, ${i === 0 ? "2025-07-15T10:00:00Z" : null}::timestamptz) returning id`;
    stageRows.push(s!);
  }
  const png = await pngBytes();
  const heroDocId = await uploadDoc(t, admin, { entity_type: "PROJECT", entity_id: projectId, title: "Hero" }, { name: `hero${opts.suffix}.png`, data: png });
  const brochureDocId = await uploadDoc(t, admin, { entity_type: "PROJECT", entity_id: projectId, title: "Brochure" }, { name: `brochure-${opts.code}.pdf`, data: PDF_BYTES });
  const websitePhotoDocId = await uploadDoc(t, admin, { entity_type: "STAGE", entity_id: stageRows[0]!.id, title: "Excavation done" }, { name: "exc.png", data: png });
  const hiddenPhotoDocId = await uploadDoc(t, admin, { entity_type: "STAGE", entity_id: stageRows[0]!.id, title: "Internal only" }, { name: "exc-internal.png", data: png });
  await t.app.sql`insert into stage_photos (company_id, block_stage_id, document_id, caption, visible_to_buyers, show_on_website, sort_order) values (${t.companyId}, ${stageRows[0]!.id}, ${websitePhotoDocId}, 'Excavation complete', true, true, 1)`;
  await t.app.sql`insert into stage_photos (company_id, block_stage_id, document_id, caption, visible_to_buyers, show_on_website, sort_order) values (${t.companyId}, ${stageRows[0]!.id}, ${hiddenPhotoDocId}, 'Internal photo', true, false, 2)`;
  const slug = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const cur = await t.request<{ version: number }>("GET", `/api/v1/projects/${projectId}/website`, { token: admin });
  if (cur.status !== 200) throw new Error(`website settings: ${cur.text}`);
  return { basics, projectId, blockId, slug, flatTypeCode, heroDocId, brochureDocId, websitePhotoDocId, hiddenPhotoDocId, flats, websiteVersion: cur.body.version };
}

/** Publishes the project with prices, availability and progress on. */
export async function publishWebProject(t: TestContext, admin: string, wp: WebProject, extra: Record<string, unknown> = {}): Promise<{ version: number }> {
  const r = await t.request<{ version: number }>("PATCH", `/api/v1/projects/${wp.projectId}/website`, {
    token: admin,
    body: { version: wp.websiteVersion, slug: wp.slug, is_published: true, show_prices: true, show_availability: true, show_progress: true, hero_document_ids: [wp.heroDocId], brochure_document_id: wp.brochureDocId, highlights: ["Vastu compliant", "Clubhouse"], faqs: [{ q: "Is the project RERA registered?", a: "Yes." }], video_urls: ["https://www.youtube.com/watch?v=abc"], ...extra },
  });
  if (r.status !== 200) throw new Error(`publish: ${r.status} ${r.text}`);
  wp.websiteVersion = r.body.version;
  return r.body;
}

/** Walks a JSON value and returns every key path that matches the predicate. */
export function findKeys(value: unknown, pred: (key: string, value: unknown) => boolean, path = ""): string[] {
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
