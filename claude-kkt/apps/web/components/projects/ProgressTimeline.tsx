"use client";

import { useState } from "react";

import { Lightbox, type LightboxImage } from "@/components/ui/Lightbox";
import { SmartImage } from "@/components/ui/SmartImage";
import { CheckIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/format";
import type { ConstructionProgress } from "@/lib/types";

/** Stage timeline per tower with website-flagged photos; photos open in a lightbox. */
export function ProgressTimeline({ progress }: { progress: ConstructionProgress }) {
  const blocks = progress.blocks.filter((b) => b.stages.length);
  const [activeBlock, setActiveBlock] = useState(0);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const block = blocks[activeBlock];
  if (!block) return null;

  return (
    <div>
      {blocks.length > 1 ? (
        <div role="tablist" aria-label="Towers" className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {blocks.map((b, i) => (
            <button key={b.name} type="button" role="tab" aria-selected={i === activeBlock} onClick={() => setActiveBlock(i)} className={`tap shrink-0 rounded-full border px-5 text-sm font-semibold transition ${i === activeBlock ? "border-navy-900 bg-navy-900 text-ivory-100" : "border-navy-900/15 bg-white text-navy-900 hover:border-gold-500"}`}>
              {b.name} <span className="ml-1 font-normal opacity-70">{Math.round(b.percent)}%</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-6 rounded-card border border-line bg-white p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-2xl text-navy-900">{block.name}</h3>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-navy-900">{Math.round(block.percent)}%</span> complete
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-ivory-200" role="progressbar" aria-valuenow={Math.round(block.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${block.name} construction progress`}>
          <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400 transition-[width] duration-1000" style={{ width: `${Math.min(100, Math.max(0, block.percent))}%` }} />
        </div>

        <ol className="mt-8 space-y-0">
          {block.stages.map((stage, i) => {
            const done = stage.status === "COMPLETED";
            const now = stage.status === "IN_PROGRESS";
            const images: LightboxImage[] = stage.photos.map((p, j) => ({ src: p.url, alt: p.alt || `${stage.name} photo ${j + 1}`, caption: p.caption ?? (p.taken_on ? formatDate(p.taken_on) : null) }));
            return (
              <li key={`${stage.name}-${i}`} className="relative grid grid-cols-[2rem_1fr] gap-4 pb-8 last:pb-0">
                {i < block.stages.length - 1 ? <span aria-hidden className={`absolute left-[0.95rem] top-8 bottom-0 w-px ${done ? "bg-gold-500" : "bg-line"}`} /> : null}
                <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${done ? "border-gold-500 bg-gold-500 text-navy-950" : now ? "border-gold-500 bg-white text-gold-600" : "border-line bg-white text-ink-soft"}`} aria-hidden>
                  {done ? <CheckIcon size={16} /> : <span className={`h-2.5 w-2.5 rounded-full ${now ? "bg-gold-500 animate-pulse" : "bg-line"}`} />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h4 className={`font-semibold ${done || now ? "text-navy-900" : "text-ink-soft"}`}>{stage.name}</h4>
                    <p className="text-sm text-ink-muted">
                      {done ? `Completed ${formatDate(stage.completed_on)}` : now ? `In progress${stage.started_on ? ` since ${formatDate(stage.started_on)}` : ""}` : "Upcoming"}
                    </p>
                  </div>
                  {images.length ? (
                    <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                      {images.slice(0, 6).map((img, j) => (
                        <li key={img.src}>
                          <button type="button" onClick={() => setLightbox({ images, index: j })} className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-navy-900" aria-label={`View ${img.alt}`}>
                            <SmartImage src={img.src} alt="" sizes="(min-width: 1024px) 12vw, 33vw" className="transition duration-500 group-hover:scale-105" />
                            {j === 5 && images.length > 6 ? <span className="absolute inset-0 flex items-center justify-center bg-navy-950/60 text-sm font-semibold text-ivory-100">+{images.length - 6}</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <Lightbox images={lightbox?.images ?? []} index={lightbox ? lightbox.index : null} onClose={() => setLightbox(null)} onIndexChange={(index) => setLightbox((l) => (l ? { ...l, index } : l))} />
    </div>
  );
}
