import { Camera, CheckCircle2, Circle, Clock3, Eye, EyeOff, Globe, RotateCcw, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { STAGE_STATUS_LABELS, type BlockConstructionResponse, type BlockStageRow, type ConstructionStatusUpdateResponse, type ConstructionUndoResponse, type DocumentRow, type StagePhotoRow } from "@kkt/contracts";
import { Badge, Button, Checkbox, ConfirmDialog, DateInput, ErrorState, FieldWrapper, ProgressRing, Select, SimpleDialog, Skeleton, Switch, Textarea, Timeline, type TimelineItem } from "@/components/ui";
import { api, isApiClientError, type ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatNumber, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { UploadDocumentDialog } from "./DocumentsPanel";
import { BLOCKS_PATH, inventoryKeys, PROJECTS_PATH, useBlockConstruction } from "./api";
import { Notice } from "./components";

export interface ConstructionPanelProps {
  blockId: string;
  /** Hide the header ring (block detail already shows one). */
  compact?: boolean;
}

interface BlockingPayment {
  receipt_number: string;
  payment_date: string;
  demand_number: string;
}

function blockingPayments(error: ApiClientError): BlockingPayment[] {
  const raw = error.details?.blocking_payments;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    return [{ receipt_number: String(record.receipt_number ?? ""), payment_date: String(record.payment_date ?? ""), demand_number: String(record.demand_number ?? "") }];
  });
}

/** Vertical stage timeline with status update (jump-ahead confirmation), undo and per-stage photo manager. */
export function ConstructionPanel({ blockId, compact = false }: ConstructionPanelProps) {
  const { can } = useAuth();
  const canUpdate = can("construction.update");
  const canUndo = can("construction.undo");
  const construction = useBlockConstruction(blockId);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [undoTarget, setUndoTarget] = useState<BlockStageRow | null>(null);
  const [undoBlocked, setUndoBlocked] = useState<BlockingPayment[] | null>(null);
  const [photosFor, setPhotosFor] = useState<BlockStageRow | null>(null);

  const invalidate = [inventoryKeys.blockConstruction(blockId), [BLOCKS_PATH], [PROJECTS_PATH]];

  const undo = useMutationWithToast<ConstructionUndoResponse, { stage: BlockStageRow; reason: string; version: number }>({
    mutationFn: ({ stage, reason, version }) => api.post<ConstructionUndoResponse>(`${BLOCKS_PATH}/${blockId}/construction/undo`, { version, stage_id: stage.stage_id, reason }, { version }),
    successMessage: (result) => `Stage undone${result.voided_demand_numbers.length ? ` · ${result.voided_demand_numbers.length} demands voided` : ""}`,
    invalidate,
    entityLabel: "Construction status",
    errorMessage: (error) => (error.code === "UNDO_BLOCKED" ? "Undo is blocked by payments made after the demand." : error.message),
    onError: (error) => {
      if (error.code === "UNDO_BLOCKED") setUndoBlocked(blockingPayments(error));
    },
  });

  if (construction.isPending) return <Skeleton className="h-72 rounded-lg" />;
  if (construction.isError) return <ErrorState error={construction.error} onRetry={() => void construction.refetch()} className="rounded-lg border border-border bg-card" />;
  const data = construction.data;
  const stages = [...data.stages].sort((a, b) => a.sort_order - b.sort_order);
  const completed = stages.filter((stage) => stage.status === "COMPLETED");
  const lastCompleted = completed[completed.length - 1] ?? null;
  const next = stages.find((stage) => stage.status !== "COMPLETED") ?? null;

  const items: TimelineItem[] = stages.map((stage) => ({
    id: stage.id,
    title: (
      <span className="flex flex-wrap items-center gap-2">
        <span>{stage.name}</span>
        {stage.is_possession && <Badge variant="gold">Possession</Badge>}
        <Badge variant={stage.status === "COMPLETED" ? "success" : stage.status === "IN_PROGRESS" ? "warning" : "neutral"}>{STAGE_STATUS_LABELS[stage.status]}</Badge>
      </span>
    ),
    description: (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {stage.started_on && <span>Started {formatDate(stage.started_on)}</span>}
        {stage.completed_on && <span>Completed {formatDate(stage.completed_on)}</span>}
        {stage.completed_by_name && <span>by {stage.completed_by_name}</span>}
        {stage.demands_raised > 0 && (
          <span className="money">
            {formatNumber(stage.demands_raised)} {stage.demands_raised === 1 ? "demand" : "demands"} raised
          </span>
        )}
      </span>
    ),
    at: stage.completed_at,
    icon: stage.status === "COMPLETED" ? CheckCircle2 : stage.status === "IN_PROGRESS" ? Clock3 : Circle,
    tone: stage.status === "COMPLETED" ? "success" : stage.status === "IN_PROGRESS" ? "warning" : "neutral",
    children: (
      <div className="space-y-2">
        {stage.notes && <p className="whitespace-pre-wrap text-xs text-ink-muted">{stage.notes}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="xs" leftIcon={Camera} onClick={() => setPhotosFor(stage)} data-testid={`stage-photos-${stage.id}`}>
            Photos
            <span className="money rounded-full bg-navy-50 px-1.5 text-[10px] font-semibold">{stage.photos.length}</span>
          </Button>
          {canUndo && stage.can_undo && stage.status === "COMPLETED" && lastCompleted?.id === stage.id && (
            <Button variant="danger-outline" size="xs" leftIcon={RotateCcw} onClick={() => setUndoTarget(stage)} data-testid={`stage-undo-${stage.id}`}>
              Undo
            </Button>
          )}
        </div>
        {stage.photos.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {stage.photos.slice(0, 6).map((photo) => (
              <li key={photo.id} className="relative size-14 overflow-hidden rounded-sm border border-border bg-navy-50">
                {photo.thumb_url ? <img src={photo.thumb_url} alt={photo.caption ?? ""} className="size-full object-cover" loading="lazy" /> : <Camera className="m-auto size-4 text-ink-subtle" aria-hidden="true" />}
                {photo.show_on_website && <Globe className="absolute bottom-0.5 right-0.5 size-3 rounded-full bg-card p-px text-navy-700" aria-label="On website" />}
              </li>
            ))}
            {stage.photos.length > 6 && <li className="money flex size-14 items-center justify-center rounded-sm border border-dashed border-border text-xs text-ink-subtle">+{stage.photos.length - 6}</li>}
          </ul>
        )}
      </div>
    ),
  }));

  return (
    <div className="space-y-4" data-testid="construction-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-card">
        <div className="flex items-center gap-3">
          {!compact && <ProgressRing value={data.construction_percent} size={56} strokeWidth={5} tone="gold" aria-label="Construction progress" />}
          <div className="leading-tight">
            <p className="label-caps">Construction status</p>
            <p className="text-sm font-semibold text-navy-950">
              {completed.length}/{stages.length} stages complete{lastCompleted ? ` · ${lastCompleted.name}` : ""}
            </p>
            <p className="text-xs text-ink-subtle">{next ? `Up next: ${next.name}` : stages.length ? "All stages complete" : "No stage sequence on this block"}</p>
          </div>
        </div>
        {canUpdate && next && (
          <Button leftIcon={CheckCircle2} onClick={() => setUpdateOpen(true)} data-testid="construction-update-btn">
            Update status
          </Button>
        )}
      </div>

      {stages.length === 0 ? <Notice tone="warning">This block has no construction stage sequence. Set a sequence on the project before creating blocks.</Notice> : <Timeline items={items} absolute className="rounded-lg border border-border bg-card p-4 shadow-card" />}

      <UpdateStatusDialog open={updateOpen} onOpenChange={setUpdateOpen} blockId={blockId} data={data} stages={stages} />

      <ConfirmDialog
        open={undoTarget !== null}
        onOpenChange={(open) => !open && setUndoTarget(null)}
        title={`Undo "${undoTarget?.name ?? ""}"?`}
        description="Only the latest completed stage can be undone. Demands it raised are voided, ledgers recomputed and buyer notifications withdrawn. Blocked if a payment dated on/after a demand exists."
        confirmLabel="Undo stage"
        variant="destructive"
        requireReason
        onConfirm={async (reason) => {
          if (undoTarget) await undo.mutateAsync({ stage: undoTarget, reason: reason ?? "", version: data.version });
        }}
      />

      <SimpleDialog open={undoBlocked !== null} onOpenChange={(open) => !open && setUndoBlocked(null)} title="Undo blocked" description="A payment dated on or after one of this stage's demands exists. Reverse those payments first." size="sm" footer={<Button onClick={() => setUndoBlocked(null)}>Close</Button>}>
        {undoBlocked && undoBlocked.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-subtle">
                <th className="py-1 font-semibold">Receipt</th>
                <th className="py-1 font-semibold">Date</th>
                <th className="py-1 font-semibold">Demand</th>
              </tr>
            </thead>
            <tbody>
              {undoBlocked.map((payment) => (
                <tr key={`${payment.receipt_number}-${payment.demand_number}`} className="border-t border-border">
                  <td className="py-1 font-mono text-xs">{payment.receipt_number}</td>
                  <td className="money py-1">{formatDate(payment.payment_date)}</td>
                  <td className="py-1 font-mono text-xs">{payment.demand_number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-muted">The server did not list the blocking payments.</p>
        )}
      </SimpleDialog>

      {photosFor && <StagePhotosDialog open onOpenChange={(open) => !open && setPhotosFor(null)} blockId={blockId} stage={stages.find((stage) => stage.id === photosFor.id) ?? photosFor} canUpdate={canUpdate} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Update status dialog                                                 */
/* ------------------------------------------------------------------ */

interface UpdateStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: string;
  data: BlockConstructionResponse;
  stages: BlockStageRow[];
}

function UpdateStatusDialog({ open, onOpenChange, blockId, data, stages }: UpdateStatusDialogProps) {
  const pending = stages.filter((stage) => stage.status !== "COMPLETED");
  const [targetId, setTargetId] = useState<string | null>(pending[0]?.stage_id ?? null);
  const [completedOn, setCompletedOn] = useState<string>(todayIST());
  const [dates, setDates] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [notify, setNotify] = useState(true);
  const [result, setResult] = useState<ConstructionStatusUpdateResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setTargetId(pending[0]?.stage_id ?? null);
    setCompletedOn(todayIST());
    setDates({});
    setNotes("");
    setNotify(true);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const target = stages.find((stage) => stage.stage_id === targetId) ?? null;
  const intermediate = target ? pending.filter((stage) => stage.sort_order < target.sort_order) : [];
  const dateFor = (stage: BlockStageRow) => dates[stage.stage_id] ?? completedOn;

  // Dates must be non-decreasing along the sequence and ≤ the reached stage's date.
  const problems: string[] = [];
  let previous: string | null = null;
  for (const stage of intermediate) {
    const date = dateFor(stage);
    if (previous && date < previous) problems.push(`${stage.name} is dated before the previous stage`);
    if (date > completedOn) problems.push(`${stage.name} is dated after the reached stage`);
    previous = date;
  }

  const update = useMutationWithToast<ConstructionStatusUpdateResponse, void>({
    mutationFn: () => {
      if (!target) throw new Error("Pick a stage");
      const intermediateDates: Record<string, string> = {};
      for (const stage of intermediate) intermediateDates[stage.stage_id] = dateFor(stage);
      return api.post<ConstructionStatusUpdateResponse>(
        `${BLOCKS_PATH}/${blockId}/construction/status`,
        { version: data.version, stage_id: target.stage_id, completed_on: completedOn, intermediate_dates: intermediateDates, notes: notes.trim() || null, notify_buyers: notify },
        { version: data.version },
      );
    },
    successMessage: (response) => `${response.completed_stage_ids.length} ${response.completed_stage_ids.length === 1 ? "stage" : "stages"} marked complete${response.demands_raised ? ` · ${response.demands_raised} demands raised` : ""}`,
    invalidate: [inventoryKeys.blockConstruction(blockId), [BLOCKS_PATH], [PROJECTS_PATH]],
    entityLabel: "Construction status",
    onSuccess: (response) => setResult(response),
  });

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !update.isPending && onOpenChange(next)}
      title="Update construction status"
      description="Pick the stage reached. Any earlier pending stages are completed too with the dates below."
      footer={
        result ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button loading={update.isPending} disabled={!target || problems.length > 0} onClick={() => update.mutate()} data-testid="construction-update-submit">
              {intermediate.length > 0 ? `Complete ${intermediate.length + 1} stages` : "Mark complete"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone="success">
            <p className="font-semibold">Status updated — construction now {Math.round(result.construction_percent)}%.</p>
          </Notice>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-surface p-2">
              <dt className="label-caps">Stages</dt>
              <dd className="money text-lg font-bold">{result.completed_stage_ids.length}</dd>
            </div>
            <div className="rounded-md bg-surface p-2">
              <dt className="label-caps">Demands raised</dt>
              <dd className="money text-lg font-bold">{result.demands_raised}</dd>
            </div>
            <div className="rounded-md bg-surface p-2">
              <dt className="label-caps">Buyers notified</dt>
              <dd className="money text-lg font-bold">{result.buyers_notified}</dd>
            </div>
          </dl>
          {result.demand_numbers.length > 0 && <p className="font-mono text-xs text-ink-muted">{result.demand_numbers.join(", ")}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <FieldWrapper label="Stage reached" required>
            {(control) => <Select id={control.id} value={targetId} onValueChange={setTargetId} options={pending.map((stage) => ({ value: stage.stage_id, label: stage.name, description: stage.status === "IN_PROGRESS" ? "In progress" : undefined }))} data-testid="construction-target" />}
          </FieldWrapper>
          <FieldWrapper label="Completed on" required>
            {(control) => <DateInput id={control.id} value={completedOn} onChange={(value) => setCompletedOn(value ?? todayIST())} max={todayIST()} />}
          </FieldWrapper>
          {intermediate.length > 0 && (
            <div className="space-y-2 rounded-md border border-status-hold-border bg-warning-bg/40 p-3">
              <p className="text-sm font-semibold text-warning-fg">
                {intermediate.length} earlier {intermediate.length === 1 ? "stage" : "stages"} will also be completed:
              </p>
              <ul className="space-y-2">
                {intermediate.map((stage) => (
                  <li key={stage.id} className="grid grid-cols-[1fr_11rem] items-center gap-2 text-sm">
                    <span className="truncate">{stage.name}</span>
                    <DateInput aria-label={`Completion date for ${stage.name}`} value={dateFor(stage)} onChange={(value) => setDates((prev) => ({ ...prev, [stage.stage_id]: value ?? completedOn }))} max={completedOn} className="h-11 text-xs sm:h-8" />
                  </li>
                ))}
              </ul>
              {problems.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-danger-fg">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <FieldWrapper label="Notes">{(control) => <Textarea id={control.id} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={1000} placeholder="Site notes visible to staff (and buyers in their timeline)" />}</FieldWrapper>
          <Switch checked={notify} onCheckedChange={setNotify} label="Notify buyers" description="Buyers with installments on these stages get a demand and a notification" />
        </div>
      )}
    </SimpleDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Stage photos                                                         */
/* ------------------------------------------------------------------ */

interface StagePhotosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: string;
  stage: BlockStageRow;
  canUpdate: boolean;
}

function StagePhotosDialog({ open, onOpenChange, blockId, stage, canUpdate }: StagePhotosDialogProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [visibleToBuyers, setVisibleToBuyers] = useState(true);
  const [showOnWebsite, setShowOnWebsite] = useState(false);
  const invalidate = useMemo(() => [inventoryKeys.blockConstruction(blockId)], [blockId]);
  const photosPath = `${BLOCKS_PATH}/${blockId}/construction/${stage.id}/photos`;

  const attach = useMutationWithToast<StagePhotoRow, DocumentRow>({
    mutationFn: (document) => api.post<StagePhotoRow>(photosPath, { document_id: document.id, caption: caption.trim() || null, visible_to_buyers: visibleToBuyers, show_on_website: showOnWebsite, sort_order: stage.photos.length }),
    successMessage: "Photo added to the stage",
    invalidate,
    onSuccess: () => setCaption(""),
  });

  const toggle = useMutationWithToast<StagePhotoRow, { photo: StagePhotoRow; patch: Partial<Pick<StagePhotoRow, "visible_to_buyers" | "show_on_website">> }>({
    mutationFn: ({ photo, patch }) => api.patch<StagePhotoRow>(`/construction/photos/${photo.id}`, patch),
    successMessage: "Photo updated",
    invalidate,
  });

  return (
    <SimpleDialog open={open} onOpenChange={onOpenChange} title={`Photos · ${stage.name}`} description="Buyers see photos flagged visible-to-buyers in their own tower timeline; the website shows those flagged for it." size="lg" footer={<Button onClick={() => onOpenChange(false)}>Close</Button>}>
      <div className="space-y-4">
        {canUpdate && (
          <div className="space-y-3 rounded-md border border-border bg-surface/60 p-3">
            <p className="text-sm font-semibold text-navy-950">Add a photo</p>
            <FieldWrapper label="Caption">{(control) => <Textarea id={control.id} value={caption} onChange={(event) => setCaption(event.target.value)} rows={1} maxLength={200} placeholder="Slab casting, east wing" />}</FieldWrapper>
            <div className="flex flex-wrap gap-4">
              <Checkbox checked={visibleToBuyers} onCheckedChange={(checked) => setVisibleToBuyers(checked === true)} label="Visible to buyers" />
              <Checkbox checked={showOnWebsite} onCheckedChange={(checked) => setShowOnWebsite(checked === true)} label="Show on website" />
            </div>
            <Button size="sm" leftIcon={Upload} onClick={() => setUploadOpen(true)} loading={attach.isPending} data-testid="stage-photo-upload-btn">
              Upload & attach
            </Button>
          </div>
        )}
        {stage.photos.length === 0 ? (
          <p className="text-sm text-ink-subtle">No photos on this stage yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[...stage.photos]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((photo) => (
                <li key={photo.id} className="overflow-hidden rounded-md border border-border bg-card">
                  <div className="aspect-[4/3] bg-navy-50">{photo.medium_url || photo.thumb_url ? <img src={photo.medium_url ?? photo.thumb_url ?? ""} alt={photo.caption ?? ""} className="size-full object-cover" loading="lazy" /> : <Camera className="m-auto size-6 text-ink-subtle" aria-hidden="true" />}</div>
                  <div className="space-y-1.5 p-2">
                    <p className="truncate text-xs font-medium text-ink">{photo.caption || "Untitled"}</p>
                    <p className="text-2xs text-ink-subtle">{formatDateTime(photo.created_at)}</p>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" disabled={!canUpdate || toggle.isPending} onClick={() => toggle.mutate({ photo, patch: { visible_to_buyers: !photo.visible_to_buyers } })} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold focus-ring disabled:cursor-default", photo.visible_to_buyers ? "border-status-available-border bg-success-bg text-success-fg" : "border-border text-ink-subtle")} aria-pressed={photo.visible_to_buyers}>
                        {photo.visible_to_buyers ? <Eye className="size-3" aria-hidden="true" /> : <EyeOff className="size-3" aria-hidden="true" />} Buyers
                      </button>
                      <button type="button" disabled={!canUpdate || toggle.isPending} onClick={() => toggle.mutate({ photo, patch: { show_on_website: !photo.show_on_website } })} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold focus-ring disabled:cursor-default", photo.show_on_website ? "border-info/30 bg-info-bg text-info-fg" : "border-border text-ink-subtle")} aria-pressed={photo.show_on_website}>
                        <Globe className="size-3" aria-hidden="true" /> Website
                      </button>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} entityType="STAGE" entityId={stage.id} appliesTo="BLOCK" allowShare={false} imagesOnly title="Upload stage photo" onUploaded={(document) => attach.mutate(document)} />
    </SimpleDialog>
  );
}

/** Re-exported for the project construction tab. */
export function isUndoBlockedError(error: unknown): boolean {
  return isApiClientError(error) && error.code === "UNDO_BLOCKED";
}

