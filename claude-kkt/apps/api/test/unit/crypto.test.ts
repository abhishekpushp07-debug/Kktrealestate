import { describe, expect, it } from "vitest";
import {
  decryptField,
  encryptField,
  keyedHash,
  randomToken,
  signPayload,
  temporaryPassword,
  verifyPayload,
} from "../../src/lib/crypto.js";
import { signAccessToken, verifyAccessToken } from "../../src/lib/jwt.js";
import { hashPassword, matchesHistory, passwordPolicyProblems, verifyPassword } from "../../src/lib/password.js";

describe("field encryption", () => {
  it("round-trips and randomises IV", () => {
    const a = encryptField("ABCDE1234F")!,
      b = encryptField("ABCDE1234F")!;
    expect(a).not.toEqual(b);
    expect(decryptField(a)).toBe("ABCDE1234F");
    expect(encryptField("")).toBeNull();
    expect(decryptField(null)).toBeNull();
  });
  it("detects tampering", () => {
    const t = encryptField("123412341234")!;
    const parts = t.split(".");
    parts[3] = parts[3]!.slice(0, -2) + "AA";
    expect(() => decryptField(parts.join("."))).toThrow();
  });
  it("keyed hash is deterministic and 64 hex", () => {
    expect(keyedHash("ABCDE1234F")).toBe(keyedHash("ABCDE1234F"));
    expect(keyedHash("ABCDE1234F")).toMatch(/^[0-9a-f]{64}$/);
    expect(keyedHash("ABCDE1234F")).not.toBe(keyedHash("ABCDE1234G"));
  });
});

describe("signed payloads", () => {
  it("verifies and rejects forgery/expiry", async () => {
    const t = signPayload({ doc: "abc" }, 60);
    expect(verifyPayload<{ doc: string }>(t)?.doc).toBe("abc");
    expect(verifyPayload(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBeNull();
    const expired = signPayload({ doc: "abc" }, -1);
    expect(verifyPayload(expired)).toBeNull();
  });
  it("random tokens and temp passwords are strong", () => {
    expect(randomToken()).toHaveLength(43);
    const p = temporaryPassword();
    expect(p).toHaveLength(12);
    expect(passwordPolicyProblems(p)).toEqual([]);
  });
});

describe("jwt", () => {
  it("signs for an audience and rejects the other audience", async () => {
    const t = await signAccessToken({ sub: "u1", aud: "erp", cid: "c1", sid: "s1" });
    const ok = await verifyAccessToken(t, "erp");
    expect(ok.ok && ok.claims.sub).toBe("u1");
    const bad = await verifyAccessToken(t, "portal");
    expect(bad.ok === false && bad.reason).toBe("WRONG_AUDIENCE");
    const garbage = await verifyAccessToken(t + "x", "erp");
    expect(garbage.ok).toBe(false);
  });
  it("expires", async () => {
    const t = await signAccessToken({ sub: "u1", aud: "erp", cid: "c1", sid: "s1" }, -5);
    const r = await verifyAccessToken(t, "erp");
    expect(r.ok === false && r.reason).toBe("EXPIRED");
  });
});

describe("passwords", () => {
  it("hashes, verifies, policies and history", async () => {
    const h = await hashPassword("Strong#Pass1");
    expect(await verifyPassword(h, "Strong#Pass1")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
    expect(passwordPolicyProblems("short")).toContain("at least 10 characters");
    expect(passwordPolicyProblems("alllowercase1")).toContain("an upper-case letter");
    expect(await matchesHistory("Strong#Pass1", [h])).toBe(true);
    expect(await matchesHistory("Other#Pass2", [h])).toBe(false);
  });
});
