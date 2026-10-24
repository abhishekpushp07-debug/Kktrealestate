import { defineConfig } from "vitest/config";

/** Tests run against a dedicated database (kkt_api_test, created on demand) and Redis db 1 so they never touch dev data. */
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/kkt_api_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1",
      WRITE_RATE_LIMIT_PER_MIN: "100000",
      PUBLIC_RATE_LIMIT_PER_MIN: "100000",
      RUN_JOBS_IN_API: "false",
      LOG_LEVEL: "fatal",
    },
  },
});
