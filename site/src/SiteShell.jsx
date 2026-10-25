import { createContext, useContext, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { Menu, Phone, X, MessageCircle, Facebook, Instagram, Youtube, Linkedin, CalendarDays, Download } from "lucide-react";
import api, { BACKEND, portalHref } from "@/lib/api";

const SiteCtx = createContext({ site: null, loading: true });
export const useSite = () => useContext(SiteCtx);
export const pub = (path) => fetch(`${BACKEND}/api/public${path}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

export function usePublic(path, deps = []) {
  const [state, set] = useState({ data: null, loading: !!path, error: null });
  useEffect(() => { if (!path) { set({ data: null, loading: false, error: null }); return; } let c = false; set((s) => ({ ...s, loading: true })); pub(path).then((d) => !c && set({ data: d, loading: false, error: null })).catch((e) => !c && set({ data: null, loading: false, error: e })); return () => { c = true; }; }, deps); // eslint-disable-line
  return state;
}

export function SiteProvider({ children }) {
  const { data, loading } = usePublic("/site");
  return <SiteCtx.Provider value={{ site: data, loading }}>{children}</SiteCtx.Provider>;
}

export function Seo({ title, description, image, type = "website", jsonLd }) {
  const { site } = useSite();
  const t = title ? `${title} · ${site?.brand_name || "KKT"}` : site?.seo_title || site?.brand_name;
  const d = description || site?.seo_description || "";
  const url = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
  return (
    <Helmet>
      <title>{t}</title><meta name="description" content={d} /><link rel="canonical" href={url} />
      <meta property="og:title" content={t} /><meta property="og:description" content={d} /><meta property="og:type" content={type} /><meta property="og:url" content={url} />{(image || site?.og_image_url) && <meta property="og:image" content={image || site.og_image_url} />}
      <meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content={t} /><meta name="twitter:description" content={d} />
      {site?.favicon_url && <link rel="icon" href={site.favicon_url} />}
      {jsonLd && <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>}
    </Helmet>
  );
}

export const Reveal = ({ children, delay = 0, className = "" }) => <motion.div initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.7, delay, ease: [0.2, 0.8, 0.2, 1] }} className={className}>{children}</motion.div>;

const UNSPLASH = /images\.unsplash\.com/;
export const imgUrl = (src, w) => (UNSPLASH.test(src || "") ? `${src.split("?")[0]}?auto=format&fit=crop&fm=webp&q=70&w=${w}` : src);
export function Img({ src, alt = "", className = "", sizes = "(max-width: 768px) 100vw, 50vw", priority = false, ...rest }) {
  const [ok, setOk] = useState(false);
  const resp = UNSPLASH.test(src || "");
  return <img src={resp ? imgUrl(src, 960) : src} srcSet={resp ? [480, 960, 1440, 1920].map((w) => `${imgUrl(src, w)} ${w}w`).join(", ") : undefined} sizes={resp ? sizes : undefined} alt={alt} loading={priority ? "eager" : "lazy"} fetchpriority={priority ? "high" : undefined} decoding="async" onLoad={() => setOk(true)} className={`blur-up ${ok ? "loaded" : ""} ${className}`} {...rest} />;
}

export const SectionTitle = ({ eyebrow, title, sub, light, center }) => <div className={`mb-12 ${center ? "text-center" : ""}`}><p className="eyebrow">{eyebrow}</p><h2 className={`display mt-3 text-4xl sm:text-5xl ${light ? "text-white" : "text-navy"}`}>{title}</h2><div className={`hairline mt-5 ${center ? "mx-auto" : ""}`} />{sub && <p className={`mt-5 max-w-2xl text-base leading-relaxed ${light ? "text-white/70" : "text-slate-600"} ${center ? "mx-auto" : ""}`}>{sub}</p>}</div>;

const NAV = [["/projects", "Projects"], ["/about", "About"], ["/gallery", "Gallery"], ["/blog", "Blog"], ["/contact", "Contact"]];

export function SiteNav({ site }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const nav = useNavigate();
  useEffect(() => { const f = () => setSolid(window.scrollY > 40); f(); window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f); }, []);
  return (
    <>
      <header className={`glass-nav fixed inset-x-0 top-0 z-50 ${solid ? "solid" : ""}`} data-testid="site-nav">
        <div className="container-site flex h-[72px] items-center justify-between">
          <Link to="/" className="flex items-center gap-3" data-testid="site-logo">{site?.logo_url ? <img src={site.logo_url} alt={site.brand_name} className="h-9" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold font-black text-navy">{(site?.brand_name || "S")[0]}</span>}<span className="display text-xl text-white sm:text-2xl">{site?.brand_name}</span></Link>
          <nav className="hidden items-center gap-8 lg:flex">{NAV.map(([to, l]) => <NavLink key={to} to={to} onMouseEnter={() => import("./SiteApp").then((m) => m.PREFETCH[to]?.())} className={({ isActive }) => `text-[13px] font-semibold uppercase tracking-[0.18em] transition-colors hover:text-gold ${isActive ? "text-gold" : "text-white/85"}`} data-testid={`nav-${l.toLowerCase()}`}>{l}</NavLink>)}</nav>
          <div className="hidden items-center gap-3 lg:flex"><a href={`tel:${site?.phone}`} className="flex items-center gap-2 text-sm font-semibold text-white/85 hover:text-gold"><Phone className="h-4 w-4" />{site?.phone}</a><a href={portalHref(site)} className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-white/85 transition-colors hover:border-gold hover:text-gold" data-testid="nav-customer-login">Customer Login</a><button onClick={() => nav("/contact")} className="btn-gold !py-2.5 !px-5" data-testid="nav-enquire">Enquire Now</button></div>
          <button className="flex h-12 w-12 items-center justify-center text-white lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} data-testid="nav-menu-btn">{open ? <X /> : <Menu />}</button>
        </div>
      </header>
      {open && <div className="fixed inset-0 z-[45] flex flex-col bg-navy px-6 pb-10 pt-28 lg:hidden" data-testid="nav-mobile"><nav className="flex flex-col">{NAV.map(([to, l], k) => <Link key={to} to={to} onClick={() => setOpen(false)} style={{ animationDelay: `${k * 60}ms` }} className="display fade-up border-b border-white/10 py-4 text-3xl text-white">{l}</Link>)}</nav><div className="mt-auto space-y-3"><a href={portalHref(site)} className="btn-ghost w-full">Customer Login</a><Link to="/contact" onClick={() => setOpen(false)} className="btn-gold w-full">Enquire Now</Link><a href={`tel:${site?.phone}`} className="block text-center text-sm text-white/80">{site?.phone}</a></div></div>}
      <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 gap-2 border-t border-gold/30 bg-navy/95 px-3 py-2.5 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }} data-testid="mobile-cta">
        <a href={`tel:${site?.phone}`} className="btn-ghost !px-2 !text-[12px]" aria-label="Call"><Phone className="h-4 w-4" />Call</a>
        <a href={`https://wa.me/${(site?.whatsapp || "").replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !text-[12px]" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" />WhatsApp</a>
        <button type="button" onClick={() => setSheet(true)} className="btn-gold !px-2 !text-[12px]" data-testid="mobile-enquire">Enquire</button>
      </div>
      {sheet && <div className="fixed inset-0 z-[60] flex items-end bg-navy-950/70 backdrop-blur-sm lg:hidden" onClick={() => setSheet(false)} data-testid="mobile-sheet"><div role="dialog" aria-label="Get in touch" onClick={(e) => e.stopPropagation()} className="fade-up w-full rounded-t-3xl bg-ivory p-5 pb-8" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}><div className="mx-auto mb-4 h-1 w-10 rounded-full bg-navy/15" /><p className="eyebrow">Get in touch</p><div className="mt-3 grid gap-2">
        <a href={`tel:${site?.phone}`} className="flex h-12 items-center gap-3 rounded-xl bg-white px-4 text-sm font-semibold text-navy" data-testid="sheet-call"><Phone className="h-4 w-4 text-gold" />Call {site?.phone}</a>
        <a href={`https://wa.me/${(site?.whatsapp || "").replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex h-12 items-center gap-3 rounded-xl bg-white px-4 text-sm font-semibold text-navy" data-testid="sheet-whatsapp"><MessageCircle className="h-4 w-4 text-gold" />WhatsApp</a>
        <Link to="/contact?tab=visit" onClick={() => setSheet(false)} className="flex h-12 items-center gap-3 rounded-xl bg-white px-4 text-sm font-semibold text-navy" data-testid="sheet-visit"><CalendarDays className="h-4 w-4 text-gold" />Book a site visit</Link>
        <Link to="/projects" onClick={() => setSheet(false)} className="flex h-12 items-center gap-3 rounded-xl bg-white px-4 text-sm font-semibold text-navy" data-testid="sheet-brochure"><Download className="h-4 w-4 text-gold" />Download a brochure</Link>
        <Link to="/contact" onClick={() => setSheet(false)} className="btn-navy mt-1 w-full" data-testid="sheet-enquire">Request a call back</Link></div></div></div>}
    </>
  );
}

export function SiteFooter({ site }) {
  const icons = { facebook: Facebook, instagram: Instagram, youtube: Youtube, linkedin: Linkedin };
  return (
    <footer className="bg-navy pb-28 pt-20 text-white/80 lg:pb-12" data-testid="site-footer">
      <div className="container-site grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="display text-3xl text-white">{site?.brand_name}</p><p className="mt-3 max-w-md text-sm leading-relaxed">{site?.footer_text}</p>
          <div className="mt-6 flex gap-3">{Object.entries(site?.social || {}).map(([k, v]) => { const I = icons[k]; return I && v ? <a key={k} href={v} target="_blank" rel="noreferrer" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 transition-colors hover:border-gold hover:text-gold" aria-label={k}><I className="h-4 w-4" /></a> : null; })}</div></div>
        <div><p className="eyebrow mb-4">Quick links</p>{[...NAV, ["/privacy", "Privacy"], ["/disclaimer", "Disclaimer"]].map(([to, l]) => <Link key={to} to={to} className="block py-1 text-sm transition-colors hover:text-gold">{l}</Link>)}</div>
        <div><p className="eyebrow mb-4">RERA</p><p className="text-sm leading-relaxed text-white/80" data-testid="footer-rera">{site?.rera_number ? <>Registration No. <b className="text-white">{site.rera_number}</b><br /></> : null}All projects are registered with Bihar RERA. Details at <a href="https://rera.bihar.gov.in" target="_blank" rel="noreferrer" className="underline hover:text-gold">rera.bihar.gov.in</a>.</p><p className="eyebrow mb-4 mt-8">Login</p><a href={portalHref(site)} className="block py-1 text-sm transition-colors hover:text-gold" data-testid="footer-customer-login">Customer Login</a><a href={`${process.env.REACT_APP_ERP_URL || "/erp"}/login`} className="block py-1 text-sm transition-colors hover:text-gold" data-testid="footer-staff-login">Staff Login</a></div>
        <div><p className="eyebrow mb-4">Offices</p>{(site?.offices || []).map((o) => <div key={o.name} className="mb-4 text-sm"><p className="font-semibold text-white">{o.name}</p><p className="leading-relaxed">{o.address}</p></div>)}<p className="text-sm"><a href={`tel:${site?.phone}`} className="hover:text-gold">{site?.phone}</a><br /><a href={`mailto:${site?.email}`} className="hover:text-gold">{site?.email}</a></p></div>
      </div>
      <div className="container-site mt-14 border-t border-white/10 pt-6 text-xs leading-relaxed text-white/75"><p data-testid="rera-disclaimer">{site?.rera_disclaimer}</p><p className="mt-4">© {new Date().getFullYear()} {site?.brand_name}. All rights reserved.</p></div>
    </footer>
  );
}

export function ComingSoon({ site }) {
  return <div className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 text-center text-white" data-testid="coming-soon"><p className="eyebrow">Coming soon</p><h1 className="display mt-4 text-5xl sm:text-7xl">{site.brand_name}</h1><div className="hairline mx-auto mt-8" /><p className="mt-6 max-w-md text-white/70">{site.tagline}. Our new website is on its way. Call <a href={`tel:${site.phone}`} className="text-gold">{site.phone}</a> or write to <a href={`mailto:${site.email}`} className="text-gold">{site.email}</a>.</p></div>;
}

export function EnquiryForm({ projectSlug, flatNumber, compact, onDone }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", project_slug: projectSlug || "", flat_type_id: "", message: flatNumber ? `I am interested in unit ${flatNumber}.` : "", consent: true, website: "" });
  const [state, set] = useState({ busy: false, ref: null, err: null });
  const { data: projects } = usePublic("/published-projects");
  const { data: fts } = usePublic("/flat-types");
  useEffect(() => { if (flatNumber) setF((p) => ({ ...p, message: `I am interested in unit ${flatNumber}.`, project_slug: projectSlug || p.project_slug })); }, [flatNumber, projectSlug]);
  const submit = async (e) => {
    e.preventDefault(); set({ busy: true, ref: null, err: null });
    try {
      const utm = Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([k]) => k.startsWith("utm_")));
      const r = await api.post("/public/enquiries", { ...f, email: f.email || null, project_slug: f.project_slug || null, flat_type_id: f.flat_type_id || null, flat_number: flatNumber || null, message: f.message || null, utm });
      set({ busy: false, ref: r.data.reference || "received", err: null }); onDone?.();
    } catch (err) { set({ busy: false, ref: null, err: err.response?.status === 429 ? "Too many enquiries from this connection. Please try again in a minute." : err.response?.data?.detail || "Please check the details and try again." }); }
  };
  if (state.ref) return <div className="rounded-2xl border border-gold/40 bg-white p-8 text-center" data-testid="enquiry-success"><p className="eyebrow">Thank you</p><h3 className="display mt-2 text-3xl text-navy">We'll call you shortly</h3><p className="mt-3 text-sm text-slate-600">Your reference number is <b className="text-navy" data-testid="enquiry-reference">{state.ref}</b>. A relationship manager will reach out within one working day.</p></div>;
  const phoneBad = f.phone && !/^[6-9]\d{9}$/.test(f.phone);
  return (
    <form onSubmit={submit} className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`} data-testid="enquiry-form">
      <div className="field"><input id="enq-name" placeholder=" " required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="enq-name" /><label htmlFor="enq-name">Full name *</label></div>
      <div className="field"><input id="enq-phone" placeholder=" " required inputMode="numeric" pattern="[6-9][0-9]{9}" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} data-testid="enq-phone" aria-invalid={!!phoneBad} /><label htmlFor="enq-phone">Mobile (10 digits) *</label>{phoneBad && <p className="mt-1 text-xs font-semibold text-red-700" data-testid="enq-phone-error">Enter a valid 10-digit Indian mobile number</p>}</div>
      <div className="field"><input id="enq-email" type="email" placeholder=" " value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="enq-email" /><label htmlFor="enq-email">Email (optional)</label></div>
      <div className="field"><select id="enq-project" value={f.project_slug} onChange={(e) => setF({ ...f, project_slug: e.target.value })} data-testid="enq-project"><option value="">Any project</option>{(projects?.items || []).map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select><label htmlFor="enq-project">Project of interest</label></div>
      <div className="field"><select id="enq-flat-type" value={f.flat_type_id} onChange={(e) => setF({ ...f, flat_type_id: e.target.value })} data-testid="enq-flat-type"><option value="">Any configuration</option>{(fts?.items || []).map((t) => <option key={t.id} value={t.id}>{t.bhk} BHK · {t.name}</option>)}</select><label htmlFor="enq-flat-type">Configuration</label></div>
      <div className={`field ${compact ? "" : "sm:col-span-2"}`}><textarea id="enq-message" rows={3} placeholder=" " value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} data-testid="enq-message" /><label htmlFor="enq-message">Message</label></div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} className="hidden" aria-hidden="true" data-testid="enq-honeypot" />
      <label className={`flex items-start gap-2.5 text-xs text-slate-600 ${compact ? "" : "sm:col-span-2"}`}><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="check mt-0.5" data-testid="enq-consent" />I agree to be contacted about this enquiry and accept the <Link to="/privacy" className="underline">privacy policy</Link>.</label>
      {state.err && <p className="text-sm text-red-600 sm:col-span-2" data-testid="enq-error">{state.err}</p>}
      <button type="submit" disabled={state.busy || !f.consent || !!phoneBad} className={`btn-navy justify-center disabled:opacity-60 ${compact ? "" : "sm:col-span-2"}`} data-testid="enq-submit">{state.busy ? "Sending…" : "Request a call back"}</button>
    </form>
  );
}
