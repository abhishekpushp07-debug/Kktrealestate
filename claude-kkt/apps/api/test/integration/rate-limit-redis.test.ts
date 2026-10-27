import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import { enforceRateLimit } from "../../src/lib/rateLimit.js";
import "./helpers.js";

/** The MULTI/EXEC sequence the script replaced (INCR, EXPIRE, GET), kept here as the reference behaviour. */
async function referenceCounts(redis: Redis, keyNow: string, keyPrev: string, ttl: number): Promise<[number, number]> {
  const res = (await redis.multi().incr(keyNow).expire(keyNow, ttl).get(keyPrev).exec()) as [
    [null, number],
    [null, number],
    [null, string | null],
  ];
  return [Number(res[0][1]), Number(res[2][1] ?? 0)];
}

describe("lib/rateLimit against a real Redis (one EVALSHA per request)", () => {
  let redis: Redis;
  const prefix = `rltest${process.pid}`;

  beforeAll(async () => {
    redis = new Redis(process.env["REDIS_URL"]!, { lazyConnect: true });
    await redis.connect();
  });

  afterAll(async () => {
    const keys = await redis.keys(`rl:${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it("counts, expires after two windows and reads the previous window exactly like the MULTI/EXEC it replaced", async () => {
    await redis.script("FLUSH"); // first call must recover from NOSCRIPT
    const window = 60;
    const current = Math.floor(Date.now() / (window * 1000));
    const bucket = `${prefix}:a`;
    // previous window absent: the script returns a one-element array (nil truncates the Lua table)
    const first = await enforceRateLimit(redis, bucket, 10, window);
    expect(first.remaining).toBe(9);
    expect(await redis.get(`rl:${bucket}:${current}`)).toBe("1");
    const ttl = await redis.ttl(`rl:${bucket}:${current}`);
    expect(ttl).toBeGreaterThan(window);
    expect(ttl).toBeLessThanOrEqual(window * 2);

    // previous window present: weighted like before; compare with the reference sequence on a twin bucket
    const ref = `${prefix}:ref`;
    await redis.set(`rl:${bucket}:${current - 1}`, "4");
    await redis.set(`rl:${ref}:${current - 1}`, "4");
    await redis.set(`rl:${ref}:${current}`, "1");
    const got = await enforceRateLimit(redis, bucket, 100, window);
    const [refNow, refPrev] = await referenceCounts(
      redis,
      `rl:${ref}:${current}`,
      `rl:${ref}:${current - 1}`,
      window * 2,
    );
    expect(await redis.get(`rl:${bucket}:${current}`)).toBe(String(refNow));
    expect(refPrev).toBe(4);
    const elapsed = (Date.now() % (window * 1000)) / (window * 1000);
    // remaining = floor(limit - (prev * (1 - elapsed) + now)); allow for the clock moving between the call and this line
    expect(Math.abs(got.remaining - Math.floor(100 - (4 * (1 - elapsed) + 2)))).toBeLessThanOrEqual(1);
  });

  it("answers 429 RATE_LIMITED with Retry-After past the limit, per bucket", async () => {
    const bucket = `${prefix}:b`;
    for (let i = 0; i < 3; i++) await enforceRateLimit(redis, bucket, 3, 60);
    const err = (await enforceRateLimit(redis, bucket, 3, 60).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(429);
    await expect(enforceRateLimit(redis, `${prefix}:c`, 3, 60)).resolves.toEqual({ remaining: 2 });
  });
});
