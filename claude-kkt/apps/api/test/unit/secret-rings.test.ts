import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { config, type FieldKey, type JwtKeyConfig } from "../../src/config.js";
import {
  activeHashKeyId,
  keyedHash,
  keyedHashes,
  keyedHashMatches,
  signLinkBody,
  signPayload,
  verifyLinkBody,
  verifyPayload,
} from "../../src/lib/crypto.js";
import { publicJwks, signAccessToken, verifyAccessToken } from "../../src/lib/jwt.js";

/**
 * Secret rings of contract C9: Ed25519 JWT keys with kids (JWKS publishes all, verification by kid), link-signing keys with the kid in
 * the link, and the keyed-hash ring (lookups under every key, writes under the active one).
 */
const original = {
  jwt: config.JWT_SIGNING_KEYS,
  link: config.LINK_SIGNING_KEYS,
  hash: config.HASH_KEY_RING,
};
afterEach(() => {
  (config as { JWT_SIGNING_KEYS: JwtKeyConfig[] }).JWT_SIGNING_KEYS = original.jwt;
  (config as { LINK_SIGNING_KEYS: FieldKey[] }).LINK_SIGNING_KEYS = original.link;
  (config as { HASH_KEY_RING: FieldKey[] }).HASH_KEY_RING = original.hash;
});

const edKey = (kid: string): JwtKeyConfig => ({
  kid,
  der: generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }),
});
const setJwt = (keys: JwtKeyConfig[]) => ((config as { JWT_SIGNING_KEYS: JwtKeyConfig[] }).JWT_SIGNING_KEYS = keys);
const setLink = (keys: FieldKey[]) => ((config as { LINK_SIGNING_KEYS: FieldKey[] }).LINK_SIGNING_KEYS = keys);
const setHash = (keys: FieldKey[]) => ((config as { HASH_KEY_RING: FieldKey[] }).HASH_KEY_RING = keys);
const kidOf = (token: string) =>
  (JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()) as { kid: string }).kid;

const claims = {
  sub: "00000000-0000-4000-8000-000000000001",
  aud: "erp" as const,
  cid: "00000000-0000-4000-8000-000000000002",
  sid: "00000000-0000-4000-8000-000000000003",
};

describe("JWT_SIGNING_KEYS (Ed25519 key pairs with kids)", () => {
  it("signs with the first key, verifies by kid, publishes every key; an old token stays valid until its key leaves the ring", async () => {
    const a = edKey("2026-10");
    const b = edKey("2027-01");
    setJwt([a]);
    const old = await signAccessToken(claims);
    expect(kidOf(old)).toBe("2026-10");
    setJwt([b, a]);
    const fresh = await signAccessToken(claims);
    expect(kidOf(fresh)).toBe("2027-01");
    expect((await verifyAccessToken(old, "erp")).ok).toBe(true);
    expect((await verifyAccessToken(fresh, "erp")).ok).toBe(true);
    const jwks = await publicJwks();
    expect(jwks.keys.map((k) => k["kid"])).toEqual(["2027-01", "2026-10"]);
    expect(jwks.keys.every((k) => k["kty"] === "OKP" && k["crv"] === "Ed25519" && !("d" in k))).toBe(true);
    setJwt([b]);
    expect(await verifyAccessToken(old, "erp")).toEqual({ ok: false, reason: "INVALID" });
    expect((await verifyAccessToken(fresh, "erp")).ok).toBe(true);
  });

  it("an explicit ring verifies by kid only: a token naming an unknown kid, or none, is invalid even when signed by a ring key", async () => {
    const a = edKey("only");
    setJwt([a]);
    const { SignJWT } = await import("jose");
    const { createPrivateKey } = await import("node:crypto");
    const priv = createPrivateKey({ key: a.der, format: "der", type: "pkcs8" });
    for (const header of [{ alg: "EdDSA", kid: "other" }, { alg: "EdDSA" }]) {
      const token = await new SignJWT({ ...claims, typ: "access" })
        .setProtectedHeader(header)
        .setIssuer("kkt")
        .setAudience("erp")
        .setSubject(claims.sub)
        .setIssuedAt()
        .setExpirationTime("15m")
        .sign(priv);
      expect(await verifyAccessToken(token, "erp")).toEqual({ ok: false, reason: "INVALID" });
    }
  });
});

describe("LINK_SIGNING_KEYS (kid in the link)", () => {
  const L1 = { kid: "l1", secret: "first-link-signing-secret-0123456789abcdef" };
  const L2 = { kid: "l2", secret: "second-link-signing-secret-0123456789abcd" };

  it("new links carry the active kid; links of an older ring key verify until it is removed", () => {
    setLink([L1]);
    const kidIn = (token: string) =>
      (JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()) as { _k: string })._k;
    const oldLink = signPayload({ doc: "abc" }, 60);
    expect(oldLink).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // the `<payload>.<sig>` shape clients have always seen
    expect(kidIn(oldLink)).toBe("l1");
    setLink([L2, L1]);
    const newLink = signPayload({ doc: "abc" }, 60);
    expect(kidIn(newLink)).toBe("l2");
    expect(verifyPayload<{ doc: string }>(oldLink)?.doc).toBe("abc");
    expect(verifyPayload<{ doc: string }>(newLink)).toEqual({ doc: "abc", exp: expect.any(Number) });
    // the kid inside the payload is signed: naming another key fails
    const [body, sig] = newLink.split(".") as [string, string];
    const swapped = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), _k: "l1" }),
    ).toString("base64url");
    expect(verifyPayload(`${swapped}.${sig}`)).toBeNull();
    setLink([L2]);
    expect(verifyPayload(oldLink)).toBeNull();
    expect(verifyPayload<{ doc: string }>(newLink)?.doc).toBe("abc");
  });

  it("compact binary links: kid-scoped families, tampering and kid swapping are refused", () => {
    setLink([L2, L1]);
    const body = Buffer.from("0123456789abcdef0123456789", "utf8");
    const token = signLinkBody("kkt-files-v1", body);
    expect(token.split(".")[0]).toBe("l2");
    expect(verifyLinkBody("kkt-files-v1", token)?.equals(body)).toBe(true);
    // another family (label) never accepts it
    expect(verifyLinkBody("kkt-export-link-v1", token)).toBeNull();
    // a swapped kid does not verify with the other key
    expect(verifyLinkBody("kkt-files-v1", `l1.${token.split(".").slice(1).join(".")}`)).toBeNull();
    const [kid, b, sig] = token.split(".") as [string, string, string];
    const flipped = `${kid}.${b.slice(0, -1)}${b.endsWith("A") ? "B" : "A"}.${sig}`;
    expect(verifyLinkBody("kkt-files-v1", flipped)).toBeNull();
    expect(verifyLinkBody("kkt-files-v1", "garbage")).toBeNull();
  });

  it("legacy kid-less payload tokens (signed before the ring) still verify under the derived non-production ring", async () => {
    setLink([]);
    const { createHash, createHmac } = await import("node:crypto");
    const key = createHash("sha256").update("kkt-sign-v1").update(":").update(config.JWT_SECRET).digest();
    const body = Buffer.from(JSON.stringify({ doc: "legacy", exp: Math.floor(Date.now() / 1000) + 60 })).toString(
      "base64url",
    );
    const legacy = `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
    expect(verifyPayload<{ doc: string }>(legacy)?.doc).toBe("legacy");
  });
});

describe("HASH_KEYS (keyed-hash ring)", () => {
  const H1 = { kid: "h1", secret: "first-hash-key-secret-0123456789abcdefgh" };
  const H2 = { kid: "h2", secret: "second-hash-key-secret-0123456789abcdefg" };

  it("writes with the active key and finds values hashed under any configured key", () => {
    setHash([H1]);
    const old = keyedHash("ABCDE1234F");
    setHash([H2, H1]);
    expect(activeHashKeyId()).toBe("h2");
    const fresh = keyedHash("ABCDE1234F");
    expect(fresh).not.toBe(old);
    expect(keyedHashes("ABCDE1234F")).toEqual([fresh, old]);
    expect(keyedHashMatches("ABCDE1234F", old)).toBe(true);
    expect(keyedHashMatches("ABCDE1234F", old.slice(0, 32), 32)).toBe(true);
    expect(keyedHashMatches("ZZZZZ9999Z", old)).toBe(false);
    setHash([H2]);
    expect(keyedHashes("ABCDE1234F")).toEqual([fresh]);
  });
});
