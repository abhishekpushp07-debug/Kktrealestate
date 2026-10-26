// Every error code the API can put on the wire must be registered in @kkt/contracts (ERROR_CODES + ERROR_STATUS) with the HTTP status it
// is actually raised with, so the ERP, portal and website can branch on it and document it. The scan is textual on purpose: it covers
// `new ApiError(status, "CODE", …)`, `ApiError.conflict("CODE", …)`, `ApiError.unauthenticated(message, "CODE")`, the error handler's
// status → code fallback map and literal `code` fields. `ApiError.rule(…, "RULE")` names a business rule inside BUSINESS_RULE and is
// deliberately not a code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiErrorSchema, ERROR_CODES, ERROR_STATUS, isKnownErrorCode } from "@kkt/contracts";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const STR = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`)";

interface Raised {
  code: string;
  status: number | null;
  where: string;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Every code literal raised anywhere in apps/api/src, with the status it is raised with (null when the helper fixes none). */
function scanRaisedCodes(root: string = SRC): Raised[] {
  const out: Raised[] = [];
  const patterns: {
    re: RegExp;
    status: (m: RegExpExecArray) => number | null;
    code: (m: RegExpExecArray) => string;
  }[] = [
    { re: /new ApiError\(\s*(\d{3})\s*,\s*"([A-Z][A-Z0-9_]*)"/g, status: (m) => Number(m[1]), code: (m) => m[2]! },
    { re: /ApiError\.conflict\(\s*"([A-Z][A-Z0-9_]*)"/g, status: () => 409, code: (m) => m[1]! },
    {
      re: new RegExp(String.raw`ApiError\.unauthenticated\(\s*${STR}\s*,\s*"([A-Z][A-Z0-9_]*)"\s*\)`, "g"),
      status: () => 401,
      code: (m) => m[1]!,
    },
    // envelopes sent directly by the error handler, and Error subclasses with a fixed code (app.ts UnavailableError)
    { re: /error:\s*\{\s*code:\s*"([A-Z][A-Z0-9_]*)"/g, status: () => null, code: (m) => m[1]! },
    { re: /readonly code\s*=\s*"([A-Z][A-Z0-9_]*)"/g, status: () => null, code: (m) => m[1]! },
  ];
  for (const file of tsFiles(root)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(root, file);
    for (const p of patterns) {
      p.re.lastIndex = 0;
      for (let m = p.re.exec(text); m !== null; m = p.re.exec(text))
        out.push({ code: p.code(m), status: p.status(m), where: `${rel}:${lineOf(text, m.index)}` });
    }
    if (rel === join("lib", "errors.ts")) {
      // status → code fallback map of the error handler, and the Fastify content-type error mapping
      const map = /const STATUS_CODES[^{]*\{([^}]*)\}/.exec(text);
      for (const e of map?.[1]?.matchAll(/(\d{3}):\s*"([A-Z][A-Z0-9_]*)"/g) ?? [])
        out.push({ code: e[2]!, status: Number(e[1]), where: `${rel} STATUS_CODES` });
      for (const e of text.matchAll(/"FST_ERR_[A-Z_]+"\s*\?\s*"([A-Z][A-Z0-9_]*)"/g))
        out.push({ code: e[1]!, status: null, where: `${rel} fastify mapping` });
    }
  }
  return out;
}

describe("error code registry", () => {
  const raised = scanRaisedCodes();

  it("the scan sees the API's error sites (guards against the patterns silently matching nothing)", () => {
    expect(raised.length).toBeGreaterThan(100);
    const codes = new Set(raised.map((r) => r.code));
    for (const c of [
      "VALIDATION_ERROR",
      "NOT_FOUND",
      "VERSION_CONFLICT",
      "DUPLICATE_CUSTOMER",
      "TICKET_CLOSED",
      "INVALID_TOKEN",
      "INTERNAL_ERROR",
      "METHOD_NOT_ALLOWED",
    ]) {
      expect(codes.has(c), c).toBe(true);
    }
  });

  it("every raised code is in ERROR_CODES with an ERROR_STATUS entry", () => {
    const missing = [...new Set(raised.filter((r) => !isKnownErrorCode(r.code)).map((r) => `${r.code} (${r.where})`))];
    expect(missing).toEqual([]);
    for (const code of ERROR_CODES) expect(ERROR_STATUS[code], code).toBeGreaterThanOrEqual(400);
  });

  it("each code is raised with the HTTP status the registry documents", () => {
    const wrong = raised
      .filter((r) => r.status !== null && isKnownErrorCode(r.code) && ERROR_STATUS[r.code] !== r.status)
      .map(
        (r) =>
          `${r.code}: raised ${r.status}, registry ${isKnownErrorCode(r.code) ? ERROR_STATUS[r.code] : "?"} (${r.where})`,
      );
    expect(wrong).toEqual([]);
  });

  it("one spelling per meaning: the API no longer raises the retired INSUFFICIENT_CASH / UNSUPPORTED_MEDIA spellings", () => {
    const retired = raised.filter((r) => r.code === "INSUFFICIENT_CASH" || r.code === "UNSUPPORTED_MEDIA");
    expect(retired).toEqual([]);
    expect(isKnownErrorCode("CASH_INSUFFICIENT")).toBe(true);
    expect(isKnownErrorCode("UNSUPPORTED_MEDIA_TYPE")).toBe(true);
  });

  it("clients parse an envelope with a code they do not know yet, but not a malformed code", () => {
    const future = { error: { code: "SOME_FUTURE_RULE", message: "Readable server message", request_id: "r1" } };
    const parsed = ApiErrorSchema.safeParse(future);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.error.code).toBe("SOME_FUTURE_RULE");
    expect(ApiErrorSchema.safeParse({ error: { code: "TICKET_CLOSED", message: "closed" } }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: "not-a-code", message: "x" } }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ error: { code: "", message: "x" } }).success).toBe(false);
    expect(isKnownErrorCode("SOME_FUTURE_RULE")).toBe(false);
  });
});
