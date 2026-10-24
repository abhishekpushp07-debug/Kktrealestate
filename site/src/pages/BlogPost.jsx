import { Link, useParams } from "react-router-dom";
import { usePublic, Seo, Reveal, Img } from "../SiteShell";
import { fmtDate } from "./Blog";

const inline = (t) => t.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((s, i) => s.startsWith("**") ? <strong key={i}>{s.slice(2, -2)}</strong> : s.startsWith("*") ? <em key={i}>{s.slice(1, -1)}</em> : s);

export function Markdown({ body }) {
  const blocks = (body || "").split(/\n\s*\n/);
  return <>{blocks.map((b, i) => {
    if (b.startsWith("## ")) return <h2 key={i}>{b.slice(3)}</h2>;
    if (b.startsWith("### ")) return <h3 key={i}>{b.slice(4)}</h3>;
    if (b.trim().startsWith("- ")) return <ul key={i}>{b.split("\n").map((l, j) => <li key={j}>{inline(l.replace(/^- /, ""))}</li>)}</ul>;
    return <p key={i}>{inline(b)}</p>;
  })}</>;
}

export default function BlogPost() {
  const { slug } = useParams();
  const { data: p, error } = usePublic(`/posts/${slug}`, [slug]);
  if (error) return <div className="container-site py-40 text-center"><h1 className="display text-5xl">Post not found</h1><Link to="/blog" className="btn-gold mt-8 inline-flex">All posts</Link></div>;
  if (!p) return <div className="min-h-screen bg-navy" />;
  const ld = { "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, image: p.cover_url, datePublished: p.publish_at, author: { "@type": "Organization", name: p.author } };
  return (
    <>
      <Seo title={p.seo_title || p.title} description={p.seo_description || p.excerpt} image={p.cover_url} type="article" jsonLd={ld} />
      <section className="relative min-h-[70vh] overflow-hidden bg-navy"><Img src={p.cover_url} alt="" priority sizes="100vw" className="kenburns absolute inset-0 h-full w-full object-cover opacity-60" width="1400" height="900" /><div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/60 to-transparent" /><div className="container-site relative flex min-h-[70vh] flex-col justify-end pb-16 pt-40"><Reveal><p className="eyebrow">{p.tags?.join(" · ")}</p><h1 className="display mt-4 max-w-4xl text-4xl text-white sm:text-5xl lg:text-6xl" data-testid="post-title">{p.title}</h1><p className="mt-5 text-sm text-white/70">{fmtDate(p.publish_at)} · {p.author}</p></Reveal></div></section>
      <article className="py-20"><div className="container-site"><div className="prose-site mx-auto max-w-3xl text-base" data-testid="post-body"><Markdown body={p.body} /></div></div></article>
      {p.related?.length > 0 && <section className="bg-white py-20"><div className="container-site"><p className="eyebrow mb-8">Related reading</p><div className="grid gap-6 md:grid-cols-3">{p.related.map((r) => <Link key={r.slug} to={`/blog/${r.slug}`} className="card-lux block"><div className="aspect-[16/10] overflow-hidden"><Img src={r.cover_url} alt={r.title} className="h-full w-full object-cover" width="800" height="500" /></div><div className="p-5"><h3 className="display text-xl text-navy">{r.title}</h3><p className="mt-2 text-xs text-slate-500">{fmtDate(r.publish_at)}</p></div></Link>)}</div></div></section>}
    </>
  );
}
