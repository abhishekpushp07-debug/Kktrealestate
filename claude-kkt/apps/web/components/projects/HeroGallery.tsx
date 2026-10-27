"use client";

import { useState } from "react";

import { Lightbox, type LightboxImage } from "@/components/ui/Lightbox";
import { SmartImage } from "@/components/ui/SmartImage";
import { SIZES } from "@/lib/media";
import type { PublicImage } from "@/lib/types";

interface HeroGalleryProps {
  images: PublicImage[];
  projectName: string;
}

/** Cinematic hero mosaic (1 large + up to 4 small) that opens a focus-trapped lightbox. */
export function HeroGallery({ images, projectName }: HeroGalleryProps) {
  const [index, setIndex] = useState<number | null>(null);
  const items: LightboxImage[] = images.map((img, i) => ({
    src: img.url,
    alt: img.alt || `${projectName} — image ${i + 1}`,
    caption: img.caption ?? null,
  }));
  const [first, ...rest] = items;
  const thumbs = rest.slice(0, 4);

  if (!first) {
    return (
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-card bg-navy-900 sm:aspect-[21/9]">
        <SmartImage src={null} alt={projectName} />
      </div>
    );
  }

  const tile =
    "group relative block h-full w-full overflow-hidden rounded-card bg-navy-900 focus-visible:outline-offset-[-3px]";

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4 sm:grid-rows-2 sm:gap-4" style={{ gridAutoRows: "minmax(0, 1fr)" }}>
        <button
          type="button"
          onClick={() => setIndex(0)}
          className={`${tile} aspect-[16/10] sm:col-span-3 sm:row-span-2 sm:aspect-auto`}
          aria-label={`Open gallery: ${first.alt}`}
        >
          <SmartImage
            src={first.src}
            alt={first.alt}
            sizes={SIZES.full}
            priority
            className="transition duration-700 ease-luxe group-hover:scale-[1.03]"
          />
        </button>
        {thumbs.length ? (
          <div className="grid grid-cols-4 gap-3 sm:col-span-1 sm:row-span-2 sm:grid-cols-1 sm:grid-rows-4 sm:gap-4">
            {thumbs.map((img, i) => (
              <button
                key={img.src}
                type="button"
                onClick={() => setIndex(i + 1)}
                className={`${tile} aspect-square sm:aspect-auto`}
                aria-label={`Open image ${i + 2} of ${items.length}`}
              >
                <SmartImage
                  src={img.src}
                  alt=""
                  sizes="(min-width: 640px) 25vw, 25vw"
                  className="transition duration-700 ease-luxe group-hover:scale-105"
                />
                {i === thumbs.length - 1 && items.length > thumbs.length + 1 ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-navy-950/60 font-semibold text-ivory-100">
                    +{items.length - thumbs.length - 1}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Lightbox images={items} index={index} onClose={() => setIndex(null)} onIndexChange={setIndex} />
    </>
  );
}
