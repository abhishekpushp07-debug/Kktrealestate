import { AsyncLocalStorage } from "node:async_hooks";
import { Writable } from "node:stream";
import { context, ROOT_CONTEXT, trace, type Context, type ContextManager } from "@opentelemetry/api";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loggerOptions, traceContext } from "../../src/lib/logger.js";

/** Minimal AsyncLocalStorage context manager (what the OpenTelemetry Node SDK registers when tracing is on). */
class AlsContextManager implements ContextManager {
  private readonly als = new AsyncLocalStorage<Context>();
  active(): Context {
    return this.als.getStore() ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.als.run(ctx, () => fn.call(thisArg, ...args));
  }
  bind<T>(_ctx: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    this.als.disable();
    return this;
  }
}

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";

function capture(): { log: pino.Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const log = pino({ ...loggerOptions, level: "info" }, stream);
  return {
    log,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

function inSpan<T>(fn: () => T): T {
  const span = trace.wrapSpanContext({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 });
  return context.with(trace.setSpan(context.active(), span), fn);
}

beforeAll(() => {
  context.setGlobalContextManager(new AlsContextManager());
});
afterAll(() => {
  context.disable();
});

describe("logger trace mixin (observability: every log line carries the active trace)", () => {
  it("adds trace_id and span_id to root, child (module-level) and grandchild logger lines inside a span", async () => {
    const { log, lines } = capture();
    const moduleLogger = log.child({ module: "jobs" });
    inSpan(() => {
      log.info("root line");
      moduleLogger.info("module line");
      moduleLogger.child({ job: "DAILY_DUES", runId: "r1" }).warn("job line");
    });
    // async continuation inside the span keeps the context
    await inSpan(async () => {
      await new Promise((r) => setTimeout(r, 5));
      moduleLogger.info("after await");
    });
    const out = lines();
    expect(out).toHaveLength(4);
    for (const l of out) expect(l).toMatchObject({ trace_id: TRACE_ID, span_id: SPAN_ID, service: "kkt-api" });
    expect(out[2]).toMatchObject({ module: "jobs", job: "DAILY_DUES" });
    // one trace_id key per line (no duplicate bindings)
    for (const raw of out) expect(Object.keys(raw).filter((k) => k === "trace_id")).toHaveLength(1);
  });

  it("adds nothing outside a span or when tracing is off (no SDK: the all-zero/invalid context is ignored)", () => {
    const { log, lines } = capture();
    log.info("no span");
    inSpan(() => undefined);
    const invalid = trace.wrapSpanContext({
      traceId: "00000000000000000000000000000000",
      spanId: "0000000000000000",
      traceFlags: 0,
    });
    context.with(trace.setSpan(context.active(), invalid), () => log.info("invalid span"));
    for (const l of lines()) {
      expect(l).not.toHaveProperty("trace_id");
      expect(l).not.toHaveProperty("span_id");
    }
    expect(traceContext()).toEqual({});
  });

  it("the application logger itself is configured with the mixin", () => {
    expect(loggerOptions.mixin).toBe(traceContext);
  });
});
