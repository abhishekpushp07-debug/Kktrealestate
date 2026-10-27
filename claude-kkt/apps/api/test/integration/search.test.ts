// A two-connection pool for the app, so timed-out searches and other requests are forced onto the same connections.
process.env["DATABASE_POOL_MAX"] = "2";
import postgres from "postgres";
import { createDb, type DbHandle } from "@kkt/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readWithinBudget } from "../../src/lib/statementBudget.js";
import { buildTestApp, TEST_DATABASE_URL, type TestContext } from "./helpers.js";

/**
 * The search time budget (lib/statementBudget.ts) must only ever stop the search's own statement. The old budget sent an out-of-band
 * cancel request for the backend, which kills whatever that pooled connection runs when the request lands — another request's query when
 * the search had just finished (docs/PERFORMANCE.md, "Reliability fixes"). These tests interleave timed-out statements with other work
 * on a pool of two connections and assert that no foreign statement is ever cancelled and nothing hangs.
 */

let t: TestContext;
let token: string;
let pool: DbHandle;
let admin: postgres.Sql;

/** Rejects when `p` takes longer than `ms`: a hang fails the test instead of stalling the suite. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms (hang)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

beforeAll(async () => {
  t = await buildTestApp();
  token = (await t.loginAs("admin")).access_token;
  pool = createDb(TEST_DATABASE_URL, { max: 2 });
  admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
});
afterAll(async () => {
  await pool?.close();
  await admin?.end({ timeout: 5 });
  await t?.close();
});

describe("statement budget (SET LOCAL statement_timeout, no out-of-band cancel)", () => {
  it("stops a slow statement, returns null, and leaves the connection idle with its own statement_timeout", async () => {
    const one = createDb(TEST_DATABASE_URL, { max: 1 });
    try {
      const before = await one.sql<{ statement_timeout: string }[]>`show statement_timeout`;
      const t0 = performance.now();
      expect(await readWithinBudget(one.sql, "select pg_sleep(2)", [], 50)).toBeNull();
      expect(performance.now() - t0).toBeLessThan(1000);
      // the same (only) connection: the SET LOCAL ended with the transaction (a transaction left open would still show 50ms)
      const after = await one.sql<{ statement_timeout: string }[]>`show statement_timeout`;
      expect(after[0]!.statement_timeout).toBe(before[0]!.statement_timeout);
      // fast statements return their rows; the transaction is read-only
      expect(await readWithinBudget<{ n: number }>(one.sql, "select $1::int as n", [7], 1000)).toEqual([{ n: 7 }]);
      await expect(readWithinBudget(one.sql, "create temp table budget_probe (x int)", [], 1000)).rejects.toMatchObject(
        {
          code: "25006", // read_only_sql_transaction
        },
      );
      expect((await one.sql<{ n: number }[]>`select 1 as n`)[0]!.n).toBe(1);
    } finally {
      await one.close();
    }
  });

  it("stress: 40 rounds of statements timing out around their budget, interleaved with other queries and transactions on a 2-connection pool", async () => {
    const before = await admin<
      { rollbacks: number }[]
    >`select xact_rollback::int as rollbacks from pg_stat_database where datname = current_database()`;
    let timedOut = 0;
    let completed = 0;
    let foreign = 0;
    for (let round = 0; round < 40; round += 1) {
      const work: Promise<unknown>[] = [];
      // budgeted statements that finish just before, at or just after their 25 ms budget: the window in which an out-of-band cancel
      // lands on the next statement of the same connection
      for (let i = 0; i < 4; i += 1) {
        const sleep = (15 + ((round * 7 + i * 5) % 20)) / 1000;
        work.push(
          readWithinBudget<{ ok: number }>(pool.sql, "select pg_sleep($1::float8), 1 as ok", [sleep], 25).then(
            (rows) => {
              if (rows === null) timedOut += 1;
              else {
                expect(rows).toMatchObject([{ ok: 1 }]);
                completed += 1;
              }
            },
          ),
        );
      }
      // other requests' work on the same two connections: pipelined statements and a multi-statement transaction
      for (let i = 0; i < 6; i += 1) {
        const n = round * 100 + i;
        work.push(
          pool.sql.unsafe("select pg_sleep(0.005), $1::int as n", [n]).then((rows) => {
            expect(rows[0]).toMatchObject({ n });
            foreign += 1;
          }),
        );
      }
      work.push(
        pool.sql
          .begin(async (tx) => {
            await tx.unsafe("select pg_sleep(0.01)");
            return tx.unsafe("select $1::int as n", [round]);
          })
          .then((rows) => {
            expect(rows[0]).toMatchObject({ n: round });
            foreign += 1;
          }),
      );
      // any rejection here (57014 on a foreign statement included) fails the test
      await within(Promise.all(work), 10_000, `round ${round}`);
    }
    expect(foreign).toBe(40 * 7);
    expect(timedOut + completed).toBe(40 * 4);
    expect(timedOut).toBeGreaterThan(0);
    expect(completed).toBeGreaterThan(0);
    // each timed-out statement rolled back its own read-only transaction; nothing is left idle in a transaction
    const after = await admin<
      { rollbacks: number }[]
    >`select xact_rollback::int as rollbacks from pg_stat_database where datname = current_database()`;
    expect(after[0]!.rollbacks - before[0]!.rollbacks).toBeGreaterThan(0);
    const stuck = await admin<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`;
    expect(stuck[0]!.n).toBe(0);
  });
  it("tiny budgets that expire on any step never fail and never hand a connection back inside a transaction", async () => {
    // budgets of a few ms expire during the search, during the statement that ends the transaction, or while waiting for a connection;
    // ending the read-only transaction must never leave it open or aborted (the next user would get 25P02)
    const failures: string[] = [];
    let stopped = 0;
    let foreign = 0;
    const deadline = performance.now() + 4000;
    const budgeted = async () => {
      while (performance.now() < deadline) {
        try {
          const rows = await readWithinBudget(
            pool.sql,
            "select pg_sleep($1::float8), 1 as ok",
            [Math.random() * 0.01],
            1 + Math.floor(Math.random() * 6),
          );
          if (rows === null) stopped += 1;
        } catch (e) {
          failures.push(String((e as { code?: string }).code ?? e));
        }
      }
    };
    const other = async () => {
      while (performance.now() < deadline) {
        try {
          await pool.sql`select 1`;
          foreign += 1;
        } catch (e) {
          failures.push(`foreign ${String((e as { code?: string }).code ?? e)}`);
        }
      }
    };
    await within(Promise.all([...Array.from({ length: 12 }, budgeted), other(), other()]), 20_000, "tiny-budget storm");
    expect(failures).toEqual([]);
    expect(stopped).toBeGreaterThan(0);
    expect(foreign).toBeGreaterThan(0);
    const stuck = await admin<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`;
    expect(stuck[0]!.n).toBe(0);
  });
});

describe("GET /search time budget on a 2-connection app pool", () => {
  it("a search blocked past its 150 ms budget answers 200 with no results, and concurrent requests on the same pool all succeed", async () => {
    for (let round = 0; round < 5; round += 1) {
      // hold an exclusive lock on customers so every search (its CUSTOMER branch) blocks until statement_timeout stops it
      const holder = await admin.reserve();
      try {
        await holder.unsafe("begin");
        await holder.unsafe("lock table customers in access exclusive mode");
        const started = performance.now();
        const searches = Array.from({ length: 6 }, () =>
          t.request<{ results: unknown[] }>("GET", "/api/v1/search?q=zz", { token }),
        );
        const others = Array.from({ length: 4 }, (_, i) =>
          t.request(
            "GET",
            i % 2 === 0 ? "/api/v1/masters/payment-modes?page_size=100" : "/api/v1/projects?page_size=5",
            {
              token,
            },
          ),
        );
        const [s, o] = await within(
          Promise.all([Promise.all(searches), Promise.all(others)]),
          10_000,
          `round ${round}`,
        );
        for (const r of s) {
          expect(r.status).toBe(200);
          expect(r.body.results).toEqual([]);
        }
        for (const r of o) expect(r.status).toBe(200);
        // six searches share two connections: each one waits for a connection or for its statement_timeout, never longer
        expect(performance.now() - started).toBeLessThan(5_000);
      } finally {
        await holder.unsafe("rollback").catch(() => undefined);
        holder.release();
      }
    }
    // the pool is healthy afterwards: an unblocked search runs normally
    const ok = await t.request<{ results: unknown[] }>("GET", "/api/v1/search?q=zz", { token });
    expect(ok.status).toBe(200);
  });
});

describe("a timed-out search never touches another session's statement", () => {
  it("a pg_sleep on a second connection, and long statements run right after timed-out searches on the same pooled connections, all survive", async () => {
    // a separate session (its own backend) running a long statement while searches time out all around it
    const other = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
    // `admin` (max 1) is reserved below to hold the table lock, so pg_stat_activity is read on its own connection
    const observer = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
    try {
      const pid = (await other<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]!.pid;
      const sleeper = other<{ slept: number }[]>`select pg_sleep(3), 1 as slept`;
      const sleeperDone = sleeper.then((rows) => rows[0]!.slept);
      // let the sleeper start on its backend
      await new Promise((r) => setTimeout(r, 100));

      // Searches that time out ON the shared pool, each followed by statements queued for the very same connections that run far longer
      // than the search budget: a leaked statement_timeout or a stray cancel on a connection a search used would kill them (57014).
      // The two budgeted reads reserve both connections first (budget 30 ms, statement 200 ms); the long statements wait and then run on them.
      let budgetedStopped = 0;
      for (let round = 0; round < 5; round += 1) {
        const budgeted = [0, 1].map(() => readWithinBudget(pool.sql, "select pg_sleep(0.2), 1 as ok", [], 30));
        const long = [0, 1].map((i) =>
          pool.sql.unsafe("select pg_sleep(0.1), $1::int as n", [round * 10 + i]).then((rows) => rows[0]!.n as number),
        );
        const [b, l] = await within(
          Promise.all([Promise.all(budgeted), Promise.all(long)]),
          10_000,
          `pool round ${round}`,
        );
        budgetedStopped += b.filter((r) => r === null).length;
        expect(l).toEqual([round * 10, round * 10 + 1]);
      }
      expect(budgetedStopped).toBe(10);
      const holder = await admin.reserve();
      let httpSearches: { status: number; body: { results: unknown[] } }[] = [];
      try {
        await holder.unsafe("begin");
        await holder.unsafe("lock table customers in access exclusive mode");
        const http = Array.from({ length: 6 }, () =>
          t.request<{ results: unknown[] }>("GET", "/api/v1/search?q=zz", { token }),
        );
        // while everything is in flight, the other session is still running its statement
        const mid = await observer<{ state: string; query: string }[]>`
          select state, query from pg_stat_activity where pid = ${pid}`;
        expect(mid[0]).toMatchObject({ state: "active" });
        expect(mid[0]!.query).toContain("pg_sleep(3)");
        httpSearches = await within(Promise.all(http), 10_000, "http searches");
      } finally {
        await holder.unsafe("rollback").catch(() => undefined);
        holder.release();
      }
      for (const r of httpSearches) {
        expect(r.status).toBe(200);
        expect(r.body.results).toEqual([]);
      }
      // the other session's statement finished normally (not 57014) on the same backend
      expect(await within(sleeperDone, 10_000, "other session's pg_sleep")).toBe(1);
      const still = await other<{ pid: number }[]>`select pg_backend_pid() as pid`;
      expect(still[0]!.pid).toBe(pid);
      // every pooled connection is back to the server default statement_timeout
      const timeouts = await Promise.all([
        pool.sql<{ t: string }[]>`show statement_timeout`,
        pool.sql<{ t: string }[]>`show statement_timeout`,
      ]);
      // (compared with a fresh connection of the same configuration, which sets its own statement_timeout)
      const fresh = createDb(TEST_DATABASE_URL, { max: 1 });
      try {
        const def = await fresh.sql<{ statement_timeout: string }[]>`show statement_timeout`;
        for (const rows of timeouts) expect(Object.values(rows[0]!)[0]).toBe(def[0]!.statement_timeout);
      } finally {
        await fresh.close();
      }
    } finally {
      await other.end({ timeout: 5 });
      await observer.end({ timeout: 5 });
    }
  });
});
