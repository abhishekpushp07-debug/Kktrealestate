import { Phone, Mail, MessageCircle, MapPin, Clock } from "lucide-react";
import { useSite, Seo, Reveal, EnquiryForm } from "../SiteShell";
import { MapEmbed } from "../VideoEmbed";

const Row = ({ href, icon: I, label, value, testId, external }) => (
  <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className="group flex items-center gap-4 border-b border-navy/10 py-4 transition-colors hover:border-gold" data-testid={testId}>
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 transition-colors group-hover:bg-gold"><I className="h-4 w-4 text-navy" /></span>
    <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{label}</p><p className="truncate font-semibold text-navy">{value}</p></div>
  </a>
);

export default function Contact() {
  const { site } = useSite();
  if (!site) return null;
  const office = site.offices?.[0];
  return (
    <>
      <Seo title="Contact" description={`Enquire about homes by ${site.brand_name}. Call ${site.phone} or request a call back.`} />
      <section className="bg-navy pb-14 pt-32 lg:pb-16 lg:pt-36"><div className="container-site"><Reveal><p className="eyebrow">Contact</p><h1 className="display mt-4 text-4xl text-white sm:text-6xl">Let's find your home</h1><div className="hairline mt-6" /><p className="mt-5 max-w-xl text-white/80">A relationship manager replies within one working day — with floor plans, price sheets and a site-visit slot that suits you.</p></Reveal></div></section>
      <section className="py-14 lg:py-20"><div className="container-site grid gap-12 lg:grid-cols-5">
        <Reveal delay={0.05} className="order-2 lg:order-1 lg:col-span-3"><div className="card-lux bg-white p-6 sm:p-10" data-testid="contact-form-card"><p className="eyebrow">Enquiry</p><h2 className="display mt-2 text-3xl text-navy">Request a call back</h2><div className="mt-6"><EnquiryForm /></div></div></Reveal>
        <Reveal className="order-1 lg:order-2 lg:col-span-2"><div>
          <Row href={`tel:${site.phone}`} icon={Phone} label="Call" value={site.phone} testId="contact-call" />
          <Row href={`https://wa.me/${(site.whatsapp || "").replace(/\D/g, "")}`} icon={MessageCircle} label="WhatsApp" value={site.whatsapp} testId="contact-whatsapp" external />
          <Row href={`mailto:${site.email}`} icon={Mail} label="Email" value={site.email} testId="contact-email" />
          <div className="flex items-center gap-4 border-b border-navy/10 py-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15"><Clock className="h-4 w-4 text-navy" /></span><div><p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Hours</p><p className="font-semibold text-navy">{site.hours || "Mon – Sat · 10:00 – 19:00"}</p></div></div>
          {(site.offices || []).map((o) => <div key={o.name} className="py-5" data-testid={`office-${o.name}`}><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500"><MapPin className="h-3.5 w-3.5 text-gold" />{o.name}</p><p className="mt-1 text-sm font-semibold leading-relaxed text-navy">{o.address}</p></div>)}
          {office?.map_embed_url && <div className="mt-2"><MapEmbed src={office.map_embed_url} title={office.name} address={office.address} testId="contact-map" /></div>}
        </div></Reveal>
      </div></section>
    </>
  );
}
