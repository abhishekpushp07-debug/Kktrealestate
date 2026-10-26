"use client";

import { useMemo, useState } from "react";

import { Lightbox, type LightboxImage } from "@/components/ui/Lightbox";
import { SmartImage } from "@/components/ui/SmartImage";
import type { GalleryItem } from "@/lib/types";

interface GalleryGridProps {
  items: GalleryItem[];
  projects: Array<{ slug: string; name: string }>;
}

/** CSS-columns masonry with a project filter and a focus-trapped lightbox. */
export function GalleryGrid({ items, projects }: GalleryGridProps) {
  const [filter, setFilter] = useState<string>("");
  const [index, setIndex] = useState<number | null>(null);

  const visible = useMemo(() => (filter ? items.filter((i) => i.project_slug === filter) : items), [filter, items]);
  const lightboxImages: LightboxImage[] = visible.map((img, i) => ({ src: img.medium_url, alt: img.alt || img.caption || `Gallery image ${i + 1}`, caption: img.caption ?? img.project_name ?? null }));
  const chip = (active: boolean) => `tap shrink-0 rounded-full border px-5 text-sm font-semibold transition ${active ? "border-navy-900 bg-navy-900 text-ivory-100" : "border-navy-900/15 bg-white text-navy-900 hover:border-gold-500"}`;

  return (
    <div>
      {projects.length > 1 ? (
        <div role="group" aria-label="Filter by project" className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <button type="button" aria-pressed={filter === ""} onClick={() => setFilter("")} className={chip(filter === "")}>
            All
          </button>
          {projects.map((p) => (
            <button key={p.slug} type="button" aria-pressed={filter === p.slug} onClick={() => setFilter(p.slug)} className={chip(filter === p.slug)}>
              {p.name}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-ink-muted">No photographs yet — please check back soon.</p>
      ) : (
        <ul className="mt-8 columns-1 gap-4 sm:columns-2 lg:columns-3 [column-fill:_balance]">
          {visible.map((img, i) => {
            const ratio = img.width && img.height ? img.width / img.height : [4 / 5, 1, 4 / 3, 3 / 4][i % 4] ?? 1;
            return (
              <li key={`${img.url}-${i}`} className="mb-4 break-inside-avoid">
                <button type="button" onClick={() => setIndex(i)} className="group relative block w-full overflow-hidden rounded-card bg-navy-900 shadow-card" style={{ aspectRatio: String(ratio) }} aria-label={img.caption || img.project_name ? undefined : `Open ${img.alt || `image ${i + 1}`}`}>
                  <SmartImage src={img.url} alt="" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="transition duration-700 ease-luxe group-hover:scale-105" />
                  {img.caption || img.project_name ? (
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/80 to-transparent p-4 text-left text-sm text-ivory-100">
                      <span className="sr-only">Open image: </span>
                      {img.caption ?? img.project_name}
                      {img.caption && img.project_name ? <span className="block text-xs text-ivory-100/70">{img.project_name}</span> : null}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Lightbox images={lightboxImages} index={index} onClose={() => setIndex(null)} onIndexChange={setIndex} />
    </div>
  );
}
