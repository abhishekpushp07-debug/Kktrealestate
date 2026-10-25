import { ArrowLeft, ArrowRight, Check, History, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BookingCreateSchema, FLAT_STATUS_LABELS, type BookingCreate, type BookingDraftRow, type BookingRow, type FlatStatus } from "@kkt/contracts";
import { Button, ConfirmDialog, PageHeader, Stepper, type Step } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { BREAKPOINTS, cn, useMediaQuery } from "@/lib/utils";
import { useFlatDetail } from "@/features/inventory/api";
import { Notice } from "@/features/inventory/components";
import { BOOKINGS_PATH, bookingKeys, useApplicablePlans, useMyDrafts } from "../api";
import { emptyWizardState, firstIncompleteStep, fromDraftPayload, toBookingCreatePayload, validateStep, WIZARD_STEPS, wizardHasContent, type StepErrors, type WizardState, type WizardStepId } from "../bookingMath";
import { StepAgreement } from "./StepAgreement";
import { StepCharges } from "./StepCharges";
import { StepCustomer } from "./StepCustomer";
import { StepFlat } from "./StepFlat";
import { StepPlan } from "./StepPlan";
import { StepReview } from "./StepReview";
import { SummaryRail } from "./SummaryRail";
import { clearLocalDraft, readLocalDraft, useBookingDraft, type LocalDraft } from "./useBookingDraft";
import type { StepProps } from "./types";

const STEP_META: Readonly<Record<WizardStepId, { label: string; description: string }>> = {
  flat: { label: "Flat", description: "Project, tower, unit" },
  customer: { label: "Customer", description: "Applicant & co-applicants" },
  agreement: { label: "Agreement", description: "Value and Cash / Account split" },
  plan: { label: "Payment plan", description: "Schedule & acceptance" },
  charges: { label: "Charges & parking", description: "Other charges, slots" },
  review: { label: "Review", description: "Confirm the booking" },
};

interface ResumeCandidate {
  source: "server" | "local";
  id: string | null;
  step: number;
  payload: Record<string, unknown>;
  updated_at: string;
  label: string;
}

function candidateFromServer(row: BookingDraftRow): ResumeCandidate {
  const parts = [row.project_name, row.flat_number ? `Flat ${row.flat_number}` : null, row.customer_name].filter(Boolean);
  return { source: "server", id: row.id, step: row.step, payload: row.payload, updated_at: row.updated_at, label: parts.length ? parts.join(" · ") : "Unnamed draft" };
}

function candidateFromLocal(draft: LocalDraft): ResumeCandidate {
  return { source: "local", id: draft.id, step: draft.step, payload: draft.payload, updated_at: draft.updated_at, label: "Draft saved on this device" };
}

/** `/bookings/new` — the six-step booking wizard with autosave, resume, summary rail and atomic confirm. */
export default function BookingWizard() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayIST();
  const isCompact = useMediaQuery(BREAKPOINTS.compact);

  const [state, setState] = useState<WizardState>(() => {
    const initial = emptyWizardState(today);
    const customerId = params.get("customer_id");
    const projectId = params.get("project_id");
    const flatId = params.get("flat_id");
    return { ...initial, customer_id: customerId, project_id: projectId, flat_id: flatId };
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [attempted, setAttempted] = useState<Set<number>>(() => new Set());
  const [draftId, setDraftId] = useState<string | null>(params.get("draft"));
  const [resumed, setResumed] = useState(Boolean(params.get("draft")));
  const [dismissedResume, setDismissedResume] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<string[]>([]);

  const update = useCallback((patch: Partial<WizardState>) => setState((previous) => ({ ...previous, ...patch })), []);

  // Prefilled flat → derive project / tower.
  const prefillFlat = useFlatDetail(params.get("flat_id"));
  useEffect(() => {
    if (!prefillFlat.data) return;
    setState((previous) => (previous.flat_id === prefillFlat.data.id && (!previous.project_id || !previous.block_id) ? { ...previous, project_id: prefillFlat.data.project_id, block_id: prefillFlat.data.block_id } : previous));
  }, [prefillFlat.data]);

  // Resume candidates.
  const drafts = useMyDrafts(!resumed);
  const resumeCandidate = useMemo<ResumeCandidate | null>(() => {
    if (resumed || dismissedResume) return null;
    const server = drafts.data?.[0];
    if (server) return candidateFromServer(server);
    if (drafts.isPending && !drafts.isError) return null;
    const local = readLocalDraft();
    return local ? candidateFromLocal(local) : null;
  }, [drafts.data, drafts.isPending, drafts.isError, resumed, dismissedResume]);

  // Explicit ?draft=<id> deep link.
  useEffect(() => {
    const wanted = params.get("draft");
    if (!wanted || !drafts.data) return;
    const row = drafts.data.find((draft) => draft.id === wanted);
    if (row) resume(candidateFromServer(row));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.data]);

  const resume = (candidate: ResumeCandidate) => {
    const restored = fromDraftPayload(candidate.payload, today);
    setState(restored);
    setDraftId(candidate.id);
    setStepIndex(Math.min(Math.max(candidate.step - 1, 0), WIZARD_STEPS.length - 1));
    setResumed(true);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (candidate.id) next.set("draft", candidate.id);
        else next.delete("draft");
        next.delete("customer_id");
        next.delete("project_id");
        next.delete("flat_id");
        return next;
      },
      { replace: true },
    );
  };

  // Validation context.
  const flat = useFlatDetail(state.flat_id);
  const plans = useApplicablePlans(state.project_id, state.block_id, state.booking_date);
  const flatStatus: FlatStatus | null = flat.data?.status ?? null;
  const context = useMemo(() => ({ today, flatStatus, plansAvailable: plans.data ? plans.data.length > 0 : null }), [today, flatStatus, plans.data]);
  const stepErrors = useMemo<StepErrors[]>(() => WIZARD_STEPS.map((step) => validateStep(step, state, context)), [state, context]);
  const currentStep = WIZARD_STEPS[stepIndex] ?? "flat";
  const currentErrors = stepErrors[stepIndex] ?? {};
  const completed = useMemo(() => WIZARD_STEPS.map((_, index) => index).filter((index) => index < stepIndex && Object.keys(stepErrors[index] ?? {}).length === 0), [stepIndex, stepErrors]);

  // Autosave.
  const draft = useBookingDraft({ state, step: stepIndex + 1, draftId, onDraftId: setDraftId, enabled: !submitted });

  // Unsaved-changes guard.
  const dirty = wizardHasContent(state) && !submitted;
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const steps = useMemo<Step[]>(() => WIZARD_STEPS.map((step, index) => ({ id: step, label: STEP_META[step].label, description: isCompact ? undefined : STEP_META[step].description, error: attempted.has(index) && Object.keys(stepErrors[index] ?? {}).length > 0 })), [attempted, stepErrors, isCompact]);

  const goTo = (index: number) => {
    setStepIndex(Math.min(Math.max(index, 0), WIZARD_STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const next = () => {
    setAttempted((previous) => new Set(previous).add(stepIndex));
    if (Object.keys(currentErrors).length > 0) return;
    goTo(stepIndex + 1);
  };

  const create = useMutationWithToast<BookingRow, BookingCreate>({
    mutationFn: (body) => api.post<BookingRow>(BOOKINGS_PATH, body),
    successMessage: (booking) => `Booking ${booking.booking_number} confirmed — flat ${booking.flat_number} is now Booked`,
    errorMessage: false,
    invalidate: [[BOOKINGS_PATH], ["/flats"], ["/blocks"], ["/projects"], ["/customers"], bookingKeys.drafts],
    onSuccess: async (booking) => {
      setSubmitted(true);
      await draft.discard();
      clearLocalDraft();
      navigate(`/bookings/${booking.id}`, { replace: true });
    },
    onError: (error) => {
      if (error.status === 409 && error.code === "FLAT_NOT_AVAILABLE") {
        const status = typeof error.details?.current_status === "string" ? (error.details.current_status as FlatStatus) : null;
        toast.error(`That flat is no longer available${status ? ` — it is now ${FLAT_STATUS_LABELS[status] ?? status}` : ""}. Pick another flat.`);
        update({ flat_id: null, agreement_value_paise: null, cash_agreed_paise: null, account_agreed_paise: null });
        goTo(0);
        return;
      }
      if (error.status === 409 && error.code === "PLAN_NOT_APPLICABLE") {
        toast.error(error.message || "The chosen payment plan is not applicable to this tower any more.");
        update({ payment_plan_id: null });
        goTo(3);
        return;
      }
      if (error.code === "VALIDATION_ERROR" && error.validationIssues.length > 0) {
        setServerIssues(error.validationIssues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)));
        return;
      }
      if (error.isVersionConflict) return;
      toast.error(error.message || "The booking could not be created.");
    },
  });

  const confirm = () => {
    setAttempted(new Set(WIZARD_STEPS.map((_, index) => index)));
    setServerIssues([]);
    const incomplete = firstIncompleteStep(state, context);
    if (incomplete < WIZARD_STEPS.length - 1) {
      goTo(incomplete);
      toast.error(`Complete the “${STEP_META[WIZARD_STEPS[incomplete] ?? "flat"].label}” step first.`);
      return;
    }
    const payload = toBookingCreatePayload(state);
    const parsed = BookingCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setServerIssues(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
      return;
    }
    create.mutate(parsed.data);
  };

  const cancel = async (discard: boolean) => {
    if (discard) await draft.discard();
    else await draft.flush();
    setSubmitted(true);
    navigate("/bookings");
  };

  const stepProps: StepProps = {
    state,
    update,
    errors: currentErrors,
    showErrors: attempted.has(stepIndex),
    can: { editAgreement: can("agreement.edit"), writeCustomer: can("customer.write"), uploadDocument: can("document.write") },
  };

  const stepElement = (() => {
    switch (currentStep) {
      case "flat":
        return <StepFlat {...stepProps} />;
      case "customer":
        return <StepCustomer {...stepProps} />;
      case "agreement":
        return <StepAgreement {...stepProps} />;
      case "plan":
        return <StepPlan {...stepProps} />;
      case "charges":
        return <StepCharges {...stepProps} />;
      case "review":
        return <StepReview {...stepProps} />;
    }
  })();

  const isLast = stepIndex === WIZARD_STEPS.length - 1;
  const footerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="pb-28 lg:pb-20" data-testid="booking-wizard">
      <PageHeader
        title="New booking"
        description="Six steps: flat, customer, agreement, plan, charges, review. Your progress is saved automatically."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Sales" }, { label: "Bookings", to: "/bookings" }, { label: "New booking" }]}
        backTo="/bookings"
        actions={
          <Button variant="ghost" leftIcon={X} onClick={() => (dirty ? setCancelOpen(true) : navigate("/bookings"))} data-testid="wizard-cancel">
            Cancel
          </Button>
        }
      />

      {resumeCandidate && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gold-border bg-gold-light px-4 py-3 text-sm" data-testid="resume-banner">
          <History className="size-4 shrink-0 text-gold-text" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-navy-950">Resume booking?</p>
            <p className="truncate text-xs text-ink-muted">
              {resumeCandidate.label} · step {resumeCandidate.step} · saved {formatRelative(resumeCandidate.updated_at)}
              {resumeCandidate.source === "local" ? " (this device)" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => resume(resumeCandidate)} data-testid="resume-draft">
              Resume
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={Trash2}
              onClick={async () => {
                setDismissedResume(true);
                clearLocalDraft();
                if (resumeCandidate.id) {
                  try {
                    await api.delete(`/booking-drafts/${resumeCandidate.id}`);
                  } catch {
                    /* ignore */
                  }
                  void drafts.refetch();
                }
              }}
              data-testid="discard-draft"
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className={cn("grid gap-4", isCompact ? "grid-cols-1" : "grid-cols-[13rem_minmax(0,1fr)_18rem] xl:grid-cols-[14rem_minmax(0,1fr)_20rem]")}>
        <Stepper steps={steps} current={stepIndex} completed={completed} onStepClick={goTo} orientation={isCompact ? "horizontal" : "vertical"} className={cn(!isCompact && "sticky top-20 h-fit rounded-lg border border-border bg-card p-4 shadow-card")} />
        <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-card sm:p-6" aria-labelledby="wizard-step-title">
          <header className="mb-4">
            <p className="label-caps">
              Step {stepIndex + 1} of {WIZARD_STEPS.length}
            </p>
            <h2 id="wizard-step-title" className="font-display text-lg font-bold text-navy-950">
              {STEP_META[currentStep].label}
            </h2>
            <p className="text-xs text-ink-subtle">{STEP_META[currentStep].description}</p>
          </header>
          {serverIssues.length > 0 && (
            <Notice tone="danger" className="mb-4">
              <p className="font-semibold">The server rejected the booking:</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {serverIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Notice>
          )}
          {stepElement}
        </section>
        <SummaryRail state={state} draftStatus={draft.status} lastSavedAt={draft.lastSavedAt} />
      </div>

      <div ref={footerRef} className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-2.5 shadow-pop backdrop-blur lg:left-[var(--spacing-sidebar)] [[data-collapsed]_~_*_&]:lg:left-[var(--spacing-sidebar-collapsed)]" data-testid="wizard-footer">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-2">
          <Button variant="outline" leftIcon={ArrowLeft} disabled={stepIndex === 0 || create.isPending} onClick={() => goTo(stepIndex - 1)} data-testid="wizard-back">
            Back
          </Button>
          <span className="hidden text-xs text-ink-subtle sm:inline">
            {Object.keys(currentErrors).length > 0 && attempted.has(stepIndex) ? `${Object.keys(currentErrors).length} thing${Object.keys(currentErrors).length === 1 ? "" : "s"} to fix on this step` : "All good on this step"}
          </span>
          {isLast ? (
            <Button leftIcon={Check} variant="gold" loading={create.isPending} onClick={confirm} data-testid="wizard-confirm">
              Confirm booking
            </Button>
          ) : (
            <Button rightIcon={ArrowRight} onClick={next} data-testid="wizard-next">
              Next
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Leave this booking?"
        description="Your progress is saved as a draft and can be resumed from New booking. Discard it instead if you no longer need it."
        confirmLabel="Keep draft & leave"
        cancelLabel="Stay"
        onConfirm={() => cancel(false)}
      >
        <Button variant="danger-outline" size="sm" leftIcon={Trash2} onClick={() => void cancel(true)} data-testid="wizard-discard-leave">
          Discard draft and leave
        </Button>
      </ConfirmDialog>
    </div>
  );
}
