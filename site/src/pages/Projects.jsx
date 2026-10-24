import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, MapPin } from "lucide-react";
import { usePublic, Seo, Reveal, Img, SectionTitle } from "../SiteShell";

export const fmtPrice = (n) => n == null ? null : n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${(n / 1e5).toFixed(0)} L`;
export const Price = ({ n, className = "" }) => { if (n == null) return null; const cr = n >= 1e7; const v = cr ? (n / 1e7).toFixed(2).replace(/\.?0+$/, "") : (n / 1e5).toFixed(0); return <span className={`price ${className}`}>₹{v}<span className="unit-lbl">{cr ? "Cr" : "L"}</span></span>; };

export function ProjectCard({ p, large }) {
  return (
    <Link to={`/projects/${p.slug}`} className="card-lux group block" data-testid={`project-card-${p.slug}`}>
      <div className={`relative overflow-hidden ${large ? "aspect-[16/10]" : "aspect-[4/5]"}`}>
        <Img src={p.cover_image} alt={`${p.name} — ${p.locality || p.city}`} className="h-full w-full object-cover" width={large ? "1200" : "800"} height={large ? "750" : "1000"} sizes={large ? "(max-width: 1024px) 100vw, 640px" : "(max-width: 768px) 100vw, 420px"} />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/85 via-navy/10 to-transparent" />
        <span className="absolute left-5 top-5 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-navy">{p.status}</span>
        <div className="absolute bottom-5 left-5 right-5 text-white"><p className="display text-3xl">{p.name}</p><p className="mt-1 flex items-center gap-1 text-sm text-white/85"><MapPin className="h-3.5 w-3.5 text-gold" />{p.locality ? `${p.locality}, ` : ""}{p.city}</p></div>
      </div>
      <div className="flex items-center justify-between gap-4 p-6">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{p.configurations || p.project_type}</p>
          <p className="mt-1 text-lg font-bold text-navy" data-testid={`project-price-${p.slug}`}>{p.show_prices && p.starting_price ? <>Starting <Price n={p.starting_price} /><span className="text-xs font-normal text-slate-500">*</span></> : "Price on request"}</p></div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-navy/15 text-navy transition-colors group-hover:border-gold group-hover:bg-gold"><ArrowUpRight className="h-5 w-5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></span>
      </div>
    </Link>
  );
}

export default function Projects() {
  const [f, setF] = useState({ status: "", bhk: "" });
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).toString();
  const { data, loading } = usePublic(`/projects${qs ? `?${qs}` : ""}`, [qs]);
  const sel = "h-12 appearance-none rounded-full border border-navy/15 bg-white pl-5 pr-10 text-sm font-semibold text-navy outline-none focus:border-gold bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%230B1F3A' stroke-width='2'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")] bg-[length:16px] bg-[right_1rem_center] bg-no-repeat";
  return (
    <>
      <Seo title="Projects" description="Explore RERA-registered residential projects by Shree Ganesh Builders in Patna." />
      <section className="bg-navy pb-16 pt-36 lg:pb-20 lg:pt-40"><div className="container-site"><Reveal><p className="eyebrow">Portfolio · Patna</p><h1 className="display mt-4 text-4xl text-white sm:text-6xl lg:text-7xl">Our projects</h1><div className="hairline mt-6" /><p className="mt-5 max-w-xl text-white/80">Every address is RERA-registered and construction-linked — you pay as the tower rises.</p></Reveal></div></section>
      <section className="py-14 lg:py-16"><div className="container-site">
        <div className="mb-10 flex flex-wrap items-center gap-3" data-testid="project-filters">
          <select className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} data-testid="filter-status" aria-label="Stage"><option value="">All stages</option>{["Planning", "Under Construction", "Ready", "Completed"].map((s) => <option key={s}>{s}</option>)}</select>
          <select className={sel} value={f.bhk} onChange={(e) => setF({ ...f, bhk: e.target.value })} data-testid="filter-bhk" aria-label="Configuration"><option value="">Any configuration</option>{[1, 2, 3, 4, 5].map((b) => <option key={b} value={b}>{b} BHK</option>)}</select>
          {(f.status || f.bhk) && <button onClick={() => setF({ status: "", bhk: "" })} className="text-sm font-semibold text-navy underline" data-testid="filter-clear">Clear</button>}
          {data && <span className="ml-auto text-sm text-slate-600" data-testid="project-count">{data.items.length} project{data.items.length === 1 ? "" : "s"}</span>}
        </div>
        {loading && !data ? <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((k) => <div key={k} className="card-lux aspect-[4/5] animate-pulse bg-white" />)}</div> : data?.items?.length ? <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3" data-testid="project-grid">{data.items.map((p, k) => <Reveal key={p.slug} delay={k * 0.08}><ProjectCard p={p} /></Reveal>)}</div> : <div className="py-20 text-center"><SectionTitle center eyebrow="No matches" title="No projects for this filter" /></div>}
        {data?.items?.length > 0 && <p className="mt-6 text-xs text-slate-500">*Indicative starting prices, exclusive of taxes, registration and other charges.</p>}
      </div></section>
      <section className="border-y border-gold/30 bg-white py-16" data-testid="projects-why"><div className="container-site grid gap-8 md:grid-cols-3">{[["Construction-linked", "You pay as the tower rises — every demand is tied to a certified construction stage."], ["RERA-registered", "Each project carries a Bihar RERA number; all documents are shared before you book."], ["On-time record", "Possession dates are commitments. Our completed projects were handed over on schedule."]].map(([t, d]) => <Reveal key={t}><div className="border-t border-gold pt-5"><h3 className="display text-2xl text-navy">{t}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{d}</p></div></Reveal>)}</div></section>
      <section className="relative overflow-hidden bg-navy py-20 text-white lg:py-24" data-testid="projects-cta"><div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl" /><div className="container-site relative flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between"><div><p className="eyebrow">Not sure which home fits?</p><h2 className="display mt-3 text-3xl sm:text-5xl">Let a relationship manager walk you through.</h2></div><div className="flex flex-wrap gap-4"><Link to="/contact" className="btn-gold" data-testid="projects-cta-visit">Book a Private Site Visit</Link><Link to="/gallery" className="btn-ghost">See the gallery</Link></div></div></section>
    </>
  );
}
