import { useQueryClient } from "@tanstack/react-query";
import {
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  GripVertical,
  Hammer,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Save,
} from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ConstructionStageRow, MasterRow } from "@kkt/contracts";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Skeleton,
  StatusChip,
  Switch,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMutationWithToast } from "@/lib/queries";
import { cn, useOnChange } from "@/lib/utils";
import { CsvImportDialog } from "./CsvImportDialog";
import { MasterFormSheet } from "./MasterFormSheet";
import { UsageDialog } from "./UsageDialog";
import { masterPath, useMasterRows } from "./api";
import type { MasterPageProps } from "./types";
import { useMasterActiveToggle } from "./useMasterActiveToggle";

const SLUG = "construction-stages" as const;

/** Moves `from` to `to` and returns a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/** Ordered list of construction stages with drag / arrow reordering and the single possession radio. */
export function ConstructionStagesPage({ config }: MasterPageProps) {
  const { can } = useAuth();
  const canWrite = can("master.write");
  const queryClient = useQueryClient();
  const path = masterPath(SLUG);
  const [showInactive, setShowInactive] = useState(false);
  const query = useMasterRows<ConstructionStageRow>(SLUG, { sort: "sort_order", includeInactive: showInactive });
  const serverActive = useMemo(() => (query.data ?? []).filter((stage) => stage.is_active), [query.data]);
  const inactive = useMemo(() => (query.data ?? []).filter((stage) => !stage.is_active), [query.data]);
  const [draft, setDraft] = useState<ConstructionStageRow[] | null>(null);
  const stages = draft ?? serverActive;
  const dirty =
    draft !== null &&
    (draft.length !== serverActive.length || draft.some((stage, index) => stage.id !== serverActive[index]?.id));

  // Drop a stale draft when the server list changes (someone saved or a stage was added).
  const serverIds = serverActive.map((stage) => stage.id).join("|");
  useOnChange(serverIds, () => setDraft(null));

  const [editing, setEditing] = useState<{ open: boolean; row: MasterRow | null }>({ open: false, row: null });
  const [importOpen, setImportOpen] = useState(false);
  const [usageRow, setUsageRow] = useState<MasterRow | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<ConstructionStageRow | null>(null);
  const { deactivate, activate, inUse, clearInUse } = useMasterActiveToggle(config);

  const reorder = useMutationWithToast<unknown, string[]>({
    mutationFn: (stageIds) => api.post<unknown>(`${path}/reorder`, { stage_ids: stageIds }),
    successMessage: "Stage order saved",
    invalidate: [[path]],
    onSuccess: () => setDraft(null),
  });

  const setPossession = useMutationWithToast<ConstructionStageRow, ConstructionStageRow>({
    mutationFn: async (stage) => {
      const updated = await api.patch<ConstructionStageRow>(
        `${path}/${stage.id}`,
        { is_possession: true, version: stage.version },
        { version: stage.version },
      );
      // Exactly one possession stage: clear any other flag the server left in place.
      const fresh = await api.list<ConstructionStageRow>(path, { page_size: 200, sort: "sort_order" });
      const others = fresh.items.filter((item) => item.is_possession && item.id !== stage.id);
      for (const other of others) {
        await api.patch<ConstructionStageRow>(
          `${path}/${other.id}`,
          { is_possession: false, version: other.version },
          { version: other.version },
        );
      }
      return updated;
    },
    successMessage: (stage) => `${stage.name} is now the possession stage`,
    invalidate: [[path]],
    entityLabel: config.singular,
  });

  /* ------------------------------ drag ------------------------------ */
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const [dragging, setDragging] = useState<string | null>(null);

  const indexAtPoint = (clientY: number): number => {
    let index = -1;
    stages.forEach((stage, position) => {
      const node = itemRefs.current.get(stage.id);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) index = position;
    });
    return index;
  };

  const onHandlePointerDown = (stageId: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canWrite) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(stageId);
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const from = stages.findIndex((stage) => stage.id === dragging);
    const to = indexAtPoint(event.clientY);
    if (from === -1 || to === -1 || from === to) return;
    setDraft(moveItem(stages, from, to));
  };

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(null);
  };

  const move = (from: number, to: number) => setDraft(moveItem(stages, from, to));

  const possessionCount = stages.filter((stage) => stage.is_possession).length;
  const nextSortOrder = (query.data?.reduce((max, stage) => Math.max(max, stage.sort_order), 0) ?? 0) + 1;

  return (
    <>
      <PageHeader
        title={config.label}
        description={config.description}
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Master data", to: "/masters" }, { label: config.label }]}
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="master-import-csv-btn">
                Import CSV
              </Button>
              <Button
                leftIcon={Plus}
                onClick={() => setEditing({ open: true, row: null })}
                data-testid="master-new-btn"
              >
                New stage
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-subtle">
          <Switch
            size="sm"
            label="Show inactive"
            checked={showInactive}
            onCheckedChange={setShowInactive}
            data-testid="stages-include-inactive-switch"
          />
          {query.data && (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                possessionCount === 1 ? "text-success-fg" : "text-danger-fg",
              )}
              role="status"
            >
              {possessionCount === 1
                ? "Possession stage set"
                : possessionCount === 0
                  ? "No possession stage flagged"
                  : `${possessionCount} stages flagged as possession — keep exactly one`}
            </span>
          )}
        </div>
        {dirty && canWrite && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={RotateCcw}
              onClick={() => setDraft(null)}
              disabled={reorder.isPending}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="gold"
              leftIcon={Save}
              loading={reorder.isPending}
              onClick={() => reorder.mutate(stages.map((stage) => stage.id))}
              data-testid="stages-save-order-btn"
            >
              Save order
            </Button>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        {query.isPending && (
          <ul className="divide-y divide-border">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="size-5" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="ml-auto h-4 w-20" />
              </li>
            ))}
          </ul>
        )}
        {query.isError && <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />}
        {query.data && stages.length === 0 && inactive.length === 0 && (
          <EmptyState
            compact
            icon={Hammer}
            title="No construction stages yet"
            description="Add the physical stages in order (Excavation → … → Possession) and flag the one that triggers possession."
            action={
              canWrite ? (
                <Button leftIcon={Plus} onClick={() => setEditing({ open: true, row: null })}>
                  New stage
                </Button>
              ) : undefined
            }
          />
        )}
        {query.data && (stages.length > 0 || inactive.length > 0) && (
          <ol className="divide-y divide-border" aria-label="Construction stages in order">
            {stages.map((stage, index) => (
              <li
                key={stage.id}
                ref={(node) => {
                  if (node) itemRefs.current.set(stage.id, node);
                  else itemRefs.current.delete(stage.id);
                }}
                className={cn(
                  "flex min-h-10 items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-3",
                  dragging === stage.id && "bg-gold-light/60",
                  !stage.is_active && "opacity-60",
                )}
                data-testid={`stage-row-${stage.id}`}
              >
                <button
                  type="button"
                  aria-label={`Drag to reorder ${stage.name}`}
                  disabled={!canWrite}
                  onPointerDown={onHandlePointerDown(stage.id)}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  className={cn(
                    "hidden size-7 shrink-0 touch-none items-center justify-center rounded-sm text-ink-subtle focus-ring sm:flex",
                    canWrite
                      ? "cursor-grab hover:bg-navy-50 hover:text-navy-950 active:cursor-grabbing"
                      : "cursor-default opacity-40",
                  )}
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                </button>
                <span className="money flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-950 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-navy-950">{stage.name}</span>
                    <code className="hidden rounded-xs bg-navy-50 px-1 py-0.5 font-mono text-2xs text-navy-950 sm:inline">
                      {stage.code}
                    </code>
                    {stage.is_possession && <Badge variant="gold">Possession</Badge>}
                  </div>
                  <span className="money block text-2xs text-ink-subtle sm:hidden">
                    {stage.code} · order {stage.sort_order}
                  </span>
                </div>
                <label
                  className={cn(
                    "hidden items-center gap-1.5 text-xs text-ink-muted sm:inline-flex",
                    canWrite ? "cursor-pointer" : "cursor-default",
                  )}
                  title="Possession stage"
                >
                  <input
                    type="radio"
                    name="possession-stage"
                    className="size-3.5 accent-navy-950 focus-ring"
                    checked={stage.is_possession}
                    disabled={!canWrite || setPossession.isPending}
                    onChange={() => setPossession.mutate(stage)}
                    data-testid={`stage-possession-${stage.id}`}
                  />
                  Possession
                </label>
                {canWrite && (
                  <div className="hidden items-center sm:flex">
                    <IconButton
                      icon={ArrowUp}
                      label="Move up"
                      size="xs"
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                      data-testid={`stage-up-${stage.id}`}
                    />
                    <IconButton
                      icon={ArrowDown}
                      label="Move down"
                      size="xs"
                      disabled={index === stages.length - 1}
                      onClick={() => move(index, index + 1)}
                      data-testid={`stage-down-${stage.id}`}
                    />
                  </div>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      icon={MoreHorizontal}
                      label={`Actions for ${stage.name}`}
                      size="sm"
                      data-testid={`row-actions-${stage.id}`}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canWrite && (
                      <>
                        <DropdownMenuItem onSelect={() => setEditing({ open: true, row: stage })}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="sm:hidden"
                          disabled={index === 0}
                          onSelect={() => move(index, index - 1)}
                        >
                          <ArrowUp /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="sm:hidden"
                          disabled={index === stages.length - 1}
                          onSelect={() => move(index, index + 1)}
                        >
                          <ArrowDown /> Move down
                        </DropdownMenuItem>
                        {!stage.is_possession && (
                          <DropdownMenuItem className="sm:hidden" onSelect={() => setPossession.mutate(stage)}>
                            <Hammer /> Set as possession
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                    <DropdownMenuItem onSelect={() => setUsageRow(stage)}>
                      <Link2 /> Where used
                    </DropdownMenuItem>
                    {canWrite && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => setConfirmDeactivate(stage)}>
                          <Power /> Deactivate
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
            {inactive.map((stage) => (
              <li
                key={stage.id}
                className="flex min-h-10 items-center gap-2 bg-surface/60 px-2 py-1.5 sm:gap-3 sm:px-3"
                data-testid={`stage-row-${stage.id}`}
              >
                <span className="hidden size-7 sm:block" aria-hidden="true" />
                <span className="money flex size-7 shrink-0 items-center justify-center rounded-full bg-border text-xs font-bold text-ink-muted">
                  –
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-muted">{stage.name}</span>
                    <code className="hidden rounded-xs bg-navy-50 px-1 py-0.5 font-mono text-2xs text-ink-muted sm:inline">
                      {stage.code}
                    </code>
                    <StatusChip status="INACTIVE" size="sm" />
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      icon={MoreHorizontal}
                      label={`Actions for ${stage.name}`}
                      size="sm"
                      data-testid={`row-actions-${stage.id}`}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setUsageRow(stage)}>
                      <Link2 /> Where used
                    </DropdownMenuItem>
                    {canWrite && (
                      <DropdownMenuItem onSelect={() => activate.mutate(stage)}>
                        <ArchiveRestore /> Restore
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <p className="mt-2 text-xs text-ink-subtle">
        Drag the handle or use the arrows to reorder, then save. Towers snapshot this sequence when they are created;
        existing towers keep theirs.
      </p>

      <MasterFormSheet
        config={{ ...config, defaults: () => ({ ...config.defaults(), sort_order: nextSortOrder }) }}
        open={editing.open}
        onOpenChange={(open) => setEditing((state) => ({ ...state, open }))}
        row={editing.row}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: [path] })}
      />
      <CsvImportDialog config={config} open={importOpen} onOpenChange={setImportOpen} />
      <UsageDialog
        config={config}
        row={usageRow}
        open={usageRow !== null}
        onOpenChange={(open) => !open && setUsageRow(null)}
      />
      <UsageDialog
        config={config}
        row={inUse?.row ?? null}
        preset={inUse?.usage ?? null}
        blocked
        open={inUse !== null}
        onOpenChange={(open) => !open && clearInUse()}
      />
      <ConfirmDialog
        open={confirmDeactivate !== null}
        onOpenChange={(open) => !open && setConfirmDeactivate(null)}
        title="Deactivate stage?"
        description={
          confirmDeactivate
            ? `${confirmDeactivate.name} will be removed from the sequence new towers snapshot. Towers already built keep it.`
            : undefined
        }
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={async () => {
          if (confirmDeactivate) await deactivate.mutateAsync(confirmDeactivate).catch(() => undefined);
        }}
      />
    </>
  );
}
