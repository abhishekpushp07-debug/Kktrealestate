// What the portal's query cache may write to device storage (pure; test/session.test.ts). Audit v3 D1: booking, payment, demand,
// ledger, KYC / profile, document and notification data must never sit in AsyncStorage / localStorage, where any script on the
// page (web) or a device backup (native) can read it. Only an allow-list of non-personal, non-financial screens is persisted, so
// they still open instantly from the last copy (SPEC: "cached last data so the app opens instantly and refreshes in the
// background"); every other screen renders from the in-memory cache within a session and shows a skeleton on a cold start.

/** First query-key segments whose data may be persisted. Everything else stays in memory only. */
export const PERSISTABLE_ROOTS: ReadonlySet<string> = new Set(["notices", "request-categories"]);

/** The persisted cache key (bumped from v2, which persisted booking and payment data; the old key is deleted on start). */
export const CACHE_STORAGE_KEY = "kkt.portal.cache.v3";
export const LEGACY_CACHE_STORAGE_KEYS: readonly string[] = [
  "kkt.portal.cache.v2",
  "kkt.portal.cache.v1",
  "kkt.portal.cache",
];

/**
 * Construction progress is per booking (["booking", id, "construction"]) but holds only the tower's stage timeline and photos —
 * no money, no personal data — so it is persisted too.
 */
function isConstruction(key: readonly unknown[]): boolean {
  return key[0] === "booking" && key[2] === "construction" && key.length === 3;
}

export function shouldPersistQuery(query: { queryKey: readonly unknown[]; state: { status: string } }): boolean {
  if (query.state.status !== "success") return false;
  const root = query.queryKey[0];
  if (typeof root === "string" && PERSISTABLE_ROOTS.has(root)) return true;
  return isConstruction(query.queryKey);
}
