import { HistoryButton } from "@/components/common/HistoryTimeline";
import { Link } from "react-router-dom";
import { MfaCard, SessionsCard, ImportCenter } from "@/components/common/SecurityCards";
import { SystemHealthCard } from "@/components/common/SystemHealth";
import { PropagationHealthCard } from "@/components/common/PropagationHealth";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Field } from "@/components/common/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDensity } from "@/hooks/useDensity";
import { Segmented } from "@/components/v2/CustomerBits";
import { BookOpen, Download, RefreshCw } from "lucide-react";

function DocumentationPanel() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  if (user?.role_name !== "Super Admin") return null;
  const download = async (ext) => { try { const r = await api.get(`/admin/docs/technical.${ext}`, { responseType: "blob" }); const a = document.createElement("a"); a.href = URL.createObjectURL(r.data); a.download = `KKT_Technical_Documentation.${ext}`; a.click(); } catch (e) { toast.error(errMsg(e)); } };
  const regen = async () => { setBusy(true); try { const r = await api.post("/admin/docs/regenerate"); setInfo(r.data); toast.success(`Documentation rebuilt · ${r.data.pages} pages`); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <section className="card p-6" data-testid="documentation-card">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-[10px] bg-warm-100"><BookOpen className="h-5 w-5" strokeWidth={1.75} /></span><div><h3 className="font-display text-lg text-ink-950">Documentation</h3><p className="mt-1 text-sm text-txt-secondary">Technical & Functional Specification generated from the code base (branded A4 PDF + Markdown source).{info && <span data-testid="docs-info"> Last build: {info.pages} pages · {(info.size_bytes / 1024 / 1024).toFixed(1)} MB.</span>}</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => download("pdf")} data-testid="docs-download-pdf"><Download className="h-4 w-4" />Download PDF</button>
        <button className="btn btn-secondary" onClick={() => download("md")} data-testid="docs-download-md"><Download className="h-4 w-4" />Markdown</button>
        <button className="btn btn-ghost" disabled={busy} onClick={regen} data-testid="docs-regenerate"><RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />{busy ? "Rebuilding…" : "Regenerate"}</button>
      </div>
    </section>
  );
}

function Appearance() {
  const [density, setDensity] = useDensity();
  return (
    <section className="card p-6" data-testid="appearance-card">
      <h3 className="font-display text-lg text-ink-950">Appearance</h3>
      <p className="mt-1 text-sm text-txt-secondary">Density changes spacing across the ERP for this browser profile.</p>
      <div className="mt-4"><Segmented options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} value={density} onChange={setDensity} testId="density-toggle" /></div>
    </section>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function IntegrityPanel() {
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { const r = await api.get("/admin/integrity-report?fresh=1"); setRep(r.data); toast[r.data.ok ? "success" : "warning"](r.data.ok ? "Integrity check clean" : `${r.data.findings.length} finding(s)`); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const fix = async () => { if (window.prompt('Repair voids demands whose trigger is not met (only if no payment applied) and raises missing ones. Type REPAIR to confirm.') !== "REPAIR") return; setBusy(true); try { const r = await api.post("/admin/integrity-repair", { confirm: "REPAIR" }); toast.success(`Voided ${r.data.voided.length} · raised ${r.data.raised} · skipped ${r.data.skipped.length}`); await run(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <div className="card mb-5 p-5" data-testid="integrity-panel">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-ink-950">Data · Dues integrity</h3><p className="text-sm text-txt-secondary">Checks every active booking: installments raised without their trigger met, triggered but not raised, duplicates, summary mismatches.</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={run} data-testid="integrity-run-btn">Run integrity check</Button>{rep && !rep.ok && <Button className="bg-ink-950 hover:bg-ink-800" disabled={busy} onClick={fix} data-testid="integrity-repair-btn">Repair</Button>}</div></div>
      {rep && <div className="mt-4 text-sm" data-testid="integrity-result"><p className={`font-semibold ${rep.ok ? "text-sage" : "text-amber2"}`}>{rep.ok ? "Clean" : "Findings"} · {rep.bookings_checked} booking(s) checked · {Object.entries(rep.counts).map(([k, v]) => `${k}: ${v}`).join(", ") || "0 findings"}</p>
        {rep.findings.length > 0 && <ul className="mt-2 max-h-64 divide-y overflow-y-auto">{rep.findings.map((f) => <li key={`${f.booking_number}-${f.kind}-${f.demand_number || f.detail}`} className="py-1.5"><span className="font-mono text-xs text-txt-secondary">{f.booking_number}</span> · <span className="font-semibold">{f.kind}</span> · {f.detail}{f.demand_number ? ` (${f.demand_number}${f.paid > 0 ? `, paid ₹${f.paid}` : ""})` : ""}</li>)}</ul>}</div>}
    </div>
  );
}

function DataPanel() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/admin/backups").then((r) => setItems(r.data.items)).catch(() => {});
  useEffect(() => { if (user?.role_name === "Super Admin") load(); }, [user]);
  if (user?.role_name !== "Super Admin") return null;
  const run = async (sensitive) => { setBusy(true); try { const r = await api.post(`/admin/backup?include_sensitive=${sensitive}`); window.open(`${API}${r.data.download_url.replace("/api", "")}`, "_blank"); toast.success("Backup ready — download started"); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <div className="card mb-5 p-5" data-testid="data-panel">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-ink-950">Data · Backup & export</h3><p className="text-sm text-txt-secondary">Zip of JSON per collection. Links expire in 15 minutes. KYC fields are stripped unless you include sensitive data.</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => run(false)} data-testid="backup-btn">Download full backup</Button><Button variant="ghost" disabled={busy} onClick={() => run(true)} data-testid="backup-sensitive-btn">Include sensitive</Button></div></div>
      {items.length > 0 && <ul className="mt-4 divide-y text-sm">{items.slice(0, 5).map((b) => <li key={b.id} className="flex justify-between py-1.5"><span>{new Date(b.created_at).toLocaleString("en-IN")} · {b.by_name}{b.include_sensitive ? " · sensitive" : ""}</span><span className="text-txt-secondary">{(b.size / 1024).toFixed(0)} KB</span></li>)}</ul>}
    </div>
  );
}

export default function Settings() {
  const { setCompany } = useAuth();
  const [c, setC] = useState(null);
  const [acct, setAcct] = useState("");
  const [busy, setBusy] = useState(false);
  const [numbering, setNumbering] = useState(null);
  useEffect(() => { api.get("/settings/company").then((r) => setC({ ...r.data, address: r.data.address || {}, bank_account: r.data.bank_account || {} })).catch((e) => toast.error(errMsg(e))); api.get("/settings/numbering/preview").then((n) => setNumbering(n.data)).catch(() => {}); }, []);
  if (!c) return <Skeleton className="h-96" />;
  const set = (k, v) => setC((prev) => ({ ...prev, [k]: v }));
  const setA = (k, v) => setC({ ...c, address: { ...c.address, [k]: v } });
  const setB = (k, v) => setC({ ...c, bank_account: { ...c.bank_account, [k]: v } });
  const save = async (e) => {
    e?.preventDefault?.(); setBusy(true);
    const ba = { bank_name: c.bank_account.bank_name || null, account_name: c.bank_account.account_name || null, ifsc: c.bank_account.ifsc || null, branch: c.bank_account.branch || null };
    if (acct) ba.account_number = acct;
    try {
      const r = await api.patch("/settings/company", { version: c.version, name: c.name, legal_name: c.legal_name || null, address: c.address, gstin: c.gstin || null, rera_registration: c.rera_registration || null, logo_url: c.logo_url || null, financial_year_start_month: Number(c.financial_year_start_month), receipt_prefix: c.receipt_prefix || null, bank_account: ba,
        booking_number_format: c.booking_number_format || null, customer_number_format: c.customer_number_format || null, demand_number_format: c.demand_number_format || null, demand_due_days: c.demand_due_days ?? null, audit_retention_months: c.audit_retention_months ?? null, default_gst_percent: c.default_gst_percent ?? null, authorised_signatory_name: c.authorised_signatory_name || null, letterhead_tagline: c.letterhead_tagline || null, letterhead_phone: c.letterhead_phone || null, letterhead_email: c.letterhead_email || null, receipt_number_format: c.receipt_number_format || null, mfa_required_for_admin_roles: !!c.mfa_required_for_admin_roles, accent: c.accent || "gold" });
      setC({ ...r.data, address: r.data.address || {}, bank_account: r.data.bank_account || {} }); setAcct(""); setCompany(r.data); toast.success("Settings saved");
      api.get("/settings/numbering/preview").then((n) => setNumbering(n.data)).catch(() => {});
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <div data-testid="settings-page">
      <PageHeader title="Company Settings" subtitle="Identity, statutory registrations and banking." actions={<div className="flex flex-wrap gap-2"><HistoryButton entityType="company" entityId={c?.id} label="Company" /><Link to="/settings/definitions" className="btn btn-ghost" data-testid="definitions-link">Definitions</Link><Link to="/settings/catalogues" className="btn btn-ghost btn-sm" data-testid="settings-catalogues-link">Catalogues</Link><Link to="/users" className="btn btn-ghost btn-sm">Users</Link><Link to="/roles" className="btn btn-ghost btn-sm">Roles</Link><Link to="/audit" className="btn btn-ghost btn-sm">Audit log</Link></div>} />
      <DataPanel />
      <Appearance />
      <DocumentationPanel />
      <IntegrityPanel />
      <SystemHealthCard />
      <PropagationHealthCard />
      <form onSubmit={save} className="grid gap-5 lg:grid-cols-2">
        <div className="card space-y-4 p-5">
          <h3 className="text-base font-bold text-ink-950">Company identity</h3>
          <Field label="Company name" required><Input value={c.name} onChange={(e) => set("name", e.target.value)} required data-testid="settings-name-input" /></Field>
          <Field label="Legal name"><Input value={c.legal_name || ""} onChange={(e) => set("legal_name", e.target.value)} data-testid="settings-legal-name-input" /></Field>
          <Field label="Address"><Input value={c.address.line1 || ""} onChange={(e) => setA("line1", e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-3"><Field label="City"><Input value={c.address.city || ""} onChange={(e) => setA("city", e.target.value)} /></Field><Field label="State"><Input value={c.address.state || ""} onChange={(e) => setA("state", e.target.value)} /></Field><Field label="Pincode"><Input value={c.address.pincode || ""} onChange={(e) => setA("pincode", e.target.value)} /></Field></div>
          <div className="grid grid-cols-2 gap-3"><Field label="GSTIN"><Input value={c.gstin || ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} data-testid="settings-gstin-input" /></Field><Field label="RERA registration"><Input value={c.rera_registration || ""} onChange={(e) => set("rera_registration", e.target.value)} /></Field></div>
          <Field label="Logo URL"><Input value={c.logo_url || ""} onChange={(e) => set("logo_url", e.target.value)} /></Field>
        </div>
        <div className="space-y-5">
          <div className="card space-y-4 p-5">
            <h3 className="text-base font-bold text-ink-950">Finance</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Financial year starts"><Select value={String(c.financial_year_start_month)} onValueChange={(v) => set("financial_year_start_month", v)}><SelectTrigger data-testid="settings-fy-select"><SelectValue /></SelectTrigger><SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Receipt number prefix"><Input value={c.receipt_prefix || ""} onChange={(e) => set("receipt_prefix", e.target.value.toUpperCase())} maxLength={10} data-testid="settings-receipt-prefix-input" /></Field>
            </div>
          </div>
          <div className="card space-y-4 p-5">
            <div className="flex items-center justify-between"><h3 className="text-base font-bold text-ink-950">Bank account</h3><span className="flex items-center gap-1 text-[11px] font-semibold text-sage"><ShieldCheck className="h-3.5 w-3.5" />Encrypted at rest (Fernet)</span></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Bank"><Input value={c.bank_account.bank_name || ""} onChange={(e) => setB("bank_name", e.target.value)} data-testid="settings-bank-name-input" /></Field><Field label="Account name"><Input value={c.bank_account.account_name || ""} onChange={(e) => setB("account_name", e.target.value)} /></Field></div>
            <Field label="Account number" hint={`Stored: ${c.bank_account.account_number_masked || "—"} · enter a new value to replace`}><Input value={acct} onChange={(e) => setAcct(e.target.value)} placeholder={c.bank_account.account_number_masked || "Account number"} className="mono" data-testid="settings-account-number-input" /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="IFSC"><Input value={c.bank_account.ifsc || ""} onChange={(e) => setB("ifsc", e.target.value.toUpperCase())} data-testid="settings-ifsc-input" /></Field><Field label="Branch"><Input value={c.bank_account.branch || ""} onChange={(e) => setB("branch", e.target.value)} /></Field></div>
          </div>
          <Button type="submit" disabled={busy} className="w-full bg-ink-950 hover:bg-ink-800" data-testid="settings-save-btn">Save settings</Button>
        </div>
      </form>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="card space-y-4 p-5" data-testid="numbering-card">
          <h3 className="text-base font-bold text-ink-950">Numbering & policies</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Booking number format" hint="Tokens {FY} {PREFIX} {SEQ}"><Input value={c.booking_number_format || "BK/{FY}/{SEQ}"} onChange={(e) => set("booking_number_format", e.target.value)} data-testid="settings-booking-format" /></Field>
            <Field label="Receipt number format"><Input value={c.receipt_number_format || "{PREFIX}/{FY}/{SEQ}"} onChange={(e) => set("receipt_number_format", e.target.value)} data-testid="settings-receipt-format" /></Field>
            <Field label="Customer number format"><Input value={c.customer_number_format || "CUST-{FY}-{SEQ}"} onChange={(e) => set("customer_number_format", e.target.value)} data-testid="settings-customer-format" /></Field>
            <Field label="Demand number format"><Input value={c.demand_number_format || "DM-{FY}-{SEQ}"} onChange={(e) => set("demand_number_format", e.target.value)} data-testid="settings-demand-format" /></Field>
            <Field label="Demand due days" hint="Days after milestone completion"><Input type="number" min="1" max="120" value={c.demand_due_days ?? 15} onChange={(e) => set("demand_due_days", Number(e.target.value))} data-testid="settings-demand-due-days" /></Field>
            <Field label="Audit hot retention (months)" hint="Older audit rows move to the archive monthly — never deleted, still searchable with “Include archive”"><Input type="number" min="1" max="120" value={c.audit_retention_months ?? 24} onChange={(e) => set("audit_retention_months", Number(e.target.value))} data-testid="settings-audit-retention" /></Field>
            <Field label="Default GST % (taxable charges)"><Input type="number" min="0" max="28" value={c.default_gst_percent ?? 18} onChange={(e) => set("default_gst_percent", Number(e.target.value))} data-testid="settings-gst" /></Field>
            <Field label="Authorised signatory"><Input value={c.authorised_signatory_name || ""} onChange={(e) => set("authorised_signatory_name", e.target.value)} data-testid="settings-signatory" /></Field>
            <p className="text-xs text-txt-secondary" data-testid="letterhead-moved">Letterhead (logo, GSTIN/RERA footer, signatory, footer note) now lives in <Link to="/masters/company" className="font-semibold text-gold hover:underline" data-testid="letterhead-masters-link">Masters → Company &amp; letterhead</Link>.</p>
            <Field label="Letterhead tagline"><Input value={c.letterhead_tagline || ""} onChange={(e) => set("letterhead_tagline", e.target.value)} /></Field>
            <Field label="Letterhead phone"><Input value={c.letterhead_phone || ""} onChange={(e) => set("letterhead_phone", e.target.value)} /></Field>
            <Field label="Letterhead email"><Input value={c.letterhead_email || ""} onChange={(e) => set("letterhead_email", e.target.value)} /></Field>
          </div>
          {numbering && <p className="text-xs text-txt-secondary">Next (FY {numbering.financial_year}): booking <b className="mono">{numbering.next.booking}</b> · receipt <b className="mono">{numbering.next.receipt}</b></p>}
          <div className="flex items-center justify-between rounded-md border p-3"><div><p className="text-sm font-semibold text-ink-950">Require MFA for admin roles</p><p className="text-xs text-txt-secondary">Users with users/roles/settings permissions are prompted to enrol on login.</p></div><Switch checked={!!c.mfa_required_for_admin_roles} onCheckedChange={(v) => set("mfa_required_for_admin_roles", v)} data-testid="settings-mfa-policy" /></div>
          <Field label="Accent (navy locked)"><Select value={c.accent || "gold"} onValueChange={(v) => set("accent", v)}><SelectTrigger data-testid="settings-accent"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gold">Royal gold</SelectItem><SelectItem value="teal">Teal</SelectItem></SelectContent></Select></Field>
          <Button onClick={save} disabled={busy} variant="outline" data-testid="settings-save-policies-btn">Save policies</Button>
        </div>
        <div className="space-y-5"><MfaCard /><SessionsCard /></div>
      </div>
      <div className="mt-6"><ImportCenter /></div>
    </div>
  );
}
