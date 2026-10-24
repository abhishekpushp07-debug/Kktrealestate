import { describe, expect, it } from "vitest";
import {
  AadhaarSchema,
  DateStringSchema,
  EmailSchema,
  IFSCSchema,
  ListQuerySchema,
  PANSchema,
  PaiseSchema,
  PercentSchema,
  PhoneSchema,
  SignedPaiseSchema,
  TimeStringSchema,
  listEnvelope,
  normalisePhone,
  parseSort,
  updateOf,
} from "../src/index.js";
import { z } from "zod";

describe("PhoneSchema", () => {
  it("normalises +91, 91, 0 prefixes and spaces", () => {
    expect(PhoneSchema.parse("+91 98765 43210")).toBe("9876543210");
    expect(PhoneSchema.parse("919876543210")).toBe("9876543210");
    expect(PhoneSchema.parse("09876543210")).toBe("9876543210");
    expect(PhoneSchema.parse("98765-43210")).toBe("9876543210");
    expect(PhoneSchema.parse("+91-98765 43210")).toBe("9876543210");
    expect(normalisePhone(42)).toBe(42);
  });
  it("rejects numbers that are not 10 digits starting 6-9", () => {
    expect(PhoneSchema.safeParse("1234567890").success).toBe(false);
    expect(PhoneSchema.safeParse("987654321").success).toBe(false);
    expect(PhoneSchema.safeParse("98765432100").success).toBe(false);
    expect(PhoneSchema.safeParse("").success).toBe(false);
  });
});

describe("DateStringSchema", () => {
  it("accepts real YYYY-MM-DD dates only", () => {
    expect(DateStringSchema.safeParse("2026-02-28").success).toBe(true);
    expect(DateStringSchema.safeParse("2024-02-29").success).toBe(true);
    expect(DateStringSchema.safeParse("2026-02-30").success).toBe(false);
    expect(DateStringSchema.safeParse("2026-13-01").success).toBe(false);
    expect(DateStringSchema.safeParse("01-01-2026").success).toBe(false);
    expect(DateStringSchema.safeParse("2026-1-1").success).toBe(false);
    expect(DateStringSchema.safeParse("2026-01-01T00:00:00Z").success).toBe(false);
  });
});

describe("money and percent scalars", () => {
  it("PaiseSchema is a safe non-negative integer", () => {
    expect(PaiseSchema.safeParse(0).success).toBe(true);
    expect(PaiseSchema.safeParse(10_000_000_00).success).toBe(true);
    expect(PaiseSchema.safeParse(-1).success).toBe(false);
    expect(PaiseSchema.safeParse(1.5).success).toBe(false);
    expect(PaiseSchema.safeParse(Number.MAX_SAFE_INTEGER + 2).success).toBe(false);
    expect(SignedPaiseSchema.safeParse(-600000000).success).toBe(true);
  });
  it("PercentSchema allows at most two decimals in 0..100", () => {
    expect(PercentSchema.safeParse(12.34).success).toBe(true);
    expect(PercentSchema.safeParse(100).success).toBe(true);
    expect(PercentSchema.safeParse(12.345).success).toBe(false);
    expect(PercentSchema.safeParse(100.01).success).toBe(false);
    expect(PercentSchema.safeParse(-0.5).success).toBe(false);
  });
});

describe("KYC scalars", () => {
  it("PAN upper-cases and validates", () => {
    expect(PANSchema.parse(" abcde1234f ")).toBe("ABCDE1234F");
    expect(PANSchema.safeParse("ABCD1234F").success).toBe(false);
  });
  it("Aadhaar strips spaces and needs 12 digits", () => {
    expect(AadhaarSchema.parse("2345 6789 0123")).toBe("234567890123");
    expect(AadhaarSchema.safeParse("123456789012").success).toBe(false);
    expect(AadhaarSchema.safeParse("23456789012").success).toBe(false);
  });
  it("IFSC validates", () => {
    expect(IFSCSchema.parse("sbin0001234")).toBe("SBIN0001234");
    expect(IFSCSchema.safeParse("SBIN1001234").success).toBe(false);
  });
  it("Email lower-cases", () => {
    expect(EmailSchema.parse(" Admin@Example.com ")).toBe("admin@example.com");
    expect(EmailSchema.safeParse("nope").success).toBe(false);
  });
  it("TimeStringSchema is HH:MM", () => {
    expect(TimeStringSchema.safeParse("09:30").success).toBe(true);
    expect(TimeStringSchema.safeParse("24:00").success).toBe(false);
  });
});

describe("ListQuerySchema", () => {
  it("applies defaults and coerces query strings", () => {
    const q = ListQuerySchema.parse({});
    expect(q).toMatchObject({ page: 1, page_size: 25, include_inactive: false });
    const q2 = ListQuerySchema.parse({ page: "3", page_size: "50", include_inactive: "true", sort: "-created_at", format: "csv" });
    expect(q2).toMatchObject({ page: 3, page_size: 50, include_inactive: true, sort: "-created_at", format: "csv" });
  });
  it("caps page_size at 200 and search at 100 chars", () => {
    expect(ListQuerySchema.safeParse({ page_size: 201 }).success).toBe(false);
    expect(ListQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(ListQuerySchema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
    expect(ListQuerySchema.safeParse({ format: "xlsx" }).success).toBe(false);
  });
  it("parseSort splits direction", () => {
    expect(parseSort("-name")).toEqual({ field: "name", direction: "desc" });
    expect(parseSort("name")).toEqual({ field: "name", direction: "asc" });
  });
  it("listEnvelope wraps items", () => {
    const env = listEnvelope(z.object({ id: z.string() }));
    expect(env.safeParse({ items: [{ id: "a" }], total: 1, page: 1, page_size: 25, next_cursor: null }).success).toBe(true);
    expect(env.safeParse({ items: [], total: 0, page: 0, page_size: 25, next_cursor: null }).success).toBe(false);
  });
});

describe("updateOf", () => {
  it("makes fields optional and requires version", () => {
    const U = updateOf(z.strictObject({ name: z.string(), n: z.number() }));
    expect(U.safeParse({ version: 1 }).success).toBe(true);
    expect(U.safeParse({ name: "x" }).success).toBe(false);
    expect(U.safeParse({ version: 1, extra: true }).success).toBe(false);
  });
});
