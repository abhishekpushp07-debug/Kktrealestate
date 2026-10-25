import type { ColumnDef } from "@tanstack/react-table";
import { Image as ImageIcon } from "lucide-react";
import { useMemo } from "react";
import { CmsBannerCreateSchema, CmsBannerUpdateSchema, type CmsBannerRow } from "@kkt/contracts";
import { z } from "zod";
import { Badge, FormField, FormRow, FormSection, Input, NumberInput, Switch } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CmsCollectionPage } from "./CmsCollectionPage";
import { DateTimeInput, MediaPicker } from "./components";
import { nullable, publicMediaUrl } from "./api";

interface BannerValues {
  title: string;
  subtitle: string;
  cta_label: string;
  cta_url: string;
  document_id: string | null;
  sort_order: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

const toBody = z.looseObject({}).transform((raw): unknown => {
  const values = raw as unknown as BannerValues;
  return {
    title: values.title.trim(),
    subtitle: nullable(values.subtitle),
    cta_label: nullable(values.cta_label),
    cta_url: nullable(values.cta_url),
    document_id: values.document_id,
    sort_order: values.sort_order ?? 0,
    starts_at: values.starts_at,
    ends_at: values.ends_at,
    is_active: values.is_active,
  };
});

const CreateSchema = toBody.pipe(CmsBannerCreateSchema);
const UpdateSchema = toBody.pipe(CmsBannerUpdateSchema.omit({ version: true }));

/** "Live", "Scheduled", "Expired" or "Inactive" for a banner at `now`. */
export function bannerSchedule(row: Pick<CmsBannerRow, "starts_at" | "ends_at" | "is_active">, now: Date = new Date()): { label: string; variant: "success" | "info" | "neutral" | "warning" } {
  if (!row.is_active) return { label: "Inactive", variant: "neutral" };
  const time = now.getTime();
  if (row.starts_at && Date.parse(row.starts_at) > time) return { label: "Scheduled", variant: "info" };
  if (row.ends_at && Date.parse(row.ends_at) < time) return { label: "Expired", variant: "warning" };
  return { label: "Live", variant: "success" };
}

export default function BannersPage() {
  const columns = useMemo<ColumnDef<CmsBannerRow, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Banner",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-3">
            <img src={row.original.image_url ?? publicMediaUrl(row.original.document_id, "thumb") ?? undefined} alt="" className="h-10 w-16 shrink-0 rounded-sm border border-border object-cover" loading="lazy" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{row.original.title}</span>
              {row.original.subtitle && <span className="block truncate text-2xs text-ink-subtle">{row.original.subtitle}</span>}
            </span>
          </span>
        ),
      },
      {
        id: "schedule",
        header: "Schedule",
        meta: { sortKey: "starts_at" },
        cell: ({ row }) => {
          const state = bannerSchedule(row.original);
          return (
            <span className="flex flex-col gap-0.5">
              <Badge variant={state.variant} className="w-fit">
                {state.label}
              </Badge>
              <span className="money text-2xs text-ink-subtle">
                {row.original.starts_at ? formatDateTime(row.original.starts_at) : "Always"}
                {row.original.ends_at ? ` → ${formatDateTime(row.original.ends_at)}` : ""}
              </span>
            </span>
          );
        },
      },
      { accessorKey: "cta_label", header: "CTA", cell: ({ row }) => (row.original.cta_label ? <span title={row.original.cta_url ?? undefined}>{row.original.cta_label}</span> : <span className="text-ink-subtle">—</span>) },
      { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 80 } },
    ],
    [],
  );

  return (
    <CmsCollectionPage<CmsBannerRow, BannerValues>
      title="Banners"
      singular="Banner"
      description="Home-page hero slides. Schedule a start and end to run campaigns; inactive banners never show."
      icon={ImageIcon}
      path="/cms/banners"
      defaultSort="sort_order"
      columns={columns}
      schema={CreateSchema}
      updateSchema={UpdateSchema}
      flagKey="is_active"
      defaultValues={() => ({ title: "", subtitle: "", cta_label: "", cta_url: "", document_id: null, sort_order: 0, starts_at: null, ends_at: null, is_active: true })}
      toValues={(row) => ({ title: row.title, subtitle: row.subtitle ?? "", cta_label: row.cta_label ?? "", cta_url: row.cta_url ?? "", document_id: row.document_id, sort_order: row.sort_order, starts_at: row.starts_at, ends_at: row.ends_at, is_active: row.is_active })}
      emptyDescription="Upload a wide image (1920 × 840 works well) and give it a title."
      fields={({ control, row, disabled }) => (
        <>
          <FormField control={control} name="document_id" label="Image" required render={({ field }) => <MediaPicker id={field.id} value={field.value} onChange={field.onChange} previewUrl={row?.document_id === field.value ? row.image_url : null} invalid={field.invalid} disabled={disabled} />} />
          <FormField control={control} name="title" label="Title" required render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={120} invalid={field.invalid} disabled={disabled} />} />
          <FormField control={control} name="subtitle" label="Subtitle" render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={200} invalid={field.invalid} disabled={disabled} />} />
          <FormRow>
            <FormField control={control} name="cta_label" label="Button label" render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={40} placeholder="Explore projects" invalid={field.invalid} disabled={disabled} />} />
            <FormField control={control} name="cta_url" label="Button link" hint="Absolute URL or a site path like /projects" render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={500} placeholder="/projects" invalid={field.invalid} disabled={disabled} />} />
          </FormRow>
          <FormSection title="Schedule" description="Leave both empty to show the banner whenever it is active.">
            <FormRow>
              <FormField control={control} name="starts_at" label="Starts" render={({ field }) => <DateTimeInput id={field.id} value={field.value} onChange={field.onChange} invalid={field.invalid} disabled={disabled} />} />
              <FormField control={control} name="ends_at" label="Ends" render={({ field }) => <DateTimeInput id={field.id} value={field.value} onChange={field.onChange} invalid={field.invalid} disabled={disabled} />} />
            </FormRow>
          </FormSection>
          <FormRow>
            <FormField control={control} name="sort_order" label="Sort order" hint="Lower shows first" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} min={0} max={1000} invalid={field.invalid} disabled={disabled} />} />
            <FormField control={control} name="is_active" label="Visibility" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Active" description="Shown on the website within its schedule" disabled={disabled} />} />
          </FormRow>
        </>
      )}
    />
  );
}
