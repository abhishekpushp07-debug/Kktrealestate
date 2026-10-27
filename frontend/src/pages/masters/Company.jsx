import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api, { errMsg, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Field } from "@/components/common/Bits";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { uploadResumable } from "@/components/common/ResumableUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PICK = ["name", "legal_name", "gstin", "rera_registration", "letterhead_tagline", "letterhead_phone", "letterhead_email", "authorised_signatory_name", "authorised_signatory_designation", "letterhead_footer_note", "logo_file_id"];

function LogoControl({ fileId, onChange, canEdit }) {
  const [file, setFile] = useState(null);
  const [pct, setPct] = useState(null);
  useEffect(() => { if (!fileId) { setFile(null); return; } api.get(`/files/${fileId}`).then((r) => setFile(r.data)).catch(() => setFile(null)); }, [fileId]);
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    try { const res = await uploadResumable(f, { entity_type: "company", kind: "logo" }, setPct); onChange(res.id); toast.success("Logo uploaded — WebP variants are generated in the background"); } catch (err) { toast.error(errMsg(err)); } finally { setPct(null); }
  };
  const thumb = file?.variants?.thumb;
  return (
    <div className="flex items-center gap-4" data-testid="logo-control">
      <div className="flex h-20 w-36 items-center justify-center overflow-hidden rounded-lg border border-dashed border-warm-200 bg-warm-50">
        {thumb ? <img src={`${API}${thumb}`} alt="Company logo" className="max-h-full max-w-full object-contain" data-testid="logo-preview" /> : <span className="text-xs text-txt-muted">{fileId ? (file ? "Variants pending…" : "Loading…") : "No logo — monogram used"}</span>}
      </div>
      <div className="space-y-1 text-xs text-txt-secondary">
        <p>PNG / JPG / WebP. The 320px WebP variant prints on every PDF (receipts, demand letters, statements, letters).</p>
        {canEdit && <label className="btn btn-secondary btn-sm cursor-pointer"><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} data-testid="logo-file-input" />{pct != null ? `Uploading ${pct}%` : fileId ? "Replace logo" : "Upload logo"}</label>}
        {canEdit && fileId && <button type="button" className="btn btn-ghost btn-sm text-brick" onClick={() => onChange(null)} data-testid="logo-remove">Remove</button>}
      </div>
    </div>
  );
}

export default function CompanyMaster() {
  const { can } = useAuth();
  const canEdit = can("masters.company.edit") || can("admin.settings.edit");
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/settings/company").then((r) => setC(r.data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);
  const set = (k, v) => setC({ ...c, [k]: v });
  const setA = (k, v) => setC({ ...c, address: { ...(c.address || {}), [k]: v } });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = { version: c.version, address: c.address || {} };
    PICK.forEach((k) => { body[k] = c[k] || null; });
    try { const r = await api.patch("/settings/company", body); setC(r.data); toast.success("Letterhead saved — every new PDF uses it"); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  if (!c) return <div className="card h-64 animate-pulse" data-testid="company-master-skeleton" />;
  const a = c.address || {};
  return (
    <form onSubmit={save} className="card space-y-6 !p-6" data-testid="company-master">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="font-display text-2xl text-ink-950">Company &amp; letterhead</h1><p className="mt-1 text-sm text-txt-secondary">Identity, statutory registrations, logo and signatory — printed on every PDF. Numbering, banking and security stay in <Link to="/settings" className="font-semibold text-gold hover:underline" data-testid="company-admin-link">Admin → Settings</Link>.</p></div>
        <div className="flex gap-2"><HistoryButton entityType="company" entityId={c.id} label="Company" />{canEdit && <Button type="submit" disabled={busy} data-testid="company-save">{busy ? "Saving…" : "Save letterhead"}</Button>}</div>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        <Field label="Company name" required><Input value={c.name || ""} onChange={(e) => set("name", e.target.value)} required disabled={!canEdit} data-testid="co-name" /></Field>
        <Field label="Legal name (printed)"><Input value={c.legal_name || ""} onChange={(e) => set("legal_name", e.target.value)} disabled={!canEdit} data-testid="co-legal-name" /></Field>
        <Field label="Address line 1"><Input value={a.line1 || ""} onChange={(e) => setA("line1", e.target.value)} disabled={!canEdit} data-testid="co-addr1" /></Field>
        <Field label="Address line 2"><Input value={a.line2 || ""} onChange={(e) => setA("line2", e.target.value)} disabled={!canEdit} data-testid="co-addr2" /></Field>
        <div className="grid grid-cols-3 gap-3 md:col-span-2"><Field label="City"><Input value={a.city || ""} onChange={(e) => setA("city", e.target.value)} disabled={!canEdit} /></Field><Field label="State"><Input value={a.state || ""} onChange={(e) => setA("state", e.target.value)} disabled={!canEdit} /></Field><Field label="PIN"><Input value={a.pincode || ""} onChange={(e) => setA("pincode", e.target.value)} disabled={!canEdit} /></Field></div>
        <Field label="Phone (letterhead)"><Input value={c.letterhead_phone || ""} onChange={(e) => set("letterhead_phone", e.target.value)} disabled={!canEdit} data-testid="co-phone" /></Field>
        <Field label="Email (letterhead)"><Input value={c.letterhead_email || ""} onChange={(e) => set("letterhead_email", e.target.value)} disabled={!canEdit} data-testid="co-email" /></Field>
        <Field label="GSTIN"><Input value={c.gstin || ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} disabled={!canEdit} data-testid="co-gstin" /></Field>
        <Field label="RERA registration"><Input value={c.rera_registration || ""} onChange={(e) => set("rera_registration", e.target.value)} disabled={!canEdit} data-testid="co-rera" /></Field>
        <Field label="Tagline"><Input value={c.letterhead_tagline || ""} onChange={(e) => set("letterhead_tagline", e.target.value)} disabled={!canEdit} data-testid="co-tagline" /></Field>
      </section>
      <section className="space-y-3"><h2 className="text-base font-bold text-ink-950">Logo</h2><LogoControl fileId={c.logo_file_id} onChange={(id) => set("logo_file_id", id)} canEdit={canEdit} /></section>
      <section className="grid gap-4 md:grid-cols-2">
        <Field label="Authorised signatory — name"><Input value={c.authorised_signatory_name || ""} onChange={(e) => set("authorised_signatory_name", e.target.value)} disabled={!canEdit} data-testid="co-signatory" /></Field>
        <Field label="Authorised signatory — designation"><Input value={c.authorised_signatory_designation || ""} onChange={(e) => set("authorised_signatory_designation", e.target.value)} placeholder="Authorised Signatory" disabled={!canEdit} data-testid="co-designation" /></Field>
        <div className="md:col-span-2"><Field label="Footer note (printed on every page)"><Input value={c.letterhead_footer_note || ""} onChange={(e) => set("letterhead_footer_note", e.target.value)} placeholder="Computer-generated document, no signature required unless stamped." disabled={!canEdit} data-testid="co-footer" /></Field></div>
      </section>
    </form>
  );
}
