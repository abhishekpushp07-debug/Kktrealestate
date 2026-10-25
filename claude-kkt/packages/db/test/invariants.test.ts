import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client.js";
import { bankAccounts, blockTypes, companies, constructionStages, demands, paymentPlanAssignments, projectWebsiteSettings, projects, rateCards } from "../src/schema/index.js";
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

  it("scopes business-key uniqueness by company: the same code is fine in another company, a duplicate in the same company is not", async () => {
    const [other] = await handle.db.insert(companies).values({ name: "Other Builders" }).returning({ id: companies.id });
    if (!other) throw new Error("company insert failed");
    await expect(handle.db.insert(blockTypes).values({ companyId: other.id, name: "Tower", code: "TOWER" })).resolves.toBeDefined();
    await expect(handle.db.insert(blockTypes).values({ companyId: fx.companyId, name: "Tower", code: "TOWER" })).resolves.toBeDefined();
    await rejectsWithPg(handle.db.insert(blockTypes).values({ companyId: fx.companyId, name: "Tower 2", code: "TOWER" }), UNIQUE_VIOLATION);
    await expect(handle.db.insert(projects).values({ companyId: other.id, name: "Twin", code: "PRJ-TWIN" })).resolves.toBeDefined();
    await expect(handle.db.insert(projects).values({ companyId: fx.companyId, name: "Twin", code: "PRJ-TWIN" })).resolves.toBeDefined();
    await rejectsWithPg(handle.db.insert(projects).values({ companyId: fx.companyId, name: "Twin 2", code: "PRJ-TWIN" }), UNIQUE_VIOLATION);
    // a second possession stage is fine in another company (the partial unique is per company)
    await expect(
      handle.db.insert(constructionStages).values({ companyId: other.id, name: "Possession", code: "POSSESSION", isPossession: true }),
    ).resolves.toBeDefined();
  });

  it("website slugs are globally unique (they are URLs) while NULL slugs are allowed on many projects", async () => {
    const [p1] = await handle.db.insert(projects).values({ companyId: fx.companyId, name: "Slug 1", code: "SLUG-1" }).returning({ id: projects.id });
    const [p2] = await handle.db.insert(projects).values({ companyId: fx.companyId, name: "Slug 2", code: "SLUG-2" }).returning({ id: projects.id });
    const [p3] = await handle.db.insert(projects).values({ companyId: fx.companyId, name: "Slug 3", code: "SLUG-3" }).returning({ id: projects.id });
    if (!p1 || !p2 || !p3) throw new Error("project insert failed");
    await handle.db.insert(projectWebsiteSettings).values({ projectId: p1.id, slug: "ganesh-heights" });
    await rejectsWithPg(handle.db.insert(projectWebsiteSettings).values({ projectId: p2.id, slug: "ganesh-heights" }), UNIQUE_VIOLATION);
    await expect(handle.db.insert(projectWebsiteSettings).values({ projectId: p2.id, slug: null })).resolves.toBeDefined();
    await expect(handle.db.insert(projectWebsiteSettings).values({ projectId: p3.id, slug: null })).resolves.toBeDefined();
    // one settings row per project
    await rejectsWithPg(handle.db.insert(projectWebsiteSettings).values({ projectId: p1.id, slug: "other" }), UNIQUE_VIOLATION);
  });

  it("enforces slot_minutes IN (30, 60) and rating 1..5 (NULL rating allowed)", async () => {
    await rejectsWithPg(
      handle.sql`INSERT INTO project_visit_settings (project_id, slot_minutes) VALUES (${fx.projectId}, 45)`,
      /project_visit_settings_slot_minutes_chk/,
    );
    await expect(handle.sql`INSERT INTO project_visit_settings (project_id, slot_minutes) VALUES (${fx.projectId}, 30)`).resolves.toBeDefined();
    const [category] = await handle.sql<{ id: string }[]>`INSERT INTO service_categories (company_id, name) VALUES (${fx.companyId}, 'Defect/Snag') RETURNING id`;
    const ticket = (n: number, rating: number | null) =>
      handle.sql`INSERT INTO service_requests (company_id, ticket_number, customer_id, category_id, subject, rating)
                 VALUES (${fx.companyId}, ${"SR-" + String(n)}, ${fx.customerId}, ${category!.id}, 'Leak', ${rating})`;
    // category_id is NOT NULL (docs/TODO-integration.md item 11)
    await rejectsWithPg(handle.sql`INSERT INTO service_requests (company_id, ticket_number, customer_id, subject) VALUES (${fx.companyId}, 'SR-0', ${fx.customerId}, 'No category')`, /category_id/);
    await rejectsWithPg(ticket(1, 0), /service_requests_rating_chk/);
    await rejectsWithPg(ticket(2, 6), /service_requests_rating_chk/);
    await expect(ticket(3, 5)).resolves.toBeDefined();
    await expect(ticket(4, null)).resolves.toBeDefined();
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
    await rejectsWithPg(
      handle.sql`INSERT INTO payments (company_id, booking_id, project_id, block_id, customer_id, receipt_number, amount_paise, payment_date, payment_mode_id, mode_code)
                 VALUES (${fx.companyId}, ${fx.bookingId}, ${fx.projectId}, ${fx.blockId}, ${fx.customerId}, 'R-Y', -500, '2025-07-01', gen_random_uuid(), 'CASH')`,
      /payments_amount_positive_chk/,
    );
    await rejectsWithPg(
      handle.sql`INSERT INTO contra_entries (company_id, entry_date, type, amount_paise) VALUES (${fx.companyId}, '2025-07-01', 'DEPOSIT', 0)`,
      /contra_entries_amount_positive_chk/,
    );
  });

  it("stores paise as exact integers up to the ₹1 Cr scale and beyond (bigint, read back as number)", async () => {
    const big = 9_007_199_254_740_991; // 2^53 - 1: the largest exactly representable JS integer
    const [row] = await handle.sql<{ v: number }[]>`SELECT ${big}::bigint AS v`;
    expect(row?.v).toBe(big);
    const [paise] = await handle.sql<{ v: number }[]>`SELECT 1000000000::bigint AS v`; // ₹1,00,00,000 = 10^9 paise
    expect(paise?.v).toBe(1_000_000_000);
    expect(typeof paise?.v).toBe("number");
  });
});
