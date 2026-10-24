import type { LucideIcon } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const inputClassName =
  "h-9 w-full min-w-0 rounded-md border border-border-strong bg-card px-3 text-sm text-ink shadow-none transition-colors placeholder:text-ink-subtle hover:border-navy-300 focus-ring focus-visible:border-gold disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-subtle aria-invalid:border-danger aria-invalid:focus-visible:border-danger read-only:bg-surface";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  ref?: Ref<HTMLInputElement>;
  invalid?: boolean;
  leftIcon?: LucideIcon;
  /** Text or element rendered inside the field at the left (e.g. "₹"). */
  prefix?: ReactNode;
  /** Text or element rendered inside the field at the right (e.g. "%"). */
  suffix?: ReactNode;
  wrapperClassName?: string;
}

export function Input({ className, invalid, leftIcon: LeftIcon, prefix, suffix, wrapperClassName, ref, ...props }: InputProps) {
  const hasLeft = Boolean(LeftIcon || prefix);
  const hasRight = Boolean(suffix);
  const field = (
    <input
      ref={ref}
      className={cn(inputClassName, hasLeft && "pl-9", hasRight && "pr-10", className)}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      {...props}
    />
  );
  if (!hasLeft && !hasRight) return field;
  return (
    <div className={cn("relative w-full min-w-0", wrapperClassName)}>
      {LeftIcon && <LeftIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />}
      {!LeftIcon && prefix !== undefined && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">{prefix}</span>
      )}
      {field}
      {suffix !== undefined && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-subtle">{suffix}</span>
      )}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 3, ref, ...props }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(inputClassName, "h-auto min-h-[4.5rem] resize-y py-2 leading-5", className)}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      {...props}
    />
  );
}
