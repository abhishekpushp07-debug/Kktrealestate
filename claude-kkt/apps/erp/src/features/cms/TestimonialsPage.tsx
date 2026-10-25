import type { ColumnDef } from "@tanstack/react-table";
import { MessageSquareQuote, Star } from "lucide-react";
import { useMemo } from "react";
import { CmsTestimonialCreateSchema, CmsTestimonialUpdateSchema, type CmsTestimonialRow } from "@kkt/contracts";
import { z } from "zod";
import { Avatar, Combobox, FormField, FormRow, Input, NumberInput, Select, Switch, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { searchCustomers } from "@/features/crm/api";
import { useProjectOptions } from "@/features/shared/options";
import { CmsCollectionPage } from "./CmsCollectionPage";
import { MediaPicker, PublishedChip } from "./components";
import { publicMediaUrl } from "./api";

interface TestimonialValues {
  customer_id: string | null;
  customer_label: string;
  name: string;
  project_id: string | null;
  quote: string;
  rating: string | null;
  photo_document_id: string | null;
  is_published: boolean;
  sort_order: number | null;
}

const toBody = z.looseObject({}).transform((raw): unknown => {
  const values = raw as unknown as TestimonialValues;
  return {
    customer_id: values.customer_id || null,
    name: values.name.trim(),
    project_id: values.project_id || null,
    quote: values.quote.trim(),
    rating: values.rating ? Number(values.rating) : null,
    photo_document_id: values.photo_document_id,
    is_published: values.is_published,
    sort_order: values.sort_order ?? 0,
  };
});

const CreateSchema = toBody.pipe(CmsTestimonialCreateSchema);
const UpdateSchema = toBody.pipe(CmsTestimonialUpdateSchema.omit({ version: true }));
const RATING_OPTIONS = ["5", "4", "3", "2", "1"].map((value) => ({ value, label: `${value} ★` }));

export function Stars({ rating, className }: { rating: number | null; className?: string }) {
  if (rating === null) return <span className="text-ink-subtle">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} className={cn("size-3.5", star <= rating ? "fill-gold text-gold" : "text-border-strong")} aria-hidden="true" />
      ))}
    </span>
  );
}

export default function TestimonialsPage() {
  const projects = useProjectOptions();
  const projectOptions = useMemo(() => (projects.data ?? []).map((project) => ({ value: project.id, label: project.name })), [projects.data]);

  const columns = useMemo<ColumnDef<CmsTestimonialRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Customer",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.original.name} src={row.original.photo_url ?? publicMediaUrl(row.original.photo_document_id, "thumb")} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{row.original.name}</span>
              {row.original.customer_id && <span className="block text-2xs text-ink-subtle">Linked customer</span>}
            </span>
          </span>
        ),
      },
      { accessorKey: "project_name", header: "Project", cell: ({ row }) => row.original.project_name ?? <span className="text-ink-subtle">All projects</span> },
      { accessorKey: "quote", header: "Quote", meta: { sortKey: false }, cell: ({ row }) => <span className="block max-w-[24rem] truncate text-ink-muted" title={row.original.quote}>“{row.original.quote}”</span> },
      { accessorKey: "rating", header: "Rating", cell: ({ row }) => <Stars rating={row.original.rating} /> },
      { accessorKey: "is_published", header: "Status", cell: ({ row }) => <PublishedChip published={row.original.is_published} /> },
      { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 80 } },
    ],
    [],
  );

  return (
    <CmsCollectionPage<CmsTestimonialRow, TestimonialValues>
      title="Testimonials"
      singular="Testimonial"
      description="Buyer quotes shown on the home page and project pages. Link a customer record or type a free name."
      icon={MessageSquareQuote}
      path="/cms/testimonials"
      defaultSort="sort_order"
      columns={columns}
      schema={CreateSchema}
      updateSchema={UpdateSchema}
      flagKey="is_published"
      defaultValues={() => ({ customer_id: null, customer_label: "", name: "", project_id: null, quote: "", rating: "5", photo_document_id: null, is_published: false, sort_order: 0 })}
      toValues={(row) => ({ customer_id: row.customer_id, customer_label: row.customer_id ? row.name : "", name: row.name, project_id: row.project_id, quote: row.quote, rating: row.rating === null ? null : String(row.rating), photo_document_id: row.photo_document_id, is_published: row.is_published, sort_order: row.sort_order })}
      emptyDescription="Collect a quote from a happy buyer; publish it when it is approved."
      fields={({ control, form, row, disabled }) => (
        <>
          <FormField
            control={control}
            name="customer_id"
            label="Customer record"
            hint="Optional; picking one fills the name."
            render={({ field }) => (
              <Combobox
                id={field.id}
                value={field.value}
                onValueChange={(value, option) => {
                  field.onChange(value);
                  form.setValue("customer_label", option?.label ?? "");
                  if (option && !form.getValues("name").trim()) form.setValue("name", option.label);
                }}
                onSearch={searchCustomers}
                selectedLabel={form.watch("customer_label") || undefined}
                placeholder="Search customers…"
                allowClear
                disabled={disabled}
              />
            )}
          />
          <FormRow>
            <FormField control={control} name="name" label="Display name" required render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={120} invalid={field.invalid} disabled={disabled} />} />
            <FormField control={control} name="project_id" label="Project" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={projectOptions} placeholder="All projects" allowClear invalid={field.invalid} disabled={disabled} />} />
          </FormRow>
          <FormField control={control} name="quote" label="Quote" required hint="10–1000 characters" render={({ field }) => <Textarea id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} rows={4} maxLength={1000} invalid={field.invalid} disabled={disabled} />} />
          <FormRow columns={3}>
            <FormField control={control} name="rating" label="Rating" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={RATING_OPTIONS} placeholder="No rating" allowClear invalid={field.invalid} disabled={disabled} />} />
            <FormField control={control} name="sort_order" label="Sort order" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} min={0} max={1000} invalid={field.invalid} disabled={disabled} />} />
            <FormField control={control} name="is_published" label="Status" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Published" disabled={disabled} />} />
          </FormRow>
          <FormField control={control} name="photo_document_id" label="Photo" render={({ field }) => <MediaPicker id={field.id} value={field.value} onChange={field.onChange} previewUrl={row?.photo_document_id === field.value ? row.photo_url : null} aspect="square" label="Upload photo" disabled={disabled} />} />
        </>
      )}
    />
  );
}
