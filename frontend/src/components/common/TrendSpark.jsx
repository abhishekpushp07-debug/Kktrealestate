import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => { const [y, m] = ym.split("-"); return `${MON[+m - 1]} ${y}`; };
const fmt = (v, money) => money ? "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(v / 100)) : String(v);

/** Tiny accessible SVG sparkline: <title> for AT, hover tooltip with month + ₹, click → report filtered to that month. */
export function TrendSpark({ months = [], values = [], money = true, label, w = 84, h = 30, linkFor, testId, className }) {
  const [hi, setHi] = useState(null);
  const nav = useNavigate();
  const pts = useMemo(() => {
    if (!values.length) return [];
    const max = Math.max(...values, 1), step = values.length > 1 ? w / (values.length - 1) : 0;
    return values.map((v, i) => ({ x: i * step, y: h - (v / max) * (h - 6) - 3, v, m: months[i] }));
  }, [values, months, w, h]);
  if (!pts.length) return null;
  const title = `${label}: ${months.length ? monthLabel(months[0]) + " – " + monthLabel(months[months.length - 1]) : ""}; latest ${fmt(values[values.length - 1], money)}`;
  const cur = hi != null ? pts[hi] : null;
  return (
    <div className={cn("relative shrink-0", className)} data-testid={testId} onMouseLeave={() => setHi(null)}>
      <svg width={w} height={h} role="img" aria-label={title} className="overflow-visible">
        <title>{title}</title>
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#C9A227" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <g key={i}>
          <rect x={p.x - (w / Math.max(pts.length - 1, 1)) / 2} y={0} width={w / Math.max(pts.length - 1, 1)} height={h} fill="transparent" className={linkFor ? "cursor-pointer" : ""} onMouseEnter={() => setHi(i)} onClick={() => linkFor && nav(linkFor(p.m))} data-testid={testId ? `${testId}-pt-${i}` : undefined} />
          {(i === pts.length - 1 || hi === i) && <circle cx={p.x} cy={p.y} r={hi === i ? 3 : 2} fill={hi === i ? "#8a6d12" : "#C9A227"} />}
        </g>)}
      </svg>
      {cur && <div role="tooltip" className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-950 px-2 py-1 text-[11px] text-white shadow-lg" data-testid={testId ? `${testId}-tip` : undefined}>{monthLabel(cur.m)} · <span className="tabular-nums">{fmt(cur.v, money)}</span></div>}
    </div>
  );
}
