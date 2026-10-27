import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpinnerProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
  label?: string;
}

const SIZES = { xs: "size-3", sm: "size-4", md: "size-5", lg: "size-8" } as const;

export function Spinner({ className, size = "sm", label = "Loading" }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center", className)}>
      <Loader2 className={cn("animate-spin", SIZES[size])} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
