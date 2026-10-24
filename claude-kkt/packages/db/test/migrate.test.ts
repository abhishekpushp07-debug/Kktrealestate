import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import { resetDatabase, resetRefusalReason } from "../src/reset.js";
import { TEST_DATABASE_URL } from "./env.js";

const EXPECTED_TABLE_COUNT = 77;

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

  it("is idempotent when run again", async () => {
    await runMigrations(TEST_DATABASE_URL);
    await runMigrations(TEST_DATABASE_URL);
    const rows = await handle.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    expect(rows[0]?.n).toBe(1);
  });

  it("creates the partial unique indexes with the required WHERE clauses", async () => {
    const rows = await handle.sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%WHERE%'`;
    const defs = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.get("demands_booking_seq_nonvoid_uq")).toMatch(/UNIQUE INDEX .* \(booking_id, installment_seq\) WHERE \(status <> 'VOID'::demand_status\)/);
    expect(defs.get("bookings_one_active_per_flat_uq")).toMatch(/UNIQUE INDEX .* \(flat_id\) WHERE \(status = 'ACTIVE'::booking_status\)/);
    expect(defs.get("rate_cards_one_active_uq")).toMatch(/UNIQUE INDEX .* \(project_id\) WHERE \(status = 'ACTIVE'::rate_card_status\)/);
    expect(defs.get("bank_accounts_one_default_uq")).toMatch(/UNIQUE INDEX .* \(company_id\) WHERE is_default/);
    expect(defs.get("construction_stages_one_possession_uq")).toMatch(/UNIQUE INDEX .* \(company_id\) WHERE is_possession/);
  });

  it("creates the NULLS NOT DISTINCT constraint on payment_plan_assignments", async () => {
    const rows = await handle.sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'payment_plan_assignments_plan_project_block_uq'`;
    expect(rows[0]?.def).toBe("UNIQUE NULLS NOT DISTINCT (plan_id, project_id, block_id)");
  });

  it("installs the audit trigger and an updated_at trigger on every table with updated_at", async () => {
    const audit = await handle.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'audit_logs_immutable' AND NOT tgisinternal`;
    expect(audit[0]?.n).toBe(1);

    const missing = await handle.sql<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
          WHERE r.relname = c.table_name AND t.tgname = 'set_updated_at')`;
    expect(missing.map((m) => m.table_name)).toEqual([]);
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

  it("reset refuses without confirmation or in production", async () => {
    expect(resetRefusalReason({ nodeEnv: "production", confirm: "yes" })).toMatch(/production/);
    expect(resetRefusalReason({ nodeEnv: "test", confirm: undefined })).toMatch(/CONFIRM_RESET/);
    expect(resetRefusalReason({ nodeEnv: "test", confirm: "yes" })).toBeNull();
    await expect(resetDatabase(TEST_DATABASE_URL, { nodeEnv: "production", confirm: "yes" })).rejects.toThrow(/production/);
  });
});
