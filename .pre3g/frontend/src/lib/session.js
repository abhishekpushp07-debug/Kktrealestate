// One signed-in user per tab at a time: every client cache is keyed by the user id and wiped when the user changes.
import { idbDel } from "@/lib/idb";

let uid = null;
const resets = new Set();
// localStorage keys holding a user's data (theme, sidebar, density and column prefs are device prefs and stay)
const USER_LS = ["kkt:recent", "kkt_recent_choices"];
const USER_IDB = ["bootstrap_v1", "catalogues_v1"];

export const sessionUid = () => uid;
export const onSessionReset = (fn) => {
  resets.add(fn);
  return () => resets.delete(fn);
};

export function uidFromToken(token) {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p)).sub || null;
  } catch {
    return null;
  }
}

/** Switch the tab to `next` user (null = signed out); clears everything the previous user left behind. */
export function switchSession(qc, next) {
  if (next && next === uid) return;
  uid = next;
  qc.clear();
  resets.forEach((f) => f());
  try {
    USER_LS.forEach((k) => localStorage.removeItem(k));
    Object.keys(localStorage)
      .filter((k) => k.startsWith("kkt:recent:") || k.startsWith("idb:"))
      .forEach((k) => localStorage.removeItem(k));
    Object.keys(sessionStorage)
      .filter((k) => k !== "kkt_csrf")
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
  USER_IDB.forEach((k) => idbDel(k).catch(() => {}));
}
