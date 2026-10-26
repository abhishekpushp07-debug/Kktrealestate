import { NextResponse, type NextRequest } from "next/server";

import { buildCsp, createNonce } from "@/lib/csp";
import { publicApiUrl, siteUrl } from "@/lib/env";

/**
 * Per-request strict Content-Security-Policy (lib/csp.ts). The nonce travels to the renderer on the request's own CSP header, from
 * which Next.js stamps it onto every script it emits; the same policy is sent to the browser. Static assets are excluded (matcher).
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = buildCsp({ nonce, apiOrigin: publicApiUrl(), dev: process.env.NODE_ENV === "development", https: siteUrl().startsWith("https://") });
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
