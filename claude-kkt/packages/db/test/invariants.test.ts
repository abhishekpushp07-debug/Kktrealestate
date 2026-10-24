import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client.js";
import { bankAccounts, constructionStages, demands, paymentPlanAssignments, rateCards } from "../src/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";
import { createBooking, createFixture, type Fixture } from "./fixtures.js";
import { rejectsWithPg } from "./util.js";

const UNIQUE_VIOLATION = /duplicate key value violates unique constraint/;

describe("database-enforced invariants", () => {
  let handle: DbHandle;
  let fx: Fixture;

  beforeAll(async () => {
    handle = createDb(TEST_DATABASE_URL, { max: 4 });
    fx = await createFixture(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("rejects a second ACTIVE booking on the same flat but allows a CANCELLED one", async () => {
    await rejectsWithPg(createBooking(handle.db, fx, "ACTIVE"), UNIQUE_VIOLATION);
    await expect(createBooking(handle.db, fx, "CANCELLED")).resolves.toMatch(/^[0-9a-f-]{36}$/);
    await expect(createBooking(handle.db, fx, "COMPLETED")).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a second non-void demand for the same (booking, seq) while a VOID one is allowed", async () => {
    const base = {
      companyId: fx.companyId,
      bookingId: fx.bookingId,
      projectId: fx.projectId,
      blockId: fx.blockId,
      customerId: fx.customerId,
      installmentSeq: 1,
      installmentName: "On booking",
      triggerType: "ON_BOOKING" as const,
      percent: 10,
      cumulativePercent: 10,
      cashDemandPaise: 600_000_00,
      accountDemandPaise: 400_000_00,
      totalDemandPaise: 1_000_000_00,
      demandDate: "2025-06-01",
      dueDate: "2025-06-16",
    };
    const insert = (demandNumber: string, status: "OPEN" | "PAID" | "VOID", installmentSeq = 1) =>
      handle.db.insert(demands).values({ ...base, demandNumber, status, installmentSeq, voidReason: status === "VOID" ? "undo" : null });

    await insert("DM-2526/0001", "OPEN");
    await rejectsWithPg(insert("DM-2526/0002", "OPEN"), UNIQUE_VIOLATION);
    await rejectsWithPg(insert("DM-2526/0003", "PAID"), UNIQUE_VIOLATION);
    await expect(insert("DM-2526/0004", "VOID")).resolves.toBeDefined();
    await expect(insert("DM-2526/0005", "VOID")).resolves.toBeDefined();
    // a different installment seq is fine
    await expect(insert("DM-2526/0006", "OPEN", 2)).resolves.toBeDefined();
    // demand numbers are unique per company
    await rejectsWithPg(insert("DM-2526/0006", "OPEN", 3), UNIQUE_VIOLATION);
  });

  it("allows only one ACTIVE rate card per project", async () => {
    const card = { companyId: fx.companyId, projectId: fx.projectId, name: "RC", effectiveFrom: "2025-04-01" };
    await handle.db.insert(rateCards).values({ ...card, status: "ACTIVE" });
    await rejectsWithPg(handle.db.insert(rateCards).values({ ...card, status: "ACTIVE" }), UNIQUE_VIOLATION);
    await expect(handle.db.insert(rateCards).values({ ...card, status: "SUPERSEDED" })).resolves.toBeDefined();
    await expect(handle.db.insert(rateCards).values({ ...card, status: "DRAFT" })).resolves.toBeDefined();
  });

  it("allows only one default bank account and one possession stage per company", async () => {
    const acct = {
      companyId: fx.companyId,
      bankName: "SBI",
      accountName: "Test Builders",
      accountNumberEnc: "enc",
      accountNumberLast4: "1234",
      ifsc: "SBIN0001234",
    };
    await handle.db.insert(bankAccounts).values({ ...acct, isDefault: true });
    await rejectsWithPg(handle.db.insert(bankAccounts).values({ ...acct, isDefault: true }), UNIQUE_VIOLATION);
    await expect(handle.db.insert(bankAccounts).values({ ...acct, isDefault: false })).resolves.toBeDefined();

    await handle.db.insert(constructionStages).values({ companyId: fx.companyId, name: "Possession", code: "POSSESSION", isPossession: true });
    await rejectsWithPg(
      handle.db.insert(constructionStages).values({ companyId: fx.companyId, name: "Handover", code: "HANDOVER", isPossession: true }),
      UNIQUE_VIOLATION,
    );
    await expect(
      handle.db.insert(constructionStages).values({ companyId: fx.companyId, name: "Finishing", code: "FINISHING", isPossession: false }),
    ).resolves.toBeDefined();
  });

  it("treats NULL block_id as a value in payment_plan_assignments uniqueness", async () => {
    const row = { companyId: fx.companyId, planId: fx.planId, projectId: fx.projectId, blockId: null };
    await handle.db.insert(paymentPlanAssignments).values(row);
    await rejectsWithPg(handle.db.insert(paymentPlanAssignments).values(row), UNIQUE_VIOLATION);
    await expect(handle.db.insert(paymentPlanAssignments).values({ ...row, blockId: fx.blockId })).resolves.toBeDefined();
  });

  it("enforces the CHECK constraints (payments amount > 0 is covered by the schema; visitors 1..6)", async () => {
    await rejectsWithPg(
      handle.sql`INSERT INTO site_visits (company_id, visit_number, project_id, visit_date, slot_start, slot_end, visitors, name, phone)
                 VALUES (${fx.companyId}, 'SV-X', ${fx.projectId}, '2025-07-01', '10:00', '11:00', 7, 'V', '9876543210')`,
      /site_visits_visitors_chk/,
    );
    await rejectsWithPg(
      handle.sql`INSERT INTO payments (company_id, booking_id, project_id, block_id, customer_id, receipt_number, amount_paise, payment_date, payment_mode_id, mode_code)
                 VALUES (${fx.companyId}, ${fx.bookingId}, ${fx.projectId}, ${fx.blockId}, ${fx.customerId}, 'R-X', 0, '2025-07-01', gen_random_uuid(), 'CASH')`,
      /payments_amount_positive_chk/,
    );
  });
});
