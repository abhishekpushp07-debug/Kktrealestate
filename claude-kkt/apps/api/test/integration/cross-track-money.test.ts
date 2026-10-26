import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries, type DB } from "@kkt/db";
import { addDays, todayIST } from "@kkt/domain";
import { hasJob, runJob } from "../../src/jobs/index.js";
import { csvExportLimits, CSV_EXPORT_MAX_ROWS, CSV_EXPORT_PAGE_ROWS } from "../../src/lib/list.js";
import { rebuild, runReport } from "../../src/modules/money/index.js";
import { createMoneyWorld, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, freshIp, type ErrorBody, type TestContext } from "./helpers.js";
import { startTestWorker, waitForExport, waitForRun, type TestWorker } from "./worker.js";

/**
 * Cross-track fixes, money side: paginated report CSVs carry X-Export-* and export asynchronously past the cap (item 6), LEDGER_REBUILD
 * brings legacy ledgers into canonical order (item 7), and the integrity report reads each booking on one snapshot so a concurrent
 * payment cannot fake a SUMMARY_MISMATCH (item 8).
 */
const L = 10_000_000;
const CR = 100 * L;

let t: TestContext;
let admin: string;
let accounts: string;
let sales: string;
let w: MoneyWorld;
let worker: TestWorker;
let today: string;
let n = 0;
const key = () => `xtm-${Date.now()}-${++n}`;

type ExportRow = { id: string; status: string; row_count: number | null; error: string | null };
type LedgerRow = { seq: number; event: string; ref_id: string | null; total_due_paise: number };

async function book(flat: string, customer: string, daysAgo = 30): Promise<{ id: string; booking_number: string }> {
  const r = await t.request<{ id: string; booking_number: string }>("POST", "/api/v1/bookings", {
    token: sales,
    headers: { "idempotency-key": key() },
    body: {
      flat_id: w.sgh.flats.get(flat)!.id,
      customer_id: customer,
      booking_date: addDays(today, -daysAgo),
      agreement_value_paise: CR,
      cash_agreed_paise: 60 * L,
      account_agreed_paise: 40 * L,
      plan_acceptance_mode: "IN_PERSON",
      plan_accepted_on: addDays(today, -daysAgo),
    },
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
}

function cheque(bookingId: string, i: number, amount = L / 10): Promise<{ status: number; text: string }> {
  return t.request("POST", "/api/v1/payments", {
    token: accounts,
    headers: { "idempotency-key": key() },
    body: {
      booking_id: bookingId,
      against: "FLAT_VALUE",
      bucket: "ACCOUNT",
      amount_paise: amount,
      payment_date: addDays(today, -10),
      payment_mode_id: w.modes.CHEQUE,
      bank_account_id: w.bankAccountId,
      instrument: {
        number: `CHQ-${String(i).padStart(4, "0")}`,
        date: addDays(today, -10 + (i % 5)),
        bank_name: "SBI",
      },
    },
  });
}

function cash(bookingId: string, amount: number, daysAgo: number): Promise<{ status: number; text: string }> {
  return t.request("POST", "/api/v1/payments", {
    token: accounts,
    headers: { "idempotency-key": key() },
    body: {
      booking_id: bookingId,
      against: "FLAT_VALUE",
      bucket: "CASH",
      amount_paise: amount,
      payment_date: addDays(today, -daysAgo),
      payment_mode_id: w.modes.CASH,
    },
  });
}

async function ledgerOf(id: string): Promise<LedgerRow[]> {
  const r = await t.request<{ items: LedgerRow[] }>("GET", `/api/v1/bookings/${id}/ledger?page_size=200`, {
    token: admin,
  });
  expect(r.status, r.text).toBe(200);
  return r.body.items;
}

async function integrity(
  bookingId?: string,
): Promise<{ ok: boolean; findings: { type: string; booking_id: string; detail: string }[] }> {
  const r = await t.request<{ ok: boolean; findings: { type: string; booking_id: string; detail: string }[] }>(
    "GET",
    `/api/v1/dues/integrity${bookingId ? `?booking_id=${bookingId}` : ""}`,
    { token: admin },
  );
  expect(r.status, r.text).toBe(200);
  return r.body;
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  admin = (await t.loginAs("admin")).access_token;
  accounts = (await t.loginAs("accounts")).access_token;
  sales = (await t.loginAs("sales")).access_token;
  w = await createMoneyWorld(t, admin);
  worker = await startTestWorker(t.app);
});
afterEach(() => {
  csvExportLimits.maxRows = CSV_EXPORT_MAX_ROWS;
  csvExportLimits.pageRows = CSV_EXPORT_PAGE_ROWS;
});
afterAll(async () => {
  await worker?.close();
  await t?.close();
});

// ---------------------------------------------------------------------------
describe("item 6: paginated reports export like every other list (X-Export-* and async export past the cap)", () => {
  async function exportAll(path: string, query: Record<string, string>): Promise<{ row: ExportRow; lines: string[] }> {
    const r = await t.request<ExportRow & ErrorBody>("POST", "/api/v1/exports", {
      token: admin,
      body: { path, query },
      headers: { "idempotency-key": key() },
    });
    expect(r.status, r.text).toBe(202);
    const fin = await waitForExport(t.app, r.body.id, 60_000);
    expect(fin.status, fin.error ?? "").toBe("DONE");
    const link = await t.request<{ download_url: string }>("POST", `/api/v1/exports/${r.body.id}/link`, {
      token: admin,
    });
    const dl = await t.app.inject({
      method: "GET",
      url: link.body.download_url.replace(/^https?:\/\/[^/]+/, ""),
      headers: { "x-forwarded-for": freshIp() },
    });
    expect(dl.statusCode).toBe(200);
    return { row: { ...r.body, ...fin }, lines: dl.body.trimEnd().split("\r\n") };
  }

  it("cheques in hand: the CSV says it was cut at the cap, and POST /exports pages through every cheque (no duplicate, none skipped)", async () => {
    const b = await book("A-201", w.customers[0]!);
    for (let i = 1; i <= 7; i += 1) {
      const r = await cheque(b.id, i);
      expect(r.status, r.text).toBe(201);
    }
    csvExportLimits.maxRows = 3;
    csvExportLimits.pageRows = 2;
    const csv = await t.request("GET", "/api/v1/reports/cheques?status=PENDING&format=csv", { token: admin });
    expect(csv.status, csv.text).toBe(200);
    expect(csv.headers["x-export-total"]).toBe("7");
    expect(csv.headers["x-export-rows"]).toBe("3");
    expect(csv.headers["x-export-truncated"]).toBe("true");
    expect(csv.text.trimEnd().split("\r\n")).toHaveLength(4);
    // the legacy `export=CSV` spelling is the same export
    expect(
      (await t.request("GET", "/api/v1/reports/cheques?status=PENDING&export=CSV", { token: admin })).headers[
        "x-export-truncated"
      ],
    ).toBe("true");
    // JSON is not an export
    expect(
      (await t.request("GET", "/api/v1/reports/cheques?status=PENDING", { token: admin })).headers["x-export-total"],
    ).toBeUndefined();

    const all = await exportAll("/api/v1/reports/cheques", { status: "PENDING" });
    expect(all.row.row_count).toBe(7);
    expect(all.lines).toHaveLength(8);
    const numbers = all.lines.slice(1).map((l) => /CHQ-\d{4}/.exec(l)?.[0]);
    expect(new Set(numbers).size).toBe(7);
  });

  it("activity report (audit rows and failed logins): headers at the cap and a complete async export", async () => {
    for (let i = 0; i < 6; i += 1)
      await t.request("POST", "/api/v1/auth/login", {
        ip: freshIp(),
        body: { email: `nobody${i}@example.in`, password: "wrong-wrong-1" },
      });
    csvExportLimits.maxRows = 3;
    csvExportLimits.pageRows = 2;
    for (const kind of ["AUDIT", "FAILED_LOGIN"]) {
      const csv = await t.request("GET", `/api/v1/reports/activity?kind=${kind}&format=csv`, { token: admin });
      expect(csv.status, csv.text).toBe(200);
      const total = Number(csv.headers["x-export-total"]);
      expect(total, kind).toBeGreaterThan(3);
      expect(csv.headers["x-export-rows"]).toBe("3");
      expect(csv.headers["x-export-truncated"]).toBe("true");
      const all = await exportAll("/api/v1/reports/activity", { kind });
      // rows can only have been added since the synchronous count (this test's own exports write audit rows)
      expect(all.row.row_count!, kind).toBeGreaterThanOrEqual(total);
      expect(all.lines.length - 1).toBe(all.row.row_count);
      expect(new Set(all.lines.slice(1)).size, `${kind}: duplicate rows`).toBe(all.row.row_count);
    }
  });
});

// ---------------------------------------------------------------------------
describe("item 7: LEDGER_REBUILD brings legacy ledgers into canonical order", () => {
  it("reports the bookings whose row order changed, rewrites only those (audited), and a second run is a no-op", async () => {
    expect(hasJob("LEDGER_REBUILD")).toBe(true);
    const legacy = await book("A-202", w.customers[1]!);
    const clean = await book("A-203", w.customers[2]!);
    expect((await cash(legacy.id, 2 * L, 5)).status).toBe(201);
    expect((await cash(legacy.id, 3 * L, 2)).status).toBe(201);
    expect((await cash(clean.id, L, 3)).status).toBe(201);
    const canonical = await ledgerOf(legacy.id);
    expect(canonical.length).toBeGreaterThanOrEqual(3);
    // simulate a ledger written by the old business-date order: the last two rows swapped
    const last = canonical.length;
    await t.app.sql.begin(async (tx) => {
      await tx`update ledger_entries set seq = -seq where booking_id = ${legacy.id} and seq in (${last - 1}, ${last})`;
      await tx`update ledger_entries set seq = case seq when ${-(last - 1)}::int then ${last}::int else ${last - 1}::int end where booking_id = ${legacy.id} and seq < 0`;
    });
    const before = await integrity(legacy.id);
    expect(before.findings.map((f) => f.type)).toContain("SUMMARY_MISMATCH");

    // dry run through the admin API + worker: reported, nothing written
    const dry = await t.request<{ run_id: string }>("POST", "/api/v1/admin/jobs/LEDGER_REBUILD/run", {
      token: admin,
      body: { data: { dry_run: true } },
    });
    expect(dry.status, dry.text).toBe(202);
    const dryRun = await waitForRun(t.app, dry.body.run_id, 60_000);
    expect(dryRun.status, dryRun.error ?? "").toBe("OK");
    expect(dryRun.result).toMatchObject({
      dry_run: true,
      bookings_rebuilt: 0,
      order_changed_count: 1,
      order_changed: [{ booking_id: legacy.id, booking_number: legacy.booking_number, first_position: last - 1 }],
    });
    expect((await integrity(legacy.id)).ok).toBe(false);

    const real = await runJob(t.app.db, "LEDGER_REBUILD", { batch_size: 1 });
    expect(real.result).toMatchObject({
      dry_run: false,
      bookings_rebuilt: 1,
      order_changed_count: 1,
      figures_changed_count: 0,
    });
    expect(real.result["batches"] as number).toBeGreaterThanOrEqual(2);
    expect((real.result["order_changed"] as { booking_id: string }[]).map((c) => c.booking_id)).toEqual([legacy.id]);
    expect(real.result["bookings_checked"]).toBe(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from bookings`)[0]!.n,
    );
    expect((await ledgerOf(legacy.id)).map((r) => [r.seq, r.event, r.ref_id, r.total_due_paise])).toEqual(
      canonical.map((r) => [r.seq, r.event, r.ref_id, r.total_due_paise]),
    );
    expect((await integrity()).ok).toBe(true);
    const audit = await t.app.sql<
      { entity_id: string; after: { order_changed: boolean } }[]
    >`select entity_id, after from audit_logs where action = 'booking.ledger_rebuilt'`;
    expect(audit).toEqual([
      { entity_id: legacy.id, after: expect.objectContaining({ order_changed: true, first_position: last - 1 }) },
    ]);

    const again = await runJob(t.app.db, "LEDGER_REBUILD");
    expect(again.result).toMatchObject({ bookings_rebuilt: 0, order_changed_count: 0, figures_changed_count: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("item 8: the integrity check reads each booking on one snapshot", () => {
  /**
   * A DB handle whose `select … from ledger_entries` first waits for `gate()` — a payment posted through the API on another connection
   * and committed — exactly between the reads of the source rows and the stored ledger rows of a check.
   */
  function gatedDb(db: DB, gate: () => Promise<void>): DB {
    let fired = false;
    const wrapSelect =
      (target: DB) =>
      (...args: unknown[]) => {
        const builder = (
          target.select as (...a: unknown[]) => {
            from: (table: unknown) => { execute: (...x: unknown[]) => Promise<unknown> };
          }
        )(...args);
        const from = builder.from.bind(builder);
        builder.from = (table: unknown) => {
          const q = from(table);
          if (table === ledgerEntries && !fired) {
            const execute = q.execute.bind(q);
            q.execute = async (...x: unknown[]) => {
              if (!fired) {
                fired = true;
                await gate();
              }
              return execute(...x);
            };
          }
          return q;
        };
        return builder;
      };
    const wrap = <T extends object>(target: T): T =>
      new Proxy(target, {
        get(obj, prop, receiver) {
          if (prop === "select") return wrapSelect(obj as unknown as DB);
          if (prop === "transaction") {
            return (fn: (tx: unknown) => Promise<unknown>, cfg?: unknown) =>
              (obj as unknown as DB).transaction((tx) => fn(wrap(tx)), cfg as never);
          }
          const v = Reflect.get(obj, prop, receiver) as unknown;
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(obj) : v;
        },
      });
    return wrap(db);
  }

  it("a payment committing between the reads produces a mismatch without a snapshot (control), and none with the snapshot report", async () => {
    const b = await book("A-301", w.customers[3]!);
    expect((await cash(b.id, L, 4)).status).toBe(201);
    expect((await integrity(b.id)).ok).toBe(true);
    let paid = 0;
    const pay = async () => {
      const r = await cash(b.id, L / 2, 1);
      expect(r.status, r.text).toBe(201);
      paid += 1;
    };

    // control: the plain rebuild reads source rows and stored rows in separate snapshots → the concurrent payment shows as a row difference
    const control = await rebuild(gatedDb(t.app.db, pay), b.id);
    expect(paid).toBe(1);
    expect(control.rowMismatches.length + control.mismatches.length).toBeGreaterThan(0);

    // the report: REPEATABLE READ, READ ONLY per booking → the payment committed midway is simply not part of this check
    const { report } = await runReport(
      gatedDb(t.app.db, pay),
      { companyId: t.companyId, bookingId: b.id },
      { persist: false },
    );
    expect(paid).toBe(2);
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.bookings_checked).toBe(1);
    // and the next report sees both payments, still consistent
    expect((await integrity(b.id)).ok).toBe(true);
    expect((await ledgerOf(b.id)).filter((r) => r.event === "PAYMENT")).toHaveLength(3);
  });

  it("the snapshot is read-only: a check can never write", async () => {
    const { onSnapshot } = await import("../../src/modules/money/index.js");
    const { sql } = await import("drizzle-orm");
    const err = (await onSnapshot(t.app.db, async (tx) => tx.execute(sql`update companies set name = name`)).catch(
      (e: unknown) => e,
    )) as { cause?: { code?: string; message?: string } };
    expect(err.cause?.code).toBe("25006");
    expect(err.cause?.message).toMatch(/read-only transaction/);
  });
});
