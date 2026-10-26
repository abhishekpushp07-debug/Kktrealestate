/**
 * Money & business-rule hardening (audit group E): canonical ledger order (posting order survives a rebuild), row-level ledger
 * comparison for integrity finding (e), and lapsed holds.
 */
import { describe, expect, it } from "vitest";
import {
  appendLedgerRow, deriveLedger, diffLedgerRows, effectiveFlatStatus, emptyLedgerSummary, isHoldExpired, reserveUntil, sortLedgerEvents,
  type LedgerEvent, type LedgerRow,
} from "../src/index.js";

const L = (lakh: number) => lakh * 10_000_000;

/** Live path: rows appended one by one in posting order (no sorting at all). */
function appendInPostingOrder(events: readonly LedgerEvent[]): LedgerRow[] {
  let summary = emptyLedgerSummary({ cashAgreedPaise: L(60), accountAgreedPaise: L(40) });
  const rows: LedgerRow[] = [];
  for (const e of events) {
    const step = appendLedgerRow(summary, e);
    rows.push(step.row);
    summary = step.summary;
  }
  return rows;
}

describe("canonical ledger order = posting order", () => {
  // Demand posted on 10 Jan; on 12 Jan Accounts posts a cheque that was received (payment_date) on 5 Jan; then another demand.
  const posted: LedgerEvent[] = [
    { kind: "DEMAND", at: "2026-01-01T05:00:00.000Z", cashPaise: L(6), accountPaise: L(4), refNumber: "DM-1", refId: "d1" },
    { kind: "PAYMENT", at: "2026-01-02T05:00:00.000Z", entryDate: "2026-01-02", bucket: "ACCOUNT", amountPaise: L(4), refNumber: "R-1", refId: "p1" },
    { kind: "DEMAND", at: "2026-01-10T05:00:00.000Z", cashPaise: L(3), accountPaise: L(2), refNumber: "DM-2", refId: "d2" },
    { kind: "PAYMENT", at: "2026-01-12T06:00:00.000Z", entryDate: "2026-01-05", bucket: "CASH", amountPaise: L(8), refNumber: "R-2", refId: "p2" },
    { kind: "AGREEMENT_CHANGE", at: "2026-01-15T06:00:00.000Z", cashAgreedPaise: L(55), accountAgreedPaise: L(45), cashRaisedAdjustmentPaise: -L(1), accountRaisedAdjustmentPaise: L(1), refId: "r1" },
  ];

  it("a payment dated before an earlier-posted demand keeps its seq and running balances after a rebuild", () => {
    const live = appendInPostingOrder(posted);
    // the rebuild reads the source tables in arbitrary order
    const shuffled = [posted[3]!, posted[0]!, posted[4]!, posted[2]!, posted[1]!];
    const rebuilt = deriveLedger(shuffled, emptyLedgerSummary({ cashAgreedPaise: L(60), accountAgreedPaise: L(40) })).rows;
    expect(rebuilt.map((r) => r.refNumber ?? r.event)).toEqual(["DM-1", "R-1", "DM-2", "R-2", "AGREEMENT_CHANGE"]);
    expect(rebuilt).toEqual(live);
    // the receipt row keeps its business date for display
    expect(rebuilt[3]).toMatchObject({ seq: 4, entryDate: "2026-01-05", cashDuePaise: L(1), accountDuePaise: L(2), totalDuePaise: L(3) });
    expect(diffLedgerRows(live, rebuilt)).toEqual([]);
  });

  it("orders equal instants by kind priority, then source id, never by business date", () => {
    const at = "2026-02-01T10:00:00.000Z";
    const events: LedgerEvent[] = [
      { kind: "PAYMENT", at, entryDate: "2026-01-01", bucket: "CASH", amountPaise: 1, refId: "b" },
      { kind: "PAYMENT", at, entryDate: "2025-12-01", bucket: "CASH", amountPaise: 1, refId: "a" },
      { kind: "DEMAND", at, cashPaise: 1, accountPaise: 0, refId: "z" },
    ];
    expect(sortLedgerEvents(events).map((e) => e.refId)).toEqual(["z", "a", "b"]);
  });
});

describe("diffLedgerRows (integrity finding e)", () => {
  const rows = deriveLedger([
    { kind: "DEMAND", at: "2026-01-01T05:00:00Z", cashPaise: 100, accountPaise: 0, refId: "d1" },
    { kind: "PAYMENT", at: "2026-01-02T05:00:00Z", bucket: "CASH", amountPaise: 40, refId: "p1" },
    { kind: "DEMAND", at: "2026-01-03T05:00:00Z", cashPaise: 50, accountPaise: 0, refId: "d2" },
  ]).rows;

  it("finds swapped rows even when every aggregate agrees", () => {
    const swapped = [rows[0]!, { ...rows[2]!, seq: 2, cashDuePaise: 150, totalDuePaise: 150, cashPaidCumPaise: 0 }, { ...rows[1]!, seq: 3, cashDuePaise: 110, totalDuePaise: 110, cashPaidCumPaise: 40 }];
    const diff = diffLedgerRows(swapped, rows);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff[0]).toMatchObject({ position: 2 });
    expect(diff.map((d) => d.field)).toContain("event");
    expect(diff.map((d) => d.field)).toContain("cashDuePaise");
  });

  it("reports missing / extra rows and respects the limit", () => {
    expect(diffLedgerRows(rows.slice(0, 2), rows)).toEqual([{ position: 3, field: "row", stored: null, recomputed: "DEMAND" }]);
    expect(diffLedgerRows(rows, [])).toHaveLength(3);
    expect(diffLedgerRows(rows, [], 1)).toHaveLength(1);
  });
});

describe("holds", () => {
  const now = new Date("2026-03-01T10:00:00Z");
  it("a HOLD past hold_until reads as AVAILABLE; other statuses and open-ended holds do not lapse", () => {
    expect(isHoldExpired({ status: "HOLD", holdUntil: new Date("2026-03-01T09:59:59Z") }, now)).toBe(true);
    expect(isHoldExpired({ status: "HOLD", holdUntil: "2026-03-01T10:00:00Z" }, now)).toBe(true);
    expect(isHoldExpired({ status: "HOLD", holdUntil: "2026-03-01T10:00:01Z" }, now)).toBe(false);
    expect(isHoldExpired({ status: "HOLD", holdUntil: null }, now)).toBe(false);
    expect(isHoldExpired({ status: "BLOCKED", holdUntil: "2026-01-01T00:00:00Z" }, now)).toBe(false);
    expect(effectiveFlatStatus({ status: "HOLD" as const, holdUntil: "2026-02-01T00:00:00Z" }, now)).toBe("AVAILABLE");
    expect(effectiveFlatStatus({ status: "BOOKED" as const, holdUntil: null }, now)).toBe("BOOKED");
  });
  it("reserveUntil accepts 1–30 whole minutes", () => {
    expect(reserveUntil(15, now).toISOString()).toBe("2026-03-01T10:15:00.000Z");
    expect(() => reserveUntil(0, now)).toThrow(RangeError);
    expect(() => reserveUntil(31, now)).toThrow(RangeError);
    expect(() => reserveUntil(2.5, now)).toThrow(RangeError);
  });
});
