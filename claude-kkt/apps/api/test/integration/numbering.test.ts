import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe("numbering and company cache", () => {
  it("allocates FY-scoped numbers per scope with the company's prefixes and pattern", async () => {
    const { nextNumber } = await import("../../src/lib/numbering.js");
    const { loadCompany } = await import("../../src/lib/company.js");
    const company = await loadCompany(t.app.db, t.app.redis, t.companyId);
    expect(company.name).toBe("Shree Ganesh Builders");
    const numbers = await t.app.db.transaction(async (tx) =>
      Promise.all([
        nextNumber(tx, company, "customer", "2025-06-15"),
        nextNumber(tx, company, "customer", "2025-06-16"),
        nextNumber(tx, company, "booking", "2025-06-15"),
        nextNumber(tx, company, "demand", "2026-03-31"),
        nextNumber(tx, company, "receipt", "2025-04-01"),
        nextNumber(tx, company, "ticket", "2025-06-15"),
        nextNumber(tx, company, "visit", "2026-04-01"),
      ]),
    );
    expect(numbers).toEqual([
      "CUST-2526/0001",
      "CUST-2526/0002",
      "BK-2526/0001",
      "DM-2526/0001",
      "SGB/2526/0001",
      "SR-2526/0001",
      "SV-2627/0001",
    ]);
    // concurrent allocations never collide
    const burst = await Promise.all(
      Array.from({ length: 25 }, () => t.app.db.transaction((tx) => nextNumber(tx, company, "receipt", "2025-05-05"))),
    );
    expect(new Set(burst).size).toBe(25);
    // company settings are cached for 30 s and invalidated explicitly
    await t.app.sql`update companies set name = 'Renamed Builders' where id = ${t.companyId}`;
    expect((await loadCompany(t.app.db, t.app.redis, t.companyId)).name).toBe("Shree Ganesh Builders");
    const { invalidateCompany } = await import("../../src/lib/company.js");
    await invalidateCompany(t.app.redis, t.companyId);
    expect((await loadCompany(t.app.db, t.app.redis, t.companyId)).name).toBe("Renamed Builders");
  });
});
