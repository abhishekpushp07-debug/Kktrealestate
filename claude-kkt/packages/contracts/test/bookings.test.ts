import { describe, expect, it } from "vitest";
import {
  AgreementRevisionCreateSchema,
  BookingCreateSchema,
  PaymentCreateSchema,
  RateCardRateSchema,
} from "../src/index.js";

const U = (n: number) => `${n.toString().padStart(8, "0")}-0000-4000-8000-000000000000`;

const base = {
  flat_id: U(1),
  customer_id: U(2),
  booking_date: "2026-04-01",
  agreement_value_paise: 1_00_00_000_00,
  cash_agreed_paise: 60_00_000_00,
  account_agreed_paise: 40_00_000_00,
  payment_plan_id: U(3),
  plan_acceptance_mode: "IN_PERSON" as const,
  plan_accepted_on: "2026-04-01",
};

describe("BookingCreateSchema", () => {
  it("accepts a booking whose cash + account equals the agreement value", () => {
    const r = BookingCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data?.co_applicant_ids).toEqual([]);
    expect(r.data?.other_charges).toEqual([]);
  });
  it("rejects a split that does not add up", () => {
    const r = BookingCreateSchema.safeParse({ ...base, account_agreed_paise: 40_00_000_00 + 1 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["account_agreed_paise"]);
  });
  it("rejects zero agreement value, duplicate co-applicants and the primary as co-applicant", () => {
    expect(
      BookingCreateSchema.safeParse({
        ...base,
        agreement_value_paise: 0,
        cash_agreed_paise: 0,
        account_agreed_paise: 0,
      }).success,
    ).toBe(false);
    expect(BookingCreateSchema.safeParse({ ...base, co_applicant_ids: [U(9), U(9)] }).success).toBe(false);
    expect(BookingCreateSchema.safeParse({ ...base, co_applicant_ids: [U(2)] }).success).toBe(false);
  });
  it("requires the signed copy document for SIGNED_COPY acceptance", () => {
    expect(BookingCreateSchema.safeParse({ ...base, plan_acceptance_mode: "SIGNED_COPY" }).success).toBe(false);
    expect(
      BookingCreateSchema.safeParse({ ...base, plan_acceptance_mode: "SIGNED_COPY", plan_acceptance_document_id: U(7) })
        .success,
    ).toBe(true);
  });
  it("validates other charges and parking", () => {
    const ok = BookingCreateSchema.safeParse({
      ...base,
      other_charges: [{ charge_type_id: U(5), amount_paise: 50_000_00, gst_percent: 18, demand_at: "ON_BOOKING" }],
      parking_slot_ids: [U(6)],
    });
    expect(ok.success).toBe(true);
    expect(
      BookingCreateSchema.safeParse({
        ...base,
        other_charges: [{ charge_type_id: U(5), amount_paise: -1, demand_at: "MANUAL" }],
      }).success,
    ).toBe(false);
  });
});

describe("AgreementRevisionCreateSchema", () => {
  it("enforces the split and a reason", () => {
    const ok = {
      version: 1,
      agreement_value_paise: 100,
      cash_agreed_paise: 60,
      account_agreed_paise: 40,
      reason: "Loan sanctioned for more",
    };
    expect(AgreementRevisionCreateSchema.safeParse(ok).success).toBe(true);
    expect(AgreementRevisionCreateSchema.safeParse({ ...ok, cash_agreed_paise: 61 }).success).toBe(false);
    expect(AgreementRevisionCreateSchema.safeParse({ ...ok, reason: "" }).success).toBe(false);
  });
});

describe("PaymentCreateSchema", () => {
  const p = { booking_id: U(1), amount_paise: 4_00_000_00, payment_date: "2026-04-02", payment_mode_id: U(4) };
  it("needs a bucket for FLAT_VALUE and a charge line for OTHER_CHARGE", () => {
    expect(PaymentCreateSchema.safeParse({ ...p, against: "FLAT_VALUE", bucket: "ACCOUNT" }).success).toBe(true);
    expect(PaymentCreateSchema.safeParse({ ...p, against: "FLAT_VALUE" }).success).toBe(false);
    expect(
      PaymentCreateSchema.safeParse({ ...p, against: "FLAT_VALUE", bucket: "CASH", other_charge_id: U(8) }).success,
    ).toBe(false);
    expect(PaymentCreateSchema.safeParse({ ...p, against: "OTHER_CHARGE", other_charge_id: U(8) }).success).toBe(true);
    expect(PaymentCreateSchema.safeParse({ ...p, against: "OTHER_CHARGE" }).success).toBe(false);
    expect(
      PaymentCreateSchema.safeParse({ ...p, against: "OTHER_CHARGE", other_charge_id: U(8), bucket: "CASH" }).success,
    ).toBe(false);
  });
  it("rejects non-positive amounts", () => {
    expect(
      PaymentCreateSchema.safeParse({ ...p, against: "FLAT_VALUE", bucket: "CASH", amount_paise: 0 }).success,
    ).toBe(false);
  });
});

describe("RateCardRateSchema", () => {
  it("needs exactly one of rate or lump sum", () => {
    expect(RateCardRateSchema.safeParse({ flat_type_id: U(1), rate_per_sqft_paise: 4500_00 }).success).toBe(true);
    expect(RateCardRateSchema.safeParse({ flat_type_id: U(1), lump_sum_paise: 50_00_000_00 }).success).toBe(true);
    expect(RateCardRateSchema.safeParse({ flat_type_id: U(1) }).success).toBe(false);
    expect(
      RateCardRateSchema.safeParse({ flat_type_id: U(1), rate_per_sqft_paise: 1, lump_sum_paise: 1 }).success,
    ).toBe(false);
  });
});
