/**
 * Hash-based Content-Security-Policy for statically regenerated (ISR) pages.
 *
 * An ISR page is rendered once and served to every visitor (and by a CDN), so it cannot carry a per-request nonce, and Next.js inlines
 * the page's React Server Components payload as inline <script> elements whose content differs per page. Instead of allowing inline
 * scripts wholesale ('unsafe-inline'), this hook lists the SHA-256 hash of every inline script of the HTML actually sent: middleware.ts
 * gives ISR pages the policy `script-src 'self' 'kkt-inline-hashes'`, and the hook replaces the `'kkt-inline-hashes'` placeholder with
 * `'sha256-…'` sources computed over the response body just before the headers leave the process. An injected inline script has no
 * matching hash and does not run. Pages rendered per request keep the nonce policy (no placeholder: the hook leaves them alone).
 *
 * Fail closed: without the hook (e.g. `next start` run without it) the placeholder reaches the browser, which ignores the unknown source
 * and blocks every inline script — the page does not hydrate, it never runs unlisted code.
 *
 * Loaded with `node --require ./csp-hook.cjs` (package.json `start`, Dockerfile CMD) before Next.js creates its HTTP server: it wraps
 * http.createServer's request listener and buffers only HTML responses whose CSP carries the placeholder. Next's own gzip is turned off
 * (next.config.ts `compress: false`; the reverse proxy compresses) so the hook sees the plain body.
 */
"use strict";

const http = require("node:http");
const { createHash } = require("node:crypto");

const PLACEHOLDER = "'kkt-inline-hashes'";
const DEBUG = process.env.KKT_CSP_HOOK_DEBUG === "1";
const CSP_HEADER = "content-security-policy";

/** Script element types the browser executes (a missing type is JavaScript). JSON-LD and other data blocks are not scripts. */
function isExecutable(attrs) {
  const m = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!m) return true;
  const type = (m[1] ?? m[2] ?? m[3] ?? "").trim().toLowerCase();
  return type === "" || type === "module" || type === "text/javascript" || type === "application/javascript";
}

/** SHA-256 CSP sources (`'sha256-<base64>'`) of every executable inline script of an HTML document, in order, without duplicates. */
function inlineScriptHashes(html) {
  const out = [];
  const seen = new Set();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/i.test(attrs) || !isExecutable(attrs)) continue;
    const source = `'sha256-${createHash("sha256")
      .update(m[2] ?? "", "utf8")
      .digest("base64")}'`;
    if (!seen.has(source)) {
      seen.add(source);
      out.push(source);
    }
  }
  return out;
}

/** The policy with the placeholder replaced by the body's inline-script hashes (removed when the page has none). */
function applyHashes(policy, html) {
  const hashes = inlineScriptHashes(html);
  return policy.replace(PLACEHOLDER, hashes.join(" ")).replace(/ {2,}/g, " ").replace(/ ;/g, ";");
}

/** True while the headers carry the placeholder (the content type may not be set yet). */
function mayNeedHashes(res) {
  const csp = res.getHeader(CSP_HEADER);
  return typeof csp === "string" && csp.includes(PLACEHOLDER);
}

function needsHashes(req, res) {
  if (req.method === "HEAD") return false;
  const csp = res.getHeader(CSP_HEADER);
  const type = String(res.getHeader("content-type") ?? "");
  return typeof csp === "string" && csp.includes(PLACEHOLDER) && type.toLowerCase().includes("text/html");
}

/** Buffers an HTML response carrying the placeholder, then sends it with the computed policy. Other responses pass through. */
function instrument(req, res) {
  const write = res.write;
  const end = res.end;
  const flushHeaders = res.flushHeaders;
  /** null = not decided yet (decided at the first body byte, when the headers are known). */
  let buffering = null;
  const chunks = [];
  const decide = () => {
    if (buffering === null) buffering = needsHashes(req, res);
    return buffering;
  };
  const toBuffer = (chunk, encoding) =>
    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8");

  const writeHead = res.writeHead;
  /** True inside our own end(): Node's implicit writeHead must go through then. */
  let finishing = false;
  // writeHead commits the headers; while a response may still need its policy rewritten, keep them in setHeader form (Node writes them
  // implicitly with the body). Only the plain-object form can be deferred; anything else goes straight through.
  res.writeHead = function (statusCode, reason, headers) {
    if (finishing) return writeHead.apply(this, arguments);
    const hdrs = typeof reason === "object" && reason !== null ? reason : headers;
    const message = typeof reason === "string" ? reason : undefined;
    if (hdrs !== undefined && (typeof hdrs !== "object" || Array.isArray(hdrs)))
      return writeHead.apply(this, arguments);
    for (const [k, v] of Object.entries(hdrs ?? {})) if (v !== undefined) this.setHeader(k, v);
    this.statusCode = statusCode;
    if (message) this.statusMessage = message;
    if (!decide()) return message ? writeHead.call(this, statusCode, message) : writeHead.call(this, statusCode);
    return this;
  };
  res.flushHeaders = function () {
    // an optimisation only: skip it while the response may still need its policy rewritten (decided at the first body byte)
    if (buffering === true || (buffering === null && mayNeedHashes(res))) return undefined;
    return flushHeaders.call(this);
  };
  res.write = function (chunk, encoding, cb) {
    if (!decide()) return write.call(this, chunk, encoding, cb);
    if (chunk != null && chunk.length !== 0) chunks.push(toBuffer(chunk, encoding));
    const done = typeof encoding === "function" ? encoding : cb;
    if (typeof done === "function") process.nextTick(done);
    return true;
  };
  res.end = function (chunk, encoding, cb) {
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = undefined;
    } else if (typeof encoding === "function") {
      cb = encoding;
      encoding = undefined;
    }
    if (res.statusCode === 304 && !res.headersSent && mayNeedHashes(res)) {
      // A 304 has no body to hash, and its headers REPLACE the cached response's: drop the placeholder policy so the browser keeps the
      // policy it stored with the 200 (same ETag = same body = same hashes).
      res.removeHeader(CSP_HEADER);
      return end.call(this, chunk, encoding, cb);
    }
    if (!decide()) {
      if (DEBUG && mayNeedHashes(res) && !res.headersSent)
        console.warn(
          `[csp-hook] ${req.method} ${req.url}: placeholder left on a ${String(res.getHeader("content-type"))} response`,
        );
      return end.call(this, chunk, encoding, cb);
    }
    if (chunk != null && chunk.length !== 0) chunks.push(toBuffer(chunk, encoding));
    const body = Buffer.concat(chunks);
    try {
      res.setHeader(CSP_HEADER, applyHashes(String(res.getHeader(CSP_HEADER)), body.toString("utf8")));
      res.removeHeader("transfer-encoding");
      res.setHeader("content-length", String(body.length));
    } catch {
      // headers already sent (cannot happen while buffering): leave the fail-closed placeholder in place
    }
    finishing = true;
    return end.call(this, body, undefined, cb);
  };
}

/** Wraps every HTTP server's request listener created after this call (Next.js creates exactly one). Idempotent. */
function install() {
  if (http.createServer.__kktCspHook) return;
  const create = http.createServer;
  const wrapped = function createServer(...args) {
    const i = args.findIndex((a) => typeof a === "function");
    if (i >= 0) {
      const listener = args[i];
      args[i] = function (req, res) {
        instrument(req, res);
        return listener.call(this, req, res);
      };
    }
    return create.apply(this, args);
  };
  wrapped.__kktCspHook = true;
  http.createServer = wrapped;
}

if (process.env.KKT_CSP_HOOK !== "off") install();

module.exports = { PLACEHOLDER, inlineScriptHashes, applyHashes, instrument, install };
