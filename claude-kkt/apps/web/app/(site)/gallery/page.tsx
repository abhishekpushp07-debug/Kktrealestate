import type { Metadata } from "next";

import { JsonLd } from "@/components/JsonLd";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { getGallery } from "@/lib/api";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: "Gallery", description: "Photographs from our projects: architecture, interiors, amenities and life on site.", path: "/gallery" });
}

export default async function GalleryPage() {
  const gallery = await getGallery();
  const projects =
    gallery.projects?.length
      ? gallery.projects
      : [...new Map(gallery.items.filter((i) => i.project_slug && i.project_name).map((i) => [i.project_slug as string, { slug: i.project_slug as string, name: i.project_name as string }])).values()];

  return (
    <>
      <PageHeader eyebrow="Gallery" title="Moments from our projects" lead="Architecture, interiors and the everyday life that fills them." compact />
      <section className="container-site py-12 sm:py-16">
        <GalleryGrid items={gallery.items} projects={projects} />
      </section>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Gallery", path: "/gallery" }])} />
    </>
  );
}
