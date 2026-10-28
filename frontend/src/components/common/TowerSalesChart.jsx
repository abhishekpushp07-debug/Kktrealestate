import { useState } from "react";
import { Link } from "react-router-dom";
import { useFetch } from "@/hooks/useList";
import { Card, Skeleton, UNIT_COLORS } from "@/components/v2";
import { cn } from "@/lib/utils";

const CAT = { sold: ["Sold / Booked", UNIT_COLORS.Sold, "Booked"], available: ["Available", UNIT_COLORS.Available, "Available"], hold: ["Hold", UNIT_COLORS.Hold, "Hold"], landowner: ["Landowner", "#8a6d12", "Available"], blocked: ["Blocked / Other", UNIT_COLORS.Blocked, "Blocked"] };

function Row({ r, cats, projectId }) {
  const total = r.total || 1;
  return (
    <div className="grid grid-cols-[120px_1fr_150px] items-center gap-3 text-sm" data-testid={`tower-sales-row-${r.code}`}>
      <Link to={`/blocks/${r.block_id}`} className="truncate font-semibold text-ink-950 hover:text-gold">{r.tower}</Link>
      <div className="flex h-6 w-full gap-px overflow-hidden rounded-md bg-warm-100">
        {cats.filter((c) => r[c]).map((c) => (
          <Link key={c} to={`/flats?project_id=${projectId}&block_id=${r.block_id}&status=${CAT[c][2]}`} style={{ width: `${(r[c] / total) * 100}%`, background: CAT[c][1] }} className="flex items-center justify-center text-[11px] font-semibold text-white/95 transition-opacity hover:opacity-80" title={`${CAT[c][0]}: ${r[c]}`} data-testid={`tower-sales-seg-${r.code}-${c}`}>{r[c] / total > 0.08 ? r[c] : ""}</Link>))}
      </div>
      <span className="whitespace-nowrap text-right tabular-nums text-txt-secondary" data-testid={`tower-sales-pct-${r.code}`}>Sold <b className="text-ink-950">{r.sold_pct}%</b> · {r.total} units</span>
    </div>
  );
}

/** Y.1 — tower-wise Sold vs Available (stacked, server-aggregated, masked per role; Real/Display toggle for privileged users). */
export function TowerSalesChart({ projectId, compact, className }) {
  const [view, setView] = useState("display");
  const { data, loading } = useFetch(projectId ? `/projects/${projectId}/tower-sales?view=${view}` : null, [projectId, view]);
  if (!projectId) return <p className="text-sm text-txt-muted">Pick a project.</p>;
  if (loading || !data) return <Skeleton className="h-40 rounded-xl" />;
  const cats = data.categories;
  return (
    <div className={className} data-testid="tower-sales-chart" data-view={data.view}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs text-txt-secondary" data-testid="tower-sales-legend">{cats.map((c) => <span key={c} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CAT[c][1] }} />{CAT[c][0]}</span>)}</div>
        {data.can_toggle && <div className="flex rounded-lg border border-warm-200 text-xs" role="radiogroup" aria-label="Status view">{["real", "display"].map((v) => <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)} className={cn("px-2 py-0.5 capitalize", view === v ? "bg-ink-950 text-white" : "text-txt-secondary")} data-testid={`tower-sales-view-${v}`}>{v}</button>)}</div>}
      </div>
      <div className={cn("mt-3 space-y-2", compact && "max-h-56 overflow-y-auto pr-1")}>{data.towers.map((r) => <Row key={r.block_id} r={r} cats={cats} projectId={projectId} />)}</div>
      <p className="mt-3 border-t border-warm-100 pt-2 text-sm" data-testid="tower-sales-total">Project total: <b>{data.total.sold}</b> sold / booked of <b>{data.total.total}</b> units · Sold <b>{data.total.sold_pct}%</b>{data.total.available != null && ` · ${data.total.available} available`}{data.total.hold ? ` · ${data.total.hold} on hold` : ""}</p>
    </div>
  );
}

/** Home widget wrapper with its own project selector. */
export function TowerSalesWidget({ projects }) {
  const [pid, setPid] = useState(projects?.[0]?.id || "");
  const list = projects || [];
  const sel = pid || list[0]?.id || "";
  return (
    <Card testId="tower-sales-widget">
      <div className="flex items-center justify-between gap-3"><h3 className="font-display text-lg">Tower sales progress</h3>
        <select className="input !h-8 w-44 text-xs" value={sel} onChange={(e) => setPid(e.target.value)} data-testid="tower-sales-project">{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <TowerSalesChart projectId={sel} compact className="mt-3" />
    </Card>
  );
}
