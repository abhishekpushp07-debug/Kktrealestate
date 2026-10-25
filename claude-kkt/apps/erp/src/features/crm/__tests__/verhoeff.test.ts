import { describe, expect, it } from "vitest";
import { formatAadhaar, isValidAadhaar, isValidVerhoeff, normaliseIndianPhone, verhoeffCheckDigit } from "../verhoeff";

describe("verhoeff", () => {
  it("computes the published check digit (236 → 3)", () => {
    expect(verhoeffCheckDigit("236")).toBe(3);
    expect(isValidVerhoeff("2363")).toBe(true);
    expect(isValidVerhoeff("2364")).toBe(false);
  });

  it("round-trips arbitrary payloads", () => {
    for (const payload of ["1", "12345", "99994105705", "20000000000", "555555555555"]) {
      const check = verhoeffCheckDigit(payload);
      expect(isValidVerhoeff(`${payload}${check}`)).toBe(true);
      // Any other final digit fails.
      expect(isValidVerhoeff(`${payload}${(check + 1) % 10}`)).toBe(false);
    }
  });

  it("catches single-digit errors and adjacent transpositions", () => {
    const valid = `${"49871234567"}${verhoeffCheckDigit("49871234567")}`;
    expect(isValidVerhoeff(valid)).toBe(true);
    const transposed = `${valid.slice(0, 3)}${valid[4]}${valid[3]}${valid.slice(5)}`;
    expect(isValidVerhoeff(transposed)).toBe(false);
    const altered = `${valid.slice(0, 6)}${(Number(valid[6]) + 1) % 10}${valid.slice(7)}`;
    expect(isValidVerhoeff(altered)).toBe(false);
  });

  it("rejects non-digit input", () => {
    expect(isValidVerhoeff("12a4")).toBe(false);
    expect(isValidVerhoeff("")).toBe(false);
  });
});

describe("isValidAadhaar", () => {
  it("accepts the UIDAI sample number with or without spaces", () => {
    expect(isValidAadhaar("999941057058")).toBe(true);
    expect(isValidAadhaar("9999 4105 7058")).toBe(true);
  });

  it("rejects wrong length, leading 0/1 and bad checksums", () => {
    expect(isValidAadhaar("99994105705")).toBe(false);
    expect(isValidAadhaar("199941057058")).toBe(false);
    expect(isValidAadhaar("999941057057")).toBe(false);
    expect(isValidAadhaar(null)).toBe(false);
  });
});

describe("formatting helpers", () => {
  it("groups Aadhaar in fours", () => {
    expect(formatAadhaar("999941057058")).toBe("9999 4105 7058");
    expect(formatAadhaar("99994")).toBe("9999 4");
  });

  it("normalises Indian phones", () => {
    expect(normaliseIndianPhone("+91 98765 43210")).toBe("9876543210");
    expect(normaliseIndianPhone("09876543210")).toBe("9876543210");
    expect(normaliseIndianPhone("98765-43210")).toBe("9876543210");
  });
});
