/**
 * Hash-based Content-Security-Policy for statically regenerated (ISR) pages.
 *
 * An ISR page is rendered once and served to every visitor (and by a CDN), so it cannot carry a per-request nonce, and Next.js inlines
 * the page's React Server Components payload as inline <script> elements whose content differs per page. Instead of allowing inline
 * scripts wholesale ('unsafe-inline'), this hook lists the SHA-256 hash of every inline script of the HTML actually sent: middleware.ts
 * gives ISR pages the policy `script-src 'self' 'kkt-inline-hashes'`, and the hook replaces the `'kkt-inline-hashes'` placeholder with
 * `'sha256-…'` sources computed over the response body just before the headers leave the process. Only scripts that are exactly
 * Next.js's RSC payload (`self.__next_f.push(<JSON data>)`, isFrameworkScript) are hashed: any other inline script in the body — e.g.
 * markup an injection slipped past the renderer — gets no hash and does not run. Pages rendered per request keep the nonce policy (no
 * placeholder: the hook leaves them alone).
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

/**
 * End of the JSON array starting at `src[start]` ("["): the index just past its closing "]", or -1. A linear scan that tracks strings and
 * escapes (the payload is JSON.parse'd afterwards, so this only has to find the boundary).
 */
function jsonArrayEnd(src, start) {
  if (src[start] !== "[") return -1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return c === "]" ? i + 1 : -1;
    }
  }
  return -1;
}

const NEXT_INIT = /^self\.__next_f\s*=\s*self\.__next_f\s*\|\|\s*\[\]/;
const NEXT_INIT_PUSH = /^\(self\.__next_f\s*=\s*self\.__next_f\s*\|\|\s*\[\]\)\.push\(/;
const NEXT_PUSH = /^self\.__next_f\.push\(/;

/**
 * True when an inline script is nothing but Next.js's React Server Components payload: a sequence of `self.__next_f=self.__next_f||[]`,
 * `(self.__next_f=self.__next_f||[]).push(<JSON array>)` and `self.__next_f.push(<JSON array>)` statements whose arguments are pure
 * JSON data. Only those are hashed: an inline script that reached the HTML any other way (an injection the rendering missed) gets no
 * hash, so the browser blocks it — the policy never vouches for code merely because it is in the response.
 */
function isFrameworkScript(source) {
  let rest = source.trim();
  if (rest === "") return false;
  while (rest.length > 0) {
    let m = NEXT_INIT_PUSH.exec(rest) || NEXT_PUSH.exec(rest);
    if (m) {
      const start = m[0].length;
      const end = jsonArrayEnd(rest, start);
      if (end < 0 || rest[end] !== ")") return false;
      try {
        JSON.parse(rest.slice(start, end));
      } catch {
        return false;
      }
      rest = rest.slice(end + 1);
    } else if ((m = NEXT_INIT.exec(rest))) {
      rest = rest.slice(m[0].length);
    } else return false;
    rest = rest.replace(/^\s*;?\s*/, "");
  }
  return true;
}

/** Inline scripts left without a hash are reported once per distinct start (they are blocked by the browser). */
const reportedUnknown = new Set();
function reportUnknown(source) {
  const head = source.trim().slice(0, 80);
  if (reportedUnknown.has(head) || reportedUnknown.size > 100) return;
  reportedUnknown.add(head);
  console.warn(
    `[csp-hook] inline script is not a Next.js payload; left without a hash (blocked): ${JSON.stringify(head)}`,
  );
}

/**
 * SHA-256 CSP sources (`'sha256-<base64>'`) of the Next.js payload scripts (isFrameworkScript) of an HTML document, in order, without
 * duplicates. External scripts and data blocks (JSON-LD) are not scripts; any other executable inline script is not listed.
 */
function inlineScriptHashes(html) {
  const out = [];
  const seen = new Set();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/i.test(attrs) || !isExecutable(attrs)) continue;
    const body = m[2] ?? "";
    if (!isFrameworkScript(body)) {
      reportUnknown(body);
      continue;
    }
    const source = `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
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

module.exports = { PLACEHOLDER, isFrameworkScript, inlineScriptHashes, applyHashes, instrument, install };
