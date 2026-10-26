import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { postErrorWebhook, webhookPayload } from "../../src/jobs/alerts.js";
import {
  defaultJobOptions,
  hasJob,
  isUuid,
  JOB_ATTEMPTS,
  JOB_SCHEDULES,
  jobBackoffMs,
  jobHandler,
  partitioningEnabled,
  publicJobData,
  registerJob,
  registeredJobs,
  UnregisteredJobError,
} from "../../src/jobs/index.js";
import { bullConnection, deployId, lastDuesSlot, PROCESS_STARTED_AT } from "../../src/jobs/queue.js";
import { config } from "../../src/config.js";

const ctx = (log = { info: () => undefined }) => ({
  db: {} as never,
  log: log as never,
  data: {},
  app: null,
  runId: "r",
  attempt: 1,
  maxAttempts: 1,
});

describe("job registry", () => {
  it("has the IST schedules incl. the new hourly/5-minute/daily housekeeping jobs; partition maintenance is switched by PARTITIONING_ENABLED", () => {
    expect(JOB_SCHEDULES.map((s) => `${s.name}@${s.cron}`)).toEqual([
      "DAILY_DUES@30 0 * * *",
      "NIGHTLY_INTEGRITY@45 0 * * *",
      "OVERDUE_NOTIFICATIONS@15 1 * * *",
      "VISIT_OUTCOME_NUDGE@0 9 * * *",
      "SLA_BREACH_CHECK@5 * * * *",
      "PORTAL_FILE_CLEANUP@20 * * * *",
      "IDEMPOTENCY_PURGE@35 * * * *",
      "HOLD_EXPIRY@*/5 * * * *",
      "EXPORT_CLEANUP@10 3 * * *",
      "PARTITION_MAINTENANCE@20 2 * * *",
      "JOB_RUN_SWEEP@*/15 * * * *",
    ]);
    expect(JOB_SCHEDULES.every((s) => s.tz === "Asia/Kolkata")).toBe(true);
    expect(partitioningEnabled({})).toBe(false);
    expect(partitioningEnabled({ PARTITIONING_ENABLED: "true" })).toBe(true);
    expect(partitioningEnabled({ PARTITIONING_ENABLED: "1" })).toBe(false);
  });

  it("an unregistered job is an error, never a silent OK no-op; registered handlers run", async () => {
    expect(() => jobHandler("NOT_A_JOB")).toThrow(UnregisteredJobError);
    expect(hasJob("NOT_A_JOB")).toBe(false);
    registerJob("DAILY_DUES", async () => ({ raised: 3 }));
    expect(registeredJobs()).toContain("DAILY_DUES");
    expect(await jobHandler("DAILY_DUES")(ctx())).toEqual({ raised: 3 });
  });

  it("every job gets 3 attempts with exponential backoff (JOB_BACKOFF_MS, default 30 s)", () => {
    expect(JOB_ATTEMPTS).toBe(3);
    expect(defaultJobOptions()).toMatchObject({ attempts: 3, backoff: { type: "exponential" } });
    expect(jobBackoffMs({})).toBe(30_000);
    expect(jobBackoffMs({ JOB_BACKOFF_MS: "250" })).toBe(250);
    expect(jobBackoffMs({ JOB_BACKOFF_MS: "-1" })).toBe(30_000);
  });

  it("internal payload keys are hidden from handlers; run ids are uuids", () => {
    expect(publicJobData({ __run_id: "x", __manual: "u", export_id: "e" })).toEqual({ export_id: "e" });
    expect(isUuid("6f1c2a52-6c2b-4a43-9a8a-0c4f9d9f2b11")).toBe(true);
    expect(isUuid("repeat:abc")).toBe(false);
  });
});

describe("queue helpers", () => {
  it("BullMQ connects with the main REDIS_URL (db index, credentials, TLS)", () => {
    expect(bullConnection("redis://localhost:6379/18")).toMatchObject({ host: "localhost", port: 6379, db: 18 });
    expect(bullConnection("rediss://u:p%40ss@cache:6380")).toMatchObject({
      host: "cache",
      port: 6380,
      username: "u",
      password: "p@ss",
      tls: {},
    });
  });

  it("the dues catch-up slot is the latest 00:30 IST at or before now", () => {
    // 2026-10-26 00:10 IST = 2026-10-25T18:40Z → yesterday's slot 2026-10-25 00:30 IST = 2026-10-24T19:00Z
    expect(lastDuesSlot(new Date("2026-10-25T18:40:00Z")).toISOString()).toBe("2026-10-24T19:00:00.000Z");
    // 2026-10-26 09:00 IST = 03:30Z → today's slot 2026-10-25T19:00Z
    expect(lastDuesSlot(new Date("2026-10-26T03:30:00Z")).toISOString()).toBe("2026-10-25T19:00:00.000Z");
    expect(lastDuesSlot(new Date("2026-10-25T19:00:00Z")).toISOString()).toBe("2026-10-25T19:00:00.000Z");
  });

  it("the boot lock is per deploy (DEPLOY_ID, else GIT_SHA, else the process start time; never a fixed default)", () => {
    expect(deployId({ DEPLOY_ID: "abc" })).toMatch(/:abc$/);
    expect(deployId({ GIT_SHA: "f00" })).toMatch(/:f00$/);
    expect(deployId({ DEPLOY_ID: "abc", GIT_SHA: "f00" })).toMatch(/:abc$/);
    expect(deployId({})).toBe(`${config.APP_VERSION}:started-${PROCESS_STARTED_AT}`);
    expect(deployId({})).not.toMatch(/default/);
    expect(PROCESS_STARTED_AT).toBeLessThanOrEqual(Date.now());
    expect(PROCESS_STARTED_AT).toBeGreaterThan(Date.now() - process.uptime() * 1000 - 5_000);
  });
});

describe("failure alert webhook", () => {
  it("POSTs a JSON event and reports delivery; unset or unreachable URLs never throw", async () => {
    const received: unknown[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => {
        body += c.toString();
      });
      req.on("end", () => {
        received.push({ method: req.method, type: req.headers["content-type"], body: JSON.parse(body) as unknown });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    try {
      const payload = webhookPayload(
        { jobName: "DAILY_DUES", runId: "r1", error: "boom", attempt: 3, maxAttempts: 3 },
        new Date("2026-10-26T00:00:00Z"),
      );
      expect(payload).toMatchObject({
        event: "job.failed",
        job_name: "DAILY_DUES",
        run_id: "r1",
        error: "boom",
        attempts: 3,
        max_attempts: 3,
        occurred_at: "2026-10-26T00:00:00.000Z",
      });
      expect(await postErrorWebhook(payload, url)).toBe(true);
      expect(received).toEqual([{ method: "POST", type: "application/json", body: payload }]);
      expect(await postErrorWebhook(payload, undefined)).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
    expect(await postErrorWebhook({ event: "x" }, url)).toBe(false);
  });
});
