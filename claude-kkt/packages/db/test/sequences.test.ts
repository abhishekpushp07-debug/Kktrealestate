import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, nextSequence, withAdvisoryLock, type DbHandle } from "../src/client.js";
import { companies, sequences } from "../src/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const CONCURRENCY = 50;

describe("sequences and advisory locks", () => {
  let handle: DbHandle;
  let companyId: string;

  beforeAll(async () => {
    // One connection per concurrent caller so the 50 calls really race.
    handle = createDb(TEST_DATABASE_URL, { max: CONCURRENCY });
    const [company] = await handle.db.insert(companies).values({ name: "Sequence Co" }).returning({ id: companies.id });
    if (!company) throw new Error("company insert failed");
    companyId = company.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  it(`nextSequence is atomic under ${CONCURRENCY} concurrent transactions on separate connections (no duplicates, contiguous)`, async () => {
    const calls = Array.from({ length: CONCURRENCY }, () =>
      handle.db.transaction(async (tx) => {
        const pidRows = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        const value = await nextSequence(tx, companyId, "receipt", "2526");
        await sleep(5); // hold the row lock a little so transactions overlap
        return { value, pid: Number(pidRows[0]?.pid) };
      }),
    );
    const results = await Promise.all(calls);
    const values = results.map((r) => r.value).sort((a, b) => a - b);
    expect(new Set(values).size).toBe(CONCURRENCY);
    expect(values).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
    // The race is only real if the transactions ran on distinct backend connections.
    const pids = new Set(results.map((r) => r.pid));
    expect(pids.size).toBe(CONCURRENCY);

    const [row] = await handle.db
      .select({ value: sequences.value })
      .from(sequences)
      .where(
        sql`${sequences.companyId} = ${companyId} AND ${sequences.scope} = 'receipt' AND ${sequences.fy} = '2526'`,
      );
    expect(row?.value).toBe(CONCURRENCY);
  });

  it("a rolled-back transaction does not consume a number permanently (the row lock serialises callers)", async () => {
    const before = await handle.db.transaction((tx) => nextSequence(tx, companyId, "demand", "2526"));
    expect(before).toBe(1);
    await expect(
      handle.db.transaction(async (tx) => {
        await nextSequence(tx, companyId, "demand", "2526");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const after = await handle.db.transaction((tx) => nextSequence(tx, companyId, "demand", "2526"));
    expect(after).toBe(2);
  });

  it("sequences per financial year, per scope and per company are independent", async () => {
    const a = await handle.db.transaction((tx) => nextSequence(tx, companyId, "receipt", "2627"));
    const b = await handle.db.transaction((tx) => nextSequence(tx, companyId, "receipt", "2627"));
    const c = await handle.db.transaction((tx) => nextSequence(tx, companyId, "booking", "2526"));
    const d = await handle.db.transaction((tx) => nextSequence(tx, companyId, "receipt", "2526"));
    expect([a, b]).toEqual([1, 2]);
    expect(c).toBe(1);
    expect(d).toBe(CONCURRENCY + 1);

    const [other] = await handle.db.insert(companies).values({ name: "Other Co" }).returning({ id: companies.id });
    if (!other) throw new Error("company insert failed");
    expect(await handle.db.transaction((tx) => nextSequence(tx, other.id, "receipt", "2526"))).toBe(1);
  });

  it("nextSequence also works outside an explicit transaction (single atomic statement)", async () => {
    expect(await nextSequence(handle.db, companyId, "ticket", "2526")).toBe(1);
    expect(await nextSequence(handle.db, companyId, "ticket", "2526")).toBe(2);
  });

  it("withAdvisoryLock serialises transactions on the same key", async () => {
    const log: string[] = [];
    const key = `booking:${companyId}`;

    const first = handle.db.transaction(async (tx) => {
      await withAdvisoryLock(tx, key);
      log.push("A:acquired");
      await sleep(150);
      log.push("A:released");
    });
    await sleep(30); // make sure A holds the lock before B asks for it
    const second = handle.db.transaction(async (tx) => {
      log.push("B:waiting");
      await withAdvisoryLock(tx, key);
      log.push("B:acquired");
    });
    await Promise.all([first, second]);

    expect(log).toEqual(["A:acquired", "B:waiting", "A:released", "B:acquired"]);
  });

  it("withAdvisoryLock on different keys does not block", async () => {
    const started = Date.now();
    await Promise.all(
      ["k1", "k2", "k3"].map((k) =>
        handle.db.transaction(async (tx) => {
          await withAdvisoryLock(tx, k);
          await sleep(100);
        }),
      ),
    );
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("withAdvisoryLock is released at COMMIT (a later transaction acquires it immediately)", async () => {
    const key = "release-check";
    await handle.db.transaction((tx) => withAdvisoryLock(tx, key));
    const started = Date.now();
    await handle.db.transaction((tx) => withAdvisoryLock(tx, key));
    expect(Date.now() - started).toBeLessThan(100);
  });
});
