import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { EmptyState, EntityCard, SkeletonCards } from "@/components/v2";
import { cn } from "@/lib/utils";

export default function Projects() {
  const { can } = useAuth();
  const { data, loading } = useFetch("/projects?page_size=100&with_total=false");
  const { data: snap } = useFetch("/dashboard/snapshot");
  const [status, setStatus] = useState("All");
  const [city, setCity] = useState("All");
  const items = data?.items || [];
  const sums = useMemo(() => Object.fromEntries((snap?.projects || []).map((p) => [p.project_id, p])), [snap]);
  const cities = ["All", ...new Set(items.map((p) => p.address?.city).filter(Boolean))];
  const statuses = ["All", ...new Set(items.map((p) => p.status).filter(Boolean))];
  const list = items.filter((p) => (status === "All" || p.status === status) && (city === "All" || p.address?.city === city));
  const Pills = ({ opts, v, set, id }) => <div className="flex flex-wrap gap-1.5" data-testid={id}>{opts.map((o) => <button key={o} onClick={() => set(o)} className={cn("pill border transition-colors", v === o ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-txt-secondary hover:border-gold")}>{o}</button>)}</div>;
  return (
    <div className="space-y-6" data-testid="projects-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="label">Portfolio</p><h1 className="mt-1 font-display text-4xl text-ink-950">Projects</h1></div>
        {can("project.write") && <Link to="/projects/new" className="btn btn-primary" data-testid="new-project-btn"><Plus className="h-4 w-4" />New project</Link>}
      </header>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6"><Pills opts={statuses} v={status} set={setStatus} id="filter-status" />{cities.length > 2 && <Pills opts={cities} v={city} set={setCity} id="filter-city" />}</div>
      {loading ? <SkeletonCards n={3} h="h-72" /> : list.length === 0 ? <EmptyState icon={Building2} title="No projects yet" description="Set up your first project — towers, floor plans, stages, plans and pricing in one guided flow." action={can("project.write") && <Link to="/projects/new" className="btn btn-gold">Start setup</Link>} testId="projects-empty" /> : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="projects-grid">
          {list.map((p) => { const s = sums[p.id]; return <EntityCard key={p.id} to={`/projects/${p.id}`} cover={p.cover_image_url || null} initialsOf={p.name} title={p.name} subtitle={[p.address?.city, p.rera_number && `RERA ${p.rera_number}`].filter(Boolean).join(" · ")} status={p.status} progress={s?.progress_pct ?? p.construction_percent ?? 0} counts={s?.units.by_status || p.unit_counts} meta={[`${s?.towers ?? p.block_count ?? "—"} towers`, `${s?.units.total ?? p.unit_counts?.total ?? "—"} units`]} money={s && [{ label: "Collected", value: s.paid_paise / 100 }, { label: "Outstanding", value: s.outstanding.total_paise / 100, tone: s.outstanding.total_paise ? "brick" : "sage" }]} testId={`project-card-${p.code}`} />; })}
        </div>
      )}
    </div>
  );
}
