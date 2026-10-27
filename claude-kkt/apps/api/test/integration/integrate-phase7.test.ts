import type { InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { buildTestApp, type TestContext } from "./helpers.js";

/**
 * Phase 7 integration (docs/hardening/phase7-integrate.md): the cross-track items the tracks and reviews left open, each pinned here
 * unless it belongs to an existing suite (portal ledger → portal.test.ts, recompute actor → admin.test.ts, cancellations report →
 * money-ledger-record.test.ts, media stand-in cache → web-adversarial.test.ts).
 */

let t: TestContext;

beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(async () => {
  await t?.close();
});

/** Temporarily overrides config values (the config object is read per request). */
async function withConfig<T>(patch: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const c = config as unknown as Record<string, unknown>;
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, c[k]]));
  Object.assign(c, patch);
  try {
    return await fn();
  } finally {
    Object.assign(c, before);
  }
}

describe("CORS for cookie sessions and the tenant header (contracts C1, C4)", () => {
  it("a preflight from the ERP origin allows credentials, X-KKT-Session and x-kkt-company", async () => {
    const r = await t.app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: config.ERP_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-kkt-session,x-kkt-company",
      },
    });
    expect(r.statusCode).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe(config.ERP_ORIGIN);
    expect(r.headers["access-control-allow-credentials"]).toBe("true");
    const allowed = String(r.headers["access-control-allow-headers"])
      .toLowerCase()
      .split(/\s*,\s*/);
    expect(allowed).toEqual(expect.arrayContaining(["x-kkt-session", "x-kkt-company", "if-match", "idempotency-key"]));
  });

  it("a credentialed request from the portal origin is answered with its origin (never *); an unknown origin gets no CORS grant", async () => {
    const ok = await t.app.inject({
      method: "GET",
      url: "/api/v1/health/live",
      headers: { origin: config.PORTAL_ORIGIN },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe(config.PORTAL_ORIGIN);
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await t.app.inject({
      method: "GET",
      url: "/api/v1/health/live",
      headers: { origin: "https://evil.example" },
    });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("public rate limits (contract C3): probes and the website server's own calls", () => {
  it("health and readiness probes are never rate-limited", async () => {
    await withConfig({ PUBLIC_RATE_LIMIT_PER_MIN: 2 }, async () => {
      const ip = "10.251.0.1";
      for (const url of ["/api/v1/health/live", "/health/live", "/api/v1/health/ready", "/api/v1/ready", "/ready"]) {
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) statuses.push((await t.request("GET", url, { ip })).status);
        expect(statuses, url).not.toContain(429);
      }
      // ordinary catalog reads from the same IP still are
      const catalog: number[] = [];
      for (let i = 0; i < 4; i++) catalog.push((await t.request("GET", "/api/v1/public/site", { ip })).status);
      expect(catalog).toContain(429);
    });
  });

  it("ISR calls (valid internal token, no visitor IP) use their own larger budget, not the web server IP's visitor bucket", async () => {
    const token = "internal-token-for-integration-0123456789";
    await withConfig(
      { PUBLIC_RATE_LIMIT_PER_MIN: 3, INTERNAL_RATE_LIMIT_PER_MIN: 8, INTERNAL_API_TOKEN: token },
      async () => {
        const nextIp = "10.251.0.2"; // the Next.js server
        const statuses = async (headers: Record<string, string>, n: number) => {
          const out: number[] = [];
          for (let i = 0; i < n; i++)
            out.push((await t.request("GET", "/api/v1/public/site", { ip: nextIp, headers })).status);
          return out;
        };
        // 6 regenerations: above the per-IP budget (3), within the internal one (8)
        expect(await statuses({ "x-kkt-internal-token": token }, 6)).not.toContain(429);
        // the visitor bucket of the Next server's own IP is untouched by them
        expect(await statuses({}, 3)).not.toContain(429);
        // the internal budget is a budget too
        expect(await statuses({ "x-kkt-internal-token": token }, 4)).toContain(429);
        // a wrong token is an ordinary caller from the Next server IP (bucket already spent above)
        expect(await statuses({ "x-kkt-internal-token": "wrong" }, 1)).toEqual([429]);
      },
    );
  });
});

describe("DPDP erasure vs work in flight (security / platform review cross-track items)", () => {
  async function newCustomer(name: string, phone: string): Promise<string> {
    const admin = (await t.loginAs("admin")).access_token;
    const r = await t.request<{ id: string }>("POST", "/api/v1/customers", {
      token: admin,
      body: { full_name: name, phone, co_applicants: [] },
    });
    expect(r.status, r.text).toBe(201);
    return r.body.id;
  }
  async function erase(customerId: string, key: string) {
    const admin = (await t.loginAs("admin")).access_token;
    return t.request("POST", `/api/v1/admin/customers/${customerId}/erase`, {
      token: admin,
      body: { confirm: "ERASE" },
      headers: { "idempotency-key": key },
    });
  }
  async function queueCustomerExport(): Promise<string> {
    const admin = (await t.loginAs("admin")).access_token;
    const created = await t.request<{ id: string }>("POST", "/api/v1/exports", {
      token: admin,
      body: { path: "/api/v1/customers", query: {} },
    });
    expect(created.status, created.text).toBe(202);
    return created.body.id;
  }

  it("a queued export is withdrawn by an erasure and its job then builds nothing", async () => {
    const { runCsvExport } = await import("../../src/modules/documents/exports.js");
    const customerId = await newCustomer("Queued Export Person", "9700030001");
    const exportId = await queueCustomerExport();
    const r = await erase(customerId, "integrate-erase-queued");
    expect(r.status, r.text).toBe(200);
    const [row] = await t.app.sql<{ status: string }[]>`select status from exports where id = ${exportId}`;
    expect(row!.status).toBe("FAILED");
    const out = await runCsvExport({
      db: t.app.db,
      app: t.app,
      data: { export_id: exportId },
      attempt: 1,
      maxAttempts: 3,
    });
    expect(out).toMatchObject({ skipped: true });
    const [after] = await t.app.sql<{ status: string; storage_key: string | null }[]>`
      select status, storage_key from exports where id = ${exportId}`;
    expect(after).toEqual({ status: "FAILED", storage_key: null });
  });

  it("an export RUNNING when the customer is erased is never published: its file is queued for deletion and the export stays withdrawn", async () => {
    const { runCsvExport } = await import("../../src/modules/documents/exports.js");
    const svc = await import("../../src/modules/documents/service.js");
    const customerId = await newCustomer("Running Export Person", "9700030002");
    const exportId = await queueCustomerExport();
    let erased = false;
    // the erasure lands while the job is reading its pages (between its first page request and its completion)
    const app = new Proxy(t.app, {
      get(target, prop, receiver) {
        if (prop !== "inject") return Reflect.get(target, prop, receiver) as unknown;
        return async (opts: InjectOptions) => {
          const res = await target.inject(opts);
          if (!erased) {
            erased = true;
            const r = await erase(customerId, "integrate-erase-running");
            expect(r.status, r.text).toBe(200);
          }
          return res;
        };
      },
    });
    const out = await runCsvExport({ db: t.app.db, app, data: { export_id: exportId }, attempt: 1, maxAttempts: 3 });
    expect(erased).toBe(true);
    expect(out).toMatchObject({ withdrawn: true });
    const [row] = await t.app.sql<{ status: string; storage_key: string | null; company_id: string }[]>`
      select status, storage_key, company_id from exports where id = ${exportId}`;
    expect(row).toMatchObject({ status: "FAILED", storage_key: null });
    const key = `exports/${row!.company_id}/${exportId}.csv`;
    const queued = await t.app.sql<{ reason: string }[]>`select reason from storage_deletions where key = ${key}`;
    expect(queued.map((q) => q.reason)).toEqual(["EXPORT_WITHDRAWN"]);
    expect(await svc.storage().exists(key)).toBe(false);
    // no "export ready" bell for a withdrawn export
    const bells = await t.app.sql<{ n: number }[]>`
      select count(*)::int as n from notifications where type = 'EXPORT_READY' and entity_id = ${exportId}`;
    expect(bells[0]!.n).toBe(0);
  });

  it("an erasure waits for a rendition run committing its keys, so the erased customer's renditions are queued for deletion too", async () => {
    const customerId = await newCustomer("Rendition Race Person", "9700030003");
    const [doc] = await t.app.sql<{ id: string }[]>`
      insert into documents (company_id, entity_type, entity_id, title, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, variants)
      values (${t.companyId}, 'CUSTOMER', ${customerId}, 'PAN scan', 'pan.png', 'image/png', 10, 'x', ${`documents/${customerId}/pan.png`},
        'STAFF', '{"renditions": "PENDING"}'::jsonb) returning id`;
    const thumb = `documents/${customerId}/pan_thumb_race.webp`;
    const conn = await t.app.sql.reserve();
    let erasure: Promise<Awaited<ReturnType<typeof erase>>> | undefined;
    try {
      await conn`begin`;
      // the DOCUMENT_RENDITIONS run records its keys (row locked, not committed yet)
      await conn`update documents set variants = variants || ${JSON.stringify({ thumb_key: thumb, renditions: "READY" })}::jsonb
        where id = ${doc!.id}`;
      erasure = erase(customerId, "integrate-erase-rendition");
      // wait until the erasure is blocked on that row
      for (let i = 0; i < 100; i++) {
        const [w] = await t.app.sql<{ n: number }[]>`
          select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`;
        if (w!.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await conn`commit`;
    } finally {
      conn.release();
    }
    const r = await erasure!;
    expect(r.status, r.text).toBe(200);
    const queued = await t.app.sql<{ key: string }[]>`select key from storage_deletions where key = ${thumb}`;
    expect(queued).toHaveLength(1);
  });
});

describe("DPDP erasure and the idempotency store (security review cross-track item 4)", () => {
  it("stored responses naming the erased customer lose their body; a replay answers 410 GONE and never re-runs the create", async () => {
    const admin = (await t.loginAs("admin")).access_token;
    const body = {
      full_name: "Idem Erase Person",
      phone: "9700030009",
      email: "idem.erase@kkt.example.in",
      co_applicants: [],
    };
    const headers = { "idempotency-key": "integrate-idem-erase-create" };
    const created = await t.request<{ id: string }>("POST", "/api/v1/customers", { token: admin, body, headers });
    expect(created.status, created.text).toBe(201);
    const [stored] = await t.app.sql<{ body: string }[]>`
      select response_body::text as body from idempotency_keys where key = ${headers["idempotency-key"]}`;
    expect(stored!.body).toContain("9700030009".slice(-4)); // the customer's row (masked or not) is in the store
    const r = await t.request("POST", `/api/v1/admin/customers/${created.body.id}/erase`, {
      token: admin,
      body: { confirm: "ERASE" },
      headers: { "idempotency-key": "integrate-idem-erase" },
    });
    expect(r.status, r.text).toBe(200);
    const [after] = await t.app.sql<{ body: Record<string, unknown> }[]>`
      select response_body as body from idempotency_keys where key = ${headers["idempotency-key"]}`;
    expect(after!.body).toEqual({ __kkt_erased: true, original_status: 201 });
    const replay = await t.request<{ error: { code: string } }>("POST", "/api/v1/customers", {
      token: admin,
      body,
      headers,
    });
    expect(replay.status).toBe(410);
    expect(replay.body.error.code).toBe("GONE");
    expect(replay.text).not.toContain("Idem Erase Person");
    const [n] = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from customers where full_name = 'Idem Erase Person'`;
    expect(n!.n).toBe(0);
  });
});

describe("online migration additions (phase 7 integration)", () => {
  const onlineFile = new URL("../../../../packages/db/src/sql/online/0005_indexes.sql", import.meta.url);

  it("documents are found by storage / rendition key through indexes (STORAGE_SWEEP, discardStagedUpload)", async () => {
    const idx = await t.app.sql<{ indexname: string }[]>`
      select indexname from pg_indexes where tablename = 'documents'
        and indexname in ('documents_storage_key_idx', 'documents_thumb_key_idx', 'documents_medium_key_idx') order by 1`;
    expect(idx.map((r) => r.indexname)).toEqual([
      "documents_medium_key_idx",
      "documents_storage_key_idx",
      "documents_thumb_key_idx",
    ]);
    const plan = await t.app.sql.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      const rows = await tx.unsafe<{ "QUERY PLAN": string }[]>(`explain
        select p.key from storage_pending_objects p
        where exists (select 1 from documents d where d.storage_key = p.key)
           or exists (select 1 from documents d where d.variants ->> 'thumb_key' = p.key)
           or exists (select 1 from documents d where d.variants ->> 'medium_key' = p.key)`);
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    expect(plan).toMatch(/documents_storage_key_idx/);
    expect(plan).toMatch(/documents_thumb_key_idx/);
    expect(plan).toMatch(/documents_medium_key_idx/);
    expect(plan).not.toMatch(/Seq Scan on documents/);
  });

  it("re-applying the online file pauses the SLA of tickets that were AWAITING_CUSTOMER before the pause existed, and only those", async () => {
    const { readFile } = await import("node:fs/promises");
    const { applyOnlineSql } = await import("@kkt/db");
    const [cust] = await t.app.sql<{ id: string }[]>`
      insert into customers (company_id, customer_code, full_name, phone) values (${t.companyId}, 'C-SLA-1', 'Sla Person', '9700030100')
      returning id`;
    const [cat] = await t.app.sql<{ id: string }[]>`
      insert into service_categories (company_id, name) values (${t.companyId}, 'SLA backfill') returning id`;
    const waiting = await t.app.sql<{ id: string }[]>`
      insert into service_requests (company_id, ticket_number, customer_id, category_id, subject, status, sla_due_at, updated_at)
      values (${t.companyId}, 'SR-SLA/0001', ${cust!.id}, ${cat!.id}, 'Waiting', 'AWAITING_CUSTOMER', now() + interval '1 day',
              now() - interval '3 hours'),
             (${t.companyId}, 'SR-SLA/0002', ${cust!.id}, ${cat!.id}, 'Working', 'IN_PROGRESS', now() + interval '1 day',
              now() - interval '3 hours')
      returning id`;
    const before = await t.app.sql<{ id: string; updated_at: Date }[]>`
      select id, updated_at from service_requests where id in ${t.app.sql(waiting.map((w) => w.id))}`;
    await applyOnlineSql(t.app.sql, await readFile(onlineFile, "utf8"));
    const rows = await t.app.sql<{ id: string; ticket_number: string; sla_paused_at: Date | null }[]>`
      select id, ticket_number, sla_paused_at from service_requests
      where id in ${t.app.sql(waiting.map((w) => w.id))} order by ticket_number`;
    // the pause starts at the ticket's last update before the backfill (the updated_at trigger moves updated_at itself)
    const startedAt = new Map(before.map((b) => [b.id, new Date(b.updated_at).getTime()]));
    expect(
      rows.map((r) => [r.ticket_number, r.sla_paused_at === null ? null : new Date(r.sla_paused_at).getTime()]),
    ).toEqual([
      ["SR-SLA/0001", startedAt.get(rows[0]!.id)],
      ["SR-SLA/0002", null],
    ]);
  });
});

describe("heavy jobs stop on their signal and resume from checkpoints (contract C8, platform track need 3)", () => {
  it("LEDGER_REBUILD saves a checkpoint per batch; an interrupted run resumes after the last finished batch", async () => {
    const { createProject, createPortalCustomer } = await import("./fixtures.js");
    const { createActiveBooking } = await import("./fixtures/crm.js");
    const { rebuildAllLedgers } = await import("../../src/modules/money/services/ledgerRebuild.js");
    const projectId = await createProject(t, "Rebuild Resume", "RBR");
    for (let i = 0; i < 3; i++) {
      const c = await createPortalCustomer(t, { phone: `97000302${i}0`, name: `Rebuild Owner ${i}` });
      await createActiveBooking(t, c.customerId, projectId);
    }
    const [counted] = await t.app.sql<{ n: number }[]>`
      select count(*)::int as n from bookings where company_id = ${t.companyId}`;
    const n = counted!.n;
    const abort = new AbortController();
    let saved: Record<string, unknown> | null = null;
    await expect(
      rebuildAllLedgers(t.app.db, {
        companyId: t.companyId,
        dryRun: true,
        batchSize: 1,
        signal: abort.signal,
        saveCheckpoint: async (cp) => {
          saved = cp;
          abort.abort(new Error("worker shutdown"));
        },
      }),
    ).rejects.toThrow(/worker shutdown/);
    expect(saved).toMatchObject({ result: { bookings_checked: 1, batches: 1 } });
    const out = await rebuildAllLedgers(t.app.db, {
      companyId: t.companyId,
      dryRun: true,
      batchSize: 1,
      checkpoint: saved,
    });
    expect(out.bookings_checked).toBe(n); // every booking exactly once across both attempts
    // a checkpoint of a different mode (real run vs dry run) is not reused
    const fresh = await rebuildAllLedgers(t.app.db, { companyId: t.companyId, batchSize: 1, checkpoint: saved });
    expect(fresh.bookings_checked).toBe(n);
  });

  it("REENCRYPT_FIELDS stops on its signal and resumes from its checkpoint (finished tables are skipped, counts carried)", async () => {
    const { reencryptFields } = await import("../../src/modules/auth/reencrypt.js");
    const abort = new AbortController();
    abort.abort(new Error("worker shutdown"));
    await expect(reencryptFields(t.app.db, { signal: abort.signal })).rejects.toThrow(/worker shutdown/);
    const out = await reencryptFields(t.app.db, {
      checkpoint: {
        pass: "rehash",
        table: "customers",
        last_id: "00000000-0000-0000-0000-000000000000",
        updated: { customers: 5, co_applicants: 1, bank_accounts: 0, users: 2 },
        failed: { customers: 0, co_applicants: 0, bank_accounts: 0, users: 0 },
        rehashed: {},
      },
    });
    // the encryption pass had finished in the interrupted attempt: nothing re-walked, its counts carried over
    expect(out.updated).toEqual({ customers: 5, co_applicants: 1, bank_accounts: 0, users: 2 });
  });

  it("BACKUP_EXPORT's archive writer stops on its signal (one snapshot: a new attempt starts a fresh one)", async () => {
    const { writeBackupArchive } = await import("../../src/modules/admin/backup.js");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const abort = new AbortController();
    abort.abort(new Error("worker shutdown"));
    await expect(
      writeBackupArchive(t.app.db, join(mkdtempSync(join(tmpdir(), "kkt-integrate-")), "b.zip"), {
        companyId: t.companyId,
        companyName: "Test",
        includeSensitive: false,
        signal: abort.signal,
      }),
    ).rejects.toThrow(/worker shutdown/);
  });
});

describe("Swagger UI document (platform track need 1b)", () => {
  it("/api/v1/docs/json is the same enriched document as /api/v1/openapi.json (operationIds, components, error responses)", async () => {
    await withConfig({ DOCS_PUBLIC: true }, async () => {
      type Doc = {
        paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
      };
      const ui = await t.request<Doc & { components?: { schemas?: Record<string, unknown> } }>(
        "GET",
        "/api/v1/docs/json",
      );
      const api = await t.request<Doc>("GET", "/api/v1/openapi.json");
      expect(ui.status).toBe(200);
      expect(api.status).toBe(200);
      expect(ui.body.components?.schemas?.["ApiError"]).toBeDefined();
      const op = ui.body.paths["/api/v1/customers"]?.["get"];
      expect(op?.operationId).toBeTruthy();
      expect(Object.keys(op?.responses ?? {})).toEqual(expect.arrayContaining(["200", "401", "403"]));
      expect(ui.body.paths).toEqual(api.body.paths);
    });
  });
});
