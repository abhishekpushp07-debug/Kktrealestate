import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  api,
  buildListQuery,
  buildQueryString,
  describeError,
  parseErrorEnvelope,
  tokens,
} from "@/lib/api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("parseErrorEnvelope", () => {
  it("parses the standard error envelope into an ApiClientError", () => {
    const headers = new Headers({ "X-Request-Id": "req-1", "Retry-After": "30" });
    const error = parseErrorEnvelope(
      409,
      {
        error: {
          code: "VERSION_CONFLICT",
          message: "Stale version",
          details: { current: 4, changed_by: "Asha" },
          request_id: "req-9",
        },
      },
      headers,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("VERSION_CONFLICT");
    expect(error.message).toBe("Stale version");
    expect(error.details).toEqual({ current: 4, changed_by: "Asha" });
    expect(error.requestId).toBe("req-9");
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.isVersionConflict).toBe(true);
  });

  it("falls back to a status-derived code for non-envelope bodies and exposes validation issues", () => {
    const plain = parseErrorEnvelope(502, "<html>Bad gateway</html>");
    expect(plain.code).toBe("SERVICE_UNAVAILABLE");
    expect(plain.message).toContain("Bad gateway");

    const validation = parseErrorEnvelope(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid body",
        details: { issues: [{ path: "phone", message: "Enter a valid 10-digit Indian mobile number" }] },
      },
    });
    expect(validation.validationIssues).toEqual([
      { path: "phone", message: "Enter a valid 10-digit Indian mobile number" },
    ]);
    expect(describeError(validation)).toBe("phone: Enter a valid 10-digit Indian mobile number");
  });
});

describe("query helpers", () => {
  it("builds list queries, skipping defaults and empty values", () => {
    const query = buildListQuery({
      page: 1,
      page_size: 25,
      search: "  ",
      sort: "-created_at",
      filters: { status: "ACTIVE", project_id: "", ids: ["a", "b"] },
    });
    expect(query).toEqual({ page_size: 25, sort: "-created_at", status: "ACTIVE", ids: ["a", "b"] });
    expect(buildQueryString({ ...query, page: 3 })).toBe(
      "?page_size=25&sort=-created_at&status=ACTIVE&ids=a&ids=b&page=3",
    );
    expect(buildQueryString({})).toBe("");
  });
});

describe("request pipeline", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    tokens.clear();
    tokens.setAccess("expired-access");
    vi.stubGlobal("fetch", fetchMock);
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    tokens.setRefresh("refresh-1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    tokens.clear();
  });

  it("refreshes once on 401 TOKEN_EXPIRED and retries with the same Idempotency-Key", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "fresh-access", refresh_token: "refresh-2" }))
      .mockResolvedValueOnce(jsonResponse(201, { id: "b1", version: 1 }));

    const result = await api.post<{ id: string }>("/bookings", { flat_id: "f1" });
    expect(result.id).toBe("b1");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [retryUrl, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const firstHeaders = new Headers(firstInit.headers);
    const retryHeaders = new Headers(retryInit.headers);

    expect(firstUrl).toBe("/api/v1/bookings");
    expect(refreshUrl).toBe("/api/v1/auth/refresh");
    expect(JSON.parse(String(refreshInit.body))).toEqual({ refresh_token: "refresh-1" });
    expect(retryUrl).toBe("/api/v1/bookings");
    expect(firstHeaders.get("Authorization")).toBe("Bearer expired-access");
    expect(retryHeaders.get("Authorization")).toBe("Bearer fresh-access");
    expect(firstHeaders.get("Idempotency-Key")).toBeTruthy();
    expect(retryHeaders.get("Idempotency-Key")).toBe(firstHeaders.get("Idempotency-Key"));
    expect(tokens.getRefresh()).toBe("refresh-2");
  });

  it("sends If-Match from the version option and throws ApiClientError on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: { code: "VERSION_CONFLICT", message: "Stale", details: { current: 3, changed_by: "Ravi" } },
      }),
    );
    await expect(api.patch("/flats/f1", { status: "HOLD" }, { version: 2 })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("If-Match")).toBe('"2"');
  });
});
