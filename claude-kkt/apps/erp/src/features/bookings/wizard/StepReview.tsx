import { Printer } from "lucide-react";
import { useMemo } from "react";
import { CHARGE_DEMAND_AT_LABELS, PLAN_ACCEPTANCE_MODE_LABELS, type SchedulePreviewRequest } from "@kkt/contracts";
import { Button, FieldWrapper, FormRow, Input, KeyValueList, Select, Skeleton, Textarea } from "@/components/ui";
import { formatDate, formatINR, formatPercent, formatPhone, formatSqft } from "@/lib/format";
import { useFlatDetail, useSalesUserOptions } from "@/features/inventory/api";
import { Notice } from "@/features/inventory/components";
import { useApplicablePlans, useAvailableParking, useChargeTypes, useCustomerById, useSchedulePreview } from "../api";
import { chargeLineTotals, otherChargesTotal, splitPercents } from "../bookingMath";
import { SchedulePreviewTable } from "./SchedulePreviewTable";
import type { StepProps } from "./types";

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .kkt-booking-review, .kkt-booking-review * { visibility: visible !important; }
  .kkt-booking-review { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; }
  .kkt-booking-review .kkt-no-print { display: none !important; }
  @page { size: A4; margin: 14mm; }
}`;

/** Step 6 — printable summary of everything chosen, plus sales/broker/remarks. */
export function StepReview({ state, update, errors, showErrors }: StepProps) {
  const flat = useFlatDetail(state.flat_id);
  const customer = useCustomerById(state.customer_id);
  const plans = useApplicablePlans(state.project_id, state.block_id, state.booking_date);
  const chargeTypes = useChargeTypes();
  const parking = useAvailableParking(state.project_id);
  const salesUsers = useSalesUserOptions();
  const plan = plans.data?.find((row) => row.plan_id === state.payment_plan_id) ?? null;
  const previewRequest = useMemo<SchedulePreviewRequest | null>(
    () =>
      state.payment_plan_id && state.block_id && state.cash_agreed_paise !== null && state.account_agreed_paise !== null
        ? {
            plan_id: state.payment_plan_id,
            block_id: state.block_id,
            booking_date: state.booking_date,
            cash_agreed_paise: state.cash_agreed_paise,
            account_agreed_paise: state.account_agreed_paise,
          }
        : null,
    [state.payment_plan_id, state.block_id, state.booking_date, state.cash_agreed_paise, state.account_agreed_paise],
  );
  const preview = useSchedulePreview(previewRequest);
  const total = state.agreement_value_paise ?? 0;
  const percents = splitPercents(total, {
    cash_paise: state.cash_agreed_paise ?? 0,
    account_paise: state.account_agreed_paise ?? 0,
  });
  const charges = otherChargesTotal(state.other_charges);
  const slots = (parking.data ?? []).filter((slot) => state.parking_slot_ids.includes(slot.id));
  const typeById = new Map((chargeTypes.data ?? []).map((type) => [type.id, type] as const));
  const blockingErrors = Object.entries(errors).filter(([key]) => !["broker_name", "remarks"].includes(key));

  return (
    <div className="kkt-booking-review space-y-5">
      <style>{PRINT_CSS}</style>
      {showErrors && blockingErrors.length > 0 && (
        <Notice tone="danger" className="kkt-no-print">
          <p className="font-semibold">Some steps are incomplete:</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {blockingErrors.map(([key, message]) => (
              <li key={key}>{message}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="kkt-no-print flex items-center justify-between gap-2">
        <h3 className="font-display text-md font-bold text-navy-950">Review &amp; confirm</h3>
        <Button
          size="sm"
          variant="outline"
          leftIcon={Printer}
          onClick={() => window.print()}
          data-testid="wizard-print-summary"
        >
          Print summary
        </Button>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="label-caps mb-2">Flat</h4>
          {flat.isPending ? (
            <Skeleton className="h-16" />
          ) : flat.data ? (
            <KeyValueList
              layout="inline"
              items={[
                { label: "Project · Tower", value: `${flat.data.block_name}` },
                { label: "Flat", value: <span className="money font-semibold">{flat.data.flat_number}</span> },
                { label: "Type · Floor", value: `${flat.data.flat_type_name} · ${flat.data.floor_label}` },
                { label: "Super built-up", value: formatSqft(flat.data.super_builtup_sqft) },
                { label: "List price", value: formatINR(flat.data.price_paise), numeric: true },
                { label: "Booking date", value: formatDate(state.booking_date) },
              ]}
            />
          ) : (
            <p className="text-xs text-danger-fg">No flat selected.</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="label-caps mb-2">Applicants</h4>
          {customer.isPending && state.customer_id ? (
            <Skeleton className="h-16" />
          ) : customer.data ? (
            <KeyValueList
              layout="inline"
              items={[
                {
                  label: "Primary",
                  value: (
                    <span>
                      {customer.data.full_name}{" "}
                      <span className="money text-2xs text-ink-subtle">{customer.data.customer_code}</span>
                    </span>
                  ),
                },
                { label: "Phone", value: <span className="money">{formatPhone(customer.data.phone)}</span> },
                { label: "KYC", value: customer.data.kyc_status },
                {
                  label: "Co-applicants",
                  value: state.co_applicant_ids.length ? `${state.co_applicant_ids.length} added` : "None",
                },
              ]}
            />
          ) : (
            <p className="text-xs text-danger-fg">No customer selected.</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="label-caps mb-2">Agreement</h4>
          <KeyValueList
            layout="inline"
            items={[
              {
                label: "Agreement value",
                value: <span className="font-bold text-navy-950">{formatINR(state.agreement_value_paise)}</span>,
                numeric: true,
              },
              {
                label: `Cash bucket (${formatPercent(percents.cash)})`,
                value: formatINR(state.cash_agreed_paise),
                numeric: true,
              },
              {
                label: `Account bucket (${formatPercent(percents.account)})`,
                value: formatINR(state.account_agreed_paise),
                numeric: true,
              },
            ]}
          />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="label-caps mb-2">Payment plan</h4>
          <KeyValueList
            layout="inline"
            items={[
              { label: "Plan", value: plan ? `${plan.name} (${plan.code})` : "—" },
              { label: "Installments", value: plan ? String(plan.installments.length) : "—", numeric: true },
              { label: "Accepted via", value: PLAN_ACCEPTANCE_MODE_LABELS[state.plan_acceptance_mode] },
              { label: "Accepted on", value: formatDate(state.plan_accepted_on) },
              ...(state.plan_acceptance_mode === "SIGNED_COPY"
                ? [{ label: "Signed copy", value: state.plan_acceptance_document_id ? "Uploaded" : "Missing" }]
                : []),
            ]}
          />
        </div>
      </section>

      {preview.data && (
        <section className="space-y-2">
          <h4 className="label-caps">Schedule</h4>
          <SchedulePreviewTable preview={preview.data} />
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="label-caps mb-2">Other charges</h4>
          {state.other_charges.length === 0 ? (
            <p className="text-xs text-ink-subtle">None.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {state.other_charges.map((line) => {
                  const type = typeById.get(line.charge_type_id);
                  const totals = chargeLineTotals(line.amount_paise, line.gst_percent);
                  return (
                    <tr key={line.charge_type_id} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{type?.name ?? "Charge"}</span>
                        <span className="block text-2xs text-ink-subtle">
                          {CHARGE_DEMAND_AT_LABELS[line.demand_at]}
                          {line.gst_percent ? ` · GST ${formatPercent(line.gst_percent)}` : ""}
                        </span>
                      </td>
                      <td className="money py-1.5 text-right font-medium">{formatINR(totals.total_paise)}</td>
                    </tr>
                  );
                })}
                <tr className="font-semibold text-navy-950">
                  <td className="py-1.5 pr-2">Total incl. GST</td>
                  <td className="money py-1.5 text-right">{formatINR(charges.total_paise)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="label-caps mb-2">Parking</h4>
          {slots.length === 0 ? (
            <p className="text-xs text-ink-subtle">
              {state.parking_slot_ids.length ? `${state.parking_slot_ids.length} slot(s) selected` : "None."}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {slots.map((slot) => (
                <li key={slot.id} className="money rounded-md border border-border bg-surface px-2 py-1">
                  {slot.number} <span className="text-2xs text-ink-subtle">{formatINR(slot.price_paise)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="kkt-no-print space-y-3 rounded-lg border border-border bg-card p-4">
        <h4 className="label-caps">Sales details</h4>
        <FormRow columns={2}>
          <FieldWrapper label="Sales person">
            {(control) => (
              <Select
                id={control.id}
                value={state.sales_user_id}
                onValueChange={(value) => update({ sales_user_id: value })}
                options={(salesUsers.data ?? []).map((user) => ({ value: user.id, label: user.name }))}
                placeholder="Assign later"
                allowClear
              />
            )}
          </FieldWrapper>
          <FieldWrapper label="Broker / channel partner" error={showErrors ? errors.broker_name : undefined}>
            {(control) => (
              <Input
                id={control.id}
                value={state.broker_name}
                onChange={(event) => update({ broker_name: event.target.value })}
                maxLength={120}
                placeholder="Optional"
              />
            )}
          </FieldWrapper>
        </FormRow>
        <FieldWrapper label="Remarks" error={showErrors ? errors.remarks : undefined}>
          {(control) => (
            <Textarea
              id={control.id}
              value={state.remarks}
              onChange={(event) => update({ remarks: event.target.value })}
              rows={3}
              maxLength={2000}
              placeholder="Special terms, negotiated items, notes for Accounts…"
            />
          )}
        </FieldWrapper>
      </section>

      <Notice tone="info" className="kkt-no-print">
        On confirm the flat is locked atomically (Available or your Hold → Booked), parking is allotted, the flat and
        plan are snapshotted, ON_BOOKING and already-triggered installments are demanded, and “on booking” charges are
        raised.
      </Notice>
    </div>
  );
}
