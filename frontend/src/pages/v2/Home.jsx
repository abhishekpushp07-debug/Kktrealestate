import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Settings2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { fmtRelative } from "@/lib/format";
import { Card } from "@/components/v2";
import { HomeWidget } from "@/components/home/widgets";
import { HomeCustomize, SIZE_CLASS } from "@/components/home/HomeCustomize";
import { cn } from "@/lib/utils";

const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function Home() {
  const { user } = useAuth();
  const { data, loading } = useFetch("/dashboard/home");
  const { data: trends } = useFetch("/trends?scope=company&months=12");
  const { data: savedLayout, setData: setSavedLayout } = useFetch("/me/home-layout");
  const [layout, setLayout] = useState(null);
  const [customize, setCustomize] = useState(false);
  useEffect(() => { if (savedLayout && !customize) setLayout(savedLayout); }, [savedLayout, customize]); // never clobber in-progress edits on background refetch
  const first = (user?.name || "").split(" ")[0];
  const t = data?.totals, c = data?.counts;
  const widgets = (layout?.widgets || []).filter((w) => w.visible);
  return (
    <div className="space-y-8" data-testid="home-page">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div><p className="label">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p><h1 className="mt-1 font-display text-4xl text-ink-950 md:text-[40px]" data-testid="home-greeting">{greet()}, {first}</h1></div>
        <div className="flex items-center gap-3">{data && <p className="text-xs text-txt-muted">Snapshot {fmtRelative(data.computed_at)}</p>}
          <button className="btn btn-secondary btn-sm" onClick={() => setCustomize((v) => !v)} aria-pressed={customize} data-testid="home-customize-btn"><Settings2 className="h-3.5 w-3.5" />Customize</button></div>
      </header>
      {customize && layout && <HomeCustomize layout={layout} onChange={setLayout} onSaved={(l) => { setSavedLayout(l); setLayout(l); setCustomize(false); }} onClose={() => { setLayout(savedLayout); setCustomize(false); }} />}
      {data && (c.followups_due > 0 || data.attention.overdue.length > 0) && <div className="notice" data-testid="home-notice"><AlertTriangle className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} /><p className="text-sm text-ink-950">{[c.followups_due > 0 && `${c.followups_due} follow-up${c.followups_due > 1 ? "s" : ""} due`, data.attention.overdue.length > 0 && `${data.attention.overdue.length} overdue demand${data.attention.overdue.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</p><a href="#attention" className="ml-auto text-sm font-semibold text-ink-950 hover:text-gold">Review</a></div>}
      {data && (c?.projects ?? 1) === 0 && <Card className="!border-gold/50 !bg-gold-light/40" testId="home-first-run"><p className="label text-[#6b5410]">Welcome</p><h2 className="mt-1 font-display text-2xl text-ink-950">Set up your first project</h2><p className="mt-2 max-w-xl text-sm text-txt-secondary">Add towers, floor plans, construction stages and payment plans once — bookings, demands and the customer portal all flow from it.</p><div className="mt-4 flex flex-wrap gap-2"><Link to="/projects/new" className="btn btn-primary" data-testid="first-run-project">Start project setup</Link><Link to="/settings/catalogues" className="btn btn-secondary" data-testid="first-run-catalogues">Review catalogues</Link></div></Card>}
      {!layout && <div className="grid gap-6 xl:grid-cols-6" data-testid="home-layout-loading">{[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-warm-100 xl:col-span-2" />)}</div>}
      <div className="grid gap-6 xl:grid-cols-6" data-testid="home-widget-grid">
        {widgets.map((w) => <div key={w.id} className={cn("min-w-0", SIZE_CLASS[w.size] || SIZE_CLASS.M)} id={w.id === "attention" ? "attention" : undefined} data-testid={`home-slot-${w.id}`} data-size={w.size}><HomeWidget id={w.id} data={data} loading={loading} trends={trends} c={c} t={t} /></div>)}
      </div>
    </div>
  );
}
