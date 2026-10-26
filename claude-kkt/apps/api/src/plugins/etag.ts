import { createHash } from "node:crypto";
import fp from "fastify-plugin";
import { versionEtag } from "../lib/version.js";

const VERSION_TAGGED = Symbol("kkt.versionEtag");
type Tagged = { [VERSION_TAGGED]?: boolean };

/** True for a JSON object body whose top level carries a numeric `version` (a single versioned resource). */
function topLevelVersion(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const v = (payload as { version?: unknown }).version;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

/**
 * ETags (contract C6; replaces @fastify/etag):
 * - a JSON body with a top-level numeric `version` — single-resource GETs and the responses of writes — gets the strong ETag
 *   `"v<version>"`, which clients send back as `If-Match` on their next write (lib/version.ts parseIfMatch). Such a tag only promises
 *   the stored record's version, not every derived field of the body (summaries, joined names), so `If-None-Match` is never answered
 *   304 for it;
 * - any other string/buffer body (lists, files, public pages) gets a strong body-hash ETag and a matching `If-None-Match` is 304.
 * A route or hook that set an ETag itself keeps it.
 */
export default fp(
  async (app) => {
    app.addHook("preSerialization", async (req, reply, payload) => {
      if (reply.hasHeader("etag") || reply.statusCode >= 300) return payload;
      const version = topLevelVersion(payload);
      if (version !== null) {
        reply.header("ETag", versionEtag(version));
        (req as Tagged)[VERSION_TAGGED] = true;
      }
      return payload;
    });
    app.addHook("onSend", async (req, reply, payload) => {
      if ((req as Tagged)[VERSION_TAGGED]) return payload;
      let tag = reply.getHeader("etag") as string | undefined;
      if (!tag) {
        if (reply.statusCode !== 200 || !(typeof payload === "string" || Buffer.isBuffer(payload))) return payload;
        tag = `"${createHash("sha1").update(payload).digest("base64")}"`;
        reply.header("ETag", tag);
      }
      const inm = req.headers["if-none-match"];
      if (inm && (inm === tag || inm === `W/${tag}` || `W/${inm}` === tag)) {
        reply.code(304);
        return null;
      }
      return payload;
    });
  },
  { name: "kkt-etag" },
);
