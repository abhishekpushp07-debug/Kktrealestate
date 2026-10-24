"use client";

import { useId, useState } from "react";

import { MapPinIcon, PlayIcon, CubeIcon } from "@/components/ui/icons";
import { parseVideoUrl, safeEmbedUrl } from "@/lib/media";

type Kind = "video" | "tour" | "map";

interface ClickToLoadEmbedProps {
  url: string;
  kind?: Kind;
  title: string;
  /** Optional poster image (absolute URL). YouTube posters are derived automatically. */
  poster?: string | null;
  className?: string;
}

/**
 * Renders a poster with a play/open button; the third-party iframe (and its player code) is injected
 * only after the visitor clicks. Supports YouTube, Vimeo and generic https embeds (maps, 360° tours).
 */
export function ClickToLoadEmbed({ url, kind = "video", title, poster, className = "" }: ClickToLoadEmbedProps) {
  const [loaded, setLoaded] = useState(false);
  const labelId = useId();

  const video = kind === "video" ? parseVideoUrl(url) : null;
  const embedUrl = video ? video.embedUrl : safeEmbedUrl(url);
  if (!embedUrl) return null;
  const posterUrl = poster ?? video?.posterUrl ?? null;

  const Icon = kind === "map" ? MapPinIcon : kind === "tour" ? CubeIcon : PlayIcon;
  const cta = kind === "map" ? "Load map" : kind === "tour" ? "Start 360° tour" : "Play video";

  return (
    <div className={`relative aspect-video w-full overflow-hidden rounded-card bg-navy-900 shadow-card ${className}`.trim()}>
      {loaded ? (
        <iframe
          src={embedUrl}
          title={title}
          className="absolute inset-0 h-full w-full"
          loading="eager"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms"
        />
      ) : (
        <button
          type="button"
          onClick={() => setLoaded(true)}
          className="group absolute inset-0 flex h-full w-full items-center justify-center text-ivory-100"
          aria-labelledby={labelId}
        >
          {posterUrl ? (
            // Plain <img>: a third-party thumbnail host is not part of the image optimiser's allow-list.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-700 group-hover:scale-[1.03] group-hover:opacity-90" />
          ) : (
            <span
              aria-hidden
              className="absolute inset-0"
              style={{ backgroundImage: "radial-gradient(ellipse at 30% 20%, #2f477a 0%, #0b1f3a 55%, #06142a 100%)" }}
            />
          )}
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-navy-950/70 via-transparent to-transparent" />
          <span className="relative flex flex-col items-center gap-4">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gold-500 text-navy-950 shadow-float transition duration-300 group-hover:scale-105">
              <Icon size={30} />
            </span>
            <span id={labelId} className="rounded-full bg-navy-950/60 px-4 py-2 text-sm font-semibold tracking-wide backdrop-blur">
              {cta}: {title}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
