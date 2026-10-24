import { useMemo } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { FlatTypeRow } from "@kkt/contracts";
import { Checkbox, FormField, FormRow, FormSection, Input, NumberInput, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useMasterRows } from "../api";
import type { MasterFormProps } from "../types";
import { FACING_OPTIONS } from "./FlatTypeForm";

export interface PositionValues {
  position: number;
  flat_type_id: string | null;
  facing: string | null;
  is_corner: boolean;
}

export interface FloorPlanTemplateValues {
  name: string;
  code: string;
  /** UI only: drives the length of `positions`. */
  flats_per_floor: number;
  positions: PositionValues[];
}

export const MAX_FLATS_PER_FLOOR = 99;

/** Grows or trims the positions array to `count`, keeping existing entries and renumbering 1..n. */
export function resizePositions(positions: readonly PositionValues[], count: number): PositionValues[] {
  const size = Math.max(1, Math.min(MAX_FLATS_PER_FLOOR, Math.floor(count)));
  return Array.from({ length: size }, (_, index) => {
    const existing = positions[index];
    return { position: index + 1, flat_type_id: existing?.flat_type_id ?? null, facing: existing?.facing ?? null, is_corner: existing?.is_corner ?? false };
  });
}

/** Floor plan template: flats per floor → one row per position with flat type, facing and corner flag. */
export function FloorPlanTemplateForm(_props: MasterFormProps) {
  const { control, setValue, getValues, formState } = useFormContext<FloorPlanTemplateValues>();
  const positions = useFieldArray({ control, name: "positions" });
  const flatTypes = useMasterRows<FlatTypeRow>("flat-types", { sort: "name" });
  const watched = useWatch({ control, name: "positions" }) ?? [];

  const flatTypeOptions = useMemo(() => (flatTypes.data ?? []).map((type) => ({ value: type.id, label: `${type.code} · ${type.name}`, description: `${type.bhk} BHK` })), [flatTypes.data]);
  const codeById = useMemo(() => new Map((flatTypes.data ?? []).map((type) => [type.id, type.code] as const)), [flatTypes.data]);

  const setCount = (count: number | null) => {
    const next = count ?? 1;
    setValue("flats_per_floor", next, { shouldDirty: true });
    positions.replace(resizePositions(getValues("positions"), next));
  };

  const positionsError = formState.errors.positions?.root?.message ?? formState.errors.positions?.message;
  const typeCounts = watched.reduce<Map<string, number>>((map, item) => {
    if (item.flat_type_id) map.set(item.flat_type_id, (map.get(item.flat_type_id) ?? 0) + 1);
    return map;
  }, new Map());

  return (
    <div className="space-y-6">
      <FormSection title="Template">
        <FormRow columns={3}>
          <FormField
            control={control}
            name="name"
            label="Name"
            required
            render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="Plan A (4 per floor)" maxLength={120} data-testid="field-name" />}
          />
          <FormField
            control={control}
            name="code"
            label="Code"
            required
            render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase())} placeholder="PLAN_A" maxLength={30} className="font-mono uppercase" data-testid="field-code" />}
          />
          <FormField
            control={control}
            name="flats_per_floor"
            label="Flats per floor"
            required
            hint={`1–${MAX_FLATS_PER_FLOOR}`}
            render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={setCount} onBlur={field.onBlur} decimals={0} min={1} max={MAX_FLATS_PER_FLOOR} data-testid="field-flats-per-floor" />}
          />
        </FormRow>
      </FormSection>

      <FormSection title="Positions" description="Position 1 is the first flat clockwise from the lift lobby; numbering follows the block's pattern.">
        <div className="space-y-2">
          <div className="hidden grid-cols-[3rem_1fr_9rem_5rem] gap-2 px-1 sm:grid">
            {["#", "Flat type", "Facing", "Corner"].map((heading) => (
              <span key={heading} className="label-caps">
                {heading}
              </span>
            ))}
          </div>
          {positions.fields.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[2.5rem_1fr] gap-2 rounded-md border border-border bg-card p-2 sm:grid-cols-[3rem_1fr_9rem_5rem] sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
              <span className="money flex h-9 items-center justify-center rounded-md bg-navy-50 text-sm font-semibold text-navy-950">{index + 1}</span>
              <FormField
                control={control}
                name={`positions.${index}.flat_type_id`}
                render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={flatTypeOptions} placeholder={flatTypes.isPending ? "Loading…" : "Flat type"} invalid={field.invalid} aria-label={`Flat type at position ${index + 1}`} data-testid={`position-${index}-type`} />}
              />
              <FormField
                control={control}
                name={`positions.${index}.facing`}
                className="col-start-2 sm:col-start-auto"
                render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={FACING_OPTIONS} placeholder="Facing" allowClear aria-label={`Facing at position ${index + 1}`} data-testid={`position-${index}-facing`} />}
              />
              <FormField
                control={control}
                name={`positions.${index}.is_corner`}
                className="col-start-2 sm:col-start-auto"
                render={({ field }) => <Checkbox id={field.id} checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} label="Corner" data-testid={`position-${index}-corner`} />}
              />
            </div>
          ))}
          {positionsError && (
            <p role="alert" className="text-xs font-medium text-danger-fg">
              {positionsError}
            </p>
          )}
        </div>
      </FormSection>

      <FormSection title="Floor preview" description="How one floor reads once the block is generated.">
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(watched.length || 1, 6)}, minmax(0, 1fr))` }}>
            {watched.map((item, index) => {
              const code = item.flat_type_id ? (codeById.get(item.flat_type_id) ?? "?") : null;
              return (
                <div
                  key={index}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center rounded-md border px-1 py-1.5 text-center",
                    code ? "border-navy-800 bg-navy-950 text-white" : "border-dashed border-border-strong bg-card text-ink-subtle",
                    item.is_corner && "ring-2 ring-gold ring-offset-1 ring-offset-surface",
                  )}
                  title={item.is_corner ? "Corner flat" : undefined}
                >
                  <span className="money text-[10px] opacity-70">{item.position}</span>
                  <span className="truncate font-mono text-xs font-semibold">{code ?? "—"}</span>
                  {item.facing && <span className="truncate text-[10px] opacity-80">{item.facing}</span>}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
            <span className="money">{watched.length} flats per floor</span>
            {[...typeCounts.entries()].map(([id, count]) => (
              <span key={id} className="money">
                {codeById.get(id) ?? "?"} × {count}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-xs ring-2 ring-gold" aria-hidden="true" /> corner
            </span>
          </div>
        </div>
      </FormSection>
    </div>
  );
}
