import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Copy, ExternalLink, MoreHorizontal, Pencil, Plus, Tags, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RATE_CARD_STATUSES,
  RATE_CARD_STATUS_LABELS,
  type RateCardApplyResponse,
  type RateCardRow,
} from "@kkt/contracts";
import {
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  Toolbar,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { useProjectOptions } from "@/features/shared/options";
import { RateCardFormSheet } from "./RateCardFormSheet";
import { BLOCKS_PATH, FLATS_PATH, PROJECTS_PATH, RATE_CARDS_PATH } from "./api";
import { Notice } from "./components";

const FILTERS = ["project_id", "status"] as const;

interface SheetState {
  open: boolean;
  projectId: string | null;
  row: RateCardRow | null;
  clone: RateCardRow | null;
}

interface ApplyState {
  card: RateCardRow;
  preview: RateCardApplyResponse | null;
  loading: boolean;
}

/** `/rate-cards` — every project's rate cards in one table; create / edit / activate / apply reuse the project-level sheet. */
export default function RateCardsOverviewPage() {
  const { can } = useAuth();
  const canWrite = can("rate_card.write");
  const list = useListParams({ filterKeys: FILTERS, defaultSort: "-effective_from" });
  const query = useList<RateCardRow>(RATE_CARDS_PATH, list.params);
  const projects = useProjectOptions();
  const [sheet, setSheet] = useState<SheetState>({ open: false, projectId: null, row: null, clone: null });
  const [activateTarget, setActivateTarget] = useState<RateCardRow | null>(null);
  const [apply, setApply] = useState<ApplyState | null>(null);
  const [newProject, setNewProject] = useState<string | null>(null);

  const projectName = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project.name])),
    [projects.data],
  );
  const invalidate = [[RATE_CARDS_PATH], [FLATS_PATH], [BLOCKS_PATH], [PROJECTS_PATH]];

  const activate = useMutationWithToast<RateCardRow, RateCardRow>({
    mutationFn: (card) =>
      api.post<RateCardRow>(
        `${RATE_CARDS_PATH}/${card.id}/activate`,
        { version: card.version, apply_to_available_flats: true },
        { version: card.version },
      ),
    successMessage: (saved) => `"${saved.name}" is now the active rate card`,
    invalidate,
    entityLabel: "This rate card",
  });

  const applyMutation = useMutationWithToast<RateCardApplyResponse, RateCardRow>({
    mutationFn: (card) => api.post<RateCardApplyResponse>(`${RATE_CARDS_PATH}/${card.id}/apply`, { dry_run: false }),
    successMessage: (result) =>
      `${formatNumber(result.repriced)} available ${result.repriced === 1 ? "flat" : "flats"} re-priced`,
    invalidate,
    entityLabel: "This rate card",
  });

  const openApply = async (card: RateCardRow) => {
    setApply({ card, preview: null, loading: true });
    try {
      const preview = await api.post<RateCardApplyResponse>(`${RATE_CARDS_PATH}/${card.id}/apply`, { dry_run: true });
      setApply({ card, preview, loading: false });
    } catch {
      setApply({ card, preview: null, loading: false });
    }
  };

  const openNew = (projectId: string | null) => {
    const target = projectId ?? list.filters.project_id ?? null;
    if (!target) {
      setNewProject("");
      return;
    }
    setSheet({ open: true, projectId: target, row: null, clone: null });
  };

  const columns = useMemo<ColumnDef<RateCardRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Rate card",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{row.original.name}</span>
            <span className="block truncate text-2xs text-ink-subtle">
              {formatNumber(row.original.rates.length)} flat {row.original.rates.length === 1 ? "type" : "types"} ·{" "}
              {formatNumber(row.original.plc_rules.length)} PLC {row.original.plc_rules.length === 1 ? "rule" : "rules"}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "project_id",
        header: "Project",
        cell: ({ row }) => (
          <Link
            to={`/projects/${row.original.project_id}?tab=rate-cards`}
            className="text-navy-800 hover:underline focus-ring rounded-xs"
            onClick={(event) => event.stopPropagation()}
          >
            {projectName.get(row.original.project_id) ?? "Project"}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusChip status={row.original.status} label={RATE_CARD_STATUS_LABELS[row.original.status]} size="sm" />
        ),
      },
      {
        accessorKey: "effective_from",
        header: "Effective",
        cell: ({ row }) => <span className="money">{formatDate(row.original.effective_from)}</span>,
      },
      {
        id: "range",
        header: "Rate / sq ft",
        meta: { sortKey: false, align: "right" },
        cell: ({ row }) => {
          const rates = row.original.rates
            .map((rate) => rate.rate_per_sqft_paise)
            .filter((rate): rate is number => rate !== null);
          if (rates.length === 0) return <span className="text-ink-subtle">lump sums</span>;
          const min = Math.min(...rates);
          const max = Math.max(...rates);
          return (
            <span className="money">{min === max ? formatINR(min) : `${formatINR(min)} – ${formatINR(max)}`}</span>
          );
        },
      },
      {
        accessorKey: "activated_at",
        header: "Activated",
        meta: { hideOnMobile: true },
        cell: ({ row }) => (
          <span className="money text-ink-muted">
            {row.original.activated_at ? formatDate(row.original.activated_at) : "—"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { sortKey: false, width: 180, align: "right", label: "Actions", locked: true },
        cell: ({ row }) => {
          const card = row.original;
          if (!canWrite) return null;
          return (
            <span className="flex items-center justify-end gap-1">
              {card.status === "DRAFT" && (
                <Button
                  size="xs"
                  variant="gold"
                  leftIcon={CheckCircle2}
                  onClick={() => setActivateTarget(card)}
                  data-testid={`rate-card-activate-${card.id}`}
                >
                  Activate
                </Button>
              )}
              {card.status === "ACTIVE" && (
                <Button
                  size="xs"
                  variant="outline"
                  leftIcon={Zap}
                  onClick={() => void openApply(card)}
                  data-testid={`rate-card-apply-${card.id}`}
                >
                  Apply
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton icon={MoreHorizontal} label={`Actions for ${card.name}`} size="sm" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {card.status === "DRAFT" && (
                    <DropdownMenuItem
                      onSelect={() => setSheet({ open: true, projectId: card.project_id, row: card, clone: null })}
                    >
                      <Pencil /> Edit draft
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => setSheet({ open: true, projectId: card.project_id, row: null, clone: card })}
                  >
                    <Copy /> Duplicate as draft
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to={`/projects/${card.project_id}?tab=rate-cards`}>
                      <ExternalLink /> Open in project
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          );
        },
      },
    ],
    [canWrite, projectName],
  );

  const activeCount = (query.data?.items ?? []).filter((card) => card.status === "ACTIVE").length;
  const activeFor = activateTarget
    ? (query.data?.items ?? []).find(
        (card) => card.project_id === activateTarget.project_id && card.status === "ACTIVE",
      )
    : null;

  return (
    <>
      <PageHeader
        title="Rate cards"
        description="Pricing per flat type with PLC rules, across every project. One Active card per project prices its Available flats."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Inventory" }, { label: "Rate cards" }]}
        actions={
          canWrite ? (
            <Button leftIcon={Plus} onClick={() => openNew(null)} data-testid="rate-card-new-btn">
              New rate card
            </Button>
          ) : undefined
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search rate cards…"
        filters={
          <>
            <Combobox
              aria-label="Project"
              size="sm"
              className="w-full sm:w-48"
              value={list.filters.project_id ?? null}
              onValueChange={(value) => list.setFilter("project_id", value)}
              options={(projects.data ?? []).map((project) => ({
                value: project.id,
                label: project.name,
                description: project.code ?? undefined,
              }))}
              placeholder="All projects"
              allowClear
              data-testid="rate-cards-filter-project"
            />
            <Select
              aria-label="Status"
              size="sm"
              className="w-full sm:w-36"
              value={list.filters.status ?? null}
              onValueChange={(value) => list.setFilter("status", value)}
              options={RATE_CARD_STATUSES.map((value) => ({ value, label: RATE_CARD_STATUS_LABELS[value] }))}
              placeholder="Any status"
              allowClear
              data-testid="rate-cards-filter-status"
            />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: RATE_CARDS_PATH, params: list.params, filename: "rate-cards.csv" }}
        exportTotal={query.data?.total}
        summary={
          query.data
            ? `${formatNumber(query.data.total)} cards · ${formatNumber(activeCount)} active on this page`
            : undefined
        }
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
        rowClassName={(row) => (row.status === "ACTIVE" ? "[&>td]:bg-gold-light/30" : undefined)}
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          total: query.data?.total ?? 0,
          onPageChange: list.setPage,
          onPageSizeChange: list.setPageSize,
        }}
        emptyState={{
          icon: Tags,
          title: "No rate cards yet",
          description: "Create a draft per project with rates per flat type, then activate it to price the inventory.",
          action: canWrite ? (
            <Button leftIcon={Plus} onClick={() => openNew(null)}>
              New rate card
            </Button>
          ) : undefined,
        }}
        data-testid="rate-cards-table"
      />

      {sheet.projectId && (
        <RateCardFormSheet
          key={`${sheet.projectId}-${sheet.row?.id ?? "new"}`}
          projectId={sheet.projectId}
          open={sheet.open}
          onOpenChange={(open) => setSheet((state) => ({ ...state, open }))}
          rateCard={sheet.row}
          cloneFrom={sheet.clone}
        />
      )}

      <ConfirmDialog
        open={newProject !== null}
        onOpenChange={(open) => !open && setNewProject(null)}
        title="Which project is this rate card for?"
        description="Rates and PLC rules apply to one project's flat types."
        confirmLabel="Continue"
        onConfirm={() => {
          if (newProject) {
            setSheet({ open: true, projectId: newProject, row: null, clone: null });
            setNewProject(null);
          }
        }}
      >
        {projects.isPending ? (
          <Skeleton className="h-9" />
        ) : (
          <Combobox
            aria-label="Project"
            value={newProject || null}
            onValueChange={(value) => setNewProject(value ?? "")}
            options={(projects.data ?? []).map((project) => ({
              value: project.id,
              label: project.name,
              description: project.code ?? undefined,
            }))}
            placeholder="Pick a project"
            data-testid="rate-card-new-project"
          />
        )}
        {newProject === "" && <p className="mt-2 text-xs text-ink-subtle">Pick a project to continue.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={activateTarget !== null}
        onOpenChange={(open) => !open && setActivateTarget(null)}
        title="Activate this rate card?"
        description={
          activateTarget
            ? `"${activateTarget.name}" becomes the only Active card for ${projectName.get(activateTarget.project_id) ?? "its project"}${activeFor ? ` and supersedes "${activeFor.name}"` : ""}. Available flats are re-priced; Hold, Booked and Sold flats keep their price.`
            : undefined
        }
        confirmLabel="Activate"
        onConfirm={async () => {
          if (activateTarget) await activate.mutateAsync(activateTarget);
        }}
      />

      <ConfirmDialog
        open={apply !== null}
        onOpenChange={(open) => !open && setApply(null)}
        title="Apply rate card to the project?"
        description={
          apply
            ? `Re-prices Available flats with "${apply.card.name}". Flats on Hold, Booked or Sold are never touched.`
            : undefined
        }
        confirmLabel={apply?.preview ? `Re-price ${formatNumber(apply.preview.repriced)} flats` : "Apply"}
        onConfirm={async () => {
          if (apply) await applyMutation.mutateAsync(apply.card);
        }}
      >
        {apply?.loading && <Skeleton className="h-10" />}
        {apply?.preview && (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-success-bg p-2">
              <dt className="label-caps">Will re-price</dt>
              <dd className="money text-lg font-bold text-success-fg">{formatNumber(apply.preview.repriced)}</dd>
            </div>
            <div className="rounded-md bg-surface p-2">
              <dt className="label-caps">Not available</dt>
              <dd className="money text-lg font-bold text-ink">{formatNumber(apply.preview.skipped_not_available)}</dd>
            </div>
            <div className="rounded-md bg-warning-bg p-2">
              <dt className="label-caps">No rate</dt>
              <dd className="money text-lg font-bold text-warning-fg">{formatNumber(apply.preview.skipped_no_rate)}</dd>
            </div>
          </dl>
        )}
        {apply && !apply.loading && !apply.preview && (
          <Notice tone="warning">Could not preview the count; applying will still only touch Available flats.</Notice>
        )}
      </ConfirmDialog>
      {!canWrite && query.data && query.data.total > 0 && (
        <p className="mt-3 text-xs text-ink-subtle">
          Viewing only — creating, activating and applying rate cards needs the “rate_card.write” permission.
        </p>
      )}
    </>
  );
}
