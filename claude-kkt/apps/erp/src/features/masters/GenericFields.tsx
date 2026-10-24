import { useFormContext, type FieldValues } from "react-hook-form";
import { FormField, FormRow, Input, NumberInput, Select, Switch, Textarea } from "@/components/ui";
import type { FieldDef } from "./types";

export interface GenericFieldsProps<Values extends FieldValues> {
  fields: readonly FieldDef<Values>[];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Renders declarative field definitions inside a two-column form grid. */
export function GenericFields<Values extends FieldValues>({ fields }: GenericFieldsProps<Values>) {
  const { control } = useFormContext<Values>();
  return (
    <FormRow columns={2}>
      {fields.map((def) => {
        const className = def.full ? "sm:col-span-2" : undefined;
        switch (def.type) {
          case "text":
          case "code":
            return (
              <FormField
                key={def.name}
                control={control}
                name={def.name}
                label={def.label}
                hint={def.hint}
                required={def.required}
                className={className}
                render={({ field }) => (
                  <Input
                    id={field.id}
                    ref={field.ref}
                    name={field.name}
                    value={asText(field.value)}
                    onBlur={field.onBlur}
                    onChange={(event) => {
                      const raw = def.type === "code" ? event.target.value.toUpperCase() : event.target.value;
                      field.onChange(def.nullable && raw === "" ? null : raw);
                    }}
                    placeholder={def.placeholder}
                    maxLength={def.maxLength ?? (def.type === "code" ? 30 : 120)}
                    autoCapitalize={def.type === "code" ? "characters" : undefined}
                    className={def.type === "code" ? "font-mono uppercase" : undefined}
                    aria-invalid={field["aria-invalid"]}
                    aria-describedby={field["aria-describedby"]}
                    aria-required={field["aria-required"]}
                    data-testid={`field-${def.name.replaceAll(".", "-")}`}
                  />
                )}
              />
            );
          case "textarea":
            return (
              <FormField
                key={def.name}
                control={control}
                name={def.name}
                label={def.label}
                hint={def.hint}
                required={def.required}
                className={className ?? "sm:col-span-2"}
                render={({ field }) => (
                  <Textarea
                    id={field.id}
                    ref={field.ref}
                    name={field.name}
                    value={asText(field.value)}
                    onBlur={field.onBlur}
                    onChange={(event) => field.onChange(def.nullable && event.target.value === "" ? null : event.target.value)}
                    placeholder={def.placeholder}
                    maxLength={def.maxLength ?? 2000}
                    aria-invalid={field["aria-invalid"]}
                    aria-describedby={field["aria-describedby"]}
                    data-testid={`field-${def.name.replaceAll(".", "-")}`}
                  />
                )}
              />
            );
          case "number":
            return (
              <FormField
                key={def.name}
                control={control}
                name={def.name}
                label={def.label}
                hint={def.hint}
                required={def.required}
                className={className}
                render={({ field }) => (
                  <NumberInput
                    id={field.id}
                    ref={field.ref}
                    name={field.name}
                    value={asNumber(field.value)}
                    onBlur={field.onBlur}
                    onChange={(value) => field.onChange(value ?? def.fallback ?? null)}
                    decimals={def.decimals ?? 0}
                    min={def.min}
                    max={def.max}
                    suffix={def.suffix}
                    aria-invalid={field["aria-invalid"]}
                    aria-describedby={field["aria-describedby"]}
                    data-testid={`field-${def.name.replaceAll(".", "-")}`}
                  />
                )}
              />
            );
          case "switch":
            return (
              <FormField
                key={def.name}
                control={control}
                name={def.name}
                className={className ?? "sm:col-span-2"}
                render={({ field }) => (
                  <Switch id={field.id} checked={field.value === true} onCheckedChange={field.onChange} label={def.label} description={def.description} data-testid={`field-${def.name.replaceAll(".", "-")}`} />
                )}
              />
            );
          case "select":
            return (
              <FormField
                key={def.name}
                control={control}
                name={def.name}
                label={def.label}
                hint={def.hint}
                required={def.required}
                className={className}
                render={({ field }) => (
                  <Select
                    id={field.id}
                    value={typeof field.value === "string" ? field.value : null}
                    onValueChange={field.onChange}
                    options={def.options}
                    placeholder={def.placeholder}
                    allowClear={def.allowClear}
                    invalid={field.invalid}
                    aria-describedby={field["aria-describedby"]}
                    data-testid={`field-${def.name.replaceAll(".", "-")}`}
                  />
                )}
              />
            );
        }
      })}
    </FormRow>
  );
}
