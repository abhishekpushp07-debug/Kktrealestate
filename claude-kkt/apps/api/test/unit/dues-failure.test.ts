import { describe, expect, it } from "vitest";
import { MoneyError } from "@kkt/domain";
import { ApiError } from "../../src/lib/errors.js";
import { classifyFailure } from "../../src/modules/money/services/dues.js";

/** Phase 7 money review: how a dues / ledger-rebuild run classifies a per-booking failure (docs/hardening/phase7-review-money.md). */
describe("classifyFailure", () => {
  const pg = (code: string, message = "raw database text with values (42)") =>
    Object.assign(new Error(`Failed query: update …`), { cause: Object.assign(new Error(message), { code }) });

  it("keeps the booking's own ApiError and money errors with their messages", () => {
    expect(classifyFailure(ApiError.notFound("Booking"))).toEqual({
      code: "NOT_FOUND",
      message: "Booking not found",
      retryable: false,
      outage: false,
    });
    expect(classifyFailure(new MoneyError("bad percent"))).toMatchObject({
      code: "INVALID_AMOUNT",
      retryable: false,
      outage: false,
    });
  });

  it("treats connection loss as an outage (the run stops) and timeouts / conflicts as retryable", () => {
    for (const code of ["57P01", "08006", "53300", "CONNECTION_ENDED", "ECONNREFUSED"])
      expect(classifyFailure(pg(code)), code).toMatchObject({ retryable: true, outage: true });
    expect(classifyFailure(pg("57014"))).toMatchObject({ code: "SERVICE_UNAVAILABLE", retryable: true, outage: false });
    expect(classifyFailure(pg("55P03"))).toMatchObject({ code: "LOCK_TIMEOUT", retryable: true, outage: false });
    expect(classifyFailure(pg("40001"))).toMatchObject({ code: "CONFLICT_RETRY", retryable: true, outage: false });
  });

  it("never passes raw database or internal text through", () => {
    const db = classifyFailure(pg("23514", "new row violates check constraint secret_chk; value 99"));
    expect(db).toMatchObject({ code: "SQLSTATE_23514", retryable: false, outage: false });
    expect(db.message).not.toMatch(/secret|99/);
    const internal = classifyFailure(new TypeError("cannot read x of undefined at /srv/app.js:12"));
    expect(internal).toMatchObject({ code: "INTERNAL_ERROR", retryable: false, outage: false });
    expect(internal.message).not.toMatch(/srv|undefined/);
  });
});
