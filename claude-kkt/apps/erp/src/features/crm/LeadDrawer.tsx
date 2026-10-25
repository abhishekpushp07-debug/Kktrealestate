import { ArrowRight, CalendarPlus, ExternalLink, Pencil, Phone, Plus, UserCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LEAD_ACTIVITY_TYPE_LABELS, LEAD_SOURCE_LABELS, LEAD_STAGES, LEAD_STAGE_LABELS, type LeadConvertResponse, type LeadDetailResponse, type LeadRow, type LeadStage } from "@kkt/contracts";
import { Badge, Button, Combobox, ConfirmDialog, ErrorState, FieldWrapper, Input, KeyValueList, RadioGroup, Select, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, SimpleDialog, Skeleton, StatusChip, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Timeline, type TimelineItem } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatINRShort, formatPhone, formatRelative } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { useSalesUserOptions } from "@/features/inventory/api";
import { Notice } from "@/features/inventory/components";
import { LeadFormSheet, isoToLocal, localToIso } from "./LeadFormSheet";
import { CUSTOMERS_PATH, LEADS_PATH, crmKeys, searchCustomers, useLeadDetail } from "./api";
import { normaliseIndianPhone, PHONE_REGEX } from "./verhoeff";

export interface LeadDrawerProps {
  leadId: string | null;
  onClose: () => void;
}

export function budgetLabel(lead: Pick<LeadRow, "budget_min_paise" | "budget_max_paise">): string | null {
  if (lead.budget_min_paise === null && lead.budget_max_paise === null) return null;
  if (lead.budget_min_paise !== null && lead.budget_max_paise !== null) return `${formatINRShort(lead.budget_min_paise)} – ${formatINRShort(lead.budget_max_paise)}`;
  if (lead.budget_min_paise !== null) return `from ${formatINRShort(lead.budget_min_paise)}`;
  return `up to ${formatINRShort(lead.budget_max_paise)}`;
}

/** Lead details, stage history, follow-ups, activities, assign and convert. */
export function LeadDrawer({ leadId, onClose }: LeadDrawerProps) {
  const lead = useLeadDetail(leadId);
  return (
    <Sheet open={leadId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent size="lg" data-testid="lead-drawer">
        {lead.isPending && (
          <>
            <SheetHeader>
              <SheetTitle>
                <Skeleton className="h-6 w-48" />
              </SheetTitle>
              <SheetDescription className="sr-only">Loading lead</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-40" />
            </SheetBody>
          </>
        )}
        {lead.isError && (
          <>
            <SheetHeader>
              <SheetTitle>Lead</SheetTitle>
              <SheetDescription className="sr-only">Error</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <ErrorState error={lead.error} onRetry={() => void lead.refetch()} compact />
            </SheetBody>
          </>
        )}
        {lead.data && <LeadDrawerBody lead={lead.data} />}
      </SheetContent>
    </Sheet>
  );
}

function LeadDrawerBody({ lead }: { lead: LeadDetailResponse }) {
  const { can } = useAuth();
  const canWrite = can("lead.write");
  const [editOpen, setEditOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [pendingStage, setPendingStage] = useState<LeadStage | null>(null);
  const invalidate = useMemo(() => [[LEADS_PATH], crmKeys.leadDetail(lead.id), crmKeys.followUpsDue], [lead.id]);
  const users = useSalesUserOptions(canWrite);
  const closed = lead.stage === "CONVERTED" || lead.stage === "LOST";

  const changeStage = useMutationWithToast<LeadRow, { stage: LeadStage; reason?: string }>({
    mutationFn: ({ stage, reason }) => api.post<LeadRow>(`${LEADS_PATH}/${lead.id}/stage`, { version: lead.version, stage, lost_reason: reason ?? null }, { version: lead.version }),
    successMessage: (_data, { stage }) => `Moved to ${LEAD_STAGE_LABELS[stage]}`,
    invalidate,
    entityLabel: "This lead",
    onSuccess: () => setPendingStage(null),
  });
  const assign = useMutationWithToast<LeadRow, string | null>({
    mutationFn: (userId) => api.post<LeadRow>(`${LEADS_PATH}/${lead.id}/assign`, { version: lead.version, assigned_user_id: userId }, { version: lead.version }),
    successMessage: (saved) => (saved.assigned_user_name ? `Assigned to ${saved.assigned_user_name}` : "Unassigned"),
    invalidate,
    entityLabel: "This lead",
  });

  const onStagePick = (stage: LeadStage) => {
    if (stage === lead.stage) return;
    if (stage === "LOST") {
      setPendingStage(stage);
      setLostOpen(true);
      return;
    }
    changeStage.mutate({ stage });
  };

  const stageOptions = LEAD_STAGES.map((stage) => ({ value: stage, label: LEAD_STAGE_LABELS[stage], disabled: stage === "CONVERTED" }));
  const activityItems: TimelineItem[] = useMemo(() => {
    const activities: TimelineItem[] = lead.activities.map((activity) => ({
      id: `a-${activity.id}`,
      title: LEAD_ACTIVITY_TYPE_LABELS[activity.type],
      at: activity.at,
      actor: activity.actor_name ?? (activity.actor_type === "SYSTEM" ? "System" : activity.actor_type === "CUSTOMER" ? "Visitor" : null),
      tone: activity.type.startsWith("VISIT") ? "info" : activity.type === "CONVERTED" ? "success" : activity.type === "STAGE_CHANGED" ? "gold" : "neutral",
      description: typeof activity.payload.note === "string" ? activity.payload.note : typeof activity.payload.message === "string" ? activity.payload.message : undefined,
    }));
    const stages: TimelineItem[] = lead.stage_history.map((entry) => ({
      id: `s-${entry.id}`,
      title: (
        <span className="inline-flex flex-wrap items-center gap-1">
          {entry.from_stage ? LEAD_STAGE_LABELS[entry.from_stage] : "Created"} <ArrowRight className="size-3" aria-hidden="true" /> {LEAD_STAGE_LABELS[entry.to_stage]}
        </span>
      ),
      at: entry.at,
      actor: entry.by_user_name,
      tone: entry.to_stage === "LOST" ? "danger" : entry.to_stage === "CONVERTED" ? "success" : "gold",
      description: entry.reason ?? undefined,
    }));
    return [...activities, ...stages].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [lead.activities, lead.stage_history]);

  const dueSoon = lead.next_follow_up_at && Date.parse(lead.next_follow_up_at) < Date.now();

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle>{lead.full_name}</SheetTitle>
          <StatusChip status={lead.stage} label={LEAD_STAGE_LABELS[lead.stage]} />
          {!lead.is_read && <Badge variant="gold">New</Badge>}
        </div>
        <SheetDescription>
          <span className="flex flex-wrap items-center gap-x-3">
            <span className="font-mono">{lead.lead_number}</span>
            <a href={`tel:${lead.phone}`} className="money inline-flex items-center gap-1 text-navy-700 hover:underline">
              <Phone className="size-3" aria-hidden="true" /> {formatPhone(lead.phone)}
            </a>
            {lead.email && <span>{lead.email}</span>}
            <span>{LEAD_SOURCE_LABELS[lead.source]}</span>
          </span>
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-5">
        {lead.stage === "CONVERTED" && lead.customer_id && (
          <Notice tone="success">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>Converted to a customer.</span>
              <span className="flex gap-3">
                <Link to={`/customers/${lead.customer_id}`} className="inline-flex items-center gap-1 font-semibold hover:underline">
                  Open customer <ExternalLink className="size-3.5" aria-hidden="true" />
                </Link>
                {lead.booking_id && (
                  <Link to={`/bookings/${lead.booking_id}`} className="inline-flex items-center gap-1 font-semibold hover:underline">
                    Booking <ExternalLink className="size-3.5" aria-hidden="true" />
                  </Link>
                )}
              </span>
            </span>
          </Notice>
        )}
        {lead.stage === "LOST" && <Notice tone="danger">Lost{lead.lost_reason ? `: ${lead.lost_reason}` : ""}. Move it back to another stage to reopen.</Notice>}

        {canWrite && (
          <div className="grid gap-3 rounded-md border border-border bg-surface/60 p-3 sm:grid-cols-2">
            <FieldWrapper label="Stage">
              {(control) => <Select id={control.id} value={pendingStage ?? lead.stage} onValueChange={(value) => value && onStagePick(value)} options={stageOptions} disabled={changeStage.isPending} data-testid="lead-stage-select" />}
            </FieldWrapper>
            <FieldWrapper label="Assigned to">
              {(control) => <Combobox id={control.id} value={lead.assigned_user_id} selectedLabel={lead.assigned_user_name ?? undefined} onValueChange={(value) => assign.mutate(value)} options={(users.data ?? []).filter((user) => user.is_active).map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] }))} placeholder="Unassigned" allowClear disabled={assign.isPending} data-testid="lead-assign" />}
            </FieldWrapper>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button size="sm" variant="outline" leftIcon={Pencil} onClick={() => setEditOpen(true)} data-testid="lead-edit">
                Edit
              </Button>
              {can("visit.write") && !closed && (
                <Button asChild size="sm" variant="outline" leftIcon={CalendarPlus}>
                  <Link to={`/site-visits?new=1&lead_id=${lead.id}${lead.project_id ? `&project=${lead.project_id}` : ""}`}>
                    <CalendarPlus aria-hidden="true" /> Schedule visit
                  </Link>
                </Button>
              )}
              {lead.stage !== "CONVERTED" && (
                <Button size="sm" variant="gold" leftIcon={UserCheck} onClick={() => setConvertOpen(true)} className="ml-auto" data-testid="lead-convert">
                  Convert to customer
                </Button>
              )}
            </div>
          </div>
        )}

        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="follow-ups" count={lead.follow_ups.length}>
              Follow-ups
            </TabsTrigger>
            <TabsTrigger value="activity" count={activityItems.length}>
              Activity
            </TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <KeyValueList
              columns={2}
              items={[
                { label: "Project", value: lead.project_name },
                { label: "Flat type", value: lead.flat_type_name },
                { label: "Budget", value: budgetLabel(lead) },
                { label: "Assigned to", value: lead.assigned_user_name },
                { label: "Next follow-up", value: lead.next_follow_up_at ? <span className={dueSoon ? "font-semibold text-danger-fg" : undefined}>{formatDateTime(lead.next_follow_up_at)}</span> : null },
                { label: "Upcoming visit", value: lead.upcoming_visit_at ? formatDateTime(lead.upcoming_visit_at) : null },
                { label: "Consent", value: lead.consent ? "Given" : "Not given" },
                { label: "Created", value: formatDateTime(lead.created_at) },
                { label: "Last activity", value: lead.last_activity_at ? formatRelative(lead.last_activity_at) : null },
                { label: "UTM", value: lead.utm ? [lead.utm.source, lead.utm.medium, lead.utm.campaign].filter(Boolean).join(" / ") || null : null },
                { label: "Message", value: lead.message, full: true },
              ]}
            />
          </TabsContent>
          <TabsContent value="follow-ups" className="space-y-4">
            {canWrite && !closed && <FollowUpForm lead={lead} invalidate={invalidate} />}
            {lead.follow_ups.length === 0 ? (
              <p className="text-sm text-ink-subtle">No follow-ups yet.</p>
            ) : (
              <Timeline
                absolute
                items={[...lead.follow_ups]
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map((entry) => ({
                    id: entry.id,
                    title: entry.note,
                    at: entry.done_at ?? entry.created_at,
                    actor: entry.by_user_name,
                    tone: "gold",
                    description: entry.next_at ? `Next: ${formatDateTime(entry.next_at)}` : undefined,
                  }))}
              />
            )}
          </TabsContent>
          <TabsContent value="activity">{activityItems.length === 0 ? <p className="text-sm text-ink-subtle">No activity yet.</p> : <Timeline items={activityItems} absolute />}</TabsContent>
        </Tabs>
      </SheetBody>

      <LeadFormSheet open={editOpen} onOpenChange={setEditOpen} lead={lead} />
      <ConfirmDialog
        open={lostOpen}
        onOpenChange={(open) => {
          setLostOpen(open);
          if (!open) setPendingStage(null);
        }}
        title="Mark lead as lost?"
        description="The lead leaves the pipeline. Give the reason the team can learn from."
        confirmLabel="Mark lost"
        variant="destructive"
        requireReason
        reasonLabel="Lost reason"
        onConfirm={async (reason) => {
          await changeStage.mutateAsync({ stage: "LOST", reason: reason ?? "" });
        }}
      />
      <ConvertDialog lead={lead} open={convertOpen} onOpenChange={setConvertOpen} invalidate={invalidate} />
    </>
  );
}

function FollowUpForm({ lead, invalidate }: { lead: LeadDetailResponse; invalidate: ReadonlyArray<readonly unknown[]> }) {
  const [note, setNote] = useState("");
  const [nextLocal, setNextLocal] = useState(isoToLocal(lead.next_follow_up_at));
  const add = useMutationWithToast<unknown, void>({
    mutationFn: () => api.post(`${LEADS_PATH}/${lead.id}/follow-ups`, { note: note.trim(), next_at: localToIso(nextLocal) }),
    successMessage: "Follow-up recorded",
    invalidate,
    onSuccess: () => setNote(""),
  });
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <FieldWrapper label="Follow-up note" required>{(control) => <Textarea id={control.id} value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000} placeholder="Spoke to the customer; wants a 3 BHK on a high floor…" data-testid="follow-up-note" />}</FieldWrapper>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <FieldWrapper label="Next follow-up" className="flex-1">{(control) => <Input id={control.id} type="datetime-local" value={nextLocal} onChange={(event) => setNextLocal(event.target.value)} className="money" />}</FieldWrapper>
        <Button size="md" leftIcon={Plus} loading={add.isPending} disabled={!note.trim()} onClick={() => add.mutate()} data-testid="follow-up-add">
          Add follow-up
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Convert                                                              */
/* ------------------------------------------------------------------ */

function ConvertDialog({ lead, open, onOpenChange, invalidate }: { lead: LeadDetailResponse; open: boolean; onOpenChange: (open: boolean) => void; invalidate: ReadonlyArray<readonly unknown[]> }) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState<string | undefined>(undefined);
  const [fullName, setFullName] = useState(lead.full_name);
  const [phone, setPhone] = useState(lead.phone);
  const [email, setEmail] = useState(lead.email ?? "");
  const [result, setResult] = useState<LeadConvertResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("existing");
    setCustomerId(null);
    setCustomerLabel(undefined);
    setFullName(lead.full_name);
    setPhone(lead.phone);
    setEmail(lead.email ?? "");
    setResult(null);
  }, [open, lead.full_name, lead.phone, lead.email]);

  const convert = useMutationWithToast<LeadConvertResponse, void>({
    mutationFn: () => {
      const body =
        mode === "existing"
          ? { version: lead.version, customer_id: customerId, start_booking: false }
          : {
              version: lead.version,
              customer: { full_name: fullName.trim(), phone: normaliseIndianPhone(phone), email: email.trim() || null, source: lead.source, same_as_current: true, co_applicants: [], tags: [], relationship_manager_id: lead.assigned_user_id },
              start_booking: false,
            };
      return api.post<LeadConvertResponse>(`${LEADS_PATH}/${lead.id}/convert`, body, { version: lead.version });
    },
    successMessage: (response) => `Converted · customer ${response.customer_code}`,
    invalidate: [...invalidate, [CUSTOMERS_PATH]],
    entityLabel: "This lead",
    onSuccess: (response) => setResult(response),
  });

  const phoneOk = PHONE_REGEX.test(normaliseIndianPhone(phone));
  const canSubmit = mode === "existing" ? Boolean(customerId) : fullName.trim().length > 0 && phoneOk;
  const bookingHref = result ? `/bookings/new?customer_id=${result.customer_id}${lead.project_id ? `&project_id=${lead.project_id}` : ""}` : "#";

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !convert.isPending && onOpenChange(next)}
      title={result ? "Lead converted" : "Convert lead to customer"}
      description={result ? undefined : "Link an existing customer (matched by phone) or create one now. The lead moves to Converted."}
      footer={
        result ? (
          <>
            <Button asChild variant="outline">
              <Link to={`/customers/${result.customer_id}`}>Open customer</Link>
            </Button>
            <Button asChild variant="gold">
              <Link to={bookingHref} data-testid="lead-start-booking">
                Start booking
              </Link>
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={convert.isPending}>
              Cancel
            </Button>
            <Button loading={convert.isPending} disabled={!canSubmit} onClick={() => convert.mutate()} data-testid="lead-convert-submit">
              Convert
            </Button>
          </>
        )
      }
    >
      {result ? (
        <Notice tone="success">
          <p className="font-semibold">
            {lead.full_name} is now customer {result.customer_code}.
          </p>
          <p className="text-xs">Start a booking to allot a flat, or open the Customer 360 to complete KYC.</p>
        </Notice>
      ) : (
        <div className="space-y-4">
          <RadioGroup
            value={mode}
            onValueChange={setMode}
            inline
            options={[
              { value: "existing", label: "Existing customer", description: "Search by phone, name or code" },
              { value: "new", label: "Create new customer", description: "Minimal record; complete KYC later" },
            ]}
          />
          {mode === "existing" ? (
            <FieldWrapper label="Customer" required hint={`Lead phone ${formatPhone(lead.phone)}`}>
              {(control) => (
                <Combobox
                  id={control.id}
                  value={customerId}
                  selectedLabel={customerLabel}
                  onValueChange={(value, option) => {
                    setCustomerId(value);
                    setCustomerLabel(option?.label);
                  }}
                  onSearch={(query) => searchCustomers(query || lead.phone)}
                  placeholder="Search customers…"
                  searchPlaceholder="Phone, name or code"
                  data-testid="lead-convert-customer"
                />
              )}
            </FieldWrapper>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldWrapper label="Full name" required className="sm:col-span-2">{(control) => <Input id={control.id} value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} />}</FieldWrapper>
              <FieldWrapper label="Mobile" required error={phone && !phoneOk ? "10 digits starting 6–9" : undefined}>{(control) => <Input id={control.id} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" maxLength={16} className="money" />}</FieldWrapper>
              <FieldWrapper label="E-mail">{(control) => <Input id={control.id} type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} />}</FieldWrapper>
            </div>
          )}
        </div>
      )}
    </SimpleDialog>
  );
}
