import { describe, expect, it } from "vitest";
import {
  emptyWizardState,
  fromDraftPayload,
  handoverBlockers,
  newDraftId,
  priceDeviation,
  priceDeviationProblem,
  toBookingCreatePayload,
  toDraftPayload,
  validateStep,
  type WizardState,
} from "../bookingMath";
import { formatCountdown, isWizardHold, RESERVE_MINUTES, secondsLeft } from "../wizard/useFlatReservation";
import { bookingDeviation } from "../detail/OverviewTab";

const TODAY = "2026-10-26";
const LIST = 1_00_00_000_00; // ₹1 Cr in paise

function agreement(patch: Partial<WizardState>): WizardState {
  return {
    ...emptyWizardState(TODAY),
    agreement_value_paise: LIST,
    cash_agreed_paise: LIST,
    account_agreed_paise: 0,
    ...patch,
  };
}

describe("agreement value vs list price (money track: PRICE_DEVIATION_NOT_ALLOWED)", () => {
  it("accepts the list price without a reason", () => {
    expect(
      validateStep("agreement", agreement({}), { today: TODAY, listPricePaise: LIST, canEditAgreement: false }),
    ).toEqual({});
  });

  it("blocks a deviation for users without agreement.edit", () => {
    const state = agreement({ agreement_value_paise: LIST - 50_000_00, cash_agreed_paise: LIST - 50_000_00 });
    expect(
      validateStep("agreement", state, { today: TODAY, listPricePaise: LIST, canEditAgreement: false })
        .agreement_value_paise,
    ).toMatch(/Edit agreement/);
  });

  it("requires a reason (≥ 3 characters) for agreement.edit holders", () => {
    const state = agreement({ agreement_value_paise: LIST - 50_000_00, cash_agreed_paise: LIST - 50_000_00 });
    expect(
      validateStep("agreement", state, { today: TODAY, listPricePaise: LIST, canEditAgreement: true })
        .price_deviation_reason,
    ).toMatch(/reason/);
    expect(
      validateStep(
        "agreement",
        { ...state, price_deviation_reason: "  ok " },
        { today: TODAY, listPricePaise: LIST, canEditAgreement: true },
      ).price_deviation_reason,
    ).toBeDefined();
    expect(
      validateStep(
        "agreement",
        { ...state, price_deviation_reason: "Festive offer" },
        { today: TODAY, listPricePaise: LIST, canEditAgreement: true },
      ),
    ).toEqual({});
  });

  it("does not judge the deviation before the list price is known", () => {
    const state = agreement({ agreement_value_paise: 5, cash_agreed_paise: 5 });
    expect(validateStep("agreement", state, { today: TODAY })).toEqual({});
    expect(priceDeviation(5, null)).toBe(0);
    expect(priceDeviation(LIST + 100, LIST)).toBe(100);
  });

  it("sends the trimmed reason on create and keeps it in drafts", () => {
    const state = agreement({ price_deviation_reason: "  Director approved  " });
    expect(toBookingCreatePayload(state).price_deviation_reason).toBe("Director approved");
    expect("price_deviation_reason" in toBookingCreatePayload(agreement({}))).toBe(false);
    const draft = toDraftPayload(state);
    expect(draft.price_deviation_reason).toBe("Director approved");
    expect(fromDraftPayload(draft, TODAY).price_deviation_reason).toBe("Director approved");
    expect(toDraftPayload(agreement({ price_deviation_reason: "ab" })).price_deviation_reason).toBeUndefined();
  });

  it("explains the server's 422 details", () => {
    expect(
      priceDeviationProblem({
        rule: "PRICE_DEVIATION_NOT_ALLOWED",
        list_price_paise: LIST,
        needs: ["agreement.edit permission"],
      }),
    ).toMatch(/Edit agreement/);
    expect(priceDeviationProblem({ list_price_paise: LIST, needs: ["price_deviation_reason"] })).toMatch(
      /^Give a reason/,
    );
    expect(priceDeviationProblem({ list_price_paise: LIST, needs: ["price_deviation_reason"] })).toContain(
      "₹1,00,00,000",
    );
  });

  it("shows the recorded deviation on Booking 360", () => {
    expect(bookingDeviation({ agreement_value_paise: LIST - 100, list_price_paise: LIST })).toBe(-100);
    expect(bookingDeviation({ agreement_value_paise: LIST, list_price_paise: null })).toBeNull();
  });
});

describe("booking drafts: client-generated id", () => {
  it("is a v4 uuid and unique", () => {
    const a = newDraftId();
    const b = newDraftId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("flat reservation helpers", () => {
  it("counts down to the hold expiry", () => {
    const now = Date.parse("2026-10-26T10:00:00Z");
    expect(secondsLeft("2026-10-26T10:14:59.200Z", now)).toBe(900);
    expect(secondsLeft("2026-10-26T09:59:00Z", now)).toBe(0);
    expect(secondsLeft(null, now)).toBe(0);
    expect(formatCountdown(754)).toBe("12:34");
    expect(formatCountdown(5)).toBe("0:05");
  });

  it("releases only holds the wizard created (never a longer manual hold)", () => {
    const at = Date.parse("2026-10-26T10:00:00Z");
    expect(isWizardHold(new Date(at + RESERVE_MINUTES * 60_000).toISOString(), at)).toBe(true);
    expect(isWizardHold(new Date(at + 48 * 3600_000).toISOString(), at)).toBe(false);
    expect(isWizardHold(null, at)).toBe(false);
  });
});

describe("handover blockers (409 HANDOVER_BLOCKED)", () => {
  it("lists problems, unraised installments and bucket shortfalls", () => {
    expect(
      handoverBlockers({
        problems: ["Possession stage not complete", { message: "Cheques pending" }],
        unraised_installments: [{ seq: 9, name: "On possession" }],
        cash_short_paise: 1_00_000_00,
        account_short_paise: 0,
      }),
    ).toEqual([
      "Possession stage not complete",
      "Cheques pending",
      "Installments not raised yet: 9. On possession",
      "Cash bucket short by ₹1,00,000",
    ]);
    expect(handoverBlockers(undefined)).toEqual([]);
  });
});
