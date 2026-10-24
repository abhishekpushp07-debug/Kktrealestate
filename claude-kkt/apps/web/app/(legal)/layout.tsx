import type { ReactNode } from "react";

import { SiteShell } from "@/components/layout/SiteShell";
import { getSiteSettings } from "@/lib/api";

/** Legal pages stay reachable even when the site is switched to coming-soon. */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const site = await getSiteSettings();
  return <SiteShell site={site}>{children}</SiteShell>;
}
