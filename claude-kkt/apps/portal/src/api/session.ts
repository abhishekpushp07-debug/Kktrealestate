// Session state of the portal API client (contract C1), pure: no React Native imports, unit-tested in test/session.test.ts.
//
//  - Web ("cookie" mode): the access token lives in memory only. The refresh token is the HttpOnly cookie kkt_prt
//    (Path=/api/v1/portal/auth) the API sets when login / refresh / logout carry `X-KKT-Session: cookie`; no script can read it and
//    nothing token-like is written to localStorage — only a "signed in on this browser" hint ("1"), so a first visit does not probe
//    /auth/refresh. A refresh token left in localStorage by a pre-C1 build is deleted on load. The session is restored on load by a
//    cookie refresh.
//  - Native ("body" mode): the refresh token stays in the Keychain / Keystore (expo-secure-store) and travels in the JSON body.
import type { TokenPair } from "@kkt/contracts";

export type SessionMode = "cookie" | "body";

/** Native: SecureStore key of the refresh token. Web: the legacy localStorage key (removed on load). */
export const REFRESH_KEY = "kkt.portal.refresh";
/** Web: "signed in on this browser" hint — a flag, never a token. */
export const SESSION_HINT_KEY = "kkt.portal.session";
/** Request header that selects the HttpOnly refresh cookie (contract C1). */
export const SESSION_MODE_HEADER = "X-KKT-Session";

export interface SessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type SessionListener = (event: "expired") => void;

export interface PortalSession {
  readonly mode: SessionMode;
  readonly accessToken: string | null;
  /** True when a session may exist (native: a stored refresh token; web: the hint or an access token in memory). */
  readonly canRefresh: boolean;
  /** Reads the stored state once (and, on web, deletes a legacy refresh token). Resolves to `canRefresh`. */
  load(): Promise<boolean>;
  setTokens(pair: Pick<TokenPair, "access_token" | "refresh_token">): Promise<void>;
  clear(): Promise<void>;
  /** Body of POST /auth/refresh: `{refresh_token}` in body mode, nothing in cookie mode. */
  refreshBody(): { refresh_token: string } | undefined;
  /** Extra headers (and whether credentials are included) for the login / refresh / logout calls. */
  authTransport(): { headers: Record<string, string>; includeCredentials: boolean };
  onExpired(listener: SessionListener): () => void;
  notifyExpired(): void;
}

export function createSession(mode: SessionMode, store: SessionStore): PortalSession {
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let hint = false;
  let loaded = false;
  const listeners = new Set<SessionListener>();

  const canRefresh = (): boolean => (mode === "cookie" ? hint || accessToken !== null : refreshToken !== null);

  return {
    mode,
    get accessToken() {
      return accessToken;
    },
    get canRefresh() {
      return canRefresh();
    },
    async load() {
      if (!loaded) {
        if (mode === "cookie") {
          // A pre-C1 build kept the refresh token in localStorage; it must not linger there.
          await store.remove(REFRESH_KEY);
          hint = (await store.get(SESSION_HINT_KEY)) === "1";
        } else {
          refreshToken = await store.get(REFRESH_KEY);
        }
        loaded = true;
      }
      return canRefresh();
    },
    async setTokens(pair) {
      accessToken = pair.access_token;
      loaded = true;
      if (mode === "cookie") {
        hint = true;
        await store.set(SESSION_HINT_KEY, "1");
        return;
      }
      // Body mode: a refresh answer always carries the rotated token; keep the old one only if a response somehow lacks it.
      if (pair.refresh_token) {
        refreshToken = pair.refresh_token;
        await store.set(REFRESH_KEY, pair.refresh_token);
      }
    },
    async clear() {
      accessToken = null;
      refreshToken = null;
      hint = false;
      loaded = true;
      await store.remove(mode === "cookie" ? SESSION_HINT_KEY : REFRESH_KEY);
    },
    refreshBody() {
      return mode === "body" && refreshToken ? { refresh_token: refreshToken } : undefined;
    },
    authTransport(): { headers: Record<string, string>; includeCredentials: boolean } {
      return mode === "cookie"
        ? { headers: { [SESSION_MODE_HEADER]: "cookie" }, includeCredentials: true }
        : { headers: {}, includeCredentials: false };
    },
    onExpired(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notifyExpired() {
      for (const listener of listeners) listener("expired");
    },
  };
}
