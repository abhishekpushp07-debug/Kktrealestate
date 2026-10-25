import { CalendarClock, CheckCircle2, ExternalLink, Phone, Save, UserX, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { VISIT_SOURCE_LABELS, VISIT_STATUS_LABELS, type VisitRow } from "@kkt/contracts";
import { Badge, Button, Combobox, ConfirmDialog, ErrorState, FieldWrapper, KeyValueList, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, SimpleDialog, Skeleton, StatusChip, Textarea } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatPhone } from "@/lib/format";
import { useItem, useMutationWithToast } from "@/lib/queries";
import { useSalesUserOptions } from "@/features/inventory/api";
import { Notice } from "@/features/inventory/components";
import { LEADS_PATH, VISITS_PATH, crmKeys, formatSlotTime } from "../api";
import { SlotPicker, type SlotValue } from "./SlotPicker";

export interface VisitDrawerProps {
  visitId: string | null;
  onClose: () => void;
}

export function visitIsOpen(visit: VisitRow): boolean {
  return visit.status === "CONFIRMED" || visit.status === "RESCHEDULED";
}

/** Visit details with confirm / reschedule / cancel / complete / no-show and notes. */
export function VisitDrawer({ visitId, onClose }: VisitDrawerProps) {
  const visit = useItem<VisitRow>(VISITS_PATH, visitId);
  return (
    <Sheet open={visitId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent size="md" data-testid="visit-drawer">
        {visit.isPending && (
          <>
            <SheetHeader>
              <SheetTitle>
                <Skeleton className="h-6 w-40" />
              </SheetTitle>
              <SheetDescription className="sr-only">Loading visit</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <Skeleton className="h-40" />
            </SheetBody>
          </>
        )}
        {visit.isError && (
          <>
            <SheetHeader>
              <SheetTitle>Site visit</SheetTitle>
              <SheetDescription className="sr-only">Error</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <ErrorState error={visit.error} onRetry={() => void visit.refetch()} compact />
            </SheetBody>
          </>
        )}
        {visit.data && <VisitDrawerBody visit={visit.data} />}
      </SheetContent>
    </Sheet>
  );
}

export const VISIT_INVALIDATE = [[VISITS_PATH], crmKeys.today, [LEADS_PATH]] as const;

function VisitDrawerBody({ visit }: { visit: VisitRow }) {
  const { can } = useAuth();
  const canWrite = can("visit.write");
  const [reschedule, setReschedule] = useState(false);
  const [slot, setSlot] = useState<SlotValue | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [outcome, setOutcome] = useState<"COMPLETED" | "NO_SHOW" | null>(null);
  const [notes, setNotes] = useState(visit.notes ?? "");
  const [assignee, setAssignee] = useState<string | null>(visit.assignee_user_id);
  const users = useSalesUserOptions(canWrite);
  const invalidate = useMemo(() => [...VISIT_INVALIDATE, [VISITS_PATH, "item", visit.id]], [visit.id]);

  useEffect(() => {
    setNotes(visit.notes ?? "");
    setAssignee(visit.assignee_user_id);
  }, [visit.notes, visit.assignee_user_id, visit.version]);

  const doReschedule = useMutationWithToast<VisitRow, SlotValue>({
    mutationFn: (next) => api.post<VisitRow>(`${VISITS_PATH}/${visit.id}/reschedule`, { version: visit.version, visit_date: next.date, slot_start: next.start }, { version: visit.version }),
    successMessage: (saved) => `Moved to ${formatDate(saved.visit_date)} ${formatSlotTime(saved.slot_start)}`,
    invalidate,
    entityLabel: "This visit",
    errorMessage: (error: ApiClientError) => (error.code === "SLOT_FULL" ? "That slot is full — pick another." : error.message),
    onSuccess: () => {
      setReschedule(false);
      setSlot(null);
    },
  });
  const cancel = useMutationWithToast<VisitRow, string>({
    mutationFn: (reason) => api.post<VisitRow>(`${VISITS_PATH}/${visit.id}/cancel`, { version: visit.version, reason }, { version: visit.version }),
    successMessage: "Visit cancelled; the seat is free again",
    invalidate,
    entityLabel: "This visit",
  });
  const markOutcome = useMutationWithToast<VisitRow, "COMPLETED" | "NO_SHOW">({
    mutationFn: (value) => api.post<VisitRow>(`${VISITS_PATH}/${visit.id}/${value === "COMPLETED" ? "complete" : "no-show"}`, { version: visit.version, notes: notes.trim() || null }, { version: visit.version }),
    successMessage: (_saved, value) => (value === "COMPLETED" ? "Marked completed · lead moved to Site Visit Done" : "Marked no-show"),
    invalidate,
    entityLabel: "This visit",
  });
  const update = useMutationWithToast<VisitRow, void>({
    mutationFn: () => api.patch<VisitRow>(`${VISITS_PATH}/${visit.id}`, { version: visit.version, notes: notes.trim() || null, assignee_user_id: assignee }, { version: visit.version }),
    successMessage: "Visit updated",
    invalidate,
    entityLabel: "This visit",
  });

  const open = visitIsOpen(visit);
  const dirty = notes !== (visit.notes ?? "") || assignee !== visit.assignee_user_id;

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle>{visit.name}</SheetTitle>
          <StatusChip status={visit.status} label={VISIT_STATUS_LABELS[visit.status]} />
          {visit.rescheduled_from && <Badge variant="warning">Moved</Badge>}
        </div>
        <SheetDescription>
          <span className="flex flex-wrap items-center gap-x-3">
            <span className="font-mono">{visit.visit_number}</span>
            <a href={`tel:${visit.phone}`} className="money inline-flex items-center gap-1 text-navy-700 hover:underline">
              <Phone className="size-3" aria-hidden="true" /> {formatPhone(visit.phone)}
            </a>
            <span>{VISIT_SOURCE_LABELS[visit.source]}</span>
          </span>
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-5">
        <div className="rounded-lg border border-border bg-surface/60 p-3">
          <p className="label-caps">When</p>
          <p className="money text-lg font-bold text-navy-950">
            {formatDate(visit.visit_date)} · {formatSlotTime(visit.slot_start)} – {formatSlotTime(visit.slot_end)}
          </p>
          <p className="text-xs text-ink-subtle">
            {visit.project_name} · {visit.visitors} {visit.visitors === 1 ? "visitor" : "visitors"}
            {visit.assignee_name ? ` · with ${visit.assignee_name}` : ""}
          </p>
          {visit.rescheduled_from && (
            <p className="mt-1 text-2xs text-warning-fg">
              Originally {formatDate(visit.rescheduled_from.visit_date)} {formatSlotTime(visit.rescheduled_from.slot_start)}
            </p>
          )}
        </div>
        {visit.status === "CANCELLED" && <Notice tone="danger">Cancelled{visit.cancel_reason ? `: ${visit.cancel_reason}` : ""}.</Notice>}
        {visit.is_past && open && <Notice tone="warning">This visit is in the past — mark its outcome.</Notice>}

        {canWrite && open && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" leftIcon={CheckCircle2} onClick={() => setOutcome("COMPLETED")} data-testid="visit-complete">
              Completed
            </Button>
            <Button size="sm" variant="outline" leftIcon={UserX} onClick={() => setOutcome("NO_SHOW")} data-testid="visit-no-show">
              No-show
            </Button>
            <Button size="sm" variant="outline" leftIcon={CalendarClock} onClick={() => setReschedule(true)} data-testid="visit-reschedule">
              Reschedule
            </Button>
            <Button size="sm" variant="danger-outline" leftIcon={XCircle} onClick={() => setCancelOpen(true)} data-testid="visit-cancel">
              Cancel
            </Button>
          </div>
        )}

        <KeyValueList
          columns={2}
          items={[
            { label: "Project", value: visit.project_name },
            { label: "E-mail", value: visit.email },
            { label: "Lead", value: visit.lead_id ? (
                <Link to={`/leads?lead=${visit.lead_id}`} className="inline-flex items-center gap-1 text-navy-700 hover:underline">
                  {visit.lead_number ?? "Open lead"} <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              ) : null },
            { label: "Customer", value: visit.customer_id ? (
                <Link to={`/customers/${visit.customer_id}`} className="inline-flex items-center gap-1 text-navy-700 hover:underline">
                  Customer 360 <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              ) : null },
            { label: "Visitor message", value: visit.message, full: true },
            { label: "Outcome marked", value: visit.outcome_marked_at ? formatDateTime(visit.outcome_marked_at) : null },
            { label: "Booked", value: formatDateTime(visit.created_at) },
          ]}
        />

        <div className="space-y-3 rounded-md border border-border p-3">
          <FieldWrapper label="Assignee">
            {(control) => <Combobox id={control.id} value={assignee} selectedLabel={visit.assignee_name ?? undefined} onValueChange={(value) => setAssignee(value)} options={(users.data ?? []).filter((user) => user.is_active).map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] }))} placeholder="Unassigned" allowClear disabled={!canWrite} />}
          </FieldWrapper>
          <FieldWrapper label="Notes">{(control) => <Textarea id={control.id} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={1000} disabled={!canWrite} data-testid="visit-notes" />}</FieldWrapper>
          {canWrite && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" leftIcon={Save} loading={update.isPending} disabled={!dirty} onClick={() => update.mutate()} data-testid="visit-save">
                Save
              </Button>
            </div>
          )}
        </div>
      </SheetBody>

      <SimpleDialog
        open={reschedule}
        onOpenChange={(next) => !doReschedule.isPending && setReschedule(next)}
        title="Reschedule visit"
        description="Only slots with free seats are shown; the current slot keeps this visit's seat."
        footer={
          <>
            <Button variant="outline" onClick={() => setReschedule(false)} disabled={doReschedule.isPending}>
              Cancel
            </Button>
            <Button loading={doReschedule.isPending} disabled={!slot} onClick={() => slot && doReschedule.mutate(slot)} data-testid="visit-reschedule-submit">
              Move visit
            </Button>
          </>
        }
      >
        <SlotPicker projectId={visit.project_id} value={slot} onChange={setSlot} excludeVisitId={visit.id} />
      </SimpleDialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this visit?"
        description="The seat is freed. If it was the lead's only upcoming visit, the lead returns to its previous stage."
        confirmLabel="Cancel visit"
        variant="destructive"
        requireReason
        onConfirm={async (reason) => {
          await cancel.mutateAsync(reason ?? "");
        }}
      />
      <ConfirmDialog
        open={outcome !== null}
        onOpenChange={(next) => !next && setOutcome(null)}
        title={outcome === "COMPLETED" ? "Mark visit completed?" : "Mark as no-show?"}
        description={outcome === "COMPLETED" ? "The linked lead moves to Site Visit Done." : "The seat stays used; the lead keeps its stage."}
        confirmLabel={outcome === "COMPLETED" ? "Completed" : "No-show"}
        onConfirm={async () => {
          if (outcome) await markOutcome.mutateAsync(outcome);
        }}
      />
    </>
  );
}
