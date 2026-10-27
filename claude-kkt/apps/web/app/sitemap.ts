import type { MetadataRoute } from "next";

import { getSitemap } from "@/lib/api";
import { siteUrl } from "@/lib/env";

/** Regenerated every 5 minutes and on every CMS / project-website write (API → /api/revalidate). */
export const revalidate = 300;

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

function changeFrequency(path: string): ChangeFrequency {
  if (path === "/" || path === "/projects") return "daily";
  if (path.startsWith("/projects/") || path === "/blog" || path === "/gallery") return "weekly";
  return path.startsWith("/blog/") ? "monthly" : "yearly";
}

/**
 * Built from GET /public/sitemap: every published project, ALL published posts and CMS pages and the static pages, each with the API's
 * lastmod (the newest change of what the page shows, never "now"). Unpublished projects and draft posts never appear; while the site is
 * not live only the legal pages are listed. When the API is unreachable the legal pages are listed and the file regenerates in 10 s.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const entries = (await getSitemap()) ?? [];
  const legal = ["/privacy", "/disclaimer"];
  const seen = new Set<string>();
  const out: MetadataRoute.Sitemap = [];
  for (const e of entries) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    out.push({
      url: `${base}${e.path === "/" ? "/" : e.path.split("/").map(encodeURIComponent).join("/")}`,
      lastModified: new Date(e.updated_at),
      changeFrequency: changeFrequency(e.path),
      priority: e.priority,
    });
  }
  for (const path of legal)
    if (!seen.has(path)) out.push({ url: `${base}${path}`, changeFrequency: "yearly", priority: 0.2 });
  return out;
}
