import { useState } from "react";
import { X } from "lucide-react";
import { usePublic, Seo, Reveal, Img } from "../SiteShell";

export default function Gallery() {
  const { data } = usePublic("/gallery");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState(null);
  const items = (data?.items || []).filter((i) => !cat || i.category === cat);
  return (
    <>
      <Seo title="Gallery" description="Photographs of Shree Ganesh Builders projects — exteriors, interiors, amenities and construction progress." />
      <section className="bg-navy pb-20 pt-40"><div className="container-site"><Reveal><p className="eyebrow">Gallery</p><h1 className="display mt-4 text-5xl text-white sm:text-6xl lg:text-7xl">Moments & milestones</h1><div className="hairline mt-6" /></Reveal></div></section>
      <section className="py-16"><div className="container-site">
        <div className="mb-10 flex flex-wrap gap-2" data-testid="gallery-filters">{["", ...(data?.categories || [])].map((c) => <button key={c} onClick={() => setCat(c)} className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${cat === c ? "bg-navy text-white" : "bg-white text-navy hover:bg-gold/30"}`} data-testid={`gallery-cat-${c || "all"}`}>{c || "All"}</button>)}</div>
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4" data-testid="gallery-grid">{items.map((g, k) => <Reveal key={g.image_url + k}><figure className="card-lux cursor-pointer" onClick={() => setOpen(g)}><Img src={g.image_url} alt={g.caption || ""} className="w-full" width="800" height="600" /><figcaption className="flex items-center justify-between p-4 text-xs"><span className="font-semibold text-navy">{g.caption}</span><span className="text-slate-500">{g.project?.name}</span></figcaption></figure></Reveal>)}</div>
      </div></section>
      {open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/95 p-4" onClick={() => setOpen(null)} data-testid="lightbox"><button className="absolute right-6 top-6 text-white" aria-label="Close"><X /></button><img src={open.image_url} alt={open.caption || ""} className="max-h-[85vh] max-w-full rounded-xl" /><p className="absolute bottom-6 text-sm text-white/80">{open.caption}</p></div>}
    </>
  );
}
