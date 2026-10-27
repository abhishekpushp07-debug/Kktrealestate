/**
 * Per-user data the ERP keeps in this browser's localStorage (audit v3 D1: no PII at rest, and nothing one user leaves behind may
 * reach the next user of a shared office PC — a project-scoped user must not see another project's customers or bookings).
 *
 * - The booking wizard's local draft fallback (ids, amounts, remarks) belongs to the user who wrote it.
 * - The command palette's recents keep navigation entries only (customer / booking search hits stay in memory), and a list written
 *   by an older build is purged on load.
 *
 * `claimBrowserData(userId)` runs when a user is known (sign-in or session restore): if this browser's data belongs to someone else
 * (or to nobody known), the user-scoped keys are removed before the new user can see them. `forgetBrowserData()` runs on an explicit
 * sign-out. A forced sign-out (session expired) keeps the draft, so the same user signing in again can still resume it.
 */

/** localStorage key of the booking wizard's local draft (features/bookings/wizard/useBookingDraft.ts). */
export const LOCAL_DRAFT_KEY = "kkt.erp.booking-draft";
/** localStorage key of the command palette's recent entries (components/ui/command-palette.tsx). */
export const RECENT_COMMANDS_KEY = "kkt.erp.recent";
/** Id of the user the user-scoped keys belong to (an id, never a name or e-mail). */
export const BROWSER_DATA_OWNER_KEY = "kkt.erp.owner";
/** Keys removed when the browser changes hands. */
export const USER_SCOPED_KEYS: readonly string[] = [LOCAL_DRAFT_KEY, RECENT_COMMANDS_KEY];

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Removes every user-scoped key (explicit sign-out). */
export function forgetBrowserData(store: Store | null = defaultStore()): void {
  if (!store) return;
  try {
    for (const key of USER_SCOPED_KEYS) store.removeItem(key);
    store.removeItem(BROWSER_DATA_OWNER_KEY);
  } catch {
    /* private mode / blocked storage: nothing was kept */
  }
}

/**
 * Marks the user-scoped keys as `userId`'s. Data left by another user (or by a build that did not record an owner) is removed first.
 * Returns true when something was removed.
 */
export function claimBrowserData(userId: string, store: Store | null = defaultStore()): boolean {
  if (!store || !userId) return false;
  try {
    const owner = store.getItem(BROWSER_DATA_OWNER_KEY);
    if (owner === userId) return false;
    const hadData = USER_SCOPED_KEYS.some((key) => store.getItem(key) !== null);
    for (const key of USER_SCOPED_KEYS) store.removeItem(key);
    store.setItem(BROWSER_DATA_OWNER_KEY, userId);
    return hadData;
  } catch {
    return false;
  }
}

/** Recent-command entries that may be written to localStorage: navigation items only ("nav:<id>"), never search hits. */
export function isPersistableRecent(item: { id: string }): boolean {
  return item.id.startsWith("nav:");
}
