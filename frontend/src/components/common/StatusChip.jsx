import { cn } from "@/lib/utils";

export const STATUS_STYLES = {
  Available: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", tile: "bg-emerald-50 border-emerald-200 hover:border-emerald-400", dot: "bg-emerald-500" },
  Hold: { chip: "bg-amber-50 text-amber-700 border-amber-200", tile: "bg-amber-50 border-amber-200 hover:border-amber-400", dot: "bg-amber-500" },
  Booked: { chip: "bg-navy-800 text-white border-navy-700", tile: "bg-navy-800 border-navy-700 text-white hover:border-gold", dot: "bg-navy" },
  Sold: { chip: "bg-gold-light text-[#855D00] border-gold", tile: "bg-gold-light border-gold hover:border-gold-hover", dot: "bg-gold" },
  Blocked: { chip: "bg-slate-100 text-slate-600 border-slate-300", tile: "bg-slate-100 border-slate-300 hover:border-slate-400", dot: "bg-slate-500" },
};

export function StatusChip({ status, className, testId }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.Blocked;
  return (
    <span data-testid={testId} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", s.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />{status}
    </span>
  );
}

export function Pill({ children, tone = "slate", className }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 border-slate-200", navy: "bg-navy-50 text-navy-700 border-navy-100",
    gold: "bg-gold-light text-[#855D00] border-gold-border", green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200", amber: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", tones[tone], className)}>{children}</span>;
}
