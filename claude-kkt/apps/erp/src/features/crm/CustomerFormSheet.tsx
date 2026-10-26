import { X } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { CustomerCreateSchema, CustomerUpdateSchema, GENDERS, LEAD_SOURCES, LEAD_SOURCE_LABELS, type CustomerRow } from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, Combobox, DateInput, FormError, FormField, FormRow, FormSection, Input, Select, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Switch, Textarea } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { formatDateTime, formatPhone } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { toast } from "sonner";
import { Notice } from "@/features/inventory/components";
import { useSalesUserOptions } from "@/features/inventory/api";
import { contractResolver } from "@/features/shared/contractResolver";
import { CUSTOMERS_PATH } from "./api";
import { IFSC_REGEX, isValidAadhaar, PAN_REGEX, PHONE_REGEX, formatAadhaar, normaliseIndianPhone } from "./verhoeff";

interface AddressValues {
  line1: string;
  line2: string;
  locality: string;
  city: string;
  state: string;
  pincode: string;
}

export interface CustomerValues {
  salutation: string;
  full_name: string;
  father_or_spouse_name: string;
  dob: string | null;
  gender: string | null;
  phone: string;
  alt_phone: string;
  email: string;
  address_current: AddressValues;
  same_as_current: boolean;
  address_permanent: AddressValues;
  occupation: string;
  company_name: string;
  income_band: string;
  source: string | null;
  relationship_manager_id: string | null;
  pan: string;
  aadhaar: string;
  bank: { bank_name: string; ifsc: string; holder_name: string; account_number: string };
  nominee: { name: string; relation: string; phone: string; dob: string | null };
  tags: string[];
  notes: string;
}

const emptyAddress = (): AddressValues => ({ line1: "", line2: "", locality: "", city: "", state: "", pincode: "" });
const nullable = (value: string): string | null => (value.trim() === "" ? null : value.trim());
const addressFilled = (address: AddressValues): boolean => Object.values(address).some((value) => value.trim() !== "");
const toAddress = (address: AddressValues) => ({ line1: address.line1, line2: nullable(address.line2), locality: nullable(address.locality), city: address.city, state: address.state, pincode: address.pincode });

export const INCOME_BANDS = ["< ₹5 L", "₹5–10 L", "₹10–25 L", "₹25–50 L", "₹50 L – 1 Cr", "> ₹1 Cr"] as const;

/** UI state → wire payload with client-side KYC checks (Verhoeff, PAN, IFSC) layered before the contract. */
function buildSchema() {
  return z
    .looseObject({})
    .transform((raw): unknown => {
      const values = raw as unknown as CustomerValues;
      const bankFilled = Object.values(values.bank).some((value) => value.trim() !== "");
      const nomineeFilled = values.nominee.name.trim() !== "" || values.nominee.relation.trim() !== "";
      return {
        salutation: nullable(values.salutation),
        full_name: values.full_name,
        father_or_spouse_name: nullable(values.father_or_spouse_name),
        dob: values.dob,
        gender: values.gender,
        phone: normaliseIndianPhone(values.phone),
        alt_phone: values.alt_phone.trim() ? normaliseIndianPhone(values.alt_phone) : null,
        email: nullable(values.email),
        address_current: addressFilled(values.address_current) ? toAddress(values.address_current) : null,
        same_as_current: values.same_as_current,
        address_permanent: values.same_as_current ? null : addressFilled(values.address_permanent) ? toAddress(values.address_permanent) : null,
        occupation: nullable(values.occupation),
        company_name: nullable(values.company_name),
        income_band: nullable(values.income_band),
        source: values.source,
        relationship_manager_id: values.relationship_manager_id,
        pan: nullable(values.pan.toUpperCase()),
        aadhaar: values.aadhaar.replace(/\s+/g, "") || null,
        bank: bankFilled ? { bank_name: values.bank.bank_name, ifsc: values.bank.ifsc.toUpperCase(), holder_name: values.bank.holder_name, account_number: values.bank.account_number.replace(/\s+/g, "") } : null,
        nominee: nomineeFilled ? { name: values.nominee.name, relation: values.nominee.relation, phone: values.nominee.phone.trim() ? normaliseIndianPhone(values.nominee.phone) : null, dob: values.nominee.dob } : null,
        co_applicants: [],
        notes: nullable(values.notes),
        tags: values.tags,
      };
    })
    .superRefine((value, ctx) => {
      const record = value as { aadhaar: string | null; pan: string | null; bank: { ifsc: string } | null };
      if (record.aadhaar && !isValidAadhaar(record.aadhaar)) ctx.addIssue({ code: "custom", path: ["aadhaar"], message: "Aadhaar checksum is invalid (Verhoeff)" });
      if (record.pan && !PAN_REGEX.test(record.pan)) ctx.addIssue({ code: "custom", path: ["pan"], message: "PAN must look like ABCDE1234F" });
      if (record.bank && !IFSC_REGEX.test(record.bank.ifsc)) ctx.addIssue({ code: "custom", path: ["bank", "ifsc"], message: "IFSC must look like HDFC0001234" });
    });
}

const CreateSchema = buildSchema().pipe(CustomerCreateSchema);
const EditSchema = buildSchema().pipe(CustomerUpdateSchema.omit({ version: true }));

export function defaultCustomerValues(seed: Partial<Pick<CustomerValues, "full_name" | "phone" | "email" | "source">> = {}): CustomerValues {
  return {
    salutation: "",
    full_name: seed.full_name ?? "",
    father_or_spouse_name: "",
    dob: null,
    gender: null,
    phone: seed.phone ?? "",
    alt_phone: "",
    email: seed.email ?? "",
    address_current: emptyAddress(),
    same_as_current: true,
    address_permanent: emptyAddress(),
    occupation: "",
    company_name: "",
    income_band: "",
    source: seed.source ?? "WALK_IN",
    relationship_manager_id: null,
    pan: "",
    aadhaar: "",
    bank: { bank_name: "", ifsc: "", holder_name: "", account_number: "" },
    nominee: { name: "", relation: "", phone: "", dob: null },
    tags: [],
    notes: "",
  };
}

export function customerToValues(customer: CustomerRow): CustomerValues {
  const address = (value: CustomerRow["address_current"]): AddressValues => (value ? { line1: value.line1, line2: value.line2 ?? "", locality: value.locality ?? "", city: value.city, state: value.state, pincode: value.pincode } : emptyAddress());
  return {
    salutation: customer.salutation ?? "",
    full_name: customer.full_name,
    father_or_spouse_name: customer.father_or_spouse_name ?? "",
    dob: customer.dob,
    gender: customer.gender,
    phone: customer.phone,
    alt_phone: customer.alt_phone ?? "",
    email: customer.email ?? "",
    address_current: address(customer.address_current),
    same_as_current: customer.same_as_current,
    address_permanent: address(customer.address_permanent),
    occupation: customer.occupation ?? "",
    company_name: customer.company_name ?? "",
    income_band: customer.income_band ?? "",
    source: customer.source,
    relationship_manager_id: customer.relationship_manager_id,
    // Masked KYC is never echoed back into the inputs: blank = keep as is.
    pan: "",
    aadhaar: "",
    bank: customer.bank ? { bank_name: customer.bank.bank_name, ifsc: customer.bank.ifsc, holder_name: customer.bank.holder_name, account_number: "" } : { bank_name: "", ifsc: "", holder_name: "", account_number: "" },
    nominee: customer.nominee ? { name: customer.nominee.name, relation: customer.nominee.relation, phone: customer.nominee.phone ?? "", dob: customer.nominee.dob } : { name: "", relation: "", phone: "", dob: null },
    tags: [...customer.tags],
    notes: customer.notes ?? "",
  };
}

/** Removes untouched masked-KYC fields from an edit payload so the server keeps the stored values. */
function stripUntouchedKyc(body: Record<string, unknown>, customer: CustomerRow): Record<string, unknown> {
  const next = { ...body };
  if (next.pan === null && customer.pan_masked) delete next.pan;
  if (next.aadhaar === null && customer.aadhaar_masked) delete next.aadhaar;
  const bank = next.bank as { account_number?: string } | null | undefined;
  if (customer.bank && (bank === null || bank === undefined || !bank.account_number)) delete next.bank;
  return next;
}

export interface CustomerFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerRow | null;
  seed?: Partial<Pick<CustomerValues, "full_name" | "phone" | "email" | "source">>;
  onSaved?: (customer: CustomerRow) => void;
}

/** Create / edit a customer: identity, contact, addresses, profile, KYC (PAN/Aadhaar/bank), nominee, tags. */
export function CustomerFormSheet({ open, onOpenChange, customer, seed, onSaved }: CustomerFormSheetProps) {
  const mode = customer ? "edit" : "create";
  const schema = mode === "edit" ? EditSchema : CreateSchema;
  const resolver = useMemo(() => contractResolver<CustomerValues, unknown>(schema), [schema]);
  const form = useForm<CustomerValues, unknown, unknown>({ resolver, defaultValues: customer ? customerToValues(customer) : defaultCustomerValues(seed), mode: "onTouched" });
  const [serverError, setServerError] = useState<unknown>(null);

  const customerId = customer?.id ?? null;
  const customerVersion = customer?.version ?? null;
  useEffect(() => {
    if (!open) return;
    form.reset(customer ? customerToValues(customer) : defaultCustomerValues(seed));
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId, customerVersion]);

  const handleError = (error: ApiClientError) => {
    if (error.isVersionConflict) return;
    if (!applyServerErrors(error, form.setError)) setServerError(error);
  };

  const create = useMutationWithToast<CustomerRow, unknown>({
    mutationFn: (body) => api.post<CustomerRow>(CUSTOMERS_PATH, body),
    successMessage: (saved) => `${saved.full_name} created (${saved.customer_code})`,
    invalidate: [[CUSTOMERS_PATH]],
    errorMessage: false,
    onSuccess: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: handleError,
  });
  const update = useMutationWithToast<CustomerRow, { row: CustomerRow; body: unknown }>({
    mutationFn: ({ row, body }) => api.patch<CustomerRow>(`${CUSTOMERS_PATH}/${row.id}`, { ...stripUntouchedKyc(body as Record<string, unknown>, row), version: row.version }, { version: row.version }),
    successMessage: (saved) => `${saved.full_name} saved`,
    invalidate: [[CUSTOMERS_PATH]],
    entityLabel: "This customer",
    errorMessage: false,
    onSuccess: (saved, { row }) => {
      if (kycResetByEdit(row.kyc_status, saved.kyc_status)) toast.warning(`PAN / Aadhaar changed: KYC is back to Pending and must be submitted and verified again.`);
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: handleError,
  });
  const busy = create.isPending || update.isPending;

  const submit = (output: unknown) => {
    setServerError(null);
    if (customer) update.mutate({ row: customer, body: output });
    else create.mutate(output);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent size="lg" data-testid="customer-form-sheet">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{mode === "create" ? "New customer" : "Edit customer"}</SheetTitle>
            {customer && (
              <Badge variant="outline" numeric>
                v{customer.version}
              </Badge>
            )}
          </div>
          <SheetDescription>{customer ? `${customer.customer_code} · updated ${formatDateTime(customer.updated_at)}` : "PAN, Aadhaar and bank details are encrypted at rest and shown masked afterwards."}</SheetDescription>
        </SheetHeader>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="space-y-6">
              {serverError !== null && <FormError error={serverError} />}
              <CustomerFields open={open} customer={customer} />
            </SheetBody>
            <SheetFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} data-testid="customer-form-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={busy} data-testid="customer-form-submit">
                {mode === "create" ? "Create customer" : "Save changes"}
              </Button>
            </SheetFooter>
          </form>
        </FormProvider>
      </SheetContent>
    </Sheet>
  );
}

function AddressFields({ prefix, disabled = false }: { prefix: "address_current" | "address_permanent"; disabled?: boolean }) {
  const { control } = useFormContext<CustomerValues>();
  return (
    <FormRow columns={2}>
      <FormField control={control} name={`${prefix}.line1`} label="Line 1" className="sm:col-span-2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={200} disabled={disabled} />} />
      <FormField control={control} name={`${prefix}.line2`} label="Line 2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={200} disabled={disabled} />} />
      <FormField control={control} name={`${prefix}.locality`} label="Locality" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} disabled={disabled} />} />
      <FormField control={control} name={`${prefix}.city`} label="City" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={80} disabled={disabled} />} />
      <FormField control={control} name={`${prefix}.state`} label="State" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={80} disabled={disabled} />} />
      <FormField control={control} name={`${prefix}.pincode`} label="PIN code" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} className="money" disabled={disabled} />} />
    </FormRow>
  );
}

function TagsInput({ value, onChange, id }: { value: string[]; onChange: (tags: string[]) => void; id: string }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const tag = draft.trim().slice(0, 30);
    if (tag && !value.includes(tag) && value.length < 20) onChange([...value, tag]);
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Backspace" && draft === "" && value.length > 0) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-border-strong bg-card px-2 py-1 focus-within:border-gold">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-sm border border-navy-100 bg-navy-50 px-1.5 py-0.5 text-xs font-medium text-navy-950">
          {tag}
          <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(value.filter((item) => item !== tag))} className="rounded-full hover:bg-navy-100">
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input id={id} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={commit} placeholder={value.length ? "" : "Type a tag and press Enter"} className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle" maxLength={30} data-testid="customer-tags-input" />
    </div>
  );
}

/** KYC states in which a PAN / Aadhaar change sends the file back to PENDING (server rule, security track). */
export function kycLocksIdentifiers(status: string): boolean {
  return status === "SUBMITTED" || status === "VERIFIED";
}

/** True when a save turned a submitted / verified KYC back to PENDING. */
export function kycResetByEdit(before: string, after: string): boolean {
  return kycLocksIdentifiers(before) && after === "PENDING";
}

function CustomerFields({ open, customer }: { open: boolean; customer: CustomerRow | null }) {
  const { control, watch } = useFormContext<CustomerValues>();
  const sameAsCurrent = watch("same_as_current");
  const phone = watch("phone");
  const pan = watch("pan");
  const aadhaar = watch("aadhaar");
  const ifsc = watch("bank.ifsc");
  const users = useSalesUserOptions(open);
  const rmOptions = useMemo(() => (users.data ?? []).filter((user) => user.is_active).map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] })), [users.data]);

  const normalisedPhone = normaliseIndianPhone(phone);
  const phoneOk = PHONE_REGEX.test(normalisedPhone);
  const panUpper = pan.toUpperCase();
  const panState = pan === "" ? null : PAN_REGEX.test(panUpper);
  const aadhaarDigits = aadhaar.replace(/\s+/g, "");
  const aadhaarState = aadhaarDigits === "" ? null : aadhaarDigits.length === 12 ? isValidAadhaar(aadhaarDigits) : false;
  const ifscState = ifsc === "" ? null : IFSC_REGEX.test(ifsc.toUpperCase());

  const stateHint = (state: boolean | null, ok: string, bad: string, masked?: string | null) => {
    if (state === null) return masked ? `Stored: ${masked} (leave blank to keep)` : undefined;
    return state ? ok : bad;
  };

  return (
    <>
      <FormSection title="Identity">
        <FormRow columns={4}>
          <FormField control={control} name="salutation" label="Salutation" render={({ field }) => <Select id={field.id} value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")} options={["Mr", "Mrs", "Ms", "Dr", "M/s"].map((value) => ({ value, label: value }))} placeholder="—" allowClear />} />
          <FormField control={control} name="full_name" label="Full name" required className="sm:col-span-3" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} autoComplete="off" data-testid="customer-name" />} />
          <FormField control={control} name="father_or_spouse_name" label="Father / spouse name" className="sm:col-span-2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} />} />
          <FormField control={control} name="dob" label="Date of birth" render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />} />
          <FormField control={control} name="gender" label="Gender" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={GENDERS.map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }))} placeholder="—" allowClear />} />
        </FormRow>
      </FormSection>

      <FormSection title="Contact">
        <FormRow columns={3}>
          <FormField control={control} name="phone" label="Mobile" required hint={phone ? (phoneOk ? `Will be stored as ${formatPhone(normalisedPhone)}` : "10 digits starting 6–9; +91 and 0 are dropped") : "10-digit Indian mobile"} render={({ field }) => <Input {...field} type="tel" value={field.value} onChange={(event) => field.onChange(event.target.value)} inputMode="tel" maxLength={16} className="money" autoComplete="off" data-testid="customer-phone" />} />
          <FormField control={control} name="alt_phone" label="Alternate mobile" render={({ field }) => <Input {...field} type="tel" value={field.value} onChange={(event) => field.onChange(event.target.value)} inputMode="tel" maxLength={16} className="money" autoComplete="off" />} />
          <FormField control={control} name="email" label="E-mail" render={({ field }) => <Input {...field} type="email" value={field.value} onChange={(event) => field.onChange(event.target.value)} inputMode="email" maxLength={254} autoComplete="off" />} />
        </FormRow>
      </FormSection>

      <FormSection title="Current address">
        <AddressFields prefix="address_current" />
      </FormSection>
      <FormSection title="Permanent address">
        <FormField control={control} name="same_as_current" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Same as current address" data-testid="customer-same-address" />} />
        {!sameAsCurrent && <AddressFields prefix="address_permanent" />}
      </FormSection>

      <FormSection title="Profile">
        <FormRow columns={2}>
          <FormField control={control} name="occupation" label="Occupation" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={80} />} />
          <FormField control={control} name="company_name" label="Company" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} />} />
          <FormField control={control} name="income_band" label="Income band" render={({ field }) => <Select id={field.id} value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")} options={INCOME_BANDS.map((value) => ({ value, label: value }))} placeholder="—" allowClear />} />
          <FormField control={control} name="source" label="Source" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={LEAD_SOURCES.map((value) => ({ value, label: LEAD_SOURCE_LABELS[value] }))} placeholder="—" allowClear />} />
          <FormField control={control} name="relationship_manager_id" label="Relationship manager" className="sm:col-span-2" hint={users.isError ? "Could not load users" : "Sales user who owns this customer"} render={({ field }) => <Combobox id={field.id} value={field.value} onValueChange={(value) => field.onChange(value)} options={rmOptions} placeholder={users.isPending ? "Loading…" : "Pick a sales user"} allowClear data-testid="customer-rm" />} />
        </FormRow>
      </FormSection>

      <FormSection title="KYC" description="Validated here, encrypted on the server, masked afterwards. Leave blank when editing to keep the stored value.">
        <FormRow columns={2}>
          <FormField
            control={control}
            name="pan"
            label="PAN"
            hint={stateHint(panState, "Valid PAN format", "Format ABCDE1234F", customer?.pan_masked)}
            render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} maxLength={10} className={`font-mono uppercase ${panState === false ? "border-danger" : panState ? "border-success" : ""}`} autoComplete="off" placeholder={customer?.pan_masked ?? "ABCDE1234F"} data-testid="customer-pan" />}
          />
          <FormField
            control={control}
            name="aadhaar"
            label="Aadhaar"
            hint={stateHint(aadhaarState, "Checksum valid (Verhoeff)", aadhaarDigits.length === 12 ? "Checksum failed — re-check the digits" : "12 digits", customer?.aadhaar_masked)}
            render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(formatAadhaar(event.target.value))} inputMode="numeric" maxLength={14} className={`money font-mono ${aadhaarState === false ? "border-danger" : aadhaarState ? "border-success" : ""}`} autoComplete="off" placeholder={customer?.aadhaar_masked ?? "1234 5678 9012"} data-testid="customer-aadhaar" />}
          />
        </FormRow>
        {customer && kycLocksIdentifiers(customer.kyc_status) && (pan !== "" || aadhaarDigits !== "") && (
          <Notice tone="warning" data-testid="customer-kyc-reset-warning">
            Changing PAN or Aadhaar resets KYC from {customer.kyc_status === "VERIFIED" ? "Verified" : "Submitted"} to Pending; it then has to be submitted and verified again.
          </Notice>
        )}
        <FormRow columns={2}>
          <FormField control={control} name="bank.bank_name" label="Bank" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} />} />
          <FormField control={control} name="bank.ifsc" label="IFSC" hint={stateHint(ifscState, "Valid IFSC", "Format HDFC0001234")} render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))} maxLength={11} className={`font-mono uppercase ${ifscState === false ? "border-danger" : ifscState ? "border-success" : ""}`} autoComplete="off" />} />
          <FormField control={control} name="bank.holder_name" label="Account holder" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} />} />
          <FormField control={control} name="bank.account_number" label="Account number" hint={customer?.bank ? `Stored: ${customer.bank.bank_account_masked} (leave blank to keep)` : "9–18 digits"} render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.replace(/\D/g, "").slice(0, 18))} inputMode="numeric" maxLength={18} className="money font-mono" autoComplete="off" placeholder={customer?.bank?.bank_account_masked ?? undefined} />} />
        </FormRow>
      </FormSection>

      <FormSection title="Nominee">
        <FormRow columns={4}>
          <FormField control={control} name="nominee.name" label="Name" className="sm:col-span-2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} />} />
          <FormField control={control} name="nominee.relation" label="Relation" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={40} placeholder="Spouse" />} />
          <FormField control={control} name="nominee.dob" label="Date of birth" render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />} />
          <FormField control={control} name="nominee.phone" label="Mobile" className="sm:col-span-2" render={({ field }) => <Input {...field} type="tel" value={field.value} onChange={(event) => field.onChange(event.target.value)} inputMode="tel" maxLength={16} className="money" />} />
        </FormRow>
      </FormSection>

      <FormSection title="Tags & notes">
        <FormField control={control} name="tags" label="Tags" hint="Enter or comma to add; up to 20" render={({ field }) => <TagsInput id={field.id} value={field.value} onChange={field.onChange} />} />
        <FormField control={control} name="notes" label="Notes" render={({ field }) => <Textarea {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} rows={3} maxLength={2000} />} />
      </FormSection>
    </>
  );
}
