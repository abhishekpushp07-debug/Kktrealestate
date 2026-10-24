import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Image as ImageIcon, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useList, useFetch } from "@/hooks/useList";
import { DataTable } from "@/components/common/DataTable";
import { PageHeader, Field } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtDate } from "@/lib/format";

export function ImageUpload({ value, onChange }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const up = async (f) => { if (!f) return; setBusy(true); const fd = new FormData(); fd.append("file", f); try { const r = await api.post("/cms/media", fd, { headers: { "Content-Type": "multipart/form-data" } }); onChange(r.data.url); toast.success("Uploaded"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <div className="flex items-center gap-2">
      {value ? <img src={value} alt="" className="h-12 w-16 rounded object-cover" /> : <div className="flex h-12 w-16 items-center justify-center rounded bg-surface"><ImageIcon className="h-4 w-4 text-slate-400" /></div>}
      <Input value={value || ""} onChange={(e) => onChange(e.target.value || null)} placeholder="https://… or upload" className="h-9 flex-1" data-testid="image-url-input" />
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()} data-testid="image-upload-btn"><Upload className="h-3.5 w-3.5" /></Button>
      <input ref={ref} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => up(e.target.files?.[0])} />
    </div>
  );
}

const F = (name, label, type = "text", extra = {}) => ({ name, label, type, ...extra });
export const CMS = {
  banners: { label: "Banners", fields: [F("headline", "Headline"), F("subheadline", "Sub-headline", "textarea"), F("image_url", "Image", "image"), F("video_url", "Muted video URL (mp4, optional)"), F("cta_label", "CTA label"), F("cta_link", "CTA link"), F("cta2_label", "CTA 2 label"), F("cta2_link", "CTA 2 link"), F("from_date", "Schedule from", "date"), F("to_date", "Schedule to", "date"), F("order", "Order", "number"), F("is_active", "Active", "bool")], cols: [{ key: "order", label: "#" }, { key: "headline", label: "Headline" }, { key: "image_url", label: "Image", render: (r) => <img src={r.image_url} alt="" className="h-8 w-14 rounded object-cover" /> }] },
  testimonials: { label: "Testimonials", fields: [F("name", "Name"), F("designation", "Designation / flat"), F("quote", "Quote", "textarea"), F("rating", "Rating (1-5)", "number"), F("photo_url", "Photo", "image"), F("project_id", "Project", "project"), F("order", "Order", "number"), F("is_active", "Active", "bool")], cols: [{ key: "order", label: "#" }, { key: "name", label: "Name" }, { key: "designation", label: "Designation" }, { key: "rating", label: "★" }] },
  gallery: { label: "Gallery", fields: [F("image_url", "Image", "image"), F("caption", "Caption"), F("category", "Category", "select", { options: ["Exterior", "Interior", "Amenities", "Construction", "Events"] }), F("project_id", "Project", "project"), F("order", "Order", "number"), F("is_active", "Active", "bool")], cols: [{ key: "order", label: "#" }, { key: "image_url", label: "Image", render: (r) => <img src={r.image_url} alt="" className="h-8 w-14 rounded object-cover" /> }, { key: "caption", label: "Caption" }, { key: "category", label: "Category" }] },
  posts: { label: "Blog posts", fields: [F("title", "Title"), F("slug", "Slug (auto if blank)"), F("cover_url", "Cover", "image"), F("excerpt", "Excerpt", "textarea"), F("body", "Body (Markdown)", "markdown"), F("tags", "Tags (comma separated)", "tags"), F("author", "Author"), F("status", "Status", "select", { options: ["Draft", "Published"] }), F("publish_at", "Publish at (ISO, optional)"), F("seo_title", "SEO title"), F("seo_description", "SEO description", "textarea")], cols: [{ key: "title", label: "Title" }, { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "Published" ? "emerald" : "slate"}>{r.status}</Pill> }, { key: "publish_at", label: "Published", render: (r) => fmtDate(r.publish_at) }] },
  pages: { label: "Pages", fields: [F("title", "Title"), F("slug", "Slug"), F("body", "Body (Markdown)", "markdown")], cols: [{ key: "slug", label: "Slug" }, { key: "title", label: "Title" }, { key: "updated_at", label: "Updated", render: (r) => fmtDate(r.updated_at) }] },
  people: { label: "People", fields: [F("name", "Name"), F("designation", "Designation"), F("photo_url", "Photo", "image"), F("bio", "Bio", "textarea"), F("order", "Order", "number"), F("is_active", "Active", "bool")], cols: [{ key: "order", label: "#" }, { key: "name", label: "Name" }, { key: "designation", label: "Designation" }] },
};
export const CMS_NAV = [["settings", "Site Settings"], ["banners", "Banners"], ["testimonials", "Testimonials"], ["gallery", "Gallery"], ["posts", "Blog"], ["pages", "Pages"], ["notices", "Notices"], ["people", "People"], ["enquiries", "Enquiries"]];

export function CmsNav({ active }) {
  const nav = useNavigate();
  const { data } = useFetch("/leads?source=Website&page_size=1&unread=true");
  return <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-white p-1" data-testid="cms-nav">{CMS_NAV.map(([k, l]) => <button key={k} onClick={() => nav(k === "enquiries" ? "/leads?source=Website" : `/website/${k}`)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${active === k ? "bg-navy text-white" : "text-slate-600 hover:bg-surface"}`} data-testid={`cms-nav-${k}`}>{l}{k === "enquiries" && data?.total > 0 && <span className="ml-1 rounded-full bg-gold px-1.5 text-[10px] text-navy">{data.total}</span>}</button>)}</div>;
}

function CmsForm({ coll, item, onClose, onSaved }) {
  const cfg = CMS[coll];
  const [f, setF] = useState(() => ({ is_active: true, ...(item || {}), tags: Array.isArray(item?.tags) ? item.tags.join(", ") : item?.tags || "" }));
  const [busy, setBusy] = useState(false);
  const { data: projects } = useFetch("/projects?page_size=50");
  const set = (k, v) => setF({ ...f, [k]: v });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const data = {};
      cfg.fields.forEach(({ name, type }) => { let v = f[name]; if (type === "number") v = v === "" || v == null ? null : Number(v); if (type === "tags") v = String(v || "").split(",").map((x) => x.trim()).filter(Boolean); if (v === "") v = null; data[name] = v; });
      item ? await api.patch(`/cms/${coll}/${item.id}`, { data, version: item.version }) : await api.post(`/cms/${coll}`, { data });
      toast.success("Saved"); onSaved(); onClose();
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}><SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="cms-form"><SheetHeader><SheetTitle>{item ? "Edit" : "New"} · {cfg.label}</SheetTitle><SheetDescription>Changes publish to the website within 60 seconds.</SheetDescription></SheetHeader>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {cfg.fields.map((fl) => <Field key={fl.name} label={fl.label}>
          {fl.type === "textarea" ? <Textarea rows={3} value={f[fl.name] || ""} onChange={(e) => set(fl.name, e.target.value)} data-testid={`cms-field-${fl.name}`} />
            : fl.type === "markdown" ? <div className="grid gap-2 md:grid-cols-2"><Textarea rows={14} className="font-mono text-xs" value={f[fl.name] || ""} onChange={(e) => set(fl.name, e.target.value)} data-testid={`cms-field-${fl.name}`} /><div className="prose prose-sm max-h-80 overflow-y-auto rounded-md border bg-white p-3 text-xs"><MarkdownPreview text={f[fl.name] || ""} /></div></div>
            : fl.type === "image" ? <ImageUpload value={f[fl.name]} onChange={(v) => set(fl.name, v)} />
            : fl.type === "bool" ? <Switch checked={!!f[fl.name]} onCheckedChange={(v) => set(fl.name, v)} data-testid={`cms-field-${fl.name}`} />
            : fl.type === "select" ? <Select value={f[fl.name] || ""} onValueChange={(v) => set(fl.name, v)}><SelectTrigger data-testid={`cms-field-${fl.name}`}><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{fl.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select>
            : fl.type === "project" ? <Select value={f[fl.name] || "none"} onValueChange={(v) => { const p = (projects?.items || []).find((x) => x.id === v); setF({ ...f, [fl.name]: v === "none" ? null : v, project_name: p?.name || null }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem>{(projects?.items || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
            : <Input type={fl.type === "number" ? "number" : fl.type === "date" ? "date" : "text"} value={f[fl.name] ?? ""} onChange={(e) => set(fl.name, e.target.value)} data-testid={`cms-field-${fl.name}`} />}
        </Field>)}
        <Button type="submit" disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="cms-submit">{busy ? "Saving…" : "Save"}</Button>
      </form></SheetContent></Sheet>
  );
}

function MarkdownPreview({ text }) {
  const [Md, setMd] = useState(null);
  if (!Md) { import("react-markdown").then((m) => setMd(() => m.default)); return <p className="text-slate-400">Preview…</p>; }
  return <Md>{text}</Md>;
}

export default function CmsCollection() {
  const { coll } = useParams();
  const { can } = useAuth();
  const cfg = CMS[coll];
  const [edit, setEdit] = useState(null);
  const list = useList(`/cms/${coll}`, {}, { sort: coll === "posts" ? "-created_at" : "order" });
  if (!cfg) return <p>Unknown section</p>;
  const del = async (r) => { if (!window.confirm("Delete this item?")) return; try { await api.delete(`/cms/${coll}/${r.id}`); toast.success("Deleted"); list.reload(); } catch (e) { toast.error(errMsg(e)); } };
  const columns = [...cfg.cols, { key: "is_active", label: "Active", render: (r) => <Pill tone={r.is_active !== false ? "emerald" : "slate"}>{r.is_active !== false ? "Yes" : "No"}</Pill> },
    { key: "actions", label: "", render: (r) => can("cms.write") && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); del(r); }} data-testid={`cms-delete-${r.id}`}><Trash2 className="h-3.5 w-3.5 text-slate-500" /></Button> }];
  return (
    <div data-testid={`cms-${coll}-page`}>
      <PageHeader title={`Website · ${cfg.label}`} subtitle="Content shown on the public website." actions={can("cms.write") && <Button onClick={() => setEdit({})} className="bg-navy hover:bg-navy-700" data-testid="cms-new-btn"><Plus className="mr-1 h-4 w-4" />New</Button>} />
      <CmsNav active={coll} />
      <DataTable {...list} columns={columns} testId="cms-table" searchPlaceholder="Search…" onRowClick={(r) => can("cms.write") && setEdit(r)} />
      {edit && <CmsForm coll={coll} item={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => list.reload()} />}
    </div>
  );
}
