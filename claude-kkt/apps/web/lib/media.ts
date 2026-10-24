/**
 * Media URL helpers. The API serves immutable image bytes at /api/v1/public/media/:id[?variant=thumb|medium].
 * Payloads may carry absolute URLs or API-relative paths; everything is resolved against the public API origin
 * so the browser (and the Next.js image optimizer) can reach it.
 */

export type MediaVariant = "thumb" | "medium" | "original";

export function resolveMediaUrl(url: string | null | undefined, apiUrl: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${apiUrl}${url}`;
  return `${apiUrl}/${url}`;
}

export function withVariant(url: string | null, variant: MediaVariant): string | null {
  if (!url || variant === "original") return url;
  if (!/\/api\/v1\/public\/media\//.test(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("variant", variant);
    return u.toString();
  } catch {
    return url;
  }
}

/** Builds a sizes attribute for common grid layouts. */
export const SIZES = {
  full: "100vw",
  half: "(min-width: 1024px) 50vw, 100vw",
  third: "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  quarter: "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw",
  card: "(min-width: 1280px) 400px, (min-width: 768px) 50vw, 100vw",
} as const;

/** Simple luxury gradient placeholder used when a project has no image yet. */
export const PLACEHOLDER_GRADIENT =
  "linear-gradient(135deg, #0b1f3a 0%, #152849 45%, #2f477a 75%, #c9a227 140%)";

export type VideoProvider = "youtube" | "vimeo" | "generic";

export interface EmbedInfo {
  provider: VideoProvider;
  embedUrl: string;
  posterUrl: string | null;
  title: string;
}

/** Converts a share URL into a privacy-friendly embed URL plus a poster, without loading any player code. */
export function parseVideoUrl(raw: string): EmbedInfo | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
    else if (url.pathname.startsWith("/watch")) id = url.searchParams.get("v");
    else if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/"))
      id = url.pathname.split("/")[2] ?? null;
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    return {
      provider: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
      posterUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      title: "YouTube video",
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.split("/").filter(Boolean).find((seg) => /^\d{5,}$/.test(seg));
    if (!id) return null;
    return {
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1`,
      posterUrl: null,
      title: "Vimeo video",
    };
  }

  return { provider: "generic", embedUrl: url.toString(), posterUrl: null, title: "Embedded media" };
}

/** Accepts only https embed URLs for maps / 360° tours. */
export function safeEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
