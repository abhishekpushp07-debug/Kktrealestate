import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { createDb, createDbCluster, type DbHandle } from "../src/client.js";
import { listSqlFiles, MIGRATIONS_FOLDER, runMigrations, SQL_FOLDER } from "../src/migrate.js";
import { resetDatabase, resetRefusalReason } from "../src/reset.js";
import { TEST_DATABASE_URL } from "./env.js";

const EXPECTED_TABLE_COUNT = 78;
/** Tables created by 0000_initial (0002 adds `exports`). */
const INITIAL_TABLE_COUNT = 77;
/** Committed drizzle migrations in journal order. */
const EXPECTED_MIGRATIONS = [
  "0000_initial",
  "0001_central_fixes",
  "0002_foundation_hardening",
  "0003_job_run_abandoned",
  "0004_site_visit_superseded_tokens",
] as const;

/** Replaces the database name in a postgres URL. */
function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

describe("migrations", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await resetDatabase(TEST_DATABASE_URL, { nodeEnv: "test", confirm: "yes" });
    handle = createDb(TEST_DATABASE_URL, { max: 2 });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("applies from scratch and creates every table", async () => {
    const rows = await handle.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    expect(rows[0]?.n).toBe(EXPECTED_TABLE_COUNT);
  });

  it("migrates a brand-new, empty database (create → migrate → verify → drop)", async () => {
    const name = `kkt_review_${Date.now().toString(36)}`;
    const admin = postgres(withDatabase(TEST_DATABASE_URL, "postgres"), { max: 1, onnotice: () => undefined });
    try {
      await admin.unsafe(`CREATE DATABASE ${name}`);
      const url = withDatabase(TEST_DATABASE_URL, name);
      await runMigrations(url);
      const fresh = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const [tables] = await fresh<{ n: number }[]>`
          SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
        expect(tables?.n).toBe(EXPECTED_TABLE_COUNT);
        const [ext] = await fresh<
          { names: string[] }[]
        >`SELECT array_agg(extname::text ORDER BY extname) AS names FROM pg_extension WHERE extname IN ('citext', 'pg_trgm')`;
        expect(ext?.names).toEqual(["citext", "pg_trgm"]);
        const [triggers] = await fresh<{ names: string[] }[]>`
          SELECT array_agg(tgname ORDER BY tgname) AS names FROM pg_trigger
          WHERE NOT tgisinternal AND tgname IN ('audit_logs_immutable', 'audit_logs_no_truncate', 'payments_no_delete', 'demands_no_delete')`;
        expect(triggers?.names).toEqual([
          "audit_logs_immutable",
          "audit_logs_no_truncate",
          "demands_no_delete",
          "payments_no_delete",
        ]);
        const [journal] = await fresh<{ n: number }[]>`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
        expect(journal?.n).toBe(EXPECTED_MIGRATIONS.length);
      } finally {
        await fresh.end({ timeout: 5 });
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  });

  it("is idempotent when run again", async () => {
    await runMigrations(TEST_DATABASE_URL);
    await runMigrations(TEST_DATABASE_URL);
    const rows = await handle.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    expect(rows[0]?.n).toBe(EXPECTED_MIGRATIONS.length);
    const triggers = await handle.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'audit_logs_%'`;
    expect(triggers[0]?.n).toBe(2);
  });

  it("the committed journal lists the migrations in order and the initial SQL matches the snapshot folder", async () => {
    const journal = JSON.parse(await readFile(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((e) => e.tag)).toEqual([...EXPECTED_MIGRATIONS]);
    const central = await readFile(join(MIGRATIONS_FOLDER, "0001_central_fixes.sql"), "utf8");
    expect(central).toContain('ALTER TABLE "documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL');
    expect(central).toContain('ALTER TABLE "service_requests" ALTER COLUMN "category_id" SET NOT NULL');
    for (const name of [
      "site_visits_lead_status_idx",
      "flat_types_rooms_gin_idx",
      "flat_types_areas_gin_idx",
      "floor_plan_templates_positions_gin_idx",
      "blocks_floor_plans_gin_idx",
      "payment_plan_assignments_plan_idx",
      "bookings_payment_plan_idx",
      "audit_logs_company_created_idx",
    ]) {
      expect(central).toContain(`CREATE INDEX "${name}"`);
    }
    const initial = await readFile(join(MIGRATIONS_FOLDER, "0000_initial.sql"), "utf8");
    expect((initial.match(/^CREATE TABLE /gm) ?? []).length).toBe(INITIAL_TABLE_COUNT);
    // The generated SQL itself must carry the partial unique indexes (not only the hand-written file).
    for (const name of [
      "demands_booking_seq_nonvoid_uq",
      "bookings_one_active_per_flat_uq",
      "rate_cards_one_active_uq",
      "bank_accounts_one_default_uq",
      "construction_stages_one_possession_uq",
    ]) {
      expect(initial).toMatch(new RegExp(`CREATE UNIQUE INDEX "${name}" ON .* WHERE `));
    }
    expect(initial).toContain('UNIQUE NULLS NOT DISTINCT("plan_id","project_id","block_id")');
    const files = await listSqlFiles(SQL_FOLDER);
    expect(files.map((f) => f.split("/").pop())).toEqual(["0001_triggers.sql"]);
  });

  it("creates the partial unique indexes with the required WHERE clauses", async () => {
    const rows = await handle.sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%WHERE%'`;
    const defs = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.get("demands_booking_seq_nonvoid_uq")).toMatch(
      /UNIQUE INDEX .* \(booking_id, installment_seq\) WHERE \(status <> 'VOID'::demand_status\)/,
    );
    expect(defs.get("bookings_one_active_per_flat_uq")).toMatch(
      /UNIQUE INDEX .* \(flat_id\) WHERE \(status = 'ACTIVE'::booking_status\)/,
    );
    expect(defs.get("rate_cards_one_active_uq")).toMatch(
      /UNIQUE INDEX .* \(project_id\) WHERE \(status = 'ACTIVE'::rate_card_status\)/,
    );
    expect(defs.get("bank_accounts_one_default_uq")).toMatch(/UNIQUE INDEX .* \(company_id\) WHERE is_default/);
    expect(defs.get("construction_stages_one_possession_uq")).toMatch(
      /UNIQUE INDEX .* \(company_id\) WHERE is_possession/,
    );
    // 0002: database twins of application rules
    expect(defs.get("customers_company_phone_live_uq")).toMatch(
      /UNIQUE INDEX .* \(company_id, phone\) WHERE \(erased_at IS NULL\)/,
    );
    expect(defs.get("customers_company_pan_hash_live_uq")).toMatch(
      /UNIQUE INDEX .* \(company_id, pan_hash\) WHERE \(\(erased_at IS NULL\) AND \(pan_hash IS NOT NULL\)\)/,
    );
    expect(defs.get("payments_company_idempotency_key_uq")).toMatch(
      /UNIQUE INDEX .* \(company_id, idempotency_key\) WHERE \(idempotency_key IS NOT NULL\)/,
    );
    expect(defs.get("flats_hold_until_idx")).toMatch(
      /INDEX .* \(status, hold_until\) WHERE \(status = 'HOLD'::flat_status\)/,
    );
    expect(rows).toHaveLength(9);
  });

  it("creates the NULLS NOT DISTINCT constraint on payment_plan_assignments", async () => {
    const rows = await handle.sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'payment_plan_assignments_plan_project_block_uq'`;
    expect(rows[0]?.def).toBe("UNIQUE NULLS NOT DISTINCT (plan_id, project_id, block_id)");
  });

  it("installs the audit triggers (UPDATE/DELETE row-level, TRUNCATE statement-level)", async () => {
    const rows = await handle.sql<{ tgname: string; tgtype: number }[]>`
      SELECT tgname, tgtype::int AS tgtype FROM pg_trigger
      WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal ORDER BY tgname`;
    expect(rows.map((r) => r.tgname)).toEqual(["audit_logs_immutable", "audit_logs_no_truncate"]);
    // tgtype bits: 1 = ROW, 2 = BEFORE, 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE
    const byName = new Map(rows.map((r) => [r.tgname, r.tgtype]));
    expect((byName.get("audit_logs_immutable") ?? 0) & (1 | 2 | 8 | 16)).toBe(1 | 2 | 8 | 16);
    expect((byName.get("audit_logs_no_truncate") ?? 0) & (2 | 32)).toBe(2 | 32);
    expect((byName.get("audit_logs_no_truncate") ?? 0) & 1).toBe(0);
  });

  it("installs an updated_at trigger on every table with updated_at and on no other table", async () => {
    const missing = await handle.sql<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
          WHERE r.relname = c.table_name AND t.tgname = 'set_updated_at')`;
    expect(missing.map((m) => m.table_name)).toEqual([]);
    const extra = await handle.sql<{ relname: string }[]>`
      SELECT r.relname FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
      WHERE t.tgname = 'set_updated_at'
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name = r.relname AND c.column_name = 'updated_at')`;
    expect(extra.map((e) => e.relname)).toEqual([]);
  });

  it("set_updated_at bumps updated_at on UPDATE", async () => {
    const [company] = await handle.sql<{ id: string; updated_at: string }[]>`
      INSERT INTO companies (name) VALUES ('Trigger Co') RETURNING id, updated_at`;
    if (!company) throw new Error("insert failed");
    await handle.sql`SELECT pg_sleep(0.01)`;
    const [after] = await handle.sql<{ updated_at: string }[]>`
      UPDATE companies SET name = 'Trigger Co 2' WHERE id = ${company.id} RETURNING updated_at`;
    if (!after) throw new Error("update failed");
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(company.updated_at).getTime());
  });

  it("reset refuses without confirmation or in production, and the refusal happens before any connection", async () => {
    expect(resetRefusalReason({ nodeEnv: "production", confirm: "yes" })).toMatch(/production/);
    expect(resetRefusalReason({ nodeEnv: "test", confirm: undefined })).toMatch(/CONFIRM_RESET/);
    expect(resetRefusalReason({ nodeEnv: "test", confirm: "YES" })).toMatch(/CONFIRM_RESET/);
    expect(resetRefusalReason({ nodeEnv: undefined, confirm: "yes" })).toBeNull();
    expect(resetRefusalReason({ nodeEnv: "test", confirm: "yes" })).toBeNull();
    await expect(resetDatabase(TEST_DATABASE_URL, { nodeEnv: "production", confirm: "yes" })).rejects.toThrow(
      /production/,
    );
    // An unreachable URL proves the guard runs first: no connection is attempted when refused.
    await expect(
      resetDatabase("postgres://nobody:x@127.0.0.1:1/nope", { nodeEnv: "test", confirm: undefined }),
    ).rejects.toThrow(/CONFIRM_RESET/);
    const rows = await handle.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM companies`;
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it("createDbCluster falls back to the primary when no replica URL is configured", async () => {
    const cluster = createDbCluster(TEST_DATABASE_URL, undefined, { max: 1 });
    try {
      expect(cluster.hasReplica).toBe(false);
      expect(cluster.replica).toBe(cluster.primary);
      const rows = await cluster.replica.sql<{ one: number }[]>`SELECT 1 AS one`;
      expect(rows[0]?.one).toBe(1);
    } finally {
      await cluster.close();
    }
    const same = createDbCluster(TEST_DATABASE_URL, TEST_DATABASE_URL, { max: 1 });
    expect(same.hasReplica).toBe(false);
    await same.close();
  });

  it("createDbCluster opens a separate pool when a replica URL is given", async () => {
    // The maintenance database stands in for a replica: a different URL, read-only use.
    const cluster = createDbCluster(TEST_DATABASE_URL, withDatabase(TEST_DATABASE_URL, "postgres"), { max: 1 });
    try {
      expect(cluster.hasReplica).toBe(true);
      expect(cluster.replica).not.toBe(cluster.primary);
      const [a] = await cluster.primary.sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const [b] = await cluster.replica.sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      expect(a?.pid).not.toBe(b?.pid);
    } finally {
      await cluster.close();
    }
  });
});

describe("migration 0004 (superseded site-visit manage tokens)", () => {
  it("adds site_visits.superseded_token_hashes (text[], default empty, NOT NULL) with a GIN index used by containment lookups", async () => {
    await runMigrations(TEST_DATABASE_URL);
    const handle = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
    try {
      const [col] = await handle<{ type: string; nullable: string; def: string }[]>`
        SELECT data_type AS type, is_nullable AS nullable, column_default AS def FROM information_schema.columns
        WHERE table_name = 'site_visits' AND column_name = 'superseded_token_hashes'`;
      expect(col).toEqual({ type: "ARRAY", nullable: "NO", def: "'{}'::text[]" });
      const [idx] = await handle<{ def: string }[]>`
        SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'site_visits_superseded_token_hashes_idx'`;
      expect(idx?.def).toMatch(/USING gin \(superseded_token_hashes\)/);
    } finally {
      await handle.end({ timeout: 5 });
    }
  });
});

describe("migration 0003 (job run status ABANDONED)", () => {
  it("adds ABANDONED to job_run_status, idempotently", async () => {
    await runMigrations(TEST_DATABASE_URL);
    const handle = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
    try {
      const rows = await handle<{ v: string }[]>`SELECT unnest(enum_range(NULL::job_run_status))::text AS v`;
      expect(rows.map((r) => r.v)).toEqual(["RUNNING", "OK", "FAILED", "ABANDONED"]);
    } finally {
      await handle.end({ timeout: 5 });
    }
  });
});
