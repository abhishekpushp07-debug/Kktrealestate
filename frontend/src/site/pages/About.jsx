import { usePublic, Seo, Reveal, Img, SectionTitle } from "../SiteShell";
import { Markdown } from "./BlogPost";

export default function About() {
  const { data: page } = usePublic("/pages/about");
  const { data: home } = usePublic("/home");
  if (!page) return <div className="min-h-screen bg-navy" />;
  const ms = page.sections?.milestones || [];
  return (
    <>
      <Seo title={page.title} description={page.seo_description} />
      <section className="bg-navy pb-20 pt-40"><div className="container-site"><Reveal><p className="eyebrow">About us</p><h1 className="display mt-4 text-5xl text-white sm:text-6xl lg:text-7xl">{page.title}</h1><div className="hairline mt-6" /></Reveal></div></section>
      <section className="py-20"><div className="container-site grid gap-16 lg:grid-cols-5"><Reveal className="prose-site lg:col-span-3" ><Markdown body={page.body} /></Reveal>
        {ms.length > 0 && <Reveal delay={0.1} className="lg:col-span-2"><div className="rounded-3xl bg-white p-8" data-testid="about-timeline"><p className="eyebrow mb-6">Milestones</p><ol className="relative border-l border-gold/50 pl-6">{ms.map((m) => <li key={m.year} className="mb-7 last:mb-0"><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-gold" /><p className="display text-2xl text-navy">{m.year}</p><p className="text-sm text-slate-600">{m.text}</p></li>)}</ol></div></Reveal>}</div></section>
      {home?.people?.length > 0 && <section className="bg-white py-24" data-testid="about-people"><div className="container-site"><Reveal><SectionTitle eyebrow="Leadership" title="Meet the team" /></Reveal><div className="grid gap-8 sm:grid-cols-3">{home.people.map((p, k) => <Reveal key={p.name} delay={k * 0.1}><div className="card-lux"><div className="aspect-[4/5] overflow-hidden"><Img src={p.photo_url} alt={p.name} className="h-full w-full object-cover" width="600" height="750" /></div><div className="p-6"><p className="display text-2xl text-navy">{p.name}</p><p className="mt-1 text-xs font-semibold uppercase tracking-widest text-gold">{p.designation}</p><p className="mt-3 text-sm text-slate-600">{p.bio}</p></div></div></Reveal>)}</div></div></section>}
    </>
  );
}
