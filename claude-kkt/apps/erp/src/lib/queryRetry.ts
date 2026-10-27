/**
 * React Query retry policy (audit v3 H4): never retry a 4xx (validation, permission, not found, conflict — a second attempt
 * cannot succeed) except 429 with a Retry-After; retry 503 / 429 after the server's Retry-After (load shedding asks clients to
 * come back later, not immediately); retry other 5xx and network failures once with a short backoff.
 */
import { isApiClientError } from "./api";

/** Longest Retry-After the UI waits for automatically; anything longer is shown as an error with its own retry button. */
export const MAX_RETRY_AFTER_MS = 30_000;
export const MAX_THROTTLED_RETRIES = 2;

function retryAfterMs(error: unknown): number | null {
  if (!isApiClientError(error) || error.retryAfterSeconds === undefined) return null;
  return error.retryAfterSeconds * 1000;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isApiClientError(error)) {
    const throttled = error.status === 429 || error.status === 503;
    if (throttled) {
      const wait = retryAfterMs(error);
      if (wait === null) return error.status === 503 && failureCount < 1;
      return wait <= MAX_RETRY_AFTER_MS && failureCount < MAX_THROTTLED_RETRIES;
    }
    if (error.status >= 400 && error.status < 500) return false;
  }
  return failureCount < 1;
}

export function queryRetryDelay(failureCount: number, error: unknown): number {
  const wait = retryAfterMs(error);
  if (wait !== null) return Math.min(Math.max(wait, 250), MAX_RETRY_AFTER_MS);
  return Math.min(1000 * 2 ** failureCount, 8000);
}
