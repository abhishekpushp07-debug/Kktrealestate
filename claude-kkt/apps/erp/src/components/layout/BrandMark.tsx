import { cn } from "@/lib/utils";

export interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
  /** Show the "KKT" word mark next to the monogram. */
  withText?: boolean;
  /** Text colour for dark (navy) backgrounds. */
  onDark?: boolean;
  subtitle?: string;
  className?: string;
}

const SIZES = { sm: "size-8 text-base", md: "size-9 text-lg", lg: "size-12 text-2xl" } as const;

/** Gold "K" monogram on a navy tile, optionally with the word mark. */
export function BrandMark({ size = "md", withText = false, onDark = false, subtitle, className }: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className={cn("flex shrink-0 items-center justify-center rounded-md bg-navy-950 font-display font-extrabold text-gold ring-1 ring-navy-800", SIZES[size])} aria-hidden="true">
        K
      </span>
      {withText && (
        <span className="min-w-0 leading-tight">
          <span className={cn("block font-display text-base font-extrabold tracking-tight", onDark ? "text-white" : "text-navy-950")}>KKT</span>
          {subtitle && <span className={cn("block truncate text-2xs font-medium", onDark ? "text-navy-200" : "text-ink-subtle")}>{subtitle}</span>}
        </span>
      )}
    </span>
  );
}
