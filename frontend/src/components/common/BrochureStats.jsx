import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";

export function Sparkline({ series, width = 240, height = 48 }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  const pts = series.map((s, i) => `${(i / (series.length - 1 || 1)) * width},${height - (s.count / max) * (height - 4) - 2}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full" role="img" aria-label="Brochure downloads, last 30 days" data-testid="brochure-sparkline"><polyline fill="none" stroke="#C9A227" strokeWidth="2" points={pts} /><polyline fill="rgba(201,162,39,.12)" stroke="none" points={`0,${height} ${pts} ${width},${height}`} /></svg>;
}

export function BrochureStats({ projectId }) {
  const { data } = useFetch(`/site-visits/brochure-stats${projectId ? `?project_id=${projectId}` : ""}`);
  if (!data) return null;
  return <div className="rounded-xl border bg-white p-4" data-testid="brochure-stats"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-txt-secondary">Brochure downloads</p><p className="text-2xl font-bold tabular-nums text-ink-950" data-testid="brochure-total">{data.total}</p><p className="text-xs text-txt-secondary">{data.last_30} in the last 30 days</p></div><Sparkline series={data.series} /></div></div>;
}

export function BrochureLeadsWidget() {
  const { can } = useAuth();
  const { data } = useFetch(can("sales.lead.view") ? "/site-visits/brochure-stats" : null);
  if (!data) return null;
  return <div className="card mt-6 flex flex-wrap items-center gap-5 p-5" data-testid="brochure-leads-widget"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-gold/15"><BookOpen className="h-5 w-5 text-ink-950" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-txt-secondary">Brochure leads this week</p><p className="text-2xl font-bold tabular-nums text-ink-950" data-testid="brochure-leads-week">{data.brochure_leads_week}</p><p className="text-xs text-txt-secondary">{data.last_30} downloads in 30 days · <Link to="/leads?source=Brochure&view=list" className="font-semibold text-ink-950 underline">view leads</Link></p></div><Sparkline series={data.series} /></div>;
}
