import fp from "fastify-plugin";
import type { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.js";
import { bindJobApp } from "../jobs/index.js";
import { createQueue } from "../jobs/queue.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Shared Redis: caches, idempotency fast path, BullMQ (may evict under memory pressure). */
    redis: Redis;
    /**
     * Security Redis for revocation markers, locks and rate limits: a separate client on REDIS_SECURITY_URL (run it with
     * `maxmemory-policy noeviction`) when set, otherwise the shared `redis` client.
     */
    redisSecurity: Redis;
    /** The kkt-jobs BullMQ queue on the main REDIS_URL, created on first use and closed with the app. */
    jobQueue(): Queue;
  }
}

/** Create a Redis client (lazy connect, retry with backoff). */
export function createRedis(url = config.REDIS_URL): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: true, lazyConnect: true, retryStrategy: (times) => Math.min(times * 200, 5000) });
}

/** Fastify plugin exposing `app.redis`, `app.redisSecurity` and `app.jobQueue()`; closes them on shutdown. */
export default fp(async (app) => {
  const redis = createRedis();
  await redis.connect();
  const security = config.REDIS_SECURITY_URL && config.REDIS_SECURITY_URL !== config.REDIS_URL ? createRedis(config.REDIS_SECURITY_URL) : null;
  if (security) await security.connect();
  let queue: Queue | null = null;
  app.decorate("redis", redis);
  app.decorate("redisSecurity", security ?? redis);
  app.decorate("jobQueue", () => (queue ??= createQueue()));
  // job handlers run with this (root) app when a caller hands the worker only a DB handle (server.ts's in-process worker)
  bindJobApp(app);
  app.addHook("onClose", async () => {
    if (queue) await queue.close().catch(() => undefined);
    if (security) await security.quit().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  });
}, { name: "redis" });
