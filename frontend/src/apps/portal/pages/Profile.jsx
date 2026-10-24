import { useState } from "react";
import { toast } from "sonner";
import { usePortalAuth } from "../PortalAuth";
import { PageTitle } from "../PortalShell";
import { fmtDateTime } from "../hooks";
import papi, { perr } from "../api";

export default function Profile() {
  const { me, refreshMe, changePassword, logout } = usePortalAuth();
  const c = me.customer;
  const [f, setF] = useState({ email: c.email || "", alt_phone: c.alt_phone || "", line1: c.address_current?.line1 || "", city: c.address_current?.city || "", state: c.address_current?.state || "", pincode: c.address_current?.pincode || "" });
  const [pw, setPw] = useState({ cur: "", n1: "", n2: "" });
  const [busy, setBusy] = useState(false);
  const save = async (e) => { e.preventDefault(); setBusy(true); try { await papi.patch("/me", { email: f.email || null, alt_phone: f.alt_phone || null, address_current: { line1: f.line1, city: f.city, state: f.state, pincode: f.pincode } }); await refreshMe(); toast.success("Profile updated"); } catch (err) { toast.error(perr(err)); } finally { setBusy(false); } };
  const chg = async (e) => { e.preventDefault(); if (pw.n1 !== pw.n2) return toast.error("Passwords do not match"); setBusy(true); try { await changePassword(pw.cur, pw.n1); toast.success("Password changed"); setPw({ cur: "", n1: "", n2: "" }); } catch (err) { toast.error(perr(err)); } finally { setBusy(false); } };
  return (
    <div data-testid="portal-profile">
      <PageTitle title="Profile" sub={`${c.customer_code} · last login ${fmtDateTime(me.last_login_at)}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="pcard p-5 fade-up" data-testid="profile-identity"><p className="font-bold text-[#0B1F3A]">Identity (read-only)</p>
          {[["Name", `${c.salutation || ""} ${c.full_name}`], ["Registered mobile", c.phone], ["KYC status", c.kyc_status], ["PAN", c.pan_masked], ["Aadhaar", c.aadhaar_masked]].map(([k, v]) => <div key={k} className="row"><span className="text-sm text-slate-500">{k}</span><span className="text-sm font-semibold text-[#0B1F3A]">{v || "—"}</span></div>)}
          {me.co_applicants?.length > 0 && <div className="row"><span className="text-sm text-slate-500">Co-applicants</span><span className="text-right text-sm font-semibold text-[#0B1F3A]">{me.co_applicants.map((x) => x.full_name).join(", ")}</span></div>}
          <p className="mt-3 text-xs text-slate-500">To change your name or registered mobile, contact your Relationship Manager.</p>
        </div>
        <form onSubmit={save} className="pcard space-y-3 p-5 fade-up" data-testid="profile-edit-form"><p className="font-bold text-[#0B1F3A]">Contact details</p>
          <div><label className="plabel">Email</label><input className="pinput" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="profile-email" /></div>
          <div><label className="plabel">Alternate phone</label><input className="pinput" inputMode="numeric" value={f.alt_phone} onChange={(e) => setF({ ...f, alt_phone: e.target.value })} data-testid="profile-alt-phone" /></div>
          <div><label className="plabel">Address</label><input className="pinput" value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} placeholder="Street / locality" data-testid="profile-addr" /></div>
          <div className="grid grid-cols-3 gap-2"><input className="pinput" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="City" /><input className="pinput" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} placeholder="State" /><input className="pinput" value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} placeholder="PIN" inputMode="numeric" /></div>
          <button className="pbtn w-full" disabled={busy} data-testid="profile-save">Save changes</button>
        </form>
        <form onSubmit={chg} className="pcard space-y-3 p-5 fade-up" data-testid="profile-password-form"><p className="font-bold text-[#0B1F3A]">Change password</p>
          <input className="pinput" type="password" placeholder="Current password" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} required data-testid="pw-current" />
          <input className="pinput" type="password" placeholder="New password" value={pw.n1} onChange={(e) => setPw({ ...pw, n1: e.target.value })} required minLength={8} data-testid="pw-new" />
          <input className="pinput" type="password" placeholder="Confirm new password" value={pw.n2} onChange={(e) => setPw({ ...pw, n2: e.target.value })} required data-testid="pw-new-2" />
          <button className="pbtn pbtn-ghost w-full" disabled={busy} data-testid="pw-submit">Update password</button>
        </form>
        <div className="pcard p-5 fade-up"><p className="font-bold text-[#0B1F3A]">Sessions</p><p className="mt-1 text-sm text-slate-500">Sign out from this device, or everywhere if you suspect misuse.</p><div className="mt-4 flex gap-2"><button onClick={logout} className="pbtn pbtn-sm pbtn-ghost" data-testid="profile-logout">Sign out</button><button onClick={async () => { await papi.post("/auth/logout-all"); logout(); }} className="pbtn pbtn-sm" data-testid="profile-logout-all">Sign out everywhere</button></div></div>
      </div>
    </div>
  );
}
