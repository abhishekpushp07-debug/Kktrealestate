import { describe, expect, it } from "vitest";
import type { PortalBulkCredential } from "@kkt/contracts";
import { isSuperAdminUser } from "@/lib/auth";
import { bulkEnableSummary, credentialsCsv } from "../BulkPortalEnableDialog";
import { kycLocksIdentifiers, kycResetByEdit } from "../CustomerFormSheet";
import { canSubmitErase } from "../customer/EraseCustomerDialog";
import { kycActions } from "../customer/KycPanel";

describe("KYC maker-checker actions", () => {
  const base = { canWrite: true, canVerify: true, canReopen: false, isSubmitter: false };
  it("offers submit from PENDING / REJECTED", () => {
    expect(kycActions({ ...base, status: "PENDING" })).toEqual(["SUBMITTED"]);
    expect(kycActions({ ...base, status: "REJECTED" })).toEqual(["SUBMITTED"]);
  });
  it("offers verify / reject only to a checker who is not the submitter", () => {
    expect(kycActions({ ...base, status: "SUBMITTED" })).toEqual(["VERIFIED", "REJECTED"]);
    expect(kycActions({ ...base, status: "SUBMITTED", isSubmitter: true })).toEqual([]);
    expect(kycActions({ ...base, status: "SUBMITTED", canVerify: false })).toEqual([]);
  });
  it("lets only settings.manage change a VERIFIED file", () => {
    expect(kycActions({ ...base, status: "VERIFIED" })).toEqual([]);
    expect(kycActions({ ...base, status: "VERIFIED", canReopen: true })).toEqual(["SUBMITTED", "REJECTED"]);
    expect(kycActions({ ...base, status: "PENDING", canWrite: false })).toEqual([]);
  });
  it("warns when a PAN / Aadhaar edit resets the file", () => {
    expect(kycLocksIdentifiers("VERIFIED")).toBe(true);
    expect(kycLocksIdentifiers("PENDING")).toBe(false);
    expect(kycResetByEdit("SUBMITTED", "PENDING")).toBe(true);
    expect(kycResetByEdit("VERIFIED", "VERIFIED")).toBe(false);
  });
});

describe("erasure", () => {
  it("needs the exact word ERASE and a reason", () => {
    expect(canSubmitErase("ERASE", "Written request #12")).toBe(true);
    expect(canSubmitErase("erase", "Written request #12")).toBe(false);
    expect(canSubmitErase(" ERASE ", "ab")).toBe(false);
  });
  it("is a Super Admin (system role) action", () => {
    expect(isSuperAdminUser({ role: { id: "r", name: "Super Admin", is_system: true } })).toBe(true);
    expect(isSuperAdminUser({ role: { id: "r", name: "Super Admin", is_system: false } })).toBe(false);
    expect(isSuperAdminUser({ role: { id: "r", name: "Project Admin", is_system: true } })).toBe(false);
    expect(isSuperAdminUser(null)).toBe(false);
  });
});

describe("bulk portal enable", () => {
  const rows: PortalBulkCredential[] = [
    {
      customer_id: "c1",
      customer_code: "CUS-0001",
      full_name: "=cmd()",
      phone: "9876543210",
      temporary_password: "Kkt-4821-abcd",
      temp_password: "Kkt-4821-abcd",
    },
  ];
  it("builds the one-time credentials CSV with formula neutralisation", () => {
    expect(credentialsCsv(rows)).toBe(
      "\uFEFFcustomer_code,full_name,phone,temporary_password\r\nCUS-0001,'=cmd(),9876543210,Kkt-4821-abcd\r\n",
    );
  });
  it("summarises the result, including customers that failed", () => {
    expect(bulkEnableSummary({ enabled: 3, already_enabled: 2 })).toBe(
      "Portal enabled for 3 customers · 2 already had access",
    );
    expect(bulkEnableSummary({ enabled: 1, already_enabled: 0, failed: 4 })).toBe(
      "Portal enabled for 1 customer · 4 not enabled",
    );
  });
});
