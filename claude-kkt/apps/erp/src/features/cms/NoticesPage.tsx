import type { ColumnDef } from "@tanstack/react-table";
import { Megaphone } from "lucide-react";
import { useMemo } from "react";
import { NoticeCreateSchema, NoticeUpdateSchema, type NoticeRow } from "@kkt/contracts";
import { z } from "zod";
import { Badge, Combobox, FormField, FormRow, Input, Select, Switch } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useProjectOptions } from "@/features/shared/options";
import { CmsCollectionPage } from "./CmsCollectionPage";
import { MarkdownEditor } from "./Markdown";
import { DateTimeInput, PublishedChip } from "./components";
import { NOTICES_PATH } from "./api";
import { markdownExcerpt } from "./markdown";

interface NoticeValues {
  project_id: string | null;
  title: string;
  body_md: string;
  publish_at: string | null;
  expires_at: string | null;
  is_published: boolean;
}

const toBody = z.looseObject({}).transform((raw): unknown => {
  const values = raw as unknown as NoticeValues;
  return {
    project_id: values.project_id || null,
    title: values.title.trim(),
    body_md: values.body_md,
    publish_at: values.publish_at,
    expires_at: values.expires_at,
    is_published: values.is_published,
  };
});

const CreateSchema = toBody.pipe(NoticeCreateSchema);
const UpdateSchema = toBody.pipe(NoticeUpdateSchema.omit({ version: true }));

/** Live / Scheduled / Expired / Draft for a notice at `now`. */
export function noticeState(
  row: Pick<NoticeRow, "is_published" | "publish_at" | "expires_at">,
  now: Date = new Date(),
): { label: string; variant: "success" | "info" | "warning" | "neutral" } {
  if (!row.is_published) return { label: "Draft", variant: "neutral" };
  const time = now.getTime();
  if (row.publish_at && Date.parse(row.publish_at) > time) return { label: "Scheduled", variant: "info" };
  if (row.expires_at && Date.parse(row.expires_at) < time) return { label: "Expired", variant: "warning" };
  return { label: "Live", variant: "success" };
}

export default function NoticesPage() {
  const projects = useProjectOptions();
  const projectOptions = useMemo(
    () =>
      (projects.data ?? []).map((project) => ({
        value: project.id,
        label: project.name,
        description: project.code ?? undefined,
      })),
    [projects.data],
  );

  const columns = useMemo<ColumnDef<NoticeRow, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Notice",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{row.original.title}</span>
            <span className="block max-w-[24rem] truncate text-2xs text-ink-subtle">
              {markdownExcerpt(row.original.body_md, 90)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "project_name",
        header: "Audience",
        cell: ({ row }) =>
          row.original.project_name ? (
            <Badge variant="navy">{row.original.project_name}</Badge>
          ) : (
            <Badge variant="gold">All buyers</Badge>
          ),
      },
      {
        id: "state",
        header: "State",
        meta: { sortKey: "is_published" },
        cell: ({ row }) => {
          const state = noticeState(row.original);
          return <Badge variant={state.variant}>{state.label}</Badge>;
        },
      },
      {
        accessorKey: "publish_at",
        header: "Publish",
        cell: ({ row }) => (
          <span className="money text-ink-muted">
            {row.original.publish_at ? formatDateTime(row.original.publish_at) : "Immediately"}
          </span>
        ),
      },
      {
        accessorKey: "expires_at",
        header: "Expires",
        cell: ({ row }) => (
          <span className="money text-ink-muted">
            {row.original.expires_at ? formatDateTime(row.original.expires_at) : "Never"}
          </span>
        ),
      },
      {
        accessorKey: "created_by_name",
        header: "By",
        meta: { hideOnMobile: true },
        cell: ({ row }) => row.original.created_by_name ?? "—",
      },
    ],
    [],
  );

  return (
    <CmsCollectionPage<NoticeRow, NoticeValues>
      title="Notices"
      singular="Notice"
      description="Announcements for buyers in the portal (company-wide or per project). Publishing notifies every buyer in the audience."
      icon={Megaphone}
      path={NOTICES_PATH}
      defaultSort="-publish_at"
      sheetSize="xl"
      filterKeys={["project_id", "is_published"]}
      searchPlaceholder="Search notices…"
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
            data-testid="notices-filter-project"
          />
          <Select
            aria-label="State"
            size="sm"
            className="w-full sm:w-36"
            value={list.filters.is_published ?? null}
            onValueChange={(value) => list.setFilter("is_published", value)}
            options={[
              { value: "true", label: "Published" },
              { value: "false", label: "Drafts" },
            ]}
            placeholder="Any state"
            allowClear
            data-testid="notices-filter-published"
          />
        </>
      )}
      columns={columns}
      mobileCard={(row, actions) => {
        const state = noticeState(row);
        return (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-ink">{row.title}</p>
              {actions}
            </div>
            <p className="text-xs text-ink-muted">{markdownExcerpt(row.body_md, 120)}</p>
            <div className="flex flex-wrap items-center gap-1">
              {row.project_name ? (
                <Badge variant="navy">{row.project_name}</Badge>
              ) : (
                <Badge variant="gold">All buyers</Badge>
              )}
              <Badge variant={state.variant}>{state.label}</Badge>
              <PublishedChip published={row.is_published} />
            </div>
          </div>
        );
      }}
      schema={CreateSchema}
      updateSchema={UpdateSchema}
      flagKey="is_published"
      defaultValues={() => ({
        project_id: null,
        title: "",
        body_md: "",
        publish_at: null,
        expires_at: null,
        is_published: false,
      })}
      toValues={(row) => ({
        project_id: row.project_id,
        title: row.title,
        body_md: row.body_md,
        publish_at: row.publish_at,
        expires_at: row.expires_at,
        is_published: row.is_published,
      })}
      emptyDescription="Possession dates, maintenance windows, festival greetings — buyers see them in the portal."
      fields={({ control, disabled }) => (
        <>
          <FormRow>
            <FormField
              control={control}
              name="title"
              label="Title"
              required
              render={({ field }) => (
                <Input
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  maxLength={160}
                  invalid={field.invalid}
                  disabled={disabled}
                  data-testid="notice-title"
                />
              )}
            />
            <FormField
              control={control}
              name="project_id"
              label="Audience"
              hint="Leave empty for every buyer"
              render={({ field }) => (
                <Combobox
                  id={field.id}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value)}
                  options={projectOptions}
                  placeholder="All buyers"
                  allowClear
                  invalid={field.invalid}
                  disabled={disabled}
                  data-testid="notice-project"
                />
              )}
            />
          </FormRow>
          <FormField
            control={control}
            name="body_md"
            label="Body"
            required
            render={({ field }) => (
              <MarkdownEditor
                id={field.id}
                value={field.value}
                onChange={field.onChange}
                invalid={field.invalid}
                disabled={disabled}
                rows={10}
                data-testid="notice-body"
              />
            )}
          />
          <FormRow>
            <FormField
              control={control}
              name="publish_at"
              label="Publish at"
              hint="Empty = as soon as it is published"
              render={({ field }) => (
                <DateTimeInput
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  invalid={field.invalid}
                  disabled={disabled}
                  data-testid="notice-publish-at"
                />
              )}
            />
            <FormField
              control={control}
              name="expires_at"
              label="Expires at"
              hint="Hidden from buyers afterwards"
              render={({ field }) => (
                <DateTimeInput
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  invalid={field.invalid}
                  disabled={disabled}
                  data-testid="notice-expires-at"
                />
              )}
            />
          </FormRow>
          <FormField
            control={control}
            name="is_published"
            render={({ field }) => (
              <Switch
                id={field.id}
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Published"
                description="Buyers in the audience are notified when a notice goes live"
                disabled={disabled}
                data-testid="notice-published"
              />
            )}
          />
        </>
      )}
    />
  );
}
