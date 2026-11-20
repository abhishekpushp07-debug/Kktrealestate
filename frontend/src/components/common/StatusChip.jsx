import { cn } from "@/lib/utils";

export const STATUS_STYLES = {
  Available: {
    chip: "bg-sage-50 text-sage border-sage/40",
    tile: "bg-sage-50 border-sage/40 hover:border-sage/40",
    dot: "bg-sage",
  },
  Hold: {
    chip: "bg-amber2-50 text-amber border-amber/40",
    tile: "bg-amber2-50 border-amber/40 hover:border-amber/40",
    dot: "bg-amber",
  },
  Booked: {
    chip: "bg-ink-800 text-white border-warm-200",
    tile: "bg-ink-800 border-warm-200 text-white hover:border-gold",
    dot: "bg-ink-950",
  },
  Sold: {
    chip: "bg-gold text-on-accent border-gold",
    tile: "bg-gold-light border-gold hover:border-gold-hover",
    dot: "bg-gold",
  },
  Blocked: {
    chip: "bg-warm-200 text-txt-secondary border-warm-200",
    tile: "bg-warm-50 border-warm-200 hover:border-warm-300",
    dot: "bg-ink-700",
  },
};

export function StatusChip({ status, className, testId }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.Blocked;
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5",
        s.chip,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {status}
    </span>
  );
}

export function Pill({ children, tone = "slate", className }) {
  const tones = {
    slate: "bg-warm-100 text-txt-secondary",
    navy: "bg-slate2-50 text-slate2",
    gold: "bg-gold-light text-[var(--accent)]",
    green: "bg-sage-50 text-sage",
    emerald: "bg-sage-50 text-sage",
    red: "bg-brick-50 text-brick",
    amber: "bg-amber2-50 text-amber2",
  };
  return <span className={cn("pill", tones[tone] || tones.slate, className)}>{children}</span>;
}
