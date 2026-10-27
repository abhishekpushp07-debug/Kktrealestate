// Every error code the API can put on the wire must be registered in @kkt/contracts (ERROR_CODES + ERROR_STATUS) with the HTTP status it
// is actually raised with, so the ERP, portal and website can branch on it and document it. The scan is textual on purpose: it covers
// `new ApiError(status, "CODE", …)`, `ApiError.conflict("CODE", …)`, `ApiError.unauthenticated(message, "CODE")`, the error handler's
// status → code fallback map and literal `code` fields. `ApiError.rule(…, "RULE")` names a business rule inside BUSINESS_RULE and is
// deliberately not a code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApiErrorSchema,
  BUSINESS_RULES,
  ERROR_CODES,
  ERROR_STATUS,
  isKnownErrorCode,
  isKnownRuleId,
} from "@kkt/contracts";
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

/** The argument list of every call `name(…)` in `text` (balanced parentheses, strings and template literals skipped). */
function callArgs(text: string, name: string): { args: string; index: number }[] {
  const out: { args: string; index: number }[] = [];
  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + name.length)) {
    let i = at + name.length;
    let depth = 1;
    let quote: string | null = null;
    for (; i < text.length && depth > 0; i += 1) {
      const c = text[i]!;
      if (quote) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
    }
    out.push({ args: text.slice(at + name.length, i - 1), index: at });
  }
  return out;
}

describe("business-rule registry (BUSINESS_RULES, RuleId)", () => {
  const sites = tsFiles(SRC).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return callArgs(text, "ApiError.rule(").map((c) => ({
      ...c,
      where: `${relative(SRC, file)}:${lineOf(text, c.index)}`,
    }));
  });

  it("the scan sees the rule sites", () => {
    expect(sites.length).toBeGreaterThan(80);
  });

  it("every literal rule id raised by the API is registered (dynamic ids are domain error codes, typed as RuleId)", () => {
    const literal = sites
      .map((s) => ({
        ...s,
        id: /^\s*(?:`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|[^,])*,\s*"([A-Z][A-Z0-9_]*)"/s.exec(s.args)?.[1],
      }))
      .filter((s) => s.id !== undefined);
    expect(literal.length).toBeGreaterThan(80);
    expect(literal.filter((s) => !isKnownRuleId(s.id!)).map((s) => `${s.id} (${s.where})`)).toEqual([]);
    const dynamic = sites.filter((s) => !literal.includes(s as never) && !/,\s*"[A-Z]/.test(s.args));
    expect(dynamic.map((s) => s.where).every((w) => w.startsWith(join("modules", "inventory", "service.ts")))).toBe(
      true,
    );
    expect(BUSINESS_RULES.length).toBeGreaterThan(70);
  });
});

describe("validation error details have one shape: details.issues[{path, message, code}]", () => {
  it("no VALIDATION_ERROR site sends the old {field} details (ApiError.invalid builds issues)", () => {
    const offenders = tsFiles(SRC).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...callArgs(text, "ApiError.badRequest("), ...callArgs(text, 'new ApiError(400, "VALIDATION_ERROR",')]
        .filter((c) => /[{,]\s*field\s*[:,}]/.test(c.args))
        .map((c) => `${relative(SRC, file)}:${lineOf(text, c.index)}`);
    });
    expect(offenders).toEqual([]);
  });

  it("ApiError.invalid and versionRequired produce the issues shape the contracts parse", async () => {
    const { ApiError } = await import("../../src/lib/errors.js");
    const { versionRequired } = await import("../../src/lib/version.js");
    const { ValidationErrorDetailsSchema } = await import("@kkt/contracts");
    const e = ApiError.invalid("customer_id", "Customer does not exist", "invalid", { customer_id: "x" });
    expect(e.statusCode).toBe(400);
    expect(ValidationErrorDetailsSchema.parse(e.details)).toEqual({
      issues: [{ path: "customer_id", message: "Customer does not exist", code: "invalid" }],
    });
    expect(e.details?.["customer_id"]).toBe("x");
    const v = versionRequired();
    expect(v.statusCode).toBe(428);
    expect(ValidationErrorDetailsSchema.parse(v.details).issues[0]?.path).toBe("version");
  });
});
