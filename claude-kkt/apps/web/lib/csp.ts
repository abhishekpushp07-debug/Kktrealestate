/**
 * Content-Security-Policy of the website (applied per request by middleware.ts). Scripts never run unless the server vouched for them:
 *
 * - Pages rendered per request (`usesNonce`: /visit/<token>, /projects, /blog — they read a secret token or the URL query — and every page
 *   in `next dev`): `script-src 'self' 'nonce-…' 'strict-dynamic'`; Next.js stamps the per-request nonce on its own scripts and
 *   'strict-dynamic' lets them load their chunks.
 * - Statically regenerated (ISR) pages, rendered once and served to everybody (and CDN-cacheable), cannot carry a per-request nonce:
 *   `script-src 'self' 'kkt-inline-hashes'`, where csp-hook.cjs replaces the placeholder with the SHA-256 hash of each inline script of
 *   the HTML being sent (Next's RSC payload). External scripts come only from this origin; an injected inline script has no hash.
 *   Without the hook the placeholder reaches the browser, which then blocks every inline script (fail closed).
 * - No eval outside `next dev` (React Refresh), no inline event handlers, object-src 'none', base-uri 'self', form-action 'self',
 *   frame-ancestors 'none'. JSON-LD blocks are data, not script, and are unaffected.
 * - Click-to-load embeds (YouTube/Vimeo players, 360° tours, maps): no third-party code runs until the visitor clicks; the iframe it then
 *   injects is sandboxed and must be https (frame-src https:). Posters come from i.ytimg.com.
 * - Images/media/fetches: this origin plus the public API origin (media, form POSTs, live availability, error reports).
 */
export interface CspOptions {
  /** Per-request nonce (pages rendered per request); null/undefined = the ISR policy with the hash placeholder. */
  nonce?: string | null;
  /** Browser-facing API origin, e.g. https://api.example.com */
  apiOrigin: string;
  dev?: boolean;
  /** Adds upgrade-insecure-requests (https deployments). */
  https?: boolean;
}

/** Placeholder csp-hook.cjs replaces with the inline-script hashes of the response body. */
export const INLINE_HASHES_PLACEHOLDER = "'kkt-inline-hashes'";

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, apiOrigin, dev = false, https = false }: CspOptions): string {
  const api = origin(apiOrigin);
  const apiSrc = api ? ` ${api}` : "";
  const scripts = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`
    : `script-src 'self' ${INLINE_HASHES_PLACEHOLDER}${dev ? " 'unsafe-eval'" : ""}`;
  const directives: string[] = [
    "default-src 'self'",
    scripts,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${apiSrc} https://i.ytimg.com`,
    "font-src 'self' data:",
    `connect-src 'self'${apiSrc}${dev ? " ws: wss:" : ""}`,
    `media-src 'self'${apiSrc}`,
    "frame-src https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * Pages rendered per request — a secret token in the path, or content driven by the URL query — get the nonce policy; so does every
 * page under `next dev` (which renders everything per request and runs without csp-hook.cjs). Everything else is ISR (hash policy).
 */
export function usesNonce(pathname: string, dev = false): boolean {
  return dev || pathname === "/projects" || pathname === "/blog" || pathname.startsWith("/visit/");
}

/** A random base64 nonce (Web Crypto: works in the edge middleware and in Node). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
