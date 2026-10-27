import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { readWithinBudget } from "../../src/lib/statementBudget.js";

type Step = { ok: unknown } | { fail: { code: string } };

/** A fake pool whose reserved connection answers each `unsafe()` call with the next scripted step, and records what was sent. */
function fakePool(steps: Step[], reserveDelayMs = 0) {
  const sent: string[] = [];
  let released = 0;
  const conn = {
    unsafe(text: string) {
      sent.push(text);
      const step = steps.shift() ?? { ok: [] };
      return "ok" in step
        ? Promise.resolve(step.ok)
        : Promise.reject(Object.assign(new Error(step.fail.code), step.fail));
    },
    release() {
      released += 1;
    },
  };
  const sql = {
    reserve: () => new Promise((resolve) => setTimeout(() => resolve(conn), reserveDelayMs)),
  } as unknown as Sql;
  return { sql, sent, released: () => released };
}

const OPEN = { ok: [] };
const ROWS = { ok: [{ n: 1 }] };
const DONE = { ok: [] };
const CANCELED = { fail: { code: "57014" } };

describe("readWithinBudget (lib/statementBudget.ts)", () => {
  it("runs begin read only + set local, the statement and a ROLLBACK, then releases the connection", async () => {
    const p = fakePool([OPEN, ROWS, DONE]);
    expect(await readWithinBudget(p.sql, "select 1 as n", [], 150)).toEqual([{ n: 1 }]);
    expect(p.sent[0]).toMatch(/^begin read only; set local statement_timeout = \d+$/);
    expect(p.sent[2]).toBe("rollback");
    expect(p.sent).toHaveLength(3);
    expect(p.released()).toBe(1);
  });

  it("a statement stopped by the timeout answers null", async () => {
    const p = fakePool([OPEN, CANCELED, DONE]);
    expect(await readWithinBudget(p.sql, "select 1", [], 150)).toBeNull();
    expect(p.sent).toHaveLength(3);
    expect(p.released()).toBe(1);
  });

  it("when the statement that ends the transaction fails (e.g. cancelled by the same timeout), it rolls back again before releasing", async () => {
    const p = fakePool([OPEN, ROWS, CANCELED, DONE]);
    expect(await readWithinBudget(p.sql, "select 1 as n", [], 150)).toEqual([{ n: 1 }]);
    expect(p.sent.slice(2)).toEqual(["rollback", "rollback"]);
    expect(p.released()).toBe(1);
  });

  it("a failed begin is thrown, after a rollback, and the connection is released", async () => {
    const p = fakePool([{ fail: { code: "25P02" } }, { fail: { code: "25P02" } }, DONE, DONE]);
    await expect(readWithinBudget(p.sql, "select 1", [], 150)).rejects.toMatchObject({ code: "25P02" });
    expect(p.sent.at(-1)).toBe("rollback");
    expect(p.released()).toBe(1);
  });

  it("other statement errors are thrown", async () => {
    const p = fakePool([OPEN, { fail: { code: "42P01" } }, DONE]);
    await expect(readWithinBudget(p.sql, "select * from missing", [], 150)).rejects.toMatchObject({ code: "42P01" });
    expect(p.released()).toBe(1);
  });

  it("a connection that arrives after the budget is released unused and the call answers null", async () => {
    const p = fakePool([OPEN, ROWS, DONE], 60);
    expect(await readWithinBudget(p.sql, "select 1", [], 20)).toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    expect(p.sent).toEqual([]);
    expect(p.released()).toBe(1);
  });
});
