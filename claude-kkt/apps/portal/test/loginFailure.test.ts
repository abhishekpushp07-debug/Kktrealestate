import { describe, expect, it } from "vitest";

import { apiErrorFromBody } from "@/api/errors";
import { INVALID_CREDENTIALS_COPY, toLoginFailure } from "@/auth/loginFailure";

describe("sign-in failures show the server's message unless it is a plain credentials mismatch", () => {
  it("INVALID_CREDENTIALS (and a code-less 401) get the generic mismatch copy (no account enumeration)", () => {
    expect(
      toLoginFailure(
        apiErrorFromBody(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid phone or password" } }),
      ),
    ).toEqual({ code: "INVALID_CREDENTIALS", message: INVALID_CREDENTIALS_COPY });
    expect(toLoginFailure(apiErrorFromBody(401, "<html>401</html>"))).toEqual({
      code: "INVALID_CREDENTIALS",
      message: INVALID_CREDENTIALS_COPY,
    });
  });

  it("a 401 with another code (USER_INACTIVE: portal access disabled after a correct password) keeps the server's message", () => {
    const f = toLoginFailure(
      apiErrorFromBody(401, { error: { code: "USER_INACTIVE", message: "Portal access is disabled" } }),
    );
    expect(f).toEqual({ code: "OTHER", message: "Portal access is disabled" });
  });

  it("codes this build does not know keep the server's message; locks and rate limits keep their details", () => {
    expect(
      toLoginFailure(
        apiErrorFromBody(403, { error: { code: "SOME_NEW_RULE", message: "Sign-in is paused for maintenance" } }),
      ),
    ).toEqual({ code: "OTHER", message: "Sign-in is paused for maintenance" });
    expect(
      toLoginFailure(
        apiErrorFromBody(423, {
          error: { code: "LOCKED", message: "Locked", details: { locked_until: "2026-10-26T10:00:00Z" } },
        }),
      ),
    ).toMatchObject({ code: "LOCKED", lockedUntil: "2026-10-26T10:00:00Z" });
    expect(
      toLoginFailure(apiErrorFromBody(429, { error: { code: "RATE_LIMITED", message: "Slow down" } }, 30)),
    ).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 });
    expect(toLoginFailure(new Error("boom"))).toEqual({
      code: "OTHER",
      message: "Something went wrong. Please try again.",
    });
  });
});
