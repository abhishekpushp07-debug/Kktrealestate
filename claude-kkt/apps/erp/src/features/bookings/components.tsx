import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BOOKING_STATUS_LABELS, PAYMENT_BUCKET_LABELS, type BookingRow, type BucketSummary, type PaymentBucket } from "@kkt/contracts";
import { Badge, StatusChip } from "@/components/ui";
import { formatDate, formatINR, formatINRShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DUE_TONE_CLASS, dueTone } from "./bookingMath";

/* ------------------------------------------------------------------ */
/* Money                                                                */
/* ------------------------------------------------------------------ */

export interface DueAmountProps {
  paise: number | null | undefined;
  /** Short form (₹4.2 L) instead of full grouping. */
  short?: boolean;
  /** Append "(advance)" when negative (default true). */
  advanceLabel?: boolean;
  className?: string;
}

/** Signed due figure: advances green with "(advance)", dues red, zero plain. */
export function DueAmount({ paise, short = false, advanceLabel = true, className }: DueAmountProps) {
  const tone = dueTone(paise);
  const abs = paise === null || paise === undefined ? null : Math.abs(paise);
  const text = short ? formatINRShort(abs) : formatINR(abs);
  return (
    <span className={cn("money font-semibold", DUE_TONE_CLASS[tone], className)} data-tone={tone}>
      {text}
      {tone === "advance" && advanceLabel && <span className="ml-1 text-2xs font-medium">(advance)</span>}
    </span>
  );
}

/** Plain money, right aligned with tabular figures. */
export function Money({ paise, short = false, className }: { paise: number | null | undefined; short?: boolean; className?: string }) {
  return <span className={cn("money", className)}>{short ? formatINRShort(paise) : formatINR(paise)}</span>;
}

/* ------------------------------------------------------------------ */
/* Bucket card (Overview)                                               */
/* ------------------------------------------------------------------ */

export interface BucketCardProps {
  bucket: PaymentBucket | "TOTAL" | "OTHER";
  title?: string;
  summary: BucketSummary;
  icon?: LucideIcon;
  className?: string;
}

/** Agreed / raised / paid / due for one bucket with a raised-vs-paid bar. */
export function BucketCard({ bucket, title, summary, icon: Icon, className }: BucketCardProps) {
  const label = title ?? (bucket === "TOTAL" ? "Total" : bucket === "OTHER" ? "Other charges" : `${PAYMENT_BUCKET_LABELS[bucket]} bucket`);
  const raisedPct = summary.agreed_paise > 0 ? Math.min(100, (summary.order_raised_paise / summary.agreed_paise) * 100) : 0;
  const paidPct = summary.agreed_paise > 0 ? Math.min(100, (summary.paid_paise / summary.agreed_paise) * 100) : 0;
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-card", className)} data-testid={`bucket-card-${bucket.toLowerCase()}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="label-caps">{label}</span>
        {Icon && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-navy-50 text-navy-700">
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div className="min-w-0">
          <dt className="text-2xs text-ink-subtle">Agreed</dt>
          <dd className="money font-semibold text-navy-950">{formatINR(summary.agreed_paise)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-ink-subtle">Raised</dt>
          <dd className="money font-semibold text-ink">{formatINR(summary.order_raised_paise)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-ink-subtle">Paid (cleared)</dt>
          <dd className="money font-semibold text-success-fg">{formatINR(summary.paid_paise)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-ink-subtle">Due</dt>
          <dd>
            <DueAmount paise={summary.due_paise} />
          </dd>
        </div>
      </dl>
      <div className="space-y-1">
        <div className="relative h-2 overflow-hidden rounded-full bg-navy-50" role="img" aria-label={`Raised ${formatPercent(raisedPct, 0)}, paid ${formatPercent(paidPct, 0)} of agreed`}>
          <span className="absolute inset-y-0 left-0 rounded-full bg-navy-200" style={{ width: `${raisedPct}%` }} aria-hidden="true" />
          <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${paidPct}%` }} aria-hidden="true" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-2xs text-ink-subtle">
          <span>
            Raised <span className="money font-medium text-ink">{formatPercent(raisedPct, 1)}</span>
          </span>
          <span>
            Paid <span className="money font-medium text-ink">{formatPercent(paidPct, 1)}</span>
          </span>
          {summary.pending_paise > 0 && (
            <span>
              Cheques in hand <span className="money font-medium text-warning-fg">{formatINRShort(summary.pending_paise)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Booking references                                                   */
/* ------------------------------------------------------------------ */

export function BookingLink({ id, number, className, children }: { id: string; number: string; className?: string; children?: ReactNode }) {
  return (
    <Link to={`/bookings/${id}`} className={cn("money font-semibold text-navy-800 hover:text-navy-950 hover:underline focus-ring rounded-xs", className)} onClick={(event) => event.stopPropagation()}>
      {children ?? number}
    </Link>
  );
}

/** "Project · Tower · Flat" in one line. */
export function UnitLabel({ project, block, flat, className }: { project: string; block: string; flat: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1 text-sm", className)}>
      <span className="truncate text-ink-muted">{project}</span>
      <span className="text-ink-subtle">·</span>
      <span className="truncate text-ink-muted">{block}</span>
      <span className="text-ink-subtle">·</span>
      <span className="money font-semibold text-navy-950">{flat}</span>
    </span>
  );
}

/** Booking status chip with the contract label. */
export function BookingStatusChip({ status, size }: { status: BookingRow["status"]; size?: "sm" | "md" }) {
  return <StatusChip status={status} label={BOOKING_STATUS_LABELS[status]} size={size} />;
}

/** Phone card for the bookings list. */
export function BookingMobileCard({ booking }: { booking: BookingRow }) {
  const due = booking.summary.total_due_paise;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <BookingLink id={booking.id} number={booking.booking_number} />
          <p className="truncate text-sm font-medium text-ink">{booking.customer_name}</p>
        </div>
        <BookingStatusChip status={booking.status} size="sm" />
      </div>
      <UnitLabel project={booking.project_name} block={booking.block_name} flat={booking.flat_number} />
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-ink-subtle">Agreement</dt>
          <dd className="money font-semibold">{formatINRShort(booking.agreement_value_paise)}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Paid</dt>
          <dd className="money font-semibold text-success-fg">{formatINRShort(booking.summary.total_paid_paise)}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Due</dt>
          <dd>
            <DueAmount paise={due} short />
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-subtle">
        <Badge variant="outline">{booking.plan_snapshot.name}</Badge>
        <span>{formatDate(booking.booking_date)}</span>
        {booking.summary.pending_cheques_paise > 0 && <Badge variant="warning">Cheques in hand</Badge>}
      </div>
    </div>
  );
}

/** Small "label: value" pill list for review / summary rails. */
export function SummaryLine({ label, value, strong = false, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: "default" | "muted" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className={cn("shrink-0", tone === "muted" ? "text-ink-subtle" : "text-ink-muted")}>{label}</span>
      <span className={cn("money min-w-0 truncate text-right", strong ? "font-bold text-navy-950" : "font-medium text-ink")}>{value}</span>
    </div>
  );
}
