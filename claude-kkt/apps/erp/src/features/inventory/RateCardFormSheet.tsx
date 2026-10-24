import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useFieldArray, useForm, useFormContext, useWatch } from "react-hook-form";
import {
  PLC_APPLIES_TOS,
  PLC_APPLIES_TO_LABELS,
  PLC_CALC_MODES,
  PLC_CALC_MODE_LABELS,
  RateCardCreateSchema,
  RateCardUpdateSchema,
  type FlatTypeRow,
  type PlcTypeRow,
  type RateCardRow,
} from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, DateInput, FormError, FormField, FormRow, FormSection, IconButton, Input, MoneyInput, NumberInput, PercentInput, Select, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { contractResolver } from "@/features/shared/contractResolver";
import { useMasterRows } from "@/features/masters/api";
import { FACING_OPTIONS } from "@/features/masters/forms/FlatTypeForm";
import { inventoryKeys, RATE_CARDS_PATH } from "./api";
import { controlOf } from "./components";

interface RateValues {
  flat_type_id: string | null;
  mode: "RATE" | "LUMP";
  rate_per_sqft_paise: number | null;
  lump_sum_paise: number | null;
}

interface RuleValues {
  plc_type_id: string | null;
  calc_mode: string | null;
  value_paise: number | null;
  value_percent: number | null;
  applies_to: string;
  floors_gte: number | null;
  facings: string[];
}

export interface RateCardValues {
  name: string;
  effective_from: string | null;
  rates: RateValues[];
  plc_rules: RuleValues[];
}

function buildFormSchema(projectId: string) {
  return z.looseObject({}).transform((raw): unknown => {
    const values = raw as unknown as RateCardValues;
    return {
      project_id: projectId,
      name: values.name,
      effective_from: values.effective_from,
      rates: values.rates.map((rate) => ({
        flat_type_id: rate.flat_type_id,
        rate_per_sqft_paise: rate.mode === "RATE" ? rate.rate_per_sqft_paise : null,
        lump_sum_paise: rate.mode === "LUMP" ? rate.lump_sum_paise : null,
      })),
      plc_rules: values.plc_rules.map((rule, index) => ({
        plc_type_id: rule.plc_type_id,
        calc_mode: rule.calc_mode,
        value: rule.calc_mode === "PERCENT" ? rule.value_percent : rule.value_paise,
        applies_to: rule.applies_to,
        floors_gte: rule.applies_to === "FLOORS_GTE" ? rule.floors_gte : null,
        facings: rule.applies_to === "FACING_IN" ? rule.facings : null,
        sort_order: index,
      })),
    };
  });
}

const EditSchema = RateCardUpdateSchema.omit({ version: true }).extend({ project_id: z.string().optional() });

export function defaultRateCardValues(): RateCardValues {
  return { name: "", effective_from: todayIST(), rates: [], plc_rules: [] };
}

export function rateCardToValues(row: RateCardRow): RateCardValues {
  return {
    name: row.name,
    effective_from: row.effective_from,
    rates: row.rates.map((rate) => ({ flat_type_id: rate.flat_type_id, mode: rate.lump_sum_paise !== null ? "LUMP" : "RATE", rate_per_sqft_paise: rate.rate_per_sqft_paise, lump_sum_paise: rate.lump_sum_paise })),
    plc_rules: [...row.plc_rules]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((rule) => ({
        plc_type_id: rule.plc_type_id,
        calc_mode: rule.calc_mode,
        value_paise: rule.calc_mode === "PERCENT" ? null : rule.value,
        value_percent: rule.calc_mode === "PERCENT" ? rule.value : null,
        applies_to: rule.applies_to,
        floors_gte: rule.floors_gte,
        facings: rule.facings ?? [],
      })),
  };
}

export interface RateCardFormSheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rateCard: RateCardRow | null;
  /** Clone an existing card into a new draft. */
  cloneFrom?: RateCardRow | null;
}

/** Draft rate card: effective date, rate (per sq ft or lump sum) per flat type, PLC rules repeater. */
export function RateCardFormSheet({ projectId, open, onOpenChange, rateCard, cloneFrom = null }: RateCardFormSheetProps) {
  const mode = rateCard ? "edit" : "create";
  const schema = useMemo(() => (mode === "edit" ? buildFormSchema(projectId).pipe(EditSchema) : buildFormSchema(projectId).pipe(RateCardCreateSchema)), [mode, projectId]);
  const resolver = useMemo(() => contractResolver<RateCardValues, unknown>(schema), [schema]);
  const initial = () => (rateCard ? rateCardToValues(rateCard) : cloneFrom ? { ...rateCardToValues(cloneFrom), name: `${cloneFrom.name} (copy)`, effective_from: todayIST() } : defaultRateCardValues());
  const form = useForm<RateCardValues, unknown, unknown>({ resolver, defaultValues: initial(), mode: "onTouched" });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);

  const rowId = rateCard?.id ?? null;
  const rowVersion = rateCard?.version ?? null;
  const cloneId = cloneFrom?.id ?? null;
  useEffect(() => {
    if (!open) return;
    form.reset(initial());
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rowId, rowVersion, cloneId]);

  const handleError = (error: ApiClientError) => {
    if (error.isVersionConflict) return;
    if (!applyServerErrors(error, form.setError)) setServerError(error);
  };

  const create = useMutationWithToast<RateCardRow, unknown>({
    mutationFn: (body) => api.post<RateCardRow>(RATE_CARDS_PATH, body),
    successMessage: (saved) => `Draft "${saved.name}" created`,
    invalidate: [inventoryKeys.rateCards(projectId), [RATE_CARDS_PATH]],
    errorMessage: false,
    onSuccess: () => onOpenChange(false),
    onError: handleError,
  });
  const update = useMutationWithToast<RateCardRow, { id: string; version: number; body: unknown }>({
    mutationFn: ({ id, version, body }) => {
      const { project_id: _ignored, ...rest } = body as Record<string, unknown>;
      return api.patch<RateCardRow>(`${RATE_CARDS_PATH}/${id}`, { ...rest, version }, { version });
    },
    successMessage: "Rate card saved",
    invalidate: [inventoryKeys.rateCards(projectId), [RATE_CARDS_PATH]],
    entityLabel: "This rate card",
    errorMessage: false,
    onSuccess: () => onOpenChange(false),
    onError: handleError,
  });
  const busy = create.isPending || update.isPending;

  const submit = (output: unknown) => {
    setServerError(null);
    if (rateCard) update.mutate({ id: rateCard.id, version: rateCard.version, body: output });
    else create.mutate(output);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent size="lg" data-testid="rate-card-form-sheet">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{mode === "create" ? "New rate card" : "Edit draft rate card"}</SheetTitle>
            {rateCard && <Badge variant="neutral">Draft</Badge>}
          </div>
          <SheetDescription>Rates per flat type plus PLC rules. Drafts can be edited until activated; activating supersedes the current Active card.</SheetDescription>
        </SheetHeader>
        <FormProvider {...form}>
          <form noValidate onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col">
            <SheetBody className="space-y-6">
              {serverError !== null && <FormError error={serverError} />}
              <FormRow columns={2}>
                <FormField control={control} name="name" label="Name" required render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="Launch pricing 2026" maxLength={120} data-testid="rate-card-name" />} />
                <FormField control={control} name="effective_from" label="Effective from" required render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} data-testid="rate-card-effective" />} />
              </FormRow>
              <RatesRepeater open={open} />
              <PlcRulesRepeater open={open} />
            </SheetBody>
            <SheetFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} data-testid="rate-card-submit">
                {mode === "create" ? "Create draft" : "Save draft"}
              </Button>
            </SheetFooter>
          </form>
        </FormProvider>
      </SheetContent>
    </Sheet>
  );
}

function RatesRepeater({ open }: { open: boolean }) {
  const { control, formState } = useFormContext<RateCardValues>();
  const rates = useFieldArray({ control, name: "rates" });
  const watched = useWatch({ control, name: "rates" }) ?? [];
  const flatTypes = useMasterRows<FlatTypeRow>("flat-types", { enabled: open });
  const used = new Set(watched.map((rate) => rate.flat_type_id).filter(Boolean));
  const options = (flatTypes.data ?? []).map((type) => ({ value: type.id, label: `${type.code} · ${type.name}`, description: type.super_builtup_sqft ? `${type.super_builtup_sqft} sq ft super` : undefined }));
  const error = formState.errors.rates?.root?.message ?? formState.errors.rates?.message;

  const addAll = () => {
    for (const type of flatTypes.data ?? []) {
      if (!used.has(type.id)) rates.append({ flat_type_id: type.id, mode: type.base_price_paise !== null ? "LUMP" : "RATE", rate_per_sqft_paise: type.base_rate_per_sqft_paise, lump_sum_paise: type.base_price_paise });
    }
  };

  return (
    <FormSection title="Rates per flat type" description="Each flat type once: either a rate per sq ft (× super built-up) or a lump sum.">
      <div className="space-y-2">
        {rates.fields.map((item, index) => {
          const current = watched[index];
          return (
            <div key={item.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-border p-2 sm:grid-cols-[1.4fr_8rem_1fr_auto] sm:items-end sm:border-0 sm:p-0">
              <FormField control={control} name={`rates.${index}.flat_type_id`} label={index === 0 ? "Flat type" : undefined} render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={options.map((option) => ({ ...option, disabled: used.has(option.value) && option.value !== field.value }))} placeholder={flatTypes.isPending ? "Loading…" : "Flat type"} invalid={field.invalid} aria-label="Flat type" />} />
              <FormField control={control} name={`rates.${index}.mode`} label={index === 0 ? "Basis" : undefined} className="col-span-2 sm:col-span-1" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={(value) => field.onChange(value ?? "RATE")} options={[{ value: "RATE", label: "Per sq ft" }, { value: "LUMP", label: "Lump sum" }]} aria-label="Pricing basis" />} />
              {current?.mode === "LUMP" ? (
                <FormField control={control} name={`rates.${index}.lump_sum_paise`} label={index === 0 ? "Amount" : undefined} className="col-span-2 sm:col-span-1" render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} aria-label="Lump sum" />} />
              ) : (
                <FormField control={control} name={`rates.${index}.rate_per_sqft_paise`} label={index === 0 ? "Rate / sq ft" : undefined} className="col-span-2 sm:col-span-1" render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} showShort={false} aria-label="Rate per sq ft" />} />
              )}
              <IconButton icon={Trash2} label="Remove rate" size="sm" className="self-end" onClick={() => rates.remove(index)} />
            </div>
          );
        })}
        {error && (
          <p role="alert" className="text-xs font-medium text-danger-fg">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => rates.append({ flat_type_id: null, mode: "RATE", rate_per_sqft_paise: null, lump_sum_paise: null })} data-testid="rate-card-add-rate">
            Add flat type
          </Button>
          {flatTypes.data && flatTypes.data.some((type) => !used.has(type.id)) && (
            <Button variant="ghost" size="sm" onClick={addAll}>
              Add all flat types with base prices
            </Button>
          )}
        </div>
      </div>
    </FormSection>
  );
}

function PlcRulesRepeater({ open }: { open: boolean }) {
  const { control, setValue } = useFormContext<RateCardValues>();
  const rules = useFieldArray({ control, name: "plc_rules" });
  const watched = useWatch({ control, name: "plc_rules" }) ?? [];
  const plcTypes = useMasterRows<PlcTypeRow>("plc-types", { enabled: open });
  const byId = new Map((plcTypes.data ?? []).map((type) => [type.id, type] as const));
  const options = (plcTypes.data ?? []).map((type) => ({ value: type.id, label: type.name, description: PLC_CALC_MODE_LABELS[type.calc_mode] }));

  return (
    <FormSection title="PLC rules" description="Preferential location charges applied when a flat satisfies the condition.">
      <div className="space-y-3">
        {rules.fields.map((item, index) => {
          const current = watched[index];
          const isPercent = current?.calc_mode === "PERCENT";
          return (
            <div key={item.id} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end">
                <FormField
                  control={control}
                  name={`plc_rules.${index}.plc_type_id`}
                  label="PLC type"
                  render={({ field }) => (
                    <Select
                      id={field.id}
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        const type = value ? byId.get(value) : undefined;
                        if (type) setValue(`plc_rules.${index}.calc_mode`, type.calc_mode, { shouldDirty: true });
                      }}
                      options={options}
                      placeholder={plcTypes.isPending ? "Loading…" : "PLC type"}
                      invalid={field.invalid}
                    />
                  )}
                />
                <FormField control={control} name={`plc_rules.${index}.calc_mode`} label="Calculation" className="col-span-2 sm:col-span-1" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={PLC_CALC_MODES.map((value) => ({ value, label: PLC_CALC_MODE_LABELS[value] }))} invalid={field.invalid} />} />
                {isPercent ? (
                  <FormField control={control} name={`plc_rules.${index}.value_percent`} label="Percent of base" className="col-span-2 sm:col-span-1" render={({ field }) => <PercentInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />} />
                ) : (
                  <FormField control={control} name={`plc_rules.${index}.value_paise`} label={current?.calc_mode === "FIXED" ? "Amount" : "Amount per sq ft"} className="col-span-2 sm:col-span-1" render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} showShort={false} />} />
                )}
                <IconButton icon={Trash2} label="Remove rule" size="sm" className="self-end" onClick={() => rules.remove(index)} />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
                <FormField control={control} name={`plc_rules.${index}.applies_to`} label="Applies to" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={(value) => field.onChange(value ?? "ALL")} options={PLC_APPLIES_TOS.map((value) => ({ value, label: PLC_APPLIES_TO_LABELS[value] }))} />} />
                {current?.applies_to === "FLOORS_GTE" && <FormField control={control} name={`plc_rules.${index}.floors_gte`} label="Floor ≥" required render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={0} min={-5} max={200} allowNegative />} />}
                {current?.applies_to === "FACING_IN" && (
                  <FormField
                    control={control}
                    name={`plc_rules.${index}.facings`}
                    label="Facings"
                    required
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {FACING_OPTIONS.map((option) => {
                          const active = field.value.includes(option.value);
                          return (
                            <button key={option.value} type="button" aria-pressed={active} onClick={() => field.onChange(active ? field.value.filter((value: string) => value !== option.value) : [...field.value, option.value])} className={`h-7 rounded-full border px-2.5 text-xs font-medium focus-ring ${active ? "border-navy-950 bg-navy-950 text-white" : "border-border-strong text-ink-muted hover:border-navy-300"}`}>
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                )}
              </div>
            </div>
          );
        })}
        <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => rules.append({ plc_type_id: null, calc_mode: null, value_paise: null, value_percent: null, applies_to: "ALL", floors_gte: null, facings: [] })} data-testid="rate-card-add-rule">
          Add PLC rule
        </Button>
      </div>
    </FormSection>
  );
}
