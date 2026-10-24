import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";

/** Request id propagation, server timing header and a few headers helmet does not set. */
export default fp(async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Request-Id", req.id);
    (req as unknown as { startedAt: number }).startedAt = performance.now();
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const started = (req as unknown as { startedAt?: number }).startedAt;
    if (started) reply.header("X-Response-Time", `${(performance.now() - started).toFixed(1)}ms`);
    reply.header("Cache-Control", reply.getHeader("Cache-Control") ?? "no-store");
    return payload;
  });
}, { name: "request-context" });

/** Generate request ids (honours an inbound X-Request-Id of sane length). */
export function genReqId(headers: Record<string, string | string[] | undefined>): string {
  const inbound = headers["x-request-id"];
  const v = Array.isArray(inbound) ? inbound[0] : inbound;
  if (v && /^[A-Za-z0-9._-]{8,64}$/.test(v)) return v;
  return randomUUID().replace(/-/g, "").slice(0, 20);
}
