// The portal API client's session calls (src/api/client.ts) with the React Native modules mocked: a web build in cookie mode.
// Review finding (phase 7): logout was sent with `noRefresh`, so an expired access token (the app left open past its lifetime) got
// a 401 and the server session and the HttpOnly kkt_prt cookie survived the "sign out" for up to REFRESH_ABSOLUTE_TTL_DAYS. And a
// refresh can return another customer's token (the cookie is shared by tabs): the pending call must not be re-sent as them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, string>();

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("@/lib/upload", () => ({ buildMultipart: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  secureStorage: {
    get: async (key: string) => memory.get(key) ?? null,
    set: async (key: string, value: string) => void memory.set(key, value),
    remove: async (key: string) => void memory.delete(key),
  },
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("portal client logout (cookie mode)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.resetModules();
    memory.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes an expired access token first, so the server revokes the session and clears the cookie", async () => {
    const { api, session } = await import("@/api/client");
    await session.setTokens({ access_token: "expired-access" });
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockResolvedValueOnce(json(200, { access_token: "fresh-access", token_type: "Bearer", expires_in: 900 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await api.auth.logout({ all_devices: false });

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url.replace(/^.*\/api\/v1/, ""))).toEqual([
      "/portal/auth/logout",
      "/portal/auth/refresh",
      "/portal/auth/logout",
    ]);
    const retry = calls[2]?.[1];
    const headers = retry?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fresh-access");
    // the cookie transport: the API clears kkt_prt only for a request that carries the header and the credentials
    expect(headers["X-KKT-Session"]).toBe("cookie");
    expect(retry?.credentials).toBe("include");
  });

  it("restores the session before logging out on a cold start (only the hint, no access token in memory)", async () => {
    memory.set("kkt.portal.session", "1");
    const { api } = await import("@/api/client");
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: "restored", token_type: "Bearer", expires_in: 900 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.auth.logout({});
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url.replace(/^.*\/api\/v1/, ""))).toEqual([
      "/portal/auth/refresh",
      "/portal/auth/logout",
    ]);
    expect((calls[1]?.[1].headers as Record<string, string>).Authorization).toBe("Bearer restored");
  });

  it("a refresh that returns ANOTHER customer's token (signed in as someone else in another tab) never re-sends the call", async () => {
    const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub, aud: "portal" })).replace(/=+$/, "")}.s`;
    const { api, session } = await import("@/api/client");
    const { tokenSubject } = await import("@/api/session");
    await session.setTokens({ access_token: jwt("customer-a") });
    const events: string[] = [];
    session.onExpired((event) => events.push(event));
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockResolvedValueOnce(json(200, { access_token: jwt("customer-b"), token_type: "Bearer", expires_in: 900 }));
    await expect(
      api.requests.create({ category_id: "c", title: "t", description: "d" } as never),
    ).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // the request was NOT created as customer B
    expect(events).toEqual(["user-changed"]);
    expect(tokenSubject(session.accessToken)).toBe("customer-b");
  });
});
