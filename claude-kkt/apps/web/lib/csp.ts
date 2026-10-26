/**
 * Content-Security-Policy of the website (applied per request by middleware.ts with a fresh nonce).
 *
 * - Scripts: only Next's own scripts carrying the per-request nonce ('strict-dynamic' lets them load their chunks); no inline
 *   event handlers, no eval (dev mode adds 'unsafe-eval' for React Refresh). JSON-LD blocks are data, not script, and are unaffected.
 * - Click-to-load embeds (YouTube/Vimeo players, 360° tours, maps): no third-party code runs until the visitor clicks; the iframe it
 *   then injects is sandboxed and must be https (frame-src https:). Posters come from i.ytimg.com.
 * - Images/media/fetches: this origin plus the public API origin (media, form POSTs, live availability).
 * - frame-ancestors 'none' (no clickjacking), object-src 'none', base-uri 'self', form-action 'self'.
 */
export interface CspOptions {
  nonce: string;
  /** Browser-facing API origin, e.g. https://api.example.com */
  apiOrigin: string;
  dev?: boolean;
  /** Adds upgrade-insecure-requests (https deployments). */
  https?: boolean;
}

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
  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
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

/** A random base64 nonce (Web Crypto: works in the edge middleware and in Node). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
