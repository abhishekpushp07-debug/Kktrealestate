// Phase 7 frontend review: defects found in the track's session and browser-storage work, each pinned here.
//  1. A transient refresh failure (429 refresh rate limit — an office behind one NAT —, 409 refresh-token lock timeout, 5xx, network)
//     signed the ERP user out: the client treated every 4xx as a dead session and then cleared the session on the request's 401.
//     A refresh may also return another user's token (signed out and in as someone else in another tab, the cookie is shared): the
//     pending call must not be re-sent as that user.
//  2. Per-user data stayed in localStorage across users of one browser: the command palette kept customer / booking search hits (names,
//     phones) forever, and the booking wizard's local draft was offered to whoever signed in next (audit v3 D1, SPEC project scope).
//  3. The booking detail kept the ledger / demands / payments tab state and its previous page when the URL moved to another booking,
//     so booking B briefly showed booking A's rows and dues (and A's epoch / page were requested for B).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, isDeadRefreshStatus, onAuthEvent, tokenSubject, tokens } from "@/lib/api";
import { restoreRetryDelay, RESTORE_RETRY_DELAYS_MS } from "@/lib/auth";
import {
  BROWSER_DATA_OWNER_KEY,
  claimBrowserData,
  forgetBrowserData,
  isPersistableRecent,
  LOCAL_DRAFT_KEY,
  RECENT_COMMANDS_KEY,
} from "@/lib/browserData";
import { storedRecents } from "@/components/ui/command-palette";
import { bookingKeys, previousPageOfSameBooking } from "@/features/bookings/api";
import { ApiClientError } from "@/lib/api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

describe("refresh failures: only a dead session signs out", () => {
  const fetchMock = vi.fn<typeof fetch>();
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", fetchMock);
    tokens.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    tokens.clear();
  });

  it("classifies refresh statuses", () => {
    for (const dead of [400, 401, 403, 404]) expect(isDeadRefreshStatus(dead)).toBe(true);
    for (const transient of [0, 200, 408, 409, 425, 429, 500, 502, 503, 504])
      expect(isDeadRefreshStatus(transient)).toBe(false);
  });

  it.each([
    [429, "RATE_LIMITED", { "Retry-After": "12" }],
    [409, "LOCK_TIMEOUT", {}],
    [503, "SERVICE_UNAVAILABLE", { "Retry-After": "5" }],
  ] as const)("a %s from /auth/refresh keeps the session and surfaces the error", async (status, code, headers) => {
    tokens.setAccess("expired-access");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockResolvedValueOnce(jsonResponse(status, { error: { code, message: "busy" } }, headers));
    const events: string[] = [];
    const off = onAuthEvent((event) => events.push(event));
    const failure = await api.get("/bookings").catch((error: unknown) => error);
    off();
    expect(failure).toBeInstanceOf(ApiClientError);
    expect((failure as ApiClientError).status).toBe(status);
    expect((failure as ApiClientError).code).toBe(code);
    expect(events).toEqual([]);
    expect(tokens.hasSession()).toBe(true);
    expect(storage.store.get("kkt.erp.session")).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(2); // no retry of the call without a fresh token
  });

  it("a network failure of the refresh keeps the session too", async () => {
    tokens.setAccess("expired-access");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api.get("/bookings")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
    expect(tokens.hasSession()).toBe(true);
  });

  it("on load (hint only) a transient refresh failure is thrown, never followed by a token-less call and a sign-out", async () => {
    storage.store.set("kkt.erp.session", "1");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(503, { error: { code: "SERVICE_UNAVAILABLE", message: "shed" } }, { "Retry-After": "3" }),
    );
    const events: string[] = [];
    const off = onAuthEvent((event) => events.push(event));
    await expect(api.get("/auth/me")).rejects.toMatchObject({ status: 503, retryAfterSeconds: 3 });
    off();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    expect(tokens.hasSession()).toBe(true);
  });

  it("a 401 from the refresh still signs out (dead session)", async () => {
    tokens.setAccess("expired-access");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_REUSED", message: "reused" } }));
    const events: string[] = [];
    const off = onAuthEvent((event) => events.push(event));
    await expect(api.get("/bookings")).rejects.toMatchObject({ status: 401 });
    off();
    expect(events).toContain("unauthenticated");
    expect(tokens.hasSession()).toBe(false);
  });

  it("a refresh that returns ANOTHER user's token (signed in as someone else in another tab) never retries the call as them", async () => {
    const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub, aud: "erp" })).replace(/=+$/, "")}.s`;
    tokens.setAccess(jwt("user-x"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: jwt("user-y"), token_type: "Bearer", expires_in: 900 }));
    const events: string[] = [];
    const off = onAuthEvent((event) => events.push(event));
    await expect(api.post("/payments", { amount_paise: 100 })).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    off();
    expect(fetchMock).toHaveBeenCalledTimes(2); // the payment was NOT re-sent with user Y's token
    expect(events).toEqual(["user-changed"]);
    expect(tokenSubject(tokens.getAccess())).toBe("user-y");
  });

  it("the same user's refresh retries the call as usual", async () => {
    const jwt = (sub: string, n: number) => `h.${btoa(JSON.stringify({ sub, n })).replace(/=+$/, "")}.s`;
    tokens.setAccess(jwt("user-x", 1));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: jwt("user-x", 2), token_type: "Bearer", expires_in: 900 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await expect(api.get("/bookings")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("session restore on load backs off (Retry-After first, capped) instead of showing a shell without a user", () => {
    const shed = new ApiClientError({ status: 503, code: "SERVICE_UNAVAILABLE", message: "x", retryAfterSeconds: 7 });
    expect(restoreRetryDelay(0, shed)).toBe(7_000);
    expect(
      restoreRetryDelay(
        0,
        new ApiClientError({ status: 429, code: "RATE_LIMITED", message: "x", retryAfterSeconds: 600 }),
      ),
    ).toBe(30_000);
    expect(restoreRetryDelay(0, new Error("offline"))).toBe(RESTORE_RETRY_DELAYS_MS[0]);
    expect(restoreRetryDelay(99, new Error("offline"))).toBe(RESTORE_RETRY_DELAYS_MS.at(-1));
    expect(RESTORE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30_000);
  });
});

describe("per-user browser data (audit v3 D1)", () => {
  it("removes the draft and recents another user left, then records the new owner", () => {
    const storage = memoryStorage({
      [BROWSER_DATA_OWNER_KEY]: "user-a",
      [LOCAL_DRAFT_KEY]: JSON.stringify({ id: "d1", step: 2, payload: { customer_id: "c1" } }),
      [RECENT_COMMANDS_KEY]: JSON.stringify([{ id: "customer:c1", label: "Ravi Kumar", description: "98765 43210" }]),
    });
    expect(claimBrowserData("user-b", storage)).toBe(true);
    expect(storage.store.has(LOCAL_DRAFT_KEY)).toBe(false);
    expect(storage.store.has(RECENT_COMMANDS_KEY)).toBe(false);
    expect(storage.store.get(BROWSER_DATA_OWNER_KEY)).toBe("user-b");
  });

  it("keeps the same user's draft (a forced sign-out and sign-in again can still resume it)", () => {
    const draft = JSON.stringify({ id: "d1", step: 2, payload: {} });
    const storage = memoryStorage({ [BROWSER_DATA_OWNER_KEY]: "user-a", [LOCAL_DRAFT_KEY]: draft });
    expect(claimBrowserData("user-a", storage)).toBe(false);
    expect(storage.store.get(LOCAL_DRAFT_KEY)).toBe(draft);
  });

  it("data without a recorded owner (an older build) is not handed to whoever signs in", () => {
    const storage = memoryStorage({ [LOCAL_DRAFT_KEY]: "{}", "kkt.erp.sidebar": "true" });
    claimBrowserData("user-b", storage);
    expect(storage.store.has(LOCAL_DRAFT_KEY)).toBe(false);
    expect(storage.store.get("kkt.erp.sidebar")).toBe("true"); // layout preferences are not personal data
  });

  it("an explicit sign-out forgets everything user-scoped", () => {
    const storage = memoryStorage({
      [BROWSER_DATA_OWNER_KEY]: "user-a",
      [LOCAL_DRAFT_KEY]: "{}",
      [RECENT_COMMANDS_KEY]: "[]",
    });
    forgetBrowserData(storage);
    expect([...storage.store.keys()]).toEqual([]);
  });

  it("the command palette persists navigation recents only and purges stored search hits", () => {
    const raw = [
      { id: "nav:bookings", label: "Bookings", href: "/bookings" },
      { id: "customer:c1", label: "Ravi Kumar", description: "98765 43210", href: "/customers/c1" },
      { id: "booking:b1", label: "KKT/24-25/0001", href: "/bookings/b1" },
      "garbage",
    ];
    expect(storedRecents(raw, isPersistableRecent).map((item) => item.id)).toEqual(["nav:bookings"]);
    expect(storedRecents({ not: "a list" }, isPersistableRecent)).toEqual([]);
  });
});

describe("booking tabs never show another booking's money while loading", () => {
  it("keeps the previous page only for the same booking (ledger, demands, payments keys)", () => {
    const page = { items: [{ seq: 1 }], summary: { total_due_paise: 5_00_000_00 } };
    for (const key of [
      bookingKeys.ledger("booking-a", { page: 2, page_size: 100 }),
      bookingKeys.demandsPage("booking-a", 2, 50),
      bookingKeys.paymentsPage("booking-a", 2, 50),
    ]) {
      expect(previousPageOfSameBooking(page, { queryKey: key }, "booking-a")).toBe(page);
      expect(previousPageOfSameBooking(page, { queryKey: key }, "booking-b")).toBeUndefined();
    }
    expect(previousPageOfSameBooking(page, undefined, "booking-a")).toBeUndefined();
  });

  it("the detail page remounts its paged tabs per booking (page, epoch and page size start over)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../features/bookings/BookingDetailPage.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/<LedgerTab key=\{row\.id\}/);
    expect(src).toMatch(/<DemandsTab key=\{row\.id\}/);
    expect(src).toMatch(/<PaymentsTab\s+key=\{row\.id\}/);
  });
});
