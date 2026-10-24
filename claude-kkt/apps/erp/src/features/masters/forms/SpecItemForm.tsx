import { useFormContext } from "react-hook-form";
import type { SpecCategoryRow } from "@kkt/contracts";
import { Combobox, FormField, FormRow, Input, NumberInput, Textarea } from "@/components/ui";
import { useMasterRows } from "../api";
import type { MasterFormProps } from "../types";

export interface SpecItemValues {
  category_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
}

/** Specification items: belong to a category, carry an optional description. */
export function SpecItemForm(_props: MasterFormProps) {
  const { control } = useFormContext<SpecItemValues>();
  const categories = useMasterRows<SpecCategoryRow>("spec-categories", { sort: "sort_order" });
  const options = (categories.data ?? []).map((category) => ({ value: category.id, label: category.name }));

  return (
    <div className="space-y-4">
      <FormRow columns={2}>
        <FormField
          control={control}
          name="category_id"
          label="Category"
          required
          hint={categories.isError ? "Could not load categories" : undefined}
          render={({ field }) => (
            <Combobox id={field.id} value={field.value} onValueChange={(value) => field.onChange(value)} options={options} placeholder={categories.isPending ? "Loading…" : "Select a category"} emptyText="No categories yet" invalid={field.invalid} aria-describedby={field["aria-describedby"]} data-testid="field-category-id" />
          )}
        />
        <FormField
          control={control}
          name="name"
          label="Item"
          required
          render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="Vitrified tiles 600×600" maxLength={120} data-testid="field-name" />}
        />
        <FormField
          control={control}
          name="sort_order"
          label="Sort order"
          render={({ field }) => <NumberInput id={field.id} ref={field.ref} value={field.value} onChange={(value) => field.onChange(value ?? 0)} onBlur={field.onBlur} decimals={0} min={0} max={10_000} data-testid="field-sort-order" />}
        />
        <FormField
          control={control}
          name="description"
          label="Description"
          className="sm:col-span-2"
          render={({ field }) => <Textarea {...field} value={field.value ?? ""} onChange={(event) => field.onChange(event.target.value || null)} placeholder="Brand, grade, finish…" maxLength={2000} rows={3} data-testid="field-description" />}
        />
      </FormRow>
    </div>
  );
}
