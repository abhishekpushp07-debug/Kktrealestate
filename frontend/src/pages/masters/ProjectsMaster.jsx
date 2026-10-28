import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoryButton } from "@/components/common/HistoryTimeline";

export default function ProjectsMaster() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [qs] = useSearchParams();
  const [editing, setEditing] = useState(qs.get("new") === "1" ? {} : null);
  const load = () => api.get("/projects?page_size=200").then((r) => setItems(r.data.items)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-4" data-testid="projects-master-page">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><h1 className="font-display text-xl text-ink-950">Projects</h1><p className="text-xs text-txt-secondary">Basic info lives here; towers, stage plans and payment plans are separate masters.</p></div>
        {can("masters.project.create") && <Button className="bg-ink-950 hover:bg-ink-800" onClick={() => setEditing({})} data-testid="project-new-btn"><Plus className="mr-1 h-4 w-4" />New project</Button>}
      </div>
      {editing && <ProjectForm project={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      <div className="grid gap-3 md:grid-cols-2" data-testid="projects-master-list">{items.map((p) => <div key={p.id} className="card !p-4" data-testid={`project-card-${p.code}`}><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="font-semibold text-ink-950">{p.name} <span className="text-xs font-normal text-txt-secondary">{p.code}</span></p><p className="text-xs text-txt-secondary">{p.project_type} · {p.address?.city || "—"} · RERA {p.rera_number || "—"}</p></div><HistoryButton entityType="project" entityId={p.id} /><Link to={`/projects/${p.id}`} className="rounded-md border px-2 py-1 text-xs">Workspace</Link>{can("masters.project.edit") && <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => setEditing(p)} data-testid={`project-edit-${p.code}`}>Edit</button>}</div></div>)}</div>
    </div>
  );
}

function ProjectForm({ project, onClose, onSaved }) {
  const isNew = !project.id;
  const [f, setF] = useState({ name: project.name || "", code: project.code || "", project_type: project.project_type || "Residential", description: project.description || "", rera_number: project.rera_number || "", city: project.address?.city || "" });
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setErr(null);
    const body = { name: f.name.trim(), project_type: f.project_type, description: f.description || null, rera_number: f.rera_number || null, address: { ...(project.address || {}), city: f.city || null } };
    try { if (isNew) await api.post("/projects", { ...body, code: f.code.trim().toUpperCase() }); else await api.patch(`/projects/${project.id}`, { ...body, version: project.version }); toast.success("Project saved"); onSaved(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="card space-y-3 !p-5" data-testid="project-form">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm"><span className="label-xs">Name *</span><Input value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="project-name" />{!f.name.trim() && <p className="mt-1 text-[11px] font-semibold text-brick">Name is required</p>}</label>
        <label className="block text-sm"><span className="label-xs">Code *</span><Input value={f.code} onChange={(e) => set("code", e.target.value)} disabled={!isNew} data-testid="project-code" /></label>
        <label className="block text-sm"><span className="label-xs">Type</span><select className="h-10 w-full rounded-md border px-3 text-sm" value={f.project_type} onChange={(e) => set("project_type", e.target.value)} data-testid="project-type">{["Residential", "Commercial", "Mixed"].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="block text-sm"><span className="label-xs">City</span><Input value={f.city} onChange={(e) => set("city", e.target.value)} data-testid="project-city" /></label>
        <label className="block text-sm"><span className="label-xs">RERA number</span><Input value={f.rera_number} onChange={(e) => set("rera_number", e.target.value)} data-testid="project-rera" /></label>
        <label className="block text-sm"><span className="label-xs">Description</span><Input value={f.description} onChange={(e) => set("description", e.target.value)} data-testid="project-description" /></label>
      </div>
      {err && <p className="rounded-md bg-brick-50 px-3 py-2 text-sm text-brick" data-testid="project-error">{err}</p>}
      <div className="flex gap-2"><Button className="bg-ink-950 hover:bg-ink-800" disabled={!f.name.trim() || !f.code.trim()} onClick={save} data-testid="project-save">Save</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
    </div>
  );
}
