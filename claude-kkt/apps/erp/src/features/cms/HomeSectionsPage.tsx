import type { ColumnDef } from "@tanstack/react-table";
import { LayoutList, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useFieldArray, type Control } from "react-hook-form";
import { CmsHomeSectionCreateSchema, CmsHomeSectionUpdateSchema, type CmsHomeSectionRow } from "@kkt/contracts";
import { z } from "zod";
import { Badge, Button, FormField, FormRow, IconButton, Input, NumberInput, Switch, Textarea } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { CmsCollectionPage } from "./CmsCollectionPage";
import { nullable } from "./api";

interface BodyRow {
  key: string;
  value: string;
}

interface SectionValues {
  key: string;
  title: string;
  body_rows: BodyRow[];
  sort_order: number | null;
  is_active: boolean;
}

/** "true" → true, "12" → 12, '{"a":1}' → object, anything else stays a string. */
export function parseLooseValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function stringifyLoose(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

const toBody = z.looseObject({}).transform((raw): unknown => {
  const values = raw as unknown as SectionValues;
  const body: Record<string, unknown> = {};
  for (const row of values.body_rows) {
    const key = row.key.trim();
    if (key) body[key] = parseLooseValue(row.value);
  }
  return {
    key: values.key.trim().toLowerCase(),
    title: nullable(values.title),
    body,
    sort_order: values.sort_order ?? 0,
    is_active: values.is_active,
  };
});

const CreateSchema = toBody.pipe(CmsHomeSectionCreateSchema);
const UpdateSchema = toBody.pipe(CmsHomeSectionUpdateSchema.omit({ version: true }));

function BodyEditor({ control, disabled }: { control: Control<SectionValues>; disabled: boolean }) {
  const rows = useFieldArray({ control, name: "body_rows" });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">Content fields</p>
          <p className="text-xs text-ink-subtle">
            Key → value pairs the website template reads. Numbers, true/false and JSON values are parsed; everything
            else is text.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          leftIcon={Plus}
          disabled={disabled}
          onClick={() => rows.append({ key: "", value: "" })}
          data-testid="section-add-field"
        >
          Add field
        </Button>
      </div>
      {rows.fields.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-ink-subtle">
          No fields yet.
        </p>
      )}
      <ul className="space-y-2">
        {rows.fields.map((item, index) => (
          <li key={item.id} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[12rem_1fr_auto]">
            <FormField
              control={control}
              name={`body_rows.${index}.key`}
              render={({ field }) => (
                <Input
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="heading"
                  className="font-mono text-xs"
                  aria-label="Field key"
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
            <FormField
              control={control}
              name={`body_rows.${index}.value`}
              className="col-span-2 sm:col-span-1"
              render={({ field }) => (
                <Textarea
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  rows={2}
                  placeholder="Value"
                  aria-label="Field value"
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
            <IconButton
              icon={Trash2}
              label="Remove field"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => rows.remove(index)}
              className="row-start-1 sm:row-auto"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HomeSectionsPage() {
  const columns = useMemo<ColumnDef<CmsHomeSectionRow, unknown>[]>(
    () => [
      {
        accessorKey: "key",
        header: "Key",
        meta: { locked: true },
        cell: ({ row }) => (
          <code className="rounded-xs bg-navy-50 px-1 py-0.5 font-mono text-xs text-navy-950">{row.original.key}</code>
        ),
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => row.original.title ?? <span className="text-ink-subtle">—</span>,
      },
      {
        id: "fields",
        header: "Fields",
        meta: { sortKey: false },
        cell: ({ row }) => (
          <Badge variant="outline" numeric>
            {formatNumber(Object.keys(row.original.body).length)} fields
          </Badge>
        ),
      },
      { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 80 } },
    ],
    [],
  );

  return (
    <CmsCollectionPage<CmsHomeSectionRow, SectionValues>
      title="Home sections"
      singular="Section"
      description="Ordered blocks of the home page (trust strip, value props, video…). Each section is a key the website template knows plus its content fields."
      icon={LayoutList}
      path="/cms/home-sections"
      defaultSort="sort_order"
      columns={columns}
      schema={CreateSchema}
      updateSchema={UpdateSchema}
      flagKey="is_active"
      defaultValues={() => ({ key: "", title: "", body_rows: [], sort_order: 0, is_active: true })}
      toValues={(row) => ({
        key: row.key,
        title: row.title ?? "",
        body_rows: Object.entries(row.body).map(([key, value]) => ({ key, value: stringifyLoose(value) })),
        sort_order: row.sort_order,
        is_active: row.is_active,
      })}
      emptyDescription="Add sections such as trust_strip, value_props or walkthrough in the order they appear."
      fields={({ control, row, disabled }) => (
        <>
          <FormRow>
            <FormField
              control={control}
              name="key"
              label="Key"
              required
              hint="Lower-case letters, digits and underscores"
              render={({ field }) => (
                <Input
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  maxLength={40}
                  placeholder="trust_strip"
                  className="font-mono"
                  invalid={field.invalid}
                  disabled={disabled || row !== null}
                />
              )}
            />
            <FormField
              control={control}
              name="title"
              label="Title"
              render={({ field }) => (
                <Input
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  maxLength={120}
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
          </FormRow>
          <BodyEditor control={control} disabled={disabled} />
          <FormRow>
            <FormField
              control={control}
              name="sort_order"
              label="Sort order"
              render={({ field }) => (
                <NumberInput
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  min={0}
                  max={1000}
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
            <FormField
              control={control}
              name="is_active"
              label="Visibility"
              render={({ field }) => (
                <Switch
                  id={field.id}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  label="Active"
                  disabled={disabled}
                />
              )}
            />
          </FormRow>
        </>
      )}
    />
  );
}
