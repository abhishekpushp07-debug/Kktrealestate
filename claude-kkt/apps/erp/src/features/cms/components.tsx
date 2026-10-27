import { ExternalLink, Image as ImageIcon, Trash2, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { toast } from "sonner";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, type DocumentRow } from "@kkt/contracts";
import { Badge, Button, Checkbox, FormField, FormRow, Input, Textarea } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isoToLocalInput, localInputToIso, publicMediaUrl, uploadCmsMedia, websiteUrl } from "./api";

/* ------------------------------------------------------------------ */
/* Image picker                                                         */
/* ------------------------------------------------------------------ */

export interface MediaPickerProps {
  value: string | null;
  onChange: (documentId: string | null) => void;
  /** Known URL for the current value (row.image_url); the public media URL is used otherwise. */
  previewUrl?: string | null;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Aspect hint for the preview frame. */
  aspect?: "wide" | "square" | "portrait";
  label?: string;
  "data-testid"?: string;
}

const ASPECT = { wide: "aspect-[16/7]", square: "aspect-square", portrait: "aspect-[3/4]" } as const;

/** Upload-or-replace image field storing a document id; previews come from the public media route. */
export function MediaPicker({
  value,
  onChange,
  previewUrl,
  id,
  invalid,
  disabled,
  aspect = "wide",
  label = "Upload image",
  ...rest
}: MediaPickerProps) {
  const { company } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [uploading, setUploading] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    },
    [localUrl],
  );

  const src = localUrl ?? previewUrl ?? publicMediaUrl(value, "medium");

  const pick = async (file: File | null) => {
    if (!file) return;
    if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type) || !file.type.startsWith("image/")) {
      toast.error("Pick a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("The image is larger than 15 MB.");
      return;
    }
    setUploading(true);
    try {
      const doc: DocumentRow = await uploadCmsMedia(file, company?.id ?? null, file.name.replace(/\.[^.]+$/, ""));
      onChange(doc.id);
      setLocalUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
      toast.success("Image uploaded");
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={cn("space-y-2", disabled && "opacity-60")} data-testid={rest["data-testid"]}>
      <div
        className={cn(
          "relative flex w-full max-w-md items-center justify-center overflow-hidden rounded-md border bg-surface",
          ASPECT[aspect],
          invalid ? "border-danger" : "border-border",
        )}
      >
        {src ? (
          <img src={src} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-8 text-ink-subtle" aria-hidden="true" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled || uploading}
          onChange={(event) => void pick(event.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          leftIcon={Upload}
          loading={uploading}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {value ? "Replace" : label}
        </Button>
        {value && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leftIcon={Trash2}
            disabled={disabled || uploading}
            onClick={() => {
              onChange(null);
              setLocalUrl(null);
            }}
          >
            Remove
          </Button>
        )}
        <span className="text-2xs text-ink-subtle">JPG, PNG or WebP · ≤ 15 MB</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Date-time input bound to RFC 3339                                    */
/* ------------------------------------------------------------------ */

export interface DateTimeInputProps {
  value: string | null;
  onChange: (iso: string | null) => void;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  min?: string | null;
  "data-testid"?: string;
}

/** Native datetime-local picker on the IST wall clock (whatever the browser zone); stores an ISO instant and shows the IST rendering underneath. */
export function DateTimeInput({ value, onChange, id, invalid, disabled, min, ...rest }: DateTimeInputProps) {
  return (
    <div className="min-w-0">
      <Input
        id={id}
        type="datetime-local"
        value={isoToLocalInput(value)}
        min={min ? isoToLocalInput(min) : undefined}
        onChange={(event) => onChange(localInputToIso(event.target.value))}
        invalid={invalid}
        disabled={disabled}
        className="money"
        data-testid={rest["data-testid"]}
      />
      {value && <p className="money mt-1 text-2xs text-ink-subtle">{formatDateTime(value, { zone: true })}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tags input                                                           */
/* ------------------------------------------------------------------ */

export interface TagsInputProps {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  id?: string;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  "data-testid"?: string;
}

/** Chips + text input; Enter or comma adds, Backspace on empty removes the last. */
export function TagsInput({
  value,
  onChange,
  id,
  max = 10,
  maxLength = 30,
  placeholder = "Add a tag…",
  invalid,
  disabled,
  ...rest
}: TagsInputProps) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const tag = raw.trim().replace(/,+$/, "").slice(0, maxLength);
    if (!tag || value.includes(tag) || value.length >= max) return;
    onChange([...value, tag]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
      setDraft("");
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1",
        invalid ? "border-danger" : "border-border-strong",
        disabled && "bg-surface",
      )}
      data-testid={rest["data-testid"]}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="navy" className="gap-1 pr-1">
          {tag}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              className="rounded-full p-0.5 hover:bg-navy-800 focus-ring"
              onClick={() => onChange(value.filter((item) => item !== tag))}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </Badge>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) {
            add(draft);
            setDraft("");
          }
        }}
        placeholder={value.length >= max ? `Max ${max} tags` : placeholder}
        disabled={disabled || value.length >= max}
        maxLength={maxLength}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle"
        aria-label="Add tag"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SEO field group                                                      */
/* ------------------------------------------------------------------ */

export interface SeoValues {
  title: string;
  description: string;
  og_image_document_id: string | null;
  noindex: boolean;
}

export const EMPTY_SEO: SeoValues = { title: "", description: "", og_image_document_id: null, noindex: false };

export function seoToValues(
  seo:
    | { title?: string | null; description?: string | null; og_image_document_id?: string | null; noindex?: boolean }
    | null
    | undefined,
): SeoValues {
  return {
    title: seo?.title ?? "",
    description: seo?.description ?? "",
    og_image_document_id: seo?.og_image_document_id ?? null,
    noindex: seo?.noindex ?? false,
  };
}

/** SEO values → contract shape (null when every field is empty). */
export function seoToPayload(
  seo: SeoValues,
): { title: string | null; description: string | null; og_image_document_id: string | null; noindex: boolean } | null {
  const title = seo.title.trim() || null;
  const description = seo.description.trim() || null;
  if (!title && !description && !seo.og_image_document_id && !seo.noindex) return null;
  return { title, description, og_image_document_id: seo.og_image_document_id, noindex: seo.noindex };
}

/** Title / description / OG image / noindex bound to `<prefix>.title` etc. */
export function SeoFields<TFieldValues extends FieldValues>({
  control,
  prefix,
  disabled,
}: {
  control: Control<TFieldValues>;
  prefix: string;
  disabled?: boolean;
}) {
  const path = (name: string) => `${prefix}.${name}` as FieldPath<TFieldValues>;
  return (
    <div className="space-y-3">
      <FormRow>
        <FormField
          control={control}
          name={path("title")}
          label="SEO title"
          hint="≤ 70 characters; falls back to the page title"
          render={({ field }) => (
            <Input
              id={field.id}
              value={String(field.value ?? "")}
              onChange={field.onChange}
              onBlur={field.onBlur}
              maxLength={70}
              invalid={field.invalid}
              disabled={disabled}
            />
          )}
        />
        <FormField
          control={control}
          name={path("noindex")}
          label="Search engines"
          render={({ field }) => (
            <Checkbox
              id={field.id}
              checked={Boolean(field.value)}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              label="Hide from search engines (noindex)"
              disabled={disabled}
            />
          )}
        />
      </FormRow>
      <FormField
        control={control}
        name={path("description")}
        label="Meta description"
        hint="≤ 160 characters"
        render={({ field }) => (
          <Textarea
            id={field.id}
            value={String(field.value ?? "")}
            onChange={field.onChange}
            onBlur={field.onBlur}
            rows={2}
            maxLength={160}
            invalid={field.invalid}
            disabled={disabled}
          />
        )}
      />
      <FormField
        control={control}
        name={path("og_image_document_id")}
        label="Social share image"
        hint="1200 × 630 works best"
        render={({ field }) => (
          <MediaPicker
            id={field.id}
            value={typeof field.value === "string" ? field.value : null}
            onChange={field.onChange}
            aspect="wide"
            disabled={disabled}
          />
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* View-on-site link                                                    */
/* ------------------------------------------------------------------ */

export function SiteLink({ path, children = "View on site" }: { path: string; children?: ReactNode }) {
  const href = websiteUrl(path);
  if (!href) return null;
  return (
    <Button asChild size="sm" variant="outline" leftIcon={ExternalLink}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    </Button>
  );
}

/** Published / draft chip for CMS rows. */
export function PublishedChip({
  published,
  labels = ["Published", "Draft"],
}: {
  published: boolean;
  labels?: [string, string];
}) {
  return <Badge variant={published ? "success" : "neutral"}>{published ? labels[0] : labels[1]}</Badge>;
}
