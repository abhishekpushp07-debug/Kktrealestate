import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DbHandle } from "../src/client.js";
import { auditLogs, companies, demands, payments } from "../src/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";
import { createFixture, type Fixture } from "./fixtures.js";
import { rejectsWithPg } from "./util.js";

describe("audit_logs immutability", () => {
  let handle: DbHandle;
  let auditId: string;

  beforeAll(async () => {
    handle = createDb(TEST_DATABASE_URL, { max: 2 });
    const [company] = await handle.db.insert(companies).values({ name: "Audit Co" }).returning({ id: companies.id });
    if (!company) throw new Error("company insert failed");
    const [row] = await handle.db
      .insert(auditLogs)
      .values({
        companyId: company.id,
        actorType: "SYSTEM",
        action: "test.create",
        entityType: "test",
        after: { ok: true },
      })
      .returning({ id: auditLogs.id });
    if (!row) throw new Error("audit insert failed");
    auditId = row.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  const countRows = async (): Promise<number> => {
    const rows = await handle.db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, auditId));
    return rows.length;
  };

  it("rejects UPDATE through Drizzle and through raw SQL", async () => {
    await rejectsWithPg(
      handle.db.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.id, auditId)),
      /immutable/,
    );
    await rejectsWithPg(
      handle.sql`UPDATE audit_logs SET action = 'tampered' WHERE id = ${auditId}`,
      /immutable: UPDATE/,
    );
    const [row] = await handle.db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.id, auditId));
    expect(row?.action).toBe("test.create");
  });

  it("rejects DELETE through Drizzle and through raw SQL", async () => {
    await rejectsWithPg(handle.db.delete(auditLogs).where(eq(auditLogs.id, auditId)), /immutable/);
    await rejectsWithPg(handle.sql`DELETE FROM audit_logs WHERE id = ${auditId}`, /immutable: DELETE/);
    await rejectsWithPg(handle.sql`DELETE FROM audit_logs`, /immutable: DELETE/);
    expect(await countRows()).toBe(1);
  });

  it("rejects TRUNCATE (row triggers do not fire on TRUNCATE, so this needs its own guard)", async () => {
    await rejectsWithPg(handle.sql`TRUNCATE audit_logs`, /immutable: TRUNCATE/);
    await rejectsWithPg(handle.sql`TRUNCATE TABLE audit_logs CASCADE`, /immutable: TRUNCATE/);
    expect(await countRows()).toBe(1);
  });

  it("rolls the whole transaction back when it contains an audit tamper", async () => {
    const [company] = await handle.db.insert(companies).values({ name: "Audit Tx Co" }).returning({ id: companies.id });
    if (!company) throw new Error("company insert failed");
    await rejectsWithPg(
      handle.db.transaction(async (tx) => {
        await tx.insert(auditLogs).values({ companyId: company.id, actorType: "STAFF", action: "x", entityType: "x" });
        await tx.delete(auditLogs).where(eq(auditLogs.companyId, company.id));
      }),
      /immutable/,
    );
    const rows = await handle.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.companyId, company.id));
    expect(rows).toHaveLength(0);
  });

  it("still allows INSERT (append-only, not read-only)", async () => {
    const [company] = await handle.db
      .insert(companies)
      .values({ name: "Audit Append Co" })
      .returning({ id: companies.id });
    if (!company) throw new Error("company insert failed");
    await expect(
      handle.db
        .insert(auditLogs)
        .values({ companyId: company.id, actorType: "CUSTOMER", action: "portal.login", entityType: "portal_user" }),
    ).resolves.toBeDefined();
  });
});

describe("financial source rows are never deleted", () => {
  let handle: DbHandle;
  let fx: Fixture;

  beforeAll(async () => {
    handle = createDb(TEST_DATABASE_URL, { max: 2 });
    fx = await createFixture(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("rejects DELETE on demands but allows voiding", async () => {
    const [demand] = await handle.db
      .insert(demands)
      .values({
        companyId: fx.companyId,
        bookingId: fx.bookingId,
        projectId: fx.projectId,
        blockId: fx.blockId,
        customerId: fx.customerId,
        demandNumber: `DM-AUDIT-${fx.bookingId.slice(0, 8)}`,
        installmentSeq: 1,
        installmentName: "On booking",
        triggerType: "ON_BOOKING",
        percent: 10,
        cumulativePercent: 10,
        cashDemandPaise: 600_000_00,
        accountDemandPaise: 400_000_00,
        totalDemandPaise: 1_000_000_00,
        demandDate: "2025-06-01",
        dueDate: "2025-06-16",
      })
      .returning({ id: demands.id });
    if (!demand) throw new Error("demand insert failed");
    await rejectsWithPg(handle.db.delete(demands).where(eq(demands.id, demand.id)), /demands rows are never deleted/);
    await expect(
      handle.db
        .update(demands)
        .set({ status: "VOID", voidReason: "stage undone", voidedAt: new Date() })
        .where(eq(demands.id, demand.id)),
    ).resolves.toBeDefined();
  });

  it("rejects DELETE on payments but allows reversal", async () => {
    const [mode] = await handle.sql<{ id: string }[]>`
      INSERT INTO payment_modes (company_id, name, code, is_cash) VALUES (${fx.companyId}, 'Cash', 'CASH', true) RETURNING id`;
    if (!mode) throw new Error("mode insert failed");
    const [payment] = await handle.db
      .insert(payments)
      .values({
        companyId: fx.companyId,
        bookingId: fx.bookingId,
        projectId: fx.projectId,
        blockId: fx.blockId,
        customerId: fx.customerId,
        receiptNumber: `SGB/2526/${fx.bookingId.slice(0, 4)}`,
        against: "FLAT_VALUE",
        bucket: "CASH",
        amountPaise: 100_000_00,
        paymentDate: "2025-06-02",
        paymentModeId: mode.id,
        modeCode: "CASH",
        status: "CLEARED",
      })
      .returning({ id: payments.id });
    if (!payment) throw new Error("payment insert failed");
    await rejectsWithPg(
      handle.db.delete(payments).where(eq(payments.id, payment.id)),
      /payments rows are never deleted/,
    );
    await expect(
      handle.db
        .update(payments)
        .set({ status: "REVERSED", reversalReason: "wrong booking", reversedAt: new Date(), receiptCancelled: true })
        .where(eq(payments.id, payment.id)),
    ).resolves.toBeDefined();
  });
});
