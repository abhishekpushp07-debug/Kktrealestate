import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { activeFieldKeyId, decryptField, encryptField, fieldKeyIdOf, reencryptField, signPayload, verifyPayload } from "../../src/lib/crypto.js";
import { publicJwks, signAccessToken, signingKeys, verifyAccessToken } from "../../src/lib/jwt.js";

const original = { ring: config.FIELD_KEY_RING, jwt: config.JWT_SECRET, prev: config.JWT_PREVIOUS_SECRETS };
afterEach(() => {
  config.FIELD_KEY_RING = original.ring;
  config.JWT_SECRET = original.jwt;
  config.JWT_PREVIOUS_SECRETS = original.prev;
});

const K1 = { kid: "k1", secret: config.FIELD_ENCRYPTION_KEY };
const K2 = { kid: "k2", secret: "second-field-key-for-rotation-tests-0123456789" };

describe("field encryption key ring", () => {
  it("writes the active kid, reads any configured kid and re-encrypts to the active one", () => {
    config.FIELD_KEY_RING = [K1];
    const old = encryptField("ABCDE1234F")!;
    expect(fieldKeyIdOf(old)).toBe("k1");
    // rotation: k2 becomes active, k1 stays readable
    config.FIELD_KEY_RING = [K2, K1];
    expect(activeFieldKeyId()).toBe("k2");
    expect(decryptField(old)).toBe("ABCDE1234F");
    const fresh = encryptField("ABCDE1234F")!;
    expect(fieldKeyIdOf(fresh)).toBe("k2");
    const moved = reencryptField(old)!;
    expect(fieldKeyIdOf(moved)).toBe("k2");
    expect(decryptField(moved)).toBe("ABCDE1234F");
    expect(reencryptField(moved)).toBe(moved); // already current: untouched
    expect(reencryptField(null)).toBeNull();
    // the old key retired: values still under it can no longer be read (the job must have run first)
    config.FIELD_KEY_RING = [K2];
    expect(() => decryptField(old)).toThrow(/k1 is not configured/);
    expect(decryptField(moved)).toBe("ABCDE1234F");
  });
});

describe("JWT signing key rotation", () => {
  const OLD = "old-jwt-secret-old-jwt-secret-old-jwt-secret-01";
  const NEW = "new-jwt-secret-new-jwt-secret-new-jwt-secret-02";
  const claims = { sub: "00000000-0000-4000-8000-000000000001", aud: "erp" as const, cid: "00000000-0000-4000-8000-000000000002", sid: "00000000-0000-4000-8000-000000000003" };

  it("signs with the current secret (kid in the header) and accepts tokens of JWT_PREVIOUS_SECRETS", async () => {
    config.JWT_SECRET = OLD;
    config.JWT_PREVIOUS_SECRETS = [];
    const before = await signAccessToken(claims);
    const oldKid = signingKeys()[0]!.kid;
    expect(JSON.parse(Buffer.from(before.split(".")[0]!, "base64url").toString()).kid).toBe(oldKid);
    // rotate: NEW signs, OLD only verifies
    config.JWT_SECRET = NEW;
    config.JWT_PREVIOUS_SECRETS = [OLD];
    const after = await signAccessToken(claims);
    const newKid = signingKeys()[0]!.kid;
    expect(newKid).not.toBe(oldKid);
    expect(JSON.parse(Buffer.from(after.split(".")[0]!, "base64url").toString()).kid).toBe(newKid);
    expect((await verifyAccessToken(before, "erp")).ok).toBe(true);
    expect((await verifyAccessToken(after, "erp")).ok).toBe(true);
    const jwks = await publicJwks();
    expect(jwks.keys.map((k) => k["kid"])).toEqual([newKid, oldKid]);
    expect(jwks.keys.every((k) => k["alg"] === "EdDSA" && k["kty"] === "OKP" && !("d" in k))).toBe(true);
    // the rotation window closes: the old token is refused
    config.JWT_PREVIOUS_SECRETS = [];
    expect(await verifyAccessToken(before, "erp")).toEqual({ ok: false, reason: "INVALID" });
    expect((await verifyAccessToken(after, "erp")).ok).toBe(true);
  });

  it("verifies legacy tokens whose kid is not a fingerprint (k1) by trying every key", async () => {
    const { SignJWT } = await import("jose");
    config.JWT_SECRET = NEW;
    config.JWT_PREVIOUS_SECRETS = [OLD];
    const legacyKey = signingKeys()[1]!.privateKey;
    const legacy = await new SignJWT({ ...claims, typ: "access" }).setProtectedHeader({ alg: "EdDSA", kid: "k1" }).setIssuer("kkt").setAudience("erp").setSubject(claims.sub).setIssuedAt().setExpirationTime("15m").sign(legacyKey);
    expect((await verifyAccessToken(legacy, "erp")).ok).toBe(true);
    expect((await verifyAccessToken(legacy, "portal"))).toEqual({ ok: false, reason: "WRONG_AUDIENCE" });
  });

  it("signed payloads (download, MFA, manage links) survive a rotation", () => {
    config.JWT_SECRET = OLD;
    config.JWT_PREVIOUS_SECRETS = [];
    const link = signPayload({ doc: "abc" }, 60);
    config.JWT_SECRET = NEW;
    config.JWT_PREVIOUS_SECRETS = [OLD];
    expect(verifyPayload<{ doc: string }>(link)?.doc).toBe("abc");
    config.JWT_PREVIOUS_SECRETS = [];
    expect(verifyPayload(link)).toBeNull();
  });
});
