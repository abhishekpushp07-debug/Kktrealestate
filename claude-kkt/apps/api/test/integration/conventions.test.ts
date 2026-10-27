import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, ifMatch, versionOf, type ErrorBody, type TestContext } from "./helpers.js";

/** docs/API-CONVENTIONS.md rule by rule: envelope, headers, offset + keyset pagination on a 60-row fixture, ETag/304, CSV export. */
let t: TestContext;
let token: string;
const URL = "/api/v1/masters/spec-categories";
const TOTAL = 60;

interface Page {
  items: { id: string; name: string; sort_order: number }[];
  total: number;
  page: number;
  page_size: number;
  next_cursor: string | null;
  meta?: { total_is_estimate: boolean; total_included: boolean };
}

beforeAll(async () => {
  t = await buildTestApp();
  token = (await t.loginAs("admin")).access_token;
  // 60 rows that all tie on sort_order so keyset paging must break ties on id
  for (let i = 1; i <= TOTAL; i++) {
    const r = await t.request("POST", URL, {
      token,
      body: { name: `Category ${String(i).padStart(2, "0")}`, sort_order: 0 },
    });
    if (r.status !== 201) throw new Error(`fixture: ${r.text}`);
  }
});
afterAll(async () => {
  await t?.close();
});

async function walk(query: string, limit: number): Promise<{ ids: string[]; pages: number; totals: Set<number> }> {
  const ids: string[] = [];
  const totals = new Set<number>();
  let cursor: string | null = null;
  let pages = 0;
  for (let guard = 0; guard < 50; guard++) {
    const url = `${URL}?${query}&include_total=true&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r: { status: number; text: string; body: Page } = await t.request<Page>("GET", url, { token });
    expect(r.status, r.text).toBe(200);
    expect(r.body.items.length).toBeLessThanOrEqual(limit);
    expect(r.body.page).toBe(1);
    expect(r.body.page_size).toBe(limit);
    ids.push(...r.body.items.map((i) => i.id));
    totals.add(r.body.total);
    pages += 1;
    cursor = r.body.next_cursor;
    if (!cursor) break;
    expect(r.body.items.length, "a page that advertises a next cursor is full").toBe(limit);
  }
  return { ids, pages, totals };
}

describe("list envelope and headers", () => {
  it("every list carries exactly {items,total,page,page_size,next_cursor,meta}, X-Request-Id, ETag and honours If-None-Match", async () => {
    const r = await t.request<Page>("GET", `${URL}?page_size=10`, { token });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["items", "meta", "next_cursor", "page", "page_size", "total"]);
    expect(r.body.meta).toEqual({ total_is_estimate: false, total_included: true });
    expect(r.body.items).toHaveLength(10);
    expect(r.body.total).toBe(TOTAL);
    expect(r.body.page).toBe(1);
    expect(r.body.page_size).toBe(10);
    expect(r.body.next_cursor).toBeNull(); // offset mode never hands out cursors
    expect(r.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    expect(r.headers["etag"]).toBeTruthy();
    expect(r.headers["cache-control"]).toBe("no-store");
    const notModified = await t.request("GET", `${URL}?page_size=10`, {
      token,
      headers: { "if-none-match": String(r.headers["etag"]) },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.text).toBe("");
    const changed = await t.request("GET", `${URL}?page_size=11`, {
      token,
      headers: { "if-none-match": String(r.headers["etag"]) },
    });
    expect(changed.status).toBe(200);
    expect(changed.headers["etag"]).not.toBe(r.headers["etag"]);
    // an inbound X-Request-Id of sane shape is echoed; garbage is replaced
    const echoed = await t.request("GET", `${URL}?page_size=1`, {
      token,
      headers: { "x-request-id": "client-req-0001" },
    });
    expect(echoed.headers["x-request-id"]).toBe("client-req-0001");
    const garbage = await t.request("GET", `${URL}?page_size=1`, { token, headers: { "x-request-id": "<script>" } });
    expect(garbage.headers["x-request-id"]).not.toBe("<script>");
  });

  it("rejects unknown query keys, over-large pages and unknown sort fields with 400 VALIDATION_ERROR", async () => {
    for (const q of ["bogus=1", "page_size=201", "page=0", "sort=password_hash", "sort=1bad", "limit=0"]) {
      const r = await t.request<ErrorBody>("GET", `${URL}?${q}`, { token });
      expect(r.status, q).toBe(400);
      expect(r.body.error.code, q).toBe("VALIDATION_ERROR");
    }
  });
});

describe("pagination on a 60-row fixture", () => {
  it("offset pages partition the set without overlap and report the full total", async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await t.request<Page>("GET", `${URL}?page=${page}&page_size=25&sort=name`, { token });
      expect(r.status).toBe(200);
      expect(r.body.page).toBe(page);
      expect(r.body.total).toBe(TOTAL);
      expect(r.body.items).toHaveLength(page === 3 ? 10 : 25);
      seen.push(...r.body.items.map((i) => i.id));
    }
    expect(new Set(seen).size).toBe(TOTAL);
    const beyond = await t.request<Page>("GET", `${URL}?page=4&page_size=25`, { token });
    expect(beyond.body.items).toEqual([]);
    expect(beyond.body.total).toBe(TOTAL);
  });

  it("keyset paging visits all 60 rows exactly once on a tied sort key, in both directions, with a stable total", async () => {
    const asc = await walk("sort=sort_order", 7);
    expect(asc.ids).toHaveLength(TOTAL);
    expect(new Set(asc.ids).size).toBe(TOTAL);
    expect(asc.pages).toBe(Math.ceil(TOTAL / 7));
    expect([...asc.totals]).toEqual([TOTAL]);
    // ties break on id ascending, so the walk is the id order
    expect(asc.ids).toEqual([...asc.ids].sort());
    const desc = await walk("sort=-sort_order", 9);
    expect(desc.ids).toHaveLength(TOTAL);
    expect(new Set(desc.ids).size).toBe(TOTAL);
    expect(desc.ids).toEqual([...desc.ids].sort().reverse());
    const byName = await walk("sort=-name", 25);
    expect(byName.pages).toBe(3);
    const names = (await t.request<Page>("GET", `${URL}?page_size=200&sort=-name`, { token })).body.items.map(
      (i) => i.id,
    );
    expect(byName.ids).toEqual(names);
    // a cursor is bound to the sort it was issued for: replaying it under another sort is 400 INVALID_CURSOR, never a skewed page
    const first = await t.request<Page>("GET", `${URL}?sort=name&limit=5`, { token });
    const skewed = await t.request<ErrorBody>(
      "GET",
      `${URL}?sort=-name&limit=5&cursor=${encodeURIComponent(first.body.next_cursor!)}`,
      { token },
    );
    expect(skewed.status).toBe(400);
    expect(skewed.body.error.code).toBe("INVALID_CURSOR");
    const bad = await t.request<ErrorBody>(
      "GET",
      `${URL}?limit=5&cursor=${encodeURIComponent(Buffer.from('["x"]').toString("base64url"))}`,
      { token },
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_CURSOR");
  });

  it("malformed or tampered cursors answer 400 INVALID_CURSOR (never a 500 from a bad cast)", async () => {
    const enc = (v: unknown) => encodeURIComponent(Buffer.from(JSON.stringify(v)).toString("base64url"));
    const id = "00000000-0000-4000-8000-000000000000";
    const cases = [
      "%%%not-base64%%%",
      encodeURIComponent("bm90IGpzb24"), // "not json"
      enc({ v: 1, id }),
      enc([0, "not-a-uuid"]), // id column is a uuid
      enc(["not-a-number", id, "sort_order"]), // sort_order is an integer column
      enc([{ nested: true }, id]),
      enc([1, id, "-sort_order"]), // issued for another sort
    ];
    for (const [i, c] of cases.entries()) {
      const r = await t.request<ErrorBody>("GET", `${URL}?sort=sort_order&limit=5&cursor=${c}`, { token });
      expect(r.status, `case ${i}: ${r.text}`).toBe(400);
      expect(r.body.error.code, `case ${i}`).toBe("INVALID_CURSOR");
      expect(r.body.error.details?.["issues"], `case ${i}`).toEqual([
        expect.objectContaining({ path: "cursor", code: "invalid_cursor" }),
      ]);
    }
    // a timestamp sort with a value that is not a timestamp (the audit's SQLSTATE 22007 path)
    const ts = await t.request<ErrorBody>(
      "GET",
      `${URL}?sort=created_at&limit=5&cursor=${enc(["yesterday", id, "created_at"])}`,
      { token },
    );
    expect(ts.status, ts.text).toBe(400);
    expect(ts.body.error.code).toBe("INVALID_CURSOR");
    // the well-formed cursors of a real walk keep working
    const ok = await t.request<Page>("GET", `${URL}?sort=created_at&limit=5`, { token });
    const next = await t.request<Page>(
      "GET",
      `${URL}?sort=created_at&limit=5&cursor=${encodeURIComponent(ok.body.next_cursor!)}`,
      { token },
    );
    expect(next.status, next.text).toBe(200);
    expect(next.body.items).toHaveLength(5);
  });

  it("keyset pages skip the count unless include_total=true; offset pages always count", async () => {
    const page = await t.request<Page>("GET", `${URL}?sort=name&limit=7`, { token });
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(7);
    expect(page.body.total).toBe(7); // the rows of this page: nothing was counted
    expect(page.body.meta).toEqual({ total_is_estimate: false, total_included: false });
    expect(page.body.next_cursor).not.toBeNull();
    const counted = await t.request<Page>("GET", `${URL}?sort=name&limit=7&include_total=true`, { token });
    expect(counted.body.total).toBe(TOTAL);
    expect(counted.body.meta).toEqual({ total_is_estimate: false, total_included: true });
    const exact = await t.request<Page>("GET", `${URL}?sort=name&limit=7&exact=true`, { token });
    expect(exact.body.total).toBe(TOTAL);
    expect(exact.body.meta?.total_included).toBe(true);
  });

  it("page above the bound answers 400 with the cursor-mode hint", async () => {
    const r = await t.request<ErrorBody>("GET", `${URL}?page=1001`, { token });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(r.body.error.message).toMatch(/cursor/);
    expect(JSON.stringify(r.body.error.details)).toMatch(/next_cursor/);
  });

  it("keyset paging respects search and include_inactive filters and ends with next_cursor null", async () => {
    const first = await t.request<{ id: string; version: number }>("GET", `${URL}?page_size=1&sort=name`, { token });
    const victim = first.body as unknown as Page;
    const row = victim.items[0]!;
    expect(
      (
        await t.request("POST", `${URL}/${row.id}/deactivate`, {
          token,
          body: {},
          headers: ifMatch(await versionOf(t, `${URL}/${row.id}`, token)),
        })
      ).status,
    ).toBe(200);
    const active = await walk("sort=name", 25);
    expect(active.ids).toHaveLength(TOTAL - 1);
    expect(active.ids).not.toContain(row.id);
    const all = await walk("sort=name&include_inactive=true", 25);
    expect(all.ids).toHaveLength(TOTAL);
    const searched = await walk("sort=name&search=Category%200", 4);
    expect(searched.ids).toHaveLength(8); // 01..09 minus the deactivated 01
    const last = await t.request<Page>("GET", `${URL}?limit=200`, { token });
    expect(last.body.items).toHaveLength(TOTAL - 1);
    expect(last.body.next_cursor).toBeNull();
    expect(
      (
        await t.request("POST", `${URL}/${row.id}/activate`, {
          token,
          body: {},
          headers: ifMatch(await versionOf(t, `${URL}/${row.id}`, token)),
        })
      ).status,
    ).toBe(200);
  });
});

describe("CSV export", () => {
  it("streams the whole filtered list as an attachment, not just one page", async () => {
    const r = await t.request("GET", `${URL}?format=csv&sort=name`, { token });
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"])).toContain("text/csv");
    expect(String(r.headers["content-disposition"])).toBe('attachment; filename="spec-categories.csv"');
    const lines = r.text.trimEnd().split("\r\n");
    expect(lines).toHaveLength(TOTAL + 1);
    expect(lines[0]).toBe("name,sort_order,id,is_active,version");
    expect(lines[1]!.startsWith("Category 01,")).toBe(true);
    const filtered = await t.request("GET", `${URL}?format=csv&search=Category%201`, { token });
    expect(filtered.text.trimEnd().split("\r\n")).toHaveLength(11); // header + Category 10..19
  });
});

describe("If-Match", () => {
  it("state-change POSTs accept the expected version through If-Match and refuse a stale one", async () => {
    const list = await t.request<Page>("GET", `${URL}?page_size=1&sort=-name`, { token });
    const row = list.body.items[0]!;
    const stale = await t.request<ErrorBody>("POST", `${URL}/${row.id}/deactivate`, {
      token,
      body: {},
      headers: { "if-match": '"99"' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(1);
    const ok = await t.request<{ version: number }>("POST", `${URL}/${row.id}/deactivate`, {
      token,
      body: {},
      headers: { "if-match": '"1"' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);
    expect((await t.request("POST", `${URL}/${row.id}/activate`, { token, body: { version: 2 } })).status).toBe(200);
  });
});
