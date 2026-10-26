// Login failure → copy for the sign-in screen (pure: unit-tested in test/loginFailure.test.ts).
// Only INVALID_CREDENTIALS gets the generic "don't match" copy; any other code (USER_INACTIVE "Portal access is disabled", codes added
// by a newer server) shows the server's own message, never a guess based on the HTTP status alone.
import { ApiError } from "@/api/errors";

export interface LoginFailure {
  code: "INVALID_CREDENTIALS" | "LOCKED" | "RATE_LIMITED" | "VALIDATION" | "NETWORK" | "OTHER";
  message: string;
  lockedUntil?: string;
  retryAfterSeconds?: number;
}

export const INVALID_CREDENTIALS_COPY = "That phone number and password don't match.";
const GENERIC = "Something went wrong. Please try again.";

export function toLoginFailure(e: unknown): LoginFailure {
  if (e instanceof ApiError) {
    // a 401 without a usable code (proxy / non-envelope body) is still a failed sign-in
    if (
      e.code === "INVALID_CREDENTIALS" ||
      (e.status === 401 && (e.code === "UNKNOWN" || e.code === "UNAUTHENTICATED"))
    ) {
      return { code: "INVALID_CREDENTIALS", message: INVALID_CREDENTIALS_COPY };
    }
    if (e.code === "LOCKED" || e.status === 423) {
      const lockedUntil = typeof e.details.locked_until === "string" ? e.details.locked_until : undefined;
      return {
        code: "LOCKED",
        message: e.message || "Too many failed attempts. Your account is locked for a while.",
        lockedUntil,
      };
    }
    if (e.code === "RATE_LIMITED" || e.status === 429) {
      // also returned when parallel attempts exceed the lockout budget (security track): a fixed, calm message
      const wait = e.retryAfterSeconds ? `Try again in ${e.retryAfterSeconds} seconds.` : "Try again in a moment.";
      return { code: "RATE_LIMITED", message: `Too many attempts. ${wait}`, retryAfterSeconds: e.retryAfterSeconds };
    }
    if (e.code === "VALIDATION_ERROR")
      return { code: "VALIDATION", message: "Enter a valid 10-digit mobile number and your password." };
    if (e.isNetwork) return { code: "NETWORK", message: e.message };
    return { code: "OTHER", message: e.message || GENERIC };
  }
  return { code: "OTHER", message: GENERIC };
}
