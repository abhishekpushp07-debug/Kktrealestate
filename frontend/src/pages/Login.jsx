import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { errMsg } from "@/lib/api";
import { Field } from "@/components/v2";

const DEMO = [["Super Admin", "admin@kkt.in"], ["Project Admin", "projectadmin@kkt.in"], ["Accounts", "accounts@kkt.in"], ["Sales", "sales@kkt.in"], ["Employee", "employee@kkt.in"]];
const isDev = /preview\.emergentagent|localhost/.test(window.location.hostname);

export default function Login() {
  const { login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (mfa) await loginMfa(mfa.mfa_token, code);
      else {
        const d = await login(email.trim(), password);
        if (d.mfa_required) { setMfa(d); setBusy(false); return; }
        if (d.must_change_password) toast.warning("Please change your password (Profile menu → Change password).");
      }
      toast.success("Signed in");
      navigate(loc.state?.from || "/dashboard", { replace: true });
    } catch (err) { setError(errMsg(err, "Login failed")); } finally { setBusy(false); }
  };

  return (
    <div className="v2 grid min-h-screen lg:grid-cols-[1.15fr_1fr]" data-testid="login-page">
      <div className="hero relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="grain absolute inset-0 opacity-70" />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full border border-gold/15" /><div className="pointer-events-none absolute -right-20 -top-20 h-[320px] w-[320px] rounded-full border border-gold/25" />
        <div className="relative flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-gold/40 font-display text-xl text-gold-400">K</span><span className="font-display text-2xl tracking-wide">KKT</span></div>
        <div className="relative max-w-xl">
          <p className="label !text-gold-400">Real estate ERP</p>
          <h1 className="mt-4 font-display text-5xl leading-[1.08] text-warm-50">Every tower, every buyer, every rupee — <em className="not-italic text-gold-400">in one ledger of truth.</em></h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-warm-200/70">Projects, inventory, construction-linked dues, Cash · Account · Other-charge ledgers, and customer care for builders who run on trust.</p>
        </div>
        <div className="relative hero-hair" />
      </div>
      <div className="flex items-center justify-center p-6 md:p-12">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="mb-8 lg:hidden"><span className="font-display text-3xl">KKT</span></div>
          <p className="label">{mfa ? "Security" : "Sign in"}</p>
          <h2 className="mt-2 font-display text-3xl text-ink-950">{mfa ? "Two-step verification" : "Sign in to the ERP"}</h2>
          <div className="mt-8 space-y-5">
            {mfa ? <Field label={`Authenticator code for ${mfa.user.email}`} required><input autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" required className="input tracking-[.3em]" data-testid="login-mfa-code-input" /></Field> : (
              <>
                <Field label="Work email" required><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.in" required className="input" data-testid="login-email-input" /></Field>
                <Field label="Password" required>
                  <div className="relative"><input type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="input pr-11" data-testid="login-password-input" /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-muted hover:text-ink-950" aria-label="Toggle password" data-testid="login-toggle-password">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
                </Field>
              </>
            )}
            {error && <p className="rounded-xl bg-brick-50 px-4 py-3 text-sm text-brick" role="alert" data-testid="login-error">{error}</p>}
            <button type="submit" disabled={busy} className="btn btn-primary w-full" data-testid="login-submit-button">{busy ? "Signing in…" : mfa ? "Verify" : "Sign in"}</button>
          </div>
          {isDev && !mfa && (
            <div className="mt-10">
              <p className="label">Demo accounts · password Kkt@12345</p>
              <div className="mt-3 flex flex-wrap gap-2">{DEMO.map(([r, e]) => <button key={e} type="button" onClick={() => { setEmail(e); setPassword("Kkt@12345"); }} className="pill border border-warm-200 bg-white text-txt-secondary hover:border-gold hover:text-ink-950" data-testid={`demo-${r.toLowerCase().replace(" ", "-")}`}>{r}</button>)}</div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
