import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

import { JsonLd } from "@/components/JsonLd";
import { SiteConfigProvider } from "@/components/SiteConfigProvider";
import { getSiteSettings } from "@/lib/api";
import { publicApiUrl, siteConfig, siteUrl } from "@/lib/env";
import { resolveMediaUrl } from "@/lib/media";
import { brandName, organizationJsonLd, websiteJsonLd } from "@/lib/seo";
import { NO_SEO_DEFAULTS } from "@/lib/types";

// Every route renders at request time (data is cached 60 s via fetch tags), so `next build`
// never needs a running API and content changes (publish / unpublish / site_live) show within a minute.
export const dynamic = "force-dynamic";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B1F3A",
  colorScheme: "light",
};

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteSettings();
  const brand = brandName(site);
  const defaults = site?.seo_defaults ?? NO_SEO_DEFAULTS;
  const title =
    defaults.title?.trim() || `${brand} · ${site?.brand?.tagline?.trim() || "Homes crafted for generations"}`;
  const description =
    defaults.description?.trim() ||
    `Discover residences by ${brand}: RERA-registered projects, transparent pricing and private site visits.`;
  const ogImage = resolveMediaUrl(defaults.og_image_url, publicApiUrl());
  const favicon = resolveMediaUrl(site?.brand?.favicon_url, publicApiUrl());
  const live = site?.site_live !== false;

  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${brand}` },
    description,
    applicationName: brand,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: brand,
      locale: "en_IN",
      title,
      description,
      url: "/",
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    robots: live
      ? {
          index: true,
          follow: true,
          googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
        }
      : { index: false, follow: false },
    ...(favicon ? { icons: { icon: favicon } } : {}),
    formatDetection: { telephone: true, email: true, address: true },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const site = await getSiteSettings();
  const config = siteConfig();
  const brand = brandName(site);

  return (
    <html lang="en" className={`${cormorant.variable} ${manrope.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only z-[100] rounded-full bg-gold-500 px-5 py-3 font-semibold text-navy-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <SiteConfigProvider
          value={{
            ...config,
            portalUrl: site?.portal_url?.trim() || config.portalUrl,
            brandName: brand,
            phone: site?.contacts?.phone ?? null,
            whatsapp: site?.contacts?.whatsapp ?? null,
            email: site?.contacts?.email ?? null,
          }}
        >
          {children}
        </SiteConfigProvider>
        <JsonLd data={[organizationJsonLd(site, config.apiUrl), websiteJsonLd(site)]} />
      </body>
    </html>
  );
}
