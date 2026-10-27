import {
  PAYMENT_MODE_DEFAULTS,
  type BucketSummary,
  type PaymentBucket,
  type PaymentModeCode,
  type PaymentModeRow,
} from "@kkt/contracts";
import { formatINR } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Mode rules                                                           */
/* ------------------------------------------------------------------ */

export interface ModeRules {
  requiresInstrument: boolean;
  clearsImmediately: boolean;
  isCash: boolean;
  /** Company bank account is required for every non-cash mode (SPEC §11). */
  requiresBankAccount: boolean;
  /** Cheques and DDs carry an instrument date. */
  hasInstrumentDate: boolean;
}

/** Behaviour of a payment mode: the master row wins, the contract defaults fill gaps. */
export function modeRules(
  mode: Pick<PaymentModeRow, "code" | "requires_instrument" | "clears_immediately" | "is_cash"> | null | undefined,
): ModeRules {
  const code: PaymentModeCode | null = mode?.code ?? null;
  const defaults = code ? PAYMENT_MODE_DEFAULTS[code] : null;
  const isCash = mode?.is_cash ?? defaults?.is_cash ?? false;
  return {
    requiresInstrument: mode?.requires_instrument ?? defaults?.requires_instrument ?? false,
    clearsImmediately: mode?.clears_immediately ?? defaults?.clears_immediately ?? true,
    isCash,
    requiresBankAccount: !isCash,
    hasInstrumentDate: code === "CHEQUE" || code === "DD",
  };
}

/* ------------------------------------------------------------------ */
/* Bucket cap (client-side preview of the server rule)                  */
/* ------------------------------------------------------------------ */

export interface BucketMeter {
  bucket: PaymentBucket;
  agreed_paise: number;
  paid_paise: number;
  pending_paise: number;
  remaining_paise: number;
  /** 0–100 share of agreed already received (cleared). */
  paid_percent: number;
}

export function bucketMeter(bucket: PaymentBucket, summary: BucketSummary): BucketMeter {
  const remaining = Math.max(0, summary.agreed_paise - summary.paid_paise);
  return {
    bucket,
    agreed_paise: summary.agreed_paise,
    paid_paise: summary.paid_paise,
    pending_paise: summary.pending_paise,
    remaining_paise: remaining,
    paid_percent:
      summary.agreed_paise > 0 ? Math.min(100, Math.round((summary.paid_paise / summary.agreed_paise) * 1000) / 10) : 0,
  };
}

export interface CapCheck {
  exceeded: boolean;
  /** Amount above the cap (0 when within). */
  excess_paise: number;
  message: string | null;
}

/** SPEC §11 bucket cap: paid + amount must not exceed agreed. Mirrors the server's explanatory wording. */
export function checkBucketCap(
  meter: BucketMeter,
  amountPaise: number | null | undefined,
  bucketLabel: string,
): CapCheck {
  if (amountPaise === null || amountPaise === undefined || amountPaise <= 0)
    return { exceeded: false, excess_paise: 0, message: null };
  const excess = meter.paid_paise + amountPaise - meter.agreed_paise;
  if (excess <= 0) return { exceeded: false, excess_paise: 0, message: null };
  return {
    exceeded: true,
    excess_paise: excess,
    message: `${bucketLabel} agreed ${formatINR(meter.agreed_paise)}; already received ${formatINR(meter.paid_paise)}; cannot accept ${formatINR(amountPaise)} – revise the agreement first.`,
  };
}

/** Other-charge payments cannot exceed the line total. */
export function checkChargeCap(
  totalPaise: number,
  paidPaise: number,
  amountPaise: number | null | undefined,
): CapCheck {
  if (amountPaise === null || amountPaise === undefined || amountPaise <= 0)
    return { exceeded: false, excess_paise: 0, message: null };
  const excess = paidPaise + amountPaise - totalPaise;
  if (excess <= 0) return { exceeded: false, excess_paise: 0, message: null };
  return {
    exceeded: true,
    excess_paise: excess,
    message: `This charge totals ${formatINR(totalPaise)}; ${formatINR(paidPaise)} is already paid, so at most ${formatINR(Math.max(0, totalPaise - paidPaise))} can be accepted.`,
  };
}

/* ------------------------------------------------------------------ */
/* Ageing                                                               */
/* ------------------------------------------------------------------ */

export type AgeingTone = "neutral" | "info" | "warning" | "gold" | "danger";

/** Days overdue → chip tone used by demand lists and dashboards. */
export function ageingTone(daysOverdue: number): AgeingTone {
  if (daysOverdue <= 0) return "neutral";
  if (daysOverdue <= 30) return "info";
  if (daysOverdue <= 60) return "warning";
  if (daysOverdue <= 90) return "gold";
  return "danger";
}

export function ageingLabel(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Not overdue";
  if (daysOverdue === 1) return "1 day overdue";
  return `${daysOverdue} days overdue`;
}

/** Row tint for ageing (table rows, cards). */
export const AGEING_ROW_CLASS: Readonly<Record<AgeingTone, string>> = {
  neutral: "",
  info: "bg-info-bg/40",
  warning: "bg-warning-bg/60",
  gold: "bg-gold-light",
  danger: "bg-danger-bg/70",
};

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

/** Inclusive day difference between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}
