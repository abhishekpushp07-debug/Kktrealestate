import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, Eye, EyeOff, Globe, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { ResumableUpload } from "@/components/common/ResumableUpload";
import { FileGallery } from "@/components/common/FileGallery";

const BK = process.env.REACT_APP_BACKEND_URL;

export function ConstructionPhotos({ blockId, milestones, projectId }) {
  const { can } = useAuth();
  const [photos, setPhotos] = useState([]);
  const [seq, setSeq] = useState(null);
  const [note, setNote] = useState("");
  const [galleryKey, setGalleryKey] = useState(0);
  const fileRef = useRef();
  const load = useCallback(() => api.get(`/blocks/${blockId}/photos`).then((r) => setPhotos(r.data.items)).catch(() => {}), [blockId]);
  useEffect(() => { load(); }, [load]);
  const done = (milestones || []).filter((m) => m.status === "Completed");
  const upload = async (files) => {
    if (!files.length || seq == null) return;
    const fd = new FormData(); [...files].forEach((f) => fd.append("files", f)); fd.append("caption", window.prompt("Caption (optional)") || ""); fd.append("taken_on", new Date().toISOString().slice(0, 10));
    try { await api.post(`/blocks/${blockId}/milestones/${seq}/photos`, fd); toast.success("Photos uploaded"); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const patch = async (p, body) => { try { await api.patch(`/photos/${p.id}`, { ...body, version: p.version ?? 0 }); load(); } catch (e) { toast.error(errMsg(e)); } };
  const del = async (p) => { if (!window.confirm("Delete photo?")) return; try { await api.delete(`/photos/${p.id}`); load(); } catch (e) { toast.error(errMsg(e)); } };
  const saveNote = async () => { try { await api.patch(`/blocks/${blockId}/milestones/${seq}/note`, { progress_note: note, version: 0 }); toast.success("Progress note saved"); } catch (e) { toast.error(errMsg(e)); } };
  if (!can("construction.photo.view")) return null;
  const canEdit = can("construction.photo.upload");
  return (
    <div className="card p-5" data-testid="construction-photos-panel">
      <div className="mb-3 flex flex-wrap items-center gap-2"><Camera className="h-4 w-4 text-gold" /><h3 className="text-base font-bold text-ink-950">Construction photos</h3><span className="text-xs text-txt-secondary">{photos.length} photos · customers see those marked visible</span>
        {canEdit && <div className="ml-auto flex items-center gap-2"><select className="h-9 rounded-md border px-2 text-sm" value={seq ?? ""} onChange={(e) => { setSeq(Number(e.target.value)); setNote((milestones || []).find((m) => m.seq === Number(e.target.value))?.progress_note || ""); }} data-testid="photo-milestone-select"><option value="">Select milestone…</option>{done.map((m) => <option key={m.seq} value={m.seq}>{m.seq}. {m.name}</option>)}</select><input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="photo-file-input" /><Button size="sm" className="bg-ink-950 hover:bg-ink-800" disabled={seq == null} onClick={() => fileRef.current.click()} data-testid="photo-upload-btn">Upload</Button></div>}
      </div>
      {canEdit && seq != null && <div className="mb-4 flex gap-2"><input className="h-9 flex-1 rounded-md border px-3 text-sm" placeholder="Progress note shown to customers for this milestone" value={note} onChange={(e) => setNote(e.target.value)} data-testid="photo-progress-note" /><Button size="sm" variant="outline" onClick={saveNote} data-testid="photo-note-save">Save note</Button></div>}
      {done.map((m) => { const ps = photos.filter((p) => p.milestone_seq === m.seq); if (!ps.length) return null; return <div key={m.seq} className="mb-4"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-txt-secondary">{m.seq}. {m.name}</p><div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">{ps.map((p) => <figure key={p.id} className={`group relative overflow-hidden rounded-lg border ${p.visible_to_customers ? "" : "opacity-60"}`} data-testid={`erp-photo-${p.id}`}><img src={`${BK}${p.url}?size=thumb`} loading="lazy" alt={p.caption} className="aspect-square w-full object-cover" /><figcaption className="truncate px-1.5 py-1 text-[10px] text-txt-secondary">{p.caption || "—"}</figcaption>{canEdit && <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"><button className="grid h-7 w-7 place-items-center rounded bg-white/90" title={p.visible_to_customers ? "Hide from customers" : "Show to customers"} onClick={() => patch(p, { visible_to_customers: !p.visible_to_customers })} data-testid={`photo-vis-${p.id}`}>{p.visible_to_customers ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button><button className={`grid h-7 w-7 place-items-center rounded ${p.show_on_website ? "bg-gold" : "bg-white/90"}`} title="Toggle website" onClick={() => patch(p, { show_on_website: !p.show_on_website })} data-testid={`photo-web-${p.id}`}><Globe className="h-3.5 w-3.5" /></button><button className="grid h-7 w-7 place-items-center rounded bg-white/90 text-brick" onClick={() => del(p)} data-testid={`photo-del-${p.id}`}><Trash2 className="h-3.5 w-3.5" /></button></div>}{!p.visible_to_customers && <span className="absolute left-1 top-1 rounded bg-slate-800/80 px-1.5 text-[10px] text-white">Hidden</span>}</figure>)}</div></div>; })}
      {photos.length === 0 && <p className="text-sm text-txt-muted">No photos yet.</p>}
      <div className="mt-5 border-t pt-4" data-testid="stage-files-section">
        <div className="mb-2 flex items-center gap-2"><p className="text-xs font-bold uppercase tracking-wide text-txt-muted">Stage photos & documents (resumable, up to 500 MB)</p>
          {canEdit && seq != null && <div className="ml-auto"><ResumableUpload testId="stage-upload" meta={{ kind: "construction_photo", entity_type: "milestone", entity_id: `${blockId}:${seq}`, project_id: projectId }} onDone={() => setGalleryKey((k) => k + 1)} label="Upload photos / files" /></div>}</div>
        {seq != null && <FileGallery query={{ entity_type: "milestone", entity_id: `${blockId}:${seq}` }} canEdit={canEdit} refreshKey={galleryKey} />}
      </div>
    </div>
  );
}
