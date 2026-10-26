// Online migrations (audit v3 B7) and migration 0005: checksummed hand-written files, the online runner (one statement at a time,
// outside any transaction, INVALID-index recovery, partitioned tables), an index on every foreign key, application-role privileges,
// the 0005 columns/backfills/triggers, and the precision guard on bigint reads.
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BigIntPrecisionError, createDb, parseBigint, type DbHandle } from "../src/client.js";
import {
  applyOnlineSql,
  listOnlineSqlFiles,
  listSqlFiles,
  MIGRATIONS_FOLDER,
  parseConcurrentIndex,
  runMigrations,
  SQL_FOLDER,
  splitSqlStatements,
} from "../src/migrate.js";
import { bookings, companies, enquiries, ledgerEntries } from "../src/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";
import { createFixture, type Fixture } from "./fixtures.js";
import { rejectsWithPg } from "./util.js";

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** FK columns with no index whose leading column is that column (partial indexes do not count). */
const UNINDEXED_FKS = `
  SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1] AND i.indpred IS NULL
    )
  ORDER BY 1, 2`;

let handle: DbHandle;

beforeAll(async () => {
  await runMigrations(TEST_DATABASE_URL);
  handle = createDb(TEST_DATABASE_URL, { max: 2 });
});

afterAll(async () => {
  await handle?.close();
});

describe("SQL statement splitter (online files)", () => {
  it("splits at top-level semicolons only: strings, quoted identifiers, dollar-quoted bodies and comments stay intact", () => {
    const text = `
      -- a comment; with a semicolon
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "a_idx" ON "t" ("x");
      /* block; comment */
      SELECT 'it''s; fine', "odd;name" FROM t;
      DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;
      CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $body$ SELECT 1; $body$;
      -- only a comment at the end;
    `;
    const parts = splitSqlStatements(text);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "a_idx"');
    expect(parts[1]).toContain("'it''s; fine', \"odd;name\"");
    expect(parts[2]).toBe("DO $$ BEGIN PERFORM 1; PERFORM 2; END $$");
    expect(parts[3]).toContain("$body$ SELECT 1; $body$");
  });

  it("recognises CREATE [UNIQUE] INDEX CONCURRENTLY statements and their index/table names", () => {
    expect(
      parseConcurrentIndex(
        '-- c\nCREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_customer_id_idx" ON "payments" (x)',
      ),
    ).toEqual({ unique: false, index: "payments_customer_id_idx", table: "payments" });
    expect(parseConcurrentIndex("create unique index concurrently u on only public.t (a)")).toEqual({
      unique: true,
      index: "u",
      table: "t",
    });
    expect(parseConcurrentIndex('CREATE INDEX "x" ON "t" (a)')).toBeNull();
    expect(parseConcurrentIndex("ALTER TABLE t VALIDATE CONSTRAINT c")).toBeNull();
  });
});

describe("checksummed hand-written SQL", () => {
  it("lists the trigger and privilege files and the online 0005 file", async () => {
    expect((await listSqlFiles()).map((f) => f.slice(SQL_FOLDER.length + 1))).toEqual([
      "0001_triggers.sql",
      "0002_privileges.sql",
    ]);
    expect((await listOnlineSqlFiles()).map((f) => f.slice(SQL_FOLDER.length + 1))).toEqual([
      "online/0005_indexes.sql",
    ]);
  });

  it("a deploy with nothing new re-applies nothing (no trigger is dropped and re-created, so no table is locked)", async () => {
    const before = await handle.sql<{ oid: number }[]>`
      SELECT t.oid::int AS oid FROM pg_trigger t WHERE t.tgname IN ('set_updated_at', 'audit_logs_immutable') ORDER BY t.oid`;
    const report = await runMigrations(TEST_DATABASE_URL);
    expect(report.applied).toEqual([]);
    expect(report.skipped).toEqual(["0001_triggers.sql", "0002_privileges.sql", "online/0005_indexes.sql"]);
    const after = await handle.sql<{ oid: number }[]>`
      SELECT t.oid::int AS oid FROM pg_trigger t WHERE t.tgname IN ('set_updated_at', 'audit_logs_immutable') ORDER BY t.oid`;
    expect(after).toEqual(before);
  });

  it("a changed file is re-applied once, and re-applying the trigger file keeps every existing trigger (create-if-missing)", async () => {
    const before = await handle.sql<
      { oid: number }[]
    >`SELECT oid::int AS oid FROM pg_trigger WHERE tgname = 'set_updated_at' ORDER BY oid`;
    await handle.sql`UPDATE drizzle.kkt_schema_files SET sha256 = 'changed' WHERE file = '0001_triggers.sql'`;
    const report = await runMigrations(TEST_DATABASE_URL);
    expect(report.applied).toEqual(["0001_triggers.sql"]);
    const after = await handle.sql<
      { oid: number }[]
    >`SELECT oid::int AS oid FROM pg_trigger WHERE tgname = 'set_updated_at' ORDER BY oid`;
    expect(after).toEqual(before);
    expect((await runMigrations(TEST_DATABASE_URL)).applied).toEqual([]);
  });

  it("a new drizzle migration re-applies the src/sql files (new tables get their triggers) but not unchanged online files", async () => {
    await handle.sql`UPDATE drizzle.kkt_schema_files SET schema_marker = 'older-schema' WHERE file NOT LIKE 'online/%'`;
    await handle.sql.unsafe("CREATE TABLE IF NOT EXISTS probe_new_table (id int PRIMARY KEY, updated_at timestamptz)");
    try {
      const report = await runMigrations(TEST_DATABASE_URL);
      expect(report.applied).toEqual(["0001_triggers.sql", "0002_privileges.sql"]);
      const [trg] = await handle.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'probe_new_table'::regclass AND tgname = 'set_updated_at'`;
      expect(trg?.n).toBe(1);
    } finally {
      await handle.sql.unsafe("DROP TABLE IF EXISTS probe_new_table");
    }
  });

  it("KKT_MIGRATE_REAPPLY_SQL / reapplyAll re-applies every file", async () => {
    const report = await runMigrations(TEST_DATABASE_URL, { reapplyAll: true });
    expect(report.applied).toEqual(["0001_triggers.sql", "0002_privileges.sql", "online/0005_indexes.sql"]);
    expect(report.online["online/0005_indexes.sql"]!.every((r) => r.action === "applied")).toBe(true);
  });
});

describe("online runner", () => {
  beforeAll(async () => {
    await handle.sql.unsafe(`
      DROP TABLE IF EXISTS online_probe, online_probe_parted CASCADE;
      CREATE TABLE online_probe (id int PRIMARY KEY, code text);
      INSERT INTO online_probe VALUES (1, 'a'), (2, 'a');
      CREATE TABLE online_probe_parted (id int, created_at timestamptz NOT NULL, code text) PARTITION BY RANGE (created_at);
      CREATE TABLE online_probe_parted_all PARTITION OF online_probe_parted DEFAULT;`);
  });
  afterAll(async () => {
    await handle.sql.unsafe("DROP TABLE IF EXISTS online_probe, online_probe_parted CASCADE");
  });

  it("drops the INVALID index an interrupted CONCURRENTLY build left behind and builds it again", async () => {
    // a unique build over duplicate values fails half-way and leaves an INVALID index — exactly what a killed deploy leaves
    await expect(
      handle.sql.unsafe('CREATE UNIQUE INDEX CONCURRENTLY "online_probe_code_uq" ON online_probe (code)'),
    ).rejects.toMatchObject({ code: "23505" });
    const [broken] = await handle.sql<{ valid: boolean }[]>`
      SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'online_probe_code_uq'`;
    expect(broken?.valid).toBe(false);
    await handle.sql`UPDATE online_probe SET code = 'b' WHERE id = 2`;
    const results = await applyOnlineSql(
      handle.sql,
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "online_probe_code_uq" ON "online_probe" ("code");',
    );
    expect(results).toEqual([
      expect.objectContaining({ action: "applied", droppedInvalidIndex: "online_probe_code_uq" }),
    ]);
    const [fixed] = await handle.sql<{ valid: boolean }[]>`
      SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'online_probe_code_uq'`;
    expect(fixed?.valid).toBe(true);
    // idempotent: the second run finds the valid index and does nothing
    expect(
      await applyOnlineSql(
        handle.sql,
        'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "online_probe_code_uq" ON "online_probe" ("code");',
      ),
    ).toEqual([expect.objectContaining({ action: "applied" })]);
  });

  it("runs each statement outside a transaction block (CONCURRENTLY and VALIDATE work; a DO block is one statement)", async () => {
    const results = await applyOnlineSql(
      handle.sql,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS online_probe_id_code_idx ON online_probe (id, code);
       ALTER TABLE online_probe ADD CONSTRAINT online_probe_code_chk CHECK (code <> '') NOT VALID;
       ALTER TABLE online_probe VALIDATE CONSTRAINT online_probe_code_chk;
       DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM online_probe WHERE id = 3) THEN INSERT INTO online_probe VALUES (3, 'c'); END IF; END $$;`,
    );
    expect(results.map((r) => r.action)).toEqual(["applied", "applied", "applied", "applied"]);
    const [chk] = await handle.sql<
      { v: boolean }[]
    >`SELECT convalidated AS v FROM pg_constraint WHERE conname = 'online_probe_code_chk'`;
    expect(chk?.v).toBe(true);
  });

  it("on a partitioned table builds a plain index without CONCURRENTLY and skips a UNIQUE one", async () => {
    const results = await applyOnlineSql(
      handle.sql,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS online_probe_parted_code_idx ON online_probe_parted (code);
       CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS online_probe_parted_id_uq ON online_probe_parted (id);`,
    );
    expect(results.map((r) => r.action)).toEqual(["applied-without-concurrently", "skipped-unique-on-partitioned"]);
    const idx = await handle.sql<{ name: string }[]>`
      SELECT indexname AS name FROM pg_indexes WHERE tablename = 'online_probe_parted' ORDER BY 1`;
    expect(idx.map((r) => r.name)).toEqual(["online_probe_parted_code_idx"]);
  });
});

describe("migration 0005: indexes", () => {
  it("every foreign-key column has an index leading on it", async () => {
    expect(await handle.sql.unsafe(UNINDEXED_FKS)).toEqual([]);
  });

  it("the online file built the customer-360 and search indexes, all valid, and the ledger key is (booking_id, epoch, seq)", async () => {
    const rows = await handle.sql<{ name: string; valid: boolean }[]>`
      SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname IN ('payments_customer_id_idx', 'demands_customer_id_idx', 'leads_customer_id_idx', 'demands_demand_number_trgm_idx',
        'payments_instrument_number_trgm_idx', 'companies_hosts_idx', 'ledger_entries_booking_epoch_seq_uq', 'companies_slug_uq')
      ORDER BY 1`;
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.valid)).toBe(true);
    const cons = await handle.sql<{ name: string; def: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'ledger_entries'::regclass AND contype = 'u'`;
    expect(cons).toEqual([{ name: "ledger_entries_booking_epoch_seq_uq", def: "UNIQUE (booking_id, epoch, seq)" }]);
    const invalid = await handle.sql`SELECT 1 FROM pg_index WHERE NOT indisvalid`;
    expect(invalid).toHaveLength(0);
  });

  it("the planner uses the new trigram indexes for the demand-number and cheque-number searches", async () => {
    await handle.sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      const d = await tx.unsafe(`EXPLAIN SELECT id FROM demands WHERE demand_number ILIKE '%2526%'`);
      expect(d.map((r) => String(r["QUERY PLAN"])).join("\n")).toContain("demands_demand_number_trgm_idx");
      const p = await tx.unsafe(`EXPLAIN SELECT id FROM payments WHERE (instrument ->> 'number') ILIKE '%004512%'`);
      expect(p.map((r) => String(r["QUERY PLAN"])).join("\n")).toContain("payments_instrument_number_trgm_idx");
    });
  });
});

describe("migration 0005: columns, triggers and constraints", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await createFixture(handle.db);
  });

  it("companies get a unique kebab slug from their name (with -2, -3 … on collisions) and an empty host list", async () => {
    const tag = Date.now().toString(36);
    const a = await handle.sql<{ slug: string; hosts: string[] }[]>`
      INSERT INTO companies (name) VALUES (${`Shree  Ganesh — Builders ${tag}`}) RETURNING slug, hosts`;
    const b = await handle.db
      .insert(companies)
      .values({ name: `Shree Ganesh Builders ${tag}` })
      .returning();
    const c = await handle.sql<
      { slug: string }[]
    >`INSERT INTO companies (name, slug) VALUES ('Anything', ${`own-${tag}`}) RETURNING slug`;
    expect(a[0]).toEqual({ slug: `shree-ganesh-builders-${tag}`, hosts: [] });
    expect(b[0]?.slug).toBe(`shree-ganesh-builders-${tag}-2`);
    expect(c[0]?.slug).toBe(`own-${tag}`);
    await rejectsWithPg(
      handle.sql`INSERT INTO companies (name, slug) VALUES ('x', ${`own-${tag}`})`,
      /companies_slug_uq/,
    );
    await rejectsWithPg(
      handle.sql`INSERT INTO companies (name, slug) VALUES ('x', 'Not A Slug')`,
      /companies_slug_format_chk/,
    );
  });

  it("new companies default to force_mfa_for_admins = true", async () => {
    const [row] = await handle.sql<{ f: boolean }[]>`
      INSERT INTO companies (name) VALUES ('MFA default Co') RETURNING (settings ->> 'force_mfa_for_admins')::boolean AS f`;
    expect(row?.f).toBe(true);
  });

  it("versioned child rows bump their version on every UPDATE, unless the statement sets it (applyUpdate)", async () => {
    const [e] = await handle.db
      .insert(enquiries)
      .values({ companyId: fx.companyId, name: "V", phone: "9876500001", referenceNumber: `ENQ-${Date.now()}` })
      .returning();
    expect(e?.version).toBe(1);
    const [u1] = await handle.db.update(enquiries).set({ isRead: true }).where(eq(enquiries.id, e!.id)).returning();
    expect(u1?.version).toBe(2);
    const [u2] = await handle.db
      .update(enquiries)
      .set({ isRead: false, version: sql`${enquiries.version} + 1` })
      .where(eq(enquiries.id, e!.id))
      .returning();
    expect(u2?.version).toBe(3);
    const triggers = await handle.sql<{ t: string }[]>`
      SELECT c.relname::text AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE g.tgname = 'bump_version' ORDER BY 1`;
    expect(triggers.map((r) => r.t)).toEqual([
      "booking_other_charges",
      "demands",
      "enquiries",
      "lead_follow_ups",
      "payment_plan_installments",
      "rate_card_plc_rules",
      "rate_card_rates",
    ]);
  });

  it("a ledger seq is unique per (booking, epoch), not per booking; bookings start at epoch 1", async () => {
    const row = (epoch: number, seq: number) => ({
      companyId: fx.companyId,
      bookingId: fx.bookingId,
      epoch,
      seq,
      entryDate: "2025-06-01",
      event: "DEMAND" as const,
      amountPaise: 1,
      cashPaidCumPaise: 0,
      accountPaidCumPaise: 0,
      cashOrderRaisedPaise: 0,
      accountOrderRaisedPaise: 0,
      cashDuePaise: 0,
      accountDuePaise: 0,
      totalDuePaise: 0,
    });
    await handle.db.insert(ledgerEntries).values(row(1, 1));
    await handle.db.insert(ledgerEntries).values(row(2, 1));
    await rejectsWithPg(handle.db.insert(ledgerEntries).values(row(2, 1)), /ledger_entries_booking_epoch_seq_uq/);
    const [b] = await handle.db.select({ e: bookings.ledgerEpoch }).from(bookings).where(eq(bookings.id, fx.bookingId));
    expect(b?.e).toBe(1);
    await rejectsWithPg(
      handle.db.update(bookings).set({ ledgerEpoch: 0 }).where(eq(bookings.id, fx.bookingId)),
      /bookings_ledger_epoch_chk/,
    );
    await rejectsWithPg(
      handle.db.update(bookings).set({ cancellationRefundPaise: -1 }).where(eq(bookings.id, fx.bookingId)),
      /bookings_cancellation_amounts_nonneg_chk/,
    );
  });

  it("the ledger_event enum carries DEMAND_VOIDED and LEDGER_RESTATED", async () => {
    const rows = await handle.sql<{ v: string }[]>`SELECT unnest(enum_range(NULL::ledger_event))::text AS v`;
    expect(rows.map((r) => r.v)).toEqual(expect.arrayContaining(["DEMAND_VOIDED", "LEDGER_RESTATED"]));
  });

  it("audit_seals is append-only like audit_logs", async () => {
    const [s] = await handle.sql<{ id: number }[]>`
      INSERT INTO audit_seals (first_audit_id, last_audit_id, row_count, hash) VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'h')
      RETURNING id`;
    await rejectsWithPg(handle.sql`UPDATE audit_seals SET hash = 'x' WHERE id = ${s!.id}`, /audit_seals is immutable/);
    await rejectsWithPg(handle.sql`DELETE FROM audit_seals WHERE id = ${s!.id}`, /audit_seals is immutable/);
    await rejectsWithPg(handle.sql`TRUNCATE audit_seals`, /audit_seals is immutable/);
  });

  it("the new operational columns exist with their defaults", async () => {
    const cols = await handle.sql<{ t: string; c: string; d: string | null; n: string }[]>`
      SELECT table_name::text AS t, column_name::text AS c, column_default AS d, is_nullable AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND (table_name, column_name) IN (
        ('users', 'totp_last_step'), ('refresh_tokens', 'family_started_at'), ('service_requests', 'sla_paused_at'),
        ('service_requests', 'sla_paused_seconds'), ('site_visits', 'ics_sequence'), ('idempotency_keys', 'committed_at'),
        ('idempotency_keys', 'lease_expires_at'), ('job_runs', 'heartbeat_at'), ('job_runs', 'checkpoint'))
      ORDER BY 1, 2`;
    expect(cols).toEqual([
      { t: "idempotency_keys", c: "committed_at", d: null, n: "YES" },
      { t: "idempotency_keys", c: "lease_expires_at", d: null, n: "YES" },
      { t: "job_runs", c: "checkpoint", d: null, n: "YES" },
      { t: "job_runs", c: "heartbeat_at", d: null, n: "YES" },
      { t: "refresh_tokens", c: "family_started_at", d: "now()", n: "NO" },
      { t: "service_requests", c: "sla_paused_at", d: null, n: "YES" },
      { t: "service_requests", c: "sla_paused_seconds", d: "0", n: "NO" },
      { t: "site_visits", c: "ics_sequence", d: "0", n: "NO" },
      { t: "users", c: "totp_last_step", d: null, n: "YES" },
    ]);
  });
});

describe("migration 0005 on existing data (upgrade from 0004)", () => {
  it("backfills company slugs, cancellation money columns and refresh-token family start; constraints end up validated", async () => {
    const name = `kkt_p7_upgrade_${Date.now().toString(36)}`;
    const admin = postgres(withDatabase(TEST_DATABASE_URL, "postgres"), { max: 1, onnotice: () => undefined });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = withDatabase(TEST_DATABASE_URL, name);
    try {
      const fresh = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const { readMigrationFiles } = await import("drizzle-orm/migrator");
        const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
        const journal = JSON.parse(await readFile(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8")) as {
          entries: { tag: string }[];
        };
        const upTo = journal.entries.findIndex((e) => e.tag === "0004_site_visit_superseded_tokens") + 1;
        expect(upTo).toBe(5);
        await fresh.unsafe("CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm");
        await fresh.unsafe(
          "CREATE SCHEMA IF NOT EXISTS drizzle; CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)",
        );
        for (const m of migrations.slice(0, upTo)) {
          for (const stmt of m.sql) await fresh.unsafe(stmt);
          await fresh`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${m.hash}, ${m.folderMillis})`;
        }
        // rows in the 0004 shape
        const [c1] = await fresh<
          { id: string }[]
        >`INSERT INTO companies (name) VALUES ('Shree Ganesh Builders') RETURNING id`;
        await fresh`INSERT INTO companies (name, created_at) VALUES ('Shree Ganesh Builders!', now() + interval '1 second')`;
        await fresh`INSERT INTO companies (name) VALUES ('***')`;
        const companyId = c1!.id;
        const [bt] = await fresh<
          { id: string }[]
        >`INSERT INTO block_types (company_id, name, code) VALUES (${companyId}, 'T', 'T') RETURNING id`;
        const [ft] = await fresh<
          { id: string }[]
        >`INSERT INTO flat_types (company_id, name, code) VALUES (${companyId}, '2BHK', '2BHK') RETURNING id`;
        const [pl] = await fresh<{ id: string }[]>`
          INSERT INTO payment_plans (company_id, name, code, plan_type) VALUES (${companyId}, 'CLP', 'CLP', 'CONSTRUCTION_LINKED') RETURNING id`;
        const [pr] = await fresh<
          { id: string }[]
        >`INSERT INTO projects (company_id, name, code) VALUES (${companyId}, 'P', 'P') RETURNING id`;
        const [bl] = await fresh<{ id: string }[]>`
          INSERT INTO blocks (company_id, project_id, block_type_id, name, code) VALUES (${companyId}, ${pr!.id}, ${bt!.id}, 'A', 'A') RETURNING id`;
        const [fl] = await fresh<{ id: string }[]>`
          INSERT INTO flats (company_id, project_id, block_id, flat_number, floor, flat_type_id, flat_type_code)
          VALUES (${companyId}, ${pr!.id}, ${bl!.id}, 'A-101', 1, ${ft!.id}, '2BHK') RETURNING id`;
        const [cu] = await fresh<{ id: string }[]>`
          INSERT INTO customers (company_id, customer_code, full_name, phone) VALUES (${companyId}, 'C1', 'Asha', '9876543210') RETURNING id`;
        const cancellation = {
          at: "2025-07-01T00:00:00Z",
          by: null,
          by_name: "Admin",
          reason: "x",
          deduction_paise: 50000,
          refund_paise: 150000,
        };
        await fresh`
          INSERT INTO bookings (company_id, booking_number, project_id, block_id, flat_id, customer_id, booking_date, status, agreement_value_paise,
            cash_agreed_paise, account_agreed_paise, flat_snapshot, payment_plan_id, plan_snapshot, cancellation)
          VALUES (${companyId}, 'BK-1', ${pr!.id}, ${bl!.id}, ${fl!.id}, ${cu!.id}, '2025-06-01', 'CANCELLED', 100, 40, 60, '{}'::jsonb, ${pl!.id},
            '{}'::jsonb, ${fresh.json(cancellation)})`;
        const family = "5f0c7a9e-1111-4222-8333-944455556666";
        await fresh`
          INSERT INTO refresh_tokens (company_id, subject_type, subject_id, family_id, token_hash, expires_at, created_at)
          VALUES (${companyId}, 'STAFF', gen_random_uuid(), ${family}, 'h1', now() + interval '7 days', '2026-01-01T00:00:00Z'),
                 (${companyId}, 'STAFF', gen_random_uuid(), ${family}, 'h2', now() + interval '7 days', '2026-01-05T00:00:00Z')`;
      } finally {
        await fresh.end({ timeout: 5 });
      }
      const report = await runMigrations(url);
      expect(report.applied).toEqual(["0001_triggers.sql", "0002_privileges.sql", "online/0005_indexes.sql"]);
      const after = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const slugs = await after<{ slug: string }[]>`SELECT slug FROM companies ORDER BY created_at, slug`;
        expect(slugs.map((s) => s.slug).sort()).toEqual([
          "company",
          "shree-ganesh-builders",
          "shree-ganesh-builders-2",
        ]);
        const [b] = await after<{ r: number; d: number; j: Record<string, unknown> }[]>`
          SELECT cancellation_refund_paise::int AS r, cancellation_deduction_paise::int AS d, cancellation AS j FROM bookings`;
        expect([b?.r, b?.d]).toEqual([150000, 50000]);
        expect(b?.j).toMatchObject({ refund_paise: 150000, deduction_paise: 50000 }); // the jsonb stays as the history record
        const fam = await after<{ s: string }[]>`SELECT DISTINCT family_started_at::text AS s FROM refresh_tokens`;
        expect(fam).toHaveLength(1);
        expect(fam[0]!.s).toMatch(/^2026-01-01 00:00:00/);
        const notValid = await after`SELECT conname FROM pg_constraint WHERE NOT convalidated`;
        expect(notValid).toHaveLength(0);
        expect(await after.unsafe(UNINDEXED_FKS)).toEqual([]);
        const second = await runMigrations(url);
        expect(second.applied).toEqual([]);
      } finally {
        await after.end({ timeout: 5 });
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  });
});

describe("application-role privileges (0002_privileges.sql)", () => {
  it("kkt_app keeps DML except UPDATE/DELETE/TRUNCATE on the append-only books and DELETE/TRUNCATE on payments and demands", async () => {
    const [role] = await handle.sql`SELECT 1 FROM pg_roles WHERE rolname = 'kkt_app'`;
    if (!role) await handle.sql.unsafe("CREATE ROLE kkt_app NOLOGIN NOSUPERUSER"); // what infra/postgres/init/01-roles.sql creates
    await runMigrations(TEST_DATABASE_URL, { reapplyAll: true });
    const privs = await handle.sql<{ t: string; p: string; ok: boolean }[]>`
      SELECT t, p, has_table_privilege('kkt_app', format('public.%I', t), p) AS ok
      FROM unnest(ARRAY['ledger_entries', 'audit_logs', 'audit_seals', 'ledger_rebuilds', 'payments', 'demands', 'bookings']) AS t,
           unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p
      ORDER BY 1, 2`;
    const allowed = (t: string) =>
      privs
        .filter((r) => r.t === t && r.ok)
        .map((r) => r.p)
        .sort();
    for (const t of ["ledger_entries", "audit_logs", "audit_seals", "ledger_rebuilds"])
      expect(allowed(t), t).toEqual(["INSERT", "SELECT"]);
    for (const t of ["payments", "demands"]) expect(allowed(t), t).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(allowed("bookings")).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });
});

describe("bigint reads never lose precision", () => {
  it("parses safe integers and refuses anything beyond ±(2^53 − 1)", async () => {
    expect(parseBigint("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseBigint("-9007199254740991")).toBe(-Number.MAX_SAFE_INTEGER);
    expect(() => parseBigint("9007199254740992")).toThrow(BigIntPrecisionError);
    const [ok] = await handle.sql<{ v: number }[]>`SELECT 9007199254740991::bigint AS v, 1::bigint AS one`;
    expect(ok?.v).toBe(9007199254740991);
    await expect(handle.sql`SELECT 9007199254740993::bigint AS v`).rejects.toBeInstanceOf(BigIntPrecisionError);
    await rejectsWithPg(
      handle.db.execute(sql`SELECT (2::numeric ^ 60)::bigint AS v`),
      /outside the safe integer range/,
    );
    // the pool connection survives the refused value
    const [after] = await handle.sql<{ one: number }[]>`SELECT 1::bigint AS one`;
    expect(after?.one).toBe(1);
  });
});
