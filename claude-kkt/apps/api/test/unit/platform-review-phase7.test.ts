/** Review of the phase 7 platform track: cursor values that Postgres would refuse are caught as 400 INVALID_CURSOR first. */
import { describe, expect, it } from "vitest";
import { bookings, jobRuns, ledgerEntries, payments, roomTypes } from "@kkt/db";
import { checkCursorValue } from "../../src/lib/list.js";
import { ApiError } from "../../src/lib/errors.js";
import { renditionKeys } from "../../src/modules/documents/renditions.js";
import { assertKey } from "../../src/lib/storage.js";

const id = "6f1c2a52-6c2b-4a43-9a8a-0c4f9d9f2b11";

function invalid(fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("INVALID_CURSOR");
    return;
  }
  throw new Error("expected INVALID_CURSOR");
}

describe("checkCursorValue: values Postgres would refuse", () => {
  it("timestamps: impossible calendar days, clock times, year 0 and wild offsets", () => {
    for (const v of [
      "2024-02-30 10:00:00.000000",
      "2023-02-29T10:00:00Z",
      "2024-04-31 00:00:00",
      "2024-01-01 24:00:00",
      "2024-01-01 23:60:00",
      "0000-01-01 00:00:00",
      "2024-01-01T00:00:00+16:00",
    ])
      invalid(() => checkCursorValue(jobRuns.startedAt, jobRuns.id, { v, id }));
    for (const v of ["2024-02-29 23:59:59.999999", "2026-10-26T10:00:00.123+05:30", "2026-12-31 00:00:00"])
      expect(() => checkCursorValue(jobRuns.startedAt, jobRuns.id, { v, id })).not.toThrow();
  });

  it("integer columns keep to their range (int4 / int8)", () => {
    invalid(() => checkCursorValue(roomTypes.sortOrder, roomTypes.id, { v: 2 ** 31, id }));
    invalid(() => checkCursorValue(roomTypes.sortOrder, roomTypes.id, { v: -(2 ** 31) - 1, id }));
    expect(() => checkCursorValue(roomTypes.sortOrder, roomTypes.id, { v: 2 ** 31 - 1, id })).not.toThrow();
    expect(() => checkCursorValue(ledgerEntries.seq, ledgerEntries.id, { v: 12, id })).not.toThrow();
    expect(() => checkCursorValue(payments.amountPaise, payments.id, { v: Number.MAX_SAFE_INTEGER, id })).not.toThrow();
    invalid(() => checkCursorValue(payments.amountPaise, payments.id, { v: 1.5, id }));
  });

  it("enum columns accept only their values; text refuses NUL characters", () => {
    expect(() => checkCursorValue(bookings.status, bookings.id, { v: "ACTIVE", id })).not.toThrow();
    invalid(() => checkCursorValue(bookings.status, bookings.id, { v: "ACTIVE'--", id }));
    invalid(() => checkCursorValue(roomTypes.name, roomTypes.id, { v: "a\u0000b", id }));
    expect(() => checkCursorValue(roomTypes.name, roomTypes.id, { v: "Kitchen", id })).not.toThrow();
  });
});

describe("rendition keys", () => {
  it("are fresh per run and valid storage keys", () => {
    const a = renditionKeys("c0/2026/10/6f1c2a52-6c2b-4a43-9a8a-0c4f9d9f2b11.png");
    const b = renditionKeys("c0/2026/10/6f1c2a52-6c2b-4a43-9a8a-0c4f9d9f2b11.png");
    expect(a.thumbKey).not.toBe(b.thumbKey);
    expect(a.thumbKey).toMatch(/^c0\/2026\/10\/6f1c2a52-6c2b-4a43-9a8a-0c4f9d9f2b11_thumb_[0-9a-f]{12}\.webp$/);
    expect(a.mediumKey).toMatch(/_medium_[0-9a-f]{12}\.webp$/);
    expect(() => assertKey(a.thumbKey)).not.toThrow();
    expect(() => assertKey(a.mediumKey)).not.toThrow();
  });
});
