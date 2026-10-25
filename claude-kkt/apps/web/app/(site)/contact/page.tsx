import type { Metadata } from "next";

import { JsonLd } from "@/components/JsonLd";
import { EnquiryForm } from "@/components/forms/EnquiryForm";
import { VisitBooking } from "@/components/forms/VisitBooking";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section, SectionHeading } from "@/components/ui/Section";
import { MailIcon, MapPinIcon, PhoneIcon, WhatsAppIcon } from "@/components/ui/icons";
import { getSiteSettings, listProjects } from "@/lib/api";
import { telHref, whatsappHref } from "@/lib/format";
import { closedMetadata, siteGate } from "@/lib/gate";
import { brandName, breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { NO_CONTACTS } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const closed = await closedMetadata();
  if (closed) return closed;
  const site = await getSiteSettings();
  return pageMetadata({ title: "Contact", description: `Call, WhatsApp or visit ${brandName(site)}. Request a call back or book a private site visit.`, path: "/contact" });
}

export default async function ContactPage() {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const site = gate.site;
  const projects = await listProjects();
  const brand = brandName(site);
  const contacts = site?.contacts ?? NO_CONTACTS;
  const tel = telHref(contacts.phone);
  const wa = whatsappHref(contacts.whatsapp ?? contacts.phone, `Hello ${brand}, I would like to know more about your projects.`);
  const options = projects.map((p) => ({ slug: p.slug, name: p.name }));
  const card = "flex items-start gap-4 rounded-card border border-line bg-white p-5";

  return (
    <>
      <PageHeader eyebrow="Contact" title="We would love to hear from you" lead="Call, write or walk in. A relationship manager will respond personally." compact />

      <Section tone="ivory">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:gap-16">
          <div className="space-y-4">
            {tel ? (
              <a href={tel} className={`${card} transition hover:border-gold-500`}>
                <PhoneIcon className="mt-1 text-gold-600" />
                <span>
                  <span className="block text-xs uppercase tracking-widest text-ink-soft">Call</span>
                  <span className="block font-semibold text-navy-900">{contacts.phone}</span>
                </span>
              </a>
            ) : null}
            {wa ? (
              <a href={wa} className={`${card} transition hover:border-gold-500`} rel="noopener noreferrer" target="_blank">
                <WhatsAppIcon className="mt-1 text-gold-600" />
                <span>
                  <span className="block text-xs uppercase tracking-widest text-ink-soft">WhatsApp</span>
                  <span className="block font-semibold text-navy-900">Chat with us</span>
                </span>
              </a>
            ) : null}
            {contacts.email ? (
              <a href={`mailto:${contacts.email}`} className={`${card} transition hover:border-gold-500`}>
                <MailIcon className="mt-1 text-gold-600" />
                <span className="min-w-0">
                  <span className="block text-xs uppercase tracking-widest text-ink-soft">Email</span>
                  <span className="block break-words font-semibold text-navy-900">{contacts.email}</span>
                </span>
              </a>
            ) : null}
            {(site?.offices ?? []).map((office) => (
              <div key={`${office.name}-${office.address}`} className={card}>
                <MapPinIcon className="mt-1 shrink-0 text-gold-600" />
                <div className="min-w-0 text-sm leading-6">
                  <p className="text-xs uppercase tracking-widest text-ink-soft">{office.name}</p>
                  <p className="mt-1 font-medium text-navy-900">{office.address}</p>
                  <p className="mt-1 flex flex-wrap gap-x-4">
                    {office.phone ? (
                      <a href={telHref(office.phone) ?? "#"} className="inline-flex min-h-12 items-center text-navy-900 hover:text-gold-700">
                        {office.phone}
                      </a>
                    ) : null}
                    {office.maps_link ? (
                      <a href={office.maps_link} className="inline-flex min-h-12 items-center font-semibold text-gold-700 hover:underline" rel="noopener noreferrer" target="_blank">
                        Directions
                      </a>
                    ) : null}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div id="enquire" className="scroll-mt-28 rounded-card border border-line bg-white p-6 shadow-card sm:p-8">
            <EnquiryForm projects={options} heading="Request a call back" />
          </div>
        </div>
      </Section>

      <Section tone="navy" id="visit" className="scroll-mt-20">
        <SectionHeading eyebrow="Private site visit" title="Book a time to see a project in person" lead="Pick a project and a slot. We confirm instantly and send a calendar invite." light />
        <div className="mt-12 rounded-card border border-ivory-100/10 bg-ivory-100/5 p-6 backdrop-blur-sm sm:p-8">
          {options.length ? (
            <VisitBooking projects={options} tone="dark" />
          ) : (
            <p className="text-ivory-100/75">Site visits open with our next launch. Please call us and we will arrange a private viewing.</p>
          )}
        </div>
      </Section>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }])} />
    </>
  );
}
