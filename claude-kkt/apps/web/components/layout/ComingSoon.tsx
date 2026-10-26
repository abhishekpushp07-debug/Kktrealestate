import Link from "next/link";

import { PhoneIcon, MailIcon } from "@/components/ui/icons";
import { telHref } from "@/lib/format";
import type { SiteSettings } from "@/lib/types";

export function ComingSoon({ site, brandName }: { site: SiteSettings | null; brandName: string }) {
  const phone = site?.contacts?.phone ?? null;
  const email = site?.contacts?.email ?? null;
  const tel = telHref(phone);
  return (
    <main
      id="main"
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-navy-950 px-6 py-24 text-center text-ivory-100"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgb(201 162 39 / 0.18), transparent 55%), radial-gradient(ellipse at 50% 100%, rgb(47 71 122 / 0.5), transparent 60%)",
        }}
      />
      <div className="relative max-w-2xl animate-fade-up">
        <p className="eyebrow text-gold-300">Something extraordinary is on its way</p>
        <h1 className="mt-6 font-display text-display-xl">{brandName}</h1>
        <div
          aria-hidden
          className="mx-auto mt-6 h-px w-24 bg-gradient-to-r from-transparent via-gold-500 to-transparent"
        />
        <p className="mt-8 text-lg leading-8 text-ivory-100/75">
          {site?.coming_soon_message?.trim() ||
            "Our new website is being crafted. Until then, our team would be delighted to help you in person."}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {tel ? (
            <a
              href={tel}
              className="inline-flex min-h-14 items-center gap-2 rounded-full bg-gold-500 px-8 font-semibold text-navy-950 transition hover:bg-gold-400"
            >
              <PhoneIcon size={18} /> {phone}
            </a>
          ) : null}
          {email ? (
            <a
              href={`mailto:${email}`}
              className="inline-flex min-h-14 items-center gap-2 rounded-full border border-ivory-100/40 px-8 font-semibold text-ivory-100 transition hover:bg-ivory-100 hover:text-navy-900"
            >
              <MailIcon size={18} /> {email}
            </a>
          ) : null}
        </div>
        <p className="mt-16 text-xs text-ivory-100/40">
          <Link href="/privacy" className="inline-flex min-h-12 items-center px-2 hover:text-gold-300">
            Privacy
          </Link>
          <span aria-hidden>·</span>
          <Link href="/disclaimer" className="inline-flex min-h-12 items-center px-2 hover:text-gold-300">
            Disclaimer
          </Link>
        </p>
      </div>
    </main>
  );
}
