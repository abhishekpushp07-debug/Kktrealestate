import type { ReactNode } from "react";

import { SiteShell } from "@/components/layout/SiteShell";
import { getSiteSettings } from "@/lib/api";
import { isClosed } from "@/lib/gate";

/**
 * Everything except /privacy and /disclaimer lives in this group. When the CMS "site live" switch is
 * off, each page here returns the full-screen coming-soon view (see lib/gate.tsx) and this layout
 * drops the navbar/footer so nothing else is rendered around it.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const site = await getSiteSettings();
  if (isClosed(site)) return <>{children}</>;
  return <SiteShell site={site}>{children}</SiteShell>;
}
