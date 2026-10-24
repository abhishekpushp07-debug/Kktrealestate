import { useFormContext } from "react-hook-form";
import { PAYMENT_MODE_CODES, PAYMENT_MODE_CODE_LABELS, PAYMENT_MODE_DEFAULTS, type PaymentModeCode } from "@kkt/contracts";
import { FormField, FormRow, Input, NumberInput, Select, Switch } from "@/components/ui";
import type { MasterFormProps } from "../types";

export interface PaymentModeValues {
  name: string;
  code: PaymentModeCode | null;
  requires_instrument: boolean;
  clears_immediately: boolean;
  is_cash: boolean;
  sort_order: number;
}

const CODE_OPTIONS = PAYMENT_MODE_CODES.map((value) => ({ value, label: PAYMENT_MODE_CODE_LABELS[value], description: value }));

/** Payment modes: the code drives sensible defaults for the behaviour flags (SPEC §11 clearing rule). */
export function PaymentModeForm({ mode }: MasterFormProps) {
  const { control, setValue, getValues } = useFormContext<PaymentModeValues>();

  const applyDefaults = (code: PaymentModeCode) => {
    const defaults = PAYMENT_MODE_DEFAULTS[code];
    setValue("requires_instrument", defaults.requires_instrument, { shouldDirty: true });
    setValue("clears_immediately", defaults.clears_immediately, { shouldDirty: true });
    setValue("is_cash", defaults.is_cash, { shouldDirty: true });
    if (!getValues("name")) setValue("name", PAYMENT_MODE_CODE_LABELS[code], { shouldDirty: true });
  };

  return (
    <div className="space-y-4">
      <FormRow columns={2}>
        <FormField
          control={control}
          name="code"
          label="Mode"
          required
          hint={mode === "edit" ? "Changing the code resets the behaviour flags to the standard defaults" : "Picking a mode fills the standard behaviour flags"}
          render={({ field }) => (
            <Select
              id={field.id}
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value);
                if (value) applyDefaults(value);
              }}
              options={CODE_OPTIONS}
              placeholder="Select a mode"
              invalid={field.invalid}
              data-testid="field-code"
            />
          )}
        />
        <FormField
          control={control}
          name="name"
          label="Display name"
          required
          render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="Cheque" maxLength={120} data-testid="field-name" />}
        />
        <FormField
          control={control}
          name="sort_order"
          label="Sort order"
          render={({ field }) => <NumberInput id={field.id} ref={field.ref} value={field.value} onChange={(value) => field.onChange(value ?? 0)} onBlur={field.onBlur} decimals={0} min={0} max={10_000} data-testid="field-sort-order" />}
        />
      </FormRow>
      <div className="space-y-3 rounded-md border border-border bg-surface/60 p-3">
        <FormField
          control={control}
          name="requires_instrument"
          render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Requires instrument reference" description="Cheque / DD / UTR number and bank are mandatory when posting" data-testid="field-requires-instrument" />}
        />
        <FormField
          control={control}
          name="clears_immediately"
          render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Clears immediately" description="Off = payments stay Pending until cleared or bounced (cheques, DDs)" data-testid="field-clears-immediately" />}
        />
        <FormField
          control={control}
          name="is_cash"
          render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Cash mode" description="Posts to the cash book (roznamcha) instead of a bank account" data-testid="field-is-cash" />}
        />
      </div>
    </div>
  );
}
