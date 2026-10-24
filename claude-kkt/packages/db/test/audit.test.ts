import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DbHandle } from "../src/client.js";
import { auditLogs, companies } from "../src/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";
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
      .values({ companyId: company.id, actorType: "SYSTEM", action: "test.create", entityType: "test", after: { ok: true } })
      .returning({ id: auditLogs.id });
    if (!row) throw new Error("audit insert failed");
    auditId = row.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  it("rejects UPDATE", async () => {
    await rejectsWithPg(handle.db.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.id, auditId)), /immutable/);
  });

  it("rejects DELETE", async () => {
    await rejectsWithPg(handle.db.delete(auditLogs).where(eq(auditLogs.id, auditId)), /immutable/);
    const rows = await handle.db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, auditId));
    expect(rows).toHaveLength(1);
  });
});
