import { CircleAlert } from "lucide-react";
import { useId, type HTMLAttributes, type ReactNode } from "react";
import {
  Controller,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type UseFormSetError,
} from "react-hook-form";
import { describeError, isApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FieldAriaContext } from "./field-context";
import { Label } from "./label";

/* ------------------------------------------------------------------ */
/* FieldWrapper — label / control / hint / error                        */
/* ------------------------------------------------------------------ */

export interface FieldControlProps {
  id: string;
  invalid: boolean;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
  "aria-required": boolean | undefined;
}

export interface FieldWrapperProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  /** Element id; generated when omitted. */
  id?: string;
  className?: string;
  /** Horizontal label (label left, control right) on sm+ screens. */
  horizontal?: boolean;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}

/** Presentational field shell. Pass a render function to receive id/aria props for the control. */
export function FieldWrapper({
  label,
  hint,
  error,
  required,
  id,
  className,
  horizontal = false,
  children,
}: FieldWrapperProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const control: FieldControlProps = {
    id: fieldId,
    invalid: Boolean(error),
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required || undefined,
  };
  return (
    <div
      className={cn(
        "min-w-0",
        horizontal ? "sm:grid sm:grid-cols-[10rem_1fr] sm:items-start sm:gap-3" : "flex flex-col gap-1",
        className,
      )}
    >
      {label && (
        <Label htmlFor={fieldId} required={required} className={cn(horizontal && "sm:pt-2.5")}>
          {label}
        </Label>
      )}
      <div className="min-w-0">
        <FieldAriaContext.Provider value={control}>
          {typeof children === "function" ? children(control) : children}
        </FieldAriaContext.Provider>
        {error ? (
          <p id={errorId} role="alert" className="mt-1 flex items-start gap-1 text-xs font-medium text-danger-fg">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : (
          hint && (
            <p id={hintId} className="mt-1 text-xs text-ink-subtle">
              {hint}
            </p>
          )
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FormField — react-hook-form Controller + FieldWrapper                */
/* ------------------------------------------------------------------ */

export interface FormFieldRenderProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> {
  field: ControllerRenderProps<TFieldValues, TName> & FieldControlProps;
  fieldState: ControllerFieldState;
}

export interface FormFieldProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> extends Omit<
  FieldWrapperProps,
  "children" | "error" | "id"
> {
  control: Control<TFieldValues>;
  name: TName;
  render: (props: FormFieldRenderProps<TFieldValues, TName>) => ReactNode;
}

/**
 * Controlled field with label, hint, required mark and error text wired to react-hook-form.
 * `field` carries both the RHF bindings (value/onChange/onBlur/ref) and the aria props.
 */
export function FormField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  control,
  name,
  render,
  ...wrapper
}: FormFieldProps<TFieldValues, TName>) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldWrapper {...wrapper} id={id} error={fieldState.error?.message}>
          {(controlProps) => render({ field: { ...field, ...controlProps }, fieldState })}
        </FieldWrapper>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Layout helpers                                                       */
/* ------------------------------------------------------------------ */

export interface FormRowProps extends HTMLAttributes<HTMLDivElement> {
  /** Columns on sm+ screens (always 1 on phones). */
  columns?: 1 | 2 | 3 | 4;
}

const COLUMNS = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

export function FormRow({ columns = 2, className, ...props }: FormRowProps) {
  return <div className={cn("grid grid-cols-1 gap-x-4 gap-y-3", COLUMNS[columns], className)} {...props} />;
}

export interface FormSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
}

export function FormSection({ title, description, className, children, ...props }: FormSectionProps) {
  return (
    <section className={cn("space-y-3", className)} {...props}>
      <header>
        <h3 className="font-display text-md font-bold text-navy-950">{title}</h3>
        {description && <p className="text-xs text-ink-subtle">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function FormActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4", className)}
      {...props}
    />
  );
}

/** Banner for a server-side error that is not tied to one field. */
export function FormError({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger-fg",
        className,
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{describeError(error)}</span>
    </div>
  );
}

/**
 * Maps a VALIDATION_ERROR envelope (details.issues[{path,message}]) onto form fields.
 * Returns true when at least one issue matched a field, so callers can skip the banner.
 */
export function applyServerErrors<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
): boolean {
  if (!isApiClientError(error) || error.code !== "VALIDATION_ERROR") return false;
  let applied = false;
  for (const issue of error.validationIssues) {
    if (!issue.path) continue;
    setError(issue.path as FieldPath<TFieldValues>, { type: "server", message: issue.message });
    applied = true;
  }
  return applied;
}
