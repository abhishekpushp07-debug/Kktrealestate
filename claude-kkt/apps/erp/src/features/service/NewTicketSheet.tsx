import { Paperclip, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { SERVICE_PRIORITIES, SERVICE_PRIORITY_LABELS, ServiceRequestCreateSchema, type DocumentRow, type ServicePriority, type ServiceRequestRow } from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, Combobox, FormError, FormField, FormRow, Input, Select, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { searchCustomers } from "@/features/crm/api";
import { UploadDocumentDialog } from "@/features/inventory/DocumentsPanel";
import { controlOf } from "@/features/inventory/components";
import { contractResolver } from "@/features/shared/contractResolver";
import { useUserOptions } from "@/features/shared/options";
import { SERVICE_PATH, serviceInvalidations, useCustomerBookings, useServiceCategories } from "./api";

interface TicketValues {
  customer_id: string | null;
  booking_id: string | null;
  category_id: string | null;
  priority: ServicePriority | null;
  subject: string;
  description: string;
  attachment_ids: string[];
  assignee_user_id: string | null;
}

const FormSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as TicketValues;
    return {
      customer_id: values.customer_id,
      booking_id: values.booking_id || null,
      category_id: values.category_id,
      priority: values.priority ?? undefined,
      subject: values.subject.trim(),
      description: values.description.trim(),
      attachment_ids: values.attachment_ids,
      assignee_user_id: values.assignee_user_id || null,
    };
  })
  .pipe(ServiceRequestCreateSchema);

const EMPTY: TicketValues = { customer_id: null, booking_id: null, category_id: null, priority: null, subject: "", description: "", attachment_ids: [], assignee_user_id: null };

export interface NewTicketSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a customer (customer 360 → "Raise ticket"). */
  customerId?: string | null;
  customerLabel?: string | null;
}

/** Staff raises a ticket on behalf of a customer: customer → booking → category → priority → subject → description → attachments. */
export function NewTicketSheet({ open, onOpenChange, customerId = null, customerLabel = null }: NewTicketSheetProps) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canAssign = can("service.assign");
  const resolver = useMemo(() => contractResolver<TicketValues, unknown>(FormSchema), []);
  const form = useForm<TicketValues, unknown, unknown>({ resolver, defaultValues: { ...EMPTY, customer_id: customerId }, mode: "onTouched" });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);
  const [customerName, setCustomerName] = useState<string | null>(customerLabel);
  const [attachments, setAttachments] = useState<DocumentRow[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const selectedCustomer = useWatch({ control, name: "customer_id" });
  const selectedCategory = useWatch({ control, name: "category_id" });
  const bookings = useCustomerBookings(selectedCustomer);
  const categories = useServiceCategories(open);
  const users = useUserOptions(open && canAssign);

  useEffect(() => {
    if (!open) {
      form.reset({ ...EMPTY, customer_id: customerId });
      setAttachments([]);
      setServerError(null);
      setCustomerName(customerLabel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Category default priority pre-fills the priority field until the user changes it.
  useEffect(() => {
    const category = categories.data?.find((row) => row.id === selectedCategory);
    if (category && !form.getFieldState("priority").isDirty) form.setValue("priority", category.default_priority);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, categories.data]);

  const create = useMutationWithToast<ServiceRequestRow, unknown>({
    mutationFn: (body) => api.post<ServiceRequestRow>(SERVICE_PATH, body),
    successMessage: (ticket) => `Ticket ${ticket.ticket_number} created`,
    invalidate: serviceInvalidations(),
    errorMessage: false,
    onError: (error) => {
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
    onSuccess: (ticket) => {
      onOpenChange(false);
      navigate(`/service-requests/${ticket.id}`);
    },
  });

  const bookingOptions = (bookings.data ?? []).map((booking) => ({
    value: booking.id,
    label: `${booking.booking_number} · ${booking.project_name} ${booking.flat_number}`,
    description: `${booking.block_name} · booked ${formatDate(booking.booking_date)} · ${booking.status}`,
  }));
  const categoryOptions = (categories.data ?? []).map((row) => ({ value: row.id, label: row.name, description: `Default priority ${SERVICE_PRIORITY_LABELS[row.default_priority]}` }));
  const userOptions = (users.data ?? []).filter((user) => user.is_active).map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] }));

  const removeAttachment = (id: string) => {
    setAttachments((rows) => rows.filter((row) => row.id !== id));
    form.setValue("attachment_ids", form.getValues("attachment_ids").filter((item) => item !== id));
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>New service request</SheetTitle>
          <SheetDescription>Raised on behalf of the customer; they see it in the portal (internal notes excepted).</SheetDescription>
        </SheetHeader>
        <form
          id="new-ticket-form"
          noValidate
          className="contents"
          onSubmit={form.handleSubmit((output) => {
            setServerError(null);
            create.mutate(output);
          })}
        >
          <SheetBody className="space-y-4">
            <FormError error={serverError} />
            <FormField
              control={control}
              name="customer_id"
              label="Customer"
              required
              render={({ field }) => (
                <Combobox
                  id={field.id}
                  value={field.value}
                  onValueChange={(value, option) => {
                    field.onChange(value);
                    setCustomerName(option?.label ?? null);
                    form.setValue("booking_id", null);
                    setAttachments([]);
                    form.setValue("attachment_ids", []);
                  }}
                  onSearch={searchCustomers}
                  selectedLabel={customerName ?? undefined}
                  placeholder="Search by name, phone or code…"
                  searchPlaceholder="Type a phone number or name"
                  invalid={field.invalid}
                  allowClear
                  data-testid="ticket-customer"
                />
              )}
            />
            <FormField
              control={control}
              name="booking_id"
              label="Booking"
              hint={selectedCustomer ? (bookings.data && bookings.data.length === 0 ? "This customer has no bookings; the ticket is filed without one." : undefined) : "Pick a customer first"}
              render={({ field }) => (
                <Select id={field.id} value={field.value} onValueChange={field.onChange} options={bookingOptions} placeholder={bookings.isPending && selectedCustomer ? "Loading bookings…" : "Optional"} disabled={!selectedCustomer || bookingOptions.length === 0} allowClear invalid={field.invalid} data-testid="ticket-booking" />
              )}
            />
            <FormRow>
              <FormField control={control} name="category_id" label="Category" required render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={categoryOptions} placeholder={categories.isPending ? "Loading…" : "Select category"} invalid={field.invalid} data-testid="ticket-category" />} />
              <FormField control={control} name="priority" label="Priority" hint="Defaults from the category" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={SERVICE_PRIORITIES.map((value) => ({ value, label: SERVICE_PRIORITY_LABELS[value] }))} placeholder="Category default" allowClear invalid={field.invalid} data-testid="ticket-priority" />} />
            </FormRow>
            <FormField control={control} name="subject" label="Subject" required render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} maxLength={200} placeholder="Short summary (3–200 characters)" invalid={field.invalid} data-testid="ticket-subject" />} />
            <FormField control={control} name="description" label="Description" required render={({ field }) => <Textarea id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} rows={5} maxLength={2000} placeholder="What does the customer need? Include flat, dates and amounts where relevant." invalid={field.invalid} data-testid="ticket-description" />} />
            {canAssign && (
              <FormField control={control} name="assignee_user_id" label="Assign to" render={({ field }) => <Combobox id={field.id} value={field.value} onValueChange={(value) => field.onChange(value)} options={userOptions} placeholder="Unassigned" allowClear invalid={field.invalid} data-testid="ticket-assignee" />} />
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">Attachments</span>
                <Button type="button" size="sm" variant="outline" leftIcon={Paperclip} disabled={!selectedCustomer || attachments.length >= 10} onClick={() => setUploadOpen(true)} data-testid="ticket-attach-btn">
                  Attach file
                </Button>
              </div>
              {!selectedCustomer && <p className="text-xs text-ink-subtle">Files are stored against the customer; pick one to attach.</p>}
              {attachments.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {attachments.map((doc) => (
                    <li key={doc.id}>
                      <Badge variant="outline" className="gap-1 pr-1">
                        <Paperclip className="size-3" aria-hidden="true" />
                        <span className="max-w-40 truncate">{doc.title || doc.file_name}</span>
                        <button type="button" aria-label={`Remove ${doc.file_name}`} className="rounded-full p-0.5 hover:bg-navy-50 focus-ring" onClick={() => removeAttachment(doc.id)}>
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" leftIcon={Send} loading={create.isPending} data-testid="ticket-submit">
              Create ticket
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      {selectedCustomer && (
        <UploadDocumentDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          entityType="CUSTOMER"
          entityId={selectedCustomer}
          appliesTo="CUSTOMER"
          allowShare={false}
          title="Attach to ticket"
          onUploaded={(doc) => {
            setAttachments((rows) => [...rows, doc]);
            form.setValue("attachment_ids", [...form.getValues("attachment_ids"), doc.id]);
          }}
        />
      )}
    </Sheet>
  );
}
