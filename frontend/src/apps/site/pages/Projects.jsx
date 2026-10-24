import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, MapPin } from "lucide-react";
import { usePublic, Seo, Reveal, Img, SectionTitle } from "../SiteShell";

export const fmtPrice = (n) => n == null ? null : n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${(n / 1e5).toFixed(0)} L`;

export function ProjectCard({ p, large }) {
  return (
    <Link to={`/projects/${p.slug}`} className="card-lux group block" data-testid={`project-card-${p.slug}`}>
      <div className={`relative overflow-hidden ${large ? "aspect-[16/10]" : "aspect-[4/3]"}`}>
        <Img src={p.cover_image} alt={p.name} className="h-full w-full object-cover" width="1200" height="750" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/80 via-transparent to-transparent" />
        <span className="absolute left-5 top-5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-navy">{p.status}</span>
        <div className="absolute bottom-5 left-5 right-5 text-white"><p className="display text-3xl">{p.name}</p><p className="mt-1 flex items-center gap-1 text-sm text-white/80"><MapPin className="h-3.5 w-3.5" />{p.locality ? `${p.locality}, ` : ""}{p.city}</p></div>
      </div>
      <div className="flex items-center justify-between gap-4 p-6">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{p.configurations || p.project_type}</p>
          <p className="mt-1 text-lg font-bold text-navy" data-testid={`project-price-${p.slug}`}>{p.show_prices && p.starting_price ? <>Starting {fmtPrice(p.starting_price)}<span className="text-xs font-normal text-slate-500">*</span></> : "Price on request"}</p></div>
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-navy/15 text-navy transition-colors group-hover:border-gold group-hover:bg-gold"><ArrowUpRight className="h-5 w-5" /></span>
      </div>
    </Link>
  );
}

export default function Projects() {
  const [f, setF] = useState({ status: "", bhk: "" });
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).toString();
  const { data, loading } = usePublic(`/projects${qs ? `?${qs}` : ""}`, [qs]);
  const sel = "rounded-full border border-navy/15 bg-white px-4 py-2 text-sm text-navy outline-none focus:border-gold";
  return (
    <>
      <Seo title="Projects" description="Explore RERA-registered residential projects by Shree Ganesh Builders in Patna." />
      <section className="bg-navy pb-20 pt-40"><div className="container-site"><Reveal><p className="eyebrow">Portfolio</p><h1 className="display mt-4 text-5xl text-white sm:text-6xl lg:text-7xl">Our projects</h1><div className="hairline mt-6" /></Reveal></div></section>
      <section className="py-16"><div className="container-site">
        <div className="mb-10 flex flex-wrap gap-3" data-testid="project-filters">
          <select className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} data-testid="filter-status"><option value="">All stages</option>{["Planning", "Under Construction", "Ready", "Completed"].map((s) => <option key={s}>{s}</option>)}</select>
          <select className={sel} value={f.bhk} onChange={(e) => setF({ ...f, bhk: e.target.value })} data-testid="filter-bhk"><option value="">Any configuration</option>{[1, 2, 3, 4, 5].map((b) => <option key={b} value={b}>{b} BHK</option>)}</select>
        </div>
        {loading && !data ? <p className="text-slate-500">Loading…</p> : data?.items?.length ? <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3" data-testid="project-grid">{data.items.map((p, k) => <Reveal key={p.slug} delay={k * 0.08}><ProjectCard p={p} /></Reveal>)}</div> : <div className="py-20 text-center"><SectionTitle center eyebrow="No matches" title="No projects for this filter" /></div>}
      </div></section>
    </>
  );
}
