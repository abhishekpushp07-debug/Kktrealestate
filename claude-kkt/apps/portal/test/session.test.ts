// Contract C1 in the portal: web keeps the access token in memory and the refresh token in the HttpOnly cookie (nothing token-like in
// browser storage); native keeps SecureStore + body mode. Also: what the query cache may persist (audit v3 D1) and versions (C6).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/errors";
import { CACHE_STORAGE_KEY, LEGACY_CACHE_STORAGE_KEYS, shouldPersistQuery } from "@/api/persistPolicy";
import { createSession, REFRESH_KEY, SESSION_HINT_KEY, type SessionStore } from "@/api/session";
import { isVersionConflict, profileVersion } from "@/api/versions";

function memoryStore(initial: Record<string, string> = {}): SessionStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
    remove: async (k) => {
      delete data[k];
    },
  };
}

const ACCESS = "a".repeat(40);
const REFRESH = "r".repeat(40);

describe("web session (cookie mode)", () => {
  it("never writes a token to storage: only the hint flag; the legacy refresh token is deleted on load", async () => {
    const store = memoryStore({ [REFRESH_KEY]: "legacy-refresh-token-from-an-old-build" });
    const s = createSession("cookie", store);
    expect(await s.load()).toBe(false);
    expect(store.data[REFRESH_KEY]).toBeUndefined();

    await s.setTokens({ access_token: ACCESS, refresh_token: REFRESH });
    expect(s.accessToken).toBe(ACCESS);
    expect(store.data).toEqual({ [SESSION_HINT_KEY]: "1" });
    expect(JSON.stringify(store.data)).not.toContain(REFRESH);
    expect(JSON.stringify(store.data)).not.toContain(ACCESS);
  });

  it("refreshes with an empty body through the cookie header + credentials", async () => {
    const s = createSession("cookie", memoryStore({ [SESSION_HINT_KEY]: "1" }));
    expect(await s.load()).toBe(true); // a session to restore on load
    expect(s.refreshBody()).toBeUndefined();
    expect(s.authTransport()).toEqual({ headers: { "X-KKT-Session": "cookie" }, includeCredentials: true });
  });

  it("clear() forgets the access token and the hint (logout / SESSION_EXPIRED)", async () => {
    const store = memoryStore();
    const s = createSession("cookie", store);
    await s.setTokens({ access_token: ACCESS });
    let expired = 0;
    const off = s.onExpired(() => (expired += 1));
    await s.clear();
    s.notifyExpired();
    off();
    s.notifyExpired();
    expect(s.accessToken).toBeNull();
    expect(s.canRefresh).toBe(false);
    expect(store.data).toEqual({});
    expect(expired).toBe(1);
  });
});

describe("native session (body mode)", () => {
  it("keeps the refresh token in SecureStore and sends it in the body, without the cookie header", async () => {
    const store = memoryStore({ [REFRESH_KEY]: REFRESH });
    const s = createSession("body", store);
    expect(await s.load()).toBe(true);
    expect(s.refreshBody()).toEqual({ refresh_token: REFRESH });
    expect(s.authTransport()).toEqual({ headers: {}, includeCredentials: false });
    await s.setTokens({ access_token: ACCESS, refresh_token: "n".repeat(40) });
    expect(store.data[REFRESH_KEY]).toBe("n".repeat(40));
    await s.clear();
    expect(store.data[REFRESH_KEY]).toBeUndefined();
    expect(s.refreshBody()).toBeUndefined();
  });
});

describe("query-cache persistence (audit v3 D1)", () => {
  const ok = (queryKey: readonly unknown[]) => ({ queryKey, state: { status: "success" } });
  it("persists only notices, request categories and construction progress", () => {
    expect(shouldPersistQuery(ok(["notices"]))).toBe(true);
    expect(shouldPersistQuery(ok(["request-categories"]))).toBe(true);
    expect(shouldPersistQuery(ok(["booking", "b1", "construction"]))).toBe(true);
    for (const key of [
      ["auth", "me"],
      ["bookings"],
      ["booking", "b1", "home"],
      ["booking", "b1", "flat"],
      ["booking", "b1", "ledger"],
      ["booking", "b1", "receipts"],
      ["booking", "b1", "demands"],
      ["booking", "b1", "schedule"],
      ["booking", "b1", "documents"],
      ["booking", "b1", "bank"],
      ["requests", "ALL", "ALL"],
      ["request", "r1"],
      ["notifications"],
      ["profile"],
      ["sessions"],
      ["pdf", "x"],
    ]) {
      expect(shouldPersistQuery(ok(key)), JSON.stringify(key)).toBe(false);
    }
    expect(shouldPersistQuery({ queryKey: ["notices"], state: { status: "error" } })).toBe(false);
  });

  it("uses a new storage key and deletes the old ones (which held booking and payment data)", () => {
    expect(CACHE_STORAGE_KEY).toBe("kkt.portal.cache.v3");
    expect(LEGACY_CACHE_STORAGE_KEYS).toContain("kkt.portal.cache.v2");
    const src = fs.readFileSync(path.resolve(__dirname, "../src/api/queries.ts"), "utf8");
    expect(src).toMatch(/shouldDehydrateQuery: shouldPersistQuery/);
    expect(src).toMatch(/LEGACY_CACHE_STORAGE_KEYS\) void AsyncStorage\.removeItem/);
  });

  it("the web build keeps no user snapshot and the client uses the cookie transport on web", () => {
    const auth = fs.readFileSync(path.resolve(__dirname, "../src/auth/AuthProvider.tsx"), "utf8");
    expect(auth).toMatch(/KEEP_USER_SNAPSHOT = Platform\.OS !== "web"/);
    const client = fs.readFileSync(path.resolve(__dirname, "../src/api/client.ts"), "utf8");
    expect(client).toMatch(/createSession\(Platform\.OS === "web" \? "cookie" : "body", secureStorage\)/);
    expect(client).not.toMatch(/refresh_token: refreshToken/);
  });
});

describe("versions (contract C6)", () => {
  it("reads a numeric version when the resource carries one", () => {
    expect(profileVersion({ version: 7 })).toBe(7);
    expect(profileVersion({})).toBeUndefined();
    expect(profileVersion({ version: "7" })).toBeUndefined();
  });
  it("recognises 409 VERSION_CONFLICT", () => {
    expect(isVersionConflict(new ApiError({ status: 409, code: "VERSION_CONFLICT", message: "m" }))).toBe(true);
    expect(isVersionConflict(new ApiError({ status: 409, code: "DUPLICATE", message: "m" }))).toBe(false);
  });
});
