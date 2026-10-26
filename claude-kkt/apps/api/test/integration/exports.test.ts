/**
 * CSV exports (audit F5): synchronous list CSVs say when they were cut at 10,000 rows (X-Export-Truncated / X-Export-Total), and the
 * asynchronous export API (POST /exports → job EXPORT_CSV) runs any readable list route in-process as the caller, keyset-paging through
 * ALL rows into storage, with a ready bell, a signed download link and EXPORT_CLEANUP after 7 days.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, freshIp, type ErrorBody, type TestContext } from "./helpers.js";
import { startTestWorker, waitForExport, type TestWorker } from "./worker.js";

type ExportRow = { id: string; path: string; query: Record<string, unknown>; status: string; row_count: number | null; file_name: string; error: string | null; expires_at: string | null };
type Link = { download_url: string; expires_at: string; file_name: string; row_count: number };

let t: TestContext;
let admin: string;
let sales: string;
let worker: TestWorker;
const BULK = 10_050;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  sales = (await t.loginAs("sales")).access_token;
  worker = await startTestWorker(t.app);
  await t.app.sql`insert into job_runs (job_name, status, started_at, finished_at) select 'DAILY_DUES', 'OK', now() - (g || ' seconds')::interval, now() from generate_series(1, ${BULK}) g`;
  await t.app.sql`insert into job_runs (job_name, status, started_at, finished_at, error) select 'NIGHTLY_INTEGRITY', 'FAILED', now() - (g || ' seconds')::interval, now(), ${"=HYPERLINK(\"http://evil\",\"x\")"} from generate_series(1, 3) g`;
});
afterAll(async () => { await worker?.close(); await t?.close(); });

async function download(url: string): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
  const res = await t.app.inject({ method: "GET", url: url.replace(/^https?:\/\/[^/]+/, ""), headers: { "x-forwarded-for": freshIp() } });
  return { status: res.statusCode, headers: res.headers as Record<string, unknown>, text: res.body };
}

describe("synchronous CSV cap headers", () => {
  it("a CSV list above 10,000 rows says so: X-Export-Truncated: true, X-Export-Total, X-Export-Rows; smaller lists carry only the totals", async () => {
    const big = await t.request("GET", "/api/v1/admin/jobs/runs?format=csv", { token: admin });
    expect(big.status).toBe(200);
    expect(big.headers["x-export-truncated"]).toBe("true");
    expect(Number(big.headers["x-export-total"])).toBe(BULK + 3);
    expect(big.headers["x-export-rows"]).toBe("10000");
    expect(big.text.trimEnd().split("\r\n")).toHaveLength(10_001);
    const small = await t.request("GET", "/api/v1/admin/jobs/runs?format=csv&status=FAILED", { token: admin });
    expect(small.headers["x-export-truncated"]).toBeUndefined();
    expect(small.headers["x-export-total"]).toBe("3");
    // formula injection stays neutralised
    expect(small.text).toContain("'=HYPERLINK");
    const json = await t.request("GET", "/api/v1/admin/jobs/runs", { token: admin });
    expect(json.headers["x-export-total"]).toBeUndefined();
  });
});

describe("asynchronous exports", () => {
  let done: ExportRow;

  it("POST /exports queues EXPORT_CSV (202); the worker pages through ALL rows as the caller; the user gets a bell and a signed link", async () => {
    const r = await t.request<ExportRow>("POST", "/api/v1/exports", { token: admin, body: { path: "/api/v1/admin/jobs/runs", query: { status: "OK" } }, headers: { "idempotency-key": "exp-1" } });
    expect(r.status, r.text).toBe(202);
    expect(r.body).toMatchObject({ status: "QUEUED", path: "/api/v1/admin/jobs/runs", query: { status: "OK" }, row_count: null });
    expect(r.body.file_name).toMatch(/^admin-jobs-runs-\d{8}-[0-9a-f]{8}\.csv$/);
    const replay = await t.request<ExportRow>("POST", "/api/v1/exports", { token: admin, body: { path: "/api/v1/admin/jobs/runs", query: { status: "OK" } }, headers: { "idempotency-key": "exp-1" } });
    expect(replay.body.id).toBe(r.body.id);
    const fin = await waitForExport(t.app, r.body.id, 120_000);
    expect(fin.status, fin.error ?? "").toBe("DONE");
    expect(fin.row_count).toBe(BULK);
    const one = await t.request<ExportRow>("GET", `/api/v1/exports/${r.body.id}`, { token: admin });
    done = one.body;
    expect(done).toMatchObject({ status: "DONE", row_count: BULK, error: null });
    expect(new Date(done.expires_at!).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const list = await t.request<{ items: ExportRow[]; total: number }>("GET", "/api/v1/exports", { token: admin });
    expect(list.body.items.map((i) => i.id)).toEqual([done.id]);
    const bells = await t.app.sql<{ title: string }[]>`select title from notifications where type = 'EXPORT_READY' and entity_id = ${done.id}`;
    expect(bells).toHaveLength(1);

    const link = await t.request<Link>("POST", `/api/v1/exports/${done.id}/link`, { token: admin });
    expect(link.status, link.text).toBe(200);
    expect(link.body).toMatchObject({ file_name: done.file_name, row_count: BULK });
    const dl = await download(link.body.download_url);
    expect(dl.status).toBe(200);
    expect(String(dl.headers["content-type"])).toContain("text/csv");
    expect(String(dl.headers["content-disposition"])).toContain(done.file_name);
    const lines = dl.text.trimEnd().split("\r\n");
    expect(lines).toHaveLength(BULK + 1);
    expect(lines[0]).toBe("started_at,job_name,status,finished_at,error");
    expect(lines.filter((l) => l === lines[0])).toHaveLength(1); // one header even across keyset pages
    expect(new Set(lines.slice(1).map((l) => l.split(",")[0])).size).toBe(BULK); // no row twice, none skipped
    expect(lines.slice(1).every((l) => l.includes(",DAILY_DUES,OK,"))).toBe(true);
    // forged and expired links
    expect((await download(`${link.body.download_url.slice(0, -2)}xx`)).status).toBe(404);
    const audits = await t.app.sql`select 1 from audit_logs where action = 'export.create' and entity_id = ${done.id}`;
    expect(audits).toHaveLength(1);
  });

  it("validates the target: reserved keys, unknown or non-list routes, missing permission, bad filters; exports are private to their owner", async () => {
    const post = (token: string, body: unknown) => t.request<ErrorBody>("POST", "/api/v1/exports", { token, body });
    const reserved = await post(admin, { path: "/api/v1/admin/jobs/runs", query: { page_size: "5" } });
    expect(reserved.status).toBe(400);
    expect(reserved.body.error.message).toContain("page_size");
    expect((await post(admin, { path: "/api/v1/nope/nothing", query: {} })).status).toBe(400);
    expect((await post(admin, { path: "/api/v1/exports", query: {} })).status).toBe(400);
    expect((await post(admin, { path: "/api/v1/public/projects", query: {} })).status).toBe(400);
    const notList = await post(admin, { path: "/api/v1/admin/system", query: {} });
    expect(notList.status).toBe(400);
    expect(notList.body.error.message).toContain("not a list route");
    const forbidden = await post(sales, { path: "/api/v1/admin/jobs/runs", query: {} });
    expect(forbidden.status).toBe(403);
    const badFilter = await post(admin, { path: "/api/v1/admin/jobs/runs", query: { status: "BOGUS" } });
    expect(badFilter.status).toBe(400);
    expect(badFilter.body.error.code).toBe("VALIDATION_ERROR");
    expect((await post(admin, { path: "/api/v1/admin/jobs/runs?status=OK", query: {} })).status).toBe(400);
    // private to the owner
    expect((await t.request("GET", `/api/v1/exports/${done.id}`, { token: sales })).status).toBe(404);
    expect((await t.request("POST", `/api/v1/exports/${done.id}/link`, { token: sales })).status).toBe(404);
    expect((await t.request<{ items: unknown[] }>("GET", "/api/v1/exports", { token: sales })).body.items).toEqual([]);
    // not ready yet → 409
    const [queued] = await t.app.sql<{ id: string }[]>`insert into exports (company_id, user_id, path, query, status) select ${t.companyId}, id, '/api/v1/admin/jobs/runs', '{}'::jsonb, 'QUEUED' from users where email = 'admin@sgb.in' returning id`;
    const early = await t.request<ErrorBody>("POST", `/api/v1/exports/${queued!.id}/link`, { token: admin });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("EXPORT_NOT_READY");
    await t.app.sql`delete from exports where id = ${queued!.id}`;
  });

  it("the export runs as the requesting user: a user deactivated (or without the permission) by then fails it, FAILED with the reason on the last attempt", async () => {
    const role = await t.request<{ id: string }>("POST", "/api/v1/roles", { token: admin, body: { name: "Exporter", permissions: ["dashboard.view", "admin.tools", "notification.read"] } });
    const user = await t.request<{ id: string }>("POST", "/api/v1/users", { token: admin, body: { name: "Export Person", email: "exporter@sgb.in", role_id: role.body.id, all_projects: true, password: "Exporter@2025!", must_change_password: false } });
    expect(user.status, user.text).toBe(201);
    const { runCsvExport } = await import("../../src/modules/documents/index.js");
    const queue = async () => (await t.app.sql<{ id: string }[]>`insert into exports (company_id, user_id, path, query, status) values (${t.companyId}, ${user.body.id}, '/api/v1/admin/jobs/runs', '{"status":"FAILED"}'::jsonb, 'QUEUED') returning id`)[0]!.id;
    // the permission is gone → the route answers 403 inside the job
    await t.app.sql`update roles set permissions = '{dashboard.view,notification.read}' where id = ${role.body.id}`;
    await t.app.redis.flushdb();
    const noPerm = await queue();
    await expect(runCsvExport({ db: t.app.db, app: t.app, data: { export_id: noPerm }, attempt: 1, maxAttempts: 3 })).rejects.toThrow(/403/);
    expect((await t.app.sql<{ status: string }[]>`select status from exports where id = ${noPerm}`)[0]!.status).toBe("QUEUED"); // retried later
    await expect(runCsvExport({ db: t.app.db, app: t.app, data: { export_id: noPerm }, attempt: 3, maxAttempts: 3 })).rejects.toThrow(/403/);
    const [failed] = await t.app.sql<{ status: string; error: string }[]>`select status, error from exports where id = ${noPerm}`;
    expect(failed).toMatchObject({ status: "FAILED", error: expect.stringContaining("FORBIDDEN") });
    // deactivated user → no internal token is minted at all
    await t.app.sql`update users set is_active = false where id = ${user.body.id}`;
    const inactive = await queue();
    await expect(runCsvExport({ db: t.app.db, app: t.app, data: { export_id: inactive }, attempt: 3, maxAttempts: 3 })).rejects.toThrow(/no longer active/);
  });

  it("EXPORT_CLEANUP removes expired exports and their files", async () => {
    const [row] = await t.app.sql<{ storage_key: string }[]>`select storage_key from exports where id = ${done.id}`;
    const { documentStorage, cleanupExports } = await import("../../src/modules/documents/index.js");
    expect(await documentStorage().exists(row!.storage_key)).toBe(true);
    expect(await cleanupExports(t.app.db)).toMatchObject({ removed: 0 });
    await t.app.sql`update exports set expires_at = now() - interval '1 second' where id = ${done.id}`;
    expect(await cleanupExports(t.app.db)).toMatchObject({ removed: 1, file_errors: 0 });
    expect(await documentStorage().exists(row!.storage_key)).toBe(false);
    expect((await t.request("GET", `/api/v1/exports/${done.id}`, { token: admin })).status).toBe(404);
  });
});
