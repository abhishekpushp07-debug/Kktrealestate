import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Smartphone, ShieldCheck, LogOut, Upload } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";

export function MfaCard() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(!!user?.mfa_enabled);
  const [enroll, setEnroll] = useState(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const start = async () => { try { const r = await api.post("/auth/mfa/enroll"); setEnroll(r.data); } catch (e) { toast.error(errMsg(e)); } };
  const verify = async () => { try { await api.post("/auth/mfa/verify", { code }); setEnabled(true); setEnroll(null); setCode(""); toast.success("MFA enabled"); } catch (e) { toast.error(errMsg(e)); } };
  const disable = async () => { try { await api.post("/auth/mfa/disable", { password: pw, code: code || null }); setEnabled(false); setPw(""); setCode(""); toast.success("MFA disabled"); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="card space-y-3 p-5" data-testid="mfa-card">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-base font-bold text-ink-950"><Smartphone className="h-4 w-4" />Two-factor authentication (TOTP)</h3><Pill tone={enabled ? "green" : "slate"}>{enabled ? "Enabled" : "Off"}</Pill></div>
      {!enabled && !enroll && <Button size="sm" onClick={start} className="bg-ink-950 hover:bg-ink-800" data-testid="mfa-enroll-btn">Set up authenticator</Button>}
      {enroll && <div className="space-y-2 rounded-md border p-3">
        <p className="text-xs text-txt-secondary">Scan with Google Authenticator / Authy, or enter the secret manually:</p>
        <img alt="QR" className="h-40 w-40 rounded border bg-white" src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(enroll.otpauth_url)}`} />
        <code className="block break-all rounded bg-warm-50 p-2 text-xs" data-testid="mfa-secret">{enroll.secret}</code>
        <div className="flex gap-2"><Input placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} className="h-9 w-40" data-testid="mfa-code-input" /><Button size="sm" onClick={verify} className="bg-ink-950 hover:bg-ink-800" data-testid="mfa-verify-btn">Verify & enable</Button></div>
      </div>}
      {enabled && <div className="flex flex-wrap gap-2"><Input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-9 w-40" data-testid="mfa-disable-password" /><Input placeholder="Current code" value={code} onChange={(e) => setCode(e.target.value)} className="h-9 w-32" data-testid="mfa-disable-code" /><Button size="sm" variant="outline" onClick={disable} className="text-brick" data-testid="mfa-disable-btn">Disable MFA</Button></div>}
    </div>
  );
}

export function SessionsCard() {
  const [items, setItems] = useState([]);
  const load = () => api.get("/auth/sessions").then((r) => setItems(r.data.items)).catch(() => {});
  useEffect(() => { load(); }, []);
  const revoke = async (id) => { try { await api.delete(id ? `/auth/sessions/${id}` : "/auth/sessions"); toast.success(id ? "Session revoked" : "All other sessions revoked"); load(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="card p-5" data-testid="sessions-card">
      <div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-base font-bold text-ink-950"><ShieldCheck className="h-4 w-4" />Active sessions ({items.length})</h3><Button size="sm" variant="outline" onClick={() => revoke(null)} data-testid="sessions-revoke-all"><LogOut className="mr-1 h-3.5 w-3.5" />Sign out everywhere</Button></div>
      <ul className="divide-y text-sm">{items.map((s) => <li key={s.id} className="flex items-center justify-between py-2" data-testid={`session-${s.id}`}><div><p className="font-semibold text-ink-950">{s.ip || "unknown IP"}</p><p className="truncate text-xs text-txt-secondary" style={{ maxWidth: 420 }}>{s.user_agent || "—"} · {fmtDateTime(s.created_at)}</p></div><Button size="sm" variant="ghost" className="text-brick" onClick={() => revoke(s.id)} data-testid={`session-revoke-${s.id}`}>Revoke</Button></li>)}</ul>
    </div>
  );
}

const KINDS = [["flat-pricing", "Flat pricing (by flat number)"], ["flat-types", "Flat types"], ["parking-slots", "Parking slots"], ["amenities", "Amenities"], ["customers", "Customers (Phase 2 schema)"]];

export function ImportCenter() {
  const [kind, setKind] = useState("flat-pricing");
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => { api.get("/projects?page_size=100").then((r) => { setProjects(r.data.items); setProjectId(r.data.items[0]?.id || ""); }).catch(() => {}); }, []);
  const needsProject = kind === "flat-pricing" || kind === "parking-slots";
  const download = async () => { const r = await api.get(`/imports/template/${kind}`, { responseType: "blob" }); const a = document.createElement("a"); a.href = URL.createObjectURL(r.data); a.download = `${kind}-template.csv`; a.click(); };
  const run = async () => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try { const r = await api.post(`/imports/${kind}/preview${needsProject ? `?project_id=${projectId}` : ""}`, fd); setPreview(r.data); } catch (e) { toast.error(errMsg(e)); }
  };
  const confirm = async () => { try { const r = await api.post(`/imports/${kind}/confirm?confirm_token=${preview.confirm_token}`); toast.success(`${r.data.written} rows written`); setPreview(null); setFile(null); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="card space-y-3 p-5" data-testid="import-center">
      <h3 className="flex items-center gap-2 text-base font-bold text-ink-950"><Upload className="h-4 w-4" />Data import center</h3>
      <p className="text-xs text-txt-secondary">Upload CSV → validation preview with row-level errors → confirm. Policy: all-or-nothing (confirm is enabled only when every row is valid).</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Import type"><Select value={kind} onValueChange={(v) => { setKind(v); setPreview(null); }}><SelectTrigger data-testid="import-kind"><SelectValue /></SelectTrigger><SelectContent>{KINDS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field>
        {needsProject && <Field label="Project"><Select value={projectId} onValueChange={setProjectId}><SelectTrigger data-testid="import-project"><SelectValue /></SelectTrigger><SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>)}</SelectContent></Select></Field>}
        <Field label="CSV file"><Input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="import-file" /></Field>
      </div>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={download} data-testid="import-template-btn">Download template</Button><Button size="sm" onClick={run} disabled={!file} className="bg-ink-950 hover:bg-ink-800" data-testid="import-preview-btn">Validate & preview</Button></div>
      {preview && <div className="rounded-md border" data-testid="import-preview">
        <div className="flex items-center justify-between border-b bg-warm-50 px-3 py-2 text-sm"><span><b>{preview.total}</b> rows · <span className="text-sage">{preview.valid} valid</span> · <span className="text-brick">{preview.invalid} invalid</span></span>{preview.confirm_token && <Button size="sm" onClick={confirm} className="bg-gold text-ink-950 hover:bg-gold-hover" data-testid="import-confirm-btn">Confirm import</Button>}</div>
        <div className="max-h-64 overflow-auto"><table className="w-full text-xs"><tbody>{preview.rows.slice(0, 200).map((r) => <tr key={r.row} className={r.errors.length ? "bg-brick-50" : ""} data-testid={`import-row-${r.row}`}><td className="w-12 px-2 py-1 text-txt-muted">#{r.row}</td><td className="px-2 py-1 font-mono">{Object.entries(r.data).filter(([k]) => !["rooms", "areas", "flat_id"].includes(k)).map(([k, v]) => `${k}=${v ?? ""}`).join("  ")}</td><td className="px-2 py-1 text-brick">{r.errors.join("; ")}</td></tr>)}</tbody></table></div>
      </div>}
    </div>
  );
}
