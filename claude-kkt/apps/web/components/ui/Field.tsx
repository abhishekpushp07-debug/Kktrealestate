"use client";

import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/** What a Field tells the control whose id is its `htmlFor`: invalid state and the id of the error (or hint) text. */
interface FieldAria {
  id: string;
  invalid: boolean;
  describedBy: string | undefined;
  required: boolean;
}

const FieldAriaContext = createContext<FieldAria | null>(null);

/** Space-separated id lists merged without duplicates (undefined when empty). */
function mergeIds(...lists: (string | undefined)[]): string | undefined {
  const ids = [...new Set(lists.flatMap((l) => (l ?? "").split(/\s+/)).filter(Boolean))];
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/**
 * aria-invalid / aria-describedby / aria-required for a control inside a Field: inherited when the control's id is the field's
 * `htmlFor` (a control's own aria-describedby is merged with the field's error/hint id).
 */
function useFieldAria(
  id: string | undefined,
  own: {
    invalid?: boolean;
    "aria-invalid"?: unknown;
    "aria-describedby"?: string;
    "aria-required"?: unknown;
    required?: boolean;
  },
) {
  const field = useContext(FieldAriaContext);
  const wired = field !== null && id !== undefined && id === field.id;
  const invalid =
    own.invalid === true || own["aria-invalid"] === true || own["aria-invalid"] === "true" || (wired && field.invalid);
  return {
    "aria-invalid": invalid ? ("true" as const) : undefined,
    // the control's own description is kept and the field's error/hint added to it, so the error is always announced
    "aria-describedby": mergeIds(own["aria-describedby"], wired ? field.describedBy : undefined),
    "aria-required":
      own["aria-required"] === true ||
      own["aria-required"] === "true" ||
      own.required === true ||
      (wired && field.required)
        ? ("true" as const)
        : undefined,
  };
}

const CONTROL =
  "block w-full min-h-12 rounded-xl border border-navy-900/55 bg-white px-4 text-[1rem] text-ink placeholder:text-ink-soft shadow-[inset_0_1px_2px_rgb(11_31_58/0.04)] transition focus:border-gold-700 focus:outline-none focus:ring-2 focus:ring-gold-700 disabled:bg-ivory-200 aria-[invalid=true]:border-danger";

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, required, children, className = "" }: FieldProps) {
  const aria: FieldAria = {
    id: htmlFor,
    invalid: Boolean(error),
    describedBy: error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined,
    required: Boolean(required),
  };
  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-navy-900">
        {label}
        {required ? (
          <span className="text-gold-700" aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </label>
      <FieldAriaContext.Provider value={aria}>{children}</FieldAriaContext.Provider>
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  className = "",
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const aria = useFieldAria(rest.id, { invalid, ...rest });
  return <input className={`${CONTROL} ${className}`.trim()} {...rest} {...aria} />;
}

export function Select({
  className = "",
  invalid,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  const aria = useFieldAria(rest.id, { invalid, ...rest });
  return (
    <select
      className={`${CONTROL} appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%230b1f3a%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_1rem_center] bg-no-repeat pr-10 ${className}`.trim()}
      {...rest}
      {...aria}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className = "",
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const aria = useFieldAria(rest.id, { invalid, ...rest });
  return <textarea className={`${CONTROL} min-h-28 py-3 ${className}`.trim()} {...rest} {...aria} />;
}

export function Checkbox({
  id,
  label,
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: ReactNode; error?: string | null }) {
  return (
    <div>
      <label htmlFor={id} className="flex min-h-12 cursor-pointer items-start gap-3 text-sm leading-6 text-ink-muted">
        <input
          id={id}
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 rounded border-navy-900/55 accent-gold-700 focus:ring-gold-700"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...rest}
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Hidden honeypot. Bots fill it; humans never see it. Must be sent as an empty string. */
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
      <label htmlFor={id}>Website</label>
      <input
        id={id}
        name="website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function FormStatus({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const tones = {
    error: "border-danger/30 bg-danger/5 text-danger",
    success: "border-success/30 bg-success/5 text-success",
    info: "border-navy-900/15 bg-navy-50 text-navy-900",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 text-sm leading-6 ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
