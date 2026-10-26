import { Building2 } from "lucide-react";
import { useEffect } from "react";
import { FLAT_STATUS_LABELS } from "@kkt/contracts";
import { DateInput, EmptyState, ErrorState, FieldWrapper, FormRow, Select, Skeleton, StatusChip } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatINR, formatSqft, todayIST } from "@/lib/format";
import { useBlockGrid, useFlatDetail, useProjectBlocks } from "@/features/inventory/api";
import { Notice } from "@/features/inventory/components";
import { useProjectOptions } from "@/features/shared/options";
import { FlatPickerGrid } from "./FlatPickerGrid";
import type { StepProps } from "./types";

/** Step 1 — Project → Tower → flat from the grid, plus the booking date. */
export function StepFlat({ state, update, errors, showErrors }: StepProps) {
  const { user } = useAuth();
  const projects = useProjectOptions();
  const blocks = useProjectBlocks(state.project_id);
  const grid = useBlockGrid(state.block_id, "STATUS");
  const flat = useFlatDetail(state.flat_id);
  const today = todayIST();

  // A block list with exactly one tower picks itself.
  useEffect(() => {
    if (state.block_id || !blocks.data || blocks.data.length !== 1) return;
    const only = blocks.data[0];
    if (only) update({ block_id: only.id });
  }, [blocks.data, state.block_id, update]);

  const error = (key: string) => (showErrors ? errors[key] : undefined);

  return (
    <div className="space-y-4">
      <FormRow columns={3}>
        <FieldWrapper label="Project" required error={error("project_id")}>
          {(control) => (
            <Select
              id={control.id}
              value={state.project_id}
              invalid={control.invalid}
              onValueChange={(value) => update({ project_id: value, block_id: null, flat_id: null, parking_slot_ids: [], payment_plan_id: null })}
              options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name, description: project.code ?? undefined }))}
              placeholder={projects.isPending ? "Loading projects…" : "Choose project"}
              data-testid="wizard-project"
            />
          )}
        </FieldWrapper>
        <FieldWrapper label="Tower" required error={error("block_id")}>
          {(control) => (
            <Select
              id={control.id}
              value={state.block_id}
              invalid={control.invalid}
              disabled={!state.project_id}
              onValueChange={(value) => update({ block_id: value, flat_id: null, payment_plan_id: null })}
              options={(blocks.data ?? []).map((block) => ({ value: block.id, label: block.name, description: `${block.unit_counts.available} available · ${block.current_stage_name ?? "not started"}`, disabled: !block.has_flats }))}
              placeholder={!state.project_id ? "Pick a project first" : blocks.isPending ? "Loading towers…" : "Choose tower"}
              data-testid="wizard-block"
            />
          )}
        </FieldWrapper>
        <FieldWrapper label="Booking date" required error={error("booking_date")} hint="Plan dates count from this date">
          {(control) => <DateInput id={control.id} value={state.booking_date} invalid={control.invalid} max={today} onChange={(value) => update({ booking_date: value ?? today, plan_accepted_on: value && state.plan_accepted_on < value ? value : state.plan_accepted_on })} data-testid="wizard-booking-date" />}
        </FieldWrapper>
      </FormRow>

      {error("flat_id") && <Notice tone="danger">{error("flat_id")}</Notice>}

      {!state.block_id && (
        <EmptyState compact icon={Building2} title="Pick a project and tower" description="The tower's availability grid appears here. Only Available and Hold flats can be booked." />
      )}
      {state.block_id && grid.isPending && <Skeleton className="h-72 rounded-lg" />}
      {state.block_id && grid.isError && <ErrorState compact error={grid.error} onRetry={() => void grid.refetch()} />}
      {state.block_id && grid.data && (
        <FlatPickerGrid grid={grid.data} value={state.flat_id} loading={grid.isFetching} onPick={(cell) => update({ flat_id: cell.flat_id, agreement_value_paise: null, cash_agreed_paise: null, account_agreed_paise: null })} />
      )}

      {state.flat_id && (
        <section className="rounded-lg border border-navy-100 bg-navy-50 p-4" aria-label="Selected flat" data-testid="wizard-selected-flat">
          {flat.isPending && <Skeleton className="h-16" />}
          {flat.data && (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="money font-display text-lg font-extrabold text-navy-950">Flat {flat.data.flat_number}</span>
                  <StatusChip status={flat.data.status} label={FLAT_STATUS_LABELS[flat.data.status]} />
                </p>
                <p className="text-sm text-ink-muted">
                  {flat.data.flat_type_name} · {flat.data.floor_label} floor · {formatSqft(flat.data.super_builtup_sqft)} super built-up
                  {flat.data.facing ? ` · ${flat.data.facing} facing` : ""}
                  {flat.data.is_corner ? " · corner" : ""}
                </p>
                {flat.data.status === "HOLD" && flat.data.hold_by_user_id === user?.id && (
                  <p className="mt-1 text-xs text-success-fg">
                    Held for you{flat.data.hold_until ? ` until ${formatDateTime(flat.data.hold_until)}` : ""}.
                  </p>
                )}
                {flat.data.status === "HOLD" && flat.data.hold_by_user_id !== user?.id && (
                  <p className="mt-1 text-xs text-warning-fg">
                    On hold{flat.data.hold_by_name ? ` by ${flat.data.hold_by_name}` : ""}
                    {flat.data.hold_until ? ` until ${formatDateTime(flat.data.hold_until)}` : ""} — the hold owner or an admin can book it.
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="label-caps">List price</p>
                <p className="money font-display text-xl font-extrabold text-navy-950">{formatINR(flat.data.price_paise)}</p>
                {flat.data.rate_per_sqft_paise !== null && <p className="money text-xs text-ink-subtle">{formatINR(flat.data.rate_per_sqft_paise)} / sq ft</p>}
              </div>
              {flat.data.price_breakup.length > 0 && (
                <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-1 border-t border-navy-100 pt-2 text-xs sm:grid-cols-3">
                  {flat.data.price_breakup.map((line) => (
                    <div key={line.label} className="flex justify-between gap-2">
                      <dt className="text-ink-muted">{line.label}</dt>
                      <dd className="money font-medium">{formatINR(line.amount_paise)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
