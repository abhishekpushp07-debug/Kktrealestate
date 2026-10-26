import { describe, expect, it } from "vitest";
import { isSensitiveKey, stripSensitive } from "../../src/lib/audit.js";

describe("audit snapshot stripping", () => {
  it("recognises sensitive keys in snake and camel case", () => {
    for (const k of [
      "password_hash",
      "passwordHash",
      "pan_enc",
      "aadhaarEnc",
      "mfa_secret_enc",
      "mfaPendingSecretEnc",
      "token_hash",
      "refresh_token",
      "access_token",
      "password",
    ])
      expect(isSensitiveKey(k), k).toBe(true);
    for (const k of ["name", "email", "pan_last4", "is_active", "version", "account_number_masked"])
      expect(isSensitiveKey(k), k).toBe(false);
  });
  it("strips nested sensitive keys and renders dates as ISO strings", () => {
    const out = stripSensitive({
      name: "A",
      password_hash: "x",
      nested: { mfa_secret_enc: "y", keep: 1, when: new Date("2025-01-01T00:00:00Z") },
      list: [{ token: "t", ok: true }],
    });
    expect(out).toEqual({ name: "A", nested: { keep: 1, when: "2025-01-01T00:00:00.000Z" }, list: [{ ok: true }] });
  });
});
