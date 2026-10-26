import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { BrandMark } from "@/components/layout/BrandMark";
import { Button } from "@/components/ui/button";
import { FieldWrapper, FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { describeError, isApiClientError } from "@/lib/api";
import { useAuth, type LoginResult } from "@/lib/auth";
import { formatTime } from "@/lib/format";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type Credentials = z.infer<typeof credentialsSchema>;

const mfaSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"),
});
type MfaForm = z.infer<typeof mfaSchema>;

const HIGHLIGHTS = [
  {
    title: "Everything is a selection",
    text: "Flat types, stages, plans and charges are defined once; blocks and bookings are built by picking.",
  },
  {
    title: "Two-bucket ledger",
    text: "Cash and Account tracked side by side, dues rising with construction, advances shown in green.",
  },
  {
    title: "Append-only money",
    text: "Payments are reversed, never deleted. Every change carries an actor, a reason and a request id.",
  },
] as const;

function loginErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    if (error.code === "INVALID_CREDENTIALS" || (error.status === 401 && error.code !== "MFA_REQUIRED"))
      return "Incorrect email or password.";
    if (error.code === "LOCKED" || error.status === 423) {
      const until = error.details?.locked_until;
      const suffix = typeof until === "string" ? ` Try again after ${formatTime(until)}.` : " Try again in 15 minutes.";
      return `Too many failed attempts — this account is temporarily locked.${suffix}`;
    }
    if (error.code === "RATE_LIMITED" || error.status === 429) {
      return error.retryAfterSeconds
        ? `Too many sign-in attempts. Try again in ${error.retryAfterSeconds} seconds.`
        : "Too many sign-in attempts. Try again in a moment.";
    }
  }
  return describeError(error);
}

export default function LoginPage() {
  const { login, completeMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const credentials = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });
  const mfa = useForm<MfaForm>({ resolver: zodResolver(mfaSchema), defaultValues: { code: "" } });

  useEffect(() => {
    document.title = "Sign in · KKT ERP";
    return () => {
      document.title = "KKT ERP";
    };
  }, []);

  const finish = (result: LoginResult) => {
    if (result.kind === "mfa") {
      setMfaToken(result.mfaToken);
      setStep("mfa");
      mfa.reset({ code: "" });
      return;
    }
    if (result.mustChangePassword) {
      navigate("/change-password", { replace: true, state: { forced: true, from } });
      return;
    }
    navigate(from && from !== "/login" ? from : "/", { replace: true });
  };

  const submitCredentials = credentials.handleSubmit(async (values) => {
    setError(null);
    try {
      finish(await login(values.email.trim(), values.password));
    } catch (cause) {
      if (isApiClientError(cause) && cause.code === "MFA_REQUIRED" && typeof cause.details?.mfa_token === "string") {
        finish({ kind: "mfa", mfaToken: cause.details.mfa_token });
        return;
      }
      setError(new Error(loginErrorMessage(cause)));
    }
  });

  const submitMfa = mfa.handleSubmit(async (values) => {
    if (!mfaToken) return;
    setError(null);
    try {
      finish(await completeMfa(mfaToken, values.code));
    } catch (cause) {
      if (isApiClientError(cause) && cause.status === 401 && cause.code !== "LOCKED") {
        setError(
          new Error(
            cause.code === "TOKEN_EXPIRED"
              ? "The verification session expired. Sign in again."
              : "That code didn't match. Check your authenticator app and try again.",
          ),
        );
        if (cause.code === "TOKEN_EXPIRED") {
          setStep("credentials");
          setMfaToken(null);
        }
        return;
      }
      setError(new Error(loginErrorMessage(cause)));
    }
  });

  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:flex-row">
      {/* Brand panel */}
      <aside className="navy-grain relative flex flex-col justify-between px-6 py-6 text-white lg:w-[46%] lg:px-12 lg:py-12 xl:w-1/2">
        <div className="flex items-center justify-between">
          <BrandMark withText onDark size="md" subtitle="Real-estate ERP" />
          <span className="rounded-full border border-gold/40 bg-navy-900/60 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-gold">
            Staff
          </span>
        </div>
        <div className="my-8 hidden lg:block">
          <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-gold">Royal navy · Gold</p>
          <h1 className="mt-3 max-w-md font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-white">
            Run the whole business from one ledger.
          </h1>
          <p className="mt-4 max-w-md text-md text-navy-100/85">
            Inventory, bookings, construction-linked dues, receipts and the website — one backend, every rupee in paise.
          </p>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                <div>
                  <p className="font-display text-sm font-bold text-white">{item.title}</p>
                  <p className="text-xs text-navy-100/75">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-2xs text-navy-200/70 lg:block">
          © {new Date().getFullYear()} KKT · Access is logged. Authorised staff only.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-sm">
          {step === "credentials" ? (
            <form
              onSubmit={(event) => void submitCredentials(event)}
              noValidate
              className="space-y-5"
              data-testid="login-form"
            >
              <div>
                <h2 className="font-display text-2xl font-extrabold text-navy-950">Sign in</h2>
                <p className="mt-1 text-sm text-ink-subtle">Use your staff email and password.</p>
              </div>
              <FormError error={error} />
              <FieldWrapper label="Email" required error={credentials.formState.errors.email?.message}>
                {(control) => (
                  <Input
                    {...credentials.register("email")}
                    {...control}
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoFocus
                    placeholder="you@company.in"
                    leftIcon={Mail}
                    data-testid="login-email-input"
                  />
                )}
              </FieldWrapper>
              <FieldWrapper label="Password" required error={credentials.formState.errors.password?.message}>
                {(control) => (
                  <div className="relative">
                    <Input
                      {...credentials.register("password")}
                      {...control}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••••"
                      leftIcon={Lock}
                      className="pr-10"
                      data-testid="login-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ink-subtle hover:text-navy-950 focus-ring"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                )}
              </FieldWrapper>
              <Button
                type="submit"
                variant="gold"
                size="lg"
                className="w-full"
                loading={credentials.formState.isSubmitting}
                data-testid="login-submit-btn"
              >
                Sign in
              </Button>
              <p className="text-center text-xs text-ink-subtle">
                Forgot your password? Ask a Super Admin to reset it.
              </p>
            </form>
          ) : (
            <form onSubmit={(event) => void submitMfa(event)} noValidate className="space-y-5" data-testid="mfa-form">
              <div>
                <span className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-gold-light text-gold-text">
                  <ShieldCheck className="size-5" aria-hidden="true" />
                </span>
                <h2 className="font-display text-2xl font-extrabold text-navy-950">Two-factor verification</h2>
                <p className="mt-1 text-sm text-ink-subtle">Enter the 6-digit code from your authenticator app.</p>
              </div>
              <FormError error={error} />
              <FieldWrapper label="Verification code" required error={mfa.formState.errors.code?.message}>
                {(control) => (
                  <Input
                    {...mfa.register("code")}
                    {...control}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="000000"
                    className="money text-center text-xl tracking-[0.5em]"
                    data-testid="mfa-code-input"
                  />
                )}
              </FieldWrapper>
              <Button
                type="submit"
                variant="gold"
                size="lg"
                className="w-full"
                loading={mfa.formState.isSubmitting}
                data-testid="mfa-submit-btn"
              >
                Verify and sign in
              </Button>
              <Button
                type="button"
                variant="link"
                leftIcon={ArrowLeft}
                className="w-full"
                onClick={() => {
                  setStep("credentials");
                  setMfaToken(null);
                  setError(null);
                }}
              >
                Back to sign in
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
