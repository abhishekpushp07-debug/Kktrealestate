import type { ReactNode } from "react";

import { Footer } from "@/components/layout/Footer";
import { SiteNav } from "@/components/layout/SiteNav";
import { StickyMobileBar } from "@/components/layout/StickyMobileBar";
import { erpUrl, portalUrl, publicApiUrl } from "@/lib/env";
import { resolveMediaUrl } from "@/lib/media";
import { brandName } from "@/lib/seo";
import type { SiteSettings } from "@/lib/types";

/** Navbar + main + footer + sticky mobile bar. Shared by the gated (site) group, the legal group and the 404 page. */
export function SiteShell({ site, children }: { site: SiteSettings | null; children: ReactNode }) {
  const brand = brandName(site);
  const portal = site?.portal_url?.trim() || portalUrl();
  return (
    <>
      <SiteNav
        brandName={brand}
        logoUrl={resolveMediaUrl(site?.brand?.logo_url, publicApiUrl())}
        phone={site?.contacts?.phone ?? null}
        portalUrl={portal}
      />
      <main id="main" className="pb-16 md:pb-0" tabIndex={-1}>
        {children}
      </main>
      <Footer site={site} brandName={brand} erpUrl={erpUrl()} portalUrl={portal} />
      <StickyMobileBar />
    </>
  );
}
