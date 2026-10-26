import type { HTMLAttributes } from "react";
import { cn, humanize } from "@/lib/utils";

export type StatusTone = "available" | "hold" | "booked" | "sold" | "blocked" | "success" | "warning" | "danger" | "info" | "neutral" | "navy" | "gold";

const TONE_CLASS: Readonly<Record<StatusTone, { chip: string; dot: string }>> = {
  available: { chip: "border-status-available-border bg-status-available-bg text-status-available-fg", dot: "bg-status-available" },
  hold: { chip: "border-status-hold-border bg-status-hold-bg text-status-hold-fg", dot: "bg-status-hold" },
  booked: { chip: "border-status-booked-border bg-status-booked-bg text-status-booked-fg", dot: "bg-gold" },
  sold: { chip: "border-status-sold-border bg-status-sold-bg text-status-sold-fg", dot: "bg-status-sold" },
  blocked: { chip: "border-status-blocked-border bg-status-blocked-bg text-status-blocked-fg", dot: "bg-status-blocked" },
  success: { chip: "border-status-available-border bg-success-bg text-success-fg", dot: "bg-success" },
  warning: { chip: "border-status-hold-border bg-warning-bg text-warning-fg", dot: "bg-warning" },
  danger: { chip: "border-danger/30 bg-danger-bg text-danger-fg", dot: "bg-danger" },
  info: { chip: "border-info/30 bg-info-bg text-info-fg", dot: "bg-info" },
  neutral: { chip: "border-border bg-surface text-ink-muted", dot: "bg-status-blocked" },
  navy: { chip: "border-navy-800 bg-navy-900 text-white", dot: "bg-gold" },
  gold: { chip: "border-gold-border bg-gold-light text-gold-text", dot: "bg-gold" },
};

/** Status enum (any module) → tone. Unknown statuses fall back to neutral. */
export const STATUS_TONES: Readonly<Record<string, StatusTone>> = {
  // flats / parking
  AVAILABLE: "available",
  HOLD: "hold",
  BOOKED: "booked",
  SOLD: "sold",
  BLOCKED: "blocked",
  ALLOTTED: "booked",
  // bookings
  ACTIVE: "success",
  CANCELLED: "danger",
  COMPLETED: "navy",
  // payments
  PENDING: "warning",
  CLEARED: "success",
  BOUNCED: "danger",
  REVERSED: "neutral",
  // demands / schedule
  OPEN: "warning",
  PARTIALLY_PAID: "info",
  PAID: "success",
  VOID: "neutral",
  NOT_YET_DUE: "neutral",
  RAISED: "info",
  OVERDUE: "danger",
  // construction stages
  IN_PROGRESS: "warning",
  // leads
  NEW: "info",
  CONTACTED: "info",
  SITE_VISIT_SCHEDULED: "warning",
  SITE_VISIT_DONE: "navy",
  NEGOTIATION: "gold",
  CONVERTED: "success",
  LOST: "danger",
  // visits
  CONFIRMED: "info",
  RESCHEDULED: "warning",
  NO_SHOW: "danger",
  // service requests
  AWAITING_CUSTOMER: "gold",
  RESOLVED: "success",
  CLOSED: "neutral",
  // kyc
  SUBMITTED: "info",
  VERIFIED: "success",
  REJECTED: "danger",
  // projects / rate cards / posts
  PLANNING: "neutral",
  UNDER_CONSTRUCTION: "warning",
  READY: "success",
  DRAFT: "neutral",
  SUPERSEDED: "neutral",
  PUBLISHED: "success",
  // misc
  INACTIVE: "blocked",
  ENABLED: "success",
  DISABLED: "blocked",
  OK: "success",
  FAILED: "danger",
  RUNNING: "info",
  // exports / backups
  QUEUED: "warning",
  DONE: "success",
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",
};

const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  NEFT_RTGS: "NEFT/RTGS",
  UPI: "UPI",
  DD: "DD",
  OK: "OK",
  NO_SHOW: "No-show",
  KYC_PENDING: "KYC pending",
};

export function statusLabel(status: string): string {
  return LABEL_OVERRIDES[status] ?? humanize(status);
}

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  status: string;
  /** Override the derived label. */
  label?: string;
  /** Override the derived tone. */
  tone?: StatusTone;
  size?: "sm" | "md";
  dot?: boolean;
}

/** Coloured chip with a dot and label for any status enum value. */
export function StatusChip({ status, label, tone, size = "md", dot = true, className, ...props }: StatusChipProps) {
  const key = status.toUpperCase();
  const resolvedTone = tone ?? STATUS_TONES[key] ?? "neutral";
  const classes = TONE_CLASS[resolvedTone];
  return (
    <span
      data-status={key}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold leading-4",
        size === "md" ? "px-2 py-0.5 text-2xs" : "px-1.5 py-px text-[10px]",
        classes.chip,
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", classes.dot)} aria-hidden="true" />}
      <span className="truncate">{label ?? statusLabel(status)}</span>
    </span>
  );
}
