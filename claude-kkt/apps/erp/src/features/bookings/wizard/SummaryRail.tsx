import { ChevronDown, ChevronUp, Cloud, CloudOff, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { SchedulePreviewRequest } from "@kkt/contracts";
import { formatDate, formatINR, formatINRShort, formatPercent, formatRelative } from "@/lib/format";
import { BREAKPOINTS, cn, useMediaQuery } from "@/lib/utils";
import { useFlatDetail } from "@/features/inventory/api";
import { useApplicablePlans, useAvailableParking, useCustomerById, useSchedulePreview } from "../api";
import { otherChargesTotal, splitPercents, type WizardState } from "../bookingMath";
import { SummaryLine } from "../components";
import type { DraftStatus } from "./useBookingDraft";

export interface SummaryRailProps {
  state: WizardState;
  draftStatus: DraftStatus;
  lastSavedAt: string | null;
  className?: string;
}

function DraftIndicator({ status, lastSavedAt }: { status: DraftStatus; lastSavedAt: string | null }) {
  if (status === "idle") return null;
  const Icon = status === "saving" ? Loader2 : status === "error" ? CloudOff : Cloud;
  const text =
    status === "saving"
      ? "Saving draft…"
      : status === "dirty"
        ? "Unsaved changes"
        : status === "error"
          ? "Saved on this device only"
          : lastSavedAt
            ? `Draft saved ${formatRelative(lastSavedAt)}`
            : "Draft saved";
  return (
    <p
      className={cn("flex items-center gap-1.5 text-2xs", status === "error" ? "text-warning-fg" : "text-ink-subtle")}
      aria-live="polite"
      data-testid="draft-status"
    >
      <Icon className={cn("size-3", status === "saving" && "animate-spin")} aria-hidden="true" />
      {text}
    </p>
  );
}

/** Live totals: agreement, split, charges, parking, first installment. Sticky rail on desktop, bottom sheet on phones. */
export function SummaryRail({ state, draftStatus, lastSavedAt, className }: SummaryRailProps) {
  const isCompact = useMediaQuery(BREAKPOINTS.compact);
  const [open, setOpen] = useState(false);
  const flat = useFlatDetail(state.flat_id);
  const customer = useCustomerById(state.customer_id);
  const plans = useApplicablePlans(state.project_id, state.block_id, state.booking_date);
  const parking = useAvailableParking(state.project_id);
  const previewRequest = useMemo<SchedulePreviewRequest | null>(
    () =>
      state.payment_plan_id && state.block_id && state.cash_agreed_paise !== null && state.account_agreed_paise !== null
        ? {
            plan_id: state.payment_plan_id,
            block_id: state.block_id,
            booking_date: state.booking_date,
            cash_agreed_paise: state.cash_agreed_paise,
            account_agreed_paise: state.account_agreed_paise,
          }
        : null,
    [state.payment_plan_id, state.block_id, state.booking_date, state.cash_agreed_paise, state.account_agreed_paise],
  );
  const preview = useSchedulePreview(previewRequest);

  const total = state.agreement_value_paise ?? 0;
  const percents = splitPercents(total, {
    cash_paise: state.cash_agreed_paise ?? 0,
    account_paise: state.account_agreed_paise ?? 0,
  });
  const charges = otherChargesTotal(state.other_charges);
  const parkingTotal = (parking.data ?? [])
    .filter((slot) => state.parking_slot_ids.includes(slot.id))
    .reduce((sum, slot) => sum + slot.price_paise, 0);
  const plan = plans.data?.find((row) => row.plan_id === state.payment_plan_id) ?? null;
  const first = preview.data?.rows[0] ?? null;
  const dueNow = preview.data
    ? preview.data.rows.filter((row) => row.already_satisfied).reduce((sum, row) => sum + row.total_paise, 0)
    : 0;
  const grand = total + charges.total_paise + parkingTotal;

  const body = (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="label-caps">Booking</p>
        <p className="truncate text-sm font-semibold text-navy-950">
          {flat.data ? `${flat.data.block_name} · Flat ${flat.data.flat_number}` : "Pick a flat"}
        </p>
        <p className="truncate text-xs text-ink-muted">{customer.data ? customer.data.full_name : "Pick a customer"}</p>
        <p className="money text-2xs text-ink-subtle">{formatDate(state.booking_date)}</p>
      </div>
      <div className="divide-y divide-border rounded-md border border-border bg-surface/60 px-3">
        <SummaryLine label="Agreement" value={formatINR(state.agreement_value_paise)} strong />
        <SummaryLine
          label={`Cash ${total ? formatPercent(percents.cash, 1) : ""}`}
          value={formatINR(state.cash_agreed_paise)}
          tone="muted"
        />
        <SummaryLine
          label={`Account ${total ? formatPercent(percents.account, 1) : ""}`}
          value={formatINR(state.account_agreed_paise)}
          tone="muted"
        />
        <SummaryLine
          label={`Other charges${charges.gst_paise ? " (incl. GST)" : ""}`}
          value={formatINR(charges.total_paise)}
        />
        <SummaryLine
          label={`Parking${state.parking_slot_ids.length ? ` ×${state.parking_slot_ids.length}` : ""}`}
          value={formatINR(parkingTotal)}
        />
        <SummaryLine label="Total consideration" value={formatINR(grand)} strong />
      </div>
      <div className="space-y-0.5">
        <p className="label-caps">Plan</p>
        <p className="text-sm font-semibold text-navy-950">{plan ? plan.name : "—"}</p>
        {first && (
          <p className="text-xs text-ink-muted">
            First installment <span className="money font-semibold text-ink">{formatINR(first.total_paise)}</span> ·{" "}
            {first.trigger_label}
          </p>
        )}
        {dueNow > 0 && (
          <p className="text-xs text-gold-text">
            Demanded on confirm: <span className="money font-semibold">{formatINR(dueNow)}</span>
          </p>
        )}
      </div>
      <DraftIndicator status={draftStatus} lastSavedAt={lastSavedAt} />
    </div>
  );

  if (isCompact) {
    return (
      <div
        className={cn("fixed inset-x-0 bottom-[3.75rem] z-30 border-t border-border bg-card shadow-pop", className)}
        data-testid="summary-sheet"
      >
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left focus-ring"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="wizard-summary-sheet"
        >
          <span className="min-w-0">
            <span className="label-caps block">Total consideration</span>
            <span className="money block font-display text-lg font-extrabold text-navy-950">
              {formatINRShort(grand)}
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs text-ink-muted">
            {first && <span className="money hidden sm:inline">1st {formatINRShort(first.total_paise)}</span>}
            {open ? (
              <ChevronDown className="size-4" aria-hidden="true" />
            ) : (
              <ChevronUp className="size-4" aria-hidden="true" />
            )}
          </span>
        </button>
        {open && (
          <div
            id="wizard-summary-sheet"
            className="max-h-[50dvh] overflow-y-auto border-t border-border px-4 pb-4 pt-3 scrollbar-thin"
          >
            {body}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside
      className={cn("sticky top-20 h-fit rounded-lg border border-border bg-card p-4 shadow-card", className)}
      aria-label="Booking summary"
      data-testid="summary-rail"
    >
      {body}
    </aside>
  );
}
