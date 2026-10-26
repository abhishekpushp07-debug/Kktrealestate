/**
 * packages/db/partitions on a scratch database: the opt-in scripts turn audit_logs, ledger_entries, login_events and notifications into
 * monthly range partitions without copying rows, keep every guard (append-only triggers incl. TRUNCATE on each partition, the ledger's
 * one-seq-per-booking rule), survive a re-run of the migrations and of themselves, and PARTITION_MAINTENANCE creates the coming months
 * only when PARTITIONING_ENABLED=true.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations, type DbHandle } from "@kkt/db";
import { TEST_DATABASE_URL } from "./helpers.js";

const PARTITIONS = fileURLToPath(new URL("../../../../packages/db/partitions/", import.meta.url));
const url = (() => {
  const u = new URL(TEST_DATABASE_URL);
  u.pathname = `/${u.pathname.slice(1)}_part`;
  return u.toString();
})();
const TABLES = ["audit_logs", "ledger_entries", "login_events", "notifications"];

let pg: Sql;
let handle: DbHandle;
let companyId: string;
let bookingId: string;

async function admin(statement: string): Promise<void> {
  const u = new URL(url);
  u.pathname = "/postgres";
  const a = postgres(u.toString(), { max: 1, onnotice: () => undefined });
  try {
    await a.unsafe(statement);
  } finally {
    await a.end({ timeout: 5 });
  }
}

async function applyScripts(): Promise<string[]> {
  const text = ["001_functions.sql", "002_partition_tables.sql"]
    .map((f) => readFileSync(`${PARTITIONS}${f}`, "utf8"))
    .join("\n");
  const results = await pg.begin(async (tx) => tx.unsafe(text).simple());
  return (results as unknown as Record<string, unknown>[][])
    .flat()
    .map((r) => Object.values(r)[0])
    .filter((v): v is string => typeof v === "string");
}

const partitionOf = async (table: string, id: string) =>
  (await pg.unsafe<{ p: string }[]>(`select tableoid::regclass::text as p from ${table} where id = $1`, [id]))[0]?.p;

beforeAll(async () => {
  await admin(`drop database if exists "${new URL(url).pathname.slice(1)}" with (force)`);
  await admin(`create database "${new URL(url).pathname.slice(1)}"`);
  await runMigrations(url);
  pg = postgres(url, { max: 4, onnotice: () => undefined });
  handle = createDb(url, { max: 2 });
  companyId = (await pg<{ id: string }[]>`insert into companies (name) values ('Partition Co') returning id`)[0]!.id;
  const [p] = await pg<
    { id: string }[]
  >`insert into projects (company_id, name, code) values (${companyId}, 'P', 'P') returning id`;
  const [bt] = await pg<
    { id: string }[]
  >`insert into block_types (company_id, name, code) values (${companyId}, 'T', 'T') returning id`;
  const [b] = await pg<
    { id: string }[]
  >`insert into blocks (company_id, project_id, block_type_id, name, code) values (${companyId}, ${p!.id}, ${bt!.id}, 'B', 'B') returning id`;
  const [ft] = await pg<
    { id: string }[]
  >`insert into flat_types (company_id, name, code) values (${companyId}, '2BHK', '2BHK') returning id`;
  const [f] = await pg<
    { id: string }[]
  >`insert into flats (company_id, project_id, block_id, flat_number, floor, flat_type_id, flat_type_code) values (${companyId}, ${p!.id}, ${b!.id}, '101', 1, ${ft!.id}, '2BHK') returning id`;
  const [c] = await pg<
    { id: string }[]
  >`insert into customers (company_id, customer_code, full_name, phone) values (${companyId}, 'C1', 'Cust', '9876500000') returning id`;
  const [plan] = await pg<
    { id: string }[]
  >`insert into payment_plans (company_id, name, code, plan_type) values (${companyId}, 'Plan', 'PL', 'CONSTRUCTION_LINKED') returning id`;
  bookingId = (
    await pg<
      { id: string }[]
    >`insert into bookings (company_id, booking_number, project_id, block_id, flat_id, customer_id, booking_date, agreement_value_paise, cash_agreed_paise, account_agreed_paise, flat_snapshot, payment_plan_id, plan_snapshot)
    values (${companyId}, 'BK/1', ${p!.id}, ${b!.id}, ${f!.id}, ${c!.id}, current_date, 100, 40, 60, '{}'::jsonb, ${plan!.id}, '{}'::jsonb) returning id`
  )[0]!.id;
  for (const seq of [1, 2, 3]) await ledger(seq, "now() - interval '40 days'");
  await pg`insert into audit_logs (company_id, actor_type, action, entity_type, created_at) select ${companyId}, 'SYSTEM', 'old.row', 'x', now() - interval '40 days' from generate_series(1, 2)`;
  await pg`insert into notifications (company_id, recipient_type, recipient_id, type, title, entity_type, entity_id) values (${companyId}, 'STAFF', gen_random_uuid(), 'DEMAND_RAISED', 'gone', 'demand', gen_random_uuid())`;
  await pg`insert into login_events (subject_type, identifier, success) values ('STAFF', 'a@b.c', true)`;
}, 120_000);

async function ledger(seq: number, createdAt = "now()", db: Sql = pg): Promise<void> {
  await db.unsafe(
    `insert into ledger_entries (company_id, booking_id, seq, entry_date, event, amount_paise, cash_paid_cum_paise, account_paid_cum_paise, cash_order_raised_paise, account_order_raised_paise, cash_due_paise, account_due_paise, total_due_paise, created_at)
    values ($1, $2, $3, current_date, 'DEMAND', 1, 0, 0, 0, 0, 0, 0, 0, ${createdAt})`,
    [companyId, bookingId, seq],
  );
}

afterAll(async () => {
  await handle?.close();
  await pg?.end({ timeout: 5 });
  await admin(`drop database if exists "${new URL(url).pathname.slice(1)}" with (force)`).catch(() => undefined);
});

describe("monthly partitioning scripts", () => {
  it("convert the four tables without copying rows: legacy partition up to next month, default partition, next months; idempotent", async () => {
    const before = Object.fromEntries(
      await Promise.all(
        TABLES.map(async (t) => [
          t,
          Number((await pg.unsafe<{ n: number }[]>(`select count(*)::int as n from ${t}`))[0]!.n),
        ]),
      ),
    );
    const summary = await applyScripts();
    expect(summary.filter((s) => s.includes("partitioned ("))).toHaveLength(4);
    expect(summary.find((s) => s.startsWith("ledger_entries"))).toContain("ledger_entries_booking_epoch_seq_uq");
    const partitioned = await pg<{ t: string }[]>`select kkt_partitioned_tables() as t`;
    expect(partitioned.map((r) => r.t)).toEqual(TABLES);
    for (const t of TABLES) {
      expect(Number((await pg.unsafe<{ n: number }[]>(`select count(*)::int as n from ${t}`))[0]!.n), t).toBe(
        before[t],
      );
      const parts = (
        await pg<
          { p: string; bound: string }[]
        >`select c.relname as p, pg_get_expr(c.relpartbound, c.oid) as bound from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = ${t}::regclass order by 1`
      ).map((r) => r.p);
      expect(parts).toEqual(expect.arrayContaining([`${t}_legacy`, `${t}_default`]));
      expect(parts.filter((p) => /_y\d{4}m\d{2}$/.test(p)).length).toBeGreaterThanOrEqual(2);
    }
    // old rows stayed where they were (no copy)
    const oldId = (await pg<{ id: string }[]>`select id from audit_logs where action = 'old.row' limit 1`)[0]!.id;
    expect(await partitionOf("audit_logs", oldId)).toBe("audit_logs_legacy");
    // second run: nothing to do
    const again = await applyScripts();
    expect(again.filter((s) => s.endsWith("already partitioned"))).toHaveLength(4);
  });

  it("new rows land in their month's partition; the migrations re-run cleanly on the partitioned schema", async () => {
    const [nextMonth] = await pg<
      { d: string }[]
    >`select ((date_trunc('month', now() at time zone 'UTC') + interval '1 month')::timestamp at time zone 'UTC')::text as d`;
    const [row] = await pg<
      { id: string }[]
    >`insert into audit_logs (company_id, actor_type, action, entity_type, created_at) values (${companyId}, 'SYSTEM', 'new.row', 'x', ${nextMonth!.d}::timestamptz + interval '1 hour') returning id`;
    expect(await partitionOf("audit_logs", row!.id)).toMatch(/^audit_logs_y\d{4}m\d{2}$/);
    const [far] = await pg<
      { id: string }[]
    >`insert into notifications (company_id, recipient_type, recipient_id, type, title, created_at) values (${companyId}, 'STAFF', gen_random_uuid(), 'DEMAND_RAISED', 'far', now() + interval '5 years') returning id`;
    expect(await partitionOf("notifications", far!.id)).toBe("notifications_default");
    await pg`delete from notifications where id = ${far!.id}`;
    await runMigrations(url);
    expect((await pg`select 1 from pg_partitioned_table where partrelid = 'audit_logs'::regclass`).length).toBe(1);
  });

  it("keeps the guards: audit_logs immutable on every partition (UPDATE/DELETE/TRUNCATE), ledger one-seq-per-booking (also under concurrency)", async () => {
    await expect(pg`update audit_logs set action = 'tampered'`).rejects.toThrow(/immutable/);
    await expect(pg`delete from audit_logs`).rejects.toThrow(/immutable/);
    for (const p of ["audit_logs", "audit_logs_legacy", "audit_logs_default"])
      await expect(pg.unsafe(`truncate ${p}`), p).rejects.toThrow(/immutable/);
    const [m] = await pg<
      { p: string }[]
    >`select c.relname as p from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'audit_logs'::regclass and c.relname ~ '_y[0-9]{4}m[0-9]{2}$' limit 1`;
    await expect(pg.unsafe(`truncate ${m!.p}`)).rejects.toThrow(/immutable/);

    await expect(ledger(2)).rejects.toMatchObject({
      code: "23505",
      constraint_name: "ledger_entries_booking_epoch_seq_uq",
    });
    // ledger epochs (migration 0005): the same seq in a new epoch is a new row, not a duplicate
    await pg.unsafe(
      `insert into ledger_entries (company_id, booking_id, epoch, seq, entry_date, event, amount_paise, cash_paid_cum_paise, account_paid_cum_paise, cash_order_raised_paise, account_order_raised_paise, cash_due_paise, account_due_paise, total_due_paise)
      values ($1, $2, 2, 2, current_date, 'LEDGER_RESTATED', 0, 0, 0, 0, 0, 0, 0, 0)`,
      [companyId, bookingId],
    );
    await ledger(4);
    // two connections racing for the same (booking, seq): exactly one wins
    const a = postgres(url, { max: 1, onnotice: () => undefined });
    const b = postgres(url, { max: 1, onnotice: () => undefined });
    try {
      const results = await Promise.allSettled([
        a.begin(async (tx) => {
          await ledger(5, "now()", tx as unknown as Sql);
          await tx`select pg_sleep(0.2)`;
        }),
        b.begin(async (tx) => {
          await ledger(5, "now()", tx as unknown as Sql);
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code),
      ).toEqual(["23505"]);
    } finally {
      await a.end({ timeout: 5 });
      await b.end({ timeout: 5 });
    }
    expect(
      Number(
        (await pg<{ n: number }[]>`select count(*)::int as n from ledger_entries where booking_id = ${bookingId}`)[0]!
          .n,
      ),
    ).toBe(6);
  });

  it("PARTITION_MAINTENANCE is registered but only creates partitions with PARTITIONING_ENABLED=true; the app's notification sweep works on the partitioned table", async () => {
    const { partitionMaintenance } = await import("../../src/modules/admin/index.js");
    const prev = process.env["PARTITIONING_ENABLED"];
    try {
      delete process.env["PARTITIONING_ENABLED"];
      expect(await partitionMaintenance(handle.db, 6)).toMatchObject({ skipped: true });
      process.env["PARTITIONING_ENABLED"] = "true";
      const first = await partitionMaintenance(handle.db, 6);
      expect((first["created"] as string[]).length).toBeGreaterThanOrEqual(4 * 3);
      expect(
        (first["created"] as string[]).every((n) =>
          /^(audit_logs|ledger_entries|login_events|notifications)_y\d{4}m\d{2}$/.test(n),
        ),
      ).toBe(true);
      expect(await partitionMaintenance(handle.db, 6)).toMatchObject({ created: [] });
    } finally {
      if (prev === undefined) delete process.env["PARTITIONING_ENABLED"];
      else process.env["PARTITIONING_ENABLED"] = prev;
    }
    const { sweepNotifications } = await import("../../src/modules/notifications/index.js");
    expect(await sweepNotifications(handle.db)).toMatchObject({ deleted: 1 });
  });

  it("the maintenance job works under a DML-only application role (kkt_app: no DDL on public), through the SECURITY DEFINER entry point only", async () => {
    const role = `${new URL(url).pathname.slice(1)}_app`;
    await pg.unsafe(`drop role if exists "${role}"`);
    await pg.unsafe(`create role "${role}" nologin nosuperuser`);
    try {
      // what infra/postgres/init/01-roles.sql grants kkt_app: schema usage, DML, function execution — no CREATE on public
      await pg.unsafe(`revoke create on schema public from public`);
      await pg.unsafe(
        `grant usage on schema public to "${role}"; grant select, insert, update, delete on all tables in schema public to "${role}"`,
      );
      await pg.unsafe(`grant execute on function kkt_create_next_partitions(int) to "${role}"`);
      const created = await pg
        .begin(async (tx) => {
          await tx.unsafe(`set local role "${role}"`);
          await expect(tx.unsafe("create table public.app_role_ddl_probe (id int)")).rejects.toThrow(
            /permission denied/,
          );
          return [];
        })
        .catch(() => []);
      expect(created).toEqual([]);
      const rows = await pg.begin(async (tx) => {
        await tx.unsafe(`set local role "${role}"`);
        return tx.unsafe<{ p: string | null }[]>("select kkt_create_next_partitions(9) as p");
      });
      const names = rows.map((r) => r.p).filter((p): p is string => Boolean(p));
      expect(names.length).toBeGreaterThanOrEqual(4);
      expect(names.every((n) => /^(audit_logs|ledger_entries|login_events|notifications)_y\d{4}m\d{2}$/.test(n))).toBe(
        true,
      );
      // the conversion helpers stay owner-only: the app role cannot partition (or re-partition) a table itself
      await expect(
        pg.begin(async (tx) => {
          await tx.unsafe(`set local role "${role}"`);
          await tx.unsafe(
            "select kkt_create_month_partition('audit_logs', (current_date + interval '20 months')::date)",
          );
        }),
      ).rejects.toThrow(/permission denied|must be owner/);
    } finally {
      await pg.unsafe(`drop owned by "${role}"`).catch(() => undefined);
      await pg.unsafe(`drop role if exists "${role}"`).catch(() => undefined);
    }
  });
});
