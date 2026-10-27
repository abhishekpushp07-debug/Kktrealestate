/**
 * Audit v3 [C]: the booking ledger showed dues from the last row of a 200-row page and demands/payments were silently capped at
 * 200. These tests use a mocked 450-row ledger: the totals come from the server summary (contract C7), the table pages through
 * every row, older epochs are readable and the rebuild history is linked; demands and payments are fetched page by page.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LedgerResponse, LedgerRow } from "@kkt/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetchAllPages, tokens } from "@/lib/api";
import { LEDGER_PAGE_SIZE, bookingKeys, fetchBookingLedger } from "../api";
import { ledgerFooterTotals } from "../bookingMath";
import { LedgerTab } from "../detail/LedgerTab";

const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const TOTAL_ROWS = 450;

function ledgerRow(seq: number, epoch = 1): LedgerRow {
  // Running dues on the rows go up with seq, so the last row of page 1 (seq 100) is far from the booking's real balance.
  return {
    id: `00000000-0000-4000-8000-${String(seq + epoch * 10_000).padStart(12, "0")}`,
    booking_id: BOOKING,
    seq,
    entry_date: "2026-04-01",
    event: "DEMAND",
    label: `Installment ${seq}`,
    note: null,
    ref_id: null,
    ref_number: null,
    amount_paise: 1_000_00,
    cash_paid_cum_paise: 0,
    account_paid_cum_paise: 0,
    cash_order_raised_paise: seq * 1_000_00,
    account_order_raised_paise: 0,
    cash_due_paise: seq * 1_000_00,
    account_due_paise: 0,
    total_due_paise: seq * 1_000_00,
    other_charges_due_paise: 7_00,
    created_at: "2026-04-01T00:00:00.000Z",
  } as unknown as LedgerRow;
}

const SUMMARY_TOTALS = {
  cash_due_paise: 12_34_567_00,
  account_due_paise: -2_00_000_00,
  total_due_paise: 10_34_567_00,
  other_charges_due_paise: 55_000_00,
  cash_paid_paise: 40_00_000_00,
  account_paid_paise: 60_00_000_00,
};

function ledgerResponse(page: number, pageSize: number, epoch = 2): LedgerResponse {
  const from = (page - 1) * pageSize + 1;
  const items = Array.from({ length: Math.max(0, Math.min(pageSize, TOTAL_ROWS - from + 1)) }, (_, i) =>
    ledgerRow(from + i, epoch),
  );
  return {
    items,
    total: TOTAL_ROWS,
    page,
    page_size: pageSize,
    next_cursor: null,
    epoch,
    current_epoch: 2,
    summary: { ...SUMMARY_TOTALS } as unknown as LedgerResponse["summary"],
    epoch_totals:
      epoch === 2
        ? SUMMARY_TOTALS
        : { ...SUMMARY_TOTALS, cash_due_paise: 99_00, total_due_paise: 99_00, other_charges_due_paise: 0 },
  } as LedgerResponse;
}

function renderLedger(seed: LedgerResponse): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(bookingKeys.ledger(BOOKING, { page: 1, page_size: LEDGER_PAGE_SIZE, epoch: null }), seed);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <LedgerTab bookingId={BOOKING} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  tokens.clear();
});

describe("ledger totals come from the server summary (C7)", () => {
  it("uses summary for the current epoch and epoch_totals for an older one, never a row", () => {
    const current = ledgerFooterTotals(ledgerResponse(1, 100, 2));
    expect(current).toMatchObject({ source: "current", epoch: 2, ...SUMMARY_TOTALS });
    const older = ledgerFooterTotals(ledgerResponse(1, 100, 1));
    expect(older).toMatchObject({ source: "epoch", epoch: 1, cash_due_paise: 99_00, total_due_paise: 99_00 });
  });

  it("renders a 450-row ledger page by page with the summary dues, the epoch and the rebuild-history link", () => {
    const html = renderLedger(ledgerResponse(1, LEDGER_PAGE_SIZE));
    const text = textOf(html);
    // the footer shows the summary (₹12,34,567 cash due, ₹2,00,000 account advance), not row 100's ₹1,00,000
    const totals = /data-testid="ledger-totals"[\s\S]*$/.exec(html)?.[0] ?? "";
    expect(textOf(totals)).toContain("Cash due ₹12,34,567");
    expect(textOf(totals)).toContain("Account due ₹2,00,000 (advance)");
    expect(textOf(totals)).toContain("Total due ₹10,34,567");
    expect(textOf(totals)).toContain("Other charges due ₹55,000");
    expect(textOf(totals)).not.toContain("₹1,00,000");
    // explicit pagination over all 450 rows (never a silent cap)
    expect(text).toContain("1–100 of 450");
    expect(text).toContain("Page 1 / 5");
    // epoch and rebuild history
    expect(text).toContain("Epoch 2 (current)");
    expect(html).toContain('data-testid="ledger-rebuilds-open"');
    expect(text).toContain("Rebuild history");
  });

  it("asks the API for one page of one epoch, sorted by seq", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const query = new URL(url, "http://x").searchParams;
        return jsonResponse(
          ledgerResponse(
            Number(query.get("page") ?? 1),
            Number(query.get("page_size")),
            Number(query.get("epoch") ?? 2),
          ),
        );
      }),
    );
    tokens.setAccess("t");
    const data = await fetchBookingLedger(BOOKING, { page: 3, page_size: 200, epoch: 1 });
    const current = await fetchBookingLedger(BOOKING, { page: 1, page_size: 100, epoch: null });
    expect(urls[1]).toMatch(/\/ledger\?page_size=100&sort=seq$/);
    expect(current.epoch).toBe(2);
    expect(data.items).toHaveLength(50); // rows 401–450
    expect(data.items[0]?.seq).toBe(401);
    expect(urls[0]).toMatch(/\/bookings\/[^/]+\/ledger\?page=3&page_size=200&sort=seq&epoch=1$/);
  });
});

describe("fetchAllPages walks every page instead of capping at 200", () => {
  it("reads 450 demands in three pages", async () => {
    const pages: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const query = new URL(url, "http://x").searchParams;
        const page = Number(query.get("page") ?? 1);
        const size = Number(query.get("page_size"));
        pages.push(page);
        const from = (page - 1) * size;
        const items = Array.from({ length: Math.max(0, Math.min(size, TOTAL_ROWS - from)) }, (_, i) => ({
          n: from + i,
        }));
        return jsonResponse({ items, total: TOTAL_ROWS, page, page_size: size, next_cursor: null });
      }),
    );
    tokens.setAccess("t");
    const result = await fetchAllPages<{ n: number }>("/bookings/x/demands", { sort: "demand_date" });
    expect(pages).toEqual([1, 2, 3]);
    expect(result.items).toHaveLength(450);
    expect(result.items.at(-1)?.n).toBe(449);
    expect(result).toMatchObject({ total: 450, truncated: false });
  });

  it("stops at the row ceiling and says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const query = new URL(url, "http://x").searchParams;
        const size = Number(query.get("page_size"));
        return jsonResponse({ items: Array.from({ length: size }, () => ({})), total: 5000, page: 1, page_size: size });
      }),
    );
    tokens.setAccess("t");
    const result = await fetchAllPages("/payments", {}, { maxRows: 400 });
    expect(result).toMatchObject({ total: 5000, truncated: true });
    expect(result.items).toHaveLength(400);
  });
});
