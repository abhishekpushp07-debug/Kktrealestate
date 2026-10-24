import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Star, ShieldCheck, Clock, Receipt, Compass, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { usePublic, Seo, Reveal, Img, SectionTitle, EnquiryForm } from "../SiteShell";
import { ProjectCard } from "./Projects";
import { VideoEmbed } from "../VideoEmbed";

const ICONS = { ShieldCheck, Clock, Receipt, Compass };

function Hero({ banners }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (banners.length < 2) return; const t = setInterval(() => setI((x) => (x + 1) % banners.length), 6500); return () => clearInterval(t); }, [banners.length]);
  const b = banners[i] || {};
  return (
    <section className="relative flex min-h-[92vh] items-end overflow-hidden bg-navy" data-testid="hero">
      <AnimatePresence mode="sync">
        <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.4 }} className="absolute inset-0">
          {b.video_url ? <video src={b.video_url} autoPlay muted loop playsInline className="h-full w-full object-cover" /> : <img src={b.image_url} alt="" className="kenburns h-full w-full object-cover" width="1800" height="1200" />}
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/55 to-navy/20" />
      <div className="container-site relative z-10 pb-24 pt-40 lg:pb-32">
        <motion.div key={`t${i}`} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.2 }} className="max-w-3xl">
          <p className="eyebrow">Shree Ganesh Builders · Patna</p>
          <h1 className="display mt-5 text-5xl text-white sm:text-6xl lg:text-7xl" data-testid="hero-headline">{b.headline}</h1>
          <p className="mt-6 max-w-xl text-base text-white/80 sm:text-lg">{b.subheadline}</p>
          <div className="mt-10 flex flex-wrap gap-4">{b.cta_label && <Link to={b.cta_link || "/projects"} className="btn-gold" data-testid="hero-cta">{b.cta_label}<ArrowRight className="h-4 w-4" /></Link>}{b.cta2_label && <Link to={b.cta2_link || "/contact"} className="btn-ghost" data-testid="hero-cta2">{b.cta2_label}</Link>}</div>
        </motion.div>
        {banners.length > 1 && <div className="mt-12 flex gap-2">{banners.map((_, k) => <button key={k} onClick={() => setI(k)} aria-label={`Slide ${k + 1}`} className={`h-1 rounded-full transition-all duration-500 ${k === i ? "w-12 bg-gold" : "w-6 bg-white/30"}`} data-testid={`hero-dot-${k}`} />)}</div>}
      </div>
    </section>
  );
}

export default function Home() {
  const { data } = usePublic("/home");
  if (!data) return <div className="min-h-screen bg-navy" />;
  const { site, banners, featured_projects, testimonials, posts, people } = data;
  const home = site.home || {};
  const org = { "@context": "https://schema.org", "@type": "Organization", name: site.brand_name, url: window.location.origin, logo: site.logo_url, telephone: site.phone, email: site.email, address: site.offices?.[0] && { "@type": "PostalAddress", streetAddress: site.offices[0].address, addressLocality: "Patna", addressCountry: "IN" }, sameAs: Object.values(site.social || {}).filter(Boolean) };
  return (
    <>
      <Seo jsonLd={org} />
      <Hero banners={banners} />
      {home.sections?.trust !== false && <section className="border-y border-gold/30 bg-white" data-testid="trust-strip"><div className="container-site grid grid-cols-2 divide-x divide-gold/20 py-10 lg:grid-cols-4">{(site.trust_stats || []).map((s, k) => <Reveal key={s.label} delay={k * 0.08} className="px-6 text-center"><p className="display text-4xl text-navy sm:text-5xl">{s.value}</p><p className="mt-2 text-xs font-semibold uppercase tracking-widest text-slate-500">{s.label}</p></Reveal>)}</div></section>}
      <section className="py-24 lg:py-32" data-testid="featured-projects"><div className="container-site"><Reveal><SectionTitle eyebrow="Our projects" title="Addresses that define Patna" sub="From high-rise residences on Bailey Road to garden villas near Danapur — every home is RERA-registered and construction-linked." /></Reveal>
        <div className="grid gap-8 lg:grid-cols-2">{featured_projects.map((p, k) => <Reveal key={p.slug} delay={k * 0.1}><ProjectCard p={p} large /></Reveal>)}</div>
        <Reveal className="mt-12"><Link to="/projects" className="btn-navy" data-testid="all-projects-link">View all projects<ArrowRight className="h-4 w-4" /></Link></Reveal></div></section>
      <section className="bg-navy py-24 text-white lg:py-32" data-testid="value-props"><div className="container-site"><Reveal><SectionTitle light eyebrow="Why Shree Ganesh" title="Built on trust, finished on time" /></Reveal>
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">{(home.value_props || []).map((v, k) => { const I = ICONS[v.icon] || ShieldCheck; return <Reveal key={v.title} delay={k * 0.1}><div className="group border-t border-gold/40 pt-6 transition-colors hover:border-gold"><I className="h-8 w-8 text-gold" strokeWidth={1.5} /><h3 className="display mt-5 text-2xl">{v.title}</h3><p className="mt-3 text-sm leading-relaxed text-white/65">{v.text}</p></div></Reveal>; })}</div></div></section>
      {home.sections?.video !== false && home.walkthrough_video_url && <section className="py-24" data-testid="video-section"><div className="container-site"><Reveal><SectionTitle center eyebrow="Walkthrough" title="See the craftsmanship" /></Reveal><Reveal><div className="mx-auto max-w-5xl"><VideoEmbed src={home.walkthrough_video_url} title="Walkthrough video" testId="walkthrough-video" /></div></Reveal></div></section>}
      {home.sections?.testimonials !== false && testimonials.length > 0 && <section className="bg-white py-24 lg:py-32" data-testid="testimonials"><div className="container-site"><Reveal><SectionTitle eyebrow="Home-owner stories" title="Words from our families" /></Reveal>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{testimonials.slice(0, 6).map((t, k) => <Reveal key={t.name + k} delay={(k % 3) * 0.1}><figure className="card-lux flex h-full flex-col p-8"><div className="flex gap-1 text-gold">{Array.from({ length: t.rating || 5 }).map((_, j) => <Star key={j} className="h-4 w-4 fill-current" />)}</div><blockquote className="display mt-5 flex-1 text-xl leading-snug text-navy">“{t.quote}”</blockquote><figcaption className="mt-6 flex items-center gap-3">{t.photo_url && <Img src={t.photo_url} alt={t.name} className="h-11 w-11 rounded-full object-cover" width="44" height="44" />}<div><p className="text-sm font-bold text-navy">{t.name}</p><p className="text-xs text-slate-500">{t.designation}</p></div></figcaption></figure></Reveal>)}</div></div></section>}
      {people.length > 0 && <section className="py-24" data-testid="leadership"><div className="container-site"><Reveal><SectionTitle eyebrow="Leadership" title="The people behind the promise" /></Reveal><div className="grid gap-8 sm:grid-cols-3">{people.map((p, k) => <Reveal key={p.name} delay={k * 0.1}><div className="card-lux"><div className="aspect-[4/5] overflow-hidden"><Img src={p.photo_url} alt={p.name} className="h-full w-full object-cover" width="600" height="750" /></div><div className="p-6"><p className="display text-2xl text-navy">{p.name}</p><p className="mt-1 text-xs font-semibold uppercase tracking-widest text-gold">{p.designation}</p><p className="mt-3 text-sm leading-relaxed text-slate-600">{p.bio}</p></div></div></Reveal>)}</div></div></section>}
      {home.sections?.blog !== false && posts.length > 0 && <section className="bg-white py-24" data-testid="home-blog"><div className="container-site"><Reveal><SectionTitle eyebrow="Journal" title="Updates & insights" /></Reveal><div className="grid gap-6 md:grid-cols-3">{posts.map((p, k) => <Reveal key={p.slug} delay={k * 0.1}><Link to={`/blog/${p.slug}`} className="card-lux block h-full" data-testid={`home-post-${p.slug}`}><div className="aspect-[16/10] overflow-hidden"><Img src={p.cover_url} alt={p.title} className="h-full w-full object-cover" width="800" height="500" /></div><div className="p-6"><p className="text-xs uppercase tracking-widest text-gold">{p.tags?.[0]}</p><h3 className="display mt-2 text-2xl leading-tight text-navy">{p.title}</h3><p className="mt-3 line-clamp-3 text-sm text-slate-600">{p.excerpt}</p></div></Link></Reveal>)}</div></div></section>}
      <section className="relative overflow-hidden bg-navy py-24 lg:py-32" data-testid="home-enquiry"><div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-gold/10 blur-3xl" /><div className="container-site grid items-center gap-16 lg:grid-cols-2"><Reveal><p className="eyebrow">Let's talk</p><h2 className="display mt-4 text-4xl text-white sm:text-5xl">Book a private site visit</h2><div className="hairline mt-6" /><p className="mt-6 text-white/70">Share your details and a relationship manager will call within one working day — with floor plans, price sheets and a visit slot that suits you.</p><a href={`https://wa.me/${(site.whatsapp || "").replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="btn-ghost mt-8"><Play className="h-4 w-4" />Chat on WhatsApp</a></Reveal><Reveal delay={0.15}><div className="rounded-3xl bg-ivory p-6 sm:p-8"><EnquiryForm /></div></Reveal></div></section>
    </>
  );
}
