import { useState } from "react";
import { ExternalLink, Play } from "lucide-react";

const ytId = (src) => (src.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/) || [])[1];
const vimeoId = (src) => (src.match(/vimeo\.com\/(?:video\/)?(\d+)/) || [])[1];

/* Click-to-load facade: poster + play button, player iframe only after click (no third-party JS on first paint). */
export function VideoEmbed({ src, title = "Video", poster, testId, className = "" }) {
  const [play, setPlay] = useState(false);
  const yt = ytId(src), vm = vimeoId(src);
  const thumb = poster || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null);
  const embed = yt ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&modestbranding=1` : vm ? `https://player.vimeo.com/video/${vm}?autoplay=1` : src;
  const watch = yt ? `https://www.youtube.com/watch?v=${yt}` : src;
  return (
    <div className={`group relative aspect-video overflow-hidden rounded-2xl bg-navy shadow-lg ${className}`} data-testid={testId}>
      {play ? <iframe src={embed} title={title} allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full" />
        : <button type="button" onClick={() => setPlay(true)} className="absolute inset-0 h-full w-full text-left" aria-label={`Play ${title}`} data-testid={`${testId || "video"}-play`}>
          {thumb && <img src={thumb} alt="" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" width="1280" height="720" loading="lazy" decoding="async" />}
          <span className="absolute inset-0 bg-gradient-to-t from-navy/70 via-navy/10 to-transparent" />
          <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-gold text-navy shadow-xl transition-transform group-hover:scale-110 sm:h-20 sm:w-20"><Play className="ml-1 h-7 w-7 fill-current" /></span></span>
          <span className="absolute bottom-4 left-5 text-sm font-semibold text-white/90">{title}</span>
        </button>}
      <a href={watch} target="_blank" rel="noreferrer" className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-navy/80 px-3 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><ExternalLink className="h-3 w-3" />Open</a>
    </div>
  );
}

/* Google Maps facade: static-looking placeholder, iframe loads on click. */
export function MapEmbed({ src, title = "Map", address, testId }) {
  const [load, setLoad] = useState(false);
  return <div className="aspect-[4/3] overflow-hidden rounded-3xl">{load ? <iframe src={src} title={title} loading="lazy" className="h-full w-full border-0" data-testid={testId} /> : <button type="button" onClick={() => setLoad(true)} className="relative flex h-full w-full flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,#e9eef5,#d6dee9)] text-navy" data-testid={testId || "map-facade"}><span className="rounded-full bg-navy px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white">Load interactive map</span>{address && <span className="max-w-xs px-6 text-center text-xs text-slate-600">{address}</span>}</button>}</div>;
}
