import { ExternalLink, Globe, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, type Control, useWatch } from "react-hook-form";
import { SiteSettingsUpdateSchema, type SiteSettingsRow } from "@kkt/contracts";
import { z } from "zod";
import {
  applyServerErrors,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  FormError,
  FormField,
  FormRow,
  IconButton,
  Input,
  MultiSelect,
  PageHeader,
  Skeleton,
  Switch,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { useUnsavedChangesGuard } from "@/lib/unsaved";
import { controlOf, Notice } from "@/features/inventory/components";
import { contractResolver } from "@/features/shared/contractResolver";
import { useProjectOptions } from "@/features/shared/options";
import { CMS_BREADCRUMBS } from "./CmsLayout";
import { EMPTY_SEO, MediaPicker, SeoFields, seoToPayload, seoToValues, type SeoValues } from "./components";
import { cmsKeys, nullable, SITE_PATH, useSiteSettings, websiteOrigin } from "./api";

const SOCIAL_KEYS = ["facebook", "instagram", "youtube", "linkedin", "x", "whatsapp"] as const;
type SocialKey = (typeof SOCIAL_KEYS)[number];
const SOCIAL_LABELS: Readonly<Record<SocialKey, string>> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  whatsapp: "WhatsApp link",
};

interface SiteValues {
  brand: { name: string; tagline: string; logo_document_id: string | null; favicon_document_id: string | null };
  contacts: { phone: string; whatsapp: string; email: string };
  offices: Array<{ name: string; address: string; phone: string; maps_link: string }>;
  social: Record<SocialKey, string>;
  trust_stats: Array<{ label: string; value: string }>;
  value_props: Array<{ title: string; body: string; icon: string }>;
  disclaimer: string;
  seo_defaults: SeoValues;
  analytics: { ga_id: string };
  site_live: boolean;
  coming_soon_message: string;
  portal_url: string;
  erp_url: string;
  featured_project_ids: string[];
  walkthrough_video_url: string;
  round_robin_enabled: boolean;
}

const FormSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as SiteValues;
    const social: Partial<Record<SocialKey, string>> = {};
    for (const key of SOCIAL_KEYS) {
      const url = values.social[key]?.trim();
      if (url) social[key] = url;
    }
    return {
      brand: {
        name: values.brand.name.trim(),
        tagline: nullable(values.brand.tagline),
        logo_document_id: values.brand.logo_document_id,
        favicon_document_id: values.brand.favicon_document_id,
      },
      contacts: {
        phone: nullable(values.contacts.phone),
        whatsapp: nullable(values.contacts.whatsapp),
        email: nullable(values.contacts.email),
      },
      offices: values.offices
        .filter((office) => office.name.trim() || office.address.trim())
        .map((office) => ({
          name: office.name.trim(),
          address: office.address.trim(),
          phone: nullable(office.phone),
          maps_link: nullable(office.maps_link),
        })),
      social,
      trust_stats: values.trust_stats
        .filter((stat) => stat.label.trim() || stat.value.trim())
        .map((stat) => ({ label: stat.label.trim(), value: stat.value.trim() })),
      value_props: values.value_props
        .filter((prop) => prop.title.trim() || prop.body.trim())
        .map((prop) => ({ title: prop.title.trim(), body: prop.body.trim(), icon: nullable(prop.icon) })),
      disclaimer: nullable(values.disclaimer),
      seo_defaults: seoToPayload(values.seo_defaults),
      analytics: { ga_id: nullable(values.analytics.ga_id) },
      site_live: values.site_live,
      coming_soon_message: nullable(values.coming_soon_message),
      portal_url: nullable(values.portal_url),
      erp_url: nullable(values.erp_url),
      featured_project_ids: values.featured_project_ids,
      walkthrough_video_url: nullable(values.walkthrough_video_url),
      round_robin_enabled: values.round_robin_enabled,
    };
  })
  .pipe(SiteSettingsUpdateSchema.omit({ version: true }));

function toValues(row: SiteSettingsRow): SiteValues {
  const social = Object.fromEntries(SOCIAL_KEYS.map((key) => [key, row.social[key] ?? ""])) as Record<
    SocialKey,
    string
  >;
  return {
    brand: {
      name: row.brand.name,
      tagline: row.brand.tagline ?? "",
      logo_document_id: row.brand.logo_document_id ?? null,
      favicon_document_id: row.brand.favicon_document_id ?? null,
    },
    contacts: {
      phone: row.contacts.phone ?? "",
      whatsapp: row.contacts.whatsapp ?? "",
      email: row.contacts.email ?? "",
    },
    offices: row.offices.map((office) => ({
      name: office.name,
      address: office.address,
      phone: office.phone ?? "",
      maps_link: office.maps_link ?? "",
    })),
    social,
    trust_stats: row.trust_stats.map((stat) => ({ label: stat.label, value: stat.value })),
    value_props: row.value_props.map((prop) => ({ title: prop.title, body: prop.body, icon: prop.icon ?? "" })),
    disclaimer: row.disclaimer ?? "",
    seo_defaults: row.seo_defaults ? seoToValues(row.seo_defaults) : { ...EMPTY_SEO },
    analytics: { ga_id: row.analytics.ga_id ?? "" },
    site_live: row.site_live,
    coming_soon_message: row.coming_soon_message ?? "",
    portal_url: row.portal_url ?? "",
    erp_url: row.erp_url ?? "",
    featured_project_ids: [...row.featured_project_ids],
    walkthrough_video_url: row.walkthrough_video_url ?? "",
    round_robin_enabled: row.round_robin_enabled,
  };
}

/** `/website/settings` — brand, contacts, offices, social, trust stats, value props, SEO, analytics, live switch, URLs, featured projects. */
export default function SiteSettingsPage() {
  const settings = useSiteSettings();
  if (settings.isPending) return <Skeleton className="h-[40rem] rounded-lg" />;
  if (settings.isError)
    return (
      <ErrorState
        error={settings.error}
        onRetry={() => void settings.refetch()}
        className="rounded-lg border border-border bg-card"
      />
    );
  return <SiteSettingsForm row={settings.data} />;
}

function SiteSettingsForm({ row }: { row: SiteSettingsRow }) {
  const { can } = useAuth();
  const canWrite = can("cms.write");
  const projects = useProjectOptions();
  const resolver = useMemo(() => contractResolver<SiteValues, unknown>(FormSchema), []);
  const form = useForm<SiteValues, unknown, unknown>({ resolver, defaultValues: toValues(row), mode: "onTouched" });
  // Leaving with unsaved edits (sidebar, Cmd+K, back, reload) asks first (audit v3 H3).
  useUnsavedChangesGuard(form.formState.isDirty);
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);

  useEffect(() => {
    form.reset(toValues(row));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed the form only when the server row changes version
  }, [row.version]);

  const save = useMutationWithToast<SiteSettingsRow, unknown>({
    mutationFn: (body) =>
      api.patch<SiteSettingsRow>(
        SITE_PATH,
        { ...(body as Record<string, unknown>), version: row.version },
        { version: row.version },
      ),
    successMessage: "Site settings saved",
    invalidate: [cmsKeys.site],
    entityLabel: "Site settings",
    errorMessage: false,
    onError: (error) => {
      if (error.isVersionConflict) return;
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
  });

  const live = useWatch({ control, name: "site_live" });
  const origin = websiteOrigin();
  const disabled = !canWrite || save.isPending;
  const projectOptions = (projects.data ?? []).map((project) => ({
    value: project.id,
    label: project.name,
    description: project.code ?? undefined,
  }));

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((output) => {
        setServerError(null);
        save.mutate(output);
      })}
      className="space-y-4"
    >
      <PageHeader
        title="Site settings"
        description="Everything global on the marketing website. Project-specific pages are configured on each project's Website tab."
        breadcrumbs={[...CMS_BREADCRUMBS, { label: "Site settings" }]}
        titleAddon={
          live ? undefined : (
            <span className="rounded-full border border-status-hold-border bg-warning-bg px-2 py-0.5 text-2xs font-semibold text-warning-fg">
              Coming soon mode
            </span>
          )
        }
        actions={
          <>
            {origin && (
              <Button asChild variant="outline" leftIcon={ExternalLink}>
                <a href={origin} target="_blank" rel="noopener noreferrer" data-testid="site-preview-link">
                  Open website
                </a>
              </Button>
            )}
            {canWrite && (
              <Button
                type="submit"
                leftIcon={Save}
                loading={save.isPending}
                disabled={!form.formState.isDirty}
                data-testid="site-save-btn"
              >
                Save
              </Button>
            )}
          </>
        }
      />
      {!canWrite && <Notice tone="info">You can view the settings; editing needs the “cms.write” permission.</Notice>}
      <FormError error={serverError} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Brand</CardTitle>
              <CardDescription>Name, tagline and logo used in the header, footer and social previews.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormRow>
                <FormField
                  control={control}
                  name="brand.name"
                  label="Brand name"
                  required
                  render={({ field }) => (
                    <Input
                      id={field.id}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      maxLength={120}
                      invalid={field.invalid}
                      disabled={disabled}
                      data-testid="site-brand-name"
                    />
                  )}
                />
                <FormField
                  control={control}
                  name="brand.tagline"
                  label="Tagline"
                  render={({ field }) => (
                    <Input
                      id={field.id}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      maxLength={160}
                      invalid={field.invalid}
                      disabled={disabled}
                    />
                  )}
                />
              </FormRow>
              <FormRow>
                <FormField
                  control={control}
                  name="brand.logo_document_id"
                  label="Logo"
                  hint="Transparent PNG or WebP"
                  render={({ field }) => (
                    <MediaPicker
                      id={field.id}
                      value={field.value}
                      onChange={field.onChange}
                      aspect="wide"
                      label="Upload logo"
                      disabled={disabled}
                    />
                  )}
                />
                <FormField
                  control={control}
                  name="brand.favicon_document_id"
                  label="Favicon"
                  hint="Square, at least 256 × 256"
                  render={({ field }) => (
                    <MediaPicker
                      id={field.id}
                      value={field.value}
                      onChange={field.onChange}
                      aspect="square"
                      label="Upload favicon"
                      disabled={disabled}
                    />
                  )}
                />
              </FormRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contacts & offices</CardTitle>
              <CardDescription>
                Shown in the footer, the sticky mobile bar (Call · WhatsApp) and the contact page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormRow columns={3}>
                <FormField
                  control={control}
                  name="contacts.phone"
                  label="Phone"
                  render={({ field }) => (
                    <Input
                      id={field.id}
                      type="tel"
                      inputMode="numeric"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="98765 43210"
                      invalid={field.invalid}
                      disabled={disabled}
                    />
                  )}
                />
                <FormField
                  control={control}
                  name="contacts.whatsapp"
                  label="WhatsApp number"
                  render={({ field }) => (
                    <Input
                      id={field.id}
                      type="tel"
                      inputMode="numeric"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="98765 43210"
                      invalid={field.invalid}
                      disabled={disabled}
                    />
                  )}
                />
                <FormField
                  control={control}
                  name="contacts.email"
                  label="E-mail"
                  render={({ field }) => (
                    <Input
                      id={field.id}
                      type="email"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      invalid={field.invalid}
                      disabled={disabled}
                    />
                  )}
                />
              </FormRow>
              <OfficesRepeater control={control} disabled={disabled} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trust strip & value props</CardTitle>
              <CardDescription>
                Headline numbers (“25 years”, “3,200 families”) and the reasons-to-buy cards on the home page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <TrustStatsRepeater control={control} disabled={disabled} />
              <ValuePropsRepeater control={control} disabled={disabled} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Legal & SEO</CardTitle>
              <CardDescription>
                RERA disclaimer for the footer and the default meta tags used when a page has none.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={control}
                name="disclaimer"
                label="Disclaimer"
                hint="Shown in the footer of every page"
                render={({ field }) => (
                  <Textarea
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    rows={4}
                    maxLength={2000}
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
              <SeoFields control={control} prefix="seo_defaults" disabled={disabled} />
              <FormField
                control={control}
                name="analytics.ga_id"
                label="Google Analytics ID"
                hint="G-XXXXXXXXXX; leave empty to disable analytics"
                render={({ field }) => (
                  <Input
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    maxLength={40}
                    className="font-mono"
                    placeholder="G-"
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card className={live ? undefined : "border-status-hold-border"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="size-4 text-gold-text" aria-hidden="true" /> Publishing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={control}
                name="site_live"
                render={({ field }) => (
                  <Switch
                    id={field.id}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    label="Site live"
                    description={
                      field.value ? "Visitors see the full website." : "Visitors see an elegant coming-soon page."
                    }
                    disabled={disabled}
                    data-testid="site-live-switch"
                  />
                )}
              />
              {!live && (
                <FormField
                  control={control}
                  name="coming_soon_message"
                  label="Coming-soon message"
                  render={({ field }) => (
                    <Textarea
                      id={field.id}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      rows={3}
                      maxLength={300}
                      placeholder="Our new website is on its way. Call us meanwhile."
                      invalid={field.invalid}
                      disabled={disabled}
                    />
                  )}
                />
              )}
              <FormField
                control={control}
                name="round_robin_enabled"
                render={({ field }) => (
                  <Switch
                    id={field.id}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    label="Round-robin enquiry assignment"
                    description="Website enquiries rotate across sales users"
                    disabled={disabled}
                  />
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={control}
                name="portal_url"
                label="Customer portal URL"
                hint="“Buyer login” link in the header"
                render={({ field }) => (
                  <Input
                    id={field.id}
                    type="url"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="https://portal.example.com"
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
              <FormField
                control={control}
                name="erp_url"
                label="ERP URL"
                hint="“Staff? Go to ERP” link on the portal login"
                render={({ field }) => (
                  <Input
                    id={field.id}
                    type="url"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="https://erp.example.com"
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
              <FormField
                control={control}
                name="walkthrough_video_url"
                label="Walkthrough video URL"
                hint="YouTube or Vimeo page URL; loads only on click"
                render={({ field }) => (
                  <Input
                    id={field.id}
                    type="url"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="https://youtu.be/…"
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Featured projects</CardTitle>
              <CardDescription>
                Up to 12, shown on the home page in this order. Only published projects appear publicly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={control}
                name="featured_project_ids"
                render={({ field }) => (
                  <MultiSelect
                    id={field.id}
                    value={field.value}
                    onValueChange={(values) => field.onChange(values.slice(0, 12))}
                    options={projectOptions}
                    placeholder={projects.isPending ? "Loading projects…" : "Pick projects"}
                    maxChips={6}
                    disabled={disabled}
                    aria-label="Featured projects"
                    data-testid="site-featured-projects"
                  />
                )}
              />
              <SocialFields control={control} disabled={disabled} />
            </CardContent>
          </Card>

          <p className="money text-2xs text-ink-subtle">
            Last saved {formatDateTime(row.updated_at)} · version {row.version}
          </p>
        </div>
      </div>

      {canWrite && (
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => form.reset(toValues(row))}
            disabled={!form.formState.isDirty || save.isPending}
          >
            Discard changes
          </Button>
          <Button type="submit" leftIcon={Save} loading={save.isPending} disabled={!form.formState.isDirty}>
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Repeaters                                                            */
/* ------------------------------------------------------------------ */

function RepeaterHeader({
  title,
  hint,
  onAdd,
  disabled,
  canAdd,
  testId,
}: {
  title: string;
  hint?: string;
  onAdd: () => void;
  disabled: boolean;
  canAdd: boolean;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {hint && <p className="text-xs text-ink-subtle">{hint}</p>}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        leftIcon={Plus}
        onClick={onAdd}
        disabled={disabled || !canAdd}
        data-testid={testId}
      >
        Add
      </Button>
    </div>
  );
}

function OfficesRepeater({ control, disabled }: { control: Control<SiteValues>; disabled: boolean }) {
  const offices = useFieldArray({ control, name: "offices" });
  return (
    <div className="space-y-3">
      <RepeaterHeader
        title="Offices"
        hint="Up to 20 — address, phone and a Google Maps link each."
        onAdd={() => offices.append({ name: "", address: "", phone: "", maps_link: "" })}
        disabled={disabled}
        canAdd={offices.fields.length < 20}
        testId="site-add-office"
      />
      {offices.fields.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-ink-subtle">
          No offices listed.
        </p>
      )}
      <ul className="space-y-3">
        {offices.fields.map((item, index) => (
          <li key={item.id} className="relative rounded-md border border-border bg-surface/60 p-3 pr-12">
            <IconButton
              icon={Trash2}
              label="Remove office"
              variant="ghost"
              size="sm"
              className="absolute right-2 top-2"
              disabled={disabled}
              onClick={() => offices.remove(index)}
            />
            <FormRow>
              <FormField
                control={control}
                name={`offices.${index}.name`}
                label="Office name"
                required
                render={({ field }) => (
                  <Input
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    maxLength={120}
                    placeholder="Head office"
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
              <FormField
                control={control}
                name={`offices.${index}.phone`}
                label="Phone"
                render={({ field }) => (
                  <Input
                    id={field.id}
                    type="tel"
                    inputMode="numeric"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
            </FormRow>
            <FormField
              control={control}
              name={`offices.${index}.address`}
              label="Address"
              required
              className="mt-3"
              render={({ field }) => (
                <Textarea
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  rows={2}
                  maxLength={300}
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
            <FormField
              control={control}
              name={`offices.${index}.maps_link`}
              label="Google Maps link"
              className="mt-3"
              render={({ field }) => (
                <Input
                  id={field.id}
                  type="url"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="https://maps.app.goo.gl/…"
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrustStatsRepeater({ control, disabled }: { control: Control<SiteValues>; disabled: boolean }) {
  const stats = useFieldArray({ control, name: "trust_stats" });
  return (
    <div className="space-y-3">
      <RepeaterHeader
        title="Trust stats"
        hint="Up to 8 label / value pairs, e.g. “Families housed” → “3,200+”."
        onAdd={() => stats.append({ label: "", value: "" })}
        disabled={disabled}
        canAdd={stats.fields.length < 8}
        testId="site-add-stat"
      />
      {stats.fields.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-ink-subtle">
          No stats yet.
        </p>
      )}
      <ul className="space-y-2">
        {stats.fields.map((item, index) => (
          <li key={item.id} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <FormField
              control={control}
              name={`trust_stats.${index}.label`}
              render={({ field }) => (
                <Input
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  maxLength={60}
                  placeholder="Label"
                  aria-label="Stat label"
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
            <FormField
              control={control}
              name={`trust_stats.${index}.value`}
              className="col-span-2 sm:col-span-1"
              render={({ field }) => (
                <Input
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  maxLength={30}
                  placeholder="Value"
                  aria-label="Stat value"
                  className="money"
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
            <IconButton
              icon={Trash2}
              label="Remove stat"
              variant="ghost"
              size="sm"
              className="row-start-1 sm:row-auto"
              disabled={disabled}
              onClick={() => stats.remove(index)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ValuePropsRepeater({ control, disabled }: { control: Control<SiteValues>; disabled: boolean }) {
  const props = useFieldArray({ control, name: "value_props" });
  return (
    <div className="space-y-3">
      <RepeaterHeader
        title="Value propositions"
        hint="Up to 8 cards with a title, a line of copy and an optional icon name (lucide)."
        onAdd={() => props.append({ title: "", body: "", icon: "" })}
        disabled={disabled}
        canAdd={props.fields.length < 8}
        testId="site-add-prop"
      />
      {props.fields.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-ink-subtle">
          No value props yet.
        </p>
      )}
      <ul className="space-y-3">
        {props.fields.map((item, index) => (
          <li key={item.id} className="relative rounded-md border border-border bg-surface/60 p-3 pr-12">
            <IconButton
              icon={Trash2}
              label="Remove value prop"
              variant="ghost"
              size="sm"
              className="absolute right-2 top-2"
              disabled={disabled}
              onClick={() => props.remove(index)}
            />
            <FormRow>
              <FormField
                control={control}
                name={`value_props.${index}.title`}
                label="Title"
                required
                render={({ field }) => (
                  <Input
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    maxLength={80}
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
              <FormField
                control={control}
                name={`value_props.${index}.icon`}
                label="Icon"
                hint="e.g. shield-check, home, leaf"
                render={({ field }) => (
                  <Input
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    maxLength={40}
                    className="font-mono"
                    invalid={field.invalid}
                    disabled={disabled}
                  />
                )}
              />
            </FormRow>
            <FormField
              control={control}
              name={`value_props.${index}.body`}
              label="Body"
              className="mt-3"
              render={({ field }) => (
                <Textarea
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  rows={2}
                  maxLength={300}
                  invalid={field.invalid}
                  disabled={disabled}
                />
              )}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialFields({ control, disabled }: { control: Control<SiteValues>; disabled: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-ink">Social profiles</p>
      {SOCIAL_KEYS.map((key) => (
        <FormField
          key={key}
          control={control}
          name={`social.${key}`}
          label={SOCIAL_LABELS[key]}
          render={({ field }) => (
            <Input
              id={field.id}
              type="url"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              placeholder="https://"
              invalid={field.invalid}
              disabled={disabled}
            />
          )}
        />
      ))}
    </div>
  );
}
