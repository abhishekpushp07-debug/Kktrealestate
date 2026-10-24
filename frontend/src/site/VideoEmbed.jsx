import { useState } from "react";
import { ExternalLink } from "lucide-react";

export function VideoEmbed({ src, title = "Video", testId }) {
  const [failed, setFailed] = useState(false);
  const watch = src.replace("/embed/", "/watch?v=").split("?")[0] + (src.includes("/embed/") ? "" : "");
  if (failed) return <a href={watch} target="_blank" rel="noreferrer" className="flex aspect-video items-center justify-center gap-2 rounded-2xl bg-navy text-sm font-semibold text-gold" data-testid={`${testId || "video"}-fallback`}><ExternalLink className="h-4 w-4" />Watch on YouTube</a>;
  return (
    <div className="group relative aspect-video overflow-hidden rounded-2xl shadow-lg" data-testid={testId}>
      <iframe src={src} title={title} loading="lazy" allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full" onError={() => setFailed(true)} />
      <a href={watch} target="_blank" rel="noreferrer" className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-navy/80 px-3 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"><ExternalLink className="h-3 w-3" />Watch on YouTube</a>
    </div>
  );
}
