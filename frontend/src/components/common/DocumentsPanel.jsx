import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Lock, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMasterOptions } from "@/hooks/useList";
import { Button } from "@/components/ui/button";
import { Combobox } from "./Combobox";
import { EmptyState } from "./Bits";
import { fmtDateTime } from "@/lib/format";

export function DocumentsPanel({ entityType, entityId, canWrite = true, initial = null }) {
  const { can } = useAuth();
  const [items, setItems] = useState(initial?.items || []);
  const [docType, setDocType] = useState(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef();
  const { options: fetchedTypes } = useMasterOptions(initial ? null : "document-types");
  const types = initial ? (initial.types || []).map((x) => ({ value: x.id, label: x.name, sub: x.code })) : fetchedTypes;
  const load = useCallback(() => api.get("/documents", { params: { entity_type: entityType, entity_id: entityId } }).then((r) => setItems(r.data.items)).catch(() => {}), [entityType, entityId]);
  useEffect(() => { if (!initial) load(); }, [load, initial]);
  useEffect(() => { if (initial?.items) setItems(initial.items); }, [initial]);

  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f); fd.append("entity_type", entityType); fd.append("entity_id", entityId);
      if (docType) fd.append("document_type_id", docType);
      try { await api.post("/documents", fd, { headers: { "Content-Type": "multipart/form-data" } }); toast.success(`${f.name} uploaded`); }
      catch (e) { toast.error(errMsg(e)); }
    }
    setBusy(false); load();
  };
  const open = async (d) => {
    try { const r = await api.get(`/documents/${d.id}/download`, { responseType: "blob" }); window.open(URL.createObjectURL(r.data), "_blank"); }
    catch (e) { toast.error(e.response?.status === 403 ? "Sensitive document — KYC view permission required" : errMsg(e)); }
  };
  const share = async (d) => { try { await api.patch(`/documents/${d.id}/share`, { shared_with_customer: !d.shared_with_customer, version: d.version ?? 0 }); toast.success(d.shared_with_customer ? "Unshared" : "Shared with customer"); load(); } catch (e) { toast.error(errMsg(e)); } };
  const remove = async (d) => { try { await api.delete(`/documents/${d.id}`); toast.success("Document removed"); load(); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div data-testid="documents-panel">
      {canWrite && <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-txt-secondary">Document type</p><Combobox options={types} value={docType} onChange={setDocType} placeholder="Any / unspecified" ariaLabel="Document type" testId="doc-type-select" /></div>
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()} className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-4 text-sm transition-colors ${drag ? "border-gold bg-gold-light/40" : "border-slate-300 bg-white hover:border-ink-950"}`} data-testid="doc-dropzone">
          <Upload className="h-4 w-4 text-ink-950" />{busy ? "Uploading…" : "Drag & drop PDF/JPG/PNG/WEBP here, or click to browse (max 15 MB)"}
          <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => upload(e.target.files)} data-testid="doc-file-input" />
        </div>
      </div>}
      {items.length === 0 ? <EmptyState icon={FileText} title="No documents" description="Uploaded files are stored in Emergent object storage." /> : (
        <ul className="divide-y rounded-lg border bg-white" data-testid="documents-list">
          {items.map((d) => <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm" data-testid={`doc-row-${d.id}`}>
            {d.mime?.startsWith("image/") ? <ImageIcon className="h-4 w-4 text-txt-muted" /> : <FileText className="h-4 w-4 text-txt-muted" />}
            <button onClick={() => open(d)} className="font-medium text-ink-950 hover:underline" data-testid={`doc-open-${d.id}`}>{d.file_name}</button>
            {d.document_type_name && <span className="rounded-full bg-warm-50 px-2 py-0.5 text-[11px] text-txt-secondary">{d.document_type_name}</span>}
            {d.is_sensitive && <span className="flex items-center gap-1 rounded-full bg-amber2-50 px-2 py-0.5 text-[11px] text-amber2"><Lock className="h-3 w-3" />KYC</span>}
            {canWrite && can("sales.customer.edit") && !d.is_sensitive && <button onClick={() => share(d)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.shared_with_customer ? "bg-sage-50 text-sage" : "bg-warm-50 text-txt-secondary"}`} data-testid={`doc-share-${d.id}`}>{d.shared_with_customer ? "Shared with customer" : "Share to portal"}</button>}
            <span className="ml-auto text-xs text-txt-secondary">{(d.size / 1024).toFixed(0)} KB · {d.uploaded_by_name} · {fmtDateTime(d.uploaded_at)}</span>
            {canWrite && can("sales.customer.edit") && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete document" onClick={() => remove(d)} data-testid={`doc-delete-${d.id}`}><Trash2 className="h-3.5 w-3.5 text-txt-secondary" /></Button>}
          </li>)}
        </ul>
      )}
    </div>
  );
}
