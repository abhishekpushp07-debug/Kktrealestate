import { afterEach, describe, expect, it, vi } from "vitest";

import { openSlotsByDate } from "@/components/visit/RescheduleVisit";
import { ApiError, friendlyErrorMessage, publicClient } from "@/lib/api";

describe("visit self-reschedule (security track: POST /public/site-visits/:token/reschedule)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers only open slots and never the visit's own current slot", () => {
    const days = [
      {
        date: "2026-10-27",
        slots: [
          { start: "10:00", end: "11:00", capacity: 4, available: 2 },
          { start: "11:00", end: "12:00", capacity: 4, available: 0 },
        ],
      },
      { date: "2026-10-28", slots: [{ start: "10:00", end: "11:00", capacity: 4, available: 3 }] },
    ];
    const open = openSlotsByDate(days as never, { date: "2026-10-27", start: "10:00" });
    expect(open.get("2026-10-27")).toEqual([]);
    expect(open.get("2026-10-28")?.map((slot) => slot.start)).toEqual(["10:00"]);
  });

  it("posts {date, start, website} to the token's reschedule route with an idempotency key", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ visit_number: "SV-1", manage_token: "new-token", manage_url: "https://x/visit/new-token" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await publicClient("http://api.test").rescheduleSiteVisit("old token", {
      date: "2026-10-28",
      start: "10:00",
      website: "",
    });
    expect(result.manage_token).toBe("new-token");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/public/site-visits/old%20token/reschedule");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ date: "2026-10-28", start: "10:00", website: "" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
  });

  it("explains expired links, invalid slots and retired routes", () => {
    expect(friendlyErrorMessage(new ApiError({ status: 410, code: "LINK_EXPIRED", message: "x" }))).toMatch(/expired/);
    expect(friendlyErrorMessage(new ApiError({ status: 422, code: "SLOT_INVALID", message: "x" }))).toMatch(/not open/);
    expect(friendlyErrorMessage(new ApiError({ status: 409, code: "SLOT_FULL", message: "x" }))).toMatch(/filled up/);
    expect(friendlyErrorMessage(new ApiError({ status: 410, code: "GONE", message: "Retired." }))).toBe("Retired.");
  });
});
