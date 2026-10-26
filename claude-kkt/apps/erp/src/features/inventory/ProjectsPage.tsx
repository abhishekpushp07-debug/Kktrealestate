import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Globe, LayoutGrid, List, MapPin, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectRow } from "@kkt/contracts";
import { Badge, Button, DataTable, EmptyState, ErrorState, PageHeader, ProgressRing, Select, Skeleton, StatusChip, Tabs, TabsList, TabsTrigger, Toolbar } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import { useList, useListParams } from "@/lib/queries";
import { cn, useLocalStorageState } from "@/lib/utils";
import { ProjectFormSheet } from "./ProjectFormSheet";
import { PROJECTS_PATH } from "./api";
import { UnitCountsBar } from "./components";

type ViewMode = "cards" | "table";

/** `/projects` — every project in scope as cards or a table, with unit counts and construction progress. */
export default function ProjectsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canWrite = can("project.write");
  const list = useListParams({ filterKeys: ["status", "project_type"], defaultSort: "name" });
  const query = useList<ProjectRow>(PROJECTS_PATH, list.params);
  const [view, setView] = useLocalStorageState<ViewMode>("kkt.erp.projects.view", "cards");
  const [sheetOpen, setSheetOpen] = useState(false);

  const columns = useMemo<ColumnDef<ProjectRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Project",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="block min-w-0 leading-tight">
            <span className="block truncate font-semibold text-navy-950">{row.original.name}</span>
            <span className="block truncate font-mono text-2xs font-normal text-ink-subtle">{row.original.code}</span>
          </span>
        ),
      },
      { accessorKey: "status", header: "Status", meta: { width: 150 }, cell: ({ row }) => <StatusChip status={row.original.status} label={PROJECT_STATUS_LABELS[row.original.status]} size="sm" /> },
      { accessorKey: "project_type", header: "Type", cell: ({ row }) => PROJECT_TYPE_LABELS[row.original.project_type] },
      { accessorKey: "city", header: "City" },
      { accessorKey: "block_count", header: "Blocks", meta: { align: "right", width: 80 }, cell: ({ row }) => formatNumber(row.original.block_count) },
      {
        id: "units",
        header: "Units",
        meta: { sortKey: false, width: 220 },
        cell: ({ row }) => <UnitCountsBar counts={row.original.unit_counts} legend={false} size="sm" className="min-w-40" />,
      },
      { id: "units_total", header: "Total", meta: { sortKey: false, align: "right", width: 80 }, cell: ({ row }) => formatNumber(row.original.unit_counts.total) },
      { id: "available", header: "Available", meta: { sortKey: false, align: "right", width: 90 }, cell: ({ row }) => formatNumber(row.original.unit_counts.available) },
      { accessorKey: "construction_percent", header: "Construction", meta: { align: "right", width: 120 }, cell: ({ row }) => `${Math.round(row.original.construction_percent)}%` },
      { accessorKey: "possession_date", header: "Possession", cell: ({ row }) => formatDate(row.original.possession_date) },
      { accessorKey: "is_published", header: "Website", meta: { width: 110 }, cell: ({ row }) => (row.original.is_published ? <StatusChip status="PUBLISHED" size="sm" /> : <span className="text-xs text-ink-subtle">Unpublished</span>) },
    ],
    [],
  );

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Projects"
        description="Towers, flats, pricing, construction status and the website page of every project in your scope."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Inventory" }, { label: "Projects" }]}
        actions={
          canWrite ? (
            <Button leftIcon={Plus} onClick={() => setSheetOpen(true)} data-testid="project-new-btn">
              New project
            </Button>
          ) : undefined
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search name, code or city…"
        filters={
          <>
            <Select aria-label="Status" size="sm" className="w-full sm:w-44" value={list.filters.status ?? null} onValueChange={(value) => list.setFilter("status", value)} options={PROJECT_STATUSES.map((value) => ({ value, label: PROJECT_STATUS_LABELS[value] }))} placeholder="Any status" allowClear data-testid="projects-filter-status" />
            <Select aria-label="Type" size="sm" className="w-full sm:w-40" value={list.filters.project_type ?? null} onValueChange={(value) => list.setFilter("project_type", value)} options={PROJECT_TYPES.map((value) => ({ value, label: PROJECT_TYPE_LABELS[value] }))} placeholder="Any type" allowClear data-testid="projects-filter-type" />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: PROJECTS_PATH, params: list.params, filename: "projects.csv" }}
        exportTotal={query.data?.total}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "project" : "projects"}` : undefined}
        actions={
          <Tabs value={view} onValueChange={(value) => setView(value === "table" ? "table" : "cards")}>
            <TabsList variant="pills" aria-label="View">
              <TabsTrigger value="cards" icon={<LayoutGrid className="size-3.5" aria-hidden="true" />} data-testid="projects-view-cards">
                <span className="sr-only sm:not-sr-only">Cards</span>
              </TabsTrigger>
              <TabsTrigger value="table" icon={<List className="size-3.5" aria-hidden="true" />} data-testid="projects-view-table">
                <span className="sr-only sm:not-sr-only">Table</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {view === "table" ? (
        <DataTable
          columns={columns}
          data={items}
          getRowId={(row) => row.id}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          sort={list.sort}
          onSortChange={list.setSort}
          onRowClick={(row) => navigate(`/projects/${row.id}`)}
          pagination={{ page: list.page, pageSize: list.pageSize, total, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
          emptyState={{ icon: Building2, title: list.hasActiveFilters ? "No projects match" : "No projects yet", description: list.hasActiveFilters ? "Try another search or clear the filters." : "Create the first project to start adding towers and flats." }}
          data-testid="projects-table"
        />
      ) : (
        <ProjectCards
          items={items}
          loading={query.isPending}
          refreshing={query.isFetching && !query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          hasFilters={list.hasActiveFilters}
          canWrite={canWrite}
          onCreate={() => setSheetOpen(true)}
          pagination={{ page: list.page, pageSize: list.pageSize, total, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        />
      )}

      <ProjectFormSheet open={sheetOpen} onOpenChange={setSheetOpen} project={null} onSaved={(saved) => navigate(`/projects/${saved.id}`)} />
    </>
  );
}

interface ProjectCardsProps {
  items: readonly ProjectRow[];
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  onRetry: () => void;
  hasFilters: boolean;
  canWrite: boolean;
  onCreate: () => void;
  pagination: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void };
}

function ProjectCards({ items, loading, refreshing, error, onRetry, hasFilters, canWrite, onCreate, pagination }: ProjectCardsProps) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-44 rounded-lg" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={onRetry} className="rounded-lg border border-border bg-card" />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        className="rounded-lg border border-border bg-card"
        title={hasFilters ? "No projects match" : "No projects yet"}
        description={hasFilters ? "Try another search or clear the filters." : "Create the first project to start adding towers and flats."}
        action={canWrite && !hasFilters ? <Button leftIcon={Plus} onClick={onCreate}>New project</Button> : undefined}
      />
    );
  }
  const pages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  return (
    <div className={cn(refreshing && "opacity-70 transition-opacity")}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((project) => (
          <li key={project.id}>
            <Link
              to={`/projects/${project.id}`}
              className="flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:border-navy-300 focus-ring"
              data-testid={`project-card-${project.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-display text-md font-bold text-navy-950">{project.name}</h3>
                    <StatusChip status={project.status} label={PROJECT_STATUS_LABELS[project.status]} size="sm" />
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-subtle">
                    <span className="font-mono">{project.code}</span>
                    <span>{PROJECT_TYPE_LABELS[project.project_type]}</span>
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="size-3" aria-hidden="true" /> {project.city}
                    </span>
                  </p>
                </div>
                <ProgressRing value={project.construction_percent} size={44} strokeWidth={4} tone="gold" aria-label="Construction progress" />
              </div>
              <UnitCountsBar counts={project.unit_counts} />
              <div className="mt-auto flex flex-wrap items-center gap-2 text-2xs text-ink-subtle">
                <Badge variant="neutral" numeric>
                  {formatNumber(project.block_count)} {project.block_count === 1 ? "block" : "blocks"}
                </Badge>
                {project.possession_date && <span>Possession {formatDate(project.possession_date)}</span>}
                {project.is_published && (
                  <Badge variant="success" className="ml-auto">
                    <Globe className="size-3" aria-hidden="true" /> Live
                  </Badge>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
          <span className="money">
            Page {pagination.page} / {pages} · {formatNumber(pagination.total)} projects
          </span>
          <span className="flex gap-1">
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(pagination.page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={pagination.page >= pages} onClick={() => pagination.onPageChange(pagination.page + 1)}>
              Next
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
