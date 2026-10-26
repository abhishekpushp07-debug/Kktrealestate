import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { context, ROOT_CONTEXT, trace, type Context, type ContextManager, type Span } from "@opentelemetry/api";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import telemetry from "../../src/plugins/telemetry.js";

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

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

/** A recording server span like the one HttpInstrumentation opens around each inbound request. */
function recordingSpan(traceId: string): Span & { attrs: Record<string, unknown>; names: string[] } {
  const attrs: Record<string, unknown> = {};
  const names: string[] = [];
  const span = {
    attrs,
    names,
    spanContext: () => ({ traceId, spanId: "00f067aa0ba902b7", traceFlags: 1 }),
    setAttribute(k: string, v: unknown) {
      attrs[k] = v;
      return span;
    },
    setAttributes() {
      return span;
    },
    addEvent() {
      return span;
    },
    addLink() {
      return span;
    },
    addLinks() {
      return span;
    },
    setStatus() {
      return span;
    },
    updateName(n: string) {
      names.push(n);
      return span;
    },
    end() {},
    isRecording: () => true,
    recordException() {},
  };
  return span as unknown as Span & { attrs: Record<string, unknown>; names: string[] };
}

let spanForNextRequest: (() => Span | undefined) | undefined;
let app: FastifyInstance;

describe("plugins/telemetry with OpenTelemetry tracing on (an active server span per request)", () => {
  beforeAll(async () => {
    context.setGlobalContextManager(new AlsContextManager());
    app = Fastify({
      // the instrumentation runs the whole request inside the server span's context; emulate that at the http server
      serverFactory: (handler) =>
        createServer((req: IncomingMessage, res: ServerResponse) => {
          const span = spanForNextRequest?.();
          if (!span) return handler(req, res);
          return context.with(trace.setSpan(ROOT_CONTEXT, span), () => handler(req, res));
        }),
    });
    await app.register(telemetry);
    app.get("/api/v1/things/:id", async () => ({ ok: true }));
    app.get("/api/v1/broken/:id", async (_req, reply) =>
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "missing" } }),
    );
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    context.disable();
  });

  const url = (path: string) => `http://127.0.0.1:${(app.server.address() as { port: number }).port}${path}`;

  it("renames the server span to METHOD /route/:pattern, sets http.route and returns X-Trace-Id", async () => {
    const span = recordingSpan(TRACE_ID);
    spanForNextRequest = () => span;
    const res = await fetch(url("/api/v1/things/42?q=secret"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-trace-id")).toBe(TRACE_ID);
    expect(span.names).toEqual(["GET /api/v1/things/:id"]);
    expect(span.attrs["http.route"]).toBe("/api/v1/things/:id");
  });

  it("adds error.trace_id to error bodies", async () => {
    spanForNextRequest = () => recordingSpan(TRACE_ID);
    const res = await fetch(url("/api/v1/broken/1"));
    expect(res.status).toBe(404);
    expect(res.headers.get("x-trace-id")).toBe(TRACE_ID);
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({ code: "NOT_FOUND", trace_id: TRACE_ID });
  });

  it("an unmatched route keeps the span name but still returns the trace id; nothing for an all-zero span or no span", async () => {
    const unmatched = recordingSpan(TRACE_ID);
    spanForNextRequest = () => unmatched;
    const res404 = await fetch(url("/nope"));
    expect(res404.headers.get("x-trace-id")).toBe(TRACE_ID);
    expect(unmatched.names).toEqual([]); // no route pattern: the span keeps the instrumentation's name

    spanForNextRequest = () => recordingSpan("00000000000000000000000000000000");
    const zero = await fetch(url("/api/v1/things/1"));
    expect(zero.headers.get("x-trace-id")).toBeNull();

    spanForNextRequest = undefined;
    const none = await fetch(url("/api/v1/things/1"));
    expect(none.headers.get("x-trace-id")).toBeNull();
    const err = await fetch(url("/api/v1/broken/1"));
    expect(((await err.json()) as { error: Record<string, unknown> }).error).not.toHaveProperty("trace_id");
  });
});
