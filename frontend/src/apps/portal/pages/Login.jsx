import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Eye, EyeOff, Lock, Phone } from "lucide-react";
import { toast } from "sonner";
import { usePortalAuth } from "../PortalAuth";
import { perr } from "../api";

export default function Login({ base }) {
  const { me, loading, login, changePassword } = usePortalAuth();
  const loc = useLocation();
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [npw, setNpw] = useState("");
  const [npw2, setNpw2] = useState("");
  if (!loading && me && !me.must_change_password) return <Navigate to={loc.state?.from && loc.state.from !== `${base}/login` ? loc.state.from : `${base}/`} replace />;
  const forced = me?.must_change_password;

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await login(phone.replace(/\D/g, "").slice(-10), pw); toast.success(r.must_change_password ? "Please set a new password" : `Welcome, ${r.name}`); }
    catch (err) { toast.error(perr(err, "Login failed")); } finally { setBusy(false); }
  };
  const change = async (e) => {
    e.preventDefault();
    if (npw !== npw2) return toast.error("Passwords do not match");
    setBusy(true);
    try { await changePassword(pw, npw); toast.success("Password updated"); } catch (err) { toast.error(perr(err)); } finally { setBusy(false); }
  };

  return (
    <div className="portal flex min-h-screen flex-col md:flex-row" data-testid="portal-login-page">
      <div className="relative hidden flex-1 flex-col justify-between bg-[#0B1F3A] p-12 text-white md:flex">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#C9A227] text-lg font-extrabold text-[#0B1F3A]">K</span>
        <div><p className="serif text-5xl font-semibold leading-tight">Your home,<br />always within reach.</p><p className="mt-4 max-w-md text-slate-300">Track payments, download receipts, watch construction progress and reach your relationship manager — all in one place.</p></div>
        <p className="text-xs text-slate-400">KKT Customer Portal</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm fade-up">
          <div className="mb-8 flex items-center gap-3 md:hidden"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0B1F3A] text-base font-extrabold text-[#C9A227]">K</span><div><p className="serif text-2xl font-semibold text-[#0B1F3A]">KKT Home</p><p className="text-xs text-slate-500">Customer portal</p></div></div>
          {!forced ? (
            <form onSubmit={submit} className="pcard p-6 sm:p-8" data-testid="portal-login-form">
              <h1 className="serif text-3xl font-semibold text-[#0B1F3A]">Sign in</h1>
              <p className="mt-1 text-sm text-slate-500">Use the mobile number registered with your booking.</p>
              <label className="plabel mt-6">Mobile number</label>
              <div className="relative"><Phone className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="pinput pl-11" inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile" value={phone} onChange={(e) => setPhone(e.target.value)} required data-testid="portal-login-phone" /></div>
              <label className="plabel mt-4">Password</label>
              <div className="relative"><Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="pinput pl-11 pr-12" type={show ? "text" : "password"} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required data-testid="portal-login-password" /><button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center text-slate-400" aria-label="Toggle password" data-testid="portal-login-toggle-pw">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
              <button className="pbtn mt-6 w-full" disabled={busy} data-testid="portal-login-submit">{busy ? "Signing in…" : "Sign in"}</button>
              <p className="mt-4 text-center text-xs text-slate-500">Forgot your password? Call your Relationship Manager to reset it.</p>
            </form>
          ) : (
            <form onSubmit={change} className="pcard p-6 sm:p-8" data-testid="portal-force-change-form">
              <h1 className="serif text-3xl font-semibold text-[#0B1F3A]">Set a new password</h1>
              <p className="mt-1 text-sm text-slate-500">Hi {me.customer?.full_name}. For your security, please replace the temporary password.</p>
              <label className="plabel mt-6">New password</label><input className="pinput" type="password" value={npw} onChange={(e) => setNpw(e.target.value)} required minLength={8} data-testid="portal-new-password" />
              <label className="plabel mt-4">Confirm password</label><input className="pinput" type="password" value={npw2} onChange={(e) => setNpw2(e.target.value)} required data-testid="portal-new-password-2" />
              <p className="mt-2 text-xs text-slate-500">At least 8 characters with upper, lower, number and symbol.</p>
              <button className="pbtn pbtn-gold mt-6 w-full" disabled={busy} data-testid="portal-force-change-submit">{busy ? "Saving…" : "Save & continue"}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
