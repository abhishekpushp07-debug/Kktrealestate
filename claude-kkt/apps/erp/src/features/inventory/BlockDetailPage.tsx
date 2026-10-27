import { Layers, Pencil, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  BLOCK_STATUSES,
  BLOCK_STATUS_LABELS,
  FLAT_STATUS_LABELS,
  NUMBERING_PATTERN_LABELS,
  type BlockGenerateFlatsResponse,
  type BlockRow,
  type FlatBulkResponse,
  type GridColourMode,
} from "@kkt/contracts";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  FieldWrapper,
  Input,
  MoneyInput,
  PageHeader,
  PageSkeleton,
  ProgressRing,
  Select,
  SimpleDialog,
  Skeleton,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { api, isApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import NotFoundPage from "@/pages/NotFoundPage";
import { ConstructionPanel } from "./ConstructionPanel";
import { FlatDrawer } from "./FlatDrawer";
import { FlatsTable } from "./FlatsPage";
import { InventoryGrid, type BulkPriceInput, type BulkStatusInput } from "./InventoryGrid";
import { BLOCKS_PATH, FLATS_PATH, inventoryKeys, PROJECTS_PATH, useBlock, useBlockGrid, useProject } from "./api";
import { Notice, UnitCountsBar, useTabParam } from "./components";
import { hoursFromNow } from "./inventoryMath";
import { RateCardsTab } from "./project/RateCardsTab";

const TABS = ["grid", "flats", "construction", "pricing"] as const;
type Tab = (typeof TABS)[number];
const COLOURS: readonly GridColourMode[] = ["STATUS", "FLAT_TYPE", "PRICE_BAND"];

/** `/blocks/:id` — tower header with construction ring, inventory grid, flats table, construction and pricing. */
export default function BlockDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const block = useBlock(id);
  const [tab, setTab] = useTabParam<Tab>(TABS, "grid");
  const [editOpen, setEditOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const generate = useMutationWithToast<BlockGenerateFlatsResponse, BlockRow>({
    mutationFn: (row) =>
      api.post<BlockGenerateFlatsResponse>(
        `${BLOCKS_PATH}/${row.id}/generate-flats`,
        { version: row.version, regenerate: false },
        { version: row.version },
      ),
    successMessage: (result) =>
      `${formatNumber(result.flats_created)} flats generated across ${formatNumber(result.floors_with_units)} floors` +
      (result.flats_preserved ? `; ${formatNumber(result.flats_preserved)} with booking history kept in place` : ""),
    invalidate: [[BLOCKS_PATH], [FLATS_PATH], [PROJECTS_PATH]],
    entityLabel: "This block",
  });

  if (block.isPending) return <PageSkeleton />;
  if (block.isError) {
    if (isApiClientError(block.error) && block.error.status === 404) return <NotFoundPage />;
    return (
      <ErrorState
        error={block.error}
        onRetry={() => void block.refetch()}
        className="rounded-lg border border-border bg-card"
      />
    );
  }
  const row = block.data;
  const canBlock = can("block.write");

  return (
    <>
      <PageHeader
        title={row.name}
        titleAddon={
          <>
            <StatusChip status={row.status} label={BLOCK_STATUS_LABELS[row.status]} />
            {!row.has_flats && <Badge variant="warning">No flats yet</Badge>}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <Link to={`/projects/${row.project_id}`} className="font-medium text-navy-700 hover:underline">
              {row.project_name}
            </Link>
            <span className="font-mono">{row.code}</span>
            <span>{row.block_type_name}</span>
            {row.has_floors && (
              <span>
                Floors {row.floor_start}–{row.floors}
                {row.skip_floors.length ? ` · skips ${row.skip_floors.join(", ")}` : ""}
                {row.refuge_floors.length ? ` · refuge ${row.refuge_floors.join(", ")}` : ""}
                {row.podium_floors.length ? ` · podium ${row.podium_floors.join(", ")}` : ""}
              </span>
            )}
            <span>{NUMBERING_PATTERN_LABELS[row.numbering_pattern]}</span>
          </span>
        }
        breadcrumbs={[
          { label: "Home", to: "/" },
          { label: "Projects", to: "/projects" },
          { label: row.project_name, to: `/projects/${row.project_id}?tab=blocks` },
          { label: row.name },
        ]}
        backTo={`/projects/${row.project_id}?tab=blocks`}
        actions={
          canBlock ? (
            <>
              {!row.has_flats && (
                <Button
                  variant="gold"
                  leftIcon={Sparkles}
                  onClick={() => setGenerateOpen(true)}
                  data-testid="block-generate-btn"
                >
                  Generate flats
                </Button>
              )}
              <Button
                variant="outline"
                leftIcon={Pencil}
                onClick={() => setEditOpen(true)}
                data-testid="block-edit-btn"
              >
                Edit
              </Button>
            </>
          ) : undefined
        }
      >
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-card sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-center gap-3">
            <ProgressRing
              value={row.construction_percent}
              size={56}
              strokeWidth={5}
              tone="gold"
              aria-label="Construction progress"
            />
            <div className="leading-tight">
              <p className="label-caps">Construction</p>
              <p className="money text-sm font-semibold text-navy-950">
                {Math.round(row.construction_percent)}% complete
              </p>
              <p className="text-xs text-ink-subtle">{row.current_stage_name ?? "Not started"}</p>
            </div>
          </div>
          <UnitCountsBar counts={row.unit_counts} />
        </div>
      </PageHeader>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList aria-label="Block sections">
          <TabsTrigger value="grid" data-testid="block-tab-grid">
            Inventory grid
          </TabsTrigger>
          <TabsTrigger value="flats" count={row.unit_counts.total} data-testid="block-tab-flats">
            Flats
          </TabsTrigger>
          <TabsTrigger value="construction" data-testid="block-tab-construction">
            Construction
          </TabsTrigger>
          <TabsTrigger value="pricing" data-testid="block-tab-pricing">
            Pricing
          </TabsTrigger>
        </TabsList>
        <TabsContent value="grid">
          <GridTab block={row} />
        </TabsContent>
        <TabsContent value="flats">
          <FlatsTable blockId={row.id} prefix="f_" />
        </TabsContent>
        <TabsContent value="construction">
          <ConstructionPanel blockId={row.id} compact />
        </TabsContent>
        <TabsContent value="pricing">
          <PricingTab block={row} />
        </TabsContent>
      </Tabs>

      <EditBlockDialog block={row} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        title="Generate flats?"
        description={`Creates every flat for ${row.name} from its floor-plan ranges, snapshots rooms and areas and prices them with the active rate card. Nothing is created if any step fails.`}
        confirmLabel="Generate"
        onConfirm={async () => {
          await generate.mutateAsync(row);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Grid tab                                                             */
/* ------------------------------------------------------------------ */

function GridTab({ block }: { block: BlockRow }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const colourParam = params.get("colour");
  const colourBy: GridColourMode = COLOURS.includes(colourParam as GridColourMode)
    ? (colourParam as GridColourMode)
    : "STATUS";
  const grid = useBlockGrid(block.id, colourBy);
  const selectedFlat = params.get("flat");

  const setParam = (key: string, value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const invalidate = useMemo(() => [[BLOCKS_PATH], [FLATS_PATH], [PROJECTS_PATH]], []);

  const bulkStatus = useMutationWithToast<FlatBulkResponse, BulkStatusInput>({
    mutationFn: ({ flatIds, status, holdHours, reason }) =>
      api.post<FlatBulkResponse>(`${BLOCKS_PATH}/${block.id}/bulk-status`, {
        flat_ids: flatIds,
        status,
        reason: reason ?? null,
        hold_until: status === "HOLD" ? hoursFromNow(holdHours ?? 48) : null,
      }),
    successMessage: (result, { status }) =>
      `${formatNumber(result.updated)} flats set to ${FLAT_STATUS_LABELS[status].toLowerCase()}${result.skipped ? ` · ${formatNumber(result.skipped)} skipped` : ""}`,
    invalidate,
  });

  const bulkPrice = useMutationWithToast<FlatBulkResponse, BulkPriceInput>({
    mutationFn: ({ flatIds, mode, valuePaise, floorRiseStepPaise }) =>
      api.post<FlatBulkResponse>(`${BLOCKS_PATH}/${block.id}/bulk-price`, {
        block_id: block.id,
        flat_ids: flatIds,
        ...(mode === "RATE" ? { rate_per_sqft_paise: valuePaise } : { price_paise: valuePaise }),
        ...(floorRiseStepPaise ? { floor_rise_step_paise: floorRiseStepPaise } : {}),
        only_available: true,
      }),
    successMessage: (result) =>
      `${formatNumber(result.updated)} flats re-priced${result.skipped ? ` · ${formatNumber(result.skipped)} skipped (not available)` : ""}`,
    invalidate,
  });

  if (!block.has_flats) {
    return (
      <Notice tone="warning">
        This block has no flats yet. Generate them from the header to see the inventory grid.
      </Notice>
    );
  }
  if (grid.isPending) return <Skeleton className="h-96 rounded-lg" />;
  if (grid.isError)
    return (
      <ErrorState
        error={grid.error}
        onRetry={() => void grid.refetch()}
        className="rounded-lg border border-border bg-card"
      />
    );

  return (
    <>
      <InventoryGrid
        grid={grid.data}
        colourBy={colourBy}
        onColourByChange={(mode) => setParam("colour", mode === "STATUS" ? null : mode)}
        onCellClick={(cell) => setParam("flat", cell.flat_id)}
        canChangeStatus={can("flat.status")}
        canEditPrice={can("flat.write")}
        onBulkStatus={(input) => bulkStatus.mutateAsync(input)}
        onBulkPrice={(input) => bulkPrice.mutateAsync(input)}
        loading={grid.isFetching}
      />
      <FlatDrawer flatId={selectedFlat} onClose={() => setParam("flat", null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing tab                                                          */
/* ------------------------------------------------------------------ */

function PricingTab({ block }: { block: BlockRow }) {
  const { can } = useAuth();
  const project = useProject(block.project_id);
  const grid = useBlockGrid(block.has_flats ? block.id : null, "PRICE_BAND");
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [floors, setFloors] = useState<number[]>([]);
  const [mode, setMode] = useState<"PRICE" | "RATE">("RATE");
  const [value, setValue] = useState<number | null>(null);
  const [step, setStep] = useState<number | null>(null);

  const bulk = useMutationWithToast<FlatBulkResponse, void>({
    mutationFn: () =>
      api.post<FlatBulkResponse>(`${BLOCKS_PATH}/${block.id}/bulk-price`, {
        block_id: block.id,
        floors,
        ...(mode === "RATE" ? { rate_per_sqft_paise: value ?? 0 } : { price_paise: value ?? 0 }),
        ...(step ? { floor_rise_step_paise: step } : {}),
        only_available: true,
      }),
    successMessage: (result) =>
      `${formatNumber(result.updated)} available flats re-priced${result.skipped ? ` · ${formatNumber(result.skipped)} skipped` : ""}`,
    invalidate: [[BLOCKS_PATH], [FLATS_PATH], [PROJECTS_PATH]],
    onSuccess: () => {
      setFloorsOpen(false);
      setFloors([]);
      setValue(null);
      setStep(null);
    },
  });

  const unitFloors = useMemo(
    () =>
      (grid.data?.floors ?? [])
        .filter((floor) => floor.kind === "UNITS" && floor.cells.length > 0)
        .sort((a, b) => b.floor - a.floor),
    [grid.data],
  );

  return (
    <div className="space-y-4">
      {can("flat.write") && block.has_flats && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-4 shadow-card">
          <div>
            <p className="font-display text-md font-bold text-navy-950">Bulk price by floor</p>
            <p className="text-xs text-ink-subtle">
              Set a rate per sq ft (with an optional floor-rise step) or a flat price on whole floors. Only Available
              flats change.
            </p>
          </div>
          <Button
            variant="outline"
            leftIcon={Layers}
            onClick={() => setFloorsOpen(true)}
            data-testid="block-bulk-floor-price"
          >
            Price floors…
          </Button>
        </div>
      )}
      {grid.data && grid.data.legend.price_bands.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-card">
          <p className="label-caps mb-2">Price bands in this block</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {grid.data.legend.price_bands.map((band) => (
              <li key={band.band} className="rounded-md border border-border px-3 py-2 text-sm">
                <p className="font-semibold text-navy-950">{band.label}</p>
                <p className="money text-xs text-ink-subtle">
                  {formatNumber(band.count)} {band.count === 1 ? "flat" : "flats"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {project.data ? (
        <RateCardsTab project={project.data} blockId={block.id} />
      ) : (
        <Skeleton className="h-40 rounded-lg" />
      )}

      <SimpleDialog
        open={floorsOpen}
        onOpenChange={(open) => !bulk.isPending && setFloorsOpen(open)}
        title="Bulk price by floor"
        description="Pick floors, then a rate or a price. Hold, Booked and Sold flats are skipped."
        footer={
          <>
            <Button variant="outline" onClick={() => setFloorsOpen(false)} disabled={bulk.isPending}>
              Cancel
            </Button>
            <Button
              loading={bulk.isPending}
              disabled={floors.length === 0 || value === null}
              onClick={() => bulk.mutate()}
              data-testid="block-bulk-floor-submit"
            >
              Re-price {floors.length} {floors.length === 1 ? "floor" : "floors"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FieldWrapper label="Floors" required>
            <div className="flex flex-wrap gap-1.5">
              {unitFloors.map((floor) => {
                const active = floors.includes(floor.floor);
                return (
                  <button
                    key={floor.floor}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setFloors((prev) =>
                        active ? prev.filter((value) => value !== floor.floor) : [...prev, floor.floor],
                      )
                    }
                    className={`money h-8 min-w-10 rounded-md border px-2 text-xs font-semibold focus-ring ${active ? "border-navy-950 bg-navy-950 text-white" : "border-border-strong text-ink-muted hover:border-navy-300"}`}
                  >
                    {floor.floor_label}
                  </button>
                );
              })}
              {unitFloors.length > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setFloors(floors.length === unitFloors.length ? [] : unitFloors.map((floor) => floor.floor))
                  }
                >
                  {floors.length === unitFloors.length ? "Clear" : "All floors"}
                </Button>
              )}
            </div>
          </FieldWrapper>
          <FieldWrapper label="Mode">
            {(control) => (
              <Select
                id={control.id}
                value={mode}
                onValueChange={(next) => setMode(next === "PRICE" ? "PRICE" : "RATE")}
                options={[
                  { value: "RATE", label: "Rate per sq ft × super built-up" },
                  { value: "PRICE", label: "Same price on every flat" },
                ]}
              />
            )}
          </FieldWrapper>
          <FieldWrapper label={mode === "RATE" ? "Rate per sq ft" : "Price"} required>
            {(control) => <MoneyInput id={control.id} value={value} onChange={setValue} showShort={mode === "PRICE"} />}
          </FieldWrapper>
          {mode === "RATE" && (
            <FieldWrapper label="Floor-rise step" hint="Added per floor above the first (per sq ft)">
              {(control) => <MoneyInput id={control.id} value={step} onChange={setStep} showShort={false} />}
            </FieldWrapper>
          )}
        </div>
      </SimpleDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Edit block                                                           */
/* ------------------------------------------------------------------ */

function EditBlockDialog({
  block,
  open,
  onOpenChange,
}: {
  block: BlockRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(block.name);
  const [code, setCode] = useState(block.code);
  const [status, setStatus] = useState<string>(block.status);
  const save = useMutationWithToast<BlockRow, void>({
    mutationFn: () =>
      api.patch<BlockRow>(
        `${BLOCKS_PATH}/${block.id}`,
        { name: name.trim(), code: code.trim().toUpperCase(), status, version: block.version },
        { version: block.version },
      ),
    successMessage: "Block saved",
    invalidate: [[BLOCKS_PATH], inventoryKeys.projectBlocks(block.project_id)],
    entityLabel: "This block",
    onSuccess: () => onOpenChange(false),
  });
  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(block.name);
          setCode(block.code);
          setStatus(block.status);
        }
        if (!save.isPending) onOpenChange(next);
      }}
      title="Edit block"
      description="Structural fields (floors, ranges) can only change while every flat is Available; use Generate / append floors for those."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!name.trim() || !code.trim()}
            onClick={() => save.mutate()}
            data-testid="block-edit-save"
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FieldWrapper label="Name" required>
          {(control) => (
            <Input id={control.id} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          )}
        </FieldWrapper>
        <FieldWrapper label="Code" required>
          {(control) => (
            <Input
              id={control.id}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              maxLength={30}
              className="font-mono uppercase"
            />
          )}
        </FieldWrapper>
        <FieldWrapper label="Status">
          {(control) => (
            <Select
              id={control.id}
              value={status}
              onValueChange={(value) => setStatus(value ?? block.status)}
              options={BLOCK_STATUSES.map((value) => ({ value, label: BLOCK_STATUS_LABELS[value] }))}
            />
          )}
        </FieldWrapper>
      </div>
    </SimpleDialog>
  );
}
