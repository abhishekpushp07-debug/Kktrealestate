"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { buttonClasses } from "@/components/ui/Button";
import { useFocusTrap, useLockBodyScroll } from "@/components/ui/hooks";
import { CloseIcon, MenuIcon, PhoneIcon } from "@/components/ui/icons";
import { telHref } from "@/lib/format";
import { NAV_LINKS } from "@/lib/nav";

interface SiteNavProps {
  brandName: string;
  logoUrl: string | null;
  phone: string | null;
  portalUrl: string;
}

/** Glass navbar over the page hero; turns solid navy once the visitor scrolls. */
export function SiteNav({ brandName, logoUrl, phone, portalUrl }: SiteNavProps) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(menuRef, open, () => setOpen(false));
  useLockBodyScroll(open);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  const tel = telHref(phone);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-500 ${
        scrolled || open ? "bg-navy-900 shadow-[0_10px_40px_-20px_rgb(6_20_42/0.8)]" : "glass"
      }`}
    >
      <nav className="container-wide flex h-18 items-center justify-between gap-4 text-ivory-100" aria-label="Primary">
        <Link href="/" className="tap flex items-center gap-3 rounded-md py-1" aria-label={`${brandName} home`}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-9 w-auto max-w-[9rem] object-contain" width={144} height={36} />
          ) : (
            <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/70 font-display text-lg text-gold-300">
              {brandName.charAt(0)}
            </span>
          )}
          <span className="font-display text-2xl tracking-wide">{brandName}</span>
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`tap inline-flex items-center rounded-full px-4 text-[0.9375rem] font-medium tracking-wide transition hover:text-gold-300 ${
                  isActive(link.href) ? "text-gold-300" : "text-ivory-100/90"
                }`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          {tel ? (
            <a href={tel} className={buttonClasses("ghost-light", "sm", "hidden md:inline-flex")}>
              <PhoneIcon size={18} />
              <span className="hidden xl:inline">{phone}</span>
              <span className="xl:hidden">Call</span>
            </a>
          ) : null}
          <a href={portalUrl} className={buttonClasses("outline-light", "sm", "hidden md:inline-flex")} rel="noopener">
            Customer Login
          </a>
          <button
            type="button"
            className="tap inline-flex items-center justify-center rounded-full text-ivory-100 hover:bg-ivory-100/10 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <CloseIcon size={24} /> : <MenuIcon size={24} />}
          </button>
        </div>
      </nav>

      {open ? (
        <div
          id="mobile-menu"
          ref={menuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          tabIndex={-1}
          className="fixed inset-x-0 bottom-0 top-18 z-40 overflow-y-auto bg-navy-900 text-ivory-100 outline-none lg:hidden animate-fade-in"
        >
          <ul className="container-site flex flex-col py-6">
            {NAV_LINKS.map((link) => (
              <li key={link.href} className="border-b border-ivory-100/10">
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={`flex min-h-14 items-center font-display text-3xl ${isActive(link.href) ? "text-gold-300" : ""}`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="container-site flex flex-col gap-3 pb-28">
            <a href={portalUrl} className={buttonClasses("primary", "lg")} rel="noopener">
              Customer Login
            </a>
            {tel ? (
              <a href={tel} className={buttonClasses("outline-light", "lg")}>
                <PhoneIcon size={18} /> {phone}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
