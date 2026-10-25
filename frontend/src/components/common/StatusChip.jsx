import { cn } from "@/lib/utils";

export const STATUS_STYLES = {
  Available: { chip: "bg-emerald-100 text-emerald-900 border-emerald-200", tile: "bg-sage-50 border-emerald-200 hover:border-emerald-400", dot: "bg-emerald-500" },
  Hold: { chip: "bg-amber-100 text-amber-900 border-amber-200", tile: "bg-amber2-50 border-amber-200 hover:border-amber-400", dot: "bg-amber-500" },
  Booked: { chip: "bg-ink-800 text-white border-warm-200", tile: "bg-ink-800 border-warm-200 text-white hover:border-gold", dot: "bg-ink-950" },
  Sold: { chip: "bg-gold text-ink-950 border-gold", tile: "bg-gold-light border-gold hover:border-gold-hover", dot: "bg-gold" },
  Blocked: { chip: "bg-slate-200 text-slate-800 border-slate-300", tile: "bg-warm-50 border-slate-300 hover:border-slate-400", dot: "bg-slate-500" },
};

export function StatusChip({ status, className, testId }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.Blocked;
  return (
    <span data-testid={testId} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5", s.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />{status}
    </span>
  );
}

export function Pill({ children, tone = "slate", className }) {
  const tones = {
    slate: "bg-warm-100 text-txt-secondary", navy: "bg-slate2-50 text-slate2",
    gold: "bg-gold-light text-[#8a6d12]", green: "bg-sage-50 text-sage", emerald: "bg-sage-50 text-sage",
    red: "bg-brick-50 text-brick", amber: "bg-amber2-50 text-amber2",
  };
  return <span className={cn("pill", tones[tone] || tones.slate, className)}>{children}</span>;
}
