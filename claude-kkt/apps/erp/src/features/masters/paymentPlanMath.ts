/**
 * Percent arithmetic for payment plans. Percents have ≤ 2 decimals, so everything is done in
 * integer basis points (1 bp = 0.01 %) to avoid float drift: 33.33 + 33.33 + 33.34 === 100.00.
 */

export interface PercentLike {
  percent: number | null | undefined;
}

/** 12.5 → 1250 (invalid / empty → 0). */
export function toBasisPoints(percent: number | null | undefined): number {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 0;
  return Math.round(percent * 100);
}

/** 1250 → 12.5 */
export function fromBasisPoints(bp: number): number {
  return bp / 100;
}

/** Sum of installment percents in basis points. */
export function sumPercentBasisPoints(installments: readonly PercentLike[]): number {
  return installments.reduce((total, item) => total + toBasisPoints(item.percent), 0);
}

export interface PercentSum {
  /** Sum as a percent number (two decimals). */
  total: number;
  /** 100 − total (negative when over). */
  remaining: number;
  /** Exactly 100.00. */
  complete: boolean;
  over: boolean;
  /** "100.00" style strings for the footer. */
  totalText: string;
  remainingText: string;
}

/** Live footer state for the installments repeater. */
export function percentSum(installments: readonly PercentLike[]): PercentSum {
  const bp = sumPercentBasisPoints(installments);
  const remainingBp = 10_000 - bp;
  return {
    total: fromBasisPoints(bp),
    remaining: fromBasisPoints(remainingBp),
    complete: bp === 10_000,
    over: bp > 10_000,
    totalText: fromBasisPoints(bp).toFixed(2),
    remainingText: fromBasisPoints(Math.abs(remainingBp)).toFixed(2),
  };
}

/** percent of an integer-paise bucket, rounded to the paisa. */
export function shareOfPaise(bucketPaise: number, percent: number | null | undefined): number {
  return Math.round((bucketPaise * toBasisPoints(percent)) / 10_000);
}

export interface SchedulePreviewInput {
  seq: number;
  name: string;
  percent: number | null | undefined;
}

export interface SchedulePreviewRow {
  seq: number;
  name: string;
  percent: number;
  cumulative_percent: number;
  cash_paise: number;
  account_paise: number;
  total_paise: number;
}

export interface SchedulePreview {
  rows: SchedulePreviewRow[];
  totals: { cash_paise: number; account_paise: number; total_paise: number };
}

/** Sample booking used by the plan preview: ₹1 Cr agreement split 60 % account / 40 % cash. */
export const SAMPLE_BOOKING = {
  agreement_paise: 1_00_00_000_00,
  account_paise: 60_00_000_00,
  cash_paise: 40_00_000_00,
} as const;

/**
 * Mini schedule for the sample booking. Every installment takes `percent` of each bucket; when the
 * percents sum to exactly 100 the last installment absorbs rounding so the totals match the buckets.
 */
export function buildSchedulePreview(
  installments: readonly SchedulePreviewInput[],
  buckets: { cash_paise: number; account_paise: number } = SAMPLE_BOOKING,
): SchedulePreview {
  const ordered = [...installments].sort((a, b) => a.seq - b.seq);
  const complete = sumPercentBasisPoints(ordered) === 10_000;
  let cumulativeBp = 0;
  let cashSoFar = 0;
  let accountSoFar = 0;
  const rows = ordered.map((item, index) => {
    const bp = toBasisPoints(item.percent);
    cumulativeBp += bp;
    const last = complete && index === ordered.length - 1;
    const cash = last ? buckets.cash_paise - cashSoFar : shareOfPaise(buckets.cash_paise, item.percent);
    const account = last ? buckets.account_paise - accountSoFar : shareOfPaise(buckets.account_paise, item.percent);
    cashSoFar += cash;
    accountSoFar += account;
    return {
      seq: item.seq,
      name: item.name,
      percent: fromBasisPoints(bp),
      cumulative_percent: fromBasisPoints(cumulativeBp),
      cash_paise: cash,
      account_paise: account,
      total_paise: cash + account,
    };
  });
  return {
    rows,
    totals: { cash_paise: cashSoFar, account_paise: accountSoFar, total_paise: cashSoFar + accountSoFar },
  };
}
