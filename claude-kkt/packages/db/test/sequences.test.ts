import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, nextSequence, withAdvisoryLock, type DbHandle } from "../src/client.js";
import { companies } from "../src/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("sequences and advisory locks", () => {
  let handle: DbHandle;
  let companyId: string;

  beforeAll(async () => {
    // One connection per concurrent caller so the 50 calls really race.
    handle = createDb(TEST_DATABASE_URL, { max: 50 });
    const [company] = await handle.db.insert(companies).values({ name: "Sequence Co" }).returning({ id: companies.id });
    if (!company) throw new Error("company insert failed");
    companyId = company.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  it("nextSequence is atomic under 50 concurrent transactions (no duplicates, contiguous)", async () => {
    const calls = Array.from({ length: 50 }, () =>
      handle.db.transaction(async (tx) => {
        const value = await nextSequence(tx, companyId, "receipt", "2526");
        await sleep(5); // hold the row lock a little so transactions overlap
        return value;
      }),
    );
    const values = (await Promise.all(calls)).sort((a, b) => a - b);
    expect(new Set(values).size).toBe(50);
    expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("sequences per financial year and per scope are independent", async () => {
    const a = await handle.db.transaction((tx) => nextSequence(tx, companyId, "receipt", "2627"));
    const b = await handle.db.transaction((tx) => nextSequence(tx, companyId, "receipt", "2627"));
    const c = await handle.db.transaction((tx) => nextSequence(tx, companyId, "booking", "2526"));
    const d = await handle.db.transaction((tx) => nextSequence(tx, companyId, "receipt", "2526"));
    expect([a, b]).toEqual([1, 2]);
    expect(c).toBe(1);
    expect(d).toBe(51);
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
});
