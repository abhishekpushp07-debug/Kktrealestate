import { describe, expect, it } from "vitest";
import {
  isValidAadhaar,
  isValidEmail,
  isValidIFSC,
  isValidPAN,
  maskAadhaar,
  maskAccount,
  maskPAN,
  normalizeEmail,
  normalizeIndianPhone,
  normalizeLabel,
  normalizePAN,
  slugify,
  verhoeffCheckDigit,
  verhoeffValidate,
} from "../src/index.js";

describe("normalizeIndianPhone", () => {
  it("strips prefixes and separators", () => {
    expect(normalizeIndianPhone("9876543210")).toBe("9876543210");
    expect(normalizeIndianPhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizeIndianPhone("91-9876543210")).toBe("9876543210");
    expect(normalizeIndianPhone("09876543210")).toBe("9876543210");
    expect(normalizeIndianPhone("(987) 654-3210")).toBe("9876543210");
    expect(normalizeIndianPhone("+91-0987654321")).toBe(null);
  });
  it("rejects invalid numbers", () => {
    expect(normalizeIndianPhone("1234567890")).toBe(null);
    expect(normalizeIndianPhone("98765")).toBe(null);
    expect(normalizeIndianPhone("98765432101")).toBe(null);
    expect(normalizeIndianPhone("abc")).toBe(null);
    expect(normalizeIndianPhone("")).toBe(null);
  });
});

describe("PAN", () => {
  it("validates, normalises and masks", () => {
    expect(isValidPAN("ABCDE1234F")).toBe(true);
    expect(isValidPAN(" abcde1234f ")).toBe(true);
    expect(isValidPAN("ABCD1234F")).toBe(false);
    expect(isValidPAN("ABCDE12345")).toBe(false);
    expect(isValidPAN("1BCDE1234F")).toBe(false);
    expect(normalizePAN("abcde 1234f")).toBe("ABCDE1234F");
    expect(maskPAN("ABCDE1234F")).toBe("XXXXX1234F");
    expect(maskPAN("abcde1234f")).toBe("XXXXX1234F");
  });
});

describe("Verhoeff / Aadhaar", () => {
  it("validates known vectors", () => {
    expect(verhoeffValidate("234123412346")).toBe(true);
    expect(verhoeffValidate("2363")).toBe(true);
    expect(verhoeffCheckDigit("236")).toBe(3);
    expect(verhoeffCheckDigit("23412341234")).toBe(6);
    expect(verhoeffValidate("234123412345")).toBe(false);
    expect(verhoeffValidate("12a")).toBe(false);
  });
  it("check digit always validates for random numbers and single-digit errors are caught", () => {
    let seed = 12345;
    for (let i = 0; i < 200; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const body = String(seed).padStart(11, "0").slice(0, 11);
      const full = body + String(verhoeffCheckDigit(body));
      expect(verhoeffValidate(full)).toBe(true);
      const pos = i % 12;
      const digit = Number(full[pos]);
      const altered = full.slice(0, pos) + String((digit + 1) % 10) + full.slice(pos + 1);
      expect(verhoeffValidate(altered)).toBe(false);
    }
  });
  it("isValidAadhaar applies shape rules too", () => {
    expect(isValidAadhaar("2341 2341 2346")).toBe(true);
    expect(isValidAadhaar("234123412346")).toBe(true);
    expect(isValidAadhaar("134123412346")).toBe(false);
    expect(isValidAadhaar("23412341234")).toBe(false);
    expect(isValidAadhaar("234123412345")).toBe(false);
    expect(maskAadhaar("234123412346")).toBe("XXXX XXXX 2346");
    expect(maskAadhaar("2341 2341 2346")).toBe("XXXX XXXX 2346");
  });
});

describe("IFSC, account, email, slug", () => {
  it("validates IFSC", () => {
    expect(isValidIFSC("SBIN0001234")).toBe(true);
    expect(isValidIFSC("hdfc0ABCD12")).toBe(true);
    expect(isValidIFSC("SBIN1001234")).toBe(false);
    expect(isValidIFSC("SBI00001234")).toBe(false);
  });
  it("masks accounts", () => {
    expect(maskAccount("123456789012")).toBe("XXXXXXXX9012");
    expect(maskAccount("1234")).toBe("XXXX");
    expect(maskAccount("12 3456 7890")).toBe("XXXXXX7890");
  });
  it("normalises e-mail and labels", () => {
    expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
    expect(isValidEmail("foo@example.com")).toBe(true);
    expect(isValidEmail("foo@example")).toBe(false);
    expect(normalizeLabel("  On   Booking ")).toBe("on booking");
  });
  it("slugifies", () => {
    expect(slugify("Shree Ganesh Heights – Phase 2!")).toBe("shree-ganesh-heights-phase-2");
    expect(slugify("Café & Résidence")).toBe("cafe-and-residence");
    expect(slugify("  --Hello--  ")).toBe("hello");
  });
});
