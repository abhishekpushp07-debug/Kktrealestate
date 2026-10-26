import { describe, expect, it } from "vitest";

import { buildCsp, createNonce } from "@/lib/csp";

function directives(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.split(" ")[0]!, d.slice(d.indexOf(" ") + 1)]),
  );
}

describe("website Content-Security-Policy", () => {
  const nonce = createNonce();
  const csp = directives(buildCsp({ nonce, apiOrigin: "https://api.example.com/some/path", https: true }));

  it("allows scripts only by per-request nonce (strict-dynamic), no unsafe-inline / unsafe-eval in production", () => {
    expect(csp.get("script-src")).toBe(`'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp.get("script-src")).not.toContain("unsafe-inline");
    expect(csp.get("script-src")).not.toContain("unsafe-eval");
    expect(createNonce()).not.toBe(nonce);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("forbids framing, plugins, base hijacking and off-site form posts", () => {
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'self'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
  });

  it("keeps click-to-load embeds working: https iframes (YouTube/Vimeo/tours/maps), YouTube posters, API media and fetches", () => {
    expect(csp.get("frame-src")).toBe("https:");
    expect(csp.get("img-src")).toContain("https://i.ytimg.com");
    expect(csp.get("img-src")).toContain("https://api.example.com");
    expect(csp.get("connect-src")).toBe("'self' https://api.example.com");
  });

  it("dev mode adds only what React Refresh needs", () => {
    const dev = directives(buildCsp({ nonce: "n", apiOrigin: "http://localhost:4000", dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
  });
});
