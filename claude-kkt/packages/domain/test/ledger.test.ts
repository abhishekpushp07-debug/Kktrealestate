import { describe, expect, it } from "vitest";
import {
  LedgerError,
  appendLedgerRow,
  bucketCapCheck,
  demandStatuses,
  deriveLedger,
  emptyLedgerSummary,
  ledgerEntryDate,
  sortLedgerEvents,
  toPaise,
  type Bucket,
  type LedgerEvent,
} from "../src/index.js";
import { randInt, rng } from "./helpers.js";

const L = (lakh: number): number => lakh * 100_000 * 100;

/** The SPEC §11 worked example: cumulative plan and one payment after each stage. */
function workedExampleEvents(): LedgerEvent[] {
  const cumulative = [10, 15, 25, 30, 40, 50, 60, 75, 85, 100];
  const payments: { bucket: Bucket; lakh: number }[] = [
    { bucket: "ACCOUNT", lakh: 4 },
    { bucket: "CASH", lakh: 8 },
    { bucket: "ACCOUNT", lakh: 12 },
    { bucket: "CASH", lakh: 5 },
    { bucket: "CASH", lakh: 10 },
    { bucket: "ACCOUNT", lakh: 15 },
    { bucket: "CASH", lakh: 7 },
    { bucket: "CASH", lakh: 20 },
    { bucket: "ACCOUNT", lakh: 9 },
    { bucket: "CASH", lakh: 10 },
  ];
  const events: LedgerEvent[] = [];
  let prev = 0;
  cumulative.forEach((cum, i) => {
    const pct = cum - prev;
    prev = cum;
    const at = `2026-0${Math.floor(i / 3) + 1}-${String((i % 3) * 10 + 1).padStart(2, "0")}`;
    events.push({
      kind: "DEMAND",
      at,
      label: `Stage ${i + 1}`,
      cashPaise: (L(60) * pct) / 100,
      accountPaise: (L(40) * pct) / 100,
      refNumber: `DM-${i + 1}`,
    });
    const payment = payments[i] as { bucket: Bucket; lakh: number };
    events.push({
      kind: "PAYMENT",
      at,
      bucket: payment.bucket,
      amountPaise: L(payment.lakh),
      refNumber: `RC-${i + 1}`,
    });
  });
  return events;
}

describe("worked example (SPEC §11)", () => {
  const expected: [number, number, number][] = [
    [6, 0, 6],
    [1, 2, 3],
    [7, -6, 1],
    [5, -4, 1],
    [1, 0, 1],
    [7, -11, -4],
    [6, -7, -1],
    [-5, -1, -6],
    [1, -6, -5],
    [0, 0, 0],
  ];
  it("reproduces all 10 rows exactly", () => {
    const { rows, summary } = deriveLedger(workedExampleEvents());
    expect(rows).toHaveLength(20);
    const afterPayments = rows.filter((r) => r.event === "PAYMENT");
    expected.forEach(([cash, account, total], i) => {
      const row = afterPayments[i];
      expect(row?.cashDuePaise, `row #${i + 1} cash due`).toBe(L(cash));
      expect(row?.accountDuePaise, `row #${i + 1} account due`).toBe(L(account));
      expect(row?.totalDuePaise, `row #${i + 1} total due`).toBe(L(total));
    });
    expect(summary.cashOrderRaisedPaise).toBe(L(60));
    expect(summary.accountOrderRaisedPaise).toBe(L(40));
    expect(summary.cashPaidPaise).toBe(L(60));
    expect(summary.accountPaidPaise).toBe(L(40));
    expect(summary.totalDuePaise).toBe(0);
    expect(summary.seq).toBe(20);
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1));
  });
  it("first demand row shows raised but unpaid", () => {
    const { rows } = deriveLedger(workedExampleEvents());
    expect(rows[0]).toMatchObject({
      event: "DEMAND",
      amountPaise: L(10),
      cashDuePaise: L(6),
      accountDuePaise: L(4),
      totalDuePaise: L(10),
      refNumber: "DM-1",
      entryDate: "2026-01-01",
    });
    expect(rows[1]).toMatchObject({
      event: "PAYMENT",
      bucket: "ACCOUNT",
      amountPaise: L(4),
      accountPaidCumPaise: L(4),
      cashPaidCumPaise: 0,
    });
  });
});

describe("sorting and dates", () => {
  it("sorts by at then kind priority, stable", () => {
    const events: LedgerEvent[] = [
      { kind: "PAYMENT", at: "2026-01-01T10:00:00Z", bucket: "CASH", amountPaise: 1, refNumber: "p1" },
      { kind: "DEMAND", at: "2026-01-01T10:00:00Z", cashPaise: 1, accountPaise: 0, refNumber: "d1" },
      { kind: "PAYMENT", at: "2025-12-31T10:00:00Z", bucket: "CASH", amountPaise: 2, refNumber: "p0" },
      { kind: "PAYMENT", at: "2026-01-01T10:00:00Z", bucket: "CASH", amountPaise: 3, refNumber: "p2" },
    ];
    expect(sortLedgerEvents(events).map((e) => e.refNumber)).toEqual(["p0", "d1", "p1", "p2"]);
    expect(events[0]?.refNumber).toBe("p1");
  });
  it("derives the IST entry date from an instant", () => {
    expect(ledgerEntryDate({ at: "2026-01-01T19:00:00Z" })).toBe("2026-01-02");
    expect(ledgerEntryDate({ at: "2026-01-01" })).toBe("2026-01-01");
    expect(ledgerEntryDate({ at: "2026-01-01T19:00:00Z", entryDate: "2026-01-01" })).toBe("2026-01-01");
  });
});

describe("other events", () => {
  it("handles reversals, other charges, agreement/plan changes and cancellation", () => {
    const events: LedgerEvent[] = [
      {
        kind: "AGREEMENT_CHANGE",
        at: "2026-01-01",
        cashAgreedPaise: L(60),
        accountAgreedPaise: L(40),
        label: "Agreement",
      },
      { kind: "DEMAND", at: "2026-01-02", cashPaise: L(6), accountPaise: L(4) },
      { kind: "OTHER_CHARGE_DEMAND", at: "2026-01-02", amountPaise: L(1), label: "Registry" },
      { kind: "PAYMENT", at: "2026-01-03", bucket: "CASH", amountPaise: L(6) },
      { kind: "REVERSAL", at: "2026-01-04", bucket: "CASH", amountPaise: L(6), label: "Cheque bounced" },
      { kind: "OTHER_CHARGE_PAYMENT", at: "2026-01-05", amountPaise: L(1) },
      { kind: "OTHER_CHARGE_REVERSAL", at: "2026-01-06", amountPaise: toPaise("50,000") },
      {
        kind: "AGREEMENT_CHANGE",
        at: "2026-01-07",
        cashAgreedPaise: L(50),
        accountAgreedPaise: L(50),
        cashRaisedAdjustmentPaise: -L(1),
        accountRaisedAdjustmentPaise: L(1),
      },
      { kind: "PLAN_CHANGE", at: "2026-01-08", cashRaisedAdjustmentPaise: -L(5), accountRaisedAdjustmentPaise: -L(5) },
      { kind: "CANCELLATION", at: "2026-01-09", refundPaise: L(0), deductionPaise: L(0) },
    ];
    const { rows, summary } = deriveLedger(events);
    expect(rows[0]).toMatchObject({ event: "AGREEMENT_CHANGE", amountPaise: L(100), totalDuePaise: 0 });
    expect(rows[2]).toMatchObject({ event: "OTHER_CHARGE_DEMAND", otherChargesDuePaise: L(1), totalDuePaise: L(10) });
    expect(rows[3]).toMatchObject({ cashDuePaise: 0, cashPaidCumPaise: L(6) });
    expect(rows[4]).toMatchObject({ event: "REVERSAL", amountPaise: -L(6), cashDuePaise: L(6), cashPaidCumPaise: 0 });
    expect(rows[5]?.otherChargesDuePaise).toBe(0);
    expect(rows[6]).toMatchObject({ amountPaise: -toPaise("50,000"), otherChargesDuePaise: toPaise("50,000") });
    expect(rows[7]).toMatchObject({ amountPaise: 0, cashOrderRaisedPaise: L(5), accountOrderRaisedPaise: L(5) });
    expect(rows[8]).toMatchObject({
      event: "PLAN_CHANGE",
      amountPaise: -L(10),
      cashOrderRaisedPaise: 0,
      accountOrderRaisedPaise: 0,
      totalDuePaise: 0,
    });
    expect(rows[9]).toMatchObject({ event: "CANCELLATION", amountPaise: 0 });
    expect(summary.isClosed).toBe(true);
    expect(summary.cashAgreedPaise).toBe(L(50));
    expect(summary.otherChargesDuePaise).toBe(toPaise("50,000"));
    expect(() =>
      appendLedgerRow(summary, { kind: "PAYMENT", at: "2026-01-10", bucket: "CASH", amountPaise: 1 }),
    ).toThrow(LedgerError);
  });
  it("rejects non-positive money-moving amounts", () => {
    const start = emptyLedgerSummary();
    expect(() => appendLedgerRow(start, { kind: "PAYMENT", at: "2026-01-01", bucket: "CASH", amountPaise: 0 })).toThrow(
      LedgerError,
    );
    expect(() =>
      appendLedgerRow(start, { kind: "REVERSAL", at: "2026-01-01", bucket: "CASH", amountPaise: -5 }),
    ).toThrow(LedgerError);
    expect(() =>
      appendLedgerRow(start, { kind: "DEMAND", at: "2026-01-01", cashPaise: 1.5, accountPaise: 0 }),
    ).toThrow();
  });
});

describe("deriveLedger vs appendLedgerRow", () => {
  it("agree on random event streams", () => {
    const next = rng(7);
    const buckets: Bucket[] = ["CASH", "ACCOUNT"];
    for (let run = 0; run < 100; run += 1) {
      const count = randInt(next, 1, 40);
      const events: LedgerEvent[] = [];
      for (let i = 0; i < count; i += 1) {
        const at = `2026-${String(randInt(next, 1, 12)).padStart(2, "0")}-${String(randInt(next, 1, 28)).padStart(2, "0")}T${String(randInt(next, 0, 23)).padStart(2, "0")}:00:00Z`;
        const bucket = buckets[randInt(next, 0, 1)] as Bucket;
        switch (randInt(next, 0, 7)) {
          case 0:
          case 1:
            events.push({
              kind: "DEMAND",
              at,
              cashPaise: randInt(next, 0, L(10)),
              accountPaise: randInt(next, 0, L(10)),
            });
            break;
          case 2:
          case 3:
            events.push({ kind: "PAYMENT", at, bucket, amountPaise: randInt(next, 1, L(10)) });
            break;
          case 4:
            events.push({ kind: "REVERSAL", at, bucket, amountPaise: randInt(next, 1, L(5)) });
            break;
          case 5:
            events.push({ kind: "OTHER_CHARGE_DEMAND", at, amountPaise: randInt(next, 1, L(2)) });
            break;
          case 6:
            events.push({ kind: "OTHER_CHARGE_PAYMENT", at, amountPaise: randInt(next, 1, L(2)) });
            break;
          default:
            events.push({
              kind: "PLAN_CHANGE",
              at,
              cashRaisedAdjustmentPaise: randInt(next, -L(2), L(2)),
              accountRaisedAdjustmentPaise: randInt(next, -L(2), L(2)),
            });
        }
      }
      const derived = deriveLedger(events);
      let summary = emptyLedgerSummary();
      const rows = [];
      for (const event of sortLedgerEvents(events)) {
        const step = appendLedgerRow(summary, event);
        rows.push(step.row);
        summary = step.summary;
      }
      expect(rows).toEqual(derived.rows);
      expect(summary).toEqual(derived.summary);
      // invariants
      const last = derived.rows.at(-1);
      expect(last?.totalDuePaise).toBe((last?.cashDuePaise ?? 0) + (last?.accountDuePaise ?? 0));
      expect(derived.summary.cashDuePaise).toBe(derived.summary.cashOrderRaisedPaise - derived.summary.cashPaidPaise);
      const paidCash = events.reduce(
        (s, e) =>
          s +
          (e.kind === "PAYMENT" && e.bucket === "CASH"
            ? e.amountPaise
            : e.kind === "REVERSAL" && e.bucket === "CASH"
              ? -e.amountPaise
              : 0),
        0,
      );
      expect(derived.summary.cashPaidPaise).toBe(paidCash);
    }
  });
});

describe("bucketCapCheck", () => {
  it("produces the SPEC message", () => {
    const result = bucketCapCheck({
      bucket: "ACCOUNT",
      bucketAgreedPaise: L(40),
      bucketPaidPaise: L(35),
      amountPaise: L(8),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BUCKET_CAP_EXCEEDED");
      expect(result.message).toBe(
        "Account agreed ₹40,00,000; already received ₹35,00,000; cannot accept ₹8,00,000 – revise the agreement first",
      );
      expect(result.details.headroomPaise).toBe(L(5));
    }
    expect(
      bucketCapCheck({ bucket: "ACCOUNT", bucketAgreedPaise: L(40), bucketPaidPaise: L(35), amountPaise: L(5) }),
    ).toEqual({ ok: true });
    expect(
      bucketCapCheck({ bucket: "CASH", bucketAgreedPaise: L(60), bucketPaidPaise: 0, amountPaise: L(60) }),
    ).toEqual({ ok: true });
    const cash = bucketCapCheck({ bucket: "CASH", bucketAgreedPaise: L(60), bucketPaidPaise: L(60), amountPaise: 1 });
    expect(cash.ok).toBe(false);
    if (!cash.ok) {
      expect(cash.message.startsWith("Cash agreed ₹60,00,000; already received ₹60,00,000; cannot accept ₹0.01")).toBe(
        true,
      );
    }
  });
});

describe("demandStatuses", () => {
  const demands = [
    { id: "d1", cashPaise: L(6), accountPaise: L(4) },
    { id: "d2", cashPaise: L(3), accountPaise: L(2) },
    { id: "d3", cashPaise: L(6), accountPaise: L(4) },
  ];
  it("allocates FIFO per bucket", () => {
    const statuses = demandStatuses(demands, L(8), L(4));
    expect(statuses[0]).toEqual({
      id: "d1",
      status: "PAID",
      cashPaidPaise: L(6),
      accountPaidPaise: L(4),
      paidPaise: L(10),
    });
    expect(statuses[1]).toEqual({
      id: "d2",
      status: "PARTIALLY_PAID",
      cashPaidPaise: L(2),
      accountPaidPaise: 0,
      paidPaise: L(2),
    });
    expect(statuses[2]).toEqual({ id: "d3", status: "OPEN", cashPaidPaise: 0, accountPaidPaise: 0, paidPaise: 0 });
  });
  it("advances beyond raised do not over-allocate", () => {
    const statuses = demandStatuses(demands, L(100), L(100));
    expect(statuses.every((s) => s.status === "PAID")).toBe(true);
    expect(statuses.reduce((s, d) => s + d.paidPaise, 0)).toBe(L(25));
    expect(demandStatuses(demands, 0, 0).every((s) => s.status === "OPEN")).toBe(true);
    expect(demandStatuses([{ id: "z", cashPaise: 0, accountPaise: 0 }], 0, 0)[0]?.status).toBe("PAID");
  });
});

describe("DEMAND_VOIDED (contract C7: a voided demand leaves a compensating row)", () => {
  const demand: LedgerEvent = {
    kind: "DEMAND",
    at: "2026-04-01T10:00:00.000Z",
    label: "Plinth",
    refId: "d1",
    cashPaise: L(6),
    accountPaise: L(4),
  };
  const voided: LedgerEvent = {
    kind: "DEMAND_VOIDED",
    at: "2026-04-03T10:00:00.000Z",
    label: "Plinth voided",
    refId: "d1",
    cashPaise: L(6),
    accountPaise: L(4),
  };

  it("takes the demand back out of the order raised; the row amount is negative and the DEMAND row stays", () => {
    const { rows, summary } = deriveLedger(
      [demand, voided],
      emptyLedgerSummary({ cashAgreedPaise: L(60), accountAgreedPaise: L(40) }),
    );
    expect(rows.map((r) => r.event)).toEqual(["DEMAND", "DEMAND_VOIDED"]);
    expect(rows[1]).toMatchObject({
      amountPaise: -L(10),
      bucket: null,
      cashOrderRaisedPaise: 0,
      accountOrderRaisedPaise: 0,
    });
    expect(summary).toMatchObject({ cashOrderRaisedPaise: 0, accountOrderRaisedPaise: 0, totalDuePaise: 0 });
  });

  it("an earlier advance returns to credit (negative due) once the funded demand is voided", () => {
    const paid: LedgerEvent = { kind: "PAYMENT", at: "2026-04-02T10:00:00.000Z", bucket: "CASH", amountPaise: L(6) };
    const { summary } = deriveLedger([demand, paid, voided]);
    expect(summary.cashDuePaise).toBe(-L(6));
    expect(summary.accountDuePaise).toBe(0);
  });

  it("sorts after demands, agreement and plan changes and before payments of the same instant; append equals derive", () => {
    const at = "2026-05-01T00:00:00.000Z";
    const sameInstant: LedgerEvent[] = [
      { kind: "PAYMENT", at, bucket: "CASH", amountPaise: 1 },
      { ...voided, at },
      { kind: "PLAN_CHANGE", at },
      { ...demand, at, refId: "d0" },
    ];
    expect(sortLedgerEvents(sameInstant).map((e) => e.kind)).toEqual([
      "DEMAND",
      "PLAN_CHANGE",
      "DEMAND_VOIDED",
      "PAYMENT",
    ]);
    let s = emptyLedgerSummary();
    const appended = [demand, voided].map((e) => {
      const next = appendLedgerRow(s, e);
      s = next.summary;
      return next.row;
    });
    expect(appended).toEqual(deriveLedger([demand, voided]).rows);
  });

  it("rejects negative magnitudes and a voided demand on a closed ledger", () => {
    expect(() => deriveLedger([demand, { ...voided, cashPaise: -1 }])).toThrow(LedgerError);
    const closed: LedgerEvent = {
      kind: "CANCELLATION",
      at: "2026-04-02T00:00:00.000Z",
      refundPaise: 0,
      deductionPaise: 0,
    };
    expect(() => deriveLedger([demand, closed, voided])).toThrow(/closed/);
  });
});
