// React Query retry policy of the portal (pure; test/resilience.test.ts), the same rules as the ERP (audit v3 H4):
//  - never retry a 4xx (validation, permission, not found, conflict: a second attempt cannot succeed) except 429 with Retry-After;
//  - 429 / 503 wait for the server's Retry-After (load shedding asks clients to come back later, not at once), at most twice and
//    only when the wait is short; a 503 without Retry-After is retried once;
//  - other 5xx and network failures: once more with a short backoff (the cached screen stays visible meanwhile).
import { ApiError } from "./errors";

export const MAX_RETRY_AFTER_MS = 30_000;
export const MAX_THROTTLED_RETRIES = 2;

function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.retryAfterSeconds === undefined) return null;
  return error.retryAfterSeconds * 1000;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status > 0) {
    if (error.status === 429 || error.status === 503) {
      const wait = retryAfterMs(error);
      if (wait === null) return error.status === 503 && failureCount < 1;
      return wait <= MAX_RETRY_AFTER_MS && failureCount < MAX_THROTTLED_RETRIES;
    }
    if (error.status >= 400 && error.status < 500) return false;
  }
  return failureCount < 2;
}

export function queryRetryDelay(failureCount: number, error: unknown): number {
  const wait = retryAfterMs(error);
  if (wait !== null) return Math.min(Math.max(wait, 250), MAX_RETRY_AFTER_MS);
  return Math.min(1000 * 2 ** failureCount, 8000);
}
