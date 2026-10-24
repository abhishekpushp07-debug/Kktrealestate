import { usePublic, Seo, Reveal } from "../SiteShell";
import { Markdown } from "./BlogPost";

export default function LegalPage({ slug }) {
  const { data: p } = usePublic(`/pages/${slug}`, [slug]);
  if (!p) return <div className="min-h-screen bg-navy" />;
  return (
    <>
      <Seo title={p.title} description={p.seo_description} />
      <section className="bg-navy pb-16 pt-40"><div className="container-site"><Reveal><p className="eyebrow">Legal</p><h1 className="display mt-4 text-5xl text-white sm:text-6xl" data-testid="legal-title">{p.title}</h1><div className="hairline mt-6" /></Reveal></div></section>
      <section className="py-16"><div className="container-site"><div className="prose-site mx-auto max-w-3xl" data-testid="legal-body"><Markdown body={p.body} /><p className="mt-10 text-xs text-slate-400">Last updated {new Date(p.updated_at).toLocaleDateString("en-IN")}</p></div></div></section>
    </>
  );
}
