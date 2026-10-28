import { useEffect, useRef, useState, useCallback } from "react";
import { Download, Trash2, Lock, FileText } from "lucide-react";
import api, { errMsg } from "../../lib/api";
import { toast } from "sonner";

const API = process.env.REACT_APP_BACKEND_URL;
const fmt = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

function LazyThumb({ f, onOpen }) {
  const ref = useRef();
  const [seen, setSeen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  const v = f.variants || {};
  return (
    <button type="button" ref={ref} onClick={() => onOpen(f)} className="group relative aspect-square overflow-hidden rounded-lg bg-ink-100" data-testid={`gallery-thumb-${f.id}`} data-variants={f.variants_state}>
      {seen && v.thumb && <img src={`${API}${v.thumb}`} alt={f.caption || f.filename} loading="lazy" onLoad={() => setLoaded(true)} className={`h-full w-full object-cover transition-[filter,opacity] duration-500 ${loaded ? "blur-0 opacity-100" : "blur-md opacity-70"}`} />}
      {!v.thumb && <div className="flex h-full items-center justify-center text-xs text-txt-muted">{f.variants_state === "failed" ? "Unreadable image" : f.is_image ? "Processing…" : <FileText className="h-6 w-6" />}</div>}
      {f.legal_hold && <Lock className="absolute right-1 top-1 h-3.5 w-3.5 text-amber-600" />}
    </button>
  );
}

function DocList({ docs, canEdit, download, hold, remove }) {
  return (
    <ul className="mt-3 divide-y rounded-lg border" data-testid="file-list">
      {docs.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`file-row-${f.id}`}>
          <FileText className="h-4 w-4 text-txt-muted" /><span className="flex-1 truncate">{f.filename}</span><span className="text-xs text-txt-muted">{fmt(f.size)}</span>
          {f.legal_hold && <Lock className="h-3.5 w-3.5 text-amber-600" />}
          <button type="button" onClick={() => download(f)} className="text-gold" data-testid={`file-download-${f.id}`}><Download className="h-4 w-4" /></button>
          {canEdit && <button type="button" onClick={() => hold(f)} className="text-xs" data-testid={`file-hold-${f.id}`}>{f.legal_hold ? "Release hold" : "Legal hold"}</button>}
          {canEdit && <button type="button" onClick={() => remove(f)} className="text-red-600" data-testid={`file-delete-${f.id}`}><Trash2 className="h-4 w-4" /></button>}
        </li>
      ))}
    </ul>
  );
}

function Lightbox({ open, setOpen, large, setLarge, canEdit, download, hold, remove }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setOpen(null)} data-testid="gallery-lightbox">
      <div className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        {open.variants?.medium && <img src={`${API}${large ? open.variants.large : open.variants.medium}`} alt={open.caption || open.filename} className="max-h-[80vh] rounded-lg object-contain" data-testid="gallery-lightbox-img" data-size={large ? "large" : "medium"} />}
        <div className="mt-2 flex items-center gap-3 text-xs text-white">
          <span className="flex-1 truncate">{open.caption || open.filename} · {fmt(open.size)}</span>
          {open.variants?.large && <button type="button" onClick={() => setLarge(true)} className="underline" data-testid="gallery-open-large">Open large (2048)</button>}
          <button type="button" onClick={() => download(open)} className="underline" data-testid="gallery-download-original">Download original</button>
          {canEdit && <button type="button" onClick={() => { hold(open); setOpen(null); }} className="underline" data-testid="gallery-toggle-hold">{open.legal_hold ? "Release hold" : "Legal hold"}</button>}
          {canEdit && <button type="button" onClick={() => { remove(open); setOpen(null); }} className="text-red-300 underline" data-testid="gallery-delete">Delete</button>}
        </div>
      </div>
    </div>
  );
}

export function FileGallery({ query, canEdit, columns = 6, pageSize = 60, refreshKey }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [open, setOpen] = useState(null);
  const [large, setLarge] = useState(false);
  const queryKey = JSON.stringify(query);
  const cursorRef = useRef(null);
  cursorRef.current = cursor;
  const load = useCallback(async (reset) => {
    try {
      const r = await api.get("/files", { params: { ...JSON.parse(queryKey), limit: pageSize, cursor: reset ? undefined : cursorRef.current } });
      setItems((prev) => (reset ? r.data.items : [...prev, ...r.data.items]));
      setCursor(r.data.next_cursor);
    } catch (e) { toast.error(errMsg(e)); }
  }, [queryKey, pageSize]);
  useEffect(() => { load(true); }, [load, refreshKey]);
  useEffect(() => {
    if (!items.some((f) => f.is_image && f.variants_state === "pending")) return;
    const t = setTimeout(() => load(true), 2000);
    return () => clearTimeout(t);
  }, [items, load]);
  const download = async (f) => { const r = await api.get(`/files/${f.id}/url`); window.open(`${API}${r.data.url}`, "_blank"); };
  const remove = async (f) => { if (!window.confirm("Delete file?")) return; try { await api.delete(`/files/${f.id}`); load(true); } catch (e) { toast.error(errMsg(e)); } };
  const hold = async (f) => { try { await api.patch(`/files/${f.id}`, { legal_hold: !f.legal_hold }); load(true); } catch (e) { toast.error(errMsg(e)); } };
  const images = items.filter((f) => f.is_image);
  const docs = items.filter((f) => !f.is_image);
  const actions = { canEdit, download, hold, remove };
  return (
    <div data-testid="file-gallery" data-count={items.length}>
      {images.length > 0 && <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{images.map((f) => <LazyThumb key={f.id} f={f} onOpen={(x) => { setOpen(x); setLarge(false); }} />)}</div>}
      {docs.length > 0 && <DocList docs={docs} {...actions} />}
      {items.length === 0 && <p className="text-sm text-txt-muted" data-testid="file-gallery-empty">No files yet.</p>}
      {cursor && <button type="button" className="btn-secondary mt-3 h-8 text-xs" onClick={() => load(false)} data-testid="file-gallery-more">Load more</button>}
      {open && <Lightbox open={open} setOpen={setOpen} large={large} setLarge={setLarge} {...actions} />}
    </div>
  );
}
