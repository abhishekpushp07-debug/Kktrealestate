import Link from "next/link";

import { FacebookIcon, InstagramIcon, LinkedInIcon, MailIcon, MapPinIcon, PhoneIcon, WhatsAppIcon, XIcon, YouTubeIcon } from "@/components/ui/icons";
import { telHref, whatsappHref } from "@/lib/format";
import { NAV_LINKS } from "@/lib/nav";
import type { SiteSettings } from "@/lib/types";

interface FooterProps {
  site: SiteSettings | null;
  brandName: string;
  erpUrl: string;
  portalUrl: string;
}

const SOCIAL: Array<{ key: keyof SiteSettings["social"]; label: string; Icon: typeof FacebookIcon }> = [
  { key: "facebook", label: "Facebook", Icon: FacebookIcon },
  { key: "instagram", label: "Instagram", Icon: InstagramIcon },
  { key: "linkedin", label: "LinkedIn", Icon: LinkedInIcon },
  { key: "youtube", label: "YouTube", Icon: YouTubeIcon },
  { key: "x", label: "X", Icon: XIcon },
  { key: "twitter", label: "X", Icon: XIcon },
];

export function Footer({ site, brandName, erpUrl, portalUrl }: FooterProps) {
  const contacts = site?.contacts ?? {};
  const offices = site?.offices ?? [];
  const social = SOCIAL.filter(({ key }) => typeof site?.social?.[key] === "string" && site.social[key]);
  const tel = telHref(contacts.phone);
  const wa = whatsappHref(contacts.whatsapp ?? contacts.phone);
  const year = new Date().getFullYear();
  const linkClass = "tap inline-flex items-center text-ivory-100/80 hover:text-gold-300 transition";

  return (
    <footer className="bg-navy-950 text-ivory-100" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="container-site grid gap-12 py-16 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr] lg:py-20">
        <div>
          <p className="font-display text-3xl">{brandName}</p>
          {site?.brand?.tagline ? <p className="mt-3 max-w-sm text-ivory-100/70">{site.brand.tagline}</p> : null}
          <ul className="mt-6 space-y-2 text-sm">
            {tel ? (
              <li>
                <a href={tel} className={linkClass}>
                  <PhoneIcon size={16} className="mr-2" /> {contacts.phone}
                </a>
              </li>
            ) : null}
            {wa ? (
              <li>
                <a href={wa} className={linkClass} rel="noopener noreferrer" target="_blank">
                  <WhatsAppIcon size={16} className="mr-2" /> WhatsApp
                </a>
              </li>
            ) : null}
            {contacts.email ? (
              <li>
                <a href={`mailto:${contacts.email}`} className={linkClass}>
                  <MailIcon size={16} className="mr-2" /> {contacts.email}
                </a>
              </li>
            ) : null}
          </ul>
          {social.length ? (
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Social media">
              {social.map(({ key, label, Icon }) => (
                <li key={key}>
                  <a
                    href={site?.social?.[key] ?? "#"}
                    className="tap inline-flex items-center justify-center rounded-full border border-ivory-100/15 text-ivory-100/80 transition hover:border-gold-500 hover:text-gold-300"
                    aria-label={label}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Icon size={18} />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <nav aria-label="Quick links">
          <p className="eyebrow text-gold-300">Explore</p>
          <ul className="mt-4 space-y-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={linkClass}>
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={portalUrl} className={linkClass} rel="noopener">
                Customer Login
              </a>
            </li>
          </ul>
        </nav>

        <nav aria-label="Legal">
          <p className="eyebrow text-gold-300">Legal</p>
          <ul className="mt-4 space-y-1">
            <li>
              <Link href="/privacy" className={linkClass}>
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link href="/disclaimer" className={linkClass}>
                Disclaimer
              </Link>
            </li>
            <li>
              <a href={erpUrl} className={`${linkClass} text-ivory-100/50`} rel="noopener">
                Staff login
              </a>
            </li>
          </ul>
        </nav>

        <div>
          <p className="eyebrow text-gold-300">Offices</p>
          {offices.length ? (
            <ul className="mt-4 space-y-5">
              {offices.map((office) => (
                <li key={`${office.name}-${office.address}`} className="text-sm leading-6 text-ivory-100/80">
                  <p className="font-semibold text-ivory-100">{office.name}</p>
                  <p className="mt-1 flex gap-2">
                    <MapPinIcon size={16} className="mt-1 shrink-0 text-gold-300" />
                    <span>
                      {office.address}
                      {office.city ? `, ${office.city}` : ""}
                    </span>
                  </p>
                  {office.hours ? <p className="mt-1 text-ivory-100/60">{office.hours}</p> : null}
                  {office.phone ? (
                    <a href={telHref(office.phone) ?? "#"} className="mt-1 inline-flex min-h-12 items-center text-ivory-100/80 hover:text-gold-300">
                      {office.phone}
                    </a>
                  ) : null}
                  {office.maps_link ? (
                    <a href={office.maps_link} className="ml-3 inline-flex min-h-12 items-center text-gold-300 hover:underline" rel="noopener noreferrer" target="_blank">
                      Directions
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-ivory-100/60">Office details coming soon.</p>
          )}
        </div>
      </div>

      <div className="border-t border-ivory-100/10">
        <div className="container-site py-8 text-xs leading-6 text-ivory-100/55">
          {site?.disclaimer ? <p className="max-w-5xl whitespace-pre-line">{site.disclaimer}</p> : null}
          <p className="mt-4">
            © {year} {brandName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
