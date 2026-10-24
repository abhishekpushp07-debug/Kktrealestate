import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Field } from "@/components/common/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageUpload, CmsNav } from "./CmsCollection";

const J = (v) => JSON.stringify(v ?? [], null, 2);

export default function SiteSettingsPage() {
  const { can } = useAuth();
  const [s, setS] = useState(null);
  const [json, setJson] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/cms/site").then((r) => { setS(r.data); setJson({ offices: J(r.data.offices), social: JSON.stringify(r.data.social || {}, null, 2), trust_stats: J(r.data.trust_stats), value_props: J(r.data.home?.value_props) }); }); }, []);
  if (!s) return <Skeleton className="h-96" />;
  const set = (k, v) => setS({ ...s, [k]: v });
  const save = async () => {
    setBusy(true);
    try {
      const data = { ...s, offices: JSON.parse(json.offices), social: JSON.parse(json.social), trust_stats: JSON.parse(json.trust_stats), home: { ...s.home, value_props: JSON.parse(json.value_props) } };
      delete data.id; delete data.company_id; delete data.created_at; delete data.updated_at; delete data.version; delete data.created_by; delete data.is_active;
      const r = await api.patch("/cms/site", { data, version: s.version }); setS(r.data); toast.success("Site settings saved");
    } catch (e) { toast.error(e instanceof SyntaxError ? "Invalid JSON in a list field" : errMsg(e)); } finally { setBusy(false); }
  };
  const ro = !can("cms.write");
  return (
    <div data-testid="site-settings-page">
      <PageHeader title="Website · Site Settings" subtitle="Brand, contact, trust stats, SEO, tracking and go-live switch." actions={<div className="flex items-center gap-3"><a href="/" target="_blank" rel="noreferrer" className="text-sm font-semibold text-gold-hover hover:underline" data-testid="view-site-link">View website ↗</a>{!ro && <Button onClick={save} disabled={busy} className="bg-navy hover:bg-navy-700" data-testid="site-save-btn">{busy ? "Saving…" : "Save"}</Button>}</div>} />
      <CmsNav active="settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card-elev space-y-3 p-5"><h3 className="text-base font-bold text-navy">Brand & contact</h3>
          <div className="flex items-center justify-between rounded-md bg-surface px-3 py-2"><div><p className="text-sm font-semibold">Site live</p><p className="text-xs text-slate-500">Off shows an elegant coming-soon page</p></div><Switch checked={!!s.site_live} onCheckedChange={(v) => set("site_live", v)} disabled={ro} data-testid="site-live-switch" /></div>
          <Field label="Brand name"><Input value={s.brand_name || ""} onChange={(e) => set("brand_name", e.target.value)} data-testid="site-brand" /></Field>
          <Field label="Tagline"><Input value={s.tagline || ""} onChange={(e) => set("tagline", e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-3"><Field label="Phone"><Input value={s.phone || ""} onChange={(e) => set("phone", e.target.value)} /></Field><Field label="WhatsApp"><Input value={s.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} /></Field><Field label="Email"><Input value={s.email || ""} onChange={(e) => set("email", e.target.value)} /></Field></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Logo"><ImageUpload value={s.logo_url} onChange={(v) => set("logo_url", v)} /></Field><Field label="Favicon"><ImageUpload value={s.favicon_url} onChange={(v) => set("favicon_url", v)} /></Field></div>
          <Field label="Offices (JSON: name, address, map_embed_url)"><Textarea rows={5} className="font-mono text-xs" value={json.offices} onChange={(e) => setJson({ ...json, offices: e.target.value })} /></Field>
          <Field label="Social links (JSON)"><Textarea rows={4} className="font-mono text-xs" value={json.social} onChange={(e) => setJson({ ...json, social: e.target.value })} /></Field>
        </div>
        <div className="card-elev space-y-3 p-5"><h3 className="text-base font-bold text-navy">Home, SEO & tracking</h3>
          <Field label="Trust stats (JSON: label, value)"><Textarea rows={4} className="font-mono text-xs" value={json.trust_stats} onChange={(e) => setJson({ ...json, trust_stats: e.target.value })} /></Field>
          <Field label="Value props (JSON: title, text, icon)"><Textarea rows={5} className="font-mono text-xs" value={json.value_props} onChange={(e) => setJson({ ...json, value_props: e.target.value })} /></Field>
          <Field label="Walkthrough video URL (YouTube embed)"><Input value={s.home?.walkthrough_video_url || ""} onChange={(e) => set("home", { ...s.home, walkthrough_video_url: e.target.value })} /></Field>
          <Field label="SEO title"><Input value={s.seo_title || ""} onChange={(e) => set("seo_title", e.target.value)} /></Field>
          <Field label="SEO description"><Textarea rows={2} value={s.seo_description || ""} onChange={(e) => set("seo_description", e.target.value)} /></Field>
          <Field label="OG image URL"><Input value={s.og_image_url || ""} onChange={(e) => set("og_image_url", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Google Analytics ID"><Input value={s.ga_id || ""} onChange={(e) => set("ga_id", e.target.value || null)} placeholder="G-XXXX" /></Field><Field label="Meta Pixel ID"><Input value={s.meta_pixel_id || ""} onChange={(e) => set("meta_pixel_id", e.target.value || null)} /></Field></div>
          <Field label="Footer text"><Textarea rows={2} value={s.footer_text || ""} onChange={(e) => set("footer_text", e.target.value)} /></Field>
          <Field label="RERA disclaimer"><Textarea rows={3} value={s.rera_disclaimer || ""} onChange={(e) => set("rera_disclaimer", e.target.value)} /></Field>
          <div className="flex items-center justify-between rounded-md bg-surface px-3 py-2"><div><p className="text-sm font-semibold">Round-robin lead assignment</p><p className="text-xs text-slate-500">Website enquiries rotate across active Sales users</p></div><Switch checked={!!s.round_robin_assignment} onCheckedChange={(v) => set("round_robin_assignment", v)} disabled={ro} data-testid="round-robin-switch" /></div>
        </div>
      </div>
    </div>
  );
}
