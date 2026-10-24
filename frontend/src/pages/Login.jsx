import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Building2, Eye, EyeOff, LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Bits";

const DEMO = [["Super Admin", "admin@kkt.in"], ["Project Admin", "projectadmin@kkt.in"], ["Accounts", "accounts@kkt.in"], ["Sales", "sales@kkt.in"], ["Employee", "employee@kkt.in"]];

export default function Login() {
  const { login, loginMfa } = useAuth();
  const [mfa, setMfa] = useState(null);
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (mfa) { await loginMfa(mfa.mfa_token, code); }
      else {
        const d = await login(email.trim(), password);
        if (d.mfa_required) { setMfa(d); setBusy(false); return; }
        if (d.must_change_password) toast.warning("Please change your password (Profile menu → Change password).");
      }
      toast.success("Welcome back");
      navigate(loc.state?.from || "/dashboard", { replace: true });
    } catch (err) { setError(errMsg(err, "Login failed")); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]" data-testid="login-page">
      <div className="relative hidden overflow-hidden bg-navy text-white lg:flex lg:flex-col lg:justify-between lg:p-12 grain">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-navy-700/60 blur-3xl" />
        <div className="absolute -bottom-40 left-10 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold text-xl font-extrabold text-navy">K</div>
          <div><p className="text-xl font-extrabold tracking-wide">KKT</p><p className="text-xs text-slate-400">Real Estate ERP</p></div>
        </div>
        <div className="relative max-w-lg">
          <p className="label-xs text-gold">Enterprise · Secure · Scalable</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">Command every tower, floor and flat from one royal console.</h1>
          <p className="mt-4 text-sm text-slate-300">Inventory, pricing, roles and audit trails built for builders who sell at scale.</p>
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[[Building2, "Projects → Blocks → Flats"], [ShieldCheck, "Fine-grained RBAC"], [Users, "1000+ concurrent users"]].map(([Icon, t]) => (
              <div key={t} className="rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur"><Icon className="mb-2 h-5 w-5 text-gold" /><p className="text-xs font-semibold text-slate-200">{t}</p></div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-slate-500">© {new Date().getFullYear()} KKT. Immutable audit · Encrypted PII · JWT sessions</p>
      </div>
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm fade-up">
          <div className="mb-8 flex items-center gap-2 lg:hidden"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy font-extrabold text-gold">K</div><span className="text-lg font-extrabold text-navy">KKT</span></div>
          <h2 className="text-2xl font-extrabold text-navy">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your employee credentials to continue.</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            {mfa ? <Field label={`Authenticator code for ${mfa.user.email}`} required><Input autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" required data-testid="login-mfa-code-input" className="h-10 tracking-widest" /></Field> : <>
            <Field label="Email" required><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.in" required data-testid="login-email-input" className="h-10" /></Field>
            <Field label="Password" required>
              <div className="relative">
                <Input type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required data-testid="login-password-input" className="h-10 pr-10" />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-navy" data-testid="toggle-password-visibility">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            </Field>
            </>}
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="login-error">{error}</div>}
            <Button type="submit" disabled={busy} className="h-10 w-full bg-navy text-white hover:bg-navy-700" data-testid="login-submit-button"><LockKeyhole className="mr-2 h-4 w-4" />{busy ? "Signing in…" : mfa ? "Verify code" : "Sign in"}</Button>
            {mfa && <button type="button" onClick={() => { setMfa(null); setCode(""); }} className="w-full text-xs text-slate-500 hover:text-navy" data-testid="login-mfa-back">← Back to password</button>}
          </form>
          <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="label-xs mb-2">Demo accounts · password Kkt@12345</p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO.map(([r, e]) => <button key={e} type="button" onClick={() => { setEmail(e); setPassword("Kkt@12345"); }} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-navy hover:border-gold hover:bg-gold-light" data-testid={`demo-${r.toLowerCase().replace(/\s+/g, "-")}`}>{r}</button>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
