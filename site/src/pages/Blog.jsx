import { Link, useSearchParams } from "react-router-dom";
import { usePublic, Seo, Reveal, Img } from "../SiteShell";

export const fmtDate = (s) => s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "";

export default function Blog() {
  const [sp, setSp] = useSearchParams();
  const tag = sp.get("tag") || "";
  const { data } = usePublic(`/posts${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`, [tag]);
  const { data: all } = usePublic("/posts");
  const tags = [...new Set((all?.items || []).flatMap((p) => p.tags || []))];
  return (
    <>
      <Seo title="Blog" description="Construction updates, buying guides and news from Shree Ganesh Builders, Patna." />
      <section className="bg-navy pb-20 pt-40"><div className="container-site"><Reveal><p className="eyebrow">Journal</p><h1 className="display mt-4 text-5xl text-white sm:text-6xl lg:text-7xl">Updates & insights</h1><div className="hairline mt-6" /></Reveal></div></section>
      <section className="py-16"><div className="container-site">
        <div className="mb-10 flex flex-wrap gap-2">{["", ...tags].map((t) => <button key={t} onClick={() => setSp(t ? { tag: t } : {})} className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tag === t ? "bg-navy text-white" : "bg-white text-navy hover:bg-gold/30"}`} data-testid={`blog-tag-${t || "all"}`}>{t || "All"}</button>)}</div>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3" data-testid="blog-grid">{(data?.items || []).map((p, k) => <Reveal key={p.slug} delay={(k % 3) * 0.08}><Link to={`/blog/${p.slug}`} className="card-lux block h-full" data-testid={`blog-card-${p.slug}`}><div className="aspect-[16/10] overflow-hidden"><Img src={p.cover_url} alt={p.title} className="h-full w-full object-cover" width="800" height="500" sizes="(max-width: 768px) 100vw, 400px" /></div><div className="p-6"><p className="text-xs font-semibold uppercase tracking-widest text-gold">{p.tags?.join(" · ")}</p><h2 className="display mt-2 line-clamp-2 text-2xl leading-tight text-navy">{p.title}</h2><p className="mt-3 line-clamp-2 text-sm text-slate-600">{p.excerpt}</p><p className="mt-4 text-xs text-slate-500">{fmtDate(p.publish_at)} · {p.author}</p></div></Link></Reveal>)}</div>
      </div></section>
    </>
  );
}
