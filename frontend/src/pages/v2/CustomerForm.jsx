/* eslint-disable react/no-array-index-key -- positional editable rows without ids; data-derived keys would remount inputs on edit */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { FieldError, useFieldErrors } from "@/lib/formErrors";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { useCatalogues } from "@/hooks/useCatalogues";
import { Card, Field, FormSection, Skeleton } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Avatar, usePeople } from "@/components/v2/CustomerBits";

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const verhoeff = (num) => { const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]], p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]; let c = 0; [...num].reverse().forEach((ch, i) => { c = d[c][p[i % 8][Number(ch)]]; }); return c === 0; };
const EMPTY = { salutation_id: null, full_name: "", gender_id: null, dob: "", residency_id: null, nationality_id: null, phone: "", alt_phone: "", email: "", consent: { marketing: false, whatsapp: false, email: true, sms: false }, preferred_channel: null, preferred_language: "en", state_id: null, city_id: null, locality_id: null, line1: "", pincode: "", permanent_same_as_current: true, occupation_id: null, company_name: "", income_band_id: null, segment_ids: [], source_id: null, rm_user_id: null, preferences: { bhk_ids: [], facing_ids: [], floor_preference_id: null, budget_band_id: null, project_ids: [] }, co_applicants: [], nominee: { relation_id: null, name: "", dob: "" }, pan: "", aadhaar: "" };

export default function CustomerForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { label, opts } = useCatalogues();
  const fe = useFieldErrors();
  const [f, setF] = useState({ ...EMPTY, rm_user_id: user?.id || null });
  const localityPin = opts("locality", f.city_id).find((o) => o.value === f.locality_id)?.meta?.pincode || "";
  const people = usePeople();
  const { data: projects } = useFetch("/projects?page_size=100&with_total=false");
  const { data: existing } = useFetch(id ? `/customers/${id}` : null);
  const [dupe, setDupe] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (existing) setF((p) => ({ ...p, ...Object.fromEntries(Object.entries(existing).filter(([k]) => k in EMPTY && existing[k] != null)), line1: existing.address_current?.line1 || "", pincode: existing.address_current?.pincode || "", rm_user_id: existing.assigned_sales_user_id || p.rm_user_id, preferences: { ...EMPTY.preferences, ...(existing.preferences || {}) }, consent: { ...EMPTY.consent, ...(existing.consent || {}) }, nominee: { relation_id: null, ...(existing.nominee || {}), dob: existing.nominee?.dob || "" }, co_applicants: (existing.co_applicants || []).map((c) => ({ name: c.name, relation_id: c.relation_id || null, phone: c.phone || "" })), pan: "", aadhaar: "" })); }, [existing]);
  useEffect(() => { const h = window.location.hash.slice(1); if (h && (existing || !id)) setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); }, [existing, id]);
  useEffect(() => {
    if (f.phone.replace(/\D/g, "").length !== 10) return setDupe(null);
    const t = setTimeout(() => api.get("/customers", { params: { search: f.phone, page_size: 3 } }).then((r) => setDupe(r.data.items.find((c) => c.phone?.endsWith(f.phone.slice(-10)) && c.id !== id) || null)).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [f.phone, id]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setP = (k, v) => setF((p) => ({ ...p, preferences: { ...p.preferences, [k]: v } }));
  const panErr = f.pan && !PAN.test(f.pan) ? "Format AAAAA9999A" : null;
  const aadErr = f.aadhaar && !(/^\d{12}$/.test(f.aadhaar) && verhoeff(f.aadhaar)) ? "12 digits · checksum failed" : null;
  const projOpts = useMemo(() => (projects?.items || []).map((p) => ({ value: p.id, label: p.name, sub: p.code })), [projects]);
  const clean = (v) => (v === "" ? null : v);
  const submit = async (e) => {
    e.preventDefault();
    if (panErr || aadErr) return toast.error("Fix KYC fields first");
    setBusy(true);
    try {
      const base = { salutation: label("salutation", f.salutation_id) || null, full_name: f.full_name, gender: label("gender", f.gender_id) || null, dob: clean(f.dob), phone: f.phone, alt_phone: clean(f.alt_phone), email: clean(f.email), occupation: label("occupation", f.occupation_id) || null, company_name: clean(f.company_name), annual_income_band: label("income_band", f.income_band_id) || null, source: label("lead_source", f.source_id) || null,
        address_current: { line1: clean(f.line1), city: label("city", f.city_id) || null, state: label("state", f.state_id) || null, pincode: clean(f.pincode) }, permanent_same_as_current: f.permanent_same_as_current,
        nominee: f.nominee.name ? { name: f.nominee.name, relation: label("relation", f.nominee.relation_id) || null, dob: clean(f.nominee.dob) } : null,
        co_applicants: f.co_applicants.filter((c) => c.name).map((c) => ({ name: c.name, relation: label("relation", c.relation_id) || null, phone: clean(c.phone) })), ...(f.pan ? { pan: f.pan } : {}), ...(f.aadhaar ? { aadhaar: f.aadhaar } : {}) };
      const r = id ? await api.patch(`/customers/${id}`, { ...base, version: existing.version }) : await api.post("/customers", base);
      const cid = r.data.id;
      const prof = { salutation_id: f.salutation_id, gender_id: f.gender_id, residency_id: f.residency_id, nationality_id: f.nationality_id, occupation_id: f.occupation_id, income_band_id: f.income_band_id, source_id: f.source_id, state_id: f.state_id, city_id: f.city_id, locality_id: f.locality_id, segment_ids: f.segment_ids, preferences: f.preferences, consent: f.consent, preferred_channel: f.preferred_channel || null, preferred_language: f.preferred_language || null, rm_user_id: f.rm_user_id };
      await api.patch(`/customers/${cid}/profile`, { ...Object.fromEntries(Object.entries(prof).filter(([, v]) => v != null)), version: r.data.version ?? 0 });
      toast.success(id ? "Customer updated" : `Customer ${r.data.customer_code} created`);
      nav(`/customers/${cid}`);
    } catch (err) { toast.error(fe.capture(err)); } finally { setBusy(false); }
  };
  if (id && !existing) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <form onSubmit={submit} className="space-y-8" data-testid="customer-form">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><Link to={id ? `/customers/${id}` : "/customers"} className="flex items-center gap-1 text-xs font-semibold text-txt-secondary hover:text-ink-950"><ArrowLeft className="h-3.5 w-3.5" />Back</Link><h1 className="mt-2 font-display text-4xl text-ink-950">{id ? `Edit · ${existing.full_name}` : "New customer"}</h1><p className="mt-2 text-sm text-txt-secondary">Dropdown-first. Anything missing from a list can be added inline.</p></div>
        <button type="submit" disabled={busy} className="btn btn-primary" data-testid="customer-submit">{busy ? "Saving…" : id ? "Save changes" : "Create customer"}</button>
      </header>
      <div className="grid gap-6 xl:grid-cols-2">
        <FormSection title="Identity">
          <Field label="Salutation" testId="f-salutation"><Select type="salutation" value={f.salutation_id} onChange={(v) => set("salutation_id", v)} testId="sel-salutation" /></Field>
          <Field label="Full name" required><input className="input" value={f.full_name} onChange={(e) => set("full_name", e.target.value)} required data-testid="cust-name" /></Field>
          <Field label="Gender"><Select type="gender" value={f.gender_id} onChange={(v) => set("gender_id", v)} testId="sel-gender" /></Field>
          <Field label="Date of birth"><input type="date" className="input" value={f.dob} onChange={(e) => set("dob", e.target.value)} data-testid="cust-dob" /></Field>
          <Field label="Residency"><Select type="residency" value={f.residency_id} onChange={(v) => set("residency_id", v)} testId="sel-residency" /></Field>
          <Field label="Nationality"><Select type="nationality" value={f.nationality_id} onChange={(v) => set("nationality_id", v)} testId="sel-nationality" /></Field>
        </FormSection>
        <FormSection title="Contact">
          <Field label="Mobile" required error={dupe ? "A customer with this phone already exists" : null}><input className="input" inputMode="numeric" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit" required data-testid="cust-phone" /></Field>
          <Field label="Alternate phone"><input className="input" value={f.alt_phone} onChange={(e) => set("alt_phone", e.target.value)} data-testid="cust-alt-phone" /></Field>
          <Field label="Email" hint="Ask the customer for an email — payment reminders and receipts go here. Optional, never blocks."><FieldError name="email" fields={fe.fields} /><input type="email" className="input !border-gold/60 !bg-gold-light/30" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" data-testid="cust-email" /></Field>
          <Field label="Preferred channel &amp; language"><div className="flex gap-2"><select className="input !w-auto" value={f.preferred_channel || ""} onChange={(e) => set("preferred_channel", e.target.value || null)} data-testid="cust-preferred-channel"><option value="">Auto (email first)</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select><select className="input !w-auto" value={f.preferred_language || "en"} onChange={(e) => set("preferred_language", e.target.value)} data-testid="cust-language"><option value="en">English</option><option value="hi">हिन्दी</option></select></div></Field>
          <div className="col-span-full flex flex-wrap items-center gap-5 pb-1 text-sm" data-testid="consent-row"><span className="text-xs font-semibold uppercase tracking-wide text-txt-muted">Consent</span><label className="flex items-center gap-2"><input type="checkbox" checked={f.consent.email ?? true} onChange={(e) => set("consent", { ...f.consent, email: e.target.checked })} data-testid="consent-email" />Email reminders</label><label className="flex items-center gap-2"><input type="checkbox" checked={f.consent.whatsapp} onChange={(e) => set("consent", { ...f.consent, whatsapp: e.target.checked })} data-testid="consent-whatsapp" />WhatsApp</label><label className="flex items-center gap-2"><input type="checkbox" checked={!!f.consent.sms} onChange={(e) => set("consent", { ...f.consent, sms: e.target.checked })} data-testid="consent-sms" />SMS</label><label className="flex items-center gap-2"><input type="checkbox" checked={f.consent.marketing} onChange={(e) => set("consent", { ...f.consent, marketing: e.target.checked })} data-testid="consent-marketing" />Marketing</label></div>
          {dupe && <Link to={`/customers/${dupe.id}`} className="card-hover card col-span-full flex items-center gap-3 !border-amber2/40 !bg-amber2-50/40 !p-4" data-testid="dupe-card"><Avatar name={dupe.full_name} size={36} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink-950">{dupe.full_name} · {dupe.customer_code}</p><p className="text-xs text-txt-secondary">{dupe.phone} · KYC {dupe.kyc_status} · open this profile instead</p></div></Link>}
        </FormSection>
        <FormSection title="Address">
          <Field label="State"><Select type="state" value={f.state_id} onChange={(v) => setF({ ...f, state_id: v, city_id: null, locality_id: null })} testId="sel-state" /></Field>
          <Field label="City"><Select type="city" parentId={f.state_id} value={f.city_id} onChange={(v) => setF({ ...f, city_id: v, locality_id: null })} disabled={!f.state_id} testId="sel-city" /></Field>
          <Field label="Locality"><Select type="locality" parentId={f.city_id} value={f.locality_id} onChange={(v) => { const pin = opts("locality", f.city_id).find((o) => o.value === v)?.meta?.pincode; setF({ ...f, locality_id: v, pincode: pin || f.pincode }); }} disabled={!f.city_id} testId="sel-locality" /></Field>
          <Field label="Pincode" hint={localityPin ? "Auto-filled from locality" : f.locality_id ? "No pincode on file for this locality — type it" : undefined}><input className="input" value={f.pincode} onChange={(e) => set("pincode", e.target.value)} maxLength={6} inputMode="numeric" placeholder={f.locality_id && !localityPin ? "Type 6-digit pincode" : ""} readOnly={Boolean(localityPin)} data-testid="cust-pincode" /><FieldError name="address_current.pincode" fields={fe.fields} /></Field>
          <Field label="Address line" className="md:col-span-2"><input className="input" value={f.line1} onChange={(e) => set("line1", e.target.value)} data-testid="cust-line1" /></Field>
          <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={f.permanent_same_as_current} onChange={(e) => set("permanent_same_as_current", e.target.checked)} data-testid="same-permanent" />Permanent address same as current</label>
        </FormSection>
        <FormSection title="Profile">
          <Field label="Occupation"><Select type="occupation" value={f.occupation_id} onChange={(v) => set("occupation_id", v)} testId="sel-occupation" /></Field>
          <Field label="Company"><input className="input" value={f.company_name} onChange={(e) => set("company_name", e.target.value)} data-testid="cust-company" /></Field>
          <Field label="Income band"><Select type="income_band" value={f.income_band_id} onChange={(v) => set("income_band_id", v)} testId="sel-income" /></Field>
          <Field label="Segments"><Select type="customer_segment" multiple value={f.segment_ids} onChange={(v) => set("segment_ids", v)} testId="sel-segments" /></Field>
          <Field label="Source"><Select type="lead_source" value={f.source_id} onChange={(v) => set("source_id", v)} testId="sel-source" /></Field>
          <Field label="Relationship manager"><Select options={people} value={f.rm_user_id} onChange={(v) => set("rm_user_id", v)} allowAdd={false} testId="sel-rm" /></Field>
        </FormSection>
        <FormSection title="Preferences">
          <Field label="BHK"><Select type="bhk_preference" multiple value={f.preferences.bhk_ids} onChange={(v) => setP("bhk_ids", v)} testId="sel-bhk" /></Field>
          <Field label="Facing"><Select type="facing" multiple value={f.preferences.facing_ids} onChange={(v) => setP("facing_ids", v)} testId="sel-facing" /></Field>
          <Field label="Floor preference"><Select type="floor_preference" value={f.preferences.floor_preference_id} onChange={(v) => setP("floor_preference_id", v)} testId="sel-floor" /></Field>
          <Field label="Budget band"><Select type="budget_band" value={f.preferences.budget_band_id} onChange={(v) => setP("budget_band_id", v)} testId="sel-budget" /></Field>
          <Field label="Interested projects" className="md:col-span-2"><Select options={projOpts} multiple value={f.preferences.project_ids} onChange={(v) => setP("project_ids", v)} allowAdd={false} testId="sel-projects" /></Field>
        </FormSection>
        <div className="space-y-6">
          <Card>
            <div className="mb-4 flex items-center justify-between"><h3 className="font-display text-lg">Co-applicants</h3><button type="button" onClick={() => set("co_applicants", [...f.co_applicants, { name: "", relation_id: null, phone: "" }])} className="btn btn-secondary btn-sm" data-testid="add-coapplicant"><Plus className="h-3.5 w-3.5" />Add</button></div>
            {f.co_applicants.length === 0 && <p className="text-sm text-txt-muted">None added.</p>}
            {f.co_applicants.map((c, i) => <div key={i} className="mb-3 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2" data-testid={`coapp-${i}`}><Field label="Relation"><Select type="relation" value={c.relation_id} onChange={(v) => set("co_applicants", f.co_applicants.map((x, j) => (j === i ? { ...x, relation_id: v } : x)))} /></Field><Field label="Name"><input className="input" value={c.name} onChange={(e) => set("co_applicants", f.co_applicants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field><Field label="Phone"><input className="input" value={c.phone} onChange={(e) => set("co_applicants", f.co_applicants.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} /></Field><button type="button" onClick={() => set("co_applicants", f.co_applicants.filter((_, j) => j !== i))} className="btn btn-ghost !h-10 !w-10 !px-0 text-brick" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></div>)}
          </Card>
          <FormSection title="Nominee">
            <Field label="Relation"><Select type="relation" value={f.nominee.relation_id} onChange={(v) => set("nominee", { ...f.nominee, relation_id: v })} testId="sel-nominee-relation" /></Field>
            <Field label="Name"><input className="input" value={f.nominee.name || ""} onChange={(e) => set("nominee", { ...f.nominee, name: e.target.value })} data-testid="nominee-name" /></Field>
            <Field label="Date of birth"><input type="date" className="input" value={f.nominee.dob || ""} onChange={(e) => set("nominee", { ...f.nominee, dob: e.target.value })} /></Field>
          </FormSection>
        </div>
        <FormSection title="KYC" helper="Encrypted at rest and masked after save. Leave blank to keep existing values.">
          <Field label="PAN" error={panErr} hint={existing?.pan_masked ? `Stored ${existing.pan_masked}` : "AAAAA9999A"}><input className="input font-mono uppercase" value={f.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} maxLength={10} data-testid="cust-pan" /></Field>
          <Field label="Aadhaar" error={aadErr} hint={existing?.aadhaar_masked ? `Stored ${existing.aadhaar_masked}` : "12 digits, Verhoeff-checked"}><input className="input font-mono" inputMode="numeric" value={f.aadhaar} onChange={(e) => set("aadhaar", e.target.value.replace(/\D/g, ""))} maxLength={12} data-testid="cust-aadhaar" /></Field>
        </FormSection>
      </div>
      <div className="sticky bottom-4 z-10 flex justify-end"><button type="submit" disabled={busy} className="btn btn-primary shadow-lg" data-testid="customer-submit-bottom">{busy ? "Saving…" : id ? "Save changes" : "Create customer"}</button></div>
      {opts && null}
    </form>
  );
}
