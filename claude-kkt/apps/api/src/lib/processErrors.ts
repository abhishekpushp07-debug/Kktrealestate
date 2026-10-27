/**
 * Process-level failure hooks for the API (every HTTP process and the cluster primary) and the job worker (audit A2/A7):
 *  - `unhandledRejection`: logged with its reason and stack, counted (`kkt_process_errors_total{kind="unhandled_rejection"}`); the process
 *    keeps serving (installing the listener replaces Node's default crash, which would drop every in-flight request);
 *  - `uncaughtException`: logged at fatal, counted, then the process shuts down GRACEFULLY (stops taking work, finishes in-flight
 *    requests / jobs within its deadline) and exits non-zero so the supervisor restarts it — state after an uncaught exception is not
 *    trustworthy. A second exception during that shutdown, or the hard deadline, exits immediately.
 */
import { processErrorsTotal } from "./metrics.js";

/** Minimal logger surface (pino). */
interface FatalLog {
  error(o: object, msg: string): void;
  fatal(o: object, msg: string): void;
}

/** Options of installProcessErrorHandlers. */
export interface ProcessErrorOptions {
  role: "api" | "worker";
  log: FatalLog;
  /** Graceful shutdown; must resolve (or the deadline exits). Called once, with the reason. */
  shutdown: (reason: string) => Promise<void> | void;
  /** Exit (tests inject a spy). Default process.exit. */
  exit?: (code: number) => void;
  /** Hard deadline after an uncaught exception before the process exits regardless (default 30 s). */
  deadlineMs?: number;
  /** The process to hook (tests pass an EventEmitter). Default `process`. */
  target?: Pick<NodeJS.Process, "on" | "off">;
}

/** Serialisable description of a rejection reason (Errors keep name/message/stack; anything else is stringified). */
export function describeReason(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error)
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack,
      ...((reason as { code?: unknown }).code !== undefined ? { code: (reason as { code?: unknown }).code } : {}),
    };
  try {
    return { value: typeof reason === "string" ? reason : JSON.stringify(reason) };
  } catch {
    return { value: String(reason) };
  }
}

/** Installs the hooks; returns a function that removes them (tests). */
export function installProcessErrorHandlers(o: ProcessErrorOptions): () => void {
  const target = o.target ?? process;
  const exit = o.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;
  const onRejection = (reason: unknown, promise: Promise<unknown>) => {
    processErrorsTotal.inc({ kind: "unhandled_rejection", role: o.role });
    o.log.error(
      {
        kind: "unhandled_rejection",
        role: o.role,
        pid: process.pid,
        reason: describeReason(reason),
        promise: String(promise),
      },
      "unhandled promise rejection",
    );
  };
  const onException = (err: Error, origin: string) => {
    processErrorsTotal.inc({ kind: "uncaught_exception", role: o.role });
    o.log.fatal(
      { kind: "uncaught_exception", role: o.role, pid: process.pid, origin, err: describeReason(err) },
      shuttingDown ? "uncaught exception during shutdown; exiting now" : "uncaught exception; shutting down gracefully",
    );
    if (shuttingDown) {
      exit(1);
      return;
    }
    shuttingDown = true;
    const deadline = setTimeout(() => exit(1), o.deadlineMs ?? 30_000);
    deadline.unref?.();
    Promise.resolve()
      .then(() => o.shutdown(`uncaughtException: ${err.message}`))
      .catch((e: unknown) =>
        o.log.error({ err: describeReason(e) }, "graceful shutdown after an uncaught exception failed"),
      )
      .finally(() => {
        clearTimeout(deadline);
        exit(1);
      });
  };
  target.on("unhandledRejection", onRejection as (...a: unknown[]) => void);
  target.on("uncaughtException", onException as (...a: unknown[]) => void);
  return () => {
    target.off("unhandledRejection", onRejection as (...a: unknown[]) => void);
    target.off("uncaughtException", onException as (...a: unknown[]) => void);
  };
}
