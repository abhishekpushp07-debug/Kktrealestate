/* eslint-disable react/no-array-index-key -- positional editable rows without ids; data-derived keys would remount inputs on edit */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ImageUpload } from "./CmsCollection";
import { BrochureStats } from "@/components/common/BrochureStats";

const VISIT_DEFAULTS = { enabled: false, visit_days: [0, 1, 2, 3, 4, 5, 6], start_time: "10:00", end_time: "18:00", slot_minutes: 60, capacity_per_slot: 3, min_lead_hours: 3, max_days_ahead: 30, blackout_dates: [], site_office_address: "", maps_url: "", instructions: "" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const num = (v, d) => (v === "" || v == null ? d : Number(v));

function VisitSettings({ v, onChange, ro }) {
  const up = (k, val) => onChange({ ...v, [k]: val });
  const inp = "h-10 rounded-md border bg-white px-3 text-sm text-ink-950 outline-none focus:border-gold disabled:opacity-60";
  return <div className="rounded-xl border p-4" data-testid="visit-settings">
    <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-ink-950">Site visits</p><p className="text-xs text-txt-secondary">Let website visitors book a slot; capacity is enforced per slot.</p></div><Switch checked={!!v.enabled} disabled={ro} onCheckedChange={(c) => up("enabled", c)} data-testid="vs-enabled" /></div>
    <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Visit days">{DAYS.map((d, i) => <button type="button" key={d} disabled={ro} aria-pressed={v.visit_days.includes(i)} onClick={() => up("visit_days", v.visit_days.includes(i) ? v.visit_days.filter((x) => x !== i) : [...v.visit_days, i].sort())} className={`h-9 w-12 rounded-full text-xs font-semibold ${v.visit_days.includes(i) ? "bg-ink-950 text-white" : "bg-warm-50 text-txt-secondary"}`} data-testid={`vs-day-${i}`}>{d}</button>)}</div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <label className="text-xs font-semibold text-txt-secondary">Start<input type="time" className={`${inp} mt-1 w-full`} value={v.start_time} disabled={ro} onChange={(e) => up("start_time", e.target.value)} data-testid="vs-start" /></label>
      <label className="text-xs font-semibold text-txt-secondary">End<input type="time" className={`${inp} mt-1 w-full`} value={v.end_time} disabled={ro} onChange={(e) => up("end_time", e.target.value)} data-testid="vs-end" /></label>
      <label className="text-xs font-semibold text-txt-secondary">Slot length<select className={`${inp} mt-1 w-full`} value={v.slot_minutes} disabled={ro} onChange={(e) => up("slot_minutes", Number(e.target.value))} data-testid="vs-slot"><option value={30}>30 min</option><option value={60}>60 min</option></select></label>
      <label className="text-xs font-semibold text-txt-secondary">Capacity / slot<Input type="number" min="1" max="20" value={v.capacity_per_slot} disabled={ro} onChange={(e) => up("capacity_per_slot", num(e.target.value, 3))} data-testid="vs-capacity" /></label>
      <label className="text-xs font-semibold text-txt-secondary">Min lead hours<Input type="number" min="0" max="72" value={v.min_lead_hours} disabled={ro} onChange={(e) => up("min_lead_hours", num(e.target.value, 3))} data-testid="vs-lead" /></label>
      <label className="text-xs font-semibold text-txt-secondary">Max days ahead<Input type="number" min="1" max="90" value={v.max_days_ahead} disabled={ro} onChange={(e) => up("max_days_ahead", num(e.target.value, 30))} data-testid="vs-ahead" /></label>
    </div>
    <div className="mt-3 grid gap-3">
      <Field label="Blackout dates (YYYY-MM-DD, comma separated)"><Input value={(v.blackout_dates || []).join(", ")} disabled={ro} onChange={(e) => up("blackout_dates", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} data-testid="vs-blackout" /></Field>
      <Field label="Site office address"><Input value={v.site_office_address || ""} disabled={ro} onChange={(e) => up("site_office_address", e.target.value)} data-testid="vs-address" /></Field>
      <Field label="Google Maps link"><Input value={v.maps_url || ""} disabled={ro} onChange={(e) => up("maps_url", e.target.value)} data-testid="vs-maps" /></Field>
      <Field label="Instructions for visitors"><Textarea rows={2} value={v.instructions || ""} disabled={ro} onChange={(e) => up("instructions", e.target.value)} data-testid="vs-instructions" /></Field>
    </div>
  </div>;
}

const Field = ({ label, children }) => <label className="block"><span className="mb-1 block text-xs font-semibold text-txt-secondary">{label}</span>{children}</label>;
const lines = (arr) => (arr || []).join("\n");
const unlines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function ProjectWebsiteTab({ projectId, slugDefault }) {
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/cms/projects/${projectId}/website`).then((r) => setD({ ...r.data.website, version: r.data.version, faqsText: JSON.stringify(r.data.website.faqs || [], null, 2) }));
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line
  if (!d) return <div className="card p-5 text-sm text-txt-secondary">Loading…</div>;
  const set = (k) => (v) => setD((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const { faqsText, version, ...web } = d;
      let faqs; try { faqs = JSON.parse(faqsText || "[]"); } catch { toast.error("FAQs must be valid JSON"); setBusy(false); return; }
      const r = await api.patch(`/cms/projects/${projectId}/website`, { ...web, faqs, starting_price_override: web.starting_price_override ? Number(web.starting_price_override) : null, version });
      setD({ ...r.data.website, version: r.data.version, faqsText: JSON.stringify(r.data.website.faqs || [], null, 2) }); toast.success("Website settings saved");
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); } finally { setBusy(false); }
  };
  const ro = !can("website.cms.edit");
  return (
    <div className="card p-5" data-testid="project-website-tab">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-ink-950">Public website</h3><p className="text-sm text-txt-secondary">Controls what visitors see on <code>/projects/{d.slug || slugDefault}</code>.</p></div>
        <div className="flex gap-2">{d.is_published && <a href={`/projects/${d.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-950 hover:underline" data-testid="pw-view-link">View page <ExternalLink className="h-3.5 w-3.5" /></a>}{!ro && <Button onClick={save} disabled={busy} className="bg-ink-950 text-white" data-testid="pw-save">{busy ? "Saving…" : "Save"}</Button>}</div></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-warm-50 p-4">{[["is_published", "Published"], ["show_prices", "Show prices"], ["show_availability", "Show availability"], ["show_construction_progress", "Show construction progress"]].map(([k, l]) => <label key={k} className="flex items-center justify-between gap-2 text-sm font-medium text-ink-950">{l}<Switch checked={!!d[k]} disabled={ro} onCheckedChange={set(k)} data-testid={`pw-${k}`} /></label>)}</div>
          <Field label="Slug"><Input value={d.slug || ""} disabled={ro} onChange={(e) => set("slug")(e.target.value)} data-testid="pw-slug" /></Field>
          <Field label="Starting price override (₹, optional)"><Input type="number" value={d.starting_price_override ?? ""} disabled={ro} onChange={(e) => set("starting_price_override")(e.target.value)} data-testid="pw-price-override" /></Field>
          <Field label="Public description"><Textarea rows={4} value={d.public_description || ""} disabled={ro} onChange={(e) => set("public_description")(e.target.value)} data-testid="pw-description" /></Field>
          <Field label="Highlights (one per line)"><Textarea rows={5} value={lines(d.highlights)} disabled={ro} onChange={(e) => set("highlights")(unlines(e.target.value))} data-testid="pw-highlights" /></Field>
          <Field label="SEO title"><Input value={d.seo_title || ""} disabled={ro} onChange={(e) => set("seo_title")(e.target.value)} /></Field>
          <Field label="SEO description"><Textarea rows={2} value={d.seo_description || ""} disabled={ro} onChange={(e) => set("seo_description")(e.target.value)} /></Field>
        </div>
        <div className="space-y-4">
          <Field label="Hero images (first is the cover)"><div className="space-y-2">{(d.hero_images || []).map((u, i) => <div key={i} className="flex gap-2"><ImageUpload value={u} onChange={(v) => set("hero_images")(d.hero_images.map((x, j) => j === i ? v : x))} disabled={ro} /><Button variant="ghost" size="sm" disabled={ro} onClick={() => set("hero_images")(d.hero_images.filter((_, j) => j !== i))}>Remove</Button></div>)}{!ro && <Button variant="outline" size="sm" onClick={() => set("hero_images")([...(d.hero_images || []), ""])} data-testid="pw-add-hero">Add image</Button>}</div></Field>
          <Field label="Video embed URLs (one per line, YouTube/Vimeo)"><Textarea rows={2} value={lines(d.video_urls)} disabled={ro} onChange={(e) => set("video_urls")(unlines(e.target.value))} /></Field>
          <Field label="Virtual tour embed URLs (one per line)"><Textarea rows={2} value={lines(d.virtual_tour_urls)} disabled={ro} onChange={(e) => set("virtual_tour_urls")(unlines(e.target.value))} /></Field>
          <Field label="Google Maps embed URL"><Input value={d.map_embed_url || ""} disabled={ro} onChange={(e) => set("map_embed_url")(e.target.value)} /></Field>
          <Field label="Brochure document ID (public, non-sensitive project document)"><Input value={d.brochure_document_id || ""} disabled={ro} onChange={(e) => set("brochure_document_id")(e.target.value || null)} /></Field>
          <div className="flex items-center justify-between rounded-xl bg-warm-50 p-4"><div><p className="text-sm font-semibold text-ink-950">Brochure lead gate</p><p className="text-xs text-txt-secondary">Ask for name & mobile before the PDF downloads</p></div><Switch checked={d.brochure_gate_enabled !== false} disabled={ro} onCheckedChange={set("brochure_gate_enabled")} data-testid="pw-brochure-gate" /></div>
          <BrochureStats projectId={projectId} />
          <VisitSettings v={{ ...VISIT_DEFAULTS, ...(d.site_visits || {}) }} onChange={set("site_visits")} ro={ro} />
          <Field label="FAQs (JSON: question, answer)"><Textarea rows={8} className="font-mono text-xs" value={d.faqsText} disabled={ro} onChange={(e) => set("faqsText")(e.target.value)} data-testid="pw-faqs" /></Field>
        </div>
      </div>
    </div>
  );
}
