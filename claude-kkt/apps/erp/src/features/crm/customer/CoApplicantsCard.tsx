import { Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { CoApplicantInputSchema, type CoApplicantRow, type CustomerRow } from "@kkt/contracts";
import { z } from "zod";
import {
  applyServerErrors,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  FormError,
  FormField,
  FormRow,
  IconButton,
  Input,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatPhone } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { controlOf } from "@/features/inventory/components";
import { contractResolver } from "@/features/shared/contractResolver";
import { CUSTOMERS_PATH, crmKeys } from "../api";
import { formatAadhaar, isValidAadhaar, normaliseIndianPhone, PAN_REGEX } from "../verhoeff";
import { useOnChange } from "@/lib/utils";

interface CoApplicantValues {
  full_name: string;
  relation: string;
  phone: string;
  email: string;
  pan: string;
  aadhaar: string;
}

const FormSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as CoApplicantValues;
    return {
      full_name: values.full_name,
      relation: values.relation,
      phone: values.phone.trim() ? normaliseIndianPhone(values.phone) : null,
      email: values.email.trim() || null,
      pan: values.pan.trim() ? values.pan.toUpperCase() : null,
      aadhaar: values.aadhaar.replace(/\s+/g, "") || null,
    };
  })
  .superRefine((value, ctx) => {
    const record = value as { pan: string | null; aadhaar: string | null };
    if (record.pan && !PAN_REGEX.test(record.pan))
      ctx.addIssue({ code: "custom", path: ["pan"], message: "PAN must look like ABCDE1234F" });
    if (record.aadhaar && !isValidAadhaar(record.aadhaar))
      ctx.addIssue({ code: "custom", path: ["aadhaar"], message: "Aadhaar checksum is invalid" });
  })
  .pipe(CoApplicantInputSchema.omit({ id: true }));

const empty = (): CoApplicantValues => ({ full_name: "", relation: "", phone: "", email: "", pan: "", aadhaar: "" });

export function CoApplicantsCard({ customer }: { customer: CustomerRow }) {
  const { can } = useAuth();
  // An erased customer takes no new personal data (422 CUSTOMER_ERASED): hide add / edit / remove.
  const canWrite = can("customer.write") && !customer.erased_at;
  const [editing, setEditing] = useState<{ open: boolean; row: CoApplicantRow | null }>({ open: false, row: null });
  const [removing, setRemoving] = useState<CoApplicantRow | null>(null);
  const path = `${CUSTOMERS_PATH}/${customer.id}/co-applicants`;
  const invalidate = [crmKeys.customer360(customer.id), [CUSTOMERS_PATH]];

  const remove = useMutationWithToast<void, CoApplicantRow>({
    // DELETE needs the row version (If-Match "v<n>", contract C6); a stale one is 409 VERSION_CONFLICT.
    mutationFn: (row) => api.delete(`${path}/${row.id}`, { version: row.version }),
    successMessage: (_data, row) => `${row.full_name} removed`,
    invalidate,
  });

  return (
    <Card data-testid="co-applicants-card">
      <CardHeader
        actions={
          canWrite ? (
            <Button
              size="sm"
              variant="outline"
              leftIcon={Plus}
              onClick={() => setEditing({ open: true, row: null })}
              data-testid="co-applicant-add"
            >
              Add
            </Button>
          ) : undefined
        }
      >
        <CardTitle>
          Co-applicants{" "}
          <span className="money ml-1 text-xs font-normal text-ink-subtle">{customer.co_applicants.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {customer.co_applicants.length === 0 ? (
          <EmptyState
            compact
            icon={UserPlus}
            title="No co-applicants"
            description="Joint buyers appear on the agreement and can access the portal."
          />
        ) : (
          <ul className="divide-y divide-border">
            {[...customer.co_applicants]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((person) => (
                <li key={person.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {person.full_name}{" "}
                      <span className="text-xs font-normal text-ink-subtle">· {person.relation}</span>
                    </p>
                    <p className="flex flex-wrap gap-x-3 text-2xs text-ink-subtle">
                      {person.phone && <span className="money">{formatPhone(person.phone)}</span>}
                      {person.email && <span>{person.email}</span>}
                      {person.pan_masked && <span className="font-mono">PAN {person.pan_masked}</span>}
                      {person.aadhaar_masked && <span className="font-mono">Aadhaar {person.aadhaar_masked}</span>}
                    </p>
                  </div>
                  {canWrite && (
                    <span className="flex shrink-0 gap-0.5">
                      <IconButton
                        icon={Pencil}
                        label={`Edit ${person.full_name}`}
                        size="sm"
                        onClick={() => setEditing({ open: true, row: person })}
                      />
                      <IconButton
                        icon={Trash2}
                        label={`Remove ${person.full_name}`}
                        size="sm"
                        onClick={() => setRemoving(person)}
                      />
                    </span>
                  )}
                </li>
              ))}
          </ul>
        )}
      </CardContent>
      <CoApplicantSheet
        customer={customer}
        row={editing.row}
        open={editing.open}
        onOpenChange={(open) => setEditing((state) => ({ ...state, open }))}
        path={path}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.full_name ?? "co-applicant"}?`}
        description="They are removed from this customer; existing agreements are not changed."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing);
        }}
      />
    </Card>
  );
}

function CoApplicantSheet({
  customer,
  row,
  open,
  onOpenChange,
  path,
}: {
  customer: CustomerRow;
  row: CoApplicantRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  path: string;
}) {
  const resolver = useMemo(() => contractResolver<CoApplicantValues, unknown>(FormSchema), []);
  const form = useForm<CoApplicantValues, unknown, unknown>({ resolver, defaultValues: empty(), mode: "onTouched" });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);
  const invalidate = [crmKeys.customer360(customer.id), [CUSTOMERS_PATH]];

  // Local state resets while rendering; react-hook-form's reset (an external store) stays in the effect below.
  useOnChange(open ? (row?.id ?? "new") : null, (key) => {
    if (key !== null) setServerError(null);
  });
  useEffect(() => {
    if (!open) return;
    form.reset(
      row
        ? {
            full_name: row.full_name,
            relation: row.relation,
            phone: row.phone ?? "",
            email: row.email ?? "",
            pan: "",
            aadhaar: "",
          }
        : empty(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed the form only when it opens or the row changes
  }, [open, row?.id]);

  const handleError = (error: ApiClientError) => {
    if (!applyServerErrors(error, form.setError)) setServerError(error);
  };
  const create = useMutationWithToast<CoApplicantRow, unknown>({
    mutationFn: (body) => api.post<CoApplicantRow>(path, body),
    successMessage: (saved) => `${saved.full_name} added`,
    invalidate,
    errorMessage: false,
    onSuccess: () => onOpenChange(false),
    onError: handleError,
  });
  const update = useMutationWithToast<CoApplicantRow, unknown>({
    mutationFn: (body) => {
      const payload = { ...(body as Record<string, unknown>) };
      // Blank masked KYC = keep stored values.
      if (payload.pan === null && row?.pan_masked) delete payload.pan;
      if (payload.aadhaar === null && row?.aadhaar_masked) delete payload.aadhaar;
      // The version policy needs the row version (body + If-Match); a stale one is 409 VERSION_CONFLICT.
      if (row) payload.version = row.version;
      return api.patch<CoApplicantRow>(`${path}/${row?.id}`, payload, row ? { version: row.version } : undefined);
    },
    successMessage: (saved) => `${saved.full_name} saved`,
    invalidate,
    errorMessage: false,
    onSuccess: () => onOpenChange(false),
    onError: handleError,
  });
  const busy = create.isPending || update.isPending;

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent size="md" data-testid="co-applicant-sheet">
        <SheetHeader>
          <SheetTitle>{row ? "Edit co-applicant" : "Add co-applicant"}</SheetTitle>
          <SheetDescription>
            KYC values are encrypted; leave PAN / Aadhaar blank to keep the stored ones.
          </SheetDescription>
        </SheetHeader>
        <form
          noValidate
          onSubmit={form.handleSubmit((output) => {
            setServerError(null);
            if (row) update.mutate(output);
            else create.mutate(output);
          })}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetBody className="space-y-4">
            {serverError !== null && <FormError error={serverError} />}
            <FormRow columns={2}>
              <FormField
                control={control}
                name="full_name"
                label="Full name"
                required
                className="sm:col-span-2"
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    maxLength={120}
                  />
                )}
              />
              <FormField
                control={control}
                name="relation"
                label="Relation"
                required
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    maxLength={40}
                    placeholder="Spouse"
                  />
                )}
              />
              <FormField
                control={control}
                name="phone"
                label="Mobile"
                render={({ field }) => (
                  <Input
                    {...field}
                    type="tel"
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    inputMode="tel"
                    maxLength={16}
                    className="money"
                  />
                )}
              />
              <FormField
                control={control}
                name="email"
                label="E-mail"
                className="sm:col-span-2"
                render={({ field }) => (
                  <Input
                    {...field}
                    type="email"
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    maxLength={254}
                  />
                )}
              />
              <FormField
                control={control}
                name="pan"
                label="PAN"
                hint={row?.pan_masked ? `Stored: ${row.pan_masked}` : undefined}
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, "")
                          .slice(0, 10),
                      )
                    }
                    maxLength={10}
                    className="font-mono uppercase"
                    placeholder={row?.pan_masked ?? "ABCDE1234F"}
                  />
                )}
              />
              <FormField
                control={control}
                name="aadhaar"
                label="Aadhaar"
                hint={row?.aadhaar_masked ? `Stored: ${row.aadhaar_masked}` : "12 digits, Verhoeff-checked"}
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value}
                    onChange={(event) => field.onChange(formatAadhaar(event.target.value))}
                    inputMode="numeric"
                    maxLength={14}
                    className="money font-mono"
                    placeholder={row?.aadhaar_masked ?? "1234 5678 9012"}
                  />
                )}
              />
            </FormRow>
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} data-testid="co-applicant-submit">
              {row ? "Save" : "Add co-applicant"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
