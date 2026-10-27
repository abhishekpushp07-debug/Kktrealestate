import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Check, Circle, KeyRound, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { BrandMark } from "@/components/layout/BrandMark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldWrapper, FormError, applyServerErrors } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const RULES = [
  { id: "length", label: "At least 10 characters", test: (value: string) => value.length >= 10 },
  { id: "upper", label: "An upper-case letter", test: (value: string) => /[A-Z]/.test(value) },
  { id: "lower", label: "A lower-case letter", test: (value: string) => /[a-z]/.test(value) },
  { id: "digit", label: "A digit", test: (value: string) => /[0-9]/.test(value) },
] as const;

const schema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z
      .string()
      .min(10, "At least 10 characters")
      .max(128)
      .refine((value) => RULES.every((rule) => rule.test(value)), {
        message: "Use upper-case, lower-case and a digit",
      }),
    confirm_password: z.string().min(1, "Repeat the new password"),
  })
  .refine((values) => values.new_password === values.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  })
  .refine((values) => values.new_password !== values.current_password, {
    message: "New password must differ from the current one",
    path: ["new_password"],
  });

type FormValues = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const { changePassword, mustChangePassword, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { forced?: boolean; from?: string } | null;
  const forced = mustChangePassword || state?.forced === true;
  const [error, setError] = useState<unknown>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
    mode: "onTouched",
  });
  const newPassword = useWatch({ control: form.control, name: "new_password" });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await changePassword(values.current_password, values.new_password);
      toast.success("Password changed");
      navigate(state?.from && state.from !== "/change-password" ? state.from : "/", { replace: true });
    } catch (cause) {
      if (!applyServerErrors(cause, form.setError)) setError(cause);
    }
  });

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <BrandMark withText subtitle="Staff ERP" />
          {!forced && (
            <Button asChild variant="ghost" size="sm" leftIcon={ArrowLeft}>
              <Link to="/">Back</Link>
            </Button>
          )}
        </div>
        {forced && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-status-hold-border bg-warning-bg px-3 py-2 text-sm text-warning-fg"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              You must set a new password before continuing. This is required on first login and after an administrator
              reset.
            </span>
          </div>
        )}
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-light text-gold-text">
                <KeyRound className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h1 className="font-display text-xl font-extrabold text-navy-950">Change password</h1>
                <p className="text-sm text-ink-subtle">Your last 5 passwords cannot be reused.</p>
              </div>
            </div>
            <form
              onSubmit={(event) => void submit(event)}
              noValidate
              className="space-y-4"
              data-testid="change-password-form"
            >
              <FormError error={error} />
              <FieldWrapper label="Current password" required error={form.formState.errors.current_password?.message}>
                {(control) => (
                  <Input
                    {...form.register("current_password")}
                    {...control}
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    data-testid="current-password-input"
                  />
                )}
              </FieldWrapper>
              <FieldWrapper label="New password" required error={form.formState.errors.new_password?.message}>
                {(control) => (
                  <Input
                    {...form.register("new_password")}
                    {...control}
                    type="password"
                    autoComplete="new-password"
                    data-testid="new-password-input"
                  />
                )}
              </FieldWrapper>
              <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
                {RULES.map((rule) => {
                  const ok = rule.test(newPassword);
                  return (
                    <li
                      key={rule.id}
                      className={cn("flex items-center gap-1.5", ok ? "text-success-fg" : "text-ink-subtle")}
                    >
                      {ok ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Circle className="size-3" aria-hidden="true" />
                      )}
                      {rule.label}
                    </li>
                  );
                })}
              </ul>
              <FieldWrapper
                label="Confirm new password"
                required
                error={form.formState.errors.confirm_password?.message}
              >
                {(control) => (
                  <Input
                    {...form.register("confirm_password")}
                    {...control}
                    type="password"
                    autoComplete="new-password"
                    data-testid="confirm-password-input"
                  />
                )}
              </FieldWrapper>
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                {forced && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void logout().then(() => navigate("/login", { replace: true }))}
                  >
                    Sign out
                  </Button>
                )}
                <Button type="submit" loading={form.formState.isSubmitting} data-testid="change-password-submit-btn">
                  Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
