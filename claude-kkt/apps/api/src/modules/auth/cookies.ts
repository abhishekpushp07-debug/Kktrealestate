/**
 * Cookie transport of refresh tokens (contract C1). A browser client sends `X-KKT-Session: cookie` on login, refresh and logout; the API
 * then keeps the refresh token in an HttpOnly, SameSite=Strict cookie scoped to its own auth path (`kkt_rt` → /api/v1/auth for staff,
 * `kkt_prt` → /api/v1/portal/auth for customers) and leaves it out of the JSON body, so no script on the page can read it. Body mode
 * (refresh_token in the JSON) stays for native apps and API clients.
 *
 * CSRF: a cookie is only ever honoured together with the `X-KKT-Session: cookie` header. A cross-site form cannot set custom headers, and a
 * cross-origin fetch with one needs a CORS preflight that only the configured ERP/portal origins pass; SameSite=Strict keeps the cookie off
 * cross-site requests in the first place.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { ApiError } from "../../lib/errors.js";
import type { TokenAudience } from "../../lib/jwt.js";
import type { IssuedTokens } from "./service.js";

/** Request header that selects the cookie transport (value `cookie`). */
export const SESSION_MODE_HEADER = "x-kkt-session";

/** Cookie name and path per audience. */
export const REFRESH_COOKIES: Readonly<Record<TokenAudience, { name: string; path: string }>> = {
  erp: { name: "kkt_rt", path: "/api/v1/auth" },
  portal: { name: "kkt_prt", path: "/api/v1/portal/auth" },
};

/** True when the request asks for the cookie transport. */
export function wantsCookie(req: FastifyRequest): boolean {
  const v = req.headers[SESSION_MODE_HEADER];
  return typeof v === "string" && v.trim().toLowerCase() === "cookie";
}

/** The value of one cookie of the request (null when absent); no cookie plugin needed for the two cookies this API reads. */
export function readCookie(req: FastifyRequest, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** `Secure` everywhere except development and test (plain-http localhost). */
function secureFlag(): string {
  return config.NODE_ENV === "development" || config.NODE_ENV === "test" ? "" : "; Secure";
}

/** Sets the refresh cookie (HttpOnly, SameSite=Strict, Secure outside dev/test, Max-Age = the family's remaining absolute lifetime). */
export function setRefreshCookie(reply: FastifyReply, aud: TokenAudience, token: string, maxAgeSeconds: number): void {
  const c = REFRESH_COOKIES[aud];
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  reply.header(
    "Set-Cookie",
    `${c.name}=${encodeURIComponent(token)}; Path=${c.path}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secureFlag()}`,
  );
}

/** Clears the refresh cookie. */
export function clearRefreshCookie(reply: FastifyReply, aud: TokenAudience): void {
  const c = REFRESH_COOKIES[aud];
  reply.header(
    "Set-Cookie",
    `${c.name}=; Path=${c.path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict${secureFlag()}`,
  );
}

/** True when a refresh failed because the session itself is dead (401), not for a transient reason (409 lock timeout, 429, 5xx). */
export function isDeadSession(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 401;
}

/**
 * The refresh token of a refresh request: the body's `refresh_token` (body mode), else the audience's cookie — but only with the
 * `X-KKT-Session: cookie` header (CSRF guard: a cookie alone is refused with 403 FORBIDDEN `details.reason = SESSION_HEADER_REQUIRED`).
 * 401 INVALID_TOKEN when neither is present.
 */
export function refreshTokenOf(req: FastifyRequest, aud: TokenAudience, bodyToken: string | undefined): string {
  if (bodyToken) return bodyToken;
  const cookie = readCookie(req, REFRESH_COOKIES[aud].name);
  if (cookie) {
    if (!wantsCookie(req))
      throw ApiError.forbidden("A cookie session needs the X-KKT-Session: cookie header", {
        reason: "SESSION_HEADER_REQUIRED",
        header: "X-KKT-Session",
      });
    return cookie;
  }
  throw ApiError.unauthenticated(
    "No refresh token: send refresh_token, or the session cookie with X-KKT-Session: cookie",
    "INVALID_TOKEN",
  );
}

/**
 * The token part of a login/refresh response (contract C1). With `X-KKT-Session: cookie` the refresh token goes into the HttpOnly cookie
 * (Max-Age = the family's remaining absolute lifetime) and is left out of the body; otherwise it is in the body (native apps, API clients).
 */
export function tokenPair(req: FastifyRequest, reply: FastifyReply, t: IssuedTokens) {
  const cookie = wantsCookie(req);
  if (cookie)
    setRefreshCookie(reply, t.audience, t.refresh_token, (t.session_expires_at.getTime() - Date.now()) / 1000);
  return {
    access_token: t.access_token,
    ...(cookie ? {} : { refresh_token: t.refresh_token }),
    token_type: t.token_type,
    expires_in: t.expires_in,
    audience: t.audience,
  };
}
