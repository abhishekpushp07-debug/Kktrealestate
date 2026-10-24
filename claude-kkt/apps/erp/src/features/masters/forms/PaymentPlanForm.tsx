import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { PLAN_TYPES, PLAN_TYPE_LABELS, TRIGGER_TYPES, TRIGGER_TYPE_LABELS, type ConstructionStageRow, type PlanType, type TriggerType } from "@kkt/contracts";
import { Button, DateInput, FormField, FormRow, FormSection, IconButton, Input, NumberInput, PercentInput, Select, Textarea } from "@/components/ui";
import { formatINR, formatINRShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMasterRows } from "../api";
import { SAMPLE_BOOKING, buildSchedulePreview, percentSum } from "../paymentPlanMath";
import type { MasterFormProps } from "../types";

export interface InstallmentValues {
  seq: number;
  name: string;
  percent: number | null;
  trigger_type: TriggerType | null;
  trigger_days: number | null;
  trigger_stage_id: string | null;
  trigger_date: string | null;
  due_days: number | null;
  notes: string | null;
}

export interface PaymentPlanValues {
  name: string;
  code: string;
  plan_type: PlanType | null;
  description: string | null;
  grace_days: number;
  installments: InstallmentValues[];
}

const PLAN_TYPE_OPTIONS = PLAN_TYPES.map((value) => ({ value, label: PLAN_TYPE_LABELS[value] }));
const TRIGGER_OPTIONS = TRIGGER_TYPES.map((value) => ({ value, label: TRIGGER_TYPE_LABELS[value] }));

export function emptyInstallment(seq: number): InstallmentValues {
  return { seq, name: "", percent: null, trigger_type: null, trigger_days: null, trigger_stage_id: null, trigger_date: null, due_days: null, notes: null };
}

/** Renumbers `seq` 1..n after a move or removal. */
export function renumber(installments: readonly InstallmentValues[]): InstallmentValues[] {
  return installments.map((item, index) => ({ ...item, seq: index + 1 }));
}

/** Payment plan: header fields, installments repeater with live 100 % footer and a sample schedule. */
export function PaymentPlanForm(_props: MasterFormProps) {
  const { control, getValues, formState } = useFormContext<PaymentPlanValues>();
  const installments = useFieldArray({ control, name: "installments" });
  const stages = useMasterRows<ConstructionStageRow>("construction-stages", { sort: "sort_order" });
  const watched = useWatch({ control, name: "installments" }) ?? [];

  const stageOptions = useMemo(() => (stages.data ?? []).map((stage) => ({ value: stage.id, label: stage.name, description: stage.is_possession ? "Possession stage" : undefined })), [stages.data]);
  const stageNameById = useMemo(() => new Map((stages.data ?? []).map((stage) => [stage.id, stage.name] as const)), [stages.data]);

  const sum = percentSum(watched);
  const preview = useMemo(() => buildSchedulePreview(watched.map((item, index) => ({ seq: item.seq ?? index + 1, name: item.name || `Installment ${index + 1}`, percent: item.percent }))), [watched]);
  const onBookingCount = watched.filter((item) => item.trigger_type === "ON_BOOKING").length;
  const onPossessionCount = watched.filter((item) => item.trigger_type === "ON_POSSESSION").length;
  const listError = formState.errors.installments?.root?.message ?? formState.errors.installments?.message;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= installments.fields.length) return;
    installments.move(from, to);
    installments.replace(renumber(getValues("installments")));
  };

  const remove = (index: number) => {
    installments.remove(index);
    installments.replace(renumber(getValues("installments")));
  };

  const describeTrigger = (item: InstallmentValues): string => {
    switch (item.trigger_type) {
      case "ON_BOOKING":
        return "On booking";
      case "DAYS_AFTER_BOOKING":
        return item.trigger_days ? `${item.trigger_days} days after booking` : "n days after booking";
      case "ON_STAGE":
        return item.trigger_stage_id ? (stageNameById.get(item.trigger_stage_id) ?? "Stage") : "On stage";
      case "ON_POSSESSION":
        return "On possession";
      case "ON_DATE":
        return item.trigger_date ?? "On date";
      case null:
        return "—";
    }
  };

  return (
    <div className="space-y-6">
      <FormSection title="Plan">
        <FormRow columns={2}>
          <FormField
            control={control}
            name="name"
            label="Name"
            required
            render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="Standard CLP" maxLength={120} data-testid="field-name" />}
          />
          <FormField
            control={control}
            name="code"
            label="Code"
            required
            render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase())} placeholder="CLP_STD" maxLength={30} className="font-mono uppercase" data-testid="field-code" />}
          />
          <FormField
            control={control}
            name="plan_type"
            label="Type"
            required
            render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={PLAN_TYPE_OPTIONS} placeholder="Select type" invalid={field.invalid} data-testid="field-plan-type" />}
          />
          <FormField
            control={control}
            name="grace_days"
            label="Grace days"
            hint="Days after the due date before a demand counts as overdue"
            render={({ field }) => <NumberInput id={field.id} ref={field.ref} value={field.value} onChange={(value) => field.onChange(value ?? 0)} onBlur={field.onBlur} decimals={0} min={0} max={90} suffix="days" data-testid="field-grace-days" />}
          />
          <FormField
            control={control}
            name="description"
            label="Description"
            className="sm:col-span-2"
            render={({ field }) => <Textarea {...field} value={field.value ?? ""} onChange={(event) => field.onChange(event.target.value || null)} placeholder="Shown to sales while picking a plan" maxLength={2000} rows={2} data-testid="field-description" />}
          />
        </FormRow>
      </FormSection>

      <FormSection title="Installments" description="Each percent applies equally to the cash and account buckets of a booking.">
        <div className="space-y-3">
          {installments.fields.map((item, index) => {
            const current = watched[index];
            const triggerType = current?.trigger_type ?? null;
            return (
              <div key={item.id} className="rounded-md border border-border bg-card p-3 shadow-card" data-testid={`installment-${index}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="money inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-navy-950 px-1.5 text-xs font-bold text-white">{index + 1}</span>
                  <div className="flex items-center gap-0.5">
                    <IconButton icon={ArrowUp} label="Move up" size="xs" disabled={index === 0} onClick={() => move(index, index - 1)} data-testid={`installment-${index}-up`} />
                    <IconButton icon={ArrowDown} label="Move down" size="xs" disabled={index === installments.fields.length - 1} onClick={() => move(index, index + 1)} data-testid={`installment-${index}-down`} />
                    <IconButton icon={Trash2} label="Remove installment" size="xs" className="text-ink-subtle hover:text-danger-fg" disabled={installments.fields.length <= 1} onClick={() => remove(index)} data-testid={`installment-${index}-remove`} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_11rem_1fr_6rem]">
                  <FormField
                    control={control}
                    name={`installments.${index}.name`}
                    label="Name"
                    required
                    className="col-span-2 sm:col-span-1"
                    render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="On booking" maxLength={120} data-testid={`installment-${index}-name`} />}
                  />
                  <FormField
                    control={control}
                    name={`installments.${index}.percent`}
                    label="Percent"
                    required
                    render={({ field }) => <PercentInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} aria-invalid={field["aria-invalid"]} data-testid={`installment-${index}-percent`} />}
                  />
                  <FormField
                    control={control}
                    name={`installments.${index}.trigger_type`}
                    label="Trigger"
                    required
                    render={({ field }) => (
                      <Select
                        id={field.id}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={TRIGGER_OPTIONS.map((option) => ({
                          ...option,
                          disabled: (option.value === "ON_BOOKING" && onBookingCount > 0 && triggerType !== "ON_BOOKING") || (option.value === "ON_POSSESSION" && onPossessionCount > 0 && triggerType !== "ON_POSSESSION"),
                        }))}
                        placeholder="Trigger"
                        invalid={field.invalid}
                        data-testid={`installment-${index}-trigger`}
                      />
                    )}
                  />
                  {triggerType === "DAYS_AFTER_BOOKING" && (
                    <FormField
                      control={control}
                      name={`installments.${index}.trigger_days`}
                      label="Days after booking"
                      required
                      render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={0} min={1} max={3650} suffix="days" aria-invalid={field["aria-invalid"]} data-testid={`installment-${index}-days`} />}
                    />
                  )}
                  {triggerType === "ON_STAGE" && (
                    <FormField
                      control={control}
                      name={`installments.${index}.trigger_stage_id`}
                      label="Construction stage"
                      required
                      render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={stageOptions} placeholder={stages.isPending ? "Loading…" : "Select stage"} invalid={field.invalid} data-testid={`installment-${index}-stage`} />}
                    />
                  )}
                  {triggerType === "ON_DATE" && (
                    <FormField
                      control={control}
                      name={`installments.${index}.trigger_date`}
                      label="Due on"
                      required
                      render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} aria-invalid={field["aria-invalid"]} data-testid={`installment-${index}-date`} />}
                    />
                  )}
                  {(triggerType === "ON_BOOKING" || triggerType === "ON_POSSESSION" || triggerType === null) && <div className="hidden sm:block" aria-hidden="true" />}
                  <FormField
                    control={control}
                    name={`installments.${index}.due_days`}
                    label="Due days"
                    hint="Blank = company default"
                    render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={0} min={0} max={365} data-testid={`installment-${index}-due-days`} />}
                  />
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => installments.append(emptyInstallment(installments.fields.length + 1))} disabled={installments.fields.length >= 100} data-testid="add-installment-btn">
              Add installment
            </Button>
            <div
              role="status"
              className={cn(
                "money inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold",
                sum.complete ? "border-status-available-border bg-success-bg text-success-fg" : "border-danger/30 bg-danger-bg text-danger-fg",
              )}
              data-testid="percent-sum"
            >
              Total {sum.totalText}%
              {!sum.complete && <span className="text-xs font-medium">({sum.over ? `${sum.remainingText}% over` : `${sum.remainingText}% to go`})</span>}
            </div>
          </div>
          {listError && (
            <p role="alert" className="text-xs font-medium text-danger-fg">
              {listError}
            </p>
          )}
        </div>
      </FormSection>

      <FormSection title="Schedule preview" description={`Sample booking of ${formatINRShort(SAMPLE_BOOKING.agreement_paise)}: account ${formatINRShort(SAMPLE_BOOKING.account_paise)} · cash ${formatINRShort(SAMPLE_BOOKING.cash_paise)}.`}>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[32rem] text-xs">
            <thead className="bg-surface text-left text-2xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Installment</th>
                <th className="px-2 py-1.5">Trigger</th>
                <th className="px-2 py-1.5 text-right">%</th>
                <th className="px-2 py-1.5 text-right">Cum.</th>
                <th className="px-2 py-1.5 text-right">Account</th>
                <th className="px-2 py-1.5 text-right">Cash</th>
                <th className="px-2 py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  <td className="money px-2 py-1.5 text-ink-subtle">{row.seq}</td>
                  <td className="px-2 py-1.5 font-medium text-ink">{row.name}</td>
                  <td className="px-2 py-1.5 text-ink-muted">{watched[index] ? describeTrigger(watched[index]) : "—"}</td>
                  <td className="money px-2 py-1.5 text-right">{formatPercent(row.percent)}</td>
                  <td className="money px-2 py-1.5 text-right text-ink-subtle">{formatPercent(row.cumulative_percent)}</td>
                  <td className="money px-2 py-1.5 text-right">{formatINR(row.account_paise)}</td>
                  <td className="money px-2 py-1.5 text-right">{formatINR(row.cash_paise)}</td>
                  <td className="money px-2 py-1.5 text-right font-semibold text-navy-950">{formatINR(row.total_paise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border-strong bg-surface font-semibold text-navy-950">
              <tr>
                <td className="px-2 py-1.5" colSpan={3}>
                  Totals
                </td>
                <td className={cn("money px-2 py-1.5 text-right", sum.complete ? "text-success-fg" : "text-danger-fg")}>{sum.totalText}%</td>
                <td />
                <td className="money px-2 py-1.5 text-right">{formatINR(preview.totals.account_paise)}</td>
                <td className="money px-2 py-1.5 text-right">{formatINR(preview.totals.cash_paise)}</td>
                <td className="money px-2 py-1.5 text-right">{formatINR(preview.totals.total_paise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </FormSection>
    </div>
  );
}
