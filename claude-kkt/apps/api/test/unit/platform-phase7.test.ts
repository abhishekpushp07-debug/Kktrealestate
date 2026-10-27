import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roomTypes } from "@kkt/db";
import { checkCursorValue, decodeCursor, encodeCursor } from "../../src/lib/list.js";
import { describeReason, installProcessErrorHandlers } from "../../src/lib/processErrors.js";
import { registry } from "../../src/lib/metrics.js";
import { threadPoolSize } from "../../src/preload.js";
import { bodyEtag, etagMatches, publicCacheControl } from "../../src/plugins/requestContext.js";
import { stripQuery } from "../../src/modules/system/index.js";
import { attemptRunId } from "../../src/jobs/index.js";
import { ApiError } from "../../src/lib/errors.js";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));

function fakeLog() {
  const lines: { level: string; o: Record<string, unknown>; msg: string }[] = [];
  return {
    lines,
    error: (o: object, msg: string) => lines.push({ level: "error", o: o as Record<string, unknown>, msg }),
    fatal: (o: object, msg: string) => lines.push({ level: "fatal", o: o as Record<string, unknown>, msg }),
  };
}

describe("process-level failure hooks", () => {
  it("an unhandled rejection is logged with its reason and counted; the process keeps running", async () => {
    const target = new EventEmitter();
    const log = fakeLog();
    const exits: number[] = [];
    const remove = installProcessErrorHandlers({
      role: "worker",
      log,
      shutdown: () => undefined,
      exit: (c) => exits.push(c),
      target: target as unknown as NodeJS.Process,
    });
    target.emit("unhandledRejection", new Error("lost promise"), Promise.resolve());
    expect(exits).toEqual([]);
    expect(log.lines[0]).toMatchObject({ level: "error", msg: "unhandled promise rejection" });
    expect(log.lines[0]!.o["reason"]).toMatchObject({ name: "Error", message: "lost promise" });
    expect(await registry.getSingleMetricAsString("kkt_process_errors_total")).toMatch(
      /kind="unhandled_rejection",role="worker"} 1/,
    );
    remove();
    expect(target.listenerCount("unhandledRejection")).toBe(0);
  });

  it("an uncaught exception shuts down gracefully once and exits non-zero; a second one during the shutdown exits at once", async () => {
    const target = new EventEmitter();
    const log = fakeLog();
    const exits: number[] = [];
    let shutdowns = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    installProcessErrorHandlers({
      role: "api",
      log,
      shutdown: async () => {
        shutdowns += 1;
        await gate;
      },
      exit: (c) => exits.push(c),
      target: target as unknown as NodeJS.Process,
    });
    target.emit("uncaughtException", new Error("state is gone"), "uncaughtException");
    await new Promise((r) => setTimeout(r, 0));
    expect(shutdowns).toBe(1);
    expect(exits).toEqual([]); // still draining
    target.emit("uncaughtException", new Error("again"), "uncaughtException");
    expect(exits).toEqual([1]);
    expect(shutdowns).toBe(1);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([1, 1]);
    expect(log.lines.filter((l) => l.level === "fatal")).toHaveLength(2);
  });

  it("describes non-Error reasons safely", () => {
    expect(describeReason("plain")).toEqual({ value: "plain" });
    expect(describeReason({ a: 1 })).toEqual({ value: '{"a":1}' });
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(describeReason(circular)).toEqual({ value: "[object Object]" });
  });
});

describe("thread pool preload", () => {
  it("defaults UV_THREADPOOL_SIZE to 16 and honours a valid override", () => {
    expect(threadPoolSize({})).toBe(16);
    expect(threadPoolSize({ UV_THREADPOOL_SIZE: "8" })).toBe(8);
    expect(threadPoolSize({ UV_THREADPOOL_SIZE: "0" })).toBe(16);
    expect(threadPoolSize({ UV_THREADPOOL_SIZE: "lots" })).toBe(16);
  });

  it("is set before the application graph loads when preloaded (the production --import path)", () => {
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "--import", "./src/preload.ts", "-e", "console.log(process.env.UV_THREADPOOL_SIZE)"],
      { cwd: API_DIR, env: { ...process.env, UV_THREADPOOL_SIZE: "" }, encoding: "utf8" },
    );
    expect(out.trim()).toBe("16");
  });
});

describe("cursor validation", () => {
  const id = "6f1c2a52-6c2b-4a43-9a8a-0c4f9d9f2b11";
  it("round-trips cursors and binds them to their sort", () => {
    const c = decodeCursor(encodeCursor({ v: "Kitchen", id, s: "-name" }));
    expect(c).toEqual({ v: "Kitchen", id, s: "-name" });
    expect(decodeCursor(encodeCursor({ v: 3, id }))).toEqual({ v: 3, id });
  });
  it("rejects shapes and values that do not fit the sort column with INVALID_CURSOR", () => {
    const bad = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe("INVALID_CURSOR");
        return;
      }
      throw new Error("expected INVALID_CURSOR");
    };
    bad(() => decodeCursor("not base64!"));
    bad(() => decodeCursor(Buffer.from("{}").toString("base64url")));
    bad(() => decodeCursor(Buffer.from("[1,2]").toString("base64url")));
    bad(() => checkCursorValue(roomTypes.sortOrder, roomTypes.id, { v: "x", id }));
    bad(() => checkCursorValue(roomTypes.createdAt, roomTypes.id, { v: "yesterday", id }));
    bad(() => checkCursorValue(roomTypes.name, roomTypes.id, { v: "a", id: "1; drop table" }));
    expect(() =>
      checkCursorValue(roomTypes.createdAt, roomTypes.id, { v: "2026-10-26 10:00:00.123456", id }),
    ).not.toThrow();
    expect(() => checkCursorValue(roomTypes.sortOrder, roomTypes.id, { v: 4, id })).not.toThrow();
    expect(() => checkCursorValue(roomTypes.name, roomTypes.id, { v: null, id })).not.toThrow();
  });
});

describe("small helpers", () => {
  it("public cache headers and strong ETags (contract C5)", () => {
    expect(publicCacheControl({ public: true, sMaxAge: 300, staleWhileRevalidate: 600 })).toBe(
      "public, s-maxage=300, stale-while-revalidate=600",
    );
    const tag = bodyEtag('{"a":1}');
    expect(tag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(bodyEtag('{"a":1}')).toBe(tag);
    expect(etagMatches(tag, tag)).toBe(true);
    expect(etagMatches(`"x", W/${tag}`, tag)).toBe(true);
    expect(etagMatches("*", tag)).toBe(true);
    expect(etagMatches('"x"', tag)).toBe(false);
    expect(etagMatches(undefined, tag)).toBe(false);
  });
  it("client error URLs lose query and fragment (contract C2)", () => {
    expect(stripQuery("https://x.in/a/b?phone=98&t=1#frag")).toBe("https://x.in/a/b");
    expect(stripQuery("/bookings#ledger")).toBe("/bookings");
    expect(stripQuery("/plain")).toBe("/plain");
  });
  it("attempt run ids are stable per (job, attempt) and valid uuids", () => {
    expect(attemptRunId("kkt-jobs:1", 2)).toBe(attemptRunId("kkt-jobs:1", 2));
    expect(attemptRunId("kkt-jobs:1", 2)).not.toBe(attemptRunId("kkt-jobs:1", 3));
    expect(attemptRunId("kkt-jobs:1", 2)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("document and export links use the LINK_SIGNING_KEYS ring (contract C9)", () => {
  it("links carry the key id, survive a rotation while the old key is configured, and stop verifying once it is removed", async () => {
    const { config } = await import("../../src/config.js");
    const { signedUrl, verifyLinkToken } = await import("../../src/modules/documents/service.js");
    const { signRingFileToken, verifyRingFileToken } = await import("../../src/modules/documents/files.js");
    const ring = config as unknown as { LINK_SIGNING_KEYS: { kid: string; secret: string }[] };
    const original = ring.LINK_SIGNING_KEYS;
    const a = { kid: "a1", secret: "a".repeat(20) + "-link-secret-one-0123456789" };
    const b = { kid: "b2", secret: "b".repeat(20) + "-link-secret-two-0123456789" };
    const id = "6f1c2a52-6c2b-4a43-9a8a-0c4f9d9f2b11";
    try {
      ring.LINK_SIGNING_KEYS = [a];
      const token = signedUrl(id, "thumb").url.split("/files/")[1]!;
      expect(token.startsWith("a1.")).toBe(true);
      expect(token.length).toBeLessThanOrEqual(100);
      const exportToken = signRingFileToken("kkt-export-link-v1", id, Math.floor(Date.now() / 1000) + 60);
      expect(verifyLinkToken(token)).toEqual({ documentId: id, variant: "thumb" });
      ring.LINK_SIGNING_KEYS = [b, a]; // rotation: b signs, a still verifies
      expect(verifyLinkToken(token)).toEqual({ documentId: id, variant: "thumb" });
      expect(verifyRingFileToken("kkt-export-link-v1", exportToken)).toBe(id);
      expect(signedUrl(id).url.split("/files/")[1]!.startsWith("b2.")).toBe(true);
      // a token of one family never passes as another
      expect(verifyRingFileToken("kkt-backup-link-v1", exportToken)).toBeNull();
      ring.LINK_SIGNING_KEYS = [b]; // a retired
      expect(verifyLinkToken(token)).toBeNull();
      expect(verifyRingFileToken("kkt-export-link-v1", exportToken)).toBeNull();
      // tampering
      const fresh = signedUrl(id).url.split("/files/")[1]!;
      expect(verifyLinkToken(`${fresh.slice(0, -2)}AA`)).toBeNull();
      expect(verifyRingFileToken("kkt-export-link-v1", signRingFileToken("kkt-export-link-v1", id, 5))).toBeNull(); // expired
    } finally {
      ring.LINK_SIGNING_KEYS = original;
    }
  });
});
