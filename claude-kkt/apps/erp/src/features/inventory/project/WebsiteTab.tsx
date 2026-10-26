import { Download, ExternalLink, Globe, Image as ImageIcon, Plus, Save, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useFieldArray, useForm, useFormContext } from "react-hook-form";
import { ProjectWebsiteSettingsUpdateSchema, type DocumentRow, type ProjectRow, type ProjectWebsiteSettingsRow } from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, FormError, FormField, FormRow, FormSection, IconButton, Input, MoneyInput, Select, Skeleton, StatCard, Switch, Textarea } from "@/components/ui";
import { api, isApiClientError, type ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { contractResolver } from "@/features/shared/contractResolver";
import { businessRuleIssues } from "@/features/shared/errors";
import { DocumentsPanel, UploadDocumentDialog } from "../DocumentsPanel";
import { inventoryKeys, PROJECTS_PATH, useBrochureStats, useEntityDocuments, useWebsiteSettings } from "../api";
import { controlOf, Notice, Sparkline } from "../components";

interface WebsiteValues {
  slug: string;
  is_published: boolean;
  show_prices: boolean;
  show_availability: boolean;
  show_progress: boolean;
  starting_price_override_paise: number | null;
  hero_document_ids: string[];
  highlights: Array<{ text: string }>;
  video_urls: Array<{ url: string }>;
  tour_urls: Array<{ url: string }>;
  map_embed_url: string;
  brochure_document_id: string | null;
  faqs: Array<{ q: string; a: string }>;
  seo: { title: string; description: string; og_image_document_id: string | null; noindex: boolean };
}

const FormSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as WebsiteValues;
    return {
      slug: values.slug.trim().toLowerCase(),
      is_published: values.is_published,
      show_prices: values.show_prices,
      show_availability: values.show_availability,
      show_progress: values.show_progress,
      starting_price_override_paise: values.starting_price_override_paise,
      hero_document_ids: values.hero_document_ids,
      highlights: values.highlights.map((item) => item.text.trim()).filter(Boolean),
      video_urls: values.video_urls.map((item) => item.url.trim()).filter(Boolean),
      tour_urls: values.tour_urls.map((item) => item.url.trim()).filter(Boolean),
      map_embed_url: values.map_embed_url.trim() || null,
      brochure_document_id: values.brochure_document_id,
      faqs: values.faqs.filter((item) => item.q.trim() || item.a.trim()).map((item) => ({ q: item.q.trim(), a: item.a.trim() })),
      seo: {
        title: values.seo.title.trim() || null,
        description: values.seo.description.trim() || null,
        og_image_document_id: values.seo.og_image_document_id,
        noindex: values.seo.noindex,
      },
    };
  })
  .pipe(ProjectWebsiteSettingsUpdateSchema.omit({ version: true }));

function toValues(row: ProjectWebsiteSettingsRow): WebsiteValues {
  return {
    slug: row.slug,
    is_published: row.is_published,
    show_prices: row.show_prices,
    show_availability: row.show_availability,
    show_progress: row.show_progress,
    starting_price_override_paise: row.starting_price_override_paise ?? null,
    hero_document_ids: [...row.hero_document_ids],
    highlights: row.highlights.map((text) => ({ text })),
    video_urls: row.video_urls.map((url) => ({ url })),
    tour_urls: row.tour_urls.map((url) => ({ url })),
    map_embed_url: row.map_embed_url ?? "",
    brochure_document_id: row.brochure_document_id ?? null,
    faqs: row.faqs.map((faq) => ({ q: faq.q, a: faq.a })),
    seo: { title: row.seo?.title ?? "", description: row.seo?.description ?? "", og_image_document_id: row.seo?.og_image_document_id ?? null, noindex: row.seo?.noindex ?? false },
  };
}

/** Publish-guard details from a 422: `details.missing[]`, `details.blockers[]`, `details.errors[]` or the message. */
function publishRequirements(error: ApiClientError): string[] {
  const details = error.details ?? {};
  for (const key of ["missing", "blockers", "requirements"]) {
    const value = details[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  }
  const issues = businessRuleIssues(error);
  return issues.map((issue) => issue.message);
}

export function WebsiteTab({ project }: { project: ProjectRow }) {
  const settings = useWebsiteSettings(project.id);
  if (settings.isPending) return <Skeleton className="h-96 rounded-lg" />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} className="rounded-lg border border-border bg-card" />;
  return <WebsiteForm project={project} row={settings.data} />;
}

function WebsiteForm({ project, row }: { project: ProjectRow; row: ProjectWebsiteSettingsRow }) {
  const { can } = useAuth();
  const canWrite = can("cms.write");
  const resolver = useMemo(() => contractResolver<WebsiteValues, unknown>(FormSchema), []);
  const form = useForm<WebsiteValues, unknown, unknown>({ resolver, defaultValues: toValues(row), mode: "onTouched" });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);
  const [blockers, setBlockers] = useState<string[]>([]);

  useEffect(() => {
    form.reset(toValues(row));
    setBlockers([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.version]);

  const save = useMutationWithToast<ProjectWebsiteSettingsRow, unknown>({
    mutationFn: (body) => api.patch<ProjectWebsiteSettingsRow>(`${PROJECTS_PATH}/${project.id}/website`, { ...(body as Record<string, unknown>), version: row.version }, { version: row.version }),
    successMessage: "Website settings saved",
    invalidate: [inventoryKeys.website(project.id), [PROJECTS_PATH]],
    entityLabel: "Website settings",
    errorMessage: false,
    onError: (error: ApiClientError) => {
      if (error.isVersionConflict) return;
      if (error.status === 422 || error.code === "PUBLISH_REQUIREMENTS") {
        setBlockers(publishRequirements(error));
        return;
      }
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
  });

  const published = form.watch("is_published");
  const slug = form.watch("slug");
  const siteBlockers = blockers.length > 0 ? blockers : row.publish_blockers;

  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit((output) => {
          setServerError(null);
          setBlockers([]);
          save.mutate(output);
        })}
        className="grid gap-4 lg:grid-cols-3"
      >
        <div className="space-y-4 lg:col-span-2">
          {serverError !== null && <FormError error={serverError} />}
          {siteBlockers.length > 0 && (published || blockers.length > 0) && (
            <Notice tone={blockers.length > 0 ? "danger" : "warning"}>
              <p className="font-semibold">{blockers.length > 0 ? "Cannot publish yet" : "Publishing is blocked until:"}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {siteBlockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Notice>
          )}

          <Card>
            <CardHeader
              actions={
                row.is_published && row.slug ? (
                  <Button asChild variant="ghost" size="sm" rightIcon={ExternalLink}>
                    <a href={`/projects/${row.slug}`} target="_blank" rel="noreferrer noopener">
                      Public page <ExternalLink aria-hidden="true" />
                    </a>
                  </Button>
                ) : undefined
              }
            >
              <CardTitle className="flex items-center gap-2">
                <Globe className="size-4 text-navy-700" aria-hidden="true" /> Visibility
              </CardTitle>
              <p className="text-xs text-ink-subtle">Unpublished projects 404 everywhere on the website and are absent from lists and the sitemap.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormRow columns={2}>
                <FormField control={control} name="slug" label="URL slug" required hint={`/projects/${slug || "…"}`} render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} maxLength={120} className="font-mono" disabled={!canWrite} data-testid="website-slug" />} />
                <FormField control={control} name="starting_price_override_paise" label="Starting price override" hint="Blank = lowest available flat price" render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} disabled={!canWrite} />} />
              </FormRow>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField control={control} name="is_published" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} disabled={!canWrite} label="Published" description={row.published_at ? `Live since ${row.published_at.slice(0, 10)}` : "Needs a hero image, description and location"} data-testid="website-published" />} />
                <FormField control={control} name="show_prices" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} disabled={!canWrite} label="Show prices" description="Configuration prices and starting price" />} />
                <FormField control={control} name="show_availability" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} disabled={!canWrite} label="Show availability grid" description="Available vs not available only" />} />
                <FormField control={control} name="show_progress" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} disabled={!canWrite} label="Show construction progress" description="Stages with website-flagged photos" />} />
              </div>
            </CardContent>
          </Card>

          <HeroImagesCard project={project} canWrite={canWrite} />

          <Card>
            <CardHeader>
              <CardTitle>Content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <StringRepeater name="highlights" field="text" title="Highlights" placeholder="Vastu-compliant layouts" max={12} canWrite={canWrite} />
              <StringRepeater name="video_urls" field="url" title="Video URLs" placeholder="https://www.youtube.com/watch?v=…" max={6} canWrite={canWrite} type="url" />
              <StringRepeater name="tour_urls" field="url" title="360° tour URLs" placeholder="https://…" max={6} canWrite={canWrite} type="url" />
              <FormField control={control} name="map_embed_url" label="Map embed URL" hint="Google Maps embed link (click-to-load on the website)" render={({ field }) => <Input {...field} type="url" value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={2048} disabled={!canWrite} />} />
              <FaqRepeater canWrite={canWrite} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SEO</CardTitle>
            </CardHeader>
            <CardContent>
              <FormRow columns={2}>
                <FormField control={control} name="seo.title" label="Meta title" hint="≤ 70 characters" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={70} disabled={!canWrite} />} />
                <FormField control={control} name="seo.noindex" className="sm:pt-5" render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} disabled={!canWrite} label="noindex" description="Hide from search engines" />} />
                <FormField control={control} name="seo.description" label="Meta description" hint="≤ 160 characters" className="sm:col-span-2" render={({ field }) => <Textarea {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} rows={2} maxLength={160} disabled={!canWrite} />} />
              </FormRow>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <BrochureCard project={project} row={row} canWrite={canWrite} />
          {canWrite && (
            <div className="sticky bottom-4 flex justify-end gap-2 rounded-lg border border-border bg-card p-3 shadow-card">
              <Button variant="outline" onClick={() => form.reset(toValues(row))} disabled={!form.formState.isDirty || save.isPending}>
                Reset
              </Button>
              <Button type="submit" leftIcon={Save} loading={save.isPending} disabled={!form.formState.isDirty} data-testid="website-save">
                Save
              </Button>
            </div>
          )}
        </div>
      </form>
    </FormProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Hero images                                                          */
/* ------------------------------------------------------------------ */

function HeroImagesCard({ project, canWrite }: { project: ProjectRow; canWrite: boolean }) {
  const { control, setValue, watch } = useFormContext<WebsiteValues>();
  const selected = watch("hero_document_ids");
  const documents = useEntityDocuments("PROJECT", project.id);
  const [uploadOpen, setUploadOpen] = useState(false);
  const images = useMemo(() => (documents.data ?? []).filter((row) => row.mime.startsWith("image/") && !row.is_deleted), [documents.data]);
  const byId = useMemo(() => new Map(images.map((row) => [row.id, row] as const)), [images]);

  const toggle = (id: string) => {
    if (!canWrite) return;
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : selected.length < 12 ? [...selected, id] : selected;
    setValue("hero_document_ids", next, { shouldDirty: true });
  };
  const move = (id: string, direction: -1 | 1) => {
    const index = selected.indexOf(id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= selected.length) return;
    const next = [...selected];
    const [item] = next.splice(index, 1);
    if (item !== undefined) next.splice(target, 0, item);
    setValue("hero_document_ids", next, { shouldDirty: true });
  };

  return (
    <Card>
      <CardHeader
        actions={
          canWrite ? (
            <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => setUploadOpen(true)} data-testid="hero-upload-btn">
              Upload image
            </Button>
          ) : undefined
        }
      >
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="size-4 text-navy-700" aria-hidden="true" /> Hero images
          <span className="money text-xs font-normal text-ink-subtle">{selected.length}/12</span>
        </CardTitle>
        <p className="text-xs text-ink-subtle">Pick from the project's images in order. The first one is the cover used in listings and OpenGraph.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormField control={control} name="hero_document_ids" render={() => <span className="sr-only">Hero images</span>} />
        {selected.length > 0 && (
          <ol className="flex flex-wrap gap-2">
            {selected.map((id, index) => {
              const doc = byId.get(id);
              return (
                <li key={id} className="relative w-28">
                  <div className="aspect-[4/3] overflow-hidden rounded-md border border-gold bg-navy-50">
                    {doc?.thumb_url ? <img src={doc.thumb_url} alt={doc.title} className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-2xs text-ink-subtle">{doc ? "No preview" : "Missing"}</span>}
                  </div>
                  <span className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-navy-950 text-[10px] font-bold text-white">{index === 0 ? <Star className="size-3 text-gold" aria-hidden="true" /> : index + 1}</span>
                  {canWrite && (
                    <div className="mt-1 flex items-center justify-between">
                      <button type="button" aria-label="Move earlier" className="inline-flex size-8 items-center justify-center rounded-sm text-xs text-ink-subtle hover:bg-navy-50 hover:text-navy-950 focus-ring disabled:opacity-40" disabled={index === 0} onClick={() => move(id, -1)}>
                        <span aria-hidden="true">◄</span>
                      </button>
                      <button type="button" className="inline-flex min-h-8 items-center px-1 text-2xs text-danger-fg hover:underline focus-ring" onClick={() => toggle(id)}>
                        Remove
                      </button>
                      <button type="button" aria-label="Move later" className="inline-flex size-8 items-center justify-center rounded-sm text-xs text-ink-subtle hover:bg-navy-50 hover:text-navy-950 focus-ring disabled:opacity-40" disabled={index === selected.length - 1} onClick={() => move(id, 1)}>
                        <span aria-hidden="true">►</span>
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <div>
          <p className="label-caps mb-1.5">Project images {documents.data && <span className="money normal-case tracking-normal">({images.length})</span>}</p>
          {documents.isPending && <Skeleton className="h-20" />}
          {documents.data && images.length === 0 && <p className="text-xs text-ink-subtle">No images uploaded yet.</p>}
          <div className="flex flex-wrap gap-2">
            {images.map((doc) => {
              const active = selected.includes(doc.id);
              return (
                <button
                  key={doc.id}
                  type="button"
                  aria-pressed={active}
                  disabled={!canWrite}
                  onClick={() => toggle(doc.id)}
                  title={doc.title}
                  className={cn("relative aspect-[4/3] w-24 overflow-hidden rounded-md border bg-navy-50 focus-ring", active ? "border-gold ring-2 ring-gold/40" : "border-border hover:border-navy-300")}
                >
                  {doc.thumb_url ? <img src={doc.thumb_url} alt={doc.title} className="size-full object-cover" loading="lazy" /> : <span className="flex size-full items-center justify-center text-2xs text-ink-subtle">{doc.file_name}</span>}
                  {active && <span className="absolute inset-x-0 bottom-0 bg-navy-950/80 py-0.5 text-center text-[10px] font-semibold text-gold">Selected</span>}
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} entityType="PROJECT" entityId={project.id} appliesTo="PROJECT" allowShare={false} imagesOnly title="Upload hero image" onUploaded={(doc: DocumentRow) => toggle(doc.id)} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Brochure + stats                                                     */
/* ------------------------------------------------------------------ */

function BrochureCard({ project, row, canWrite }: { project: ProjectRow; row: ProjectWebsiteSettingsRow; canWrite: boolean }) {
  const { control } = useFormContext<WebsiteValues>();
  const documents = useEntityDocuments("PROJECT", project.id);
  const stats = useBrochureStats(project.id);
  const pdfs = useMemo(() => (documents.data ?? []).filter((doc) => doc.mime === "application/pdf" && !doc.is_deleted), [documents.data]);
  const options = pdfs.map((doc) => ({ value: doc.id, label: doc.title || doc.file_name, description: doc.file_name }));
  const series = stats.data?.sparkline.length ? stats.data.sparkline : row.brochure_downloads_30d;
  const count = stats.data?.download_count ?? row.brochure_download_count;
  const last30 = series.reduce((sum, point) => sum + point.count, 0);

  return (
    <div className="space-y-4">
      <StatCard
        label="Brochure downloads"
        value={formatNumber(count)}
        hint={`${formatNumber(last30)} in the last 30 days`}
        icon={Download}
        loading={stats.isPending && !isApiClientError(stats.error)}
        sparkline={<Sparkline points={series.map((point) => point.count)} width={96} height={36} aria-label="Downloads over the last 30 days" />}
        data-testid="brochure-stats"
      />
      <Card>
        <CardHeader>
          <CardTitle>Brochure</CardTitle>
          <p className="text-xs text-ink-subtle">Gated behind the lead form; served through 15-minute signed links.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormField control={control} name="brochure_document_id" label="Brochure PDF" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={options} placeholder={documents.isPending ? "Loading…" : pdfs.length ? "Pick a PDF" : "Upload a PDF below"} allowClear disabled={!canWrite} data-testid="website-brochure" />} />
          {row.brochure_file_name && (
            <p className="text-xs text-ink-subtle">
              Current: <span className="font-mono">{row.brochure_file_name}</span>
            </p>
          )}
          <DocumentsPanel entityType="PROJECT" entityId={project.id} appliesTo="PROJECT" allowShare={false} bare title="Project files" />
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Repeaters                                                            */
/* ------------------------------------------------------------------ */

type StringListName = "highlights" | "video_urls" | "tour_urls";

function StringRepeater({ name, field, title, placeholder, max, canWrite, type = "text" }: { name: StringListName; field: "text" | "url"; title: string; placeholder: string; max: number; canWrite: boolean; type?: "text" | "url" }) {
  const { control } = useFormContext<WebsiteValues>();
  const items = useFieldArray({ control, name });
  return (
    <FormSection title={title} description={`Up to ${max}.`}>
      <div className="space-y-2">
        {items.fields.map((item, index) => (
          <div key={item.id} className="flex items-start gap-2">
            <FormField
              control={control}
              name={`${name}.${index}.${field}` as `highlights.${number}.text`}
              className="flex-1"
              render={({ field: input }) => <Input {...input} type={type} value={input.value} onChange={(event) => input.onChange(event.target.value)} placeholder={placeholder} maxLength={type === "url" ? 2048 : 120} disabled={!canWrite} aria-label={`${title} ${index + 1}`} />}
            />
            {canWrite && <IconButton icon={X} label="Remove" size="md" onClick={() => items.remove(index)} />}
          </div>
        ))}
        {canWrite && items.fields.length < max && (
          <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => items.append(field === "text" ? ({ text: "" } as never) : ({ url: "" } as never))}>
            Add
          </Button>
        )}
      </div>
    </FormSection>
  );
}

function FaqRepeater({ canWrite }: { canWrite: boolean }) {
  const { control } = useFormContext<WebsiteValues>();
  const faqs = useFieldArray({ control, name: "faqs" });
  return (
    <FormSection title="FAQs" description="Shown on the project page; up to 30.">
      <div className="space-y-3">
        {faqs.fields.map((item, index) => (
          <div key={item.id} className="rounded-md border border-border p-3">
            <div className="flex items-start gap-2">
              <FormField control={control} name={`faqs.${index}.q`} label="Question" className="flex-1" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={200} disabled={!canWrite} />} />
              {canWrite && <IconButton icon={Trash2} label="Remove FAQ" size="md" className="mt-5" onClick={() => faqs.remove(index)} />}
            </div>
            <FormField control={control} name={`faqs.${index}.a`} label="Answer" className="mt-2" render={({ field }) => <Textarea {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} rows={2} maxLength={2000} disabled={!canWrite} />} />
          </div>
        ))}
        {canWrite && faqs.fields.length < 30 && (
          <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => faqs.append({ q: "", a: "" })}>
            Add FAQ
          </Button>
        )}
        {faqs.fields.length === 0 && !canWrite && <Badge variant="neutral">No FAQs</Badge>}
      </div>
    </FormSection>
  );
}
