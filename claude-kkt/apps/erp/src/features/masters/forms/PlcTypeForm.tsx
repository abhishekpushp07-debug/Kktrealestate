import { useFormContext } from "react-hook-form";
import { PLC_CALC_MODES, PLC_CALC_MODE_LABELS, type PlcCalcMode } from "@kkt/contracts";
import { FormField, FormRow, Input, RadioGroup } from "@/components/ui";
import type { MasterFormProps } from "../types";

export interface PlcTypeValues {
  name: string;
  code: string;
  calc_mode: PlcCalcMode | null;
}

const CALC_MODE_DESCRIPTIONS: Readonly<Record<PlcCalcMode, string>> = {
  PER_SQFT: "Rate × super built-up area of the flat",
  FIXED: "One fixed amount per flat",
  PERCENT: "Percent of the flat's base price",
  FLOOR_RISE: "Rate × floors above the threshold × area",
};

const CALC_MODE_OPTIONS = PLC_CALC_MODES.map((value) => ({
  value,
  label: PLC_CALC_MODE_LABELS[value],
  description: CALC_MODE_DESCRIPTIONS[value],
}));

/** PLC types: how the preferential location charge is computed on the rate card. */
export function PlcTypeForm(_props: MasterFormProps) {
  const { control } = useFormContext<PlcTypeValues>();
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
              placeholder="Park Facing"
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
          render={({ field }) => (
            <Input
              {...field}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value.toUpperCase())}
              placeholder="PARK_FACING"
              maxLength={30}
              className="font-mono uppercase"
              data-testid="field-code"
            />
          )}
        />
      </FormRow>
      <FormField
        control={control}
        name="calc_mode"
        label="Calculation mode"
        required
        render={({ field }) => (
          <RadioGroup
            value={field.value}
            onValueChange={field.onChange}
            options={CALC_MODE_OPTIONS}
            cards
            aria-describedby={field["aria-describedby"]}
            data-testid="field-calc-mode"
          />
        )}
      />
    </div>
  );
}
