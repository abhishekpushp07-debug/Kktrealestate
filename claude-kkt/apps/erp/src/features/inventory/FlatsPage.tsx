import type { ColumnDef } from "@tanstack/react-table";
import { Grid3x3 } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { FLAT_STATUSES, FLAT_STATUS_LABELS, type FlatRow, type FlatTypeRow } from "@kkt/contracts";
import { Combobox, DataTable, Input, PageHeader, Select, StatusChip, Toolbar } from "@/components/ui";
import { formatDateTime, formatINR, formatNumber, formatSqft } from "@/lib/format";
import { useList, useListParams } from "@/lib/queries";
import { useMasterRows } from "@/features/masters/api";
import { useProjectOptions } from "@/features/shared/options";
import { FlatDrawer } from "./FlatDrawer";
import { FLATS_PATH, useProjectBlocks } from "./api";

const FLAT_FILTERS = ["project_id", "block_id", "floor", "status", "flat_type_id"] as const;

/** `/flats` — every flat across projects with filters, CSV and the flat drawer (`?flat=` deep link). */
export default function FlatsPage() {
  return (
    <>
      <PageHeader
        title="Flats"
        description="Every unit across your projects. Click a row for snapshots, price breakup, status and history."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Inventory" }, { label: "Flats" }]}
      />
      <FlatsTable />
    </>
  );
}

export interface FlatsTableProps {
  /** Lock the table to one block (block detail page). */
  blockId?: string;
  /** Lock the table to one project. */
  projectId?: string;
  prefix?: string;
}

/** Commits on Enter / blur so every keystroke does not hit the API. */
function FloorFilter({ value, onCommit }: { value: string; onCommit: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  const commit = () => onCommit(draft.trim() || null);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
  };
  return (
    <Input
      aria-label="Floor"
      placeholder="Floor"
      inputMode="numeric"
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/[^\d-]/g, ""))}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className="money h-8 w-full text-xs sm:w-24"
      data-testid="flats-filter-floor"
    />
  );
}

export function FlatsTable({ blockId, projectId, prefix = "" }: FlatsTableProps) {
  const list = useListParams({ filterKeys: FLAT_FILTERS, defaultSort: null, prefix });
  const [params, setParams] = useSearchParams();
  const selectedFlat = params.get("flat");
  const effectiveProject = projectId ?? list.filters.project_id ?? null;
  const fixedFilters = useMemo(
    () => ({ ...(projectId ? { project_id: projectId } : {}), ...(blockId ? { block_id: blockId } : {}) }),
    [projectId, blockId],
  );
  const queryParams = useMemo(
    () => ({ ...list.params, filters: { ...list.params.filters, ...fixedFilters } }),
    [list.params, fixedFilters],
  );
  const query = useList<FlatRow>(FLATS_PATH, queryParams);
  const projects = useProjectOptions(!projectId && !blockId);
  const blocks = useProjectBlocks(blockId ? null : effectiveProject);
  const flatTypes = useMasterRows<FlatTypeRow>("flat-types");

  const openFlat = (id: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("flat", id);
        else next.delete("flat");
        return next;
      },
      { replace: true },
    );
  };

  const columns = useMemo<ColumnDef<FlatRow, unknown>[]>(
    () => [
      {
        accessorKey: "flat_number",
        header: "Flat",
        meta: { locked: true, width: 110 },
        cell: ({ row }) => <span className="money font-semibold text-navy-950">{row.original.flat_number}</span>,
      },
      ...(blockId ? [] : [{ accessorKey: "block_name", header: "Block" } satisfies ColumnDef<FlatRow, unknown>]),
      {
        accessorKey: "floor",
        header: "Floor",
        meta: { align: "right", width: 80 },
        cell: ({ row }) => row.original.floor_label,
      },
      {
        accessorKey: "flat_type_code",
        header: "Type",
        cell: ({ row }) => (
          <span>
            <span className="font-mono text-xs text-navy-950">{row.original.flat_type_code}</span>{" "}
            <span className="text-ink-muted">{row.original.flat_type_name}</span>
          </span>
        ),
      },
      { accessorKey: "bhk", header: "BHK", meta: { align: "right", width: 70 } },
      { accessorKey: "facing", header: "Facing", cell: ({ row }) => row.original.facing ?? "—" },
      {
        accessorKey: "super_builtup_sqft",
        header: "Super built-up",
        meta: { align: "right" },
        cell: ({ row }) => formatSqft(row.original.super_builtup_sqft),
      },
      {
        accessorKey: "price_paise",
        header: "Price",
        meta: { align: "right" },
        cell: ({ row }) => formatINR(row.original.price_paise),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { width: 120 },
        cell: ({ row }) => (
          <StatusChip status={row.original.status} label={FLAT_STATUS_LABELS[row.original.status]} size="sm" />
        ),
      },
      {
        id: "customer",
        header: "Customer / hold",
        meta: { sortKey: false },
        cell: ({ row }) => {
          const flat = row.original;
          if (flat.customer_name)
            return `${flat.customer_name}${flat.booking_number ? ` · ${flat.booking_number}` : ""}`;
          if (flat.status === "HOLD")
            return (
              <span className="text-xs text-ink-muted">
                {flat.hold_by_name ?? "Held"}
                {flat.hold_until ? ` until ${formatDateTime(flat.hold_until)}` : ""}
              </span>
            );
          return <span className="text-ink-subtle">—</span>;
        },
      },
    ],
    [blockId],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search flat number…"
        filters={
          <>
            {!projectId && !blockId && (
              <Combobox
                aria-label="Project"
                size="sm"
                className="w-full sm:w-48"
                value={list.filters.project_id ?? null}
                onValueChange={(value) => list.setFilters({ project_id: value, block_id: null })}
                options={(projects.data ?? []).map((project) => ({
                  value: project.id,
                  label: project.name,
                  description: project.code ?? undefined,
                }))}
                placeholder="Any project"
                allowClear
                data-testid="flats-filter-project"
              />
            )}
            {!blockId && (
              <Select
                aria-label="Block"
                size="sm"
                className="w-full sm:w-40"
                value={list.filters.block_id ?? null}
                onValueChange={(value) => list.setFilter("block_id", value)}
                options={(blocks.data ?? []).map((block) => ({ value: block.id, label: block.name }))}
                placeholder={effectiveProject ? "Any block" : "Pick a project"}
                disabled={!effectiveProject}
                allowClear
                data-testid="flats-filter-block"
              />
            )}
            <FloorFilter value={list.filters.floor ?? ""} onCommit={(value) => list.setFilter("floor", value)} />
            <Select
              aria-label="Status"
              size="sm"
              className="w-full sm:w-36"
              value={list.filters.status ?? null}
              onValueChange={(value) => list.setFilter("status", value)}
              options={FLAT_STATUSES.map((status) => ({ value: status, label: FLAT_STATUS_LABELS[status] }))}
              placeholder="Any status"
              allowClear
              data-testid="flats-filter-status"
            />
            <Select
              aria-label="Flat type"
              size="sm"
              className="w-full sm:w-44"
              value={list.filters.flat_type_id ?? null}
              onValueChange={(value) => list.setFilter("flat_type_id", value)}
              options={(flatTypes.data ?? []).map((type) => ({ value: type.id, label: `${type.code} · ${type.name}` }))}
              placeholder="Any type"
              allowClear
              data-testid="flats-filter-type"
            />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: FLATS_PATH, params: queryParams, filename: "flats.csv" }}
        exportTotal={query.data?.total}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "flat" : "flats"}` : undefined}
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
        onRowClick={(row) => openFlat(row.id)}
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          total,
          onPageChange: list.setPage,
          onPageSizeChange: list.setPageSize,
        }}
        emptyState={{
          icon: Grid3x3,
          title: list.hasActiveFilters ? "No flats match" : "No flats yet",
          description: list.hasActiveFilters
            ? "Try another search or clear the filters."
            : "Flats appear once a block has been generated.",
        }}
        data-testid="flats-table"
      />
      <FlatDrawer flatId={selectedFlat} onClose={() => openFlat(null)} />
    </>
  );
}
