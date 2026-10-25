import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, FileStack } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { CmsPageCreateSchema, CmsPageUpdateSchema, type CmsPageRow } from "@kkt/contracts";
import { z } from "zod";
import { DropdownMenuItem, FormField, FormRow, FormSection, Input, Switch } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { controlOf } from "@/features/inventory/components";
import { CmsCollectionPage } from "./CmsCollectionPage";
import { MarkdownEditor } from "./Markdown";
import { EMPTY_SEO, PublishedChip, SeoFields, seoToPayload, seoToValues, type SeoValues } from "./components";
import { slugify, websiteUrl } from "./api";

interface PageValues {
  slug: string;
  title: string;
  body_md: string;
  is_published: boolean;
  seo: SeoValues;
}

const toBody = z.looseObject({}).transform((raw): unknown => {
  const values = raw as unknown as PageValues;
  return { slug: values.slug.trim().toLowerCase(), title: values.title.trim(), body_md: values.body_md, is_published: values.is_published, seo: seoToPayload(values.seo) };
});

const CreateSchema = toBody.pipe(CmsPageCreateSchema);
const UpdateSchema = toBody.pipe(CmsPageUpdateSchema.omit({ version: true }));

/** Keeps the slug in step with the title until the slug is edited by hand (create mode only). */
function useAutoSlug(form: UseFormReturn<PageValues, unknown, unknown>, enabled: boolean) {
  const title = useWatch({ control: form.control, name: "title" });
  useEffect(() => {
    if (!enabled || form.getFieldState("slug").isDirty) return;
    form.setValue("slug", slugify(title ?? ""), { shouldValidate: false });
  }, [title, enabled, form]);
}

function PageFields({ form, row, disabled }: { form: UseFormReturn<PageValues, unknown, unknown>; row: CmsPageRow | null; disabled: boolean }) {
  useAutoSlug(form, row === null);
  const control = controlOf(form);
  return (
    <>
      <FormRow>
        <FormField control={control} name="title" label="Title" required render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={160} invalid={field.invalid} disabled={disabled} />} />
        <FormField control={control} name="slug" label="Slug" required hint="Lower-case letters, digits and hyphens; forms the URL /slug" render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={120} prefix="/" className="font-mono" invalid={field.invalid} disabled={disabled} />} />
      </FormRow>
      <FormField control={control} name="body_md" label="Content" required render={({ field }) => <MarkdownEditor id={field.id} value={field.value} onChange={field.onChange} invalid={field.invalid} disabled={disabled} rows={16} />} />
      <FormField control={control} name="is_published" label="Visibility" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Published" description="Unpublished pages return 404 on the website" disabled={disabled} />} />
      <FormSection title="SEO">
        <SeoFields control={control} prefix="seo" disabled={disabled} />
      </FormSection>
    </>
  );
}

export default function PagesPage() {
  const columns = useMemo<ColumnDef<CmsPageRow, unknown>[]>(
    () => [
      { accessorKey: "title", header: "Page", meta: { locked: true }, cell: ({ row }) => <span className="font-medium">{row.original.title}</span> },
      { accessorKey: "slug", header: "URL", cell: ({ row }) => <code className="rounded-xs bg-navy-50 px-1 py-0.5 font-mono text-xs text-navy-950">/{row.original.slug}</code> },
      { accessorKey: "is_published", header: "Status", cell: ({ row }) => <PublishedChip published={row.original.is_published} /> },
      { accessorKey: "updated_at", header: "Updated", meta: { hideOnMobile: true }, cell: ({ row }) => <span className="money text-ink-muted">{formatDateTime(row.original.updated_at)}</span> },
    ],
    [],
  );

  return (
    <CmsCollectionPage<CmsPageRow, PageValues>
      title="Pages"
      singular="Page"
      description="Legal and static pages (privacy, disclaimer, terms, about copy) written in Markdown."
      icon={FileStack}
      path="/cms/pages"
      defaultSort="title"
      sheetSize="xl"
      columns={columns}
      schema={CreateSchema}
      updateSchema={UpdateSchema}
      flagKey="is_published"
      defaultValues={() => ({ slug: "", title: "", body_md: "", is_published: false, seo: { ...EMPTY_SEO } })}
      toValues={(row) => ({ slug: row.slug, title: row.title, body_md: row.body_md, is_published: row.is_published, seo: seoToValues(row.seo) })}
      emptyDescription="Start with Privacy policy and RERA disclaimer; the website footer links to them."
      rowActions={(row) => {
        const href = websiteUrl(`/${row.slug}`);
        return href && row.is_published ? (
          <DropdownMenuItem asChild>
            <a href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open on site
            </a>
          </DropdownMenuItem>
        ) : null;
      }}
      fields={({ form, row, disabled }) => <PageFields form={form} row={row} disabled={disabled} />}
    />
  );
}
