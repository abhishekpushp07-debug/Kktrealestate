import { ArrowLeft, Eye, EyeOff, ExternalLink, Save, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  CmsPostCreateSchema,
  CmsPostUpdateSchema,
  POST_STATUS_LABELS,
  type CmsPostRow,
  type PostStatus,
} from "@kkt/contracts";
import { z } from "zod";
import {
  applyServerErrors,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  FormError,
  FormField,
  FormRow,
  Input,
  PageHeader,
  Skeleton,
  StatusChip,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { controlOf, Notice } from "@/features/inventory/components";
import { contractResolver } from "@/features/shared/contractResolver";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { CMS_BREADCRUMBS } from "./CmsLayout";
import { MarkdownEditor } from "./Markdown";
import { EMPTY_SEO, MediaPicker, SeoFields, TagsInput, seoToPayload, seoToValues, type SeoValues } from "./components";
import { cmsKeys, POSTS_PATH, slugify, usePost, websiteUrl } from "./api";
import { markdownExcerpt } from "./markdown";

interface PostValues {
  title: string;
  slug: string;
  excerpt: string;
  body_md: string;
  cover_document_id: string | null;
  tags: string[];
  seo: SeoValues;
}

const EMPTY: PostValues = {
  title: "",
  slug: "",
  excerpt: "",
  body_md: "",
  cover_document_id: null,
  tags: [],
  seo: { ...EMPTY_SEO },
};

function toValues(row: CmsPostRow): PostValues {
  return {
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt ?? "",
    body_md: row.body_md,
    cover_document_id: row.cover_document_id,
    tags: [...row.tags],
    seo: seoToValues(row.seo),
  };
}

const toBody = z.looseObject({}).transform((raw): unknown => {
  const values = raw as unknown as PostValues;
  return {
    title: values.title.trim(),
    slug: values.slug.trim().toLowerCase(),
    excerpt: values.excerpt.trim() || null,
    body_md: values.body_md,
    cover_document_id: values.cover_document_id,
    tags: values.tags,
    seo: seoToPayload(values.seo),
  };
});

const CreateSchema = toBody.pipe(CmsPostCreateSchema.omit({ status: true, published_at: true }));
const UpdateSchema = toBody.pipe(CmsPostUpdateSchema.omit({ version: true, status: true, published_at: true }));

/** `/website/posts/new` and `/website/posts/:id` — split-preview Markdown editor with slug, cover, tags, SEO and publish controls. */
export default function PostEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const post = usePost(isNew ? null : id);

  if (isNew) return <PostEditor row={null} />;
  if (post.isPending) return <Skeleton className="h-[40rem] rounded-lg" />;
  if (post.isError) {
    if (post.error.status === 404) return <NotFoundPage />;
    return (
      <ErrorState
        error={post.error}
        onRetry={() => void post.refetch()}
        className="rounded-lg border border-border bg-card"
      />
    );
  }
  return <PostEditor row={post.data} />;
}

function useAutoSlug(form: UseFormReturn<PostValues, unknown, unknown>, enabled: boolean) {
  const title = useWatch({ control: form.control, name: "title" });
  useEffect(() => {
    if (!enabled || form.getFieldState("slug").isDirty) return;
    form.setValue("slug", slugify(title ?? ""));
  }, [title, enabled, form]);
}

function PostEditor({ row }: { row: CmsPostRow | null }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can("cms.write");
  const schema = row ? UpdateSchema : CreateSchema;
  const resolver = useMemo(() => contractResolver<PostValues, unknown>(schema), [schema]);
  const form = useForm<PostValues, unknown, unknown>({
    resolver,
    defaultValues: row ? toValues(row) : EMPTY,
    mode: "onTouched",
  });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<PostStatus | null>(null);
  useAutoSlug(form, row === null);

  useEffect(() => {
    if (row) form.reset(toValues(row));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed the form only when the post changes version
  }, [row?.version]);

  const save = useMutationWithToast<CmsPostRow, { body: Record<string, unknown>; status?: PostStatus }>({
    mutationFn: ({ body, status }) => {
      const statusPatch = status
        ? {
            status,
            published_at:
              status === "PUBLISHED" ? (row?.published_at ?? new Date().toISOString()) : (row?.published_at ?? null),
          }
        : {};
      return row
        ? api.patch<CmsPostRow>(
            `${POSTS_PATH}/${row.id}`,
            { ...body, ...statusPatch, version: row.version },
            { version: row.version },
          )
        : api.post<CmsPostRow>(POSTS_PATH, {
            ...body,
            status: status ?? "DRAFT",
            ...(status === "PUBLISHED" ? { published_at: new Date().toISOString() } : {}),
          });
    },
    successMessage: (saved, variables) =>
      variables.status === "PUBLISHED"
        ? "Post published"
        : variables.status === "DRAFT" && row?.status === "PUBLISHED"
          ? "Post unpublished"
          : saved.status === "DRAFT"
            ? "Draft saved"
            : "Post saved",
    invalidate: [[POSTS_PATH], ...(row ? [cmsKeys.post(row.id)] : [])],
    entityLabel: "This post",
    errorMessage: false,
    onError: (error) => {
      if (error.isVersionConflict) return;
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
    onSuccess: (saved) => {
      setConfirm(null);
      if (!row) navigate(`/website/posts/${saved.id}`, { replace: true });
    },
  });

  const submit = (status?: PostStatus) =>
    form.handleSubmit((output) => {
      setServerError(null);
      save.mutate({ body: output as Record<string, unknown>, status });
    })();

  const disabled = !canWrite || save.isPending;
  const body = useWatch({ control, name: "body_md" });
  const excerpt = useWatch({ control, name: "excerpt" });
  const slug = useWatch({ control, name: "slug" });
  const published = row?.status === "PUBLISHED";
  const siteHref = row && published ? websiteUrl(`/blog/${row.slug}`) : null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-4"
    >
      <PageHeader
        title={row ? row.title : "New post"}
        titleAddon={
          row ? (
            <StatusChip status={row.status} label={POST_STATUS_LABELS[row.status]} />
          ) : (
            <StatusChip status="DRAFT" label="Unsaved" />
          )
        }
        description={
          row
            ? `Last edited ${formatDateTime(row.updated_at)}${row.author_name ? ` · by ${row.author_name}` : ""}${row.published_at ? ` · published ${formatDateTime(row.published_at)}` : ""}`
            : "Drafts are saved privately; publish when the article is ready."
        }
        backTo="/website/posts"
        breadcrumbs={[
          ...CMS_BREADCRUMBS,
          { label: "Posts", to: "/website/posts" },
          { label: row ? row.title : "New post" },
        ]}
        actions={
          <>
            <Button asChild variant="ghost" leftIcon={ArrowLeft} className="hidden sm:inline-flex">
              <Link to="/website/posts">
                <ArrowLeft aria-hidden="true" /> All posts
              </Link>
            </Button>
            {siteHref && (
              <Button asChild variant="outline" leftIcon={ExternalLink}>
                <a href={siteHref} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" /> View
                </a>
              </Button>
            )}
            {canWrite && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  leftIcon={Save}
                  loading={save.isPending && !confirm}
                  onClick={() => void submit(published ? undefined : "DRAFT")}
                  data-testid="post-save-draft"
                >
                  {published ? "Save" : "Save draft"}
                </Button>
                {published ? (
                  <Button
                    type="button"
                    variant="outline"
                    leftIcon={EyeOff}
                    onClick={() => setConfirm("DRAFT")}
                    disabled={save.isPending}
                    data-testid="post-unpublish"
                  >
                    Unpublish
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="gold"
                    leftIcon={Send}
                    onClick={() => setConfirm("PUBLISHED")}
                    disabled={save.isPending}
                    data-testid="post-publish"
                  >
                    Publish
                  </Button>
                )}
              </>
            )}
          </>
        }
      />
      {!canWrite && <Notice tone="info">Read-only: editing posts needs the “cms.write” permission.</Notice>}
      <FormError error={serverError} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Card>
            <CardContent className="space-y-4 pt-4">
              <FormField
                control={control}
                name="title"
                label="Title"
                required
                render={({ field }) => (
                  <Input
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    maxLength={160}
                    placeholder="Headline"
                    className="text-base font-semibold"
                    invalid={field.invalid}
                    disabled={disabled}
                    data-testid="post-title"
                  />
                )}
              />
              <FormField
                control={control}
                name="slug"
                label="Slug"
                required
                hint={`Public URL: /blog/${slug || "…"}`}
                render={({ field }) => (
                  <Input
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    maxLength={120}
                    prefix="/blog/"
                    className="font-mono"
                    invalid={field.invalid}
                    disabled={disabled}
                    data-testid="post-slug"
                  />
                )}
              />
              <FormField
                control={control}
                name="excerpt"
                label="Excerpt"
                hint={
                  excerpt
                    ? `${excerpt.length}/300`
                    : `Shown on the blog index and social cards. Suggested: “${markdownExcerpt(body ?? "", 120) || "…"}”`
                }
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
                name="body_md"
                label="Body"
                required
                render={({ field }) => (
                  <MarkdownEditor
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    invalid={field.invalid}
                    disabled={disabled}
                    rows={22}
                    data-testid="post-body"
                  />
                )}
              />
            </CardContent>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Eye className="size-4 text-gold-text" aria-hidden="true" /> Cover & tags
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={control}
                name="cover_document_id"
                label="Cover image"
                render={({ field }) => (
                  <MediaPicker
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    previewUrl={row?.cover_document_id === field.value ? row.cover_url : null}
                    aspect="wide"
                    label="Upload cover"
                    disabled={disabled}
                  />
                )}
              />
              <FormField
                control={control}
                name="tags"
                label="Tags"
                hint="Up to 10; Enter or comma adds one"
                render={({ field }) => (
                  <TagsInput
                    id={field.id}
                    value={field.value}
                    onChange={field.onChange}
                    invalid={field.invalid}
                    disabled={disabled}
                    data-testid="post-tags"
                  />
                )}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">SEO</CardTitle>
            </CardHeader>
            <CardContent>
              <SeoFields control={control} prefix="seo" disabled={disabled} />
            </CardContent>
          </Card>
          <FormRow columns={1}>
            <p className="text-2xs text-ink-subtle">
              Markdown only — raw HTML is shown as text on the website, never executed.
            </p>
          </FormRow>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && !save.isPending && setConfirm(null)}
        title={confirm === "PUBLISHED" ? "Publish this post?" : "Unpublish this post?"}
        description={
          confirm === "PUBLISHED"
            ? "It appears on the website and in the sitemap immediately, with your current edits."
            : "It disappears from the website; the content is kept as a draft."
        }
        confirmLabel={confirm === "PUBLISHED" ? "Publish" : "Unpublish"}
        onConfirm={async () => {
          if (confirm) await submit(confirm);
        }}
      />
    </form>
  );
}
