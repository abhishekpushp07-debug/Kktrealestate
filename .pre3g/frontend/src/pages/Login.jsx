import { KktLogo } from "@/components/elite";
import { ThemeSwitch } from "@/components/layout/ThemeSwitch";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import api, { errMsg } from "@/lib/api";
import { Field } from "@/components/v2";
import { Button } from "@/components/ui/button";

const DEMO = [
  ["Super Admin", "admin@kkt.in"],
  ["Project Admin", "projectadmin@kkt.in"],
  ["Accounts", "accounts@kkt.in"],
  ["Sales", "sales@kkt.in"],
  ["Employee", "employee@kkt.in"],
];

export default function Login() {
  const { login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [demoAllowed, setDemoAllowed] = useState(false);
  const [demoPassword, setDemoPassword] = useState("");
  useEffect(() => {
    api
      .get("/auth/login-options")
      .then((r) => {
        setDemoAllowed(Boolean(r.data?.demo_accounts));
        setDemoPassword(r.data?.demo_password || "");
      })
      .catch(() => setDemoAllowed(false));
  }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mfa) await loginMfa(mfa.mfa_token, code);
      else {
        const d = await login(email.trim(), password);
        if (d.mfa_required) {
          setMfa(d);
          setBusy(false);
          return;
        }
        if (d.must_change_password)
          toast.warning("Please change your password (Profile menu → Change password).");
      }
      toast.success("Signed in");
      navigate(loc.state?.from || "/dashboard", { replace: true });
    } catch (err) {
      setError(errMsg(err, "Login failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v2 grid min-h-screen lg:grid-cols-[1.15fr_1fr]" data-testid="login-page">
      <div
        className="relative hidden overflow-hidden bg-cover bg-center lg:block"
        style={{ backgroundImage: "url(/brand/elite_gate.jpg)" }}
        data-testid="login-photo"
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(5,7,12,0) 55%, var(--canvas) 100%), linear-gradient(0deg, rgba(5,7,12,.75), transparent 40%)",
          }}
        />
        <div className="absolute bottom-9 left-10 z-10" data-testid="login-brand">
          <p className="e-caps-gold !text-[#d4b477]">KKT Constructions · Patna</p>
          <p className="mt-2 text-[40px] font-extrabold leading-tight tracking-[-0.02em] text-[#eef1f6]">
            homes built to be lived in.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6 md:p-16">
        <form onSubmit={submit} className="w-full max-w-[392px]" data-testid="login-form">
          <KktLogo className="h-[84px]" testId="login-monogram" />
          <p className="sr-only" data-testid="login-eyebrow">
            {mfa ? "Security" : "Sign in"}
          </p>
          <h2 className="mt-3 text-[34px] font-extrabold tracking-[-0.02em] text-ink-950">
            {mfa ? "two-step verification." : "welcome back."}
          </h2>
          <p className="e-sub">
            {mfa ? "Enter the 6-digit code from your authenticator app." : "sign in to your ERP"}
          </p>
          <div className="mt-8 space-y-5">
            {mfa ? (
              <Field label={`Authenticator code for ${mfa.user.email}`} required>
                <input
                  autoFocus
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  required
                  className="input mt-2 h-12 tracking-[.3em] focus-visible:ring-2 focus-visible:ring-gold"
                  data-testid="login-mfa-code-input"
                />
              </Field>
            ) : (
              <>
                <Field label="Work email" required>
                  <input
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.in"
                    required
                    className="input mt-2 !h-[54px] !rounded-[14px] focus-visible:ring-2 focus-visible:ring-gold"
                    data-testid="login-email-input"
                  />
                </Field>
                <Field label="Password" required>
                  <div className="relative mt-2">
                    <input
                      type={show ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="input !h-[54px] !rounded-[14px] pr-11 focus-visible:ring-2 focus-visible:ring-gold"
                      data-testid="login-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShow(!show)}
                      className={
                        "absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-txt-muted " +
                        "hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                      }
                      aria-label={show ? "Hide password" : "Show password"}
                      aria-pressed={show}
                      data-testid="login-toggle-password"
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
              </>
            )}
            {error && (
              <p
                className="rounded-xl bg-brick-50 px-4 py-3 text-sm text-brick"
                role="alert"
                data-testid="login-error"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy}
              variant="primary"
              className="e-cta h-[54px] w-full !rounded-[14px] !text-white text-base focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
              style={{ background: "linear-gradient(180deg,#3f78f0,#2a5bd6)" }}
              data-testid="login-submit-button"
            >
              {busy ? "Signing in…" : mfa ? "Verify" : "Sign in"}
            </Button>
          </div>
          <ThemeSwitch className="mt-5" />
          {demoAllowed && !mfa && (
            <div className="mt-12 border-t border-warm-200 pt-8" data-testid="login-demo-accounts">
              <p className="label !text-ink-950/70">
                Demo accounts{" "}
                <span className="normal-case tracking-normal text-txt-muted">
                  · password {demoPassword}
                </span>
              </p>
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Demo accounts">
                {DEMO.map(([r, e]) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setEmail(e);
                      setPassword(demoPassword);
                    }}
                    aria-pressed={email === e}
                    className={
                      `pill h-9 border px-4 transition-colors focus-visible:outline-none ` +
                      ("focus-visible:ring-2 focus-visible:ring-gold " +
                        (email === e
                          ? "border-ink-950 bg-ink-950 " + "text-warm-50"
                          : "border-warm-200 bg-white text-txt-secondary hover:border-gold hover:bg-gold-light hover:text-ink-950 active:scale-[0.98]"))
                    }
                    data-testid={`demo-${r.toLowerCase().replace(" ", "-")}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
