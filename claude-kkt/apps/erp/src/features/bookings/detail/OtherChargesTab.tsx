import { IndianRupee, Plus, Send } from "lucide-react";
import { useState } from "react";
import { CHARGE_DEMAND_AT_LABELS, CHARGE_DEMAND_ATS, type BookingDetailResponse, type ChargeDemandAt, type OtherChargeRow } from "@kkt/contracts";
import { Badge, Button, ConfirmDialog, DateInput, EmptyState, FieldWrapper, FormError, MoneyInput, PercentInput, Select, SimpleDialog } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatINR, formatPercent, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { BOOKINGS_PATH, bookingInvalidations, useChargeTypes } from "../api";
import { chargeLineTotals } from "../bookingMath";
import { DueAmount } from "../components";

export interface OtherChargesTabProps {
  booking: BookingDetailResponse;
  onPostPayment: (line: OtherChargeRow) => void;
}

/** Other-charge lines with demanded / paid figures, "Demand now" for manual lines and an add-line dialog. */
export function OtherChargesTab({ booking, onPostPayment }: OtherChargesTabProps) {
  const { can } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [demandLine, setDemandLine] = useState<OtherChargeRow | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const active = booking.status === "ACTIVE";
  const canEdit = active && can("booking.create");
  const canPay = active && can("payment.post");

  const demandNow = useMutationWithToast<unknown, { line: OtherChargeRow; due_date: string | null }>({
    mutationFn: ({ line, due_date }) => api.post(`${BOOKINGS_PATH}/${booking.id}/other-charges/${line.id}/demand`, { version: booking.version, other_charge_id: line.id, ...(due_date ? { due_date } : {}) }, { version: booking.version }),
    successMessage: (_result, { line }) => `${line.name} demanded`,
    invalidate: bookingInvalidations(booking.id),
    entityLabel: "This booking",
  });

  const lines = booking.other_charges;
  const totals = lines.reduce((sum, line) => ({ total: sum.total + line.total_paise, paid: sum.paid + line.paid_paise, due: sum.due + line.due_paise }), { total: 0, paid: 0, due: 0 });

  return (
    <div className="space-y-3" data-testid="other-charges-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          Registry, maintenance, GST and similar lines live in their own sub-ledger. Total <span className="money font-semibold text-navy-950">{formatINR(totals.total)}</span> · paid <span className="money font-semibold text-success-fg">{formatINR(totals.paid)}</span> · due <DueAmount paise={totals.due} />
        </p>
        {canEdit && (
          <Button size="sm" variant="outline" leftIcon={Plus} onClick={() => setAddOpen(true)} data-testid="charges-add-line">
            Add charge line
          </Button>
        )}
      </div>

      {lines.length === 0 ? (
        <EmptyState compact title="No other charges" description="Add registry, maintenance or other charge lines to raise them now or on possession." action={canEdit ? <Button size="sm" leftIcon={Plus} onClick={() => setAddOpen(true)}>Add charge line</Button> : undefined} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center gap-3 p-3" data-testid={`charge-row-${line.code}`}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {line.name}
                  <Badge variant="outline">{CHARGE_DEMAND_AT_LABELS[line.demand_at]}</Badge>
                  {line.demanded_at ? <Badge variant="info">Demanded {formatDate(line.demanded_at.slice(0, 10))}</Badge> : <Badge variant="neutral">Not demanded</Badge>}
                </p>
                <p className="money text-xs text-ink-muted">
                  {formatINR(line.amount_paise)}
                  {line.gst_percent > 0 ? ` + GST ${formatPercent(line.gst_percent)} (${formatINR(line.gst_paise)})` : ""} = <span className="font-semibold text-ink">{formatINR(line.total_paise)}</span>
                  {line.demand_number ? ` · ${line.demand_number}` : ""}
                  {line.due_date ? ` · due ${formatDate(line.due_date)}` : ""}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 text-right text-xs sm:w-56">
                <dt className="text-ink-subtle">Paid</dt>
                <dd className="money font-semibold text-success-fg">{formatINR(line.paid_paise)}</dd>
                <dt className="text-ink-subtle">Due</dt>
                <dd>
                  <DueAmount paise={line.due_paise} />
                </dd>
              </dl>
              <div className="flex w-full justify-end gap-1 sm:w-auto">
                {canEdit && !line.demanded_at && (
                  <Button size="xs" variant="outline" leftIcon={Send} onClick={() => {
                    setDemandLine(line);
                    setDueDate(null);
                  }} data-testid={`charge-demand-${line.code}`}>
                    Demand now
                  </Button>
                )}
                {canPay && line.due_paise > 0 && (
                  <Button size="xs" leftIcon={IndianRupee} onClick={() => onPostPayment(line)} data-testid={`charge-pay-${line.code}`}>
                    Post payment
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={demandLine !== null}
        onOpenChange={(open) => !open && setDemandLine(null)}
        title={demandLine ? `Demand “${demandLine.name}” now?` : ""}
        description="Raises the charge demand immediately, appends an OTHER_CHARGE_DEMAND row to the ledger and notifies the buyer."
        confirmLabel="Raise demand"
        onConfirm={() => (demandLine ? demandNow.mutateAsync({ line: demandLine, due_date: dueDate }) : undefined)}
      >
        {demandLine && (
          <p className={cn("money rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-navy-950")}>
            {formatINR(demandLine.total_paise)} <span className="text-xs font-normal text-ink-subtle">incl. GST</span>
          </p>
        )}
        <FieldWrapper label="Due date" hint="Leave empty for the default due-days from settings">
          {(control) => <DateInput id={control.id} value={dueDate} onChange={setDueDate} min={todayIST()} />}
        </FieldWrapper>
      </ConfirmDialog>

      <AddChargeDialog open={addOpen} onOpenChange={setAddOpen} booking={booking} />
    </div>
  );
}

function AddChargeDialog({ open, onOpenChange, booking }: { open: boolean; onOpenChange: (open: boolean) => void; booking: BookingDetailResponse }) {
  const types = useChargeTypes(open);
  const [chargeTypeId, setChargeTypeId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [gst, setGst] = useState<number>(0);
  const [demandAt, setDemandAt] = useState<ChargeDemandAt>("MANUAL");
  const [error, setError] = useState<unknown>(null);
  const existing = new Set(booking.other_charges.map((line) => line.charge_type_id));

  const reset = () => {
    setChargeTypeId(null);
    setAmount(null);
    setGst(0);
    setDemandAt("MANUAL");
    setError(null);
  };

  const add = useMutationWithToast<unknown, void>({
    mutationFn: () => api.post(`${BOOKINGS_PATH}/${booking.id}/other-charges`, { version: booking.version, charge_type_id: chargeTypeId ?? "", amount_paise: amount ?? 0, gst_percent: gst, demand_at: demandAt }, { version: booking.version }),
    successMessage: "Charge line added",
    errorMessage: false,
    invalidate: bookingInvalidations(booking.id),
    entityLabel: "This booking",
    onSuccess: () => {
      onOpenChange(false);
      reset();
    },
    onError: (cause) => {
      if (!cause.isVersionConflict) setError(cause);
    },
  });

  const totals = chargeLineTotals(amount ?? 0, gst);
  const valid = Boolean(chargeTypeId) && amount !== null && amount >= 0 && gst >= 0 && gst <= 100;

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => {
        if (add.isPending) return;
        onOpenChange(next);
        if (!next) reset();
      }}
      title="Add charge line"
      description="A new other-charge line on this booking. Demand it on possession, manually, or right away."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={add.isPending}>
            Cancel
          </Button>
          <Button loading={add.isPending} disabled={!valid} onClick={() => add.mutate()} data-testid="charge-add-save">
            Add line · {formatINR(totals.total_paise)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FieldWrapper label="Charge type" required>
          {(control) => (
            <Select
              id={control.id}
              value={chargeTypeId}
              onValueChange={(value) => {
                setChargeTypeId(value);
                const type = (types.data ?? []).find((row) => row.id === value);
                if (type) {
                  setAmount(type.default_amount_paise);
                  setGst(type.is_taxable ? type.default_gst_percent : 0);
                  setDemandAt(type.demand_at);
                }
              }}
              placeholder={types.isPending ? "Loading…" : "Choose charge type"}
              options={(types.data ?? []).map((type) => ({ value: type.id, label: type.name, description: `${type.code} · ${formatINR(type.default_amount_paise)}`, disabled: existing.has(type.id) }))}
            />
          )}
        </FieldWrapper>
        <FieldWrapper label="Amount" required>{(control) => <MoneyInput id={control.id} value={amount} onChange={setAmount} showShort={false} />}</FieldWrapper>
        <FieldWrapper label="GST %" hint={gst > 0 ? `GST ${formatINR(totals.gst_paise)}` : undefined}>{(control) => <PercentInput id={control.id} value={gst} onChange={(value) => setGst(value ?? 0)} />}</FieldWrapper>
        <FieldWrapper label="Demand">
          {(control) => <Select<ChargeDemandAt> id={control.id} value={demandAt} onValueChange={(value) => value && setDemandAt(value)} options={CHARGE_DEMAND_ATS.map((value) => ({ value, label: CHARGE_DEMAND_AT_LABELS[value] }))} />}
        </FieldWrapper>
        <p className="text-2xs text-ink-subtle">Added {formatDateTime(new Date().toISOString())} · booking version {booking.version}</p>
        <FormError error={error} />
      </div>
    </SimpleDialog>
  );
}
