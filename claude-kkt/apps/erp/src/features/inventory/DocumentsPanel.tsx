import { Download, EyeOff, FileText, Image as ImageIcon, Paperclip, Share2, Upload } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, type DocumentAppliesTo, type DocumentEntityType, type DocumentRow, type DocumentTypeRow } from "@kkt/contracts";
import { Badge, Button, Checkbox, EmptyState, ErrorState, FieldWrapper, Input, Select, SimpleDialog, Skeleton, Switch, Tooltip } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useMasterRows } from "@/features/masters/api";
import { fetchDocumentLink, inventoryKeys, uploadDocument, useEntityDocuments } from "./api";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface DocumentsPanelProps {
  entityType: DocumentEntityType;
  entityId: string;
  /** Restricts the document-type picker to types that apply to this entity (defaults to entityType when it is one of the master values). */
  appliesTo?: DocumentAppliesTo;
  /** Hide the share-with-customer switch (projects, blocks). */
  allowShare?: boolean;
  /** Called after an upload so the parent can react (e.g. select the new hero image). */
  onUploaded?: (document: DocumentRow) => void;
  /** Render as a flat list without the card frame. */
  bare?: boolean;
  /** Only images (website hero pictures, construction photos). */
  imagesOnly?: boolean;
  /** Extra per-row action (e.g. "Use as hero"). */
  rowAction?: (document: DocumentRow) => ReactNode;
  className?: string;
  title?: string;
}

const APPLIES: readonly DocumentAppliesTo[] = ["CUSTOMER", "BOOKING", "PROJECT", "BLOCK", "FLAT", "PAYMENT"];

/** Documents of one entity: list with signed-link downloads and an upload dialog (type, sensitivity, share flag). */
export function DocumentsPanel({ entityType, entityId, appliesTo, allowShare = true, onUploaded, bare = false, imagesOnly = false, rowAction, className, title = "Documents" }: DocumentsPanelProps) {
  const { can } = useAuth();
  const canUpload = can("document.write");
  const canReveal = can("customer.kyc_view");
  const documents = useEntityDocuments(entityType, entityId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const rows = useMemo(() => (documents.data ?? []).filter((row) => !row.is_deleted && (!imagesOnly || row.mime.startsWith("image/"))), [documents.data, imagesOnly]);

  const open = async (row: DocumentRow) => {
    setOpening(row.id);
    try {
      const url = await fetchDocumentLink(row.id);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setOpening(null);
    }
  };

  const applies = appliesTo ?? (APPLIES.includes(entityType as DocumentAppliesTo) ? (entityType as DocumentAppliesTo) : undefined);

  const body = (
    <>
      {documents.isPending && (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-10" />
          ))}
        </div>
      )}
      {documents.isError && <ErrorState compact error={documents.error} onRetry={() => void documents.refetch()} />}
      {documents.data && rows.length === 0 && (
        <EmptyState
          compact
          icon={Paperclip}
          title={imagesOnly ? "No images yet" : "No documents yet"}
          description={canUpload ? "Upload PDFs or images up to 15 MB." : "Nothing has been uploaded for this record."}
          action={canUpload ? <Button size="sm" leftIcon={Upload} onClick={() => setUploadOpen(true)}>Upload</Button> : undefined}
        />
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const locked = row.is_sensitive && !canReveal;
            const Icon = row.mime.startsWith("image/") ? ImageIcon : FileText;
            return (
              <li key={row.id} className="flex items-center gap-3 py-2">
                {row.thumb_url ? (
                  <img src={row.thumb_url} alt="" className="size-10 shrink-0 rounded-sm border border-border object-cover" loading="lazy" />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-navy-50 text-navy-700">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{row.title || row.file_name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-2xs text-ink-subtle">
                    {row.document_type_name && <span>{row.document_type_name}</span>}
                    <span className="money">{formatBytes(row.size_bytes)}</span>
                    <span>{formatDateTime(row.created_at)}</span>
                    {row.uploaded_by_name && <span>by {row.uploaded_by_name}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {row.is_sensitive && (
                    <Tooltip content="Sensitive (KYC): download needs the KYC-view permission">
                      <span className="inline-flex">
                        <Badge variant="danger">
                          <EyeOff className="size-3" aria-hidden="true" /> Sensitive
                        </Badge>
                      </span>
                    </Tooltip>
                  )}
                  {row.shared_with_customer && (
                    <Badge variant="info">
                      <Share2 className="size-3" aria-hidden="true" /> Shared
                    </Badge>
                  )}
                  {rowAction?.(row)}
                  <Button variant="outline" size="sm" leftIcon={Download} loading={opening === row.id} disabled={locked} onClick={() => void open(row)} aria-label={`Download ${row.title || row.file_name}`} data-testid={`document-download-${row.id}`}>
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        entityType={entityType}
        entityId={entityId}
        appliesTo={applies}
        allowShare={allowShare}
        imagesOnly={imagesOnly}
        onUploaded={onUploaded}
      />
    </>
  );

  if (bare) {
    return (
      <div className={className}>
        {canUpload && rows.length > 0 && (
          <div className="mb-2 flex justify-end">
            <Button size="sm" variant="outline" leftIcon={Upload} onClick={() => setUploadOpen(true)}>
              Upload
            </Button>
          </div>
        )}
        {body}
      </div>
    );
  }

  return (
    <section className={cn("rounded-lg border border-border bg-card shadow-card", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="font-display text-md font-bold text-navy-950">
          {title} {documents.data && <span className="money ml-1 text-xs font-normal text-ink-subtle">{formatNumber(rows.length)}</span>}
        </h3>
        {canUpload && (
          <Button size="sm" variant="outline" leftIcon={Upload} onClick={() => setUploadOpen(true)} data-testid="documents-upload-btn">
            Upload
          </Button>
        )}
      </header>
      <div className="px-4 py-2">{body}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Upload dialog                                                        */
/* ------------------------------------------------------------------ */

export interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: DocumentEntityType;
  entityId: string;
  appliesTo?: DocumentAppliesTo | undefined;
  allowShare?: boolean;
  imagesOnly?: boolean;
  onUploaded?: ((document: DocumentRow) => void) | undefined;
  title?: string;
}

export function UploadDocumentDialog({ open, onOpenChange, entityType, entityId, appliesTo, allowShare = true, imagesOnly = false, onUploaded, title = "Upload document" }: UploadDocumentDialogProps) {
  const fileId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentTypeId, setDocumentTypeId] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [shared, setShared] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const types = useMasterRows<DocumentTypeRow>("document-types", { enabled: open });

  const typeOptions = useMemo(
    () =>
      (types.data ?? [])
        .filter((type) => !appliesTo || type.applies_to.includes(appliesTo))
        .map((type) => ({ value: type.id, label: type.name, description: type.is_kyc ? "KYC — always sensitive, never shared" : undefined })),
    [types.data, appliesTo],
  );
  const selectedType = types.data?.find((type) => type.id === documentTypeId) ?? null;
  const forcedSensitive = selectedType?.is_kyc === true;

  useEffect(() => {
    if (!open) {
      setFile(null);
      setDocumentTypeId(null);
      setDocTitle("");
      setSensitive(false);
      setShared(false);
      setFileError(null);
    }
  }, [open]);

  useEffect(() => {
    if (forcedSensitive) {
      setSensitive(true);
      setShared(false);
    }
  }, [forcedSensitive]);

  const upload = useMutationWithToast<DocumentRow, void>({
    mutationFn: () => {
      if (!file) throw new Error("Pick a file first");
      return uploadDocument({
        file,
        entity_type: entityType,
        entity_id: entityId,
        document_type_id: documentTypeId,
        title: docTitle.trim() || undefined,
        is_sensitive: sensitive || forcedSensitive,
        shared_with_customer: allowShare && !forcedSensitive ? shared : false,
      });
    },
    successMessage: "Document uploaded",
    invalidate: [inventoryKeys.documents(entityType, entityId)],
    onSuccess: (document) => {
      onUploaded?.(document);
      onOpenChange(false);
    },
  });

  const pick = (next: File | null) => {
    setFileError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(next.type)) {
      setFileError("Only PDF, JPG, PNG or WebP files are accepted.");
      setFile(null);
      return;
    }
    if (imagesOnly && !next.type.startsWith("image/")) {
      setFileError("Pick an image (JPG, PNG or WebP).");
      setFile(null);
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setFileError("The file is larger than 15 MB.");
      setFile(null);
      return;
    }
    setFile(next);
    if (!docTitle) setDocTitle(next.name.replace(/\.[^.]+$/, ""));
  };

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !upload.isPending && onOpenChange(next)}
      title={title}
      description="PDF, JPG, PNG or WebP up to 15 MB. The file signature is verified on the server."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button leftIcon={Upload} loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()} data-testid="upload-document-submit">
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldWrapper label="File" required id={fileId} error={fileError ?? undefined}>
          <input
            ref={inputRef}
            id={fileId}
            type="file"
            accept={imagesOnly ? "image/jpeg,image/png,image/webp" : "application/pdf,image/jpeg,image/png,image/webp"}
            onChange={(event) => pick(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-card file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-navy-950 hover:file:bg-navy-50 focus-ring"
            data-testid="upload-document-file"
          />
          {file && (
            <p className="mt-1 text-xs text-ink-subtle">
              {file.name} · <span className="money">{formatBytes(file.size)}</span>
            </p>
          )}
        </FieldWrapper>
        <FieldWrapper label="Document type" hint={types.isError ? "Could not load document types" : undefined}>
          {(control) => <Select id={control.id} value={documentTypeId} onValueChange={setDocumentTypeId} options={typeOptions} placeholder={types.isPending ? "Loading…" : "Optional"} allowClear data-testid="upload-document-type" />}
        </FieldWrapper>
        <FieldWrapper label="Title">
          {(control) => <Input id={control.id} value={docTitle} onChange={(event) => setDocTitle(event.target.value)} maxLength={200} placeholder="Shown to staff (and the customer when shared)" />}
        </FieldWrapper>
        <div className="space-y-2">
          <Checkbox checked={sensitive || forcedSensitive} disabled={forcedSensitive} onCheckedChange={(checked) => setSensitive(checked === true)} label="Sensitive" description={forcedSensitive ? "KYC documents are always sensitive: only users with KYC-view may download them." : "Download needs the KYC-view permission"} />
          {allowShare && <Switch checked={shared && !forcedSensitive} disabled={forcedSensitive} onCheckedChange={setShared} label="Share with customer" description={forcedSensitive ? "KYC documents cannot be shared" : "Visible in the customer portal"} />}
        </div>
      </div>
    </SimpleDialog>
  );
}
