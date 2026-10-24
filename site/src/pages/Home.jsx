import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Star, ShieldCheck, Clock, Receipt, Compass, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Helmet } from "react-helmet-async";
import { usePublic, Seo, Reveal, Img, SectionTitle, EnquiryForm, imgUrl } from "../SiteShell";
import { ProjectCard } from "./Projects";
import { VideoEmbed } from "../VideoEmbed";

const ICONS = { ShieldCheck, Clock, Receipt, Compass };
const brief = (s, n) => (s && s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n))}…` : s);

function Hero({ banners, site }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (banners.length < 2) return; const t = setInterval(() => setI((x) => (x + 1) % banners.length), 7000); return () => clearInterval(t); }, [banners.length]);
  const b = banners[i] || {};
  const first = banners[0]?.image_url;
  return (
    <section className="relative flex min-h-[100svh] items-end overflow-hidden bg-navy" data-testid="hero">
      {first && <Helmet><link rel="preload" as="image" href={imgUrl(first, 1920)} imageSrcSet={[960, 1440, 1920].map((w) => `${imgUrl(first, w)} ${w}w`).join(", ")} imageSizes="100vw" fetchpriority="high" /></Helmet>}
      <AnimatePresence mode="sync">
        <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.4 }} className="absolute inset-0">
          {b.video_url ? <video src={b.video_url} autoPlay muted loop playsInline className="h-full w-full object-cover" /> : <Img src={b.image_url} alt="" priority={i === 0} sizes="100vw" className="kenburns h-full w-full object-cover" width="1920" height="1080" />}
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy/50 to-navy/10" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-navy-950 to-transparent" />
      <div className="container-site relative z-10 pb-28 pt-40 lg:pb-32">
        <motion.div key={`t${i}`} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.2 }} className="max-w-3xl">
          <p className="eyebrow">{site?.brand_name || "Shree Ganesh Builders"} · Patna</p>
          <h1 className="display mt-5 text-4xl text-white sm:text-6xl lg:text-7xl" data-testid="hero-headline">{brief(b.headline, 60)}</h1>
          <p className="mt-6 max-w-lg text-base text-white/85 sm:text-lg">{brief(b.subheadline, 110)}</p>
          <div className="mt-10 flex flex-wrap gap-4">{b.cta_label && <Link to={b.cta_link || "/projects"} className="btn-gold" data-testid="hero-cta">{b.cta_label}<ArrowRight className="h-4 w-4" /></Link>}{b.cta2_label && <Link to={b.cta2_link || "/contact"} className="btn-ghost" data-testid="hero-cta2">{b.cta2_label}</Link>}</div>
        </motion.div>
        <div className="mt-14 flex items-center justify-between">
          {banners.length > 1 ? <div className="flex gap-2" role="tablist" aria-label="Hero slides">{banners.map((_, k) => <button key={k} role="tab" aria-selected={k === i} onClick={() => setI(k)} aria-label={`Slide ${k + 1}`} className={`h-1 rounded-full transition-all duration-500 ${k === i ? "w-12 bg-gold" : "w-6 bg-white/30"}`} data-testid={`hero-dot-${k}`} />)}</div> : <span />}
          <a href="#trust" className="scroll-cue hidden items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/70 sm:flex" aria-label="Scroll down"><span className="h-10 w-px bg-gradient-to-b from-gold to-transparent" />Scroll</a>
        </div>
      </div>
    </section>
  );
}

function Testimonials({ items }) {
  const [i, setI] = useState(0);
  const t = items[i];
  return (
    <div className="grid gap-10 lg:grid-cols-5" data-testid="testimonial-carousel">
      <figure className="lg:col-span-3"><div className="flex gap-1 text-gold" aria-label={`${t.rating || 5} star rating`}>{Array.from({ length: t.rating || 5 }).map((_, j) => <Star key={j} className="h-4 w-4 fill-current" />)}</div>
        <blockquote key={i} className="display fade-up mt-6 text-2xl leading-snug text-navy sm:text-3xl lg:text-4xl" data-testid="testimonial-quote">“{t.quote}”</blockquote>
        <figcaption className="mt-8 flex items-center gap-4">{t.photo_url && <Img src={t.photo_url} alt={t.name} className="h-14 w-14 rounded-full object-cover" width="56" height="56" sizes="56px" />}<div><p className="font-bold text-navy">{t.name}</p><p className="text-sm text-slate-600">{t.designation}</p></div></figcaption></figure>
      <div className="flex flex-col justify-end gap-2 lg:col-span-2">{items.map((x, k) => <button key={x.name + k} onClick={() => setI(k)} aria-pressed={k === i} className={`flex items-center justify-between border-l-2 py-3 pl-4 text-left text-sm transition-colors ${k === i ? "border-gold text-navy" : "border-navy/10 text-slate-500 hover:text-navy"}`} data-testid={`testimonial-tab-${k}`}><span className="font-semibold">{x.name}</span><span className="text-xs">{x.designation}</span></button>)}</div>
    </div>
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
      <Hero banners={banners} site={site} />
      {home.sections?.trust !== false && <section id="trust" className="border-y border-gold/30 bg-white" data-testid="trust-strip"><div className="container-site grid grid-cols-2 gap-y-8 py-10 lg:grid-cols-4 lg:py-12">{(site.trust_stats || []).map((s, k) => <Reveal key={s.label} delay={k * 0.08} className={`px-4 lg:px-8 ${k > 0 ? "lg:border-l lg:border-gold/25" : ""} ${k % 2 === 1 ? "border-l border-gold/25 lg:border-l" : ""}`}><p className="display text-4xl text-navy sm:text-5xl" style={{ fontVariantNumeric: "tabular-nums" }}>{s.value}</p><p className="mt-2 text-xs font-semibold uppercase tracking-widest text-slate-600">{s.label}</p></Reveal>)}</div></section>}
      <section className="py-24 lg:py-32" data-testid="featured-projects"><div className="container-site"><Reveal><SectionTitle eyebrow="Our projects" title="Addresses that define Patna" sub="From high-rise residences on Bailey Road to garden villas near Danapur — every home is RERA-registered and construction-linked." /></Reveal>
        <div className="grid gap-8 lg:grid-cols-2">{featured_projects.map((p, k) => <Reveal key={p.slug} delay={k * 0.1}><ProjectCard p={p} large /></Reveal>)}</div>
        <Reveal className="mt-12"><Link to="/projects" className="btn-navy" data-testid="all-projects-link">View all projects<ArrowRight className="h-4 w-4" /></Link></Reveal></div></section>
      <section className="bg-navy py-24 text-white lg:py-32" data-testid="value-props"><div className="container-site"><Reveal><SectionTitle light eyebrow="Why Shree Ganesh" title="Built on trust, finished on time" /></Reveal>
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">{(home.value_props || []).map((v, k) => { const I = ICONS[v.icon] || [ShieldCheck, Clock, Receipt, Compass][k % 4]; return <Reveal key={v.title} delay={k * 0.1}><div className="group border-t border-gold/40 pt-6 transition-colors hover:border-gold"><span className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-white/5 transition-colors group-hover:bg-gold/15"><I className="h-5 w-5 text-gold" strokeWidth={1.5} /></span><p className="mt-5 text-[11px] font-semibold tracking-[0.3em] text-gold">0{k + 1}</p><h3 className="display mt-1 text-2xl">{v.title}</h3><p className="mt-3 text-sm leading-relaxed text-white/80">{v.text}</p></div></Reveal>; })}</div></div></section>
      {home.sections?.video !== false && home.walkthrough_video_url && <section className="py-24" data-testid="video-section"><div className="container-site"><Reveal><SectionTitle center eyebrow="Walkthrough" title="See the craftsmanship" /></Reveal><Reveal><div className="mx-auto max-w-5xl"><VideoEmbed src={home.walkthrough_video_url} title="Walkthrough video" testId="walkthrough-video" /></div></Reveal></div></section>}
      {home.sections?.testimonials !== false && testimonials.length > 0 && <section className="bg-white py-24 lg:py-32" data-testid="testimonials"><div className="container-site"><Reveal><SectionTitle eyebrow="Home-owner stories" title="Words from our families" /></Reveal>
        <Reveal><Testimonials items={testimonials.slice(0, 6)} /></Reveal></div></section>}
      {people.length > 0 && <section className="py-24" data-testid="leadership"><div className="container-site"><Reveal><SectionTitle eyebrow="Leadership" title="The people behind the promise" /></Reveal><div className="grid gap-8 sm:grid-cols-3">{people.map((p, k) => <Reveal key={p.name} delay={k * 0.1}><div className="card-lux"><div className="aspect-[4/5] overflow-hidden"><Img src={p.photo_url} alt={p.name} className="h-full w-full object-cover" width="600" height="750" /></div><div className="p-6"><p className="display text-2xl text-navy">{p.name}</p><p className="mt-1 text-xs font-semibold uppercase tracking-widest text-gold">{p.designation}</p><p className="mt-3 text-sm leading-relaxed text-slate-600">{p.bio}</p></div></div></Reveal>)}</div></div></section>}
      {home.sections?.blog !== false && posts.length > 0 && <section className="bg-white py-24" data-testid="home-blog"><div className="container-site"><Reveal><SectionTitle eyebrow="Journal" title="Updates & insights" /></Reveal><div className="grid gap-6 md:grid-cols-3">{posts.map((p, k) => <Reveal key={p.slug} delay={k * 0.1}><Link to={`/blog/${p.slug}`} className="card-lux block h-full" data-testid={`home-post-${p.slug}`}><div className="aspect-[16/10] overflow-hidden"><Img src={p.cover_url} alt={p.title} className="h-full w-full object-cover" width="800" height="500" sizes="(max-width: 768px) 100vw, 400px" /></div><div className="p-6"><p className="text-xs font-semibold uppercase tracking-widest text-gold">{p.tags?.[0]}{p.published_at && <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">· {new Date(p.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}</p><h3 className="display mt-2 line-clamp-2 text-2xl leading-tight text-navy">{p.title}</h3><p className="mt-3 line-clamp-2 text-sm text-slate-600">{p.excerpt}</p><p className="mt-4 text-xs font-semibold uppercase tracking-widest text-navy">Read →</p></div></Link></Reveal>)}</div></div></section>}
      <section className="relative overflow-hidden bg-navy py-24 lg:py-32" data-testid="home-enquiry"><div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-gold/10 blur-3xl" /><div className="container-site grid items-center gap-16 lg:grid-cols-2"><Reveal><p className="eyebrow">Let's talk</p><h2 className="display mt-4 text-4xl text-white sm:text-5xl">Book a private site visit</h2><div className="hairline mt-6" /><p className="mt-6 text-white/80">Share your details and a relationship manager will call within one working day — with floor plans, price sheets and a visit slot that suits you.</p><a href={`https://wa.me/${(site.whatsapp || "").replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="btn-ghost mt-8"><Play className="h-4 w-4" />Chat on WhatsApp</a></Reveal><Reveal delay={0.15}><div className="rounded-3xl bg-ivory p-6 sm:p-8"><EnquiryForm /></div></Reveal></div></section>
    </>
  );
}
