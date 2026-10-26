/**
 * Job-worker helpers for integration tests: a BullMQ consumer on the test app (same queue/Redis db as the app, no schedules, no boot jobs
 * unless asked) and polling helpers. Retries back off 50 ms instead of 30 s.
 */
import type { FastifyInstance } from "fastify";

process.env["JOB_BACKOFF_MS"] ??= "50";

/** A running test worker. */
export interface TestWorker {
  close(): Promise<void>;
}

/** Starts a consumer for the app's queue (schedules and boot jobs off unless requested). */
export async function startTestWorker(
  app: FastifyInstance,
  opts: { boot?: boolean; schedules?: boolean; concurrency?: number } = {},
): Promise<TestWorker> {
  const { startWorker } = await import("../../src/worker.js");
  const w = await startWorker({
    app,
    boot: opts.boot ?? false,
    schedules: opts.schedules ?? false,
    concurrency: opts.concurrency ?? 2,
  });
  return { close: () => w.close() };
}

/** Polls `fn` until it returns a truthy value (or throws after `timeoutMs`). */
export async function waitFor<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 30_000,
  everyMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Waits until the job_runs row `runId` is finished (OK or FAILED) and returns it. */
export async function waitForRun(
  app: FastifyInstance,
  runId: string,
  timeoutMs = 30_000,
): Promise<{
  id: string;
  job_name: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
}> {
  return waitFor(
    `job run ${runId}`,
    async () => {
      const [row] = await app.sql<
        { id: string; job_name: string; status: string; result: Record<string, unknown> | null; error: string | null }[]
      >`select id, job_name, status, result, error from job_runs where id = ${runId} and status <> 'RUNNING'`;
      return row ?? null;
    },
    timeoutMs,
  );
}

/** Waits until the exports row `id` is DONE or FAILED and returns its status. */
export async function waitForExport(
  app: FastifyInstance,
  id: string,
  timeoutMs = 60_000,
): Promise<{ status: string; error: string | null; row_count: number | null }> {
  return waitFor(
    `export ${id}`,
    async () => {
      const [row] = await app.sql<
        { status: string; error: string | null; row_count: number | null }[]
      >`select status, error, row_count from exports where id = ${id} and status in ('DONE', 'FAILED')`;
      return row ?? null;
    },
    timeoutMs,
  );
}
