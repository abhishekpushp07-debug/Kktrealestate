import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn, initials } from "@/lib/utils";

export interface AvatarProps {
  name: string | null | undefined;
  src?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  /** Navy background (sidebar/topbar) instead of gold-light. */
  tone?: "gold" | "navy";
}

const SIZES = { xs: "size-6 text-[10px]", sm: "size-7 text-xs", md: "size-9 text-sm", lg: "size-14 text-lg" } as const;

export function Avatar({ name, src, size = "md", className, tone = "gold" }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-display font-bold",
        tone === "gold" ? "bg-gold-light text-gold-text ring-1 ring-gold-border" : "bg-navy-800 text-gold ring-1 ring-navy-700",
        SIZES[size],
        className,
      )}
    >
      {src && <AvatarPrimitive.Image src={src} alt={name ?? ""} className="size-full object-cover" />}
      <AvatarPrimitive.Fallback delayMs={src ? 300 : 0} aria-label={name ?? undefined}>
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
