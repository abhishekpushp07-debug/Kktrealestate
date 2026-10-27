// Phase 7 money track contract changes: the ledger book of record (contract C7), dues-run failures, repair re-check and BOOKING_CLOSED.
import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.js";

const ID = "00000000-0000-4000-8000-000000000001";
const totals = {
  cash_due_paise: -100,
  account_due_paise: 200,
  total_due_paise: 100,
  other_charges_due_paise: 0,
  cash_paid_paise: 300,
  account_paid_paise: 0,
};
const bucket = {
  agreed_paise: 1,
  order_raised_paise: 1,
  paid_paise: 1,
  due_paise: 0,
  advance_paise: 0,
  pending_paise: 0,
};
const summary = {
  raised_percent: 10,
  cash: bucket,
  account: bucket,
  total_order_raised_paise: 2,
  total_paid_paise: 2,
  total_due_paise: 100,
  other_charges_total_paise: 0,
  other_charges_demanded_paise: 0,
  other_charges_paid_paise: 0,
  other_charges_due_paise: 0,
  pending_cheques_paise: 0,
  last_payment_at: null,
  next_installment: null,
};

describe("ledger response (contract C7)", () => {
  it("carries epoch, current_epoch, the six totals flat on the summary and the epoch's own totals", () => {
    const body = {
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      next_cursor: null,
      epoch: 1,
      current_epoch: 2,
      summary: { ...summary, ...totals },
      epoch_totals: totals,
    };
    expect(contracts.LedgerResponseSchema.parse(body)).toMatchObject({ epoch: 1, current_epoch: 2 });
    const { cash_due_paise: _dropped, ...withoutCashDue } = totals;
    expect(
      contracts.LedgerResponseSchema.safeParse({ ...body, summary: { ...summary, ...withoutCashDue } }).success,
    ).toBe(false);
    expect(contracts.LedgerResponseSchema.safeParse({ ...body, epoch: 0 }).success).toBe(false);
  });

  it("the ledger query accepts ?epoch=n (n ≥ 1) next to the list options", () => {
    expect(contracts.LedgerListQuerySchema.parse({ epoch: "3", page_size: "50" })).toMatchObject({
      epoch: 3,
      page_size: 50,
    });
    expect(contracts.LedgerListQuerySchema.safeParse({ epoch: "0" }).success).toBe(false);
    expect(contracts.LedgerListQuerySchema.parse({}).epoch).toBeUndefined();
  });

  it("knows the compensating and restatement events", () => {
    expect(contracts.LedgerEventSchema.parse("DEMAND_VOIDED")).toBe("DEMAND_VOIDED");
    expect(contracts.LedgerEventSchema.parse("LEDGER_RESTATED")).toBe("LEDGER_RESTATED");
  });

  it("a rebuild row: from → to epoch, a known reason, an optional staff actor, the summary diff", () => {
    const row = {
      id: ID,
      booking_id: ID,
      from_epoch: 1,
      to_epoch: 2,
      reason: "STAGE_UNDO",
      actor: { id: ID, name: "Admin" },
      at: "2026-10-26T10:00:00.000Z",
      summary: {
        rows_before: 4,
        rows_after: 4,
        differences: [{ position: 3, field: "amountPaise", stored: 0, recomputed: 100 }],
        before: totals,
        after: totals,
      },
    };
    expect(contracts.LedgerRebuildRowSchema.parse(row).reason).toBe("STAGE_UNDO");
    expect(contracts.LedgerRebuildRowSchema.parse({ ...row, actor: null }).actor).toBeNull();
    expect(contracts.LedgerRebuildRowSchema.safeParse({ ...row, reason: "WHATEVER" }).success).toBe(false);
    expect(contracts.LedgerRebuildRowSchema.safeParse({ ...row, to_epoch: 1 }).success).toBe(false);
    expect([...contracts.LEDGER_REBUILD_REASONS]).toEqual([
      "AGREEMENT_REVISION",
      "PLAN_CHANGE",
      "STAGE_UNDO",
      "CONSTRUCTION_CHARGE",
      "INTEGRITY_REPAIR",
      "ADMIN_RECOMPUTE",
      "LEDGER_REBUILD",
    ]);
  });
});

describe("dues run and repair", () => {
  it("a dues run lists the bookings that failed (optional, additive)", () => {
    const base = {
      bookings_processed: 3,
      demands_raised: 2,
      demand_numbers: ["DM-1", "DM-2"],
      notifications_sent: 4,
      started_at: "2026-10-26T10:00:00.000Z",
      finished_at: "2026-10-26T10:00:01.000Z",
    };
    expect(contracts.RunDuesResponseSchema.parse(base)).toEqual(base);
    const failed = {
      ...base,
      bookings_failed: 1,
      failures: [{ booking_id: ID, booking_number: "BK-2627/0001", code: "INVALID_AMOUNT", message: "bad percent" }],
    };
    expect(contracts.RunDuesResponseSchema.parse(failed).failures).toHaveLength(1);
  });

  it("repair reports the demands it kept because their trigger was satisfied again under the lock", () => {
    const shape = contracts.IntegrityRepairResponseSchema.shape;
    expect(shape.kept_now_satisfied.safeParse(["DM-2627/0004"]).success).toBe(true);
    expect(shape.kept_now_satisfied.safeParse(undefined).success).toBe(true);
  });
});

describe("BOOKING_CLOSED", () => {
  it("is a registered 409", () => {
    expect(contracts.ErrorCodeSchema.parse("BOOKING_CLOSED")).toBe("BOOKING_CLOSED");
    expect(contracts.statusForError("BOOKING_CLOSED")).toBe(409);
  });
});
