import { describe, expect, it } from "vitest";
import {
  chargeLineTotals,
  dueTone,
  emptyWizardState,
  firstIncompleteStep,
  fromDraftPayload,
  ledgerAmountTone,
  ledgerCategory,
  otherChargesTotal,
  paiseToPercent,
  percentToPaise,
  rebalanceSplitForTotal,
  splitFromAccount,
  splitFromAccountPercent,
  splitFromCash,
  splitFromCashPercent,
  splitIsExact,
  splitPercents,
  toDraftPayload,
  validateStep,
  type WizardState,
} from "../bookingMath";

const CRORE = 1_00_00_000_00; // ₹1,00,00,000 in paise

describe("cash / account split auto-balance", () => {
  it("fills the other bucket from the cash amount so the pair sums exactly", () => {
    expect(splitFromCash(CRORE, 60_00_000_00)).toEqual({ cash_paise: 60_00_000_00, account_paise: 40_00_000_00 });
    expect(splitFromCash(CRORE, 0)).toEqual({ cash_paise: 0, account_paise: CRORE });
    expect(splitFromCash(CRORE, null)).toEqual({ cash_paise: 0, account_paise: CRORE });
  });

  it("clamps an over-large bucket to the total instead of going negative", () => {
    expect(splitFromCash(CRORE, CRORE + 1)).toEqual({ cash_paise: CRORE, account_paise: 0 });
    expect(splitFromAccount(CRORE, -5)).toEqual({ cash_paise: CRORE, account_paise: 0 });
  });

  it("fills cash from the account amount", () => {
    expect(splitFromAccount(CRORE, 40_00_000_00)).toEqual({ cash_paise: 60_00_000_00, account_paise: 40_00_000_00 });
  });

  it("converts percentages to paise with half-up rounding on two-decimal percents", () => {
    expect(percentToPaise(CRORE, 60)).toBe(60_00_000_00);
    expect(percentToPaise(CRORE, 33.33)).toBe(33_33_000_00);
    expect(percentToPaise(1_00_001, 50)).toBe(50_001); // 50000.5 → 50001
    expect(percentToPaise(CRORE, null)).toBe(0);
    expect(percentToPaise(CRORE, 150)).toBe(CRORE);
  });

  it("round-trips amounts ↔ percentages", () => {
    expect(paiseToPercent(CRORE, 60_00_000_00)).toBe(60);
    expect(paiseToPercent(CRORE, 33_33_000_00)).toBe(33.33);
    expect(paiseToPercent(0, 10)).toBe(0);
    const split = splitFromCashPercent(CRORE, 33.33);
    expect(split).toEqual({ cash_paise: 33_33_000_00, account_paise: 66_67_000_00 });
    expect(splitPercents(CRORE, split)).toEqual({ cash: 33.33, account: 66.67 });
  });

  it("always sums to the total exactly, even on awkward totals and percents", () => {
    const totals = [1, 3, 7, 999, 1_234_567, 12_50_000_50, CRORE, 7_77_77_777_77];
    const percents = [0, 0.01, 12.34, 33.33, 50, 66.67, 99.99, 100];
    for (const total of totals) {
      for (const percent of percents) {
        const fromCash = splitFromCashPercent(total, percent);
        const fromAccount = splitFromAccountPercent(total, percent);
        expect(fromCash.cash_paise + fromCash.account_paise).toBe(total);
        expect(fromAccount.cash_paise + fromAccount.account_paise).toBe(total);
        expect(splitIsExact(total, fromCash)).toBe(true);
        expect(splitIsExact(total, fromAccount)).toBe(true);
      }
    }
  });

  it("keeps the cash share when the agreement total changes", () => {
    const previous = { cash_paise: 60_00_000_00, account_paise: 40_00_000_00 };
    const next = rebalanceSplitForTotal(previous, CRORE, 1_20_00_000_00);
    expect(next).toEqual({ cash_paise: 72_00_000_00, account_paise: 48_00_000_00 });
    expect(rebalanceSplitForTotal(previous, 0, 500)).toEqual({ cash_paise: 500, account_paise: 0 });
  });

  it("rejects splits that do not match the total", () => {
    expect(splitIsExact(CRORE, { cash_paise: 60_00_000_00, account_paise: 40_00_000_01 })).toBe(false);
    expect(splitIsExact(CRORE, { cash_paise: 60_00_000_00, account_paise: null as unknown as number })).toBe(false);
    expect(splitIsExact(null, { cash_paise: 1, account_paise: 1 })).toBe(false);
    expect(splitIsExact(10, { cash_paise: 5.5, account_paise: 4.5 })).toBe(false);
  });
});

describe("other charge totals", () => {
  it("adds GST half-up and sums lines", () => {
    expect(chargeLineTotals(1_00_000_00, 18)).toEqual({ base_paise: 1_00_000_00, gst_paise: 18_000_00, total_paise: 1_18_000_00 });
    expect(chargeLineTotals(333, 18)).toEqual({ base_paise: 333, gst_paise: 60, total_paise: 393 });
    const sum = otherChargesTotal([
      { charge_type_id: "a", amount_paise: 1_00_000_00, gst_percent: 18, demand_at: "ON_BOOKING" },
      { charge_type_id: "b", amount_paise: 50_000_00, gst_percent: 0, demand_at: "MANUAL" },
    ]);
    expect(sum).toEqual({ base_paise: 1_50_000_00, gst_paise: 18_000_00, total_paise: 1_68_000_00 });
  });
});

describe("ledger colouring", () => {
  it("colours negative dues as advances and positive as dues", () => {
    expect(dueTone(-6_00_000_00)).toBe("advance");
    expect(dueTone(1_00_000_00)).toBe("due");
    expect(dueTone(0)).toBe("settled");
    expect(dueTone(null)).toBe("settled");
  });

  it("marks payments as credits and reversals as debits", () => {
    expect(ledgerAmountTone({ event: "PAYMENT", amount_paise: 4_00_000_00 })).toBe("credit");
    expect(ledgerAmountTone({ event: "OTHER_CHARGE_PAYMENT", amount_paise: 100 })).toBe("credit");
    expect(ledgerAmountTone({ event: "REVERSAL", amount_paise: -4_00_000_00 })).toBe("debit");
    expect(ledgerAmountTone({ event: "OTHER_CHARGE_REVERSAL", amount_paise: -100 })).toBe("debit");
    expect(ledgerAmountTone({ event: "DEMAND", amount_paise: 10_00_000_00 })).toBe("neutral");
    expect(ledgerAmountTone({ event: "AGREEMENT_CHANGE", amount_paise: 0 })).toBe("neutral");
    expect(ledgerAmountTone({ event: "CANCELLATION", amount_paise: -500 })).toBe("debit");
  });

  it("derives the category chip from the event and bucket", () => {
    expect(ledgerCategory({ event: "PAYMENT", bucket: "CASH" })).toBe("CASH");
    expect(ledgerCategory({ event: "DEMAND", bucket: "ACCOUNT" })).toBe("ACCOUNT");
    expect(ledgerCategory({ event: "OTHER_CHARGE_DEMAND", bucket: null })).toBe("OTHER");
    expect(ledgerCategory({ event: "PLAN_CHANGE", bucket: null })).toBeNull();
  });
});

describe("wizard step validators", () => {
  const today = "2026-10-25";
  const context = { today, flatStatus: "AVAILABLE", plansAvailable: true };

  function complete(): WizardState {
    return {
      ...emptyWizardState(today),
      project_id: "p1",
      block_id: "b1",
      flat_id: "f1",
      customer_id: "c1",
      co_applicant_ids: ["c2"],
      booking_date: "2026-10-20",
      agreement_value_paise: CRORE,
      cash_agreed_paise: 60_00_000_00,
      account_agreed_paise: 40_00_000_00,
      payment_plan_id: "plan1",
      plan_accepted_on: "2026-10-21",
    };
  }

  it("accepts a complete booking on every step", () => {
    const state = complete();
    expect(validateStep("flat", state, context)).toEqual({});
    expect(validateStep("customer", state, context)).toEqual({});
    expect(validateStep("agreement", state, context)).toEqual({});
    expect(validateStep("plan", state, context)).toEqual({});
    expect(validateStep("charges", state, context)).toEqual({});
    expect(validateStep("review", state, context)).toEqual({});
    expect(firstIncompleteStep(state, context)).toBe(5);
  });

  it("requires project, tower, a bookable flat and a non-future booking date", () => {
    const state = emptyWizardState(today);
    const errors = validateStep("flat", state, context);
    expect(errors.project_id).toBeDefined();
    expect(errors.block_id).toBeDefined();
    expect(errors.flat_id).toBeDefined();
    expect(validateStep("flat", { ...complete(), booking_date: "2027-01-01" }, context).booking_date).toMatch(/future/);
    expect(validateStep("flat", complete(), { ...context, flatStatus: "BOOKED" }).flat_id).toMatch(/booked/);
    expect(validateStep("flat", complete(), { ...context, flatStatus: "HOLD" })).toEqual({});
    expect(firstIncompleteStep(state, context)).toBe(0);
  });

  it("rejects a primary applicant who is also a co-applicant and duplicates", () => {
    expect(validateStep("customer", { ...complete(), co_applicant_ids: ["c1"] }, context).co_applicant_ids).toMatch(/Primary/);
    expect(validateStep("customer", { ...complete(), co_applicant_ids: ["c2", "c2"] }, context).co_applicant_ids).toMatch(/Duplicate/);
    expect(validateStep("customer", { ...complete(), customer_id: null }, context).customer_id).toBeDefined();
  });

  it("insists the split equals the agreement value exactly", () => {
    const off = { ...complete(), account_agreed_paise: 40_00_000_01 };
    expect(validateStep("agreement", off, context).account_agreed_paise).toMatch(/exactly/);
    expect(validateStep("agreement", { ...complete(), agreement_value_paise: 0 }, context).agreement_value_paise).toMatch(/greater than 0/);
    expect(validateStep("agreement", { ...complete(), cash_agreed_paise: null }, context).cash_agreed_paise).toBeDefined();
    expect(firstIncompleteStep(off, context)).toBe(2);
  });

  it("checks the plan, acceptance date ordering and the signed copy upload", () => {
    expect(validateStep("plan", { ...complete(), payment_plan_id: null }, context).payment_plan_id).toBeDefined();
    expect(validateStep("plan", complete(), { ...context, plansAvailable: false }).payment_plan_id).toMatch(/No payment plan/);
    expect(validateStep("plan", { ...complete(), plan_accepted_on: "2026-10-19" }, context).plan_accepted_on).toMatch(/before the booking date/);
    expect(validateStep("plan", { ...complete(), plan_accepted_on: "2026-12-01" }, context).plan_accepted_on).toMatch(/future/);
    expect(validateStep("plan", { ...complete(), plan_acceptance_mode: "SIGNED_COPY" }, context).plan_acceptance_document_id).toMatch(/Upload/);
    expect(validateStep("plan", { ...complete(), plan_acceptance_mode: "SIGNED_COPY", plan_acceptance_document_id: "d1" }, context)).toEqual({});
  });

  it("validates charge lines and parking picks", () => {
    const state: WizardState = {
      ...complete(),
      other_charges: [
        { charge_type_id: "x", amount_paise: 100, gst_percent: 18, demand_at: "ON_BOOKING" },
        { charge_type_id: "x", amount_paise: -1, gst_percent: 200, demand_at: "MANUAL" },
      ],
      parking_slot_ids: ["s1", "s1"],
    };
    const errors = validateStep("charges", state, context);
    expect(errors.other_charges).toMatch(/only be added once/);
    expect(errors["other_charges.1.amount_paise"]).toBeDefined();
    expect(errors["other_charges.1.gst_percent"]).toBeDefined();
    expect(errors.parking_slot_ids).toMatch(/Duplicate/);
  });

  it("review aggregates every earlier step", () => {
    const errors = validateStep("review", { ...complete(), customer_id: null, payment_plan_id: null }, context);
    expect(errors.customer_id).toBeDefined();
    expect(errors.payment_plan_id).toBeDefined();
  });
});

describe("draft payload round trip", () => {
  const today = "2026-10-25";

  it("keeps only contract keys on the server payload", () => {
    const state = { ...emptyWizardState(today), project_id: "p", block_id: "b", flat_id: "f", split_mode: "PERCENT" as const, remarks: "  " };
    const payload = toDraftPayload(state);
    expect(payload).toEqual({ project_id: "p", block_id: "b", flat_id: "f", booking_date: today, plan_acceptance_mode: "IN_PERSON", plan_accepted_on: today });
    expect("split_mode" in payload).toBe(false);
  });

  it("restores state from a stored payload and ignores junk", () => {
    const restored = fromDraftPayload(
      {
        project_id: "p",
        flat_id: 42,
        co_applicant_ids: ["a", 5, "b"],
        agreement_value_paise: CRORE,
        cash_agreed_paise: "60",
        split_mode: "PERCENT",
        plan_acceptance_mode: "PORTAL",
        other_charges: [{ charge_type_id: "ct", amount_paise: 100, gst_percent: 18, demand_at: "ON_BOOKING" }, { charge_type_id: "bad", demand_at: "NOPE" }],
        broker_name: "Shah & Co",
      },
      today,
    );
    expect(restored.project_id).toBe("p");
    expect(restored.flat_id).toBeNull();
    expect(restored.co_applicant_ids).toEqual(["a", "b"]);
    expect(restored.agreement_value_paise).toBe(CRORE);
    expect(restored.cash_agreed_paise).toBeNull();
    expect(restored.split_mode).toBe("PERCENT");
    expect(restored.plan_acceptance_mode).toBe("PORTAL");
    expect(restored.other_charges).toHaveLength(1);
    expect(restored.broker_name).toBe("Shah & Co");
    expect(restored.booking_date).toBe(today);
  });
});
