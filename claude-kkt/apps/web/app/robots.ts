import type { MetadataRoute } from "next";

import { getSiteSettings } from "@/lib/api";
import { siteUrl } from "@/lib/env";

/** Follows the CMS "site live" switch within 5 minutes (at once on a CMS write, via /api/revalidate). */
export const revalidate = 300;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = siteUrl();
  const site = await getSiteSettings();
  if (site && site.site_live === false) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/visit/", "/api/", "/_next/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
