import { describe, expect, it } from "vitest";
import { bookingOtherCharges, demands } from "@kkt/db";
import { recordFromJson } from "../../src/modules/money/services/views.js";

/** The one-statement related-data loader maps `to_jsonb(row)` objects back onto Drizzle record shapes (docs/PERFORMANCE.md). */
describe("recordFromJson", () => {
  it("maps database column names to TS keys, revives timestamptz as Date and keeps date strings, numbers and nulls", () => {
    const d = recordFromJson(demands, {
      id: "7d1f1b1e-6d2a-4b9b-9e6c-1a2b3c4d5e6f",
      booking_id: "b1",
      company_id: "c1",
      installment_seq: 2,
      installment_name: "Excavation",
      status: "OPEN",
      percent: 5,
      cumulative_percent: 15,
      cash_demand_paise: 250000,
      account_demand_paise: 250000,
      total_demand_paise: 500000,
      paid_paise: 0,
      demand_date: "2026-04-10",
      due_date: "2026-04-25",
      posted_at: "2026-04-10T05:30:00.123+00:00",
      created_at: "2026-04-10T05:30:00.123+00:00",
      voided_at: null,
    });
    expect(d.bookingId).toBe("b1");
    expect(d.installmentSeq).toBe(2);
    expect(d.dueDate).toBe("2026-04-25");
    expect(d.postedAt).toBeInstanceOf(Date);
    expect((d.postedAt as Date).toISOString()).toBe("2026-04-10T05:30:00.123Z");
    expect(d.voidedAt).toBeNull();
    expect(d.percent).toBe(5);
    // columns absent from the JSON come back as null rather than undefined (what a SELECT would return for NULL)
    expect(d.voidReason).toBeNull();
  });

  it("treats a timestamp without an offset as UTC", () => {
    const c = recordFromJson(bookingOtherCharges, {
      id: "x",
      booking_id: "b",
      name: "Club",
      total_paise: 118000,
      demanded_at: "2026-04-10T05:30:00",
    });
    expect((c.demandedAt as Date).toISOString()).toBe("2026-04-10T05:30:00.000Z");
    expect(c.totalPaise).toBe(118000);
  });
});
