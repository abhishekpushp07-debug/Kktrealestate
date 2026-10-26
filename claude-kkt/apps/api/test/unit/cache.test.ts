import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { CACHE_BUDGET_MS, cached, redisUsable, withinBudget } from "../../src/lib/cache.js";

/** A Redis double whose commands never answer (a blackholed server: the socket looks connected, nothing comes back). */
function hangingRedis(status = "ready"): Redis {
  return {
    status,
    get: vi.fn(() => new Promise<string | null>(() => undefined)),
    set: vi.fn(() => new Promise<"OK">(() => undefined)),
  } as unknown as Redis;
}

describe("lib/cache cached(): Redis is optional and time-boxed", () => {
  it("a hanging Redis costs at most the budget per read/write; the loader answers", async () => {
    const redis = hangingRedis();
    const started = performance.now();
    const v = await cached(redis, "k", 30, async () => ({ ok: 1 }));
    const ms = performance.now() - started;
    expect(v).toEqual({ ok: 1 });
    expect(ms).toBeGreaterThanOrEqual(CACHE_BUDGET_MS - 5);
    expect(ms).toBeLessThan(CACHE_BUDGET_MS + 100); // one budget: after a timed-out read the write is skipped
    expect(redis.set).not.toHaveBeenCalled();
    expect(CACHE_BUDGET_MS).toBeLessThanOrEqual(150);
  });

  it("a disconnected client (reconnecting/connecting/close/end) is skipped without issuing a command", async () => {
    for (const status of ["reconnecting", "connecting", "close", "end"]) {
      const redis = hangingRedis(status);
      const started = performance.now();
      expect(await cached(redis, "k", 30, async () => 42)).toBe(42);
      expect(performance.now() - started).toBeLessThan(20);
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(redisUsable(redis)).toBe(false);
    }
    expect(redisUsable({ status: "ready" } as Redis)).toBe(true);
    expect(redisUsable({ status: "wait" } as Redis)).toBe(true); // lazy client: the first command connects it
    expect(redisUsable({} as Redis)).toBe(true);
    expect(redisUsable(null)).toBe(false);
  });

  it("a healthy cache hit skips the loader; errors fall through to it", async () => {
    const hit = {
      status: "ready",
      get: vi.fn(async () => JSON.stringify({ from: "cache" })),
      set: vi.fn(async () => "OK"),
    } as unknown as Redis;
    const loader = vi.fn(async () => ({ from: "db" }));
    expect(await cached(hit, "k", 30, loader)).toEqual({ from: "cache" });
    expect(loader).not.toHaveBeenCalled();
    const broken = {
      status: "ready",
      get: vi.fn(async () => {
        throw new Error("boom");
      }),
      set: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as Redis;
    expect(await cached(broken, "k", 30, loader)).toEqual({ from: "db" });
  });

  it("withinBudget: a reply already waiting when the timer fires (busy event loop) still wins", async () => {
    // the reply is delivered in the first check phase; the event loop is blocked past the budget before it gets there, so the budget
    // timer is overdue in the same iteration: the deferred rejection lets the waiting reply through
    const reply = new Promise<number>((r) => setImmediate(() => r(7)));
    const result = withinBudget(reply, 20, "busy");
    const until = performance.now() + 60;
    while (performance.now() < until) {
      /* block the event loop beyond the budget */
    }
    await expect(result).resolves.toBe(7);
  });

  it("withinBudget rejects after the budget and resolves otherwise", async () => {
    await expect(withinBudget(new Promise(() => undefined), 20, "slow")).rejects.toThrow("slow exceeded 20 ms");
    await expect(withinBudget(Promise.resolve(7), 20)).resolves.toBe(7);
  });
});
