import type { UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BLOCK_STATUS_LABELS, type BlockRow, type ProjectRow } from "@kkt/contracts";
import { Badge, Button, DataTable, ProgressRing, StatusChip } from "@/components/ui";
import type { ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { UnitCountsBar } from "../components";

export interface BlocksTabProps {
  project: ProjectRow;
  blocks: UseQueryResult<BlockRow[], ApiClientError>;
}

export function BlocksTab({ project, blocks }: BlocksTabProps) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canWrite = can("block.write");

  const columns = useMemo<ColumnDef<BlockRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Block",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="block min-w-0 leading-tight">
            <span className="block truncate font-semibold text-navy-950">{row.original.name}</span>
            <span className="block truncate font-mono text-2xs font-normal text-ink-subtle">
              {row.original.code} · {row.original.block_type_name}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { sortKey: false, width: 150 },
        cell: ({ row }) => (
          <StatusChip status={row.original.status} label={BLOCK_STATUS_LABELS[row.original.status]} size="sm" />
        ),
      },
      {
        id: "floors",
        header: "Floors",
        meta: { sortKey: false, align: "right", width: 90 },
        cell: ({ row }) => (row.original.has_floors ? `${row.original.floor_start}–${row.original.floors}` : "—"),
      },
      {
        id: "construction",
        header: "Construction",
        meta: { sortKey: false, width: 200 },
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <ProgressRing
              value={row.original.construction_percent}
              size={28}
              strokeWidth={3}
              tone="gold"
              label=""
              aria-label="Construction progress"
            />
            <span className="min-w-0 leading-tight">
              <span className="money block text-xs font-semibold">
                {Math.round(row.original.construction_percent)}%
              </span>
              <span className="block truncate text-2xs text-ink-subtle">
                {row.original.current_stage_name ?? "Not started"}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "units",
        header: "Units",
        meta: { sortKey: false, width: 220 },
        cell: ({ row }) => (
          <UnitCountsBar counts={row.original.unit_counts} legend={false} size="sm" className="min-w-40" />
        ),
      },
      {
        id: "total",
        header: "Total",
        meta: { sortKey: false, align: "right", width: 70 },
        cell: ({ row }) => formatNumber(row.original.unit_counts.total),
      },
      {
        id: "available",
        header: "Available",
        meta: { sortKey: false, align: "right", width: 90 },
        cell: ({ row }) => formatNumber(row.original.unit_counts.available),
      },
      {
        id: "flats",
        header: "",
        meta: { sortKey: false, width: 120, label: "Flats" },
        cell: ({ row }) => (!row.original.has_flats ? <Badge variant="warning">No flats yet</Badge> : null),
      },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button asChild size="sm" leftIcon={Plus}>
            <Link to={`/projects/${project.id}/blocks/new`} data-testid="blocks-new-btn">
              <Plus aria-hidden="true" /> New block
            </Link>
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        data={blocks.data ?? []}
        getRowId={(row) => row.id}
        loading={blocks.isFetching}
        error={blocks.error}
        onRetry={() => void blocks.refetch()}
        onRowClick={(row) => navigate(`/blocks/${row.id}`)}
        emptyState={{
          icon: Building2,
          title: "No blocks yet",
          description: "Run the block wizard to add a tower or villa block and generate its flats.",
          action: canWrite ? (
            <Button asChild leftIcon={Plus}>
              <Link to={`/projects/${project.id}/blocks/new`}>
                <Plus aria-hidden="true" /> New block
              </Link>
            </Button>
          ) : undefined,
        }}
        mobileCard={(row) => (
          <Link
            to={`/blocks/${row.id}`}
            className="block rounded-lg border border-border bg-card p-3 shadow-card focus-ring"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-navy-950">{row.name}</p>
                <p className="truncate font-mono text-2xs text-ink-subtle">
                  {row.code} · {row.block_type_name}
                </p>
              </div>
              <ProgressRing
                value={row.construction_percent}
                size={36}
                strokeWidth={4}
                tone="gold"
                aria-label="Construction progress"
              />
            </div>
            <UnitCountsBar counts={row.unit_counts} className="mt-2" />
          </Link>
        )}
        data-testid="project-blocks-table"
      />
    </div>
  );
}
