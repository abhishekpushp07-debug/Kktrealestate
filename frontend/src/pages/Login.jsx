import monogram from "@/assets/kkt-monogram.svg";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import api, { errMsg } from "@/lib/api";
import { Field } from "@/components/v2";

const DEMO = [["Super Admin", "admin@kkt.in"], ["Project Admin", "projectadmin@kkt.in"], ["Accounts", "accounts@kkt.in"], ["Sales", "sales@kkt.in"], ["Employee", "employee@kkt.in"]];

export default function Login() {
  const { login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [demoAllowed, setDemoAllowed] = useState(false);
  const [demoPassword, setDemoPassword] = useState("");
  useEffect(() => { api.get("/auth/login-options").then((r) => { setDemoAllowed(Boolean(r.data?.demo_accounts)); setDemoPassword(r.data?.demo_password || ""); }).catch(() => setDemoAllowed(false)); }, []);
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
        <div className="relative flex items-center gap-3" data-testid="login-brand"><img src={monogram} alt="KKT Constructions" className="h-11 w-11 rounded-xl" data-testid="login-monogram" /><div><p className="font-display text-2xl leading-none tracking-wide">KKT Constructions</p><p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-gold-400/80">Building trust, delivering homes</p></div></div>
        <div className="relative max-w-xl">
          <p className="label !text-gold-400">KKT Constructions · Real estate ERP</p>
          <h1 className="mt-4 font-display text-5xl leading-[1.08] text-warm-50">Every tower, every buyer, every rupee — <em className="not-italic text-gold-400">in one ledger of truth.</em></h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-warm-200/70">Projects, inventory, construction-linked dues, Cash · Account · Other-charge ledgers, and customer care for builders who run on trust.</p>
        </div>
        <div className="relative hero-hair" />
      </div>
      <div className="flex items-center justify-center p-6 md:p-12">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><img src={monogram} alt="KKT Constructions" className="h-10 w-10 rounded-xl" /><span className="font-display text-2xl">KKT Constructions</span></div>
          <p className="label !text-ink-950/70" data-testid="login-eyebrow">{mfa ? "Security" : "Sign in"}</p>
          <h2 className="mt-3 font-display text-4xl text-ink-950">{mfa ? "Two-step verification" : "Sign in to the ERP"}</h2>
          <p className="mt-2 text-sm text-txt-secondary">{mfa ? "Enter the 6-digit code from your authenticator app." : "Use your KKT Constructions work account."}</p>
          <div className="mt-10 space-y-7">
            {mfa ? <Field label={`Authenticator code for ${mfa.user.email}`} required><input autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" required className="input mt-2 h-12 tracking-[.3em] focus-visible:ring-2 focus-visible:ring-gold" data-testid="login-mfa-code-input" /></Field> : (
              <>
                <Field label="Work email" required><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.in" required className="input mt-2 h-12 focus-visible:ring-2 focus-visible:ring-gold" data-testid="login-email-input" /></Field>
                <Field label="Password" required>
                  <div className="relative mt-2"><input type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="input h-12 pr-11 focus-visible:ring-2 focus-visible:ring-gold" data-testid="login-password-input" /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-txt-muted hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} data-testid="login-toggle-password">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
                </Field>
              </>
            )}
            {error && <p className="rounded-xl bg-brick-50 px-4 py-3 text-sm text-brick" role="alert" data-testid="login-error">{error}</p>}
            <button type="submit" disabled={busy} className="btn btn-primary h-12 w-full text-base focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2" data-testid="login-submit-button">{busy ? "Signing in…" : mfa ? "Verify" : "Sign in"}</button>
          </div>
          {demoAllowed && !mfa && (
            <div className="mt-12 border-t border-warm-200 pt-8" data-testid="login-demo-accounts">
              <p className="label !text-ink-950/70">Demo accounts <span className="normal-case tracking-normal text-txt-muted">· password {demoPassword}</span></p>
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Demo accounts">{DEMO.map(([r, e]) => <button key={e} type="button" onClick={() => { setEmail(e); setPassword(demoPassword); }} aria-pressed={email === e} className={`pill h-9 border px-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${email === e ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-txt-secondary hover:border-gold hover:bg-gold-light hover:text-ink-950 active:scale-[0.98]"}`} data-testid={`demo-${r.toLowerCase().replace(" ", "-")}`}>{r}</button>)}</div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
