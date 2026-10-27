// Paging helpers of the portal (pure; test/paging.test.ts). Audit v3 C: a 200-row first page silently dropped the rest of a long
// ledger, and the dues shown came from the last row of that page.

/** List envelope as the portal API sends it. */
export interface Envelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** Hard ceiling on rows read by fetchAllPages (a booking ledger has a few hundred rows; this only stops a runaway loop). */
export const MAX_LIST_ROWS = 10_000;

/**
 * Reads every page of a list. The envelope returned carries all rows and the server's total; other top-level fields (e.g. a C7
 * `summary`) come from the first page.
 */
export async function fetchAllPages<E extends Envelope<unknown>>(
  load: (page: number, pageSize: number) => Promise<E>,
  pageSize = 200,
): Promise<E> {
  const first = await load(1, pageSize);
  const items = [...first.items];
  let page = 1;
  while (items.length < first.total && items.length < MAX_LIST_ROWS) {
    page += 1;
    const next = await load(page, pageSize);
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  return { ...first, items, page: 1, page_size: Math.max(items.length, 1) };
}

export interface LedgerTotals {
  cash_paid_paise: number;
  account_paid_paise: number;
  cash_due_paise: number;
  account_due_paise: number;
  total_due_paise: number;
}

const TOTAL_FIELDS = [
  "cash_paid_paise",
  "account_paid_paise",
  "cash_due_paise",
  "account_due_paise",
  "total_due_paise",
] as const;

function isTotals(value: unknown): value is LedgerTotals {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return TOTAL_FIELDS.every((f) => typeof record[f] === "number");
}

/**
 * The dues to show for a ledger: the server's C7 `summary` when the response carries one (the staff ledger does; the portal ledger
 * may), else the running totals after the last row of the COMPLETE ledger (fetchAllPages, seq order). Null for an empty ledger.
 */
export function ledgerTotals(ledger: { items: readonly object[] } & Record<string, unknown>): LedgerTotals | null {
  if (isTotals(ledger.summary)) return ledger.summary;
  const last = ledger.items[ledger.items.length - 1];
  return isTotals(last) ? last : null;
}
