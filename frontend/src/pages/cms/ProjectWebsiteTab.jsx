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

const Field = ({ label, children }) => <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>;
const lines = (arr) => (arr || []).join("\n");
const unlines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function ProjectWebsiteTab({ projectId, slugDefault }) {
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/cms/projects/${projectId}/website`).then((r) => setD({ ...r.data.website, version: r.data.version, faqsText: JSON.stringify(r.data.website.faqs || [], null, 2) }));
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line
  if (!d) return <div className="card-elev p-5 text-sm text-slate-500">Loading…</div>;
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
  const ro = !can("project.write");
  return (
    <div className="card-elev p-5" data-testid="project-website-tab">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-navy">Public website</h3><p className="text-sm text-slate-500">Controls what visitors see on <code>/projects/{d.slug || slugDefault}</code>.</p></div>
        <div className="flex gap-2">{d.is_published && <a href={`/projects/${d.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-navy hover:underline" data-testid="pw-view-link">View page <ExternalLink className="h-3.5 w-3.5" /></a>}{!ro && <Button onClick={save} disabled={busy} className="bg-navy text-white" data-testid="pw-save">{busy ? "Saving…" : "Save"}</Button>}</div></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4">{[["is_published", "Published"], ["show_prices", "Show prices"], ["show_availability", "Show availability"], ["show_construction_progress", "Show construction progress"]].map(([k, l]) => <label key={k} className="flex items-center justify-between gap-2 text-sm font-medium text-navy">{l}<Switch checked={!!d[k]} disabled={ro} onCheckedChange={set(k)} data-testid={`pw-${k}`} /></label>)}</div>
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
          <Field label="FAQs (JSON: question, answer)"><Textarea rows={8} className="font-mono text-xs" value={d.faqsText} disabled={ro} onChange={(e) => set("faqsText")(e.target.value)} data-testid="pw-faqs" /></Field>
        </div>
      </div>
    </div>
  );
}
