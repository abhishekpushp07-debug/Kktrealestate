import { ParkingSquare } from "lucide-react";
import { useMemo } from "react";
import { CHARGE_DEMAND_ATS, CHARGE_DEMAND_AT_LABELS, PARKING_TYPE_LABELS, type ChargeDemandAt, type ChargeTypeRow, type OtherChargeInput } from "@kkt/contracts";
import { Badge, Checkbox, EmptyState, ErrorState, FieldWrapper, MoneyInput, PercentInput, Select, Skeleton } from "@/components/ui";
import { formatINR, formatINRShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Notice } from "@/features/inventory/components";
import { useAvailableParking, useChargeTypes } from "../api";
import { chargeLineTotals, otherChargesTotal } from "../bookingMath";
import type { StepProps } from "./types";

function lineFromType(type: ChargeTypeRow): OtherChargeInput {
  return { charge_type_id: type.id, amount_paise: type.default_amount_paise, gst_percent: type.is_taxable ? type.default_gst_percent : 0, demand_at: type.demand_at };
}

/** Step 5 — other charges checklist (defaults, GST, demand-at) and parking slots from the available pool. */
export function StepCharges({ state, update, errors, showErrors }: StepProps) {
  const types = useChargeTypes();
  const parking = useAvailableParking(state.project_id);
  const error = (key: string) => (showErrors ? errors[key] : undefined);
  const byType = useMemo(() => new Map(state.other_charges.map((line, index) => [line.charge_type_id, { line, index }] as const)), [state.other_charges]);
  const totals = otherChargesTotal(state.other_charges);

  const toggle = (type: ChargeTypeRow, checked: boolean) => {
    if (checked) {
      if (byType.has(type.id)) return;
      update({ other_charges: [...state.other_charges, lineFromType(type)] });
    } else {
      update({ other_charges: state.other_charges.filter((line) => line.charge_type_id !== type.id) });
    }
  };

  const patchLine = (chargeTypeId: string, patch: Partial<OtherChargeInput>) => {
    update({ other_charges: state.other_charges.map((line) => (line.charge_type_id === chargeTypeId ? { ...line, ...patch } : line)) });
  };

  const toggleSlot = (id: string, checked: boolean) => {
    update({ parking_slot_ids: checked ? [...new Set([...state.parking_slot_ids, id])] : state.parking_slot_ids.filter((item) => item !== id) });
  };

  const parkingTotal = (parking.data ?? []).filter((slot) => state.parking_slot_ids.includes(slot.id)).reduce((sum, slot) => sum + slot.price_paise, 0);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-md font-bold text-navy-950">Other charges</h3>
          <span className="text-xs text-ink-muted">
            {formatNumber(state.other_charges.length)} selected · <span className="money font-semibold text-navy-950">{formatINR(totals.total_paise)}</span>
            {totals.gst_paise > 0 && <span className="money"> (incl. GST {formatINRShort(totals.gst_paise)})</span>}
          </span>
        </div>
        {error("other_charges") && <Notice tone="danger">{error("other_charges")}</Notice>}
        {types.isPending && <Skeleton className="h-32" />}
        {types.isError && <ErrorState compact error={types.error} onRetry={() => void types.refetch()} />}
        {types.data && types.data.length === 0 && <EmptyState compact title="No charge types defined" description="Add registry, maintenance, GST and similar charge types under Master data." />}
        {types.data && types.data.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {types.data.map((type) => {
              const entry = byType.get(type.id);
              const checked = Boolean(entry);
              const line = entry?.line;
              const lineTotals = line ? chargeLineTotals(line.amount_paise, line.gst_percent) : null;
              const index = entry?.index ?? -1;
              return (
                <li key={type.id} className={cn("p-3", checked && "bg-gold-light/40")} data-testid={`charge-line-${type.code}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    <Checkbox checked={checked} onCheckedChange={(value) => toggle(type, value === true)} label={type.name} description={`${type.code} · default ${formatINR(type.default_amount_paise)}${type.is_taxable ? ` · GST ${type.default_gst_percent}%` : ""} · ${CHARGE_DEMAND_AT_LABELS[type.demand_at]}`} />
                    {line && (
                      <div className="ml-auto grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-[9rem_6rem_10rem_auto] sm:items-end">
                        <FieldWrapper label="Amount" error={error(`other_charges.${index}.amount_paise`)}>
                          {(control) => <MoneyInput id={control.id} value={line.amount_paise} invalid={control.invalid} onChange={(value) => patchLine(type.id, { amount_paise: value ?? 0 })} showShort={false} />}
                        </FieldWrapper>
                        <FieldWrapper label="GST %" error={error(`other_charges.${index}.gst_percent`)}>
                          {(control) => <PercentInput id={control.id} value={line.gst_percent} invalid={control.invalid} onChange={(value) => patchLine(type.id, { gst_percent: value ?? 0 })} />}
                        </FieldWrapper>
                        <FieldWrapper label="Demand">
                          {(control) => <Select<ChargeDemandAt> id={control.id} value={line.demand_at} onValueChange={(value) => value && patchLine(type.id, { demand_at: value })} options={CHARGE_DEMAND_ATS.map((value) => ({ value, label: CHARGE_DEMAND_AT_LABELS[value] }))} />}
                        </FieldWrapper>
                        <div className="pb-2 text-right text-xs sm:pb-2.5">
                          <span className="text-ink-subtle">Total </span>
                          <span className="money font-semibold text-navy-950">{formatINR(lineTotals?.total_paise ?? 0)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-md font-bold text-navy-950">Parking</h3>
          <span className="text-xs text-ink-muted">
            {formatNumber(state.parking_slot_ids.length)} slot{state.parking_slot_ids.length === 1 ? "" : "s"} · <span className="money font-semibold text-navy-950">{formatINR(parkingTotal)}</span>
          </span>
        </div>
        {error("parking_slot_ids") && <Notice tone="danger">{error("parking_slot_ids")}</Notice>}
        {!state.project_id && <p className="text-xs text-ink-subtle">Pick a project first.</p>}
        {state.project_id && parking.isPending && <Skeleton className="h-24" />}
        {state.project_id && parking.isError && <ErrorState compact error={parking.error} onRetry={() => void parking.refetch()} />}
        {parking.data && parking.data.length === 0 && <EmptyState compact icon={ParkingSquare} title="No parking available" description="Every slot in this project is allotted or blocked." />}
        {parking.data && parking.data.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Available parking slots">
            {parking.data.map((slot) => {
              const checked = state.parking_slot_ids.includes(slot.id);
              const disabled = !checked && state.parking_slot_ids.length >= 10;
              return (
                <li key={slot.id}>
                  <label className={cn("flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors", checked ? "border-navy-950 bg-navy-50" : "border-border bg-card hover:border-navy-300", disabled && "cursor-not-allowed opacity-60")}>
                    <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => toggleSlot(slot.id, value === true)} aria-label={`Slot ${slot.number}`} />
                    <span className="min-w-0 flex-1">
                      <span className="money block font-semibold text-navy-950">{slot.number}</span>
                      <span className="block text-2xs text-ink-subtle">
                        {PARKING_TYPE_LABELS[slot.slot_type]}
                        {slot.level ? ` · ${slot.level}` : ""}
                      </span>
                    </span>
                    <Badge variant="outline" numeric>
                      {formatINRShort(slot.price_paise)}
                    </Badge>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
