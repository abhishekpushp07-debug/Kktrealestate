import { useState } from "react";
import { Link } from "react-router-dom";
import { useFetch } from "@/hooks/useList";
import { Card, Skeleton, Sparkline, UNIT_COLORS } from "@/components/v2";
import { cn } from "@/lib/utils";

const CAT = { sold: ["Sold / Booked", UNIT_COLORS.Sold, "Booked"], available: ["Available", UNIT_COLORS.Available, "Available"], hold: ["Hold", UNIT_COLORS.Hold, "Hold"], landowner: ["Landowner", "#8a6d12", "Available"], blocked: ["Blocked / Other", UNIT_COLORS.Blocked, "Blocked"] };
const PACE = { fast: ["Fast", "bg-sage/15 text-sage-700"], steady: ["Steady", "bg-warm-100 text-txt-secondary"], slow: ["Slow", "bg-brick/10 text-brick"], sold_out: ["Sold out", "bg-ink-950 text-warm-50"] };

/** Z.3 — weekly sold sparkline + last-4-weeks total + pace badge; tooltip lists week-by-week counts. */
function Pace({ r, weeks }) {
  const tip = (r.series || []).map((v, i) => `${weeks?.[i] || i + 1}: ${v}`).join("\n");
  const [label, tone] = PACE[r.pace] || PACE.steady;
  return (
    <span className="flex items-center justify-end gap-2" title={tip} data-testid={`tower-sales-pace-${r.code}`} data-pace={r.pace}>
      <Sparkline data={r.series || []} w={64} h={22} />
      <span className="whitespace-nowrap text-xs tabular-nums text-txt-secondary"><b className="text-ink-950">{r.last4}</b> / 4 wk</span>
      <span className={cn("pill", tone)}>{label}</span>
    </span>
  );
}

function Row({ r, cats, projectId, spark, weeks }) {
  const total = r.total || 1;
  return (
    <div className={cn("grid items-center gap-3 text-sm", spark ? "grid-cols-[120px_1fr_150px_200px]" : "grid-cols-[120px_1fr_150px]")} data-testid={`tower-sales-row-${r.code}`}>
      <Link to={`/blocks/${r.block_id}`} className="truncate font-semibold text-ink-950 hover:text-gold">{r.tower}</Link>
      <div className="flex h-6 w-full gap-px overflow-hidden rounded-md bg-warm-100">
        {cats.filter((c) => r[c]).map((c) => (
          <Link key={c} to={`/flats?project_id=${projectId}&block_id=${r.block_id}&status=${CAT[c][2]}`} style={{ width: `${(r[c] / total) * 100}%`, background: CAT[c][1] }} className="flex items-center justify-center text-[11px] font-semibold text-white/95 transition-opacity hover:opacity-80" title={`${CAT[c][0]}: ${r[c]}`} data-testid={`tower-sales-seg-${r.code}-${c}`}>{r[c] / total > 0.08 ? r[c] : ""}</Link>))}
      </div>
      <span className="whitespace-nowrap text-right tabular-nums text-txt-secondary" data-testid={`tower-sales-pct-${r.code}`}>Sold <b className="text-ink-950">{r.sold_pct}%</b> · {r.total} units</span>
      {spark && <Pace r={r} weeks={weeks} />}
    </div>
  );
}

/** Y.1 — tower-wise Sold vs Available (stacked, server-aggregated, masked per role; Real/Display toggle for privileged users). `spark` adds the Z.3 pace column. */
export function TowerSalesChart({ projectId, compact, spark = !compact, className }) {
  const [view, setView] = useState("display");
  const { data, loading } = useFetch(projectId ? `/projects/${projectId}/tower-sales?view=${view}&weeks=12` : null, [projectId, view]);
  if (!projectId) return <p className="text-sm text-txt-muted">Pick a project.</p>;
  if (loading || !data) return <Skeleton className="h-40 rounded-xl" />;
  const cats = data.categories;
  return (
    <div className={className} data-testid="tower-sales-chart" data-view={data.view}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs text-txt-secondary" data-testid="tower-sales-legend">{cats.map((c) => <span key={c} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CAT[c][1] }} />{CAT[c][0]}</span>)}
          {spark && <span className="text-txt-muted">· pace = sold units over the last 4 weeks vs project median</span>}</div>
        {data.can_toggle && <div className="flex rounded-lg border border-warm-200 text-xs" role="radiogroup" aria-label="Status view">{["real", "display"].map((v) => <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)} className={cn("px-2 py-0.5 capitalize", view === v ? "bg-ink-950 text-white" : "text-txt-secondary")} data-testid={`tower-sales-view-${v}`}>{v}</button>)}</div>}
      </div>
      <div className={cn("mt-3 space-y-2", compact && "max-h-56 overflow-y-auto pr-1")}>{data.towers.map((r) => <Row key={r.block_id} r={r} cats={cats} projectId={projectId} spark={spark} weeks={data.weeks} />)}</div>
      <p className="mt-3 border-t border-warm-100 pt-2 text-sm" data-testid="tower-sales-total">Project total: <b>{data.total.sold}</b> sold / booked of <b>{data.total.total}</b> units · Sold <b>{data.total.sold_pct}%</b>{data.total.available != null && ` · ${data.total.available} available`}{data.total.hold ? ` · ${data.total.hold} on hold` : ""}{data.total.last4 != null && <> · <b>{data.total.last4}</b> sold in the last 4 weeks</>}</p>
    </div>
  );
}

/** Home widget wrapper with its own project selector; size L shows the pace sparklines. */
export function TowerSalesWidget({ projects, size }) {
  const [pid, setPid] = useState(projects?.[0]?.id || "");
  const list = projects || [];
  const sel = pid || list[0]?.id || "";
  return (
    <Card testId="tower-sales-widget">
      <div className="flex items-center justify-between gap-3"><h3 className="font-display text-lg">Tower sales progress</h3>
        <select className="input !h-8 w-44 text-xs" value={sel} onChange={(e) => setPid(e.target.value)} data-testid="tower-sales-project">{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <TowerSalesChart projectId={sel} compact spark={size === "L"} className="mt-3" />
    </Card>
  );
}
