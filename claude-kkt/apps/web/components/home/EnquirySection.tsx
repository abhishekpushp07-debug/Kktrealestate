import { EnquiryForm, type ProjectOption } from "@/components/forms/EnquiryForm";
import { Section } from "@/components/ui/Section";
import { PhoneIcon, WhatsAppIcon, MailIcon } from "@/components/ui/icons";
import { telHref, whatsappHref } from "@/lib/format";
import type { SiteContacts } from "@/lib/types";

interface EnquirySectionProps {
  projects: ProjectOption[];
  contacts: SiteContacts;
  brandName: string;
  id?: string;
}

export function EnquirySection({ projects, contacts, brandName, id = "enquire" }: EnquirySectionProps) {
  const tel = telHref(contacts.phone);
  const wa = whatsappHref(
    contacts.whatsapp ?? contacts.phone,
    `Hello ${brandName}, I would like to know more about your projects.`,
  );
  const link = "inline-flex min-h-12 items-center gap-3 text-ivory-100/85 transition hover:text-gold-300";
  return (
    <Section id={id} tone="navy" className="scroll-mt-20">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-20">
        <div>
          <p className="eyebrow text-gold-300">Let us call you</p>
          <h2 className="mt-4 font-display text-display-md">Begin the conversation about your next home.</h2>
          <p className="mt-6 text-lg leading-8 text-ivory-100/75">
            Share a few details and a relationship manager will call you back — usually within the hour on working days.
          </p>
          <ul className="mt-10 space-y-2">
            {tel ? (
              <li>
                <a href={tel} className={link}>
                  <PhoneIcon className="text-gold-300" /> {contacts.phone}
                </a>
              </li>
            ) : null}
            {wa ? (
              <li>
                <a href={wa} className={link} rel="noopener noreferrer" target="_blank">
                  <WhatsAppIcon className="text-gold-300" /> Chat on WhatsApp
                </a>
              </li>
            ) : null}
            {contacts.email ? (
              <li>
                <a href={`mailto:${contacts.email}`} className={link}>
                  <MailIcon className="text-gold-300" /> {contacts.email}
                </a>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="rounded-card border border-ivory-100/10 bg-ivory-100/5 p-6 backdrop-blur-sm sm:p-8">
          <EnquiryForm projects={projects} tone="dark" />
        </div>
      </div>
    </Section>
  );
}
