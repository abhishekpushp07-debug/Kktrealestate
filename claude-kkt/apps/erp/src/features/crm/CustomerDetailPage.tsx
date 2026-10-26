import { ArchiveRestore, ClipboardList, CreditCard, ExternalLink, FileText, History, LifeBuoy, Pencil, Phone, Power, ShieldX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BOOKING_STATUS_LABELS, KYC_STATUS_LABELS, LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, SERVICE_STATUS_LABELS, type ActiveStateResponse, type AuditLogRow, type Customer360Response, type LeadRow, type PaymentRow, type ServiceRequestRow } from "@kkt/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, ErrorState, KeyValueList, PageHeader, PageSkeleton, Skeleton, StatusChip, Timeline, type TimelineItem } from "@/components/ui";
import { api, isApiClientError, type ListEnvelope } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatINR, formatNumber, formatPhone } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { humanize } from "@/lib/utils";
import NotFoundPage from "@/pages/NotFoundPage";
import { DocumentsPanel } from "@/features/inventory/DocumentsPanel";
import { useApiQuery } from "@/features/inventory/api";
import { CustomerFormSheet } from "./CustomerFormSheet";
import { LeadDrawer } from "./LeadDrawer";
import { AUDIT_PATH, CUSTOMERS_PATH, LEADS_PATH, PAYMENTS_PATH, SERVICE_PATH, crmKeys, useCustomer360 } from "./api";
import { CoApplicantsCard } from "./customer/CoApplicantsCard";
import { EraseCustomerDialog } from "./customer/EraseCustomerDialog";
import { KycPanel } from "./customer/KycPanel";
import { PortalAccessCard } from "./customer/PortalAccessCard";

/** `/customers/:id` — Customer 360. */
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isSuperAdmin } = useAuth();
  const data = useCustomer360(id);
  const [editOpen, setEditOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [confirmActive, setConfirmActive] = useState(false);

  const toggleActive = useMutationWithToast<ActiveStateResponse, Customer360Response["customer"]>({
    mutationFn: (customer) => api.post<ActiveStateResponse>(`${CUSTOMERS_PATH}/${customer.id}/${customer.is_active ? "deactivate" : "activate"}`, { version: customer.version }, { version: customer.version }),
    successMessage: (_data, customer) => (customer.is_active ? `${customer.full_name} deactivated` : `${customer.full_name} activated`),
    invalidate: [[CUSTOMERS_PATH], crmKeys.customer360(id ?? "")],
    entityLabel: "This customer",
  });

  if (data.isPending) return <PageSkeleton />;
  if (data.isError) {
    if (isApiClientError(data.error) && data.error.status === 404) return <NotFoundPage />;
    return <ErrorState error={data.error} onRetry={() => void data.refetch()} className="rounded-lg border border-border bg-card" />;
  }
  const { customer, bookings, payments_count, documents_count, leads_count, tickets_open, portal } = data.data;
  const canWrite = can("customer.write") && !customer.erased_at;
  const canErase = isSuperAdmin && !customer.erased_at;

  return (
    <>
      <PageHeader
        title={`${customer.salutation ? `${customer.salutation} ` : ""}${customer.full_name}`}
        titleAddon={
          <>
            <StatusChip status={customer.kyc_status} label={`KYC ${KYC_STATUS_LABELS[customer.kyc_status]}`} />
            {!customer.is_active && <Badge variant="danger">Inactive</Badge>}
            {customer.erased_at && <Badge variant="neutral">Erased</Badge>}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3">
            <span className="font-mono">{customer.customer_code}</span>
            <a href={`tel:${customer.phone}`} className="money inline-flex items-center gap-1 text-navy-700 hover:underline">
              <Phone className="size-3.5" aria-hidden="true" /> {formatPhone(customer.phone)}
            </a>
            {customer.email && <span>{customer.email}</span>}
            {customer.relationship_manager_name && <span>RM {customer.relationship_manager_name}</span>}
          </span>
        }
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Customers", to: "/customers" }, { label: customer.full_name }]}
        backTo="/customers"
        actions={
          canWrite || canErase ? (
            <>
              {canWrite && (
                <>
                  <Button variant="outline" leftIcon={Pencil} onClick={() => setEditOpen(true)} data-testid="customer-edit-btn">
                    Edit
                  </Button>
                  <Button variant={customer.is_active ? "danger-outline" : "outline"} leftIcon={customer.is_active ? Power : ArchiveRestore} onClick={() => setConfirmActive(true)} data-testid="customer-toggle-active">
                    {customer.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </>
              )}
              {canErase && (
                <Button variant="danger-outline" leftIcon={ShieldX} onClick={() => setEraseOpen(true)} data-testid="customer-erase-btn">
                  Erase personal data
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Active bookings" value={formatNumber(customer.active_booking_count)} />
          <Stat label="Payments" value={formatNumber(payments_count)} />
          <Stat label="Documents" value={formatNumber(documents_count)} />
          <Stat label="Open tickets" value={formatNumber(tickets_open)} tone={tickets_open > 0 ? "warning" : undefined} />
        </div>
      </PageHeader>

      {customer.erased_at && (
        <div role="status" className="mb-4 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-muted" data-testid="customer-erased-notice">
          Personal data was erased on {formatDateTime(customer.erased_at)}. The record is read-only; its bookings, payments and ledger are kept for accounting.
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          <ProfileCard customer={customer} />
          <KycPanel customer={customer} />
          <CoApplicantsCard customer={customer} />
          <PortalAccessCard customer={customer} initial={portal} />
        </div>
        <div className="space-y-4 xl:col-span-2">
          <BookingsCard bookings={bookings} customerId={customer.id} />
          <div className="grid gap-4 lg:grid-cols-2">
            <PaymentsCard customerId={customer.id} />
            <TicketsCard customerId={customer.id} />
          </div>
          <DocumentsPanel entityType="CUSTOMER" entityId={customer.id} appliesTo="CUSTOMER" />
          <LeadsCard customer={customer} count={leads_count} />
          <HistoryCard customerId={customer.id} />
        </div>
      </div>

      <CustomerFormSheet open={editOpen} onOpenChange={setEditOpen} customer={customer} />
      {canErase && <EraseCustomerDialog key={eraseOpen ? "open" : "closed"} customer={customer} open={eraseOpen} onOpenChange={setEraseOpen} />}
      <ConfirmDialog
        open={confirmActive}
        onOpenChange={setConfirmActive}
        title={customer.is_active ? "Deactivate customer?" : "Activate customer?"}
        description={customer.is_active ? "They disappear from pickers; bookings, ledgers and documents stay intact." : "The customer becomes selectable again in bookings and leads."}
        confirmLabel={customer.is_active ? "Deactivate" : "Activate"}
        variant={customer.is_active ? "destructive" : "default"}
        onConfirm={async () => {
          await toggleActive.mutateAsync(customer);
        }}
      />
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className={`rounded-lg border px-3 py-2 shadow-card ${tone === "warning" ? "border-status-hold-border bg-warning-bg" : "border-border bg-card"}`}>
      <p className="label-caps">{label}</p>
      <p className="money font-display text-xl font-extrabold text-navy-950">{value}</p>
    </div>
  );
}

function ProfileCard({ customer }: { customer: Customer360Response["customer"] }) {
  const address = (value: Customer360Response["customer"]["address_current"]) => (value ? [value.line1, value.line2, value.locality, `${value.city}, ${value.state} ${value.pincode}`].filter(Boolean).join(", ") : null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <KeyValueList
          columns={2}
          items={[
            { label: "Father / spouse", value: customer.father_or_spouse_name },
            { label: "Date of birth", value: customer.dob ? formatDate(customer.dob) : null },
            { label: "Gender", value: customer.gender ? humanize(customer.gender) : null },
            { label: "Alternate phone", value: customer.alt_phone ? <span className="money">{formatPhone(customer.alt_phone)}</span> : null },
            { label: "Occupation", value: customer.occupation },
            { label: "Company", value: customer.company_name },
            { label: "Income band", value: customer.income_band },
            { label: "Source", value: customer.source ? LEAD_SOURCE_LABELS[customer.source] : null },
            { label: "Current address", value: address(customer.address_current), full: true },
            { label: "Permanent address", value: customer.same_as_current ? "Same as current" : address(customer.address_permanent), full: true },
            {
              label: "Tags",
              value: customer.tags.length ? (
                <span className="flex flex-wrap gap-1">
                  {customer.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </span>
              ) : null,
              full: true,
            },
            { label: "Notes", value: customer.notes, full: true },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function BookingsCard({ bookings, customerId }: { bookings: Customer360Response["bookings"]; customerId: string }) {
  const { can } = useAuth();
  return (
    <Card data-testid="customer-bookings">
      <CardHeader
        actions={
          can("booking.create") ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`/bookings/new?customer_id=${customerId}`}>New booking</Link>
            </Button>
          ) : undefined
        }
      >
        <CardTitle>
          Bookings <span className="money ml-1 text-xs font-normal text-ink-subtle">{bookings.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {bookings.length === 0 ? (
          <EmptyState compact icon={FileText} title="No bookings" description="Bookings where this customer is primary or co-applicant appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface text-left text-2xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-4 py-2 font-semibold">Booking</th>
                  <th className="px-4 py-2 font-semibold">Unit</th>
                  <th className="px-4 py-2 font-semibold">Plan</th>
                  <th className="px-4 py-2 text-right font-semibold">Agreement</th>
                  <th className="px-4 py-2 text-right font-semibold">Paid</th>
                  <th className="px-4 py-2 text-right font-semibold">Due</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.booking_id} className="border-t border-border hover:bg-navy-50/60">
                    <td className="px-4 py-2">
                      <Link to={`/bookings/${booking.booking_id}`} className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-navy-700 hover:underline">
                        {booking.booking_number} <ExternalLink className="size-3" aria-hidden="true" />
                      </Link>
                      {booking.role === "CO_APPLICANT" && <Badge variant="neutral" className="ml-1">Co-applicant</Badge>}
                    </td>
                    <td className="px-4 py-2">
                      {booking.project_name} · {booking.block_name} · {booking.flat_number}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">{booking.plan_name}</td>
                    <td className="money px-4 py-2 text-right">{formatINR(booking.agreement_value_paise)}</td>
                    <td className="money px-4 py-2 text-right text-success-fg">{formatINR(booking.total_paid_paise)}</td>
                    <td className="money px-4 py-2 text-right">{formatINR(booking.total_due_paise)}</td>
                    <td className="px-4 py-2">
                      <StatusChip status={booking.status} label={BOOKING_STATUS_LABELS[booking.status]} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentsCard({ customerId }: { customerId: string }) {
  const { can } = useAuth();
  const enabled = can("payment.read");
  const payments = useApiQuery<ListEnvelope<PaymentRow>>([PAYMENTS_PATH, "customer", customerId], PAYMENTS_PATH, { query: { customer_id: customerId, page_size: 5, sort: "-payment_date" }, enabled, retry: false });
  return (
    <Card data-testid="customer-payments">
      <CardHeader actions={enabled ? <Button asChild size="sm" variant="ghost"><Link to={`/payments?customer_id=${customerId}`}>All</Link></Button> : undefined}>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-navy-700" aria-hidden="true" /> Recent payments
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!enabled && <p className="px-4 py-3 text-xs text-ink-subtle">Payments are hidden for your role.</p>}
        {enabled && payments.isPending && <Skeleton className="m-4 h-20" />}
        {enabled && payments.isError && <p className="px-4 py-3 text-xs text-ink-subtle">Could not load payments.</p>}
        {payments.data && payments.data.items.length === 0 && <EmptyState compact title="No payments yet" />}
        {payments.data && payments.data.items.length > 0 && (
          <ul className="divide-y divide-border">
            {payments.data.items.map((payment) => (
              <li key={payment.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-semibold text-navy-950">{payment.receipt_number}</p>
                  <p className="truncate text-2xs text-ink-subtle">
                    {formatDate(payment.payment_date)} · {payment.mode_name} · {payment.booking_number}
                  </p>
                </div>
                <span className="money font-semibold">{formatINR(payment.amount_paise)}</span>
                <StatusChip status={payment.status} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TicketsCard({ customerId }: { customerId: string }) {
  const { can } = useAuth();
  const enabled = can("service.read");
  const tickets = useApiQuery<ListEnvelope<ServiceRequestRow>>([SERVICE_PATH, "customer", customerId], SERVICE_PATH, { query: { customer_id: customerId, page_size: 5, sort: "-created_at" }, enabled, retry: false });
  return (
    <Card data-testid="customer-tickets">
      <CardHeader actions={enabled ? <Button asChild size="sm" variant="ghost"><Link to={`/service-requests?customer_id=${customerId}`}>All</Link></Button> : undefined}>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="size-4 text-navy-700" aria-hidden="true" /> Service tickets
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!enabled && <p className="px-4 py-3 text-xs text-ink-subtle">Tickets are hidden for your role.</p>}
        {enabled && tickets.isPending && <Skeleton className="m-4 h-20" />}
        {enabled && tickets.isError && <p className="px-4 py-3 text-xs text-ink-subtle">Could not load tickets.</p>}
        {tickets.data && tickets.data.items.length === 0 && <EmptyState compact title="No tickets" />}
        {tickets.data && tickets.data.items.length > 0 && (
          <ul className="divide-y divide-border">
            {tickets.data.items.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <Link to={`/service-requests/${ticket.id}`} className="block truncate font-medium text-navy-950 hover:underline">
                    {ticket.subject}
                  </Link>
                  <p className="truncate text-2xs text-ink-subtle">
                    {ticket.ticket_number} · {ticket.category_name} · {formatRelativeOrDate(ticket.created_at)}
                  </p>
                </div>
                {ticket.is_sla_breached && <Badge variant="danger">SLA</Badge>}
                <StatusChip status={ticket.status} label={SERVICE_STATUS_LABELS[ticket.status]} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatRelativeOrDate(value: string): string {
  return formatDateTime(value);
}

function LeadsCard({ customer, count }: { customer: Customer360Response["customer"]; count: number }) {
  const { can } = useAuth();
  const enabled = can("lead.read");
  const [leadId, setLeadId] = useState<string | null>(null);
  const leads = useApiQuery<ListEnvelope<LeadRow>>([LEADS_PATH, "customer", customer.id], LEADS_PATH, { query: { search: customer.phone, page_size: 20, sort: "-created_at" }, enabled, retry: false });
  const rows = useMemo(() => (leads.data?.items ?? []).filter((lead) => lead.customer_id === customer.id || lead.phone === customer.phone), [leads.data, customer.id, customer.phone]);
  return (
    <Card data-testid="customer-leads">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-4 text-navy-700" aria-hidden="true" /> Leads history <span className="money text-xs font-normal text-ink-subtle">{formatNumber(Math.max(count, rows.length))}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!enabled && <p className="px-4 py-3 text-xs text-ink-subtle">Leads are hidden for your role.</p>}
        {enabled && leads.isPending && <Skeleton className="m-4 h-16" />}
        {leads.data && rows.length === 0 && <EmptyState compact title="No leads linked" description="Leads converted into this customer, or with the same phone, show here." />}
        {rows.length > 0 && (
          <ul className="divide-y divide-border">
            {rows.map((lead) => (
              <li key={lead.id}>
                <button type="button" onClick={() => setLeadId(lead.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-navy-50/60 focus-ring-inset">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-navy-950">
                      {lead.lead_number} · {lead.project_name ?? "No project"}
                    </p>
                    <p className="truncate text-2xs text-ink-subtle">
                      {LEAD_SOURCE_LABELS[lead.source]} · {formatDate(lead.created_at)}
                      {lead.assigned_user_name ? ` · ${lead.assigned_user_name}` : ""}
                    </p>
                  </div>
                  <StatusChip status={lead.stage} label={LEAD_STAGE_LABELS[lead.stage]} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <LeadDrawer leadId={leadId} onClose={() => setLeadId(null)} />
    </Card>
  );
}

function HistoryCard({ customerId }: { customerId: string }) {
  const { can } = useAuth();
  const enabled = can("audit.view"); // GET /audit-logs is guarded by audit.view only
  const audit = useApiQuery<ListEnvelope<AuditLogRow>>([AUDIT_PATH, "customer", customerId], AUDIT_PATH, { query: { entity_type: "customer", entity_id: customerId, page_size: 50, sort: "-created_at" }, enabled, retry: false });
  const items: TimelineItem[] = (audit.data?.items ?? []).map((row) => ({
    id: row.id,
    title: humanize(row.action.replace(/^customer\./, "")),
    at: row.created_at,
    actor: row.actor_name ?? (row.actor_type === "SYSTEM" ? "System" : row.actor_type === "CUSTOMER" ? "Customer (portal)" : null),
    tone: row.action.includes("kyc") ? "gold" : row.action.includes("portal") ? "info" : row.action.includes("deactivate") ? "danger" : "neutral",
    description: row.after && Object.keys(row.after).length > 0 ? `${Object.keys(row.after).slice(0, 6).join(", ")}${Object.keys(row.after).length > 6 ? "…" : ""}` : undefined,
  }));
  return (
    <Card data-testid="customer-history">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-navy-700" aria-hidden="true" /> History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!enabled && <p className="text-xs text-ink-subtle">History is hidden for your role.</p>}
        {enabled && audit.isPending && <Skeleton className="h-24" />}
        {enabled && audit.isError && <p className="text-xs text-ink-subtle">Audit history unavailable.</p>}
        {audit.data && items.length === 0 && <p className="text-xs text-ink-subtle">No changes recorded yet.</p>}
        {items.length > 0 && <Timeline items={items} />}
      </CardContent>
    </Card>
  );
}
