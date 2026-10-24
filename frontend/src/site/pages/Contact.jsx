import { Phone, Mail, MessageCircle, MapPin } from "lucide-react";
import { useSite, Seo, Reveal, EnquiryForm } from "../SiteShell";

export default function Contact() {
  const { site } = useSite();
  if (!site) return null;
  return (
    <>
      <Seo title="Contact" description={`Enquire about homes by ${site.brand_name}. Call ${site.phone} or request a call back.`} />
      <section className="bg-navy pb-20 pt-40"><div className="container-site"><Reveal><p className="eyebrow">Contact</p><h1 className="display mt-4 text-5xl text-white sm:text-6xl lg:text-7xl">Let's find your home</h1><div className="hairline mt-6" /></Reveal></div></section>
      <section className="py-20"><div className="container-site grid gap-12 lg:grid-cols-5">
        <Reveal className="lg:col-span-2"><div className="space-y-5">
          <a href={`tel:${site.phone}`} className="flex items-center gap-4 rounded-2xl bg-white p-5 transition-colors hover:bg-gold/10" data-testid="contact-call"><Phone className="h-5 w-5 text-gold" /><div><p className="text-xs uppercase tracking-widest text-slate-500">Call</p><p className="font-semibold text-navy">{site.phone}</p></div></a>
          <a href={`https://wa.me/${(site.whatsapp || "").replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-4 rounded-2xl bg-white p-5 transition-colors hover:bg-gold/10" data-testid="contact-whatsapp"><MessageCircle className="h-5 w-5 text-gold" /><div><p className="text-xs uppercase tracking-widest text-slate-500">WhatsApp</p><p className="font-semibold text-navy">{site.whatsapp}</p></div></a>
          <a href={`mailto:${site.email}`} className="flex items-center gap-4 rounded-2xl bg-white p-5 transition-colors hover:bg-gold/10" data-testid="contact-email"><Mail className="h-5 w-5 text-gold" /><div><p className="text-xs uppercase tracking-widest text-slate-500">Email</p><p className="font-semibold text-navy">{site.email}</p></div></a>
          {(site.offices || []).map((o) => <div key={o.name} className="rounded-2xl bg-white p-5"><p className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500"><MapPin className="h-3.5 w-3.5 text-gold" />{o.name}</p><p className="mt-1 text-sm font-semibold text-navy">{o.address}</p>{o.map_embed_url && <div className="mt-4 aspect-[16/9] overflow-hidden rounded-xl"><iframe src={o.map_embed_url} title={o.name} loading="lazy" className="h-full w-full border-0" /></div>}</div>)}
        </div></Reveal>
        <Reveal delay={0.1} className="lg:col-span-3"><div className="rounded-3xl bg-white p-6 sm:p-10"><p className="eyebrow">Enquiry</p><h2 className="display mt-2 text-3xl text-navy">Request a call back</h2><div className="mt-6"><EnquiryForm /></div></div></Reveal>
      </div></section>
    </>
  );
}
