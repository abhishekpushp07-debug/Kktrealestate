import type { Metadata } from "next";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { getSiteSettings } from "@/lib/api";
import { brandName } from "@/lib/seo";
import type { SiteSettings } from "@/lib/types";

/**
 * "Site live" switch. Next.js renders page segments even when a layout omits `children`, so the
 * gate must be applied inside each page (and its metadata), not only in the (site) layout.
 * Usage at the top of a page:  const gate = await siteGate(); if (gate.closed) return gate.page;
 */
export function isClosed(site: SiteSettings | null): site is SiteSettings {
  return site !== null && site.site_live === false;
}

export type SiteGate = { closed: false; site: SiteSettings | null } | { closed: true; site: SiteSettings; page: React.ReactElement };

export async function siteGate(): Promise<SiteGate> {
  const site = await getSiteSettings();
  if (isClosed(site)) return { closed: true, site, page: <ComingSoon site={site} brandName={brandName(site)} /> };
  return { closed: false, site };
}

/** Metadata for a closed site: reveals nothing about the requested page. */
export async function closedMetadata(): Promise<Metadata | null> {
  const site = await getSiteSettings();
  if (!isClosed(site)) return null;
  return {
    title: { absolute: `${brandName(site)} · Coming soon` },
    description: site.coming_soon_message ?? undefined,
    robots: { index: false, follow: false },
    openGraph: { title: `${brandName(site)} · Coming soon`, url: "/" },
  };
}
