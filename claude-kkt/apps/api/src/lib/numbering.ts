import { nextSequence, type Executor, type Numbering } from "@kkt/db";
import { DEFAULT_NUMBER_PATTERN, financialYear, formatNumber } from "@kkt/domain";

/** Numbering scopes with their own per-FY sequence. */
export type NumberingScope = keyof Numbering;

/** What nextNumber needs from the company row. */
export interface NumberingCompany {
  id: string;
  fyStartMonth: number;
  numbering: Numbering;
}

const FALLBACK_PREFIX: Record<NumberingScope, string> = { customer: "CUST-", booking: "BK-", demand: "DM-", receipt: "RCPT/", ticket: "SR-", visit: "SV-" };

/**
 * Atomically allocates the next document number for a scope within the financial year of `businessDate`,
 * e.g. CUST-2526/0001, BK-2526/0001, SGB/2526/0001 (pattern per company numbering settings, default `{prefix}{fy}/{seq:4}`).
 */
export async function nextNumber(tx: Executor, company: NumberingCompany, scope: NumberingScope, businessDate: string): Promise<string> {
  const fy = financialYear(businessDate, company.fyStartMonth);
  const cfg = company.numbering[scope] ?? { prefix: FALLBACK_PREFIX[scope] };
  const seq = await nextSequence(tx, company.id, scope, fy.label);
  return formatNumber(cfg.prefix ?? FALLBACK_PREFIX[scope], fy.label, seq, cfg.format ?? DEFAULT_NUMBER_PATTERN);
}
