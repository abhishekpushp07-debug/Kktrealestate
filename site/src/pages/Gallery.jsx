import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { usePublic, Seo, Reveal, Img, imgUrl } from "../SiteShell";

export default function Gallery() {
  const { data } = usePublic("/gallery");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState(null);
  const items = (data?.items || []).filter((i) => i.image_url && /\.(jpe?g|png|webp|avif|gif)(\?|$)|unsplash|\/api\/public\/media/i.test(i.image_url)).filter((i) => !cat || i.category === cat);
  const close = () => setOpen(null);
  const step = (d) => { const k = items.indexOf(open); setOpen(items[(k + d + items.length) % items.length]); };
  useEffect(() => { if (!open) return; const h = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); });
  return (
    <>
      <Seo title="Gallery" description="Photographs of Shree Ganesh Builders projects — exteriors, interiors, amenities and construction progress." />
      <section className="bg-navy pb-20 pt-40"><div className="container-site"><Reveal><p className="eyebrow">Gallery</p><h1 className="display mt-4 text-5xl text-white sm:text-6xl lg:text-7xl">Moments & milestones</h1><div className="hairline mt-6" /></Reveal></div></section>
      <section className="py-16"><div className="container-site">
        <div className="mb-10 flex flex-wrap gap-2" data-testid="gallery-filters">{["", ...(data?.categories || [])].map((c) => <button key={c} onClick={() => setCat(c)} className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${cat === c ? "bg-navy text-white" : "bg-white text-navy hover:bg-gold/30"}`} data-testid={`gallery-cat-${c || "all"}`}>{c || "All"}</button>)}</div>
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4" data-testid="gallery-grid">{items.map((g, k) => <Reveal key={g.image_url + k}><figure className="card-lux cursor-pointer" onClick={() => setOpen(g)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(g)} aria-label={`Open ${g.caption || "photo"}`} data-testid={`gallery-item-${k}`}><Img src={g.image_url} alt={g.caption || g.project?.name || "Gallery photo"} className="w-full" width="800" height="600" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px" /><figcaption className="flex items-center justify-between p-4 text-xs"><span className="font-semibold text-navy">{g.caption}</span><span className="text-slate-500">{g.project?.name}</span></figcaption></figure></Reveal>)}</div>
      </div></section>
      {open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/95 p-4" onClick={close} role="dialog" aria-modal="true" aria-label={open.caption || "Photo"} data-testid="lightbox"><button className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close" data-testid="lightbox-close"><X /></button>{items.length > 1 && <><button onClick={(e) => { e.stopPropagation(); step(-1); }} className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Previous" data-testid="lightbox-prev"><ChevronLeft /></button><button onClick={(e) => { e.stopPropagation(); step(1); }} className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Next" data-testid="lightbox-next"><ChevronRight /></button></>}<img src={imgUrl(open.image_url, 1600)} alt={open.caption || ""} className="max-h-[85vh] max-w-full rounded-xl" onClick={(e) => e.stopPropagation()} /><p className="absolute bottom-6 text-sm text-white/85">{open.caption}</p></div>}
    </>
  );
}
