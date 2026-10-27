import type { ColumnDef } from "@tanstack/react-table";
import { Images } from "lucide-react";
import { useMemo } from "react";
import { CmsGalleryCreateSchema, CmsGalleryUpdateSchema, type CmsGalleryRow } from "@kkt/contracts";
import { z } from "zod";
import { Badge, Combobox, FormField, FormRow, Input, NumberInput, Select, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useProjectOptions } from "@/features/shared/options";
import { CmsCollectionPage } from "./CmsCollectionPage";
import { MediaPicker, PublishedChip } from "./components";
import { nullable, publicMediaUrl } from "./api";

interface GalleryValues {
  project_id: string | null;
  document_id: string | null;
  caption: string;
  category: string;
  sort_order: number | null;
  is_published: boolean;
}

const base = (values: GalleryValues) => ({
  project_id: values.project_id || null,
  caption: nullable(values.caption),
  category: nullable(values.category),
  sort_order: values.sort_order ?? 0,
  is_published: values.is_published,
});

const CreateSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as GalleryValues;
    return { ...base(values), document_id: values.document_id };
  })
  .pipe(CmsGalleryCreateSchema);

const UpdateSchema = z
  .looseObject({})
  .transform((raw): unknown => base(raw as unknown as GalleryValues))
  .pipe(CmsGalleryUpdateSchema.omit({ version: true }));

const CATEGORY_SUGGESTIONS = ["Exterior", "Interiors", "Amenities", "Construction", "Events", "Location"];

export default function GalleryPage() {
  const projects = useProjectOptions();
  const projectOptions = useMemo(
    () => (projects.data ?? []).map((project) => ({ value: project.id, label: project.name })),
    [projects.data],
  );

  const columns = useMemo<ColumnDef<CmsGalleryRow, unknown>[]>(
    () => [{ accessorKey: "caption", header: "Caption" }],
    [],
  );

  return (
    <CmsCollectionPage<CmsGalleryRow, GalleryValues>
      title="Gallery"
      singular="Image"
      description="Photos for the website gallery and project pages. Thumbnails and medium renditions are generated on upload."
      icon={Images}
      path="/cms/gallery"
      defaultSort="sort_order"
      filterKeys={["project_id", "category", "is_published"]}
      searchPlaceholder="Search captions…"
      filters={(list) => (
        <>
          <Combobox
            aria-label="Project"
            size="sm"
            className="w-full sm:w-44"
            value={list.filters.project_id ?? null}
            onValueChange={(value) => list.setFilter("project_id", value)}
            options={projectOptions}
            placeholder="Any project"
            allowClear
            data-testid="gallery-filter-project"
          />
          <Select
            aria-label="Category"
            size="sm"
            className="w-full sm:w-40"
            value={list.filters.category ?? null}
            onValueChange={(value) => list.setFilter("category", value)}
            options={CATEGORY_SUGGESTIONS.map((value) => ({ value, label: value }))}
            placeholder="Any category"
            allowClear
            data-testid="gallery-filter-category"
          />
          <Select
            aria-label="Status"
            size="sm"
            className="w-full sm:w-36"
            value={list.filters.is_published ?? null}
            onValueChange={(value) => list.setFilter("is_published", value)}
            options={[
              { value: "true", label: "Published" },
              { value: "false", label: "Hidden" },
            ]}
            placeholder="Any status"
            allowClear
            data-testid="gallery-filter-published"
          />
        </>
      )}
      columns={columns}
      grid={(row, actions) => {
        const src = row.thumb_url ?? publicMediaUrl(row.document_id, "thumb");
        const ratio = row.width && row.height ? `${row.width} / ${row.height}` : "4 / 3";
        return (
          <figure
            className={cn(
              "overflow-hidden rounded-lg border bg-card shadow-card",
              row.is_published ? "border-border" : "border-dashed border-border-strong opacity-80",
            )}
            data-testid={`gallery-item-${row.id}`}
          >
            <div className="relative bg-navy-50" style={{ aspectRatio: ratio }}>
              {src ? (
                <img src={src} alt={row.caption ?? ""} className="size-full object-cover" loading="lazy" />
              ) : (
                <Images className="absolute inset-0 m-auto size-8 text-ink-subtle" aria-hidden="true" />
              )}
              <div className="absolute right-1 top-1 rounded-md bg-card/90 shadow-card">{actions}</div>
            </div>
            <figcaption className="space-y-1 p-2">
              <p className="truncate text-sm font-medium text-ink">
                {row.caption ?? <span className="text-ink-subtle">No caption</span>}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {row.project_name && <Badge variant="navy">{row.project_name}</Badge>}
                {row.category && <Badge variant="outline">{row.category}</Badge>}
                <PublishedChip published={row.is_published} labels={["Published", "Hidden"]} />
              </div>
            </figcaption>
          </figure>
        );
      }}
      schema={CreateSchema}
      updateSchema={UpdateSchema}
      flagKey="is_published"
      flagLabels={["Published", "Hidden"]}
      defaultValues={() => ({
        project_id: null,
        document_id: null,
        caption: "",
        category: "",
        sort_order: 0,
        is_published: true,
      })}
      toValues={(row) => ({
        project_id: row.project_id,
        document_id: row.document_id,
        caption: row.caption ?? "",
        category: row.category ?? "",
        sort_order: row.sort_order,
        is_published: row.is_published,
      })}
      emptyDescription="Upload the first photo; group them by project and category for the website filters."
      fields={({ control, row, disabled }) => (
        <>
          <FormField
            control={control}
            name="document_id"
            label="Image"
            required
            hint={row ? "The image itself cannot be swapped; delete and re-upload instead." : undefined}
            render={({ field }) => (
              <MediaPicker
                id={field.id}
                value={field.value}
                onChange={field.onChange}
                previewUrl={row?.document_id === field.value ? row.medium_url : null}
                aspect="wide"
                invalid={field.invalid}
                disabled={disabled || row !== null}
              />
            )}
          />
          <FormField
            control={control}
            name="caption"
            label="Caption"
            render={({ field }) => (
              <Input
                id={field.id}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                maxLength={200}
                invalid={field.invalid}
                disabled={disabled}
              />
            )}
          />
          <FormRow>
            <FormField
              control={control}
              name="project_id"
              label="Project"
              render={({ field }) => (
                <Select
                  id={field.id}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={projectOptions}
                  placeholder="Company-wide"
                  allowClear
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
            <FormField
              control={control}
              name="category"
              label="Category"
              hint="Exterior, Interiors, Amenities…"
              render={({ field }) => (
                <Input
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  maxLength={60}
                  list="gallery-categories"
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
          </FormRow>
          <datalist id="gallery-categories">
            {CATEGORY_SUGGESTIONS.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
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
                  max={10_000}
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
            <FormField
              control={control}
              name="is_published"
              label="Visibility"
              render={({ field }) => (
                <Switch
                  id={field.id}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  label="Published"
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
