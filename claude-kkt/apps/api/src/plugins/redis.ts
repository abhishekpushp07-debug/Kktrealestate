import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { config } from "../config.js";

declare module "fastify" {
  interface FastifyInstance { redis: Redis }
}

/** Create a Redis client (lazy connect, retry with backoff). */
export function createRedis(url = config.REDIS_URL): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: true, lazyConnect: true, retryStrategy: (times) => Math.min(times * 200, 5000) });
}

/** Fastify plugin exposing `app.redis`; closes on shutdown. */
export default fp(async (app) => {
  const redis = createRedis();
  await redis.connect();
  app.decorate("redis", redis);
  app.addHook("onClose", async () => { await redis.quit().catch(() => undefined); });
}, { name: "redis" });
