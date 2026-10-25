import type { ColumnDef } from "@tanstack/react-table";
import { UserRound } from "lucide-react";
import { useMemo } from "react";
import { CmsPersonCreateSchema, CmsPersonUpdateSchema, type CmsPersonRow } from "@kkt/contracts";
import { z } from "zod";
import { Avatar, FormField, FormRow, Input, NumberInput, Switch, Textarea } from "@/components/ui";
import { CmsCollectionPage } from "./CmsCollectionPage";
import { MediaPicker, PublishedChip } from "./components";
import { nullable, publicMediaUrl } from "./api";

interface PersonValues {
  name: string;
  title: string;
  bio: string;
  photo_document_id: string | null;
  sort_order: number | null;
  is_published: boolean;
}

const toBody = z.looseObject({}).transform((raw): unknown => {
  const values = raw as unknown as PersonValues;
  return { name: values.name.trim(), title: values.title.trim(), bio: nullable(values.bio), photo_document_id: values.photo_document_id, sort_order: values.sort_order ?? 0, is_published: values.is_published };
});

const CreateSchema = toBody.pipe(CmsPersonCreateSchema);
const UpdateSchema = toBody.pipe(CmsPersonUpdateSchema.omit({ version: true }));

export default function PeoplePage() {
  const columns = useMemo<ColumnDef<CmsPersonRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Person",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.original.name} src={row.original.photo_url ?? publicMediaUrl(row.original.photo_document_id, "thumb")} size="sm" tone="navy" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{row.original.name}</span>
              <span className="block truncate text-2xs text-ink-subtle">{row.original.title}</span>
            </span>
          </span>
        ),
      },
      { accessorKey: "bio", header: "Bio", meta: { sortKey: false }, cell: ({ row }) => <span className="block max-w-[26rem] truncate text-ink-muted">{row.original.bio ?? "—"}</span> },
      { accessorKey: "is_published", header: "Status", cell: ({ row }) => <PublishedChip published={row.original.is_published} /> },
      { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 80 } },
    ],
    [],
  );

  return (
    <CmsCollectionPage<CmsPersonRow, PersonValues>
      title="People"
      singular="Person"
      description="Leadership and team members shown on the About page, in display order."
      icon={UserRound}
      path="/cms/people"
      defaultSort="sort_order"
      columns={columns}
      schema={CreateSchema}
      updateSchema={UpdateSchema}
      flagKey="is_published"
      defaultValues={() => ({ name: "", title: "", bio: "", photo_document_id: null, sort_order: 0, is_published: true })}
      toValues={(row) => ({ name: row.name, title: row.title, bio: row.bio ?? "", photo_document_id: row.photo_document_id, sort_order: row.sort_order, is_published: row.is_published })}
      emptyDescription="Add the founders and leadership team with a portrait and a short bio."
      fields={({ control, row, disabled }) => (
        <>
          <FormRow>
            <FormField control={control} name="name" label="Name" required render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={120} invalid={field.invalid} disabled={disabled} />} />
            <FormField control={control} name="title" label="Designation" required render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={120} placeholder="Managing Director" invalid={field.invalid} disabled={disabled} />} />
          </FormRow>
          <FormField control={control} name="bio" label="Bio" hint="≤ 2000 characters" render={({ field }) => <Textarea id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} rows={5} maxLength={2000} invalid={field.invalid} disabled={disabled} />} />
          <FormField control={control} name="photo_document_id" label="Portrait" render={({ field }) => <MediaPicker id={field.id} value={field.value} onChange={field.onChange} previewUrl={row?.photo_document_id === field.value ? row.photo_url : null} aspect="portrait" label="Upload portrait" disabled={disabled} />} />
          <FormRow>
            <FormField control={control} name="sort_order" label="Sort order" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} min={0} max={1000} invalid={field.invalid} disabled={disabled} />} />
            <FormField control={control} name="is_published" label="Visibility" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Published" disabled={disabled} />} />
          </FormRow>
        </>
      )}
    />
  );
}
