import { describe, expect, it, vi } from "vitest";
import { logRevalidationFailure, REVALIDATE_WARN_EVERY_MS } from "../../src/modules/web/shared.js";
import { isProbeUrl } from "../../src/plugins/auth.js";

/** Phase 7 integration (docs/hardening/phase7-integrate.md): pure helpers behind the cross-track fixes. */

describe("website revalidation failures are throttled at warn (domain review open item 4)", () => {
  it("warns once per window with the number suppressed since, debug in between", () => {
    const log = { warn: vi.fn(), debug: vi.fn() };
    const t0 = 1_000_000_000;
    expect(logRevalidationFailure(log, { status: 503 }, "failed", t0)).toBe(true);
    for (let i = 1; i <= 5; i++)
      expect(logRevalidationFailure(log, { status: 503 }, "failed", t0 + i * 250)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledTimes(5);
    expect(logRevalidationFailure(log, { status: 503 }, "failed", t0 + REVALIDATE_WARN_EVERY_MS)).toBe(true);
    expect(log.warn).toHaveBeenLastCalledWith({ status: 503, suppressed_since_last: 5 }, "failed");
  });
});

describe("health probes are recognised (never rate-limited)", () => {
  it("matches the liveness / readiness / full health routes and nothing else", () => {
    for (const url of ["/health", "/health/live", "/health/ready", "/ready", "/api/v1/health", "/api/v1/health/live"])
      expect(isProbeUrl(url), url).toBe(true);
    for (const url of ["/api/v1/ready", "/api/v1/health/ready"]) expect(isProbeUrl(url), url).toBe(true);
    for (const url of [
      "/api/v1/public/site",
      "/api/v1/healthz",
      "/api/v1/health/live/x",
      "/metrics",
      "/api/v1/readyness",
    ])
      expect(isProbeUrl(url), url).toBe(false);
  });
});

describe("portal file links use the LINK_SIGNING_KEYS ring (security track need 3, the portal part)", () => {
  it("carry the key id, survive a rotation while the old key is configured, stop verifying once it is removed", async () => {
    const { config } = await import("../../src/config.js");
    const { signPortalFile, verifyPortalFileToken } = await import("../../src/modules/portal/files.js");
    const { signRingFileToken } = await import("../../src/modules/documents/files.js");
    const ring = config as unknown as { LINK_SIGNING_KEYS: { kid: string; secret: string }[] };
    const original = ring.LINK_SIGNING_KEYS;
    const a = { kid: "a1", secret: "a".repeat(20) + "-link-secret-one-0123456789" };
    const b = { kid: "b2", secret: "b".repeat(20) + "-link-secret-two-0123456789" };
    const customer = "6f1c2a52-6c2b-4a43-9a8a-0c4f9d9f2b11";
    const doc = "0c4f9d9f-2b11-4a43-9a8a-6f1c2a526c2b";
    try {
      ring.LINK_SIGNING_KEYS = [a];
      const { token } = signPortalFile(customer, "DOCUMENT", doc, "medium");
      expect(token.startsWith("a1.")).toBe(true);
      expect(token.length).toBeLessThanOrEqual(100); // the route's param limit
      expect(verifyPortalFileToken(token)).toMatchObject({
        kind: "DOCUMENT",
        customerId: customer,
        refId: doc,
        variant: "medium",
      });
      ring.LINK_SIGNING_KEYS = [b, a];
      expect(verifyPortalFileToken(token)?.refId).toBe(doc);
      expect(signPortalFile(customer, "TEMP", doc).token.startsWith("b2.")).toBe(true);
      ring.LINK_SIGNING_KEYS = [b];
      expect(verifyPortalFileToken(token)).toBeNull();
      // tampering, other families, expiry
      const fresh = signPortalFile(customer, "TEMP", doc).token;
      const [kid, body, sig] = fresh.split(".") as [string, string, string];
      const flip = (s: string) => `${s.slice(0, -1)}${s.endsWith("A") ? "B" : "A"}`;
      expect(verifyPortalFileToken(`${kid}.${flip(body)}.${sig}`)).toBeNull();
      expect(verifyPortalFileToken(`${kid}.${body}.${flip(sig)}`)).toBeNull();
      expect(verifyPortalFileToken(`${body}.${sig}`)).toBeNull();
      expect(
        verifyPortalFileToken(signRingFileToken("kkt-export-link-v1", doc, Math.floor(Date.now() / 1000) + 60)),
      ).toBeNull();
      expect(verifyPortalFileToken(signPortalFile(customer, "TEMP", doc, "original", -5).token)).toBeNull();
    } finally {
      ring.LINK_SIGNING_KEYS = original;
    }
  });
});
