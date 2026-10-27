/**
 * Phase 7 platform track, worker robustness (audit A7): critical and heavy queues with their own concurrency and explicit lock/stall
 * settings, per-attempt time budgets (AbortSignal), heartbeats, checkpoint + resume of heavy jobs across a drain, the drain window for
 * critical jobs, worker health (contract C8), deduplicated schedules and the heartbeat-aware abandoned-run sweep.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobName } from "@kkt/contracts";

process.env["JOB_BACKOFF_MS"] = "50";

const { buildTestApp } = await import("./helpers.js");
const { waitFor } = await import("./worker.js");
const jobs = await import("../../src/jobs/index.js");
const queueMod = await import("../../src/jobs/queue.js");
const { startWorker } = await import("../../src/worker.js");
type TestContext = Awaited<ReturnType<typeof buildTestApp>>;
type Running = Awaited<ReturnType<typeof startWorker>>;

let t: TestContext;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// test-only job names; the heavy ones join the heavy queue's set (the registry is per process)
const HEAVY_SLOW = "TEST_P7_HEAVY_SLOW" as JobName;
const HEAVY_BATCHES = "TEST_P7_HEAVY_BATCHES" as JobName;
const CRITICAL_QUICK = "TEST_P7_CRITICAL_QUICK" as JobName;
const CRITICAL_SLOW = "TEST_P7_CRITICAL_SLOW" as JobName;
const CRITICAL_STUBBORN = "TEST_P7_CRITICAL_STUBBORN" as JobName;
(jobs.HEAVY_JOBS as Set<JobName>).add(HEAVY_SLOW).add(HEAVY_BATCHES);

const processed: number[] = [];
const startedAt: number[] = [];

beforeAll(async () => {
  t = await buildTestApp();
  jobs.registerJob(HEAVY_SLOW, async () => {
    await sleep(1_500);
    return { slow: true };
  });
  jobs.registerJob(CRITICAL_QUICK, async () => ({ quick: true }));
  jobs.registerJob(CRITICAL_SLOW, async () => {
    await sleep(800);
    return { slow: true };
  });
  // ignores its signal on purpose (a handler that never checks it)
  jobs.registerJob(CRITICAL_STUBBORN, async () => {
    await sleep(3_000);
    return { stubborn: true };
  });
  // 8 batches of 100 ms; checkpoint after each; checks the signal between batches
  jobs.registerJob(HEAVY_BATCHES, async ({ checkpoint, saveCheckpoint, signal }) => {
    const start = Number((checkpoint as { next?: number } | null)?.next ?? 0);
    startedAt.push(start);
    for (let i = start; i < 8; i++) {
      signal?.throwIfAborted();
      processed.push(i);
      await sleep(100);
      await saveCheckpoint?.({ next: i + 1 });
    }
    return { from: start, to: 8 };
  });
});
afterAll(async () => {
  for (const q of [t.app.jobQueue(), queueMod.queueFor(t.app.jobQueue(), "BACKUP_EXPORT")])
    await q.obliterate({ force: true }).catch(() => undefined);
  await t?.close();
});

async function start(extra: Partial<Parameters<typeof startWorker>[0] & object> = {}): Promise<Running> {
  return startWorker({ app: t.app, boot: false, schedules: false, heartbeatMs: 200, abortGraceMs: 300, ...extra });
}

async function runRow(id: string) {
  const [row] = await t.app.sql<
    {
      status: string;
      result: Record<string, unknown> | null;
      checkpoint: Record<string, unknown> | null;
      error: string | null;
      heartbeat_at: Date | null;
      started_at: Date;
    }[]
  >`select status, result, checkpoint, error, heartbeat_at, started_at from job_runs where id = ${id}`;
  return row ?? null;
}

describe("queues", () => {
  it("critical and heavy queues have their own consumers, concurrency and explicit lock/stall settings; heavy jobs never hold up critical ones", async () => {
    const w = await start({ concurrency: 1, heavyConcurrency: 1 });
    try {
      expect(w.worker.name).toBe("kkt-jobs");
      expect(w.heavyWorker.name).toBe("kkt-jobs-heavy");
      expect(w.worker.opts).toMatchObject({ concurrency: 1, ...jobs.WORKER_SETTINGS.critical });
      expect(w.heavyWorker.opts).toMatchObject({ concurrency: 1, ...jobs.WORKER_SETTINGS.heavy });
      expect(jobs.WORKER_SETTINGS.heavy.lockDuration).toBeGreaterThan(jobs.WORKER_SETTINGS.critical.lockDuration);
      // a heavy job handed to the (critical) app queue is routed to the heavy queue
      const heavy = await queueMod.enqueueJob(t.app.jobQueue(), HEAVY_SLOW);
      expect(await w.heavyQueue.getJob(heavy.jobId)).toBeTruthy();
      expect(await w.queue.getJob(heavy.jobId)).toBeFalsy();
      await waitFor("heavy job running", async () => (await runRow(heavy.runId))?.status === "RUNNING");
      // with one slot per queue, a critical job still runs while the heavy one holds its slot
      const quick = await queueMod.enqueueJob(t.app.jobQueue(), CRITICAL_QUICK);
      const quickRun = await waitFor("critical job", async () => {
        const r = await runRow(quick.runId);
        return r?.status === "OK" ? r : null;
      });
      expect(quickRun.result).toMatchObject({ quick: true });
      expect((await runRow(heavy.runId))!.status).toBe("RUNNING");
      await waitFor("heavy job done", async () => (await runRow(heavy.runId))?.status === "OK");
      // the real heavy jobs
      for (const name of ["BACKUP_EXPORT", "LEDGER_REBUILD", "REENCRYPT_FIELDS", "EXPORT_CSV", "DOCUMENT_RENDITIONS"])
        expect(jobs.queueKindOf(name)).toBe("heavy");
      for (const name of [
        "DAILY_DUES",
        "NIGHTLY_INTEGRITY",
        "NOTIFICATION_SWEEP",
        "SLA_BREACH_CHECK",
        "STORAGE_SWEEP",
        "JOB_RUN_SWEEP",
      ])
        expect(jobs.queueKindOf(name)).toBe("critical");
    } finally {
      await w.close(5_000);
    }
  });

  it("repeatable schedules stay deduplicated when two workers register them at the same time", async () => {
    const a = queueMod.createQueue();
    const b = queueMod.createQueue();
    try {
      const registered = new Set(jobs.JOB_SCHEDULES.map((s) => s.name as string));
      const [ra, rb] = await Promise.all([
        queueMod.registerSchedules(a, registered),
        queueMod.registerSchedules(b, registered),
      ]);
      expect(ra.scheduled.sort()).toEqual(rb.scheduled.sort());
      const schedulers = await a.getJobSchedulers(0, 199);
      expect(schedulers).toHaveLength(ra.scheduled.length);
      const delayed = await a.getJobs(["delayed", "waiting"]);
      const perName = new Map<string, number>();
      for (const j of delayed) if (j.repeatJobKey) perName.set(j.name, (perName.get(j.name) ?? 0) + 1);
      for (const name of ra.scheduled) expect(perName.get(name) ?? 0, name).toBeLessThanOrEqual(1);
      for (const s of schedulers) await a.removeJobScheduler(s.key);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe("time budget and heartbeat", () => {
  it("an attempt past its time budget sees its signal abort and fails with a timeout (recorded and counted)", async () => {
    let sawAbort = false;
    jobs.registerJob("TEST_P7_LOOPER" as JobName, async ({ signal }) => {
      for (;;) {
        await sleep(20);
        if (signal?.aborted) {
          sawAbort = true;
          signal.throwIfAborted();
        }
      }
    });
    const runId = randomUUID();
    await expect(jobs.runJob(t.app.db, "TEST_P7_LOOPER", {}, { runId, timeoutMs: 150 })).rejects.toBeInstanceOf(
      jobs.JobTimeoutError,
    );
    expect(sawAbort).toBe(true);
    const row = await runRow(runId);
    expect(row!.status).toBe("FAILED");
    expect(row!.error).toMatch(/time budget/);
    const { registry } = await import("../../src/lib/metrics.js");
    expect(await registry.getSingleMetricAsString("kkt_job_interruptions_total")).toMatch(
      /job_name="TEST_P7_LOOPER",reason="timeout"} 1/,
    );
    // a handler that ignores its signal is given up after the grace period instead of holding the attempt forever
    jobs.registerJob("TEST_P7_DEAF" as JobName, async () => {
      await sleep(5_000);
      return {};
    });
    const t0 = Date.now();
    await expect(
      jobs.runJob(t.app.db, "TEST_P7_DEAF", {}, { timeoutMs: 100, abortGraceMs: 100 }),
    ).rejects.toBeInstanceOf(jobs.JobTimeoutError);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("job_runs.heartbeat_at advances while an attempt runs", async () => {
    let mid: Date | null = null;
    const runId = randomUUID();
    jobs.registerJob("TEST_P7_BEATING" as JobName, async () => {
      await sleep(450);
      mid = (await runRow(runId))!.heartbeat_at;
      return {};
    });
    await jobs.runJob(t.app.db, "TEST_P7_BEATING", {}, { runId, heartbeatMs: 100 });
    const row = await runRow(runId);
    expect(mid).not.toBeNull();
    expect(new Date(mid!).getTime()).toBeGreaterThan(new Date(row!.started_at).getTime() + 200);
    expect(row!.status).toBe("OK");
  });

  it("JOB_RUN_SWEEP abandons runs whose heartbeat stopped, never a run parked by a shutdown or a healthy one", async () => {
    const ins = async (minutesAgo: number, beatMinutesAgo: number | null, result: object | null) => {
      const [r] = await t.app.sql<{ id: string }[]>`
        insert into job_runs (job_name, status, started_at, heartbeat_at, result)
        values ('DAILY_DUES', 'RUNNING', now() - make_interval(mins => ${minutesAgo}),
                ${beatMinutesAgo === null ? null : new Date(Date.now() - beatMinutesAgo * 60_000).toISOString()}::timestamptz,
                ${result === null ? null : JSON.stringify(result)}::jsonb)
        returning id`;
      return r!.id;
    };
    const dead = await ins(10, 5, null);
    const healthy = await ins(10, 0, null);
    const parked = await ins(10, 5, { interrupted: true, reason: "worker shutdown" });
    const out = await jobs.sweepAbandonedJobRuns(t.app.db);
    expect(out.abandoned).toBeGreaterThanOrEqual(1);
    expect((await runRow(dead))!.status).toBe("ABANDONED");
    expect((await runRow(healthy))!.status).toBe("RUNNING");
    expect((await runRow(parked))!.status).toBe("RUNNING");
    await t.app.sql`delete from job_runs where id in (${healthy}, ${parked})`;
  });
});

describe("graceful drain", () => {
  it("a heavy job interrupted by a drain checkpoints, goes back to its queue without using an attempt, and the next worker resumes it", async () => {
    processed.length = 0;
    startedAt.length = 0;
    const w1 = await start();
    const q = await queueMod.enqueueJob(t.app.jobQueue(), HEAVY_BATCHES);
    await waitFor("three batches", async () => processed.length >= 3);
    const drained = await w1.drain(5_000);
    expect(drained.forced).toBe(false);
    expect(drained.interrupted).toBe(1);
    const job = await w1.heavyQueue.getJob(q.jobId);
    expect(await job!.getState()).toBe("waiting");
    expect(job!.attemptsMade).toBe(0);
    const parked = await runRow(q.runId);
    expect(parked!.status).toBe("RUNNING");
    expect(parked!.result).toMatchObject({ interrupted: true, reason: "worker shutdown" });
    const next = Number((parked!.checkpoint as { next: number }).next);
    expect(next).toBe(processed.length);
    await w1.close();
    // the next worker (the new deploy) resumes from the checkpoint under the same job_runs row
    const w2 = await start();
    try {
      const done = await waitFor("resumed run", async () => {
        const r = await runRow(q.runId);
        return r?.status === "OK" ? r : null;
      });
      expect(startedAt).toEqual([0, next]);
      expect(processed).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // every batch exactly once
      expect(done.result).toMatchObject({ from: next, to: 8, resumed: true });
      expect(done.checkpoint).toBeNull();
    } finally {
      await w2.close(5_000);
    }
  });

  it("a drain waits for in-flight critical jobs within its window", async () => {
    const w = await start();
    const q = await queueMod.enqueueJob(t.app.jobQueue(), CRITICAL_SLOW);
    await waitFor("critical job running", async () => (await runRow(q.runId))?.status === "RUNNING");
    const t0 = Date.now();
    const out = await w.drain(10_000);
    expect(out.forced).toBe(false);
    expect((await runRow(q.runId))!.status).toBe("OK");
    expect(Date.now() - t0).toBeGreaterThan(200);
    await w.close();
  });

  it("a critical job that outlives the drain window is interrupted and returned to its queue (not lost, no attempt used)", async () => {
    const w = await start();
    const q = await queueMod.enqueueJob(t.app.jobQueue(), CRITICAL_STUBBORN);
    await waitFor("stubborn job running", async () => (await runRow(q.runId))?.status === "RUNNING");
    const out = await w.drain(300);
    expect(out.forced).toBe(false);
    const job = await w.queue.getJob(q.jobId);
    expect(await job!.getState()).toBe("waiting");
    expect(job!.attemptsMade).toBe(0);
    await w.close();
    await t.app.jobQueue().remove(q.jobId);
  });
});

describe("worker health (contract C8)", () => {
  it("serves GET /health (200 ok → 503 once draining) and /metrics with the heartbeat; the API's /health sees the heartbeat", async () => {
    const w = await start({ healthPort: 0 });
    try {
      const port = (w.health!.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        status: "ok",
        redis: true,
        queues: {
          critical: { consuming: true, waiting: expect.any(Number), active: expect.any(Number) },
          heavy: { consuming: true },
        },
      });
      expect(Date.now() - new Date(String(body["last_heartbeat_at"])).getTime()).toBeLessThan(5_000);
      const metrics = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
      expect(metrics).toMatch(/kkt_worker_heartbeat_timestamp_seconds \d/);
      const stored = JSON.parse((await t.app.redis.get("kkt:worker:heartbeat"))!) as { at: string; pid: number };
      expect(stored.pid).toBe(process.pid);
      // the heartbeat keeps beating
      const first = w.lastHeartbeatAt()!.getTime();
      await waitFor("next beat", async () => w.lastHeartbeatAt()!.getTime() > first, 3_000);
      const api = await t.request<{ checks: Record<string, boolean>; status: string }>("GET", "/api/v1/health");
      expect(api.body.checks.worker).toBe(true);
      expect(api.body.status).toBe("ok");
      await w.drain(1_000);
      const draining = await fetch(`http://127.0.0.1:${port}/health`);
      expect(draining.status).toBe(503);
      expect(((await draining.json()) as { status: string }).status).toBe("down");
    } finally {
      await w.close(1_000);
    }
  });
});
