import { describe, expect, it } from "vitest";
import {
  LeadStageChangeSchema,
  PublicBrochureRequestSchema,
  PublicEnquiryInputSchema,
  PublicVisitBookingInputSchema,
  toPublicAvailability,
} from "../src/index.js";

describe("LeadStageChangeSchema", () => {
  it("requires a reason when moving to LOST", () => {
    expect(LeadStageChangeSchema.safeParse({ version: 1, stage: "LOST" }).success).toBe(false);
    expect(LeadStageChangeSchema.safeParse({ version: 1, stage: "LOST", lost_reason: "  " }).success).toBe(false);
    expect(LeadStageChangeSchema.safeParse({ version: 1, stage: "LOST", lost_reason: "Budget mismatch" }).success).toBe(true);
  });
  it("does not require a reason for other stages and forbids CONVERTED", () => {
    expect(LeadStageChangeSchema.safeParse({ version: 1, stage: "NEGOTIATION" }).success).toBe(true);
    expect(LeadStageChangeSchema.safeParse({ version: 1, stage: "CONVERTED" }).success).toBe(false);
  });
});

describe("public forms honeypot", () => {
  const enquiry = { name: "Asha Verma", phone: "+91 98765 43210", project_slug: "ganesh-heights", consent: true as const };
  it("accepts an empty or absent honeypot and normalises the phone", () => {
    const r = PublicEnquiryInputSchema.safeParse({ ...enquiry, website: "" });
    expect(r.success).toBe(true);
    expect(r.data?.phone).toBe("9876543210");
    expect(PublicEnquiryInputSchema.safeParse(enquiry).success).toBe(true);
  });
  it("rejects a filled honeypot", () => {
    expect(PublicEnquiryInputSchema.safeParse({ ...enquiry, website: "http://spam.example" }).success).toBe(false);
    expect(PublicBrochureRequestSchema.safeParse({ ...enquiry, website: "x" }).success).toBe(false);
    expect(
      PublicVisitBookingInputSchema.safeParse({ ...enquiry, visit_date: "2026-05-01", slot_start: "10:00", website: "bot" }).success,
    ).toBe(false);
  });
  it("requires consent and rejects unknown keys", () => {
    expect(PublicEnquiryInputSchema.safeParse({ ...enquiry, consent: false }).success).toBe(false);
    expect(PublicEnquiryInputSchema.safeParse({ ...enquiry, internal_id: "x" }).success).toBe(false);
  });
  it("limits visitors to 1..6", () => {
    const v = { ...enquiry, visit_date: "2026-05-01", slot_start: "10:00" };
    expect(PublicVisitBookingInputSchema.safeParse({ ...v, visitors: 6 }).success).toBe(true);
    expect(PublicVisitBookingInputSchema.safeParse({ ...v, visitors: 7 }).success).toBe(false);
    expect(PublicVisitBookingInputSchema.safeParse({ ...v, slot_start: "10:5" }).success).toBe(false);
  });
});

describe("toPublicAvailability", () => {
  it("collapses everything but AVAILABLE to NOT_AVAILABLE", () => {
    expect(toPublicAvailability("AVAILABLE")).toBe("AVAILABLE");
    for (const s of ["HOLD", "BLOCKED", "BOOKED", "SOLD"] as const) expect(toPublicAvailability(s)).toBe("NOT_AVAILABLE");
  });
});
