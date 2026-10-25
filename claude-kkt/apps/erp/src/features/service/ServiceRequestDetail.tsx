import { Building2, Contact, FileText, History, Image as ImageIcon, Lock, Paperclip, Pencil, Send, Star, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ACTOR_TYPE_LABELS,
  SERVICE_PRIORITIES,
  SERVICE_PRIORITY_LABELS,
  SERVICE_STATUSES,
  SERVICE_STATUS_LABELS,
  ServiceRequestUpdateSchema,
  type AuditLogRow,
  type DocumentRow,
  type ServiceMessageRow,
  type ServicePriority,
  type ServiceRequestDetailResponse,
  type ServiceRequestRow,
  type ServiceStatus,
} from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Avatar, Badge, Button, Card, CardContent, CardHeader, CardTitle, Combobox, ErrorState, FieldWrapper, FormError, FormField, Input, KeyValueList, PageHeader, Select, SimpleDialog, Skeleton, Switch, Textarea, Timeline, type TimelineItem } from "@/components/ui";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatPhone } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn, humanize } from "@/lib/utils";
import { UploadDocumentDialog } from "@/features/inventory/DocumentsPanel";
import { fetchDocumentLink } from "@/features/inventory/api";
import { controlOf } from "@/features/inventory/components";
import { contractResolver } from "@/features/shared/contractResolver";
import { useUserOptions } from "@/features/shared/options";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PriorityChip, SlaBadge, TicketStatusChip } from "./components";
import { STATUS_TRANSITIONS } from "./sla";
import { SERVICE_PATH, serviceInvalidations, useServiceCategories, useServiceDetail, useTicketHistory } from "./api";

/** `/service-requests/:id` — ticket header, message thread with internal notes, reply composer and the action sidebar. */
export default function ServiceRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const detail = useServiceDetail(id);

  if (detail.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-20" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (detail.isError) {
    if (detail.error.status === 404) return <NotFoundPage />;
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} className="rounded-lg border border-border bg-card" />;
  }
  return <TicketView ticket={detail.data} />;
}

function TicketView({ ticket }: { ticket: ServiceRequestDetailResponse }) {
  const { can } = useAuth();
  const canWrite = can("service.write");
  const canAssign = can("service.assign");
  const [statusTarget, setStatusTarget] = useState<ServiceStatus | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const invalidate = serviceInvalidations(ticket.id);

  const status = useMutationWithToast<ServiceRequestRow, { status: ServiceStatus; note: string | null }>({
    mutationFn: ({ status: next, note }) => api.post<ServiceRequestRow>(`${SERVICE_PATH}/${ticket.id}/status`, { version: ticket.version, status: next, note }, { version: ticket.version }),
    successMessage: (saved) => `Ticket is now ${SERVICE_STATUS_LABELS[saved.status]}`,
    invalidate,
    entityLabel: "This ticket",
    onSuccess: () => setStatusTarget(null),
  });

  const priority = useMutationWithToast<ServiceRequestRow, ServicePriority>({
    mutationFn: (next) => api.patch<ServiceRequestRow>(`${SERVICE_PATH}/${ticket.id}`, { version: ticket.version, priority: next }, { version: ticket.version }),
    successMessage: (saved) => `Priority set to ${SERVICE_PRIORITY_LABELS[saved.priority]}`,
    invalidate,
    entityLabel: "This ticket",
  });

  const assign = useMutationWithToast<ServiceRequestRow, string | null>({
    mutationFn: (assignee) => api.post<ServiceRequestRow>(`${SERVICE_PATH}/${ticket.id}/assign`, { version: ticket.version, assignee_user_id: assignee }, { version: ticket.version }),
    successMessage: (saved) => (saved.assignee_name ? `Assigned to ${saved.assignee_name}` : "Unassigned"),
    invalidate,
    entityLabel: "This ticket",
  });

  const transitions = STATUS_TRANSITIONS[ticket.status];

  return (
    <>
      <PageHeader
        title={<span className="money">{ticket.ticket_number}</span>}
        titleAddon={
          <span className="flex flex-wrap items-center gap-1.5">
            <TicketStatusChip status={ticket.status} size="md" />
            <PriorityChip priority={ticket.priority} size="md" />
            <SlaBadge ticket={ticket} />
          </span>
        }
        description={ticket.subject}
        backTo="/service-requests"
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Service" }, { label: "Service requests", to: "/service-requests" }, { label: ticket.ticket_number }]}
        actions={
          canWrite ? (
            <>
              <Button variant="outline" leftIcon={Pencil} onClick={() => setEditOpen(true)} data-testid="ticket-edit-btn">
                Edit details
              </Button>
              {transitions.map((transition) => (
                <Button key={transition.to} variant={transition.variant} onClick={() => setStatusTarget(transition.to)} data-testid={`ticket-status-${transition.to}`}>
                  {transition.label}
                </Button>
              ))}
            </>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <MessageThread ticket={ticket} />
          {canWrite ? <ReplyComposer ticket={ticket} /> : <p className="text-xs text-ink-subtle">You can read this ticket but need the “service.write” permission to reply.</p>}
        </div>
        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Customer & booking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <Contact className="mt-0.5 size-4 shrink-0 text-gold-text" aria-hidden="true" />
                <div className="min-w-0">
                  <Link to={`/customers/${ticket.customer_id}`} className="font-semibold text-navy-800 hover:underline focus-ring rounded-xs" data-testid="ticket-customer-link">
                    {ticket.customer_name}
                  </Link>
                  <p className="money text-xs text-ink-muted">
                    <a href={`tel:${ticket.customer_phone}`} className="hover:underline">
                      {formatPhone(ticket.customer_phone)}
                    </a>
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Building2 className="mt-0.5 size-4 shrink-0 text-gold-text" aria-hidden="true" />
                <div className="min-w-0">
                  {ticket.booking_id ? (
                    <>
                      <Link to={`/bookings/${ticket.booking_id}`} className="money font-semibold text-navy-800 hover:underline focus-ring rounded-xs" data-testid="ticket-booking-link">
                        {ticket.booking_number}
                      </Link>
                      <p className="text-xs text-ink-muted">
                        {ticket.project_name} · <span className="money font-medium text-navy-950">{ticket.flat_number}</span>
                      </p>
                    </>
                  ) : (
                    <p className="text-ink-subtle">No booking linked</p>
                  )}
                </div>
              </div>
              <KeyValueList
                layout="inline"
                items={[
                  { label: "Category", value: ticket.category_name },
                  { label: "Raised", value: <span className="money">{formatDateTime(ticket.created_at)}</span> },
                  { label: "SLA due", value: <span className="money">{formatDateTime(ticket.sla_due_at)}</span> },
                  ...(ticket.resolved_at ? [{ label: "Resolved", value: <span className="money">{formatDateTime(ticket.resolved_at)}</span> }] : []),
                  ...(ticket.closed_at ? [{ label: "Closed", value: <span className="money">{formatDateTime(ticket.closed_at)}</span> }] : []),
                  ...(ticket.reopened_count > 0 ? [{ label: "Reopened", value: <span className="money">{ticket.reopened_count}×</span> }] : []),
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <AssigneeField ticket={ticket} canAssign={canAssign} pending={assign.isPending} onChange={(value) => assign.mutate(value)} />
              <FieldWrapper label="Priority">
                {(control) => (
                  <Select<ServicePriority>
                    id={control.id}
                    value={ticket.priority}
                    onValueChange={(value) => value && value !== ticket.priority && priority.mutate(value)}
                    options={SERVICE_PRIORITIES.map((value) => ({ value, label: SERVICE_PRIORITY_LABELS[value] }))}
                    disabled={!canWrite || priority.isPending}
                    data-testid="ticket-priority-select"
                  />
                )}
              </FieldWrapper>
              {canWrite && (
                <FieldWrapper label="Status" hint="Forward moves are the buttons above; this sets any status directly.">
                  {(control) => (
                    <Select<ServiceStatus>
                      id={control.id}
                      value={ticket.status}
                      onValueChange={(value) => value && value !== ticket.status && setStatusTarget(value)}
                      options={SERVICE_STATUSES.map((value) => ({ value, label: SERVICE_STATUS_LABELS[value] }))}
                      disabled={status.isPending}
                      data-testid="ticket-status-select"
                    />
                  )}
                </FieldWrapper>
              )}
            </CardContent>
          </Card>

          {ticket.rating !== null && (
            <Card className="border-gold-border bg-gold-light/40">
              <CardHeader>
                <CardTitle className="text-sm">Customer rating</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1" role="img" aria-label={`${ticket.rating} out of 5 stars`} data-testid="ticket-rating">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className={cn("size-5", star <= (ticket.rating ?? 0) ? "fill-gold text-gold" : "text-border-strong")} aria-hidden="true" />
                  ))}
                  <span className="money ml-1 text-sm font-semibold text-navy-950">{ticket.rating}/5</span>
                </div>
                {ticket.rating_comment && <p className="mt-2 text-sm text-ink">“{ticket.rating_comment}”</p>}
              </CardContent>
            </Card>
          )}

          <HistoryCard ticket={ticket} />
        </aside>
      </div>

      <StatusDialog target={statusTarget} ticket={ticket} pending={status.isPending} onClose={() => setStatusTarget(null)} onConfirm={(note) => statusTarget && status.mutate({ status: statusTarget, note })} />
      <EditTicketDialog open={editOpen} onOpenChange={setEditOpen} ticket={ticket} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Thread                                                               */
/* ------------------------------------------------------------------ */

function AttachmentList({ attachments }: { attachments: ServiceMessageRow["attachments"] }) {
  const [opening, setOpening] = useState<string | null>(null);
  if (attachments.length === 0) return null;
  const open = async (id: string) => {
    setOpening(id);
    try {
      const url = await fetchDocumentLink(id);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setOpening(null);
    }
  };
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
      {attachments.map((file) => {
        const isImage = file.mime.startsWith("image/");
        return (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => void open(file.id)}
              disabled={opening === file.id}
              className="flex items-center gap-2 rounded-md border border-border bg-card p-1 pr-2 text-left text-xs text-ink hover:border-navy-300 focus-ring disabled:opacity-60"
              data-testid={`attachment-${file.id}`}
            >
              {isImage && file.thumb_url ? (
                <img src={file.thumb_url} alt="" className="size-12 rounded-sm object-cover" loading="lazy" />
              ) : (
                <span className="flex size-9 items-center justify-center rounded-sm bg-navy-50 text-navy-700">{isImage ? <ImageIcon className="size-4" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}</span>
              )}
              <span className="max-w-40 truncate">{file.file_name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MessageBubble({ message }: { message: ServiceMessageRow }) {
  const mine = message.author_type === "STAFF";
  const system = message.author_type === "SYSTEM";
  return (
    <li className={cn("flex gap-3", system && "justify-center")} data-testid={`message-${message.id}`} data-internal={message.is_internal || undefined}>
      {!system && <Avatar name={message.author_name} size="sm" tone={mine ? "navy" : "gold"} className="mt-1" />}
      <div className={cn("min-w-0 flex-1", system && "max-w-xl flex-none")}>
        {system ? (
          <p className="rounded-full border border-border bg-surface px-3 py-1 text-center text-xs text-ink-muted">
            {message.body} · <span className="money">{formatDateTime(message.created_at)}</span>
          </p>
        ) : (
          <div className={cn("rounded-lg border p-3", message.is_internal ? "border-l-4 border-status-hold-border border-l-warning bg-warning-bg/50" : mine ? "border-navy-100 bg-navy-50/50" : "border-border bg-card")}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-semibold text-navy-950">{message.author_name}</span>
              <Badge variant={mine ? "navy" : "gold"}>{ACTOR_TYPE_LABELS[message.author_type]}</Badge>
              {message.is_internal && (
                <Badge variant="warning" className="gap-1" data-testid="internal-badge">
                  <Lock className="size-3" aria-hidden="true" /> Internal — hidden from customer
                </Badge>
              )}
              <span className="money ml-auto text-ink-subtle">{formatDateTime(message.created_at)}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">{message.body}</p>
            <AttachmentList attachments={message.attachments} />
          </div>
        )}
      </div>
    </li>
  );
}

function MessageThread({ ticket }: { ticket: ServiceRequestDetailResponse }) {
  const messages = useMemo(() => [...ticket.messages].sort((a, b) => a.created_at.localeCompare(b.created_at)), [ticket.messages]);
  const internalCount = messages.filter((message) => message.is_internal).length;
  return (
    <Card>
      <CardHeader actions={internalCount > 0 ? <Badge variant="warning">{internalCount} internal</Badge> : undefined}>
        <CardTitle className="text-sm">
          Conversation <span className="money ml-1 text-xs font-normal text-ink-subtle">{messages.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3" data-testid="ticket-thread">
          <li className="flex gap-3">
            <Avatar name={ticket.customer_name} size="sm" className="mt-1" />
            <div className="min-w-0 flex-1 rounded-lg border border-gold-border bg-gold-light/40 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-semibold text-navy-950">{ticket.customer_name}</span>
                <Badge variant="gold">Request</Badge>
                <span className="money ml-auto text-ink-subtle">{formatDateTime(ticket.created_at)}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-navy-950">{ticket.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{ticket.description}</p>
            </div>
          </li>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Composer                                                             */
/* ------------------------------------------------------------------ */

function ReplyComposer({ ticket }: { ticket: ServiceRequestDetailResponse }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState<ServiceStatus | null>(null);
  const [attachments, setAttachments] = useState<DocumentRow[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const send = useMutationWithToast<ServiceMessageRow, void>({
    mutationFn: () => api.post<ServiceMessageRow>(`${SERVICE_PATH}/${ticket.id}/messages`, { body: body.trim(), is_internal: internal, attachment_ids: attachments.map((doc) => doc.id), ...(nextStatus ? { status: nextStatus } : {}) }),
    successMessage: internal ? "Internal note added" : "Reply sent to the customer",
    invalidate: serviceInvalidations(ticket.id),
    onSuccess: () => {
      setBody("");
      setAttachments([]);
      setNextStatus(null);
    },
  });

  const closed = ticket.status === "CLOSED";
  const statusOptions = SERVICE_STATUSES.filter((value) => value !== ticket.status).map((value) => ({ value, label: SERVICE_STATUS_LABELS[value] }));

  return (
    <Card className={cn(internal && "border-status-hold-border")} data-testid="reply-composer">
      <CardHeader actions={<Switch size="sm" checked={internal} onCheckedChange={setInternal} label={<span className="flex items-center gap-1 text-xs font-medium"><Lock className="size-3" aria-hidden="true" /> Internal note</span>} data-testid="reply-internal-toggle" />}>
        <CardTitle className="text-sm">{internal ? "Internal note" : "Reply to customer"}</CardTitle>
        <p className="text-xs text-ink-subtle">{internal ? "Visible to staff only; the customer is never notified." : "The customer sees this in the portal and gets a notification."}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {internal && <div className="h-1 rounded-full bg-warning" aria-hidden="true" />}
        <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} maxLength={5000} placeholder={internal ? "Note for colleagues…" : closed ? "This ticket is closed; replying reopens the conversation for the customer." : "Write your reply…"} aria-label={internal ? "Internal note" : "Reply"} className={cn(internal && "bg-warning-bg/30")} data-testid="reply-body" />
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {attachments.map((doc) => (
              <li key={doc.id}>
                <Badge variant="outline" className="gap-1 pr-1">
                  <Paperclip className="size-3" aria-hidden="true" />
                  <span className="max-w-40 truncate">{doc.title || doc.file_name}</span>
                  <button type="button" aria-label={`Remove ${doc.file_name}`} className="rounded-full p-0.5 hover:bg-navy-50 focus-ring" onClick={() => setAttachments((rows) => rows.filter((row) => row.id !== doc.id))}>
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" leftIcon={Paperclip} onClick={() => setUploadOpen(true)} disabled={attachments.length >= 10} data-testid="reply-attach-btn">
            Attach
          </Button>
          <Select<ServiceStatus> aria-label="Set status with this message" size="sm" className="w-full sm:w-52" value={nextStatus} onValueChange={setNextStatus} options={statusOptions} placeholder="Keep status" allowClear data-testid="reply-status" />
          <span className="money ml-auto text-2xs text-ink-subtle">{body.length}/5000</span>
          <Button leftIcon={Send} loading={send.isPending} disabled={body.trim().length === 0} onClick={() => send.mutate()} variant={internal ? "gold" : "primary"} data-testid="reply-send">
            {internal ? "Add note" : "Send reply"}
          </Button>
        </div>
      </CardContent>
      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} entityType="SERVICE_REQUEST" entityId={ticket.id} allowShare={false} title="Attach to message" onUploaded={(doc) => setAttachments((rows) => [...rows, doc])} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar pieces                                                       */
/* ------------------------------------------------------------------ */

function AssigneeField({ ticket, canAssign, pending, onChange }: { ticket: ServiceRequestRow; canAssign: boolean; pending: boolean; onChange: (value: string | null) => void }) {
  const users = useUserOptions(canAssign);
  const options = useMemo(() => (users.data ?? []).filter((user) => user.is_active || user.id === ticket.assignee_user_id).map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] })), [users.data, ticket.assignee_user_id]);
  return (
    <FieldWrapper label="Assignee" hint={canAssign ? undefined : "Needs the “service.assign” permission to change"}>
      {(control) =>
        canAssign ? (
          <Combobox id={control.id} value={ticket.assignee_user_id} onValueChange={(value) => onChange(value)} options={options} selectedLabel={ticket.assignee_name ?? undefined} placeholder={users.isPending ? "Loading…" : "Unassigned"} allowClear disabled={pending} data-testid="ticket-assignee-select" />
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink">
            <UserRound className="size-4 text-ink-subtle" aria-hidden="true" />
            {ticket.assignee_name ?? <span className="text-ink-subtle">Unassigned</span>}
          </p>
        )
      }
    </FieldWrapper>
  );
}

function historyTone(action: string): TimelineItem["tone"] {
  if (/breach/i.test(action)) return "danger";
  if (/resolve|close/i.test(action)) return "success";
  if (/assign/i.test(action)) return "info";
  if (/priority|status/i.test(action)) return "warning";
  if (/create/i.test(action)) return "navy";
  return "neutral";
}

function describeAudit(row: AuditLogRow): string {
  const after = row.after ?? {};
  const bits: string[] = [];
  for (const key of ["status", "priority", "assignee_name"] as const) {
    const value = after[key];
    if (typeof value === "string") bits.push(`${humanize(key)}: ${humanize(value)}`);
  }
  return bits.join(" · ");
}

function HistoryCard({ ticket }: { ticket: ServiceRequestDetailResponse }) {
  const { can } = useAuth();
  const history = useTicketHistory(ticket.id, { enabled: can("audit.view") });
  const items = useMemo<TimelineItem[]>(() => {
    const derived: TimelineItem[] = [{ id: "created", title: "Ticket raised", at: ticket.created_at, actor: ticket.customer_name, tone: "navy" }];
    if (ticket.sla_breached_at) derived.push({ id: "sla", title: "SLA breached", at: ticket.sla_breached_at, tone: "danger" });
    if (ticket.resolved_at) derived.push({ id: "resolved", title: "Resolved", at: ticket.resolved_at, tone: "success" });
    if (ticket.closed_at) derived.push({ id: "closed", title: "Closed", at: ticket.closed_at, tone: "neutral" });
    const audits = (history.data ?? []).map<TimelineItem>((row) => ({ id: row.id, title: humanize(row.action.split(".").pop() ?? row.action), description: describeAudit(row) || undefined, at: row.created_at, actor: row.actor_name, tone: historyTone(row.action) }));
    const merged = audits.length > 0 ? [...audits, ...derived.filter((item) => item.id === "created" && !audits.some((audit) => /create/i.test(String(audit.title))))] : derived;
    return merged.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [history.data, ticket]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="size-4 text-gold-text" aria-hidden="true" /> History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {history.isPending ? <Skeleton className="h-24" /> : <Timeline items={items} />}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                              */
/* ------------------------------------------------------------------ */

function StatusDialog({ target, ticket, pending, onClose, onConfirm }: { target: ServiceStatus | null; ticket: ServiceRequestRow; pending: boolean; onClose: () => void; onConfirm: (note: string | null) => void }) {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!target) setNote("");
  }, [target]);
  const needsNote = target === "RESOLVED" || target === "CLOSED";
  return (
    <SimpleDialog
      open={target !== null}
      onOpenChange={(open) => !open && !pending && onClose()}
      title={target ? `Move to ${SERVICE_STATUS_LABELS[target]}?` : ""}
      description={target === "AWAITING_CUSTOMER" ? "The SLA clock keeps running; the customer is asked to respond." : target === "RESOLVED" ? "The customer can reopen within 7 days and rate the service." : target === "CLOSED" ? "Closes the ticket for good. The customer can still read it." : `${ticket.ticket_number} changes from ${SERVICE_STATUS_LABELS[ticket.status]}.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button loading={pending} onClick={() => onConfirm(note.trim() || null)} data-testid="status-dialog-confirm">
            {target ? SERVICE_STATUS_LABELS[target] : "Confirm"}
          </Button>
        </>
      }
    >
      <FieldWrapper label={needsNote ? "Resolution note" : "Note"} hint="Optional; shown to the customer with the status change.">
        {(control) => <Textarea id={control.id} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} data-testid="status-dialog-note" />}
      </FieldWrapper>
    </SimpleDialog>
  );
}

interface EditValues {
  subject: string;
  description: string;
  category_id: string | null;
}

const EditSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as EditValues;
    return { subject: values.subject.trim(), description: values.description.trim(), category_id: values.category_id ?? undefined };
  })
  .pipe(ServiceRequestUpdateSchema.omit({ version: true }));

function EditTicketDialog({ open, onOpenChange, ticket }: { open: boolean; onOpenChange: (open: boolean) => void; ticket: ServiceRequestDetailResponse }) {
  const resolver = useMemo(() => contractResolver<EditValues, unknown>(EditSchema), []);
  const form = useForm<EditValues, unknown, unknown>({ resolver, defaultValues: { subject: ticket.subject, description: ticket.description, category_id: ticket.category_id }, mode: "onTouched" });
  const control = controlOf(form);
  const categories = useServiceCategories(open);
  const [serverError, setServerError] = useState<unknown>(null);

  useEffect(() => {
    if (open) form.reset({ subject: ticket.subject, description: ticket.description, category_id: ticket.category_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket.version]);

  const save = useMutationWithToast<ServiceRequestRow, unknown>({
    mutationFn: (body) => api.patch<ServiceRequestRow>(`${SERVICE_PATH}/${ticket.id}`, { ...(body as Record<string, unknown>), version: ticket.version }, { version: ticket.version }),
    successMessage: "Ticket updated",
    invalidate: serviceInvalidations(ticket.id),
    entityLabel: "This ticket",
    errorMessage: false,
    onError: (error) => {
      if (error.isVersionConflict) return;
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
    onSuccess: () => onOpenChange(false),
  });

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !save.isPending && onOpenChange(next)}
      title="Edit ticket details"
      description="Subject, description and category. Status, priority and assignee have their own controls."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-ticket-form" loading={save.isPending} data-testid="edit-ticket-save">
            Save
          </Button>
        </>
      }
    >
      <form
        id="edit-ticket-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((output) => {
          setServerError(null);
          save.mutate(output);
        })}
      >
        <FormError error={serverError} />
        <FormField control={control} name="subject" label="Subject" required render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={200} invalid={field.invalid} />} />
        <FormField control={control} name="category_id" label="Category" required render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={(categories.data ?? []).map((row) => ({ value: row.id, label: row.name }))} invalid={field.invalid} />} />
        <FormField control={control} name="description" label="Description" required render={({ field }) => <Textarea id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} rows={5} maxLength={2000} invalid={field.invalid} />} />
      </form>
    </SimpleDialog>
  );
}
