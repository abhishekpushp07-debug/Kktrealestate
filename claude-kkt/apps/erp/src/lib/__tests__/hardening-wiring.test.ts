import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  csvExportFacts,
  describeError,
  errorReference,
  exportQueryFromParams,
  parseErrorEnvelope,
  tokens,
} from "@/lib/api";
import { csvCell, toCsv } from "@/lib/csv";
import { FORBIDDEN_REASON_MESSAGES, kycMissingLabels, messageForError, planStageProblems } from "@/lib/errorMessages";

describe("error registry wiring (hardening tracks)", () => {
  it("maps every FORBIDDEN details.reason of the security track to its own sentence", () => {
    for (const reason of [
      "SELF_CHANGE",
      "PERMISSION_ESCALATION",
      "SCOPE_ESCALATION",
      "SUPER_ADMIN_TARGET",
      "SYSTEM_ROLE_SUPER_ADMIN_ONLY",
      "TARGET_OUTRANKS_CALLER",
      "KYC_MAKER_CHECKER",
      "KYC_VERIFIED_LOCKED",
    ]) {
      const error = parseErrorEnvelope(403, {
        error: { code: "FORBIDDEN", message: "Forbidden", details: { reason } },
      });
      expect(describeError(error)).toBe(FORBIDDEN_REASON_MESSAGES[reason]);
    }
    const escalation = parseErrorEnvelope(403, {
      error: {
        code: "FORBIDDEN",
        message: "x",
        details: { reason: "PERMISSION_ESCALATION", missing: ["admin.tools"] },
      },
    });
    expect(describeError(escalation)).toContain("Missing: admin.tools.");
    // no reason → the generic sentence
    expect(describeError(parseErrorEnvelope(403, { error: { code: "FORBIDDEN", message: "x" } }))).toBe(
      "You don't have permission to do that.",
    );
  });

  it("explains KYC, erasure, reversal, version, retry and retired-route codes", () => {
    const incomplete = parseErrorEnvelope(422, {
      error: {
        code: "KYC_INCOMPLETE",
        message: "missing pan, kyc_document",
        details: { missing: ["pan", "kyc_document"] },
      },
    });
    expect(describeError(incomplete)).toBe(
      "KYC can't be submitted yet. Missing: PAN, a KYC document (PAN / Aadhaar copy).",
    );
    expect(kycMissingLabels({ missing: ["aadhaar", "odd_item"] })).toEqual(["Aadhaar", "odd item"]);
    expect(
      describeError(
        parseErrorEnvelope(409, {
          error: { code: "KYC_TRANSITION_INVALID", message: "m", details: { reason: "UNCHANGED_SINCE_REJECTION" } },
        }),
      ),
    ).toMatch(/before resubmitting/);
    expect(describeError(parseErrorEnvelope(409, { error: { code: "HAS_ACTIVE_BOOKING", message: "m" } }))).toMatch(
      /active booking/,
    );
    expect(describeError(parseErrorEnvelope(409, { error: { code: "BOOKING_COMPLETED", message: "m" } }))).toMatch(
      /reopens the booking/,
    );
    expect(describeError(parseErrorEnvelope(400, { error: { code: "VERSION_REQUIRED", message: "m" } }))).toMatch(
      /Reload/,
    );
    expect(describeError(parseErrorEnvelope(409, { error: { code: "LOCK_TIMEOUT", message: "m" } }))).toMatch(/busy/);
    expect(
      describeError(
        parseErrorEnvelope(
          503,
          { error: { code: "SERVICE_UNAVAILABLE", message: "m" } },
          new Headers({ "Retry-After": "5" }),
        ),
      ),
    ).toMatch(/Try again in 5s/);
    expect(
      describeError(
        parseErrorEnvelope(410, {
          error: {
            code: "GONE",
            message: "This operation was retired on 2027-01-01.",
            details: { sunset: "2027-01-01", replacement: "/api/v2/bookings" },
          },
        }),
      ),
    ).toBe("This operation was retired on 2027-01-01. Use /api/v2/bookings instead. Please update the app.");
    expect(describeError(parseErrorEnvelope(429, { error: { code: "RATE_LIMITED", message: "m" } }))).toBe(
      "Too many attempts. Try again in a moment.",
    );
  });

  it("falls back to the server's message for codes it does not know (tolerant registry)", () => {
    const unknown = parseErrorEnvelope(422, { error: { code: "BRAND_NEW_RULE", message: "Server explains it" } });
    expect(messageForError(unknown)).toBeNull();
    expect(describeError(unknown)).toBe("Server explains it");
  });

  it("lists missing stages and stranded bookings of PLAN_STAGES_MISSING", () => {
    const details = {
      missing_stages: [
        { id: "s1", name: "Roof", block_id: "b1", block_name: "Tower A", plan_id: "p1", plan_name: "CLP" },
      ],
      stranded_bookings: [
        {
          booking_id: "k1",
          booking_number: "SGH/0001",
          installment_seq: 4,
          installment_name: "On roof",
          stage_id: "s1",
          stage_name: "Roof",
        },
        {
          booking_id: "k2",
          booking_number: "SGH/0002",
          installment_seq: 9,
          installment_name: "On possession",
          stage_id: null,
          stage_name: null,
        },
      ],
    };
    expect(planStageProblems(details)).toEqual({
      missing: ["Roof (plan CLP · tower Tower A)"],
      stranded: ["SGH/0001: 4. On roof waits on “Roof”", "SGH/0002: 9. On possession waits on possession"],
    });
    const text = describeError(
      parseErrorEnvelope(409, { error: { code: "PLAN_STAGES_MISSING", message: "m", details } }),
    );
    expect(text).toContain("Roof (plan CLP · tower Tower A)");
    expect(text).toContain("SGH/0001: 4. On roof");
  });

  it("carries request and trace ids for support (body first, headers as fallback)", () => {
    const fromBody = parseErrorEnvelope(500, {
      error: { code: "INTERNAL_ERROR", message: "boom", request_id: "req-1", trace_id: "a".repeat(32) },
    });
    expect(fromBody.traceId).toBe("a".repeat(32));
    expect(errorReference(fromBody)).toBe(`Ref req-1 · trace ${"a".repeat(32)}`);
    const fromHeaders = parseErrorEnvelope(
      502,
      "<html>",
      new Headers({ "X-Request-Id": "req-2", "X-Trace-Id": "b".repeat(32) }),
    );
    expect(errorReference(fromHeaders)).toBe(`Ref req-2 · trace ${"b".repeat(32)}`);
    expect(errorReference(new Error("x"))).toBeNull();
  });
});

describe("CSV exports: truncation facts and background export query", () => {
  it("reads X-Export-* headers", () => {
    expect(
      csvExportFacts(
        new Headers({ "X-Export-Total": "12500", "X-Export-Rows": "10000", "X-Export-Truncated": "true" }),
        "a.csv",
      ),
    ).toEqual({ filename: "a.csv", rows: 10000, total: 12500, truncated: true });
    expect(csvExportFacts(new Headers({ "X-Export-Total": "40", "X-Export-Rows": "40" }), "b.csv").truncated).toBe(
      false,
    );
    // headers hidden by CORS → unknown, not truncated
    expect(csvExportFacts(new Headers(), "c.csv")).toEqual({
      filename: "c.csv",
      rows: null,
      total: null,
      truncated: false,
    });
  });

  it("drops paging / format keys the export job controls and stringifies arrays", () => {
    expect(
      exportQueryFromParams({
        page: 3,
        page_size: 50,
        search: " ravi ",
        sort: "-created_at",
        include_inactive: true,
        filters: { status: ["A", "B"], project_id: "p1", empty: "", format: "csv", cursor: "x" },
      }),
    ).toEqual({
      search: "ravi",
      sort: "-created_at",
      include_inactive: true,
      status: ["A", "B"],
      project_id: "p1",
    });
  });

  describe("requests", () => {
    const fetchMock = vi.fn<typeof fetch>();
    beforeEach(() => {
      tokens.clear();
      tokens.setAccess("access");
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
      const anchor = {
        click: vi.fn(),
        remove: vi.fn(),
        set href(_v: string) {},
        set download(_v: string) {},
        set rel(_v: string) {},
      };
      vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: () => undefined } });
      vi.stubGlobal("window", { setTimeout: () => 0 });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      fetchMock.mockReset();
    });

    it("exportCsv asks for the whole filtered list (no page / page_size) and returns the truncation facts", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("a,b\r\n", {
          status: 200,
          headers: {
            "Content-Type": "text/csv",
            "X-Export-Total": "10050",
            "X-Export-Rows": "10000",
            "X-Export-Truncated": "true",
          },
        }),
      );
      const facts = await api.exportCsv("/customers", { page: 2, page_size: 25, search: "x" }, "customers.csv");
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain("/api/v1/customers?");
      expect(url).toContain("format=csv");
      expect(url).not.toContain("page=");
      expect(url).not.toContain("page_size=");
      expect(facts).toEqual({ filename: "customers.csv", rows: 10000, total: 10050, truncated: true });
    });

    it("startExport posts the absolute list path and the filters to POST /exports", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "e1", status: "QUEUED" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await api.startExport("/bookings", { page: 4, sort: "-booking_date", filters: { status: "ACTIVE" } });
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(String(url)).toMatch(/\/api\/v1\/exports$/);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        path: "/api/v1/bookings",
        query: { sort: "-booking_date", status: "ACTIVE" },
      });
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBeTruthy();
    });
  });
});

describe("client CSV (one-time credentials)", () => {
  it("quotes, neutralises formulas and keeps plain numbers", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+91 98")).toBe("'+91 98");
    expect(csvCell("-1250.50")).toBe("-1250.50");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [["1", "@x"]])).toBe("﻿a,b\r\n1,'@x\r\n");
  });
});
