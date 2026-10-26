import { describe, expect, it } from "vitest";

import { ApiError, apiErrorFromBody, errorMessage, fallbackMessage } from "@/api/errors";

describe("portal API errors keep the server's message for every code", () => {
  it("documented codes parse as before", () => {
    const e = apiErrorFromBody(409, {
      error: { code: "SLOT_FULL", message: "That slot just filled up.", request_id: "r1" },
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: "SLOT_FULL", message: "That slot just filled up.", requestId: "r1" });
  });

  it("codes this build does not know (TICKET_CLOSED, REOPEN_WINDOW_CLOSED, ALREADY_RATED, future ones) show the server's message, not 'Something went wrong'", () => {
    for (const [code, message] of [
      ["TICKET_CLOSED", "This request is closed. Raise a new request instead."],
      ["REOPEN_WINDOW_CLOSED", "Requests can be reopened within 7 days of being resolved."],
      ["ALREADY_RATED", "You have already rated this request."],
      ["SOME_FUTURE_CODE", "A brand-new rule the app has never heard of."],
    ] as const) {
      const e = apiErrorFromBody(409, { error: { code, message, details: { rule: "x" } } });
      expect(e.code).toBe(code);
      expect(e.message).toBe(message);
      expect(errorMessage(e)).toBe(message);
      expect(e.details).toEqual({ rule: "x" });
    }
  });

  it("non-envelope bodies still surface a message; empty ones fall back by status", () => {
    expect(
      apiErrorFromBody(404, { statusCode: 404, error: "Not Found", message: "Route GET:/x not found" }),
    ).toMatchObject({ code: "UNKNOWN", message: "Route GET:/x not found" });
    expect(apiErrorFromBody(422, { error: { code: "lower_case", message: "Odd but readable" } })).toMatchObject({
      code: "LOWER_CASE",
      message: "Odd but readable",
    });
    expect(apiErrorFromBody(502, undefined).message).toBe(fallbackMessage(502));
    expect(apiErrorFromBody(429, "<html>busy</html>", 30)).toMatchObject({
      code: "UNKNOWN",
      retryAfterSeconds: 30,
      message: fallbackMessage(429),
    });
    expect(apiErrorFromBody(400, { error: { code: "VALIDATION_ERROR", message: "" } }).message).toBe(
      fallbackMessage(400),
    );
  });
});
