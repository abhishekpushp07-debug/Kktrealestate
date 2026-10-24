"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { Modal } from "@/components/ui/Modal";
import { CalendarIcon, DownloadIcon, MailIcon, PhoneIcon, WhatsAppIcon } from "@/components/ui/icons";
import { telHref, whatsappHref } from "@/lib/format";

/** Fixed bottom bar on phones: Call · WhatsApp · Enquire (opens a sheet with four actions). */
export function StickyMobileBar() {
  const { phone, whatsapp, brandName } = useSiteConfig();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const tel = telHref(phone);
  const wa = whatsappHref(whatsapp ?? phone, `Hello ${brandName}, I would like to know more about your projects.`);
  const onProject = /^\/projects\/[^/]+/.test(pathname);
  const visitHref = onProject ? `${pathname}#visit` : "/contact#visit";
  const brochureHref = onProject ? `${pathname}#brochure` : "/projects";
  const enquireHref = onProject ? `${pathname}#enquire` : "/contact";

  const item = "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wider";
  const sheetItem = "flex min-h-14 items-center gap-4 rounded-2xl border border-navy-900/10 bg-white px-5 text-navy-900 shadow-card transition hover:border-gold-500";

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ivory-100/10 bg-navy-900/95 text-ivory-100 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <nav className="flex" aria-label="Quick actions">
          {tel ? (
            <a href={tel} className={item}>
              <PhoneIcon size={20} /> Call
            </a>
          ) : null}
          {wa ? (
            <a href={wa} className={item} rel="noopener noreferrer" target="_blank">
              <WhatsAppIcon size={20} /> WhatsApp
            </a>
          ) : null}
          <button type="button" className={`${item} bg-gold-500 text-navy-950`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
            <MailIcon size={20} /> Enquire
          </button>
        </nav>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="How can we help?" description="Choose the quickest way to reach us." size="sm">
        <ul className="grid gap-3">
          {tel ? (
            <li>
              <a href={tel} className={sheetItem}>
                <PhoneIcon className="text-gold-600" /> Call us
              </a>
            </li>
          ) : null}
          {wa ? (
            <li>
              <a href={wa} className={sheetItem} rel="noopener noreferrer" target="_blank">
                <WhatsAppIcon className="text-gold-600" /> Chat on WhatsApp
              </a>
            </li>
          ) : null}
          <li>
            <Link href={visitHref} className={sheetItem} onClick={() => setOpen(false)}>
              <CalendarIcon className="text-gold-600" /> Book a private site visit
            </Link>
          </li>
          <li>
            <Link href={brochureHref} className={sheetItem} onClick={() => setOpen(false)}>
              <DownloadIcon className="text-gold-600" /> Download a brochure
            </Link>
          </li>
          <li>
            <Link href={enquireHref} className={sheetItem} onClick={() => setOpen(false)}>
              <MailIcon className="text-gold-600" /> Request a call back
            </Link>
          </li>
        </ul>
      </Modal>
    </>
  );
}
