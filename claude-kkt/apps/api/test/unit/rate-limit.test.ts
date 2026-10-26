import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import { enforceRateLimit } from "../../src/lib/rateLimit.js";

/** A Redis double that runs the sliding-window script against an in-memory map (INCR, EXPIRE, GET semantics). */
function scriptedRedis(opts: { cached: boolean }): {
  redis: Pick<Redis, "evalsha" | "eval">;
  store: Map<string, number>;
  ttl: Map<string, number>;
  calls: string[];
} {
  const store = new Map<string, number>();
  const ttl = new Map<string, number>();
  const calls: string[] = [];
  let loaded = opts.cached;
  const run = (keyNow: string, keyPrev: string, seconds: number) => {
    const n = (store.get(keyNow) ?? 0) + 1;
    store.set(keyNow, n);
    ttl.set(keyNow, seconds);
    const prev = store.get(keyPrev);
    return [n, prev === undefined ? null : String(prev)];
  };
  const redis = {
    evalsha: vi.fn(async (_sha: string, _n: number, keyNow: string, keyPrev: string, seconds: number) => {
      calls.push("evalsha");
      if (!loaded) throw new Error("NOSCRIPT No matching script. Please use EVAL.");
      return run(keyNow, keyPrev, seconds);
    }),
    eval: vi.fn(async (script: string, _n: number, keyNow: string, keyPrev: string, seconds: number) => {
      calls.push("eval");
      expect(script).toContain("INCR");
      loaded = true;
      return run(keyNow, keyPrev, seconds);
    }),
  } as unknown as Pick<Redis, "evalsha" | "eval">;
  return { redis, store, ttl, calls };
}

describe("lib/rateLimit enforceRateLimit: one script call per request", () => {
  it("loads the script with EVAL once (NOSCRIPT), then uses EVALSHA; keys expire after two windows", async () => {
    const { redis, ttl, calls } = scriptedRedis({ cached: false });
    await enforceRateLimit(redis, "pub:all:1.2.3.4", 10, 60);
    await enforceRateLimit(redis, "pub:all:1.2.3.4", 10, 60);
    expect(calls).toEqual(["evalsha", "eval", "evalsha"]);
    expect([...ttl.values()]).toEqual([120]);
  });

  it("answers 429 with Retry-After once the weighted count passes the limit", async () => {
    const { redis } = scriptedRedis({ cached: true });
    for (let i = 0; i < 3; i++) await enforceRateLimit(redis, "w:user", 3, 60);
    const err = await enforceRateLimit(redis, "w:user", 3, 60).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(429);
  });

  it("other script errors propagate (the auth plugin fails open on them)", async () => {
    const redis = {
      evalsha: vi.fn(async () => {
        throw new Error("READONLY You can't write against a read only replica.");
      }),
      eval: vi.fn(),
    } as unknown as Pick<Redis, "evalsha" | "eval">;
    await expect(enforceRateLimit(redis, "x", 1, 60)).rejects.toThrow("READONLY");
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
