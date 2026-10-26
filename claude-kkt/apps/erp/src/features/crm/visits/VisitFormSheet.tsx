import { useMemo, useState } from "react";
import type { CustomerRow, LeadRow, VisitRow } from "@kkt/contracts";
import {
  Button,
  Combobox,
  FieldWrapper,
  FormError,
  Input,
  NumberInput,
  RadioGroup,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { useMutationWithToast, useItem } from "@/lib/queries";
import { useSalesUserOptions } from "@/features/inventory/api";
import { useProjectOptions } from "@/features/shared/options";
import { CUSTOMERS_PATH, LEADS_PATH, VISITS_PATH, crmKeys, searchCustomers, searchLeads } from "../api";
import { normaliseIndianPhone, PHONE_REGEX } from "../verhoeff";
import { SlotPicker, type SlotValue } from "./SlotPicker";
import { useOnChange } from "@/lib/utils";

export interface VisitFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselected project / lead / customer (deep links from the lead drawer). */
  projectId?: string | null;
  leadId?: string | null;
  customerId?: string | null;
  onSaved?: (visit: VisitRow) => void;
}

type LinkKind = "lead" | "customer";

/** Create a site visit for a lead or a customer with a capacity-checked slot. */
export function VisitFormSheet({
  open,
  onOpenChange,
  projectId: initialProject = null,
  leadId: initialLead = null,
  customerId: initialCustomer = null,
  onSaved,
}: VisitFormSheetProps) {
  const [project, setProject] = useState<string | null>(initialProject);
  const [kind, setKind] = useState<LinkKind>(initialCustomer ? "customer" : "lead");
  const [leadId, setLeadId] = useState<string | null>(initialLead);
  const [customerId, setCustomerId] = useState<string | null>(initialCustomer);
  const [linkLabel, setLinkLabel] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [visitors, setVisitors] = useState<number | null>(1);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotValue | null>(null);
  const [serverError, setServerError] = useState<unknown>(null);

  const projects = useProjectOptions(open);
  const users = useSalesUserOptions(open);
  const lead = useItem<LeadRow>(LEADS_PATH, kind === "lead" ? leadId : null);
  const customer = useItem<CustomerRow>(CUSTOMERS_PATH, kind === "customer" ? customerId : null);

  useOnChange(open ? JSON.stringify([initialProject, initialLead, initialCustomer]) : null, (key) => {
    if (key === null) return;
    setProject(initialProject);
    setKind(initialCustomer ? "customer" : "lead");
    setLeadId(initialLead);
    setCustomerId(initialCustomer);
    setLinkLabel(undefined);
    setName("");
    setPhone("");
    setEmail("");
    setVisitors(1);
    setMessage("");
    setNotes("");
    setAssignee(null);
    setSlot(null);
    setServerError(null);
  });

  // Prefill empty contact fields from the linked record (after the reset above, so the record wins over blanks).
  useOnChange(kind === "lead" ? (lead.data ?? null) : null, (row) => {
    if (!row) return;
    setName((value) => value || row.full_name);
    setPhone((value) => value || row.phone);
    setEmail((value) => value || row.email || "");
    setAssignee((value) => value ?? row.assigned_user_id);
    setProject((value) => value ?? row.project_id);
    setLinkLabel(`${row.full_name} · ${row.lead_number}`);
  });
  useOnChange(kind === "customer" ? (customer.data ?? null) : null, (row) => {
    if (!row) return;
    setName((value) => value || row.full_name);
    setPhone((value) => value || row.phone);
    setEmail((value) => value || row.email || "");
    setAssignee((value) => value ?? row.relationship_manager_id);
    setLinkLabel(`${row.full_name} · ${row.customer_code}`);
  });

  const create = useMutationWithToast<VisitRow, void>({
    mutationFn: () =>
      api.post<VisitRow>(VISITS_PATH, {
        project_id: project,
        lead_id: kind === "lead" ? leadId : null,
        customer_id: kind === "customer" ? customerId : null,
        visit_date: slot?.date,
        slot_start: slot?.start,
        name: name.trim(),
        phone: normaliseIndianPhone(phone),
        email: email.trim() || null,
        visitors: visitors ?? 1,
        message: message.trim() || null,
        assignee_user_id: assignee,
        notes: notes.trim() || null,
      }),
    successMessage: (visit) => `Visit ${visit.visit_number} booked`,
    invalidate: [[VISITS_PATH], crmKeys.today, [LEADS_PATH]],
    errorMessage: (error: ApiClientError) =>
      error.code === "SLOT_FULL" ? "That slot just filled up — pick another." : error.message,
    onSuccess: (visit) => {
      onSaved?.(visit);
      onOpenChange(false);
    },
    onError: (error) => setServerError(error),
  });

  const linked = kind === "lead" ? Boolean(leadId) : Boolean(customerId);
  const phoneOk = PHONE_REGEX.test(normaliseIndianPhone(phone));
  const canSubmit = Boolean(project) && linked && Boolean(slot) && name.trim().length > 0 && phoneOk;
  const projectOptions = useMemo(
    () =>
      (projects.data ?? []).map((item) => ({ value: item.id, label: item.name, description: item.code ?? undefined })),
    [projects.data],
  );
  const userOptions = useMemo(
    () =>
      (users.data ?? [])
        .filter((user) => user.is_active)
        .map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] })),
    [users.data],
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <SheetContent size="lg" data-testid="visit-form-sheet">
        <SheetHeader>
          <SheetTitle>New site visit</SheetTitle>
          <SheetDescription>
            Capacity is checked on the server; the lead moves to "Site Visit Scheduled" and the assignee is notified.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          {serverError !== null && <FormError error={serverError} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldWrapper label="Project" required className="sm:col-span-2">
              {(control) => (
                <Combobox
                  id={control.id}
                  value={project}
                  onValueChange={(value) => {
                    setProject(value);
                    setSlot(null);
                  }}
                  options={projectOptions}
                  placeholder={projects.isPending ? "Loading…" : "Pick a project"}
                  data-testid="visit-project"
                />
              )}
            </FieldWrapper>
            <FieldWrapper label="Visitor is a" className="sm:col-span-2">
              <RadioGroup
                value={kind}
                inline
                onValueChange={(value) => {
                  setKind(value);
                  setLinkLabel(undefined);
                }}
                options={[
                  { value: "lead", label: "Lead" },
                  { value: "customer", label: "Customer" },
                ]}
              />
            </FieldWrapper>
            <FieldWrapper
              label={kind === "lead" ? "Lead" : "Customer"}
              required
              className="sm:col-span-2"
              hint="Search by phone, name or number"
            >
              {(control) =>
                kind === "lead" ? (
                  <Combobox
                    id={control.id}
                    value={leadId}
                    selectedLabel={linkLabel}
                    onValueChange={(value, option) => {
                      setLeadId(value);
                      setLinkLabel(option?.label);
                    }}
                    onSearch={searchLeads}
                    placeholder="Search leads…"
                    data-testid="visit-lead"
                  />
                ) : (
                  <Combobox
                    id={control.id}
                    value={customerId}
                    selectedLabel={linkLabel}
                    onValueChange={(value, option) => {
                      setCustomerId(value);
                      setLinkLabel(option?.label);
                    }}
                    onSearch={searchCustomers}
                    placeholder="Search customers…"
                    data-testid="visit-customer"
                  />
                )
              }
            </FieldWrapper>
            <FieldWrapper label="Visitor name" required>
              {(control) => (
                <Input id={control.id} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
              )}
            </FieldWrapper>
            <FieldWrapper label="Mobile" required error={phone && !phoneOk ? "10 digits starting 6–9" : undefined}>
              {(control) => (
                <Input
                  id={control.id}
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                  maxLength={16}
                  className="money"
                />
              )}
            </FieldWrapper>
            <FieldWrapper label="E-mail">
              {(control) => (
                <Input
                  id={control.id}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                />
              )}
            </FieldWrapper>
            <FieldWrapper label="Visitors" required hint="1–6 people">
              {(control) => (
                <NumberInput
                  id={control.id}
                  value={visitors}
                  onChange={setVisitors}
                  decimals={0}
                  min={1}
                  max={6}
                  align="left"
                />
              )}
            </FieldWrapper>
            <FieldWrapper label="Assignee" className="sm:col-span-2">
              {(control) => (
                <Combobox
                  id={control.id}
                  value={assignee}
                  onValueChange={(value) => setAssignee(value)}
                  options={userOptions}
                  placeholder={users.isPending ? "Loading…" : "Lead's RM by default"}
                  allowClear
                />
              )}
            </FieldWrapper>
          </div>
          <FieldWrapper label="Slot" required>
            <SlotPicker projectId={project} value={slot} onChange={setSlot} />
          </FieldWrapper>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldWrapper label="Visitor message">
              {(control) => (
                <Textarea
                  id={control.id}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={2}
                  maxLength={500}
                />
              )}
            </FieldWrapper>
            <FieldWrapper label="Internal notes">
              {(control) => (
                <Textarea
                  id={control.id}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  maxLength={1000}
                />
              )}
            </FieldWrapper>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!canSubmit}
            onClick={() => create.mutate()}
            data-testid="visit-form-submit"
          >
            Book visit
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
