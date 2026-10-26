import { afterEach, describe, expect, it } from "vitest";

import {
  currentDeprecation,
  deprecationMessage,
  noteDeprecation,
  onDeprecation,
  parseDeprecationDate,
  resetDeprecation,
} from "@/api/deprecation";
import { apiErrorFromBody, errorMessage, errorReference } from "@/api/errors";
import { toLoginFailure } from "@/auth/loginFailure";

const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name] ?? null });

describe("deprecated operations → non-blocking update notice (deploy track)", () => {
  afterEach(() => resetDeprecation());

  it("reads RFC 9745 @seconds and HTTP-dates", () => {
    expect(parseDeprecationDate("@1798761600")).toBe("2027-01-01T00:00:00.000Z");
    expect(parseDeprecationDate("Fri, 01 Jan 2027 00:00:00 GMT")).toBe("2027-01-01T00:00:00.000Z");
    expect(parseDeprecationDate("garbage")).toBeNull();
    expect(parseDeprecationDate(null)).toBeNull();
  });

  it("remembers the first deprecated response and notifies listeners once", () => {
    const seen: string[] = [];
    const off = onDeprecation((info) => seen.push(info.path));
    noteDeprecation("/home", headers({}));
    expect(currentDeprecation()).toBeNull();
    noteDeprecation("/bookings", headers({ Deprecation: "@1798761600", Sunset: "Fri, 01 Jan 2027 00:00:00 GMT" }));
    noteDeprecation("/ledger", headers({ Deprecation: "@1798761600" }));
    off();
    expect(seen).toEqual(["/bookings"]);
    expect(currentDeprecation()).toMatchObject({ path: "/bookings", sunset: "2027-01-01T00:00:00.000Z" });
    expect(deprecationMessage(currentDeprecation()!)).toMatch(/Please update the app/);
    expect(deprecationMessage(currentDeprecation()!)).toMatch(/1 Jan 2027/);
  });
});

describe("error envelope additions", () => {
  it("keeps request and trace ids (body first, response headers as fallback) for support", () => {
    const fromBody = apiErrorFromBody(500, {
      error: { code: "INTERNAL_ERROR", message: "boom", request_id: "r1", trace_id: "c".repeat(32) },
    });
    expect(errorReference(fromBody)).toBe(`Ref r1 · trace ${"c".repeat(32)}`);
    const fromHeaders = apiErrorFromBody(502, "<html>", undefined, { requestId: "r2", traceId: "d".repeat(32) });
    expect(errorReference(fromHeaders)).toBe(`Ref r2 · trace ${"d".repeat(32)}`);
    expect(errorReference(new Error("x"))).toBeNull();
  });

  it("asks for an app update on 410 GONE (retired operation)", () => {
    const gone = apiErrorFromBody(410, {
      error: { code: "GONE", message: "This endpoint was retired on 2027-01-01.", details: { sunset: "2027-01-01" } },
    });
    expect(errorMessage(gone)).toBe("This endpoint was retired on 2027-01-01. Please update the app.");
  });

  it("shows a calm message for 429 at sign-in (also from the parallel-attempt budget)", () => {
    expect(
      toLoginFailure(apiErrorFromBody(429, { error: { code: "RATE_LIMITED", message: "Rate limit exceeded" } })),
    ).toEqual({
      code: "RATE_LIMITED",
      message: "Too many attempts. Try again in a moment.",
      retryAfterSeconds: undefined,
    });
    expect(toLoginFailure(apiErrorFromBody(429, { error: { code: "RATE_LIMITED", message: "x" } }, 20)).message).toBe(
      "Too many attempts. Try again in 20 seconds.",
    );
  });
});
