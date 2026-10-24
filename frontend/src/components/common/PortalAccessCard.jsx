import { useEffect, useState } from "react";
import { Copy, KeyRound, Smartphone } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";

export function PortalAccessCard({ customerId }) {
  const { can } = useAuth();
  const [st, setSt] = useState(null);
  const [temp, setTemp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [portalUrl, setPortalUrl] = useState(process.env.REACT_APP_PORTAL_URL || "");
  useEffect(() => { api.get("/public/site").then((r) => r.data.portal_url && setPortalUrl(r.data.portal_url)).catch(() => {}); }, []);
  const load = () => api.get(`/customers/${customerId}/portal`).then((r) => setSt(r.data)).catch(() => setSt({ enabled: false }));
  useEffect(() => { if (can("customer.portal_manage")) load(); }, [customerId]); // eslint-disable-line
  if (!can("customer.portal_manage") || !st) return null;
  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); if (r?.data?.temporary_password) setTemp(r.data); toast.success(ok); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const copy = () => { navigator.clipboard?.writeText(`Login: ${temp.login_phone}\nTemporary password: ${temp.temporary_password}`); toast.success("Copied"); };
  return (
    <div className="card-elev p-5" data-testid="portal-access-card">
      <div className="mb-3 flex items-center gap-2"><Smartphone className="h-4 w-4 text-gold" /><h3 className="text-sm font-bold text-navy">Customer portal access</h3><span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${st.enabled ? (st.is_active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700") : "bg-slate-100 text-slate-600"}`} data-testid="portal-access-status">{!st.enabled ? "Not enabled" : st.is_active ? "Active" : "Disabled"}</span></div>
      {st.enabled && <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600"><dt>Login phone</dt><dd className="font-mono text-navy" data-testid="portal-login-phone">{st.login_phone}</dd><dt>Last login</dt><dd data-testid="portal-last-login">{st.last_login_at ? fmtDateTime(st.last_login_at) : "Never"}</dd><dt>Active sessions</dt><dd>{st.sessions}</dd><dt>Must change password</dt><dd>{st.must_change_password ? "Yes" : "No"}</dd>{st.locked_until && st.locked_until > new Date().toISOString() && <><dt>Locked until</dt><dd className="text-red-600">{fmtDateTime(st.locked_until)}</dd></>}</dl>}
      {temp && <div className="mt-3 rounded-lg border border-gold-border bg-gold-light p-3 text-sm" data-testid="portal-temp-password"><p className="text-xs font-bold uppercase tracking-wide text-[#8a6d12]">One-time temporary password — shown once</p><p className="mt-1 font-mono text-navy">Login {temp.login_phone} · <b>{temp.temporary_password}</b></p><Button size="sm" variant="outline" className="mt-2" onClick={copy} data-testid="portal-copy-temp"><Copy className="mr-1 h-3.5 w-3.5" />Copy</Button></div>}
      {st.enabled && portalUrl && <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs" data-testid="portal-share-link"><span className="text-slate-500">Login link</span><a href={portalUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-all font-mono text-navy hover:underline">{portalUrl}</a><Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => { navigator.clipboard?.writeText(`Login to your ${portalUrl} with mobile ${st.login_phone}`); toast.success("Link copied"); }} data-testid="portal-copy-link"><Copy className="mr-1 h-3 w-3" />Share login link</Button></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        {!st.enabled && <Button size="sm" className="bg-navy hover:bg-navy-700" disabled={busy} onClick={() => run(() => api.post(`/customers/${customerId}/portal/enable`), "Portal enabled")} data-testid="portal-enable-btn"><KeyRound className="mr-1 h-3.5 w-3.5" />Enable portal</Button>}
        {st.enabled && <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => api.post(`/customers/${customerId}/portal/enable`), "Password reset")} data-testid="portal-reset-btn">Reset password</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => api.post(`/customers/${customerId}/portal/toggle`, { is_active: !st.is_active }), st.is_active ? "Portal disabled" : "Portal enabled")} data-testid="portal-toggle-btn">{st.is_active ? "Disable" : "Enable"}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.post(`/customers/${customerId}/portal/revoke-sessions`), "Sessions revoked")} data-testid="portal-revoke-btn">Revoke sessions</Button>
        </>}
      </div>
    </div>
  );
}
