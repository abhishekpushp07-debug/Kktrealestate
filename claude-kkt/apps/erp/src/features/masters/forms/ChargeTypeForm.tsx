import { useFormContext } from "react-hook-form";
import { CHARGE_DEMAND_ATS, CHARGE_DEMAND_AT_LABELS, type ChargeDemandAt } from "@kkt/contracts";
import { FormField, FormRow, Input, MoneyInput, PercentInput, Select, Switch } from "@/components/ui";
import { formatINR } from "@/lib/format";
import type { MasterFormProps } from "../types";

export interface ChargeTypeValues {
  name: string;
  code: string;
  default_amount_paise: number;
  is_taxable: boolean;
  default_gst_percent: number;
  demand_at: ChargeDemandAt;
}

const DEMAND_AT_OPTIONS = CHARGE_DEMAND_ATS.map((value) => ({ value, label: CHARGE_DEMAND_AT_LABELS[value] }));

const DEMAND_AT_HINTS: Readonly<Record<ChargeDemandAt, string>> = {
  ON_BOOKING: "Demanded automatically when a booking is created.",
  ON_POSSESSION: "Demanded when the tower's possession stage completes.",
  MANUAL: "Raised by accounts whenever needed.",
};

/** Charge types: default amount, taxability, GST % and when the demand is raised. */
export function ChargeTypeForm(_props: MasterFormProps) {
  const { control, watch } = useFormContext<ChargeTypeValues>();
  const taxable = watch("is_taxable");
  const amount = watch("default_amount_paise");
  const gst = watch("default_gst_percent");
  const demandAt = watch("demand_at");
  const gstPaise = taxable ? Math.round((amount * Math.round(gst * 100)) / 10_000) : 0;

  return (
    <div className="space-y-4">
      <FormRow columns={2}>
        <FormField
          control={control}
          name="name"
          label="Name"
          required
          render={({ field }) => (
            <Input
              {...field}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              placeholder="Maintenance Deposit"
              maxLength={120}
              data-testid="field-name"
            />
          )}
        />
        <FormField
          control={control}
          name="code"
          label="Code"
          required
          hint="Upper-case letters, digits, _ or -"
          render={({ field }) => (
            <Input
              {...field}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value.toUpperCase())}
              placeholder="MAINT_DEP"
              maxLength={30}
              className="font-mono uppercase"
              data-testid="field-code"
            />
          )}
        />
        <FormField
          control={control}
          name="default_amount_paise"
          label="Default amount"
          hint="Can be overridden per booking"
          render={({ field }) => (
            <MoneyInput
              id={field.id}
              ref={field.ref}
              value={field.value}
              onChange={(paise) => field.onChange(paise ?? 0)}
              onBlur={field.onBlur}
              aria-invalid={field["aria-invalid"]}
              aria-describedby={field["aria-describedby"]}
              data-testid="field-default-amount"
            />
          )}
        />
        <FormField
          control={control}
          name="demand_at"
          label="Demand at"
          required
          hint={DEMAND_AT_HINTS[demandAt]}
          render={({ field }) => (
            <Select
              id={field.id}
              value={field.value}
              onValueChange={(value) => value && field.onChange(value)}
              options={DEMAND_AT_OPTIONS}
              invalid={field.invalid}
              data-testid="field-demand-at"
            />
          )}
        />
      </FormRow>
      <div className="rounded-md border border-border bg-surface/60 p-3">
        <FormRow columns={2}>
          <FormField
            control={control}
            name="is_taxable"
            render={({ field }) => (
              <Switch
                id={field.id}
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Taxable"
                description="GST is added on top of the amount"
                data-testid="field-is-taxable"
              />
            )}
          />
          <FormField
            control={control}
            name="default_gst_percent"
            label="GST %"
            render={({ field }) => (
              <PercentInput
                id={field.id}
                ref={field.ref}
                value={field.value}
                onChange={(value) => field.onChange(value ?? 0)}
                onBlur={field.onBlur}
                disabled={!taxable}
                aria-invalid={field["aria-invalid"]}
                data-testid="field-gst-percent"
              />
            )}
          />
        </FormRow>
        <p className="mt-3 text-xs text-ink-subtle">
          Demand preview: <span className="money font-medium text-ink">{formatINR(amount)}</span>
          {taxable && gst > 0 && (
            <>
              {" "}
              + GST <span className="money">{formatINR(gstPaise)}</span> ={" "}
              <span className="money font-semibold text-navy-950">{formatINR(amount + gstPaise)}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
