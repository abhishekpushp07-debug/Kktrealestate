import type { ColumnDef } from "@tanstack/react-table";
import { Inbox, MailOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EnquiryRow } from "@kkt/contracts";
import { Badge, Button, Combobox, DataTable, KeyValueList, PageHeader, Select, SimpleDialog, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatNumber, formatPhone, formatRelative } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useProjectOptions } from "@/features/shared/options";
import { LeadDrawer } from "./LeadDrawer";
import { ENQUIRIES_PATH, LEADS_PATH, crmKeys, useEnquiryUnreadCount } from "./api";

const ENQUIRY_FILTERS = ["is_read", "project_id"] as const;

/** `/enquiries` — website enquiries inbox with read / unread state; opening one marks it read and shows its lead. */
export default function EnquiriesInbox() {
  const { can } = useAuth();
  const canWrite = can("lead.write");
  const list = useListParams({ filterKeys: ENQUIRY_FILTERS, defaultSort: "-created_at" });
  const query = useList<EnquiryRow>(ENQUIRIES_PATH, list.params);
  const unread = useEnquiryUnreadCount();
  const projects = useProjectOptions();
  const [params, setParams] = useSearchParams();
  const selectedLead = params.get("lead");
  const [detail, setDetail] = useState<EnquiryRow | null>(null);

  const markRead = useMutationWithToast<unknown, EnquiryRow>({
    mutationFn: (row) => api.post(`${ENQUIRIES_PATH}/${row.id}/read`, {}),
    successMessage: false,
    invalidate: [[ENQUIRIES_PATH], crmKeys.enquiryUnread, [LEADS_PATH]],
  });

  const open = (row: EnquiryRow) => {
    if (!row.is_read && canWrite) markRead.mutate(row);
    if (row.lead_id) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("lead", row.lead_id ?? "");
          return next;
        },
        { replace: true },
      );
    } else {
      setDetail(row);
    }
  };

  const columns = useMemo<ColumnDef<EnquiryRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Enquiry",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", row.original.is_read ? "bg-transparent" : "bg-gold")} {...(row.original.is_read ? { "aria-hidden": true } : { role: "img", "aria-label": "Unread" })} />
            <span className="min-w-0 leading-tight">
              <span className={cn("block truncate", row.original.is_read ? "font-medium text-ink" : "font-semibold text-navy-950")}>{row.original.name}</span>
              <span className="money block truncate text-2xs font-normal text-ink-subtle">
                {formatPhone(row.original.phone)}
                {row.original.email ? ` · ${row.original.email}` : ""}
              </span>
            </span>
          </span>
        ),
      },
      { accessorKey: "project_name", header: "Project", cell: ({ row }) => row.original.project_name ?? <span className="text-ink-subtle">General</span> },
      { accessorKey: "flat_type_name", header: "Flat type", meta: { hideOnMobile: true }, cell: ({ row }) => row.original.flat_type_name ?? "—" },
      { id: "message", header: "Message", meta: { sortKey: false }, cell: ({ row }) => <span className="block max-w-xs truncate text-ink-muted">{row.original.message ?? "—"}</span> },
      {
        id: "source",
        header: "Source",
        meta: { sortKey: false, hideOnMobile: true },
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.source_page && <Badge variant="outline">{row.original.source_page}</Badge>}
            {row.original.utm?.source && <Badge variant="neutral">{[row.original.utm.source, row.original.utm.campaign].filter(Boolean).join(" / ")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "reference_number", header: "Reference", meta: { width: 130 }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference_number}</span> },
      { accessorKey: "lead_number", header: "Lead", meta: { width: 120 }, cell: ({ row }) => (row.original.lead_number ? <span className="font-mono text-xs text-navy-700">{row.original.lead_number}</span> : <span className="text-ink-subtle">—</span>) },
      { accessorKey: "created_at", header: "Received", meta: { width: 130 }, cell: ({ row }) => <span className="money" title={formatDateTime(row.original.created_at, { zone: true })}>{formatRelative(row.original.created_at)}</span> },
    ],
    [],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Enquiries"
        titleAddon={(unread.data ?? 0) > 0 ? <Badge variant="gold" numeric>{formatNumber(unread.data ?? 0)} unread</Badge> : undefined}
        description="Website call-back forms, brochure downloads and visit bookings. Opening an enquiry marks it read and shows its lead."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Sales" }, { label: "Enquiries" }]}
        actions={
          <Button variant={list.filters.is_read === "false" ? "primary" : "outline"} leftIcon={MailOpen} onClick={() => list.setFilter("is_read", list.filters.is_read === "false" ? null : "false")} data-testid="enquiries-unread-toggle">
            Unread only
          </Button>
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search name, phone or reference…"
        filters={
          <>
            <Combobox aria-label="Project" size="sm" className="w-full sm:w-44" value={list.filters.project_id ?? null} onValueChange={(value) => list.setFilter("project_id", value)} options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name, description: project.code ?? undefined }))} placeholder="Any project" allowClear />
            <Select aria-label="Read state" size="sm" className="w-full sm:w-32" value={list.filters.is_read ?? null} onValueChange={(value) => list.setFilter("is_read", value)} options={[{ value: "false", label: "Unread" }, { value: "true", label: "Read" }]} placeholder="Any" allowClear />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: ENQUIRIES_PATH, params: list.params, filename: "enquiries.csv" }}
        exportTotal={query.data?.total}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "enquiry" : "enquiries"}` : undefined}
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={open}
        rowClassName={(row) => (row.is_read ? undefined : "[&>td]:bg-gold-light/30")}
        pagination={{ page: list.page, pageSize: list.pageSize, total, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        emptyState={{ icon: Inbox, title: list.hasActiveFilters ? "No enquiries match" : "Inbox is empty", description: list.hasActiveFilters ? "Try another search or clear the filters." : "New website enquiries land here with an unread badge." }}
        data-testid="enquiries-table"
      />
      <LeadDrawer
        leadId={selectedLead}
        onClose={() =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete("lead");
              return next;
            },
            { replace: true },
          )
        }
      />
      <SimpleDialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)} title={detail?.name ?? "Enquiry"} description={detail ? `Reference ${detail.reference_number} · ${formatDateTime(detail.created_at)}` : undefined} footer={<Button onClick={() => setDetail(null)}>Close</Button>}>
        {detail && (
          <KeyValueList
            columns={2}
            items={[
              { label: "Phone", value: <span className="money">{formatPhone(detail.phone)}</span> },
              { label: "E-mail", value: detail.email },
              { label: "Project", value: detail.project_name },
              { label: "Flat type", value: detail.flat_type_name },
              { label: "Source page", value: detail.source_page },
              { label: "UTM", value: detail.utm ? [detail.utm.source, detail.utm.medium, detail.utm.campaign].filter(Boolean).join(" / ") || null : null },
              { label: "Message", value: detail.message, full: true },
            ]}
          />
        )}
      </SimpleDialog>
    </>
  );
}
