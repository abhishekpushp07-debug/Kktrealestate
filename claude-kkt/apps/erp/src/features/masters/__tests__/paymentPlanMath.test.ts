import { describe, expect, it } from "vitest";
import {
  SAMPLE_BOOKING,
  buildSchedulePreview,
  percentSum,
  shareOfPaise,
  sumPercentBasisPoints,
  toBasisPoints,
} from "../paymentPlanMath";

describe("percent sum helper", () => {
  it("sums in basis points so 33.33 + 33.33 + 33.34 is exactly 100", () => {
    const installments = [{ percent: 33.33 }, { percent: 33.33 }, { percent: 33.34 }];
    expect(sumPercentBasisPoints(installments)).toBe(10_000);
    const sum = percentSum(installments);
    expect(sum.complete).toBe(true);
    expect(sum.totalText).toBe("100.00");
    expect(sum.remaining).toBe(0);
  });

  it("ignores empty percents and reports the remainder or overshoot", () => {
    expect(toBasisPoints(null)).toBe(0);
    expect(toBasisPoints(undefined)).toBe(0);
    expect(toBasisPoints(12.5)).toBe(1250);
    const short = percentSum([{ percent: 10 }, { percent: null }, { percent: 40 }]);
    expect(short.complete).toBe(false);
    expect(short.over).toBe(false);
    expect(short.totalText).toBe("50.00");
    expect(short.remainingText).toBe("50.00");
    const over = percentSum([{ percent: 60 }, { percent: 50.5 }]);
    expect(over.over).toBe(true);
    expect(over.remainingText).toBe("10.50");
  });

  it("does not drift on float-unfriendly values", () => {
    const tenths = Array.from({ length: 10 }, () => ({ percent: 0.1 }));
    expect(sumPercentBasisPoints(tenths)).toBe(100);
    expect(percentSum([...tenths, { percent: 99 }]).complete).toBe(true);
  });
});

describe("schedule preview", () => {
  it("applies each percent equally to both buckets and lands exactly on the agreement", () => {
    const preview = buildSchedulePreview([
      { seq: 1, name: "Booking", percent: 10 },
      { seq: 2, name: "30 days", percent: 85 },
      { seq: 3, name: "Possession", percent: 5 },
    ]);
    expect(preview.rows.map((row) => row.account_paise)).toEqual([6_00_000_00, 51_00_000_00, 3_00_000_00]);
    expect(preview.rows.map((row) => row.cash_paise)).toEqual([4_00_000_00, 34_00_000_00, 2_00_000_00]);
    expect(preview.rows.map((row) => row.cumulative_percent)).toEqual([10, 95, 100]);
    expect(preview.totals.total_paise).toBe(SAMPLE_BOOKING.agreement_paise);
  });

  it("absorbs paisa rounding in the last installment when the plan is complete", () => {
    const preview = buildSchedulePreview([
      { seq: 1, name: "A", percent: 33.33 },
      { seq: 2, name: "B", percent: 33.33 },
      { seq: 3, name: "C", percent: 33.34 },
    ]);
    expect(preview.totals.account_paise).toBe(SAMPLE_BOOKING.account_paise);
    expect(preview.totals.cash_paise).toBe(SAMPLE_BOOKING.cash_paise);
    expect(shareOfPaise(60_00_000_00, 33.33)).toBe(19_99_800_00);
  });

  it("orders rows by seq and leaves totals short when percents do not reach 100", () => {
    const preview = buildSchedulePreview([
      { seq: 2, name: "Later", percent: 40 },
      { seq: 1, name: "First", percent: 10 },
    ]);
    expect(preview.rows.map((row) => row.name)).toEqual(["First", "Later"]);
    expect(preview.totals.total_paise).toBe(50_00_000_00);
  });
});
