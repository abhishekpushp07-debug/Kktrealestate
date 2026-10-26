import { useQuery } from "@tanstack/react-query";
import { Building2, FileSignature, Hash, Settings2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { CompanySettingsUpdateSchema, SERVICE_PRIORITIES, SERVICE_PRIORITY_LABELS, type CompanySettingsRow, type ServicePriority } from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, FormError, FormField, FormRow, Input, NumberInput, PageHeader, PageSkeleton, PercentInput, Select, Switch } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { contractResolver } from "@/features/shared/contractResolver";
import { SETTINGS_PATH } from "./adminApi";
import { DEFAULT_NUMBER_FORMAT, financialYearCode, renderNumber } from "./numbering";

type NumberingScope = "customer" | "booking" | "demand" | "receipt" | "ticket" | "visit";

const NUMBERING_SCOPES: ReadonlyArray<{ key: NumberingScope; label: string; fallbackPrefix: string }> = [
  { key: "customer", label: "Customers", fallbackPrefix: "CUST-" },
  { key: "booking", label: "Bookings", fallbackPrefix: "BK-" },
  { key: "demand", label: "Demands", fallbackPrefix: "DM-" },
  { key: "receipt", label: "Receipts", fallbackPrefix: "SGB/" },
  { key: "ticket", label: "Service tickets", fallbackPrefix: "SR-" },
  { key: "visit", label: "Site visits", fallbackPrefix: "SV-" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface AddressValues {
  line1: string;
  line2: string;
  locality: string;
  city: string;
  state: string;
  pincode: string;
}

interface NumberingValues {
  prefix: string;
  format: string;
}

export interface SettingsValues {
  name: string;
  legal_name: string;
  gstin: string;
  phone: string;
  email: string;
  address: AddressValues;
  letterhead: { tagline: string; phone: string; email: string; website: string; signatory_name: string; signatory_title: string };
  fy_start_month: number;
  numbering: Record<NumberingScope, NumberingValues>;
  settings: {
    demand_due_days: number;
    default_gst_percent: number;
    round_robin_enabled: boolean;
    force_mfa_for_admins: boolean;
    sla_hours: Record<ServicePriority, number>;
    booking_hold_hours: number;
  };
  version: number;
}

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** Form strings → contract payload (blank optional fields become null, empty address becomes null). */
const SettingsFormSchema = z
  .looseObject({
    legal_name: z.string(),
    gstin: z.string(),
    phone: z.string(),
    email: z.string(),
    address: z.object({ line1: z.string(), line2: z.string(), locality: z.string(), city: z.string(), state: z.string(), pincode: z.string() }),
    letterhead: z.object({ tagline: z.string(), phone: z.string(), email: z.string(), website: z.string(), signatory_name: z.string(), signatory_title: z.string() }),
    numbering: z.record(z.string(), z.object({ prefix: z.string(), format: z.string() })),
  })
  .transform(({ legal_name, gstin, phone, email, address, letterhead, numbering, ...rest }): unknown => {
    const addressEmpty = Object.values(address).every((value) => value.trim() === "");
    return {
      ...rest,
      legal_name: orNull(legal_name),
      gstin: orNull(gstin),
      phone: orNull(phone),
      email: orNull(email),
      address: addressEmpty ? null : { line1: address.line1, line2: orNull(address.line2), locality: orNull(address.locality), city: address.city, state: address.state, pincode: address.pincode },
      letterhead: {
        tagline: orNull(letterhead.tagline),
        phone: orNull(letterhead.phone),
        email: orNull(letterhead.email),
        website: orNull(letterhead.website),
        signatory_name: orNull(letterhead.signatory_name),
        signatory_title: orNull(letterhead.signatory_title),
      },
      numbering: Object.fromEntries(Object.entries(numbering).map(([scope, value]) => [scope, { prefix: value.prefix, format: value.format.trim() === "" ? undefined : value.format.trim() }])),
    };
  })
  .pipe(CompanySettingsUpdateSchema);

function toValues(row: CompanySettingsRow): SettingsValues {
  const numbering = Object.fromEntries(NUMBERING_SCOPES.map(({ key }) => [key, { prefix: row.numbering[key]?.prefix ?? "", format: row.numbering[key]?.format ?? "" }])) as Record<NumberingScope, NumberingValues>;
  return {
    name: row.name,
    legal_name: row.legal_name ?? "",
    gstin: row.gstin ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: {
      line1: row.address?.line1 ?? "",
      line2: row.address?.line2 ?? "",
      locality: row.address?.locality ?? "",
      city: row.address?.city ?? "",
      state: row.address?.state ?? "",
      pincode: row.address?.pincode ?? "",
    },
    letterhead: {
      tagline: row.letterhead.tagline ?? "",
      phone: row.letterhead.phone ?? "",
      email: row.letterhead.email ?? "",
      website: row.letterhead.website ?? "",
      signatory_name: row.letterhead.signatory_name ?? "",
      signatory_title: row.letterhead.signatory_title ?? "",
    },
    fy_start_month: row.fy_start_month,
    numbering,
    settings: {
      demand_due_days: row.settings.demand_due_days,
      default_gst_percent: row.settings.default_gst_percent,
      round_robin_enabled: row.settings.round_robin_enabled,
      force_mfa_for_admins: row.settings.force_mfa_for_admins,
      sla_hours: { ...row.settings.sla_hours },
      booking_hold_hours: row.settings.booking_hold_hours,
    },
    version: row.version,
  };
}

/** `/admin/settings` — company profile, letterhead, numbering, business defaults; saved with the row version. */
export default function SettingsPage() {
  const query = useQuery<CompanySettingsRow, ApiClientError>({ queryKey: [SETTINGS_PATH], queryFn: ({ signal }) => api.get<CompanySettingsRow>(SETTINGS_PATH, { signal }) });
  if (query.isPending) return <PageSkeleton />;
  if (query.isError) {
    return (
      <>
        <PageHeaderBlock />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </>
    );
  }
  return <SettingsForm row={query.data} />;
}

function PageHeaderBlock({ row }: { row?: CompanySettingsRow }) {
  return (
    <PageHeader
      title="Settings"
      description="Company profile, letterhead, numbering and the business defaults every module reads."
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Admin" }, { label: "Settings" }]}
      titleAddon={
        row ? (
          <Badge variant="outline" numeric>
            v{row.version} · {formatDateTime(row.updated_at)}
          </Badge>
        ) : undefined
      }
    />
  );
}

function SettingsForm({ row }: { row: CompanySettingsRow }) {
  const { refreshMe } = useAuth();
  const resolver = useMemo(() => contractResolver<SettingsValues, unknown>(SettingsFormSchema), []);
  const form = useForm<SettingsValues, unknown, unknown>({ resolver, defaultValues: toValues(row), mode: "onTouched" });
  const [serverError, setServerError] = useState<unknown>(null);

  useEffect(() => {
    form.reset(toValues(row));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.version]);

  const save = useMutationWithToast<CompanySettingsRow, unknown>({
    mutationFn: (body) => api.patch<CompanySettingsRow>(SETTINGS_PATH, body, { version: row.version }),
    successMessage: "Settings saved",
    invalidate: [[SETTINGS_PATH]],
    entityLabel: "Company settings",
    errorMessage: false,
    onSuccess: () => void refreshMe().catch(() => undefined),
    onError: (error) => {
      if (error.isVersionConflict) return;
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
  });

  const { isDirty } = form.formState;

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit((output) => {
          setServerError(null);
          save.mutate(output);
        })}
        noValidate
        className="space-y-4"
      >
        <PageHeaderBlock row={row} />
        {serverError !== null && <FormError error={serverError} />}

        <SettingsFields row={row} />

        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <span className="mr-auto text-xs text-ink-subtle">{isDirty ? "Unsaved changes" : "Everything saved"}</span>
          <Button variant="outline" onClick={() => form.reset(toValues(row))} disabled={!isDirty || save.isPending} data-testid="settings-reset-btn">
            Discard
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!isDirty} data-testid="settings-save-btn">
            Save settings
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

function SettingsFields({ row }: { row: CompanySettingsRow }) {
  const { control, watch } = useFormContext<SettingsValues>();
  const fyStartMonth = watch("fy_start_month");
  const numbering = watch("numbering");
  const fy = financialYearCode(new Date(`${todayIST()}T12:00:00`), fyStartMonth);
  return (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <Building2 className="size-4 text-gold-text" aria-hidden="true" /> Company profile
              </CardTitle>
              <CardDescription>Printed on receipts, demand letters and the allotment letter.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormRow columns={2}>
                <FormField control={control} name="name" label="Trading name" required render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} data-testid="settings-name" />} />
                <FormField control={control} name="legal_name" label="Legal name" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} data-testid="settings-legal-name" />} />
                <FormField control={control} name="gstin" label="GSTIN" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase())} maxLength={15} className="font-mono uppercase" data-testid="settings-gstin" />} />
                <FormField control={control} name="phone" label="Phone" render={({ field }) => <Input {...field} type="tel" value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={15} className="money" data-testid="settings-phone" />} />
                <FormField control={control} name="email" label="E-mail" className="sm:col-span-2" render={({ field }) => <Input {...field} type="email" value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={254} data-testid="settings-email" />} />
                <FormField control={control} name="address.line1" label="Address line 1" className="sm:col-span-2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={200} data-testid="settings-address-line1" />} />
                <FormField control={control} name="address.line2" label="Address line 2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={200} />} />
                <FormField control={control} name="address.locality" label="Locality" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} />} />
                <FormField control={control} name="address.city" label="City" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={80} />} />
                <FormField control={control} name="address.state" label="State" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={80} />} />
                <FormField control={control} name="address.pincode" label="PIN code" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={6} className="money" />} />
              </FormRow>
              {row.logo_url && (
                <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-surface p-2">
                  <img src={row.logo_url} alt="Company logo" className="size-12 rounded-sm object-contain" />
                  <p className="text-xs text-ink-subtle">Logo comes from the documents module; upload a new file there and pick it as the company logo.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <FileSignature className="size-4 text-gold-text" aria-hidden="true" /> Letterhead
              </CardTitle>
              <CardDescription>Header and signature block of every generated PDF.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormRow columns={2}>
                <FormField control={control} name="letterhead.tagline" label="Tagline" className="sm:col-span-2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} data-testid="settings-tagline" />} />
                <FormField control={control} name="letterhead.phone" label="Phone" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={40} className="money" />} />
                <FormField control={control} name="letterhead.email" label="E-mail" render={({ field }) => <Input {...field} type="email" value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={254} />} />
                <FormField control={control} name="letterhead.website" label="Website" className="sm:col-span-2" hint="https://…" render={({ field }) => <Input {...field} type="url" value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={2048} />} />
                <FormField control={control} name="letterhead.signatory_name" label="Signatory name" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} />} />
                <FormField control={control} name="letterhead.signatory_title" label="Signatory title" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} placeholder="Authorised Signatory" />} />
              </FormRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <Hash className="size-4 text-gold-text" aria-hidden="true" /> Numbering
              </CardTitle>
              <CardDescription>
                Sequences restart every financial year. Tokens: <code className="font-mono">{"{prefix} {fy} {seq:4}"}</code> · current FY code <strong className="money">{fy}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField
                control={control}
                name="fy_start_month"
                label="Financial year starts in"
                className="sm:max-w-xs"
                render={({ field }) => <Select id={field.id} value={String(field.value)} onValueChange={(value) => value && field.onChange(Number(value))} options={MONTHS.map((month, index) => ({ value: String(index + 1), label: month }))} data-testid="settings-fy-start" />}
              />
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead className="bg-surface text-left text-2xs uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th className="px-2 py-1.5">Scope</th>
                      <th className="px-2 py-1.5">Prefix</th>
                      <th className="px-2 py-1.5">Format</th>
                      <th className="px-2 py-1.5">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {NUMBERING_SCOPES.map((scope) => (
                      <tr key={scope.key} className="border-t border-border">
                        <td className="px-2 py-1.5 font-medium text-ink">{scope.label}</td>
                        <td className="px-2 py-1.5">
                          <FormField control={control} name={`numbering.${scope.key}.prefix`} render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase())} maxLength={10} className="h-8 w-28 font-mono text-xs uppercase" aria-label={`${scope.label} prefix`} placeholder={scope.fallbackPrefix} data-testid={`settings-prefix-${scope.key}`} />} />
                        </td>
                        <td className="px-2 py-1.5">
                          <FormField control={control} name={`numbering.${scope.key}.format`} render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={40} className="h-8 w-44 font-mono text-xs" aria-label={`${scope.label} format`} placeholder={DEFAULT_NUMBER_FORMAT} />} />
                        </td>
                        <td className="money px-2 py-1.5 font-mono text-xs font-semibold text-navy-950" data-testid={`settings-preview-${scope.key}`}>
                          {renderNumber(numbering[scope.key].prefix || scope.fallbackPrefix, numbering[scope.key].format, fy, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <Settings2 className="size-4 text-gold-text" aria-hidden="true" /> Business defaults
              </CardTitle>
              <CardDescription>Read by the dues engine, booking wizard, service desk and sign-in.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormRow columns={3}>
                <FormField control={control} name="settings.demand_due_days" label="Demand due days" hint="Default days to pay after a trigger" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={(value) => field.onChange(value ?? 0)} onBlur={field.onBlur} decimals={0} min={0} max={365} suffix="days" data-testid="settings-demand-due-days" />} />
                <FormField control={control} name="settings.default_gst_percent" label="Default GST" render={({ field }) => <PercentInput id={field.id} value={field.value} onChange={(value) => field.onChange(value ?? 0)} onBlur={field.onBlur} data-testid="settings-gst" />} />
                <FormField control={control} name="settings.booking_hold_hours" label="Booking hold" hint="Hours a flat stays on Hold" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={(value) => field.onChange(value ?? 1)} onBlur={field.onBlur} decimals={0} min={1} max={720} suffix="hours" data-testid="settings-hold-hours" />} />
              </FormRow>
              <div className="space-y-3 rounded-md border border-border bg-surface/60 p-3">
                <FormField control={control} name="settings.round_robin_enabled" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Round-robin lead assignment" description="New website enquiries rotate across the sales team" data-testid="settings-round-robin" />} />
                <FormField
                  control={control}
                  name="settings.force_mfa_for_admins"
                  render={({ field }) => (
                    <Switch
                      id={field.id}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <ShieldCheck className="size-3.5 text-navy-700" aria-hidden="true" /> Force MFA for admin roles
                        </span>
                      }
                      description="Super Admins and Project Admins must enrol an authenticator before using the ERP"
                      data-testid="settings-force-mfa"
                    />
                  )}
                />
              </div>
              <div>
                <p className="label-caps mb-2">Service SLA hours per priority</p>
                <FormRow columns={4}>
                  {SERVICE_PRIORITIES.map((priority) => (
                    <FormField key={priority} control={control} name={`settings.sla_hours.${priority}`} label={SERVICE_PRIORITY_LABELS[priority]} render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={(value) => field.onChange(value ?? 1)} onBlur={field.onBlur} decimals={0} min={1} max={720} suffix="h" data-testid={`settings-sla-${priority}`} />} />
                  ))}
                </FormRow>
              </div>
            </CardContent>
          </Card>
        </div>
  );
}
