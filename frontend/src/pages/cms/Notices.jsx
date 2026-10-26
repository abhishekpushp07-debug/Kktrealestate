import { useEffect, useState } from "react";
import { Bell, Pin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, EmptyState, Field } from "@/components/common/Bits";
import { CmsNav } from "@/pages/cms/CmsCollection";
import { fmtDate } from "@/lib/format";

const blank = { title: "", body: "", project_ids: [], publish_at: "", expires_at: "", pinned: false, is_active: true };

export default function Notices() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/notices").then((r) => setItems(r.data.items)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); api.get("/projects?page_size=100").then((r) => setProjects(r.data.items)).catch(() => {}); }, []);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = { title: edit.title, body: edit.body, project_ids: edit.project_ids, publish_at: edit.publish_at ? new Date(edit.publish_at).toISOString() : null, expires_at: edit.expires_at ? new Date(edit.expires_at).toISOString() : null, pinned: edit.pinned, is_active: edit.is_active };
    try { if (edit.id) await api.patch(`/notices/${edit.id}`, { ...body, version: edit.version }); else await api.post("/notices", body); toast.success("Notice saved"); setEdit(null); load(); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const del = async (n) => { if (!window.confirm(`Delete “${n.title}”?`)) return; try { await api.delete(`/notices/${n.id}`); toast.success("Deleted"); load(); } catch (e) { toast.error(errMsg(e)); } };
  const toggle = (id) => setEdit((s) => ({ ...s, project_ids: s.project_ids.includes(id) ? s.project_ids.filter((x) => x !== id) : [...s.project_ids, id] }));
  return (
    <div data-testid="notices-page">
      <CmsNav active="notices" />
      <PageHeader title="Notices" subtitle="Announcements shown to customers in the portal." crumbs={[{ label: "Website" }, { label: "Notices" }]} actions={can("website.cms.edit") && <Button className="bg-ink-950 hover:bg-ink-800" onClick={() => setEdit({ ...blank })} data-testid="new-notice-btn"><Plus className="mr-1 h-4 w-4" />New notice</Button>} />
      {items.length === 0 ? <EmptyState icon={Bell} title="No notices yet" /> : <ul className="divide-y rounded-lg border bg-white" data-testid="notices-list">{items.map((n) => <li key={n.id} className="flex items-start gap-3 px-4 py-3" data-testid={`notice-row-${n.id}`}>{n.pinned && <Pin className="mt-1 h-4 w-4 text-gold" />}<div className="min-w-0 flex-1"><button className="font-semibold text-ink-950 hover:underline" onClick={() => can("website.cms.edit") && setEdit({ ...n, publish_at: n.publish_at?.slice(0, 16) || "", expires_at: n.expires_at?.slice(0, 16) || "" })} data-testid={`notice-edit-${n.id}`}>{n.title}</button><p className="line-clamp-1 text-xs text-txt-secondary">{n.body}</p><p className="mt-1 text-[11px] text-txt-secondary">{n.project_names?.length ? n.project_names.join(", ") : "All projects"} · from {fmtDate(n.publish_at)}{n.expires_at ? ` · till ${fmtDate(n.expires_at)}` : ""}{!n.is_active ? " · inactive" : ""}</p></div>{can("website.cms.edit") && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => del(n)} data-testid={`notice-delete-${n.id}`}><Trash2 className="h-4 w-4 text-txt-secondary" /></Button>}</li>)}</ul>}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{edit?.id ? "Edit notice" : "New notice"}</DialogTitle></DialogHeader>
        {edit && <form onSubmit={save} className="space-y-3" data-testid="notice-form">
          <Field label="Title" required><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required data-testid="notice-title" /></Field>
          <Field label="Body" required><Textarea rows={5} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} required data-testid="notice-body" /></Field>
          <Field label="Projects (none = all)"><div className="flex flex-wrap gap-2">{projects.map((p) => <button type="button" key={p.id} onClick={() => toggle(p.id)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${edit.project_ids.includes(p.id) ? "border-ink-950 bg-ink-950 text-white" : "bg-white text-txt-secondary"}`} data-testid={`notice-project-${p.code}`}>{p.name}</button>)}</div></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Publish at"><Input type="datetime-local" value={edit.publish_at} onChange={(e) => setEdit({ ...edit, publish_at: e.target.value })} data-testid="notice-publish" /></Field><Field label="Expires at"><Input type="datetime-local" value={edit.expires_at} onChange={(e) => setEdit({ ...edit, expires_at: e.target.value })} data-testid="notice-expires" /></Field></div>
          <div className="flex gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={edit.pinned} onChange={(e) => setEdit({ ...edit, pinned: e.target.checked })} data-testid="notice-pinned" />Pinned</label><label className="flex items-center gap-2"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} data-testid="notice-active" />Active</label></div>
          <Button type="submit" disabled={busy} className="w-full bg-ink-950 hover:bg-ink-800" data-testid="notice-save">{busy ? "Saving…" : "Save notice"}</Button>
        </form>}
      </DialogContent></Dialog>
    </div>
  );
}
