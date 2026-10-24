"use client";

import Image from "next/image";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { PLACEHOLDER_GRADIENT, resolveMediaUrl } from "@/lib/media";

/** Build-time list from next.config.ts (`env.NEXT_PUBLIC_IMAGE_ORIGINS`), inlined into both bundles. */
const OPTIMIZER_ORIGINS: string[] = (process.env.NEXT_PUBLIC_IMAGE_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

interface SmartImageProps {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  className?: string;
  /** Wrapper classes when using fill mode. */
  wrapperClassName?: string;
  priority?: boolean;
  fill?: boolean;
  width?: number;
  height?: number;
  quality?: number;
  objectPosition?: string;
  draggable?: boolean;
}

/**
 * next/image with media-URL resolution. API media is optimised through the Next.js image pipeline;
 * images on origins the optimizer does not know are rendered unoptimised so an unexpected host can
 * never break the page at runtime.
 * A missing source renders a navy-gold gradient instead of a broken image.
 */
export function SmartImage({
  src,
  alt,
  sizes = "100vw",
  className = "",
  wrapperClassName = "",
  priority = false,
  fill = true,
  width,
  height,
  quality = 78,
  objectPosition,
  draggable = false,
}: SmartImageProps) {
  const { apiUrl } = useSiteConfig();
  const resolved = resolveMediaUrl(src, apiUrl);

  if (!resolved) {
    return (
      <div
        role="img"
        aria-label={alt || undefined}
        className={`${fill ? "absolute inset-0" : ""} ${wrapperClassName}`.trim()}
        style={{ backgroundImage: PLACEHOLDER_GRADIENT }}
      />
    );
  }

  // Only origins baked into images.remotePatterns at build time may go through /_next/image.
  let unoptimized = true;
  try {
    const origin = new URL(resolved).origin;
    unoptimized = !OPTIMIZER_ORIGINS.includes(origin);
  } catch {
    unoptimized = true;
  }

  const common = {
    src: resolved,
    alt,
    sizes,
    priority,
    quality,
    unoptimized,
    draggable,
    className: `${fill ? "object-cover" : ""} ${className}`.trim(),
    style: objectPosition ? { objectPosition } : undefined,
  };

  if (fill) {
    return (
      <span className={`absolute inset-0 block overflow-hidden ${wrapperClassName}`.trim()}>
        <Image {...common} fill loading={priority ? "eager" : "lazy"} />
      </span>
    );
  }
  return <Image {...common} width={width ?? 1200} height={height ?? 800} loading={priority ? "eager" : "lazy"} />;
}
