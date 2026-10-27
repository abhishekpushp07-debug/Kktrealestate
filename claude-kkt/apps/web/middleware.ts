import { NextResponse, type NextRequest } from "next/server";

import { buildCsp, createNonce, usesNonce } from "@/lib/csp";
import { publicApiUrl, siteUrl } from "@/lib/env";

/**
 * Content-Security-Policy of every page (lib/csp.ts). Pages rendered per request (`usesNonce`) get a strict per-request nonce policy:
 * the nonce travels to the renderer on the request's own CSP header, from which Next.js stamps it onto every script it emits; the same
 * policy goes to the browser. ISR pages (static HTML shared by every visitor and CDN-cacheable) get the hash policy, whose
 * `'kkt-inline-hashes'` placeholder csp-hook.cjs replaces with the hashes of the inline scripts actually sent. Static assets are excluded
 * (matcher).
 */
export function middleware(request: NextRequest): NextResponse {
  const dev = process.env.NODE_ENV === "development";
  const options = { apiOrigin: publicApiUrl(), dev, https: siteUrl().startsWith("https://") };
  if (!usesNonce(request.nextUrl.pathname, dev)) {
    const response = NextResponse.next();
    response.headers.set("content-security-policy", buildCsp(options));
    return response;
  }
  const nonce = createNonce();
  const csp = buildCsp({ ...options, nonce });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|icon.svg|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
