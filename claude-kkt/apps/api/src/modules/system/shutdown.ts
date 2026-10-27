import type { FastifyInstance } from "fastify";
import { startDraining } from "./lifecycle.js";

/** Shutdown knobs read from the environment (documented in docs/DEPLOY.md). */
export interface ShutdownSettings {
  /** Hard deadline for the whole shutdown before the process force-exits (SHUTDOWN_TIMEOUT_MS, default 25000). */
  timeoutMs: number;
  /**
   * Time between "stop being ready" and "stop accepting connections" (SHUTDOWN_DRAIN_DELAY_MS, default 0). Behind a load balancer that
   * polls /api/v1/ready, set it to slightly more than the probe interval; on Kubernetes the preStop sleep does the same job.
   */
  drainDelayMs: number;
}

function envMs(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

/** Reads SHUTDOWN_TIMEOUT_MS / SHUTDOWN_DRAIN_DELAY_MS. */
export function shutdownSettingsFromEnv(): ShutdownSettings {
  return {
    timeoutMs: envMs("SHUTDOWN_TIMEOUT_MS", 25_000, 600_000),
    drainDelayMs: envMs("SHUTDOWN_DRAIN_DELAY_MS", 0, 120_000),
  };
}

/**
 * Flushes and stops OpenTelemetry when src/telemetry.ts (loaded with `node --import`) started it. Looked up through a global symbol so
 * the application bundle never imports (and re-runs) the preload module.
 */
export async function shutdownTelemetry(): Promise<void> {
  const fn = (globalThis as Record<symbol, unknown>)[Symbol.for("kkt.telemetry.shutdown")] as
    (() => Promise<void>) | undefined;
  if (fn) await fn().catch(() => undefined);
}

/** What a graceful shutdown closes, in order. */
export interface ShutdownTargets {
  app: FastifyInstance;
  /** In-process job worker (stops taking jobs, lets the active ones finish). */
  jobs?: { close(): Promise<void> } | null;
  /** Extra closers run after the HTTP server and pools are closed (metrics listener, tracing flush). */
  after?: (() => Promise<void> | void)[];
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void };
  settings?: ShutdownSettings;
  /** process.exit (tests inject a spy). */
  exit?: (code: number) => void;
  /** Requests in flight right now (for the log line). */
  inflight?: () => number;
}

/**
 * Graceful shutdown of one HTTP process:
 *  1. mark the process draining (/ready → 503) and wait `drainDelayMs` so the load balancer stops routing here;
 *  2. stop the in-process job worker (active jobs finish);
 *  3. `app.close()`: the server stops accepting connections, idle keep-alive sockets are closed, in-flight requests run to completion
 *     (new requests on open sockets get 503 + Connection: close), and only then the onClose hooks close the Postgres pools and Redis;
 *  4. the extra closers (metrics listener, tracing flush); exit 0.
 * A hard deadline exits 1 if any step hangs.
 */
export async function gracefulShutdown(t: ShutdownTargets, signal: string): Promise<void> {
  const settings = t.settings ?? shutdownSettingsFromEnv();
  const exit = t.exit ?? ((code: number) => process.exit(code));
  const started = Date.now();
  startDraining();
  t.log.info(
    {
      signal,
      pid: process.pid,
      inflight: t.inflight?.() ?? null,
      drain_delay_ms: settings.drainDelayMs,
      timeout_ms: settings.timeoutMs,
    },
    "shutting down: draining",
  );
  let finished = false;
  const deadline = setTimeout(() => {
    if (finished) return;
    t.log.error(
      { after_ms: Date.now() - started, inflight: t.inflight?.() ?? null },
      "shutdown deadline reached; forcing exit",
    );
    exit(1);
  }, settings.timeoutMs);
  deadline.unref();
  try {
    if (settings.drainDelayMs > 0) await new Promise((r) => setTimeout(r, settings.drainDelayMs));
    if (t.jobs) await t.jobs.close();
    // keep-alive sockets become idle once their in-flight response is written; close them as they do so the server can finish
    // closing instead of waiting for the keep-alive timeout (Fastify only closes the sockets that were idle when close() started)
    const server = t.app.server as { closeIdleConnections?: () => void } | undefined;
    const sweeper = setInterval(() => server?.closeIdleConnections?.(), 100);
    try {
      await t.app.close();
    } finally {
      clearInterval(sweeper);
    }
    for (const fn of t.after ?? []) await fn();
    finished = true;
    clearTimeout(deadline);
    t.log.info({ after_ms: Date.now() - started }, "shutdown complete");
    exit(0);
  } catch (err) {
    finished = true;
    clearTimeout(deadline);
    t.log.error({ err }, "shutdown error");
    exit(1);
  }
}
