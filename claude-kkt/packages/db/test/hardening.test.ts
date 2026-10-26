// Migration 0002 (foundation hardening): CHECK constraints, partial unique indexes, trigram search indexes, new columns,
// connection timeouts, the migration advisory lock and withTransactionRetry.
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  dbTimeoutsFromEnv,
  DEFAULT_DB_TIMEOUTS,
  retryableTransactionError,
  withSessionAdvisoryLock,
  withTransactionRetry,
  type DbHandle,
} from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import {
  bookingOtherCharges,
  bookings,
  customers,
  demands,
  exports,
  flats,
  parkingSlots,
  payments,
  paymentModes,
  users,
  roles,
} from "../src/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";
import { createFixture, type Fixture } from "./fixtures.js";
import { rejectsWithPg } from "./util.js";

const UNIQUE_VIOLATION = /duplicate key value violates unique constraint/;

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

describe("0002 constraints and indexes", () => {
  let handle: DbHandle;
  let fx: Fixture;

  beforeAll(async () => {
    handle = createDb(TEST_DATABASE_URL, { max: 4 });
    fx = await createFixture(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("bookings: cash + account must equal the agreement value, and neither bucket may be negative", async () => {
    const set = (v: Partial<typeof bookings.$inferInsert>) =>
      handle.db
        .update(bookings)
        .set(v)
        .where(sql`${bookings.id} = ${fx.bookingId}`);
    await rejectsWithPg(set({ cashAgreedPaise: 6_000_000_01 }), /bookings_agreement_split_chk/);
    await rejectsWithPg(set({ cashAgreedPaise: -1, accountAgreedPaise: 10_000_000_01 }), /bookings_agreed_nonneg_chk/);
    await rejectsWithPg(set({ listPricePaise: -5 }), /bookings_list_price_nonneg_chk/);
    await expect(
      set({
        cashAgreedPaise: 5_000_000_00,
        accountAgreedPaise: 5_000_000_00,
        listPricePaise: 10_000_000_00,
        priceDeviationReason: null,
      }),
    ).resolves.toBeDefined();
  });

  it("demands: cash + account must equal the total and amounts are never negative", async () => {
    const base = {
      companyId: fx.companyId,
      bookingId: fx.bookingId,
      projectId: fx.projectId,
      blockId: fx.blockId,
      customerId: fx.customerId,
      installmentName: "On booking",
      triggerType: "ON_BOOKING" as const,
      percent: 10,
      cumulativePercent: 10,
      demandDate: "2025-06-01",
      dueDate: "2025-06-16",
    };
    await rejectsWithPg(
      handle.db.insert(demands).values({
        ...base,
        demandNumber: "DM-H-1",
        installmentSeq: 11,
        cashDemandPaise: 100,
        accountDemandPaise: 100,
        totalDemandPaise: 201,
      }),
      /demands_split_chk/,
    );
    await rejectsWithPg(
      handle.db.insert(demands).values({
        ...base,
        demandNumber: "DM-H-2",
        installmentSeq: 12,
        cashDemandPaise: -100,
        accountDemandPaise: 300,
        totalDemandPaise: 200,
      }),
      /demands_amounts_nonneg_chk/,
    );
    await rejectsWithPg(
      handle.db.insert(demands).values({
        ...base,
        demandNumber: "DM-H-3",
        installmentSeq: 13,
        cashDemandPaise: 100,
        accountDemandPaise: 100,
        totalDemandPaise: 200,
        paidPaise: -1,
      }),
      /demands_amounts_nonneg_chk/,
    );
    await expect(
      handle.db.insert(demands).values({
        ...base,
        demandNumber: "DM-H-4",
        installmentSeq: 14,
        cashDemandPaise: 0,
        accountDemandPaise: 200,
        totalDemandPaise: 200,
      }),
    ).resolves.toBeDefined();
  });

  it("booking_other_charges: total = amount + GST, all ≥ 0", async () => {
    const line = { companyId: fx.companyId, bookingId: fx.bookingId, name: "Club", code: "CLUB" };
    await rejectsWithPg(
      handle.db.insert(bookingOtherCharges).values({ ...line, amountPaise: 1000, gstPaise: 180, totalPaise: 1000 }),
      /booking_other_charges_total_chk/,
    );
    await rejectsWithPg(
      handle.db.insert(bookingOtherCharges).values({ ...line, amountPaise: -1000, gstPaise: 0, totalPaise: -1000 }),
      /booking_other_charges_nonneg_chk/,
    );
    await rejectsWithPg(
      handle.db
        .insert(bookingOtherCharges)
        .values({ ...line, amountPaise: 1000, gstPaise: 180, totalPaise: 1180, paidPaise: -1 }),
      /booking_other_charges_nonneg_chk/,
    );
    await expect(
      handle.db.insert(bookingOtherCharges).values({ ...line, amountPaise: 1000, gstPaise: 180, totalPaise: 1180 }),
    ).resolves.toBeDefined();
  });

  it("flat and parking prices are never negative", async () => {
    await rejectsWithPg(
      handle.db
        .update(flats)
        .set({ pricePaise: -1 })
        .where(sql`${flats.id} = ${fx.flatId}`),
      /flats_price_nonneg_chk/,
    );
    await rejectsWithPg(
      handle.db
        .update(flats)
        .set({ ratePerSqftPaise: -1 })
        .where(sql`${flats.id} = ${fx.flatId}`),
      /flats_price_nonneg_chk/,
    );
    await rejectsWithPg(
      handle.db
        .insert(parkingSlots)
        .values({ companyId: fx.companyId, projectId: fx.projectId, number: "P-1", pricePaise: -1 }),
      /parking_slots_price_nonneg_chk/,
    );
    await expect(
      handle.db
        .insert(parkingSlots)
        .values({ companyId: fx.companyId, projectId: fx.projectId, number: "P-2", pricePaise: 0 }),
    ).resolves.toBeDefined();
  });

  it("one live customer per (company, phone) and per (company, PAN hash); erased rows and other companies do not count", async () => {
    const other = await createFixture(handle.db); // second company: same phone 9876543210 is fine there
    expect(other.companyId).not.toBe(fx.companyId);
    const add = (code: string, phone: string, panHash: string | null = null) =>
      handle.db
        .insert(customers)
        .values({ companyId: fx.companyId, customerCode: code, fullName: `Dup ${code}`, phone, panHash })
        .returning({ id: customers.id });
    await rejectsWithPg(add("C-DUP-1", "9876543210"), /customers_company_phone_live_uq/);
    const [first] = await add("C-PAN-1", "9000000001", "pan-hash-1");
    await rejectsWithPg(add("C-PAN-2", "9000000002", "pan-hash-1"), /customers_company_pan_hash_live_uq/);
    await expect(add("C-NOPAN-1", "9000000003", null)).resolves.toHaveLength(1);
    await expect(add("C-NOPAN-2", "9000000004", null)).resolves.toHaveLength(1);
    // inactive (deactivated) customers still block a duplicate, exactly like assertNoDuplicate; erased ones do not
    await handle.db
      .update(customers)
      .set({ isActive: false })
      .where(sql`${customers.id} = ${first!.id}`);
    await rejectsWithPg(add("C-PAN-3", "9000000001"), UNIQUE_VIOLATION);
    await handle.db
      .update(customers)
      .set({ erasedAt: new Date() })
      .where(sql`${customers.id} = ${first!.id}`);
    await expect(add("C-PAN-4", "9000000001", "pan-hash-1")).resolves.toHaveLength(1);
  });

  it("payments: an idempotency key is unique per company; NULL keys are unlimited", async () => {
    const [mode] = await handle.db
      .insert(paymentModes)
      .values({ companyId: fx.companyId, name: "Cash", code: "CASH-H", isCash: true, clearsImmediately: true })
      .returning({ id: paymentModes.id });
    const pay = (receiptNumber: string, idempotencyKey: string | null) =>
      handle.db.insert(payments).values({
        companyId: fx.companyId,
        bookingId: fx.bookingId,
        projectId: fx.projectId,
        blockId: fx.blockId,
        customerId: fx.customerId,
        receiptNumber,
        amountPaise: 100,
        paymentDate: "2025-06-02",
        paymentModeId: mode!.id,
        modeCode: "CASH",
        idempotencyKey,
      });
    await pay("RC-H-1", "key-1");
    await rejectsWithPg(pay("RC-H-2", "key-1"), /payments_company_idempotency_key_uq/);
    await pay("RC-H-3", null);
    await pay("RC-H-4", null);
    await pay("RC-H-5", "key-2");
  });

  it("new columns exist with the documented defaults (co_applicants/booking_drafts version, kyc_submitted_*, manage_token_expires_at, exports)", async () => {
    const rows = await handle.sql<
      {
        table_name: string;
        column_name: string;
        data_type: string;
        column_default: string | null;
        is_nullable: string;
      }[]
    >`
      SELECT table_name, column_name, data_type, column_default, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND (table_name, column_name) IN (
        ('co_applicants', 'version'), ('booking_drafts', 'version'), ('bookings', 'list_price_paise'), ('bookings', 'price_deviation_reason'),
        ('bookings', 'price_deviation_by'), ('site_visits', 'manage_token_expires_at'), ('customers', 'kyc_submitted_by'), ('customers', 'kyc_submitted_at'))
      ORDER BY table_name, column_name`;
    expect(
      rows.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}:${r.column_default ?? ""}:${r.is_nullable}`),
    ).toEqual([
      "booking_drafts.version:integer:1:NO",
      "bookings.list_price_paise:bigint::YES",
      "bookings.price_deviation_by:uuid::YES",
      "bookings.price_deviation_reason:text::YES",
      "co_applicants.version:integer:1:NO",
      "customers.kyc_submitted_at:timestamp with time zone::YES",
      "customers.kyc_submitted_by:uuid::YES",
      "site_visits.manage_token_expires_at:timestamp with time zone::YES",
    ]);
    const [role] = await handle.db
      .insert(roles)
      .values({ companyId: fx.companyId, name: "Exporter", permissions: [] })
      .returning({ id: roles.id });
    const [user] = await handle.db
      .insert(users)
      .values({
        companyId: fx.companyId,
        name: "Exporter",
        email: "exporter@test.in",
        passwordHash: "x",
        roleId: role!.id,
      })
      .returning({ id: users.id });
    const [job] = await handle.db
      .insert(exports)
      .values({ companyId: fx.companyId, userId: user!.id, path: "/api/v1/bookings", query: { status: "ACTIVE" } })
      .returning();
    expect(job).toMatchObject({ status: "QUEUED", rowCount: null, storageKey: null, finishedAt: null });
    await rejectsWithPg(
      handle.db
        .update(exports)
        .set({ rowCount: -1 })
        .where(sql`${exports.id} = ${job!.id}`),
      /exports_row_count_nonneg_chk/,
    );
  });

  it("every ILIKE search column used by list/search routes has a trigram GIN index", async () => {
    const rows = await handle.sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%gin_trgm_ops%'`;
    const got = rows.map((r) => r.indexname).sort();
    expect(got).toEqual(
      [
        "blocks_name_trgm_idx",
        "bookings_booking_number_trgm_idx",
        "customers_customer_code_trgm_idx",
        "customers_email_trgm_idx",
        "customers_full_name_trgm_idx",
        "customers_phone_trgm_idx",
        "flats_flat_number_trgm_idx",
        "leads_email_trgm_idx",
        "leads_full_name_trgm_idx",
        "leads_lead_number_trgm_idx",
        "leads_phone_trgm_idx",
        "payments_receipt_number_trgm_idx",
        "projects_name_trgm_idx",
        "service_requests_subject_trgm_idx",
        "service_requests_ticket_number_trgm_idx",
        "users_email_trgm_idx",
        "users_name_trgm_idx",
        "users_phone_trgm_idx",
      ].sort(),
    );
    expect(rows.find((r) => r.indexname === "users_email_trgm_idx")?.indexdef).toContain(
      "((email)::text) gin_trgm_ops",
    );
  });

  it("the planner uses the trigram index for a contains-search and the (company, created_at, id) index for the default customer sort", async () => {
    await handle.sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      const search = await tx.unsafe(`EXPLAIN SELECT id FROM customers WHERE full_name ILIKE '%asha%'`);
      expect(search.map((r) => String(r["QUERY PLAN"])).join("\n")).toContain("customers_full_name_trgm_idx");
      const page = await tx.unsafe(
        `EXPLAIN SELECT id FROM customers WHERE company_id = '${fx.companyId}' ORDER BY created_at DESC, id DESC LIMIT 25`,
      );
      expect(page.map((r) => String(r["QUERY PLAN"])).join("\n")).toContain("customers_company_created_idx");
    });
  });
});

describe("migration 0002 on existing data", () => {
  it("backfills bookings.list_price_paise from flat_snapshot and site visit manage-link expiry", async () => {
    const name = `kkt_h0_backfill_${Date.now().toString(36)}`;
    const admin = postgres(withDatabase(TEST_DATABASE_URL, "postgres"), { max: 1, onnotice: () => undefined });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = withDatabase(TEST_DATABASE_URL, name);
    try {
      // Bring the database to 0001, add data in the 0001 shape, then apply 0002.
      const fresh = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const journal = await import("node:fs/promises").then((fs) =>
          fs.readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
        );
        const entries = (JSON.parse(journal) as { entries: { tag: string }[] }).entries;
        expect(entries.map((e) => e.tag).slice(0, 3)).toEqual([
          "0000_initial",
          "0001_central_fixes",
          "0002_foundation_hardening",
        ]);
        const { readMigrationFiles } = await import("drizzle-orm/migrator");
        const { MIGRATIONS_FOLDER } = await import("../src/migrate.js");
        const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
        await fresh.unsafe("CREATE EXTENSION IF NOT EXISTS citext");
        await fresh.unsafe(
          `CREATE SCHEMA IF NOT EXISTS drizzle; CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
        );
        for (const m of migrations.slice(0, 2)) {
          for (const stmt of m.sql) await fresh.unsafe(stmt);
          await fresh`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${m.hash}, ${m.folderMillis})`;
        }
        // Raw SQL in the 0001 shape (the Drizzle schema already names 0002 columns, so its inserts would fail here).
        const [c] = await fresh<{ id: string }[]>`INSERT INTO companies (name) VALUES ('Backfill Co') RETURNING id`;
        const companyId = c!.id;
        const [bt] = await fresh<
          { id: string }[]
        >`INSERT INTO block_types (company_id, name, code) VALUES (${companyId}, 'Tower', 'T') RETURNING id`;
        const [ft] = await fresh<{ id: string }[]>`
          INSERT INTO flat_types (company_id, name, code, carpet_sqft, builtup_sqft, super_builtup_sqft) VALUES (${companyId}, '2BHK', '2BHK', 800, 900, 1000) RETURNING id`;
        const [pl] = await fresh<{ id: string }[]>`
          INSERT INTO payment_plans (company_id, name, code, plan_type) VALUES (${companyId}, 'CLP', 'CLP', 'CONSTRUCTION_LINKED') RETURNING id`;
        const [pr] = await fresh<
          { id: string }[]
        >`INSERT INTO projects (company_id, name, code) VALUES (${companyId}, 'P', 'P') RETURNING id`;
        const [bl] = await fresh<{ id: string }[]>`
          INSERT INTO blocks (company_id, project_id, block_type_id, name, code) VALUES (${companyId}, ${pr!.id}, ${bt!.id}, 'A', 'A') RETURNING id`;
        const [fl] = await fresh<{ id: string }[]>`
          INSERT INTO flats (company_id, project_id, block_id, flat_number, floor, flat_type_id, flat_type_code, price_paise)
          VALUES (${companyId}, ${pr!.id}, ${bl!.id}, 'A-101', 1, ${ft!.id}, '2BHK', 1000000000) RETURNING id`;
        const [cu] = await fresh<{ id: string }[]>`
          INSERT INTO customers (company_id, customer_code, full_name, phone) VALUES (${companyId}, 'C1', 'Asha', '9876543210') RETURNING id`;
        const snapshot = {
          flat_number: "A-101",
          floor: 1,
          flat_type_id: ft!.id,
          flat_type_code: "2BHK",
          carpet_sqft: 800,
          builtup_sqft: 900,
          super_builtup_sqft: 1000,
          price_paise: 1000000000,
          price_breakup: [],
          rooms: [],
          areas: [],
        };
        await fresh`
          INSERT INTO bookings (company_id, booking_number, project_id, block_id, flat_id, customer_id, booking_date, agreement_value_paise, cash_agreed_paise,
            account_agreed_paise, flat_snapshot, payment_plan_id, plan_snapshot)
          VALUES (${companyId}, 'BK-1', ${pr!.id}, ${bl!.id}, ${fl!.id}, ${cu!.id}, '2025-06-01', 950000000, 450000000, 500000000,
            ${fresh.json(snapshot)}, ${pl!.id}, ${fresh.json({ installments: [] })})`;
        await fresh`
          INSERT INTO site_visits (company_id, visit_number, project_id, visit_date, slot_start, slot_end, name, phone, manage_token_hash)
          VALUES (${companyId}, 'SV-1', ${pr!.id}, '2025-07-10', '11:00', '12:00', 'Visitor', '9811111111', 'hash')`;
      } finally {
        await fresh.end({ timeout: 5 });
      }
      await runMigrations(url);
      const after = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const [b] = await after<{ list_price_paise: number | string }[]>`SELECT list_price_paise FROM bookings`;
        expect(Number(b?.list_price_paise)).toBe(10_000_000_00); // the offered price, not the (lower) agreement value
        const [v] = await after<
          { expires: string }[]
        >`SELECT to_char(manage_token_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS expires FROM site_visits`;
        expect(v?.expires).toBe("2025-07-11T06:30"); // 12:00 IST on 10 Jul + 1 day = 06:30 UTC on 11 Jul
      } finally {
        await after.end({ timeout: 5 });
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  });
});

describe("migration advisory lock", () => {
  it("three concurrent runMigrations on an empty database serialise and all succeed", async () => {
    const name = `kkt_h0_race_${Date.now().toString(36)}`;
    const admin = postgres(withDatabase(TEST_DATABASE_URL, "postgres"), { max: 1, onnotice: () => undefined });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = withDatabase(TEST_DATABASE_URL, name);
    try {
      await Promise.all([runMigrations(url), runMigrations(url), runMigrations(url)]);
      const db = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const [j] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
        const { readMigrationFiles } = await import("drizzle-orm/migrator");
        const { MIGRATIONS_FOLDER } = await import("../src/migrate.js");
        // every committed migration (0000 … latest), each applied exactly once
        expect(j?.n).toBe(readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length);
        const [locks] = await db<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
        expect(locks?.n).toBe(0);
      } finally {
        await db.end({ timeout: 5 });
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  });

  it("withSessionAdvisoryLock blocks a second holder until the first finishes, and releases on error", async () => {
    const a = createDb(TEST_DATABASE_URL, { max: 2 });
    const b = createDb(TEST_DATABASE_URL, { max: 2 });
    try {
      const order: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const first = withSessionAdvisoryLock(a, "kkt:test-lock", async () => {
        order.push("a:start");
        await gate;
        order.push("a:end");
      });
      await new Promise((r) => setTimeout(r, 50));
      const second = withSessionAdvisoryLock(b, "kkt:test-lock", async () => {
        order.push("b:start");
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(order).toEqual(["a:start"]);
      release();
      await Promise.all([first, second]);
      expect(order).toEqual(["a:start", "a:end", "b:start"]);
      await expect(
        withSessionAdvisoryLock(a, "kkt:test-lock", async () => Promise.reject(new Error("boom"))),
      ).rejects.toThrow("boom");
      await expect(withSessionAdvisoryLock(b, "kkt:test-lock", async () => "free")).resolves.toBe("free");
      const single = createDb(TEST_DATABASE_URL, { max: 1 });
      await expect(withSessionAdvisoryLock(single, "x", async () => 1)).rejects.toThrow(/at least 2 connections/);
      await single.close();
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe("connection timeouts", () => {
  it("reads DB_* variables with safe defaults and ignores invalid values", () => {
    expect(dbTimeoutsFromEnv({})).toEqual(DEFAULT_DB_TIMEOUTS);
    expect(DEFAULT_DB_TIMEOUTS).toEqual({
      statementTimeoutMs: 15_000,
      lockTimeoutMs: 5_000,
      idleInTransactionTimeoutMs: 30_000,
      connectTimeoutS: 10,
    });
    expect(
      dbTimeoutsFromEnv({
        DB_STATEMENT_TIMEOUT_MS: "2500",
        DB_LOCK_TIMEOUT_MS: "0",
        DB_IDLE_IN_TX_TIMEOUT_MS: "abc",
        DB_CONNECT_TIMEOUT_S: "0",
      }),
    ).toEqual({
      statementTimeoutMs: 2500,
      lockTimeoutMs: 0,
      idleInTransactionTimeoutMs: 30_000,
      connectTimeoutS: 10,
    });
  });

  it("every pooled connection carries statement/lock/idle-in-transaction limits; timeouts:false sends none", async () => {
    const h = createDb(TEST_DATABASE_URL, { max: 1 });
    const off = createDb(TEST_DATABASE_URL, { max: 1, timeouts: false });
    const custom = createDb(TEST_DATABASE_URL, { max: 1, timeouts: { statementTimeoutMs: 200 } });
    try {
      const show = async (x: DbHandle) => {
        const [r] = await x.sql<{ s: string; l: string; i: string }[]>`
          SELECT current_setting('statement_timeout') AS s, current_setting('lock_timeout') AS l, current_setting('idle_in_transaction_session_timeout') AS i`;
        return r;
      };
      expect(await show(h)).toEqual({ s: "15s", l: "5s", i: "30s" });
      expect(await show(off)).toEqual({ s: "0", l: "0", i: "0" });
      expect((await show(custom))?.s).toBe("200ms");
      await rejectsWithPg(custom.sql`SELECT pg_sleep(1)`, /statement timeout/);
    } finally {
      await h.close();
      await off.close();
      await custom.close();
    }
  });
});

describe("withTransactionRetry", () => {
  let handle: DbHandle;
  let fx: Fixture;

  beforeAll(async () => {
    handle = createDb(TEST_DATABASE_URL, { max: 6 });
    fx = await createFixture(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("finds the SQLSTATE through Drizzle's cause chain and only for 40001/40P01", () => {
    expect(retryableTransactionError({ code: "40001" })).toBe("40001");
    expect(retryableTransactionError(new Error("wrapped", { cause: { code: "40P01" } }))).toBe("40P01");
    expect(retryableTransactionError({ code: "23505" })).toBeNull();
    expect(retryableTransactionError(new Error("plain"))).toBeNull();
    expect(retryableTransactionError(null)).toBeNull();
  });

  it("re-runs the whole transaction after a real deadlock, so both sides of an opposite lock order commit", async () => {
    const [p2] = await handle.db
      .insert(parkingSlots)
      .values({ companyId: fx.companyId, projectId: fx.projectId, number: "DL-2" })
      .returning({ id: parkingSlots.id });
    const [p1] = await handle.db
      .insert(parkingSlots)
      .values({ companyId: fx.companyId, projectId: fx.projectId, number: "DL-1" })
      .returning({ id: parkingSlots.id });
    const lockBoth = (firstId: string, secondId: string, label: string, retries: { n: number }) =>
      withTransactionRetry(
        handle.db,
        async (tx, attempt) => {
          if (attempt > 0) retries.n += 1;
          await tx.execute(sql`UPDATE parking_slots SET level = ${label} WHERE id = ${firstId}`);
          await tx.execute(sql`SELECT pg_sleep(0.2)`);
          await tx.execute(sql`UPDATE parking_slots SET level = ${label} WHERE id = ${secondId}`);
          return label;
        },
        { baseDelayMs: 10 },
      );
    const ra = { n: 0 };
    const rb = { n: 0 };
    const results = await Promise.all([lockBoth(p1!.id, p2!.id, "A", ra), lockBoth(p2!.id, p1!.id, "B", rb)]);
    expect(results).toEqual(["A", "B"]);
    expect(ra.n + rb.n).toBeGreaterThanOrEqual(1);
  });

  it("retries serialization failures up to `retries` times with jittered backoff, then rethrows", async () => {
    let calls = 0;
    const delays: number[] = [];
    const err = Object.assign(new Error("could not serialize access"), { code: "40001" });
    await expect(
      withTransactionRetry(
        handle.db,
        async () => {
          calls += 1;
          throw err;
        },
        { retries: 2, baseDelayMs: 100, maxDelayMs: 150, sleep: async (ms) => void delays.push(ms) },
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThan(100);
    expect(delays[1]).toBeLessThan(150);

    let n = 0;
    const seen: number[] = [];
    await expect(
      withTransactionRetry(
        handle.db,
        async (tx, attempt) => {
          n += 1;
          if (n < 3) throw Object.assign(new Error("deadlock"), { code: "40P01" });
          const [r] = await tx.execute<{ one: number }>(sql`SELECT 1 AS one`);
          return { attempt, one: Number(r?.one) };
        },
        { onRetry: (i) => void seen.push(i.attempt), sleep: async () => undefined },
      ),
    ).resolves.toEqual({ attempt: 2, one: 1 });
    expect(seen).toEqual([1, 2]);
  });

  it("never retries any other error and rolls the failed attempt back", async () => {
    let calls = 0;
    await expect(
      withTransactionRetry(handle.db, async (tx) => {
        calls += 1;
        await tx.execute(sql`UPDATE flats SET notes = 'should roll back' WHERE id = ${fx.flatId}`);
        await tx.execute(sql`UPDATE flats SET price_paise = -1 WHERE id = ${fx.flatId}`);
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    const [row] = await handle.db
      .select({ notes: flats.notes })
      .from(flats)
      .where(sql`${flats.id} = ${fx.flatId}`);
    expect(row?.notes).toBeNull();
    let calls2 = 0;
    await expect(
      withTransactionRetry(handle.db, async () => {
        calls2 += 1;
        throw Object.assign(new Error("lock timeout"), { code: "55P03" });
      }),
    ).rejects.toThrow("lock timeout");
    expect(calls2).toBe(1);
  });
});
