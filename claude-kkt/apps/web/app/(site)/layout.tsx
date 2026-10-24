import type { ReactNode } from "react";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { SiteShell } from "@/components/layout/SiteShell";
import { getSiteSettings } from "@/lib/api";
import { brandName } from "@/lib/seo";

/**
 * Everything except /privacy and /disclaimer lives in this group. When the CMS "site live" switch is
 * off, every route here renders the coming-soon page instead of its content (nothing leaks in the RSC payload).
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const site = await getSiteSettings();
  if (site && site.site_live === false) {
    return <ComingSoon site={site} brandName={brandName(site)} />;
  }
  return <SiteShell site={site}>{children}</SiteShell>;
}
