// Audit v3 C in the portal: long ledgers / receipt and demand lists are read page by page, and the dues come from the server summary
// or the last row of the COMPLETE ledger — never from the last row of a 200-row page.
import { describe, expect, it } from "vitest";
import { fetchAllPages, ledgerTotals, MAX_LIST_ROWS } from "@/api/paging";

interface Row {
  seq: number;
  cash_paid_paise: number;
  account_paid_paise: number;
  cash_due_paise: number;
  account_due_paise: number;
  total_due_paise: number;
}

const row = (seq: number): Row => ({
  seq,
  cash_paid_paise: seq * 100,
  account_paid_paise: seq * 10,
  cash_due_paise: 1000 - seq,
  account_due_paise: 500 - seq,
  total_due_paise: 1500 - 2 * seq,
});

function server(total: number) {
  const all = Array.from({ length: total }, (_, i) => row(i + 1));
  const calls: Array<[number, number]> = [];
  const load = async (page: number, pageSize: number) => {
    calls.push([page, pageSize]);
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total, page, page_size: pageSize };
  };
  return { load, calls };
}

describe("fetchAllPages", () => {
  it("reads a 450-row ledger in three pages of 200", async () => {
    const { load, calls } = server(450);
    const out = await fetchAllPages(load);
    expect(calls).toEqual([
      [1, 200],
      [2, 200],
      [3, 200],
    ]);
    expect(out.items).toHaveLength(450);
    expect(out.total).toBe(450);
    expect(out.items.at(-1)?.seq).toBe(450);
  });

  it("stops on an empty page and at the row ceiling", async () => {
    let n = 0;
    const lying = async (page: number, pageSize: number) => {
      n += 1;
      return { items: page === 1 ? [row(1)] : [], total: 99, page, page_size: pageSize };
    };
    expect((await fetchAllPages(lying)).items).toHaveLength(1);
    expect(n).toBe(2);
    const huge = server(MAX_LIST_ROWS + 500);
    expect((await fetchAllPages(huge.load, 1000)).items).toHaveLength(MAX_LIST_ROWS);
  });
});

describe("ledgerTotals", () => {
  it("uses the server summary when the response carries one", () => {
    const summary = {
      cash_paid_paise: 1,
      account_paid_paise: 2,
      cash_due_paise: 3,
      account_due_paise: 4,
      total_due_paise: 7,
      other_charges_due_paise: 0,
    };
    expect(ledgerTotals({ items: [row(1)], summary })).toBe(summary);
  });

  it("otherwise the last row of the complete ledger (not of the first page)", async () => {
    const { load } = server(450);
    const ledger = await fetchAllPages(load);
    expect(ledgerTotals(ledger)?.total_due_paise).toBe(1500 - 900);
    expect(ledgerTotals({ items: [] })).toBeNull();
  });
});
