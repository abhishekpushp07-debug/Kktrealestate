import type { Metadata } from "next";

import { siteUrl } from "@/lib/env";
import { resolveMediaUrl } from "@/lib/media";
import type { PostDetail, ProjectDetail, SiteSettings } from "@/lib/types";

export const DEFAULT_BRAND = "KKT";

export function brandName(site: SiteSettings | null): string {
  return site?.brand?.name?.trim() || DEFAULT_BRAND;
}

export interface PageMeta {
  title: string;
  description?: string | null;
  /** Site-relative path used for the canonical URL, e.g. "/projects". */
  path: string;
  image?: string | null;
  type?: "website" | "article";
  noIndex?: boolean;
  publishedTime?: string | null;
}

/** Metadata for a page; merges with the root defaults (title template, siteName, twitter card). */
export function pageMetadata(meta: PageMeta): Metadata {
  const description = meta.description?.trim() || undefined;
  const images = meta.image ? [{ url: meta.image }] : undefined;
  return {
    title: meta.title,
    description,
    alternates: { canonical: meta.path },
    openGraph: {
      title: meta.title,
      description,
      url: meta.path,
      type: meta.type ?? "website",
      ...(images ? { images } : {}),
      ...(meta.publishedTime ? { publishedTime: meta.publishedTime } : {}),
    },
    twitter: { card: images ? "summary_large_image" : "summary", title: meta.title, description, ...(images ? { images } : {}) },
    ...(meta.noIndex ? { robots: { index: false, follow: false } } : {}),
  };
}

// ---------------------------------------------------------------------------
// JSON-LD builders (schema.org). Output is serialised by <JsonLd/>.
// ---------------------------------------------------------------------------

export type JsonLdObject = Record<string, unknown>;

function compact(obj: JsonLdObject): JsonLdObject {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

export function organizationJsonLd(site: SiteSettings | null, apiUrl: string): JsonLdObject {
  const base = siteUrl();
  const sameAs = site ? Object.values(site.social ?? {}).filter((v): v is string => typeof v === "string" && v.length > 0) : [];
  const office = site?.offices?.[0];
  return compact({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brandName(site),
    url: base,
    logo: resolveMediaUrl(site?.brand?.logo_url, apiUrl) ?? undefined,
    telephone: site?.contacts?.phone ?? undefined,
    email: site?.contacts?.email ?? undefined,
    sameAs: sameAs.length ? sameAs : undefined,
    address: office
      ? compact({
          "@type": "PostalAddress",
          streetAddress: office.address,
          addressLocality: office.city ?? undefined,
          addressCountry: "IN",
        })
      : undefined,
  });
}

export function websiteJsonLd(site: SiteSettings | null): JsonLdObject {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: brandName(site),
    url: base,
    potentialAction: {
      "@type": "SearchAction",
      target: `${base}/projects?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function projectJsonLd(project: ProjectDetail, apiUrl: string): JsonLdObject {
  const base = siteUrl();
  const address = project.key_facts?.address ?? {};
  const images = (project.hero_images ?? []).map((img) => resolveMediaUrl(img.url, apiUrl)).filter((u): u is string => !!u);
  const listing: JsonLdObject = compact({
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: project.name,
    url: `${base}/projects/${project.slug}`,
    description: project.overview,
    image: images.length ? images : undefined,
    datePosted: project.key_facts?.launch_date ?? undefined,
    mainEntity: compact({
      "@type": "ApartmentComplex",
      name: project.name,
      address: compact({
        "@type": "PostalAddress",
        streetAddress: [address.line1, address.line2].filter(Boolean).join(", ") || undefined,
        addressLocality: address.locality || address.city || project.city,
        addressRegion: address.state ?? undefined,
        postalCode: address.pincode ?? undefined,
        addressCountry: "IN",
      }),
      geo:
        typeof project.latitude === "number" && typeof project.longitude === "number"
          ? { "@type": "GeoCoordinates", latitude: project.latitude, longitude: project.longitude }
          : undefined,
      amenityFeature: project.amenities?.length
        ? project.amenities.map((a) => ({ "@type": "LocationFeatureSpecification", name: a.name, value: true }))
        : undefined,
      numberOfAccommodationUnits: project.key_facts?.total_units ?? undefined,
    }),
    offers:
      project.show_prices && project.starting_price_paise !== null && project.starting_price_paise !== undefined
        ? {
            "@type": "Offer",
            priceCurrency: "INR",
            price: Math.round(project.starting_price_paise / 100),
            availability: "https://schema.org/InStock",
          }
        : undefined,
  });
  return listing;
}

export function articleJsonLd(post: PostDetail, site: SiteSettings | null, apiUrl: string): JsonLdObject {
  const base = siteUrl();
  return compact({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: resolveMediaUrl(post.cover_image_url, apiUrl) ?? undefined,
    datePublished: post.published_at ?? undefined,
    dateModified: post.updated_at ?? post.published_at ?? undefined,
    author: post.author_name ? { "@type": "Person", name: post.author_name } : { "@type": "Organization", name: brandName(site) },
    publisher: { "@type": "Organization", name: brandName(site) },
    mainEntityOfPage: `${base}/blog/${post.slug}`,
  });
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>): JsonLdObject {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${base}${item.path}`,
    })),
  };
}

export function faqJsonLd(faqs: Array<{ q: string; a: string }>): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
