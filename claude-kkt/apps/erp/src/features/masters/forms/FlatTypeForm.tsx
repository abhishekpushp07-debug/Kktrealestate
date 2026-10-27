import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import {
  AREA_TYPE_CODE_LABELS,
  STRUCTURAL_AREA_CODES,
  type AreaTypeRow,
  type RoomTypeRow,
  type SpecItemRow,
} from "@kkt/contracts";
import {
  Button,
  FormField,
  FormRow,
  FormSection,
  IconButton,
  Input,
  MoneyInput,
  MultiSelect,
  NumberInput,
  RadioGroup,
  Select,
  Textarea,
} from "@/components/ui";
import { formatSqft } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMasterRows } from "../api";
import type { MasterFormProps } from "../types";

export type PricingMode = "NONE" | "RATE" | "LUMP_SUM";

export interface RoomValues {
  room_type_id: string | null;
  label: string;
  length_ft: number | null;
  width_ft: number | null;
  sqft: number | null;
}

export interface AreaValues {
  area_type_id: string | null;
  sqft: number | null;
}

export interface FlatTypeValues {
  name: string;
  code: string;
  bhk: number | null;
  facing: string | null;
  description: string | null;
  rooms: RoomValues[];
  areas: AreaValues[];
  pricing_mode: PricingMode;
  base_rate_per_sqft_paise: number | null;
  base_price_paise: number | null;
  spec_item_ids: string[];
}

export const FACING_OPTIONS = [
  "North",
  "South",
  "East",
  "West",
  "North-East",
  "North-West",
  "South-East",
  "South-West",
].map((value) => ({ value, label: value }));

const PRICING_OPTIONS: ReadonlyArray<{ value: PricingMode; label: string; description: string }> = [
  { value: "NONE", label: "No base price", description: "Priced on the rate card only" },
  { value: "RATE", label: "Rate per sq ft", description: "× super built-up area" },
  { value: "LUMP_SUM", label: "Lump-sum price", description: "One all-in base price" },
];

/** L × W rounded to 2 dp. */
export function roomSqft(length: number | null, width: number | null): number | null {
  if (length === null || width === null || length <= 0 || width <= 0) return null;
  return Math.round(length * width * 100) / 100;
}

export interface AreaCheck {
  carpet: number | null;
  builtUp: number | null;
  superBuiltUp: number | null;
  /** Human-readable violations of super ≥ built-up ≥ carpet. */
  problems: string[];
}

/** Live super ≥ built-up ≥ carpet check given area rows and the area-type code lookup. */
export function checkStructuralAreas(
  areas: readonly AreaValues[],
  codeOf: (areaTypeId: string) => string | undefined,
): AreaCheck {
  const byCode = new Map<string, number>();
  for (const area of areas) {
    if (!area.area_type_id || area.sqft === null) continue;
    const code = codeOf(area.area_type_id);
    if (code) byCode.set(code, area.sqft);
  }
  const [carpetCode, builtUpCode, superCode] = STRUCTURAL_AREA_CODES;
  const carpet = byCode.get(carpetCode) ?? null;
  const builtUp = byCode.get(builtUpCode) ?? null;
  const superBuiltUp = byCode.get(superCode) ?? null;
  const problems: string[] = [];
  if (builtUp !== null && carpet !== null && builtUp < carpet) problems.push("Built-up must be ≥ carpet");
  if (superBuiltUp !== null && builtUp !== null && superBuiltUp < builtUp)
    problems.push("Super built-up must be ≥ built-up");
  if (superBuiltUp !== null && carpet !== null && builtUp === null && superBuiltUp < carpet)
    problems.push("Super built-up must be ≥ carpet");
  return { carpet, builtUp, superBuiltUp, problems };
}

const EMPTY_ROOM: RoomValues = { room_type_id: null, label: "", length_ft: null, width_ft: null, sqft: null };
const EMPTY_AREA: AreaValues = { area_type_id: null, sqft: null };

/** Flat type: BHK, facing, rooms (auto sq ft), areas (super ≥ built-up ≥ carpet) and specifications. */
export function FlatTypeForm(_props: MasterFormProps) {
  const { control, setValue, getValues, formState } = useFormContext<FlatTypeValues>();
  const rooms = useFieldArray({ control, name: "rooms" });
  const areas = useFieldArray({ control, name: "areas" });
  const roomTypes = useMasterRows<RoomTypeRow>("room-types", { sort: "sort_order" });
  const areaTypes = useMasterRows<AreaTypeRow>("area-types", { sort: "sort_order" });
  const specItems = useMasterRows<SpecItemRow>("spec-items", { sort: "sort_order" });

  const pricingMode = useWatch({ control, name: "pricing_mode" });
  const watchedRooms = useWatch({ control, name: "rooms" });
  const watchedAreas = useWatch({ control, name: "areas" });

  const roomTypeOptions = useMemo(
    () => (roomTypes.data ?? []).map((type) => ({ value: type.id, label: type.name })),
    [roomTypes.data],
  );
  const areaTypeOptions = useMemo(
    () => (areaTypes.data ?? []).map((type) => ({ value: type.id, label: `${type.name} (${type.code})` })),
    [areaTypes.data],
  );
  const areaCodeById = useMemo(
    () => new Map((areaTypes.data ?? []).map((type) => [type.id, type.code] as const)),
    [areaTypes.data],
  );
  const specOptions = useMemo(
    () =>
      [...(specItems.data ?? [])]
        .sort((a, b) => a.category_name.localeCompare(b.category_name) || a.sort_order - b.sort_order)
        .map((item) => ({
          value: item.id,
          label: item.name,
          description: item.category_name,
          keywords: [item.category_name],
        })),
    [specItems.data],
  );

  const totalRoomSqft = (watchedRooms ?? []).reduce((sum, room) => sum + (room.sqft ?? 0), 0);
  const areaCheck = checkStructuralAreas(watchedAreas ?? [], (id) => areaCodeById.get(id));
  const usedAreaTypes = new Set(
    (watchedAreas ?? []).map((area) => area.area_type_id).filter((id): id is string => Boolean(id)),
  );

  /** Recomputes sq ft after a dimension change unless the user overrode it. */
  const updateDimension = (index: number, key: "length_ft" | "width_ft", value: number | null) => {
    const current = getValues(`rooms.${index}`);
    const previousAuto = roomSqft(current.length_ft, current.width_ft);
    const wasAuto = current.sqft === null || current.sqft === previousAuto;
    setValue(`rooms.${index}.${key}`, value, { shouldDirty: true });
    if (wasAuto) {
      const next = { ...current, [key]: value };
      setValue(`rooms.${index}.sqft`, roomSqft(next.length_ft, next.width_ft), { shouldDirty: true });
    }
  };

  const roomsError = formState.errors.rooms?.root?.message ?? formState.errors.rooms?.message;
  const areasError = formState.errors.areas?.root?.message ?? formState.errors.areas?.message;

  return (
    <div className="space-y-6">
      <FormSection title="Identity">
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
                placeholder="3BHK-A"
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
                placeholder="3BHK_A"
                maxLength={30}
                className="font-mono uppercase"
                data-testid="field-code"
              />
            )}
          />
          <FormField
            control={control}
            name="bhk"
            label="BHK"
            required
            hint="Steps of 0.5 (1.5 = 1 BHK + study)"
            render={({ field }) => (
              <NumberInput
                id={field.id}
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                decimals={1}
                min={0}
                max={20}
                step={0.5}
                aria-invalid={field["aria-invalid"]}
                data-testid="field-bhk"
              />
            )}
          />
          <FormField
            control={control}
            name="facing"
            label="Facing"
            render={({ field }) => (
              <Select
                id={field.id}
                value={field.value}
                onValueChange={field.onChange}
                options={FACING_OPTIONS}
                placeholder="Any"
                allowClear
                data-testid="field-facing"
              />
            )}
          />
          <FormField
            control={control}
            name="description"
            label="Description"
            className="sm:col-span-2"
            render={({ field }) => (
              <Textarea
                {...field}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                placeholder="Shown on the website configuration card"
                maxLength={2000}
                rows={2}
                data-testid="field-description"
              />
            )}
          />
        </FormRow>
      </FormSection>

      <FormSection title="Rooms" description="Sq ft defaults to length × width and stays editable.">
        <div className="space-y-2">
          <div className="hidden grid-cols-[1.2fr_1.2fr_4.5rem_4.5rem_5.5rem_2rem] gap-2 px-1 sm:grid">
            {["Room type", "Label", "L ft", "W ft", "Sq ft", ""].map((heading, index) => (
              <span key={index} className="label-caps truncate">
                {heading}
              </span>
            ))}
          </div>
          {rooms.fields.map((room, index) => (
            <div
              key={room.id}
              className="grid grid-cols-2 gap-2 rounded-md border border-border bg-card p-2 sm:grid-cols-[1.2fr_1.2fr_4.5rem_4.5rem_5.5rem_2rem] sm:items-start sm:border-0 sm:bg-transparent sm:p-0"
            >
              <FormField
                control={control}
                name={`rooms.${index}.room_type_id`}
                className="col-span-2 sm:col-span-1"
                render={({ field }) => (
                  <Select
                    id={field.id}
                    value={field.value}
                    onValueChange={field.onChange}
                    options={roomTypeOptions}
                    placeholder={roomTypes.isPending ? "Loading…" : "Room type"}
                    invalid={field.invalid}
                    aria-label="Room type"
                    data-testid={`room-${index}-type`}
                  />
                )}
              />
              <FormField
                control={control}
                name={`rooms.${index}.label`}
                className="col-span-2 sm:col-span-1"
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    placeholder="Master Bedroom"
                    maxLength={120}
                    aria-label="Room label"
                    data-testid={`room-${index}-label`}
                  />
                )}
              />
              <FormField
                control={control}
                name={`rooms.${index}.length_ft`}
                render={({ field }) => (
                  <NumberInput
                    id={field.id}
                    value={field.value}
                    onChange={(value) => updateDimension(index, "length_ft", value)}
                    onBlur={field.onBlur}
                    decimals={2}
                    min={0}
                    max={999}
                    placeholder="L"
                    aria-label="Length in feet"
                    aria-invalid={field["aria-invalid"]}
                    data-testid={`room-${index}-length`}
                  />
                )}
              />
              <FormField
                control={control}
                name={`rooms.${index}.width_ft`}
                render={({ field }) => (
                  <NumberInput
                    id={field.id}
                    value={field.value}
                    onChange={(value) => updateDimension(index, "width_ft", value)}
                    onBlur={field.onBlur}
                    decimals={2}
                    min={0}
                    max={999}
                    placeholder="W"
                    aria-label="Width in feet"
                    aria-invalid={field["aria-invalid"]}
                    data-testid={`room-${index}-width`}
                  />
                )}
              />
              <FormField
                control={control}
                name={`rooms.${index}.sqft`}
                render={({ field }) => (
                  <NumberInput
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    decimals={2}
                    min={0}
                    placeholder="sq ft"
                    aria-label="Square feet"
                    aria-invalid={field["aria-invalid"]}
                    className="font-semibold"
                    data-testid={`room-${index}-sqft`}
                  />
                )}
              />
              <div className="flex justify-end sm:pt-0.5">
                <IconButton
                  icon={Trash2}
                  label="Remove room"
                  size="sm"
                  variant="ghost"
                  className="text-ink-subtle hover:text-danger-fg"
                  disabled={rooms.fields.length <= 1}
                  onClick={() => rooms.remove(index)}
                  data-testid={`room-${index}-remove`}
                />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={Plus}
              onClick={() => rooms.append({ ...EMPTY_ROOM })}
              data-testid="add-room-btn"
            >
              Add room
            </Button>
            <span className="money text-xs text-ink-subtle">
              {rooms.fields.length} room{rooms.fields.length === 1 ? "" : "s"} · {formatSqft(totalRoomSqft)}
            </span>
          </div>
          {roomsError && (
            <p role="alert" className="text-xs font-medium text-danger-fg">
              {roomsError}
            </p>
          )}
        </div>
      </FormSection>

      <FormSection title="Areas" description="Each area type once; super built-up ≥ built-up ≥ carpet.">
        <div className="space-y-2">
          {areas.fields.map((area, index) => (
            <div key={area.id} className="grid grid-cols-[1fr_7rem_2rem] items-start gap-2">
              <FormField
                control={control}
                name={`areas.${index}.area_type_id`}
                render={({ field }) => (
                  <Select
                    id={field.id}
                    value={field.value}
                    onValueChange={field.onChange}
                    options={areaTypeOptions.map((option) => ({
                      ...option,
                      disabled: usedAreaTypes.has(option.value) && option.value !== field.value,
                    }))}
                    placeholder={areaTypes.isPending ? "Loading…" : "Area type"}
                    invalid={field.invalid}
                    aria-label="Area type"
                    data-testid={`area-${index}-type`}
                  />
                )}
              />
              <FormField
                control={control}
                name={`areas.${index}.sqft`}
                render={({ field }) => (
                  <NumberInput
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    decimals={2}
                    min={0}
                    placeholder="sq ft"
                    aria-label="Square feet"
                    aria-invalid={field["aria-invalid"]}
                    data-testid={`area-${index}-sqft`}
                  />
                )}
              />
              <IconButton
                icon={Trash2}
                label="Remove area"
                size="sm"
                variant="ghost"
                className="mt-0.5 text-ink-subtle hover:text-danger-fg"
                disabled={areas.fields.length <= 1}
                onClick={() => areas.remove(index)}
                data-testid={`area-${index}-remove`}
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={Plus}
              onClick={() => areas.append({ ...EMPTY_AREA })}
              disabled={areaTypeOptions.length > 0 && usedAreaTypes.size >= areaTypeOptions.length}
              data-testid="add-area-btn"
            >
              Add area
            </Button>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {STRUCTURAL_AREA_CODES.map((code) => {
                const value =
                  code === "CARPET"
                    ? areaCheck.carpet
                    : code === "BUILT_UP"
                      ? areaCheck.builtUp
                      : areaCheck.superBuiltUp;
                return (
                  <span key={code} className={cn("money", value === null ? "text-ink-subtle" : "text-ink")}>
                    {AREA_TYPE_CODE_LABELS[code]}: <strong>{value === null ? "—" : formatSqft(value)}</strong>
                  </span>
                );
              })}
            </div>
          </div>
          {areaCheck.problems.length > 0 && (
            <ul
              role="alert"
              className="space-y-0.5 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-xs font-medium text-danger-fg"
            >
              {areaCheck.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {areasError && !areaCheck.problems.includes(areasError) && (
            <p role="alert" className="text-xs font-medium text-danger-fg">
              {areasError}
            </p>
          )}
        </div>
      </FormSection>

      <FormSection title="Base pricing" description="Optional. Give a rate per sq ft or a lump-sum price, not both.">
        <FormField
          control={control}
          name="pricing_mode"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              options={PRICING_OPTIONS}
              inline
              cards
              data-testid="field-pricing-mode"
            />
          )}
        />
        {pricingMode === "RATE" && (
          <FormField
            control={control}
            name="base_rate_per_sqft_paise"
            label="Base rate per sq ft"
            required
            render={({ field }) => (
              <MoneyInput
                id={field.id}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                showShort={false}
                aria-invalid={field["aria-invalid"]}
                className="sm:max-w-xs"
                data-testid="field-base-rate"
              />
            )}
          />
        )}
        {pricingMode === "LUMP_SUM" && (
          <FormField
            control={control}
            name="base_price_paise"
            label="Lump-sum base price"
            required
            render={({ field }) => (
              <MoneyInput
                id={field.id}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={field["aria-invalid"]}
                className="sm:max-w-xs"
                data-testid="field-base-price"
              />
            )}
          />
        )}
      </FormSection>

      <FormSection
        title="Specifications"
        description="Items shown under this configuration on the website and in the allotment letter."
      >
        <FormField
          control={control}
          name="spec_item_ids"
          render={({ field }) => (
            <MultiSelect
              id={field.id}
              value={field.value}
              onValueChange={field.onChange}
              options={specOptions}
              placeholder={specItems.isPending ? "Loading…" : "Pick specification items"}
              searchPlaceholder="Search items or categories…"
              maxChips={6}
              aria-label="Specification items"
              data-testid="field-spec-items"
            />
          )}
        />
      </FormSection>
    </div>
  );
}
