import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Pagination } from "@/components/ui/pagination";
import { slaLabel, slaState } from "@/features/service/sla";
import { describeError, parseErrorEnvelope, totalIsEstimate } from "@/lib/api";

/** Phase 7 integration (docs/hardening/phase7-integrate.md): the ERP side of the API shapes the tracks added. */

const describeCode = (status: number, code: string, details?: Record<string, unknown>, message = "server text") =>
  describeError(parseErrorEnvelope(status, { error: { code, message, ...(details ? { details } : {}) } }));

describe("new error codes read as plain language with their details", () => {
  it("BOOKING_CLOSED lists the closed bookings and their demands (stage undo, money track)", () => {
    const text = describeCode(409, "BOOKING_CLOSED", {
      bookings: [{ booking_id: "b1", booking_number: "SGH/BK/0001", status: "COMPLETED", demand_numbers: ["DM/0007"] }],
    });
    expect(text).toContain("SGH/BK/0001 (DM/0007)");
    expect(text).toMatch(/Reopen them first/);
  });

  it("FLAT_HAS_BOOKING_HISTORY lists the flats that must stay (regenerate / structural edit, domain track)", () => {
    const text = describeCode(409, "FLAT_HAS_BOOKING_HISTORY", {
      flats: [{ id: "f1", flat_number: "A-101", floor: 1, position: 1, bookings: 1 }],
    });
    expect(text).toContain("A-101 (floor 1)");
  });

  it("IDEMPOTENT_OUTCOME_UNKNOWN tells the user to refresh, never to resubmit; INVALID_CURSOR restarts paging", () => {
    expect(describeCode(409, "IDEMPOTENT_OUTCOME_UNKNOWN", { action: "LOOKUP_RESOURCE" })).toMatch(
      /Refresh to check.*don't submit it twice/,
    );
    expect(describeCode(400, "INVALID_CURSOR")).toMatch(/first page/);
  });

  it("INVALID_AMOUNT from a rate card names the fix; GONE after a DPDP erasure is not 'update the app'", () => {
    expect(describeCode(422, "INVALID_AMOUNT", { rate_card_id: "rc1" }, "Percent has more than 2 decimals")).toMatch(
      /^Percent has more than 2 decimals\. Fix the rate card's PLC rules/,
    );
    const gone = describeCode(410, "GONE", { original_status: 201 });
    expect(gone).toMatch(/already done/);
    expect(gone).not.toMatch(/update the app/);
  });

  it("IN_USE shows how many records refer to it (capped count shown as n+)", () => {
    expect(describeCode(409, "IN_USE", { usage_count: 10_000 }, "Flat type is in use")).toContain("(10,000+ records");
    expect(describeCode(409, "IN_USE", { usage_count: 3 }, "Flat type is in use")).toContain("(3 records");
  });
});

describe("estimated list totals (platform track: meta.total_is_estimate)", () => {
  it("reads the flag and renders 'about n' with an approximate last page", () => {
    expect(totalIsEstimate({ meta: { total_is_estimate: true } })).toBe(true);
    expect(totalIsEstimate({})).toBe(false);
    expect(totalIsEstimate(undefined)).toBe(false);
    const html = renderToStaticMarkup(
      <Pagination page={1} pageSize={25} total={125_000} totalIsEstimate onPageChange={() => undefined} />,
    );
    expect(html).toContain("about ");
    expect(html).toContain("~");
    const exact = renderToStaticMarkup(
      <Pagination page={1} pageSize={25} total={125} onPageChange={() => undefined} />,
    );
    expect(exact).not.toContain("about");
  });
});

describe("SLA badge while the clock is paused (domain track: sla_paused_at)", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("a paused ticket past its deadline is shown paused, not breached; a running one past it is breached", () => {
    const paused = slaState(
      {
        status: "AWAITING_CUSTOMER",
        sla_due_at: "2026-10-27T10:00:00Z",
        is_sla_breached: false,
        sla_paused_at: "2026-10-27T08:00:00Z",
      },
      now,
    );
    expect(paused).toEqual({ kind: "paused", remainingMs: 2 * 3600_000 });
    expect(slaLabel(paused)).toEqual({ text: "Paused · 2 h left", tone: "neutral" });
    const running = slaState(
      { status: "IN_PROGRESS", sla_due_at: "2026-10-27T10:00:00Z", is_sla_breached: false, sla_paused_at: null },
      now,
    );
    expect(running.kind).toBe("breached");
  });
});
