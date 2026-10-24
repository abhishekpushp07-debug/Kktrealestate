import type { MetadataRoute } from "next";

import { getSiteSettings, listPosts, listProjects } from "@/lib/api";
import { siteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Built from the API's published content only: unpublished projects and draft posts never appear. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [site, projects, posts] = await Promise.all([getSiteSettings(), listProjects(), listPosts(1)]);
  const now = new Date();

  const legal: MetadataRoute.Sitemap = [
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/disclaimer`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
  if (site && site.site_live === false) return legal;

  const statics: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/projects`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/gallery`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];

  const projectUrls: MetadataRoute.Sitemap = projects.map((p) => ({
    url: `${base}/projects/${encodeURIComponent(p.slug)}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.9,
  }));

  const postUrls: MetadataRoute.Sitemap = posts.items.map((post) => ({
    url: `${base}/blog/${encodeURIComponent(post.slug)}`,
    lastModified: post.published_at ? new Date(post.published_at) : now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...statics, ...projectUrls, ...postUrls, ...legal];
}
