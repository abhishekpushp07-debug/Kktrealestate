import { FileCheck2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PLAN_ACCEPTANCE_MODES, PLAN_ACCEPTANCE_MODE_LABELS, PLAN_TYPE_LABELS, TRIGGER_TYPE_LABELS, type ApplicablePlanRow, type PlanAcceptanceMode, type SchedulePreviewRequest } from "@kkt/contracts";
import { Badge, Button, DateInput, EmptyState, ErrorState, FieldWrapper, FormRow, RadioGroup, Skeleton } from "@/components/ui";
import { formatPercent, todayIST } from "@/lib/format";
import { UploadDocumentDialog } from "@/features/inventory/DocumentsPanel";
import { Notice } from "@/features/inventory/components";
import { useApplicablePlans, useSchedulePreview } from "../api";
import { SchedulePreviewTable } from "./SchedulePreviewTable";
import type { StepProps } from "./types";

function planDescription(plan: ApplicablePlanRow): string {
  const first = plan.installments[0];
  return `${PLAN_TYPE_LABELS[plan.plan_type]} · ${plan.installments.length} installments${first ? ` · ${formatPercent(first.percent)} ${TRIGGER_TYPE_LABELS[first.trigger_type].toLowerCase()}` : ""}${plan.grace_days ? ` · ${plan.grace_days} grace days` : ""}`;
}

/** Step 4 — applicable plans for the tower (default first), live schedule preview, acceptance mode and date. */
export function StepPlan({ state, update, errors, showErrors, can }: StepProps) {
  const plans = useApplicablePlans(state.project_id, state.block_id, state.booking_date);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const today = todayIST();
  const error = (key: string) => (showErrors ? errors[key] : undefined);

  // Default plan picks itself; a plan that is no longer applicable is dropped.
  useEffect(() => {
    if (!plans.data) return;
    if (state.payment_plan_id && plans.data.some((plan) => plan.plan_id === state.payment_plan_id)) return;
    const next = plans.data[0];
    update({ payment_plan_id: next ? next.plan_id : null });
  }, [plans.data, state.payment_plan_id, update]);

  const previewRequest = useMemo<SchedulePreviewRequest | null>(() => {
    if (!state.payment_plan_id || !state.block_id || !state.booking_date || state.cash_agreed_paise === null || state.account_agreed_paise === null) return null;
    return { plan_id: state.payment_plan_id, block_id: state.block_id, booking_date: state.booking_date, cash_agreed_paise: state.cash_agreed_paise, account_agreed_paise: state.account_agreed_paise };
  }, [state.payment_plan_id, state.block_id, state.booking_date, state.cash_agreed_paise, state.account_agreed_paise]);
  const preview = useSchedulePreview(previewRequest);
  const selectedPlan = plans.data?.find((plan) => plan.plan_id === state.payment_plan_id) ?? null;

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="font-display text-md font-bold text-navy-950">Payment plan</h3>
        {plans.isPending && <Skeleton className="h-24" />}
        {plans.isError && <ErrorState compact error={plans.error} onRetry={() => void plans.refetch()} />}
        {plans.data && plans.data.length === 0 && (
          <EmptyState compact icon={FileCheck2} title="No plan assigned to this tower" description="Assign a payment plan to the project or tower under Master data → Payment plans, then come back." />
        )}
        {plans.data && plans.data.length > 0 && (
          <RadioGroup<string>
            cards
            value={state.payment_plan_id}
            onValueChange={(value) => update({ payment_plan_id: value })}
            aria-label="Payment plan"
            options={plans.data.map((plan) => ({
              value: plan.plan_id,
              label: (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {plan.name} <span className="money text-2xs text-ink-subtle">{plan.code}</span>
                  {plan.is_default && <Badge variant="gold">Default</Badge>}
                </span>
              ),
              description: planDescription(plan),
            }))}
            data-testid="wizard-plan"
          />
        )}
        {error("payment_plan_id") && <Notice tone="danger">{error("payment_plan_id")}</Notice>}
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-md font-bold text-navy-950">
          Schedule preview {selectedPlan && <span className="text-xs font-normal text-ink-subtle">· {selectedPlan.name}</span>}
        </h3>
        {!previewRequest && <p className="text-xs text-ink-subtle">Complete the agreement split to see per-installment amounts.</p>}
        {previewRequest && preview.isPending && <Skeleton className="h-40" />}
        {previewRequest && preview.isError && <ErrorState compact error={preview.error} onRetry={() => void preview.refetch()} />}
        {preview.data && <SchedulePreviewTable preview={preview.data} loading={preview.isFetching} />}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-md font-bold text-navy-950">Plan acceptance</h3>
        <FormRow columns={2}>
          <FieldWrapper label="Accepted via" required>
            {() => (
              <RadioGroup<PlanAcceptanceMode>
                value={state.plan_acceptance_mode}
                onValueChange={(value) => update({ plan_acceptance_mode: value, plan_acceptance_document_id: value === "SIGNED_COPY" ? state.plan_acceptance_document_id : null })}
                options={PLAN_ACCEPTANCE_MODES.map((mode) => ({ value: mode, label: PLAN_ACCEPTANCE_MODE_LABELS[mode], description: mode === "SIGNED_COPY" ? "Upload the signed schedule" : mode === "PORTAL" ? "Customer accepted on the portal" : "Explained and accepted at the office" }))}
                data-testid="wizard-acceptance-mode"
              />
            )}
          </FieldWrapper>
          <div className="space-y-3">
            <FieldWrapper label="Acceptance date" required error={error("plan_accepted_on")} hint={`On or after the booking date, not after today`}>
              {(control) => <DateInput id={control.id} value={state.plan_accepted_on} invalid={control.invalid} min={state.booking_date} max={today} onChange={(value) => update({ plan_accepted_on: value ?? today })} data-testid="wizard-acceptance-date" />}
            </FieldWrapper>
            {state.plan_acceptance_mode === "SIGNED_COPY" && (
              <FieldWrapper label="Signed copy" required error={error("plan_acceptance_document_id")} hint={!state.customer_id ? "Pick the customer (step 2) first — the copy is filed under them." : "PDF or image up to 15 MB, filed under the customer's documents"}>
                {() => (
                  <div className="flex flex-wrap items-center gap-2">
                    {state.plan_acceptance_document_id ? (
                      <Badge variant="success">
                        <FileCheck2 className="size-3" aria-hidden="true" /> {documentName ?? "Uploaded"}
                      </Badge>
                    ) : null}
                    <Button size="sm" variant="outline" leftIcon={Upload} disabled={!state.customer_id || !can.uploadDocument} onClick={() => setUploadOpen(true)} data-testid="wizard-upload-signed-copy">
                      {state.plan_acceptance_document_id ? "Replace" : "Upload signed copy"}
                    </Button>
                    {!can.uploadDocument && <span className="text-xs text-ink-subtle">Needs the document-upload permission.</span>}
                  </div>
                )}
              </FieldWrapper>
            )}
          </div>
        </FormRow>
      </section>

      {state.customer_id && (
        <UploadDocumentDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          entityType="CUSTOMER"
          entityId={state.customer_id}
          appliesTo="BOOKING"
          allowShare={false}
          title="Upload signed payment plan"
          onUploaded={(document) => {
            update({ plan_acceptance_document_id: document.id });
            setDocumentName(document.title || document.file_name);
          }}
        />
      )}
    </div>
  );
}
