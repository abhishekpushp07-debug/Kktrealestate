import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LeadCreateSchema, LeadUpdateSchema, type FlatTypeRow, type LeadRow } from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, Checkbox, Combobox, FormError, FormField, FormRow, FormSection, Input, MoneyInput, Select, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Textarea } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { formatDateTime, instantToIstInput, istInputToInstant } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { useSalesUserOptions } from "@/features/inventory/api";
import { controlOf } from "@/features/inventory/components";
import { useMasterRows } from "@/features/masters/api";
import { contractResolver } from "@/features/shared/contractResolver";
import { useProjectOptions } from "@/features/shared/options";
import { LEADS_PATH, crmKeys } from "./api";
import { normaliseIndianPhone } from "./verhoeff";

export interface LeadValues {
  full_name: string;
  phone: string;
  email: string;
  project_id: string | null;
  flat_type_id: string | null;
  budget_min_paise: number | null;
  budget_max_paise: number | null;
  source: string | null;
  assigned_user_id: string | null;
  message: string;
  /** datetime-local value (IST wall clock) */
  next_follow_up_local: string;
  consent: boolean;
}

/** datetime-local ("2026-10-25T15:30", IST wall clock) → RFC 3339 instant, or null. */
export function localToIso(value: string): string | null {
  return istInputToInstant(value);
}

/** RFC 3339 instant → datetime-local value on the IST wall clock (whatever the browser's zone). */
export function isoToLocal(value: string | null | undefined): string {
  return instantToIstInput(value);
}

const base = (values: LeadValues) => ({
  full_name: values.full_name,
  phone: normaliseIndianPhone(values.phone),
  email: values.email.trim() || null,
  project_id: values.project_id,
  flat_type_id: values.flat_type_id,
  budget_min_paise: values.budget_min_paise,
  budget_max_paise: values.budget_max_paise,
  assigned_user_id: values.assigned_user_id,
  message: values.message.trim() || null,
  next_follow_up_at: localToIso(values.next_follow_up_local),
  consent: values.consent,
});

const CreateSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as LeadValues;
    return { ...base(values), source: values.source };
  })
  .pipe(LeadCreateSchema);

const EditSchema = z
  .looseObject({})
  .transform((raw): unknown => base(raw as unknown as LeadValues))
  .pipe(LeadUpdateSchema.omit({ version: true }));

export function defaultLeadValues(seed: Partial<LeadValues> = {}): LeadValues {
  return { full_name: "", phone: "", email: "", project_id: null, flat_type_id: null, budget_min_paise: null, budget_max_paise: null, source: "WALK_IN", assigned_user_id: null, message: "", next_follow_up_local: "", consent: false, ...seed };
}

export function leadToValues(lead: LeadRow): LeadValues {
  return {
    full_name: lead.full_name,
    phone: lead.phone,
    email: lead.email ?? "",
    project_id: lead.project_id,
    flat_type_id: lead.flat_type_id,
    budget_min_paise: lead.budget_min_paise,
    budget_max_paise: lead.budget_max_paise,
    source: lead.source,
    assigned_user_id: lead.assigned_user_id,
    message: lead.message ?? "",
    next_follow_up_local: isoToLocal(lead.next_follow_up_at),
    consent: lead.consent,
  };
}

export interface LeadFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadRow | null;
  seed?: Partial<LeadValues>;
  onSaved?: (lead: LeadRow) => void;
}

/** Create / edit a lead (source is fixed after creation). */
export function LeadFormSheet({ open, onOpenChange, lead, seed, onSaved }: LeadFormSheetProps) {
  const mode = lead ? "edit" : "create";
  const schema = mode === "edit" ? EditSchema : CreateSchema;
  const resolver = useMemo(() => contractResolver<LeadValues, unknown>(schema), [schema]);
  const form = useForm<LeadValues, unknown, unknown>({ resolver, defaultValues: lead ? leadToValues(lead) : defaultLeadValues(seed), mode: "onTouched" });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);
  const projects = useProjectOptions(open);
  const flatTypes = useMasterRows<FlatTypeRow>("flat-types", { enabled: open });
  const users = useSalesUserOptions(open);

  const leadId = lead?.id ?? null;
  const leadVersion = lead?.version ?? null;
  useEffect(() => {
    if (!open) return;
    form.reset(lead ? leadToValues(lead) : defaultLeadValues(seed));
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId, leadVersion]);

  const handleError = (error: ApiClientError) => {
    if (error.isVersionConflict) return;
    if (!applyServerErrors(error, form.setError)) setServerError(error);
  };
  const create = useMutationWithToast<LeadRow, unknown>({
    mutationFn: (body) => api.post<LeadRow>(LEADS_PATH, body),
    successMessage: (saved) => `Lead ${saved.lead_number} created`,
    invalidate: [[LEADS_PATH]],
    errorMessage: false,
    onSuccess: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: handleError,
  });
  const update = useMutationWithToast<LeadRow, { row: LeadRow; body: unknown }>({
    mutationFn: ({ row, body }) => api.patch<LeadRow>(`${LEADS_PATH}/${row.id}`, { ...(body as Record<string, unknown>), version: row.version }, { version: row.version }),
    successMessage: "Lead saved",
    invalidate: [[LEADS_PATH], crmKeys.leadDetail(lead?.id ?? "")],
    entityLabel: "This lead",
    errorMessage: false,
    onSuccess: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: handleError,
  });
  const busy = create.isPending || update.isPending;

  const projectOptions = useMemo(() => (projects.data ?? []).map((project) => ({ value: project.id, label: project.name, description: project.code ?? undefined })), [projects.data]);
  const userOptions = useMemo(() => (users.data ?? []).filter((user) => user.is_active).map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] })), [users.data]);

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent size="md" data-testid="lead-form-sheet">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{mode === "create" ? "New lead" : `Edit ${lead?.lead_number ?? "lead"}`}</SheetTitle>
            {lead && (
              <Badge variant="outline" numeric>
                v{lead.version}
              </Badge>
            )}
          </div>
          <SheetDescription>{lead ? `Updated ${formatDateTime(lead.updated_at)}` : "Website and brochure leads arrive automatically; use this for walk-ins, calls and referrals."}</SheetDescription>
        </SheetHeader>
        <form
          noValidate
          onSubmit={form.handleSubmit((output) => {
            setServerError(null);
            if (lead) update.mutate({ row: lead, body: output });
            else create.mutate(output);
          })}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetBody className="space-y-6">
            {serverError !== null && <FormError error={serverError} />}
            <FormSection title="Contact">
              <FormRow columns={2}>
                <FormField control={control} name="full_name" label="Name" required className="sm:col-span-2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} autoComplete="off" data-testid="lead-name" />} />
                <FormField control={control} name="phone" label="Mobile" required hint="10-digit Indian mobile" render={({ field }) => <Input {...field} type="tel" value={field.value} onChange={(event) => field.onChange(event.target.value)} inputMode="tel" maxLength={16} className="money" autoComplete="off" data-testid="lead-phone" />} />
                <FormField control={control} name="email" label="E-mail" render={({ field }) => <Input {...field} type="email" value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={254} autoComplete="off" />} />
              </FormRow>
            </FormSection>
            <FormSection title="Interest">
              <FormRow columns={2}>
                <FormField control={control} name="project_id" label="Project" render={({ field }) => <Combobox id={field.id} value={field.value} onValueChange={(value) => field.onChange(value)} options={projectOptions} placeholder={projects.isPending ? "Loading…" : "Any project"} allowClear data-testid="lead-project" />} />
                <FormField control={control} name="flat_type_id" label="Flat type" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={(flatTypes.data ?? []).map((type) => ({ value: type.id, label: `${type.code} · ${type.name}` }))} placeholder={flatTypes.isPending ? "Loading…" : "Any"} allowClear />} />
                <FormField control={control} name="budget_min_paise" label="Budget from" render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />} />
                <FormField control={control} name="budget_max_paise" label="Budget to" render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />} />
                <FormField control={control} name="source" label="Source" required hint={mode === "edit" ? "Fixed after creation" : undefined} render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={LEAD_SOURCES.map((value) => ({ value, label: LEAD_SOURCE_LABELS[value] }))} disabled={mode === "edit"} invalid={field.invalid} data-testid="lead-source" />} />
                <FormField control={control} name="assigned_user_id" label="Assigned to" render={({ field }) => <Combobox id={field.id} value={field.value} onValueChange={(value) => field.onChange(value)} options={userOptions} placeholder={users.isPending ? "Loading…" : "Unassigned (round-robin)"} allowClear data-testid="lead-assignee" />} />
                <FormField control={control} name="next_follow_up_local" label="Next follow-up" className="sm:col-span-2" render={({ field }) => <Input {...field} type="datetime-local" value={field.value} onChange={(event) => field.onChange(event.target.value)} className="money" />} />
                <FormField control={control} name="message" label="Notes / message" className="sm:col-span-2" render={({ field }) => <Textarea {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} rows={3} maxLength={2000} />} />
                <FormField control={control} name="consent" className="sm:col-span-2" render={({ field }) => <Checkbox id={field.id} checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} label="Consent to be contacted" description="Required for marketing follow-ups" />} />
              </FormRow>
            </FormSection>
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} data-testid="lead-form-submit">
              {mode === "create" ? "Create lead" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
