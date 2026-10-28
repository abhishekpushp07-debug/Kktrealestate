import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, RotateCcw, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { cn } from "@/lib/utils";

export const SIZE_CLASS = { S: "xl:col-span-2", M: "xl:col-span-3", L: "xl:col-span-6" };

/** Customize bar for the Home widget grid: toggle, size S/M/L, drag or keyboard reorder, Reset. Persists via PUT/DELETE /me/home-layout. */
export function HomeCustomize({ layout, onChange, onSaved, onClose }) {
  const [drag, setDrag] = useState(null);
  const [busy, setBusy] = useState(false);
  const labels = Object.fromEntries(layout.available.map((a) => [a.id, a.label]));
  const ws = layout.widgets;
  const set = (widgets) => onChange({ ...layout, widgets });
  const move = (from, to) => { if (to < 0 || to >= ws.length) return; const a = [...ws]; const [w] = a.splice(from, 1); a.splice(to, 0, w); set(a); };
  const save = async () => {
    setBusy(true);
    try { const r = await api.put("/me/home-layout", { widgets: ws.map(({ id, size, visible }) => ({ id, size, visible })), version: layout.version }); onSaved(r.data); toast.success("Home layout saved"); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const reset = async () => { setBusy(true); try { const r = await api.delete("/me/home-layout"); onSaved(r.data); toast.success("Home reset to default"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <div className="rounded-2xl border border-gold/40 bg-gold-light/30 p-4" data-testid="home-customize">
      <div className="flex items-center justify-between"><p className="flex items-center gap-2 font-semibold"><Settings2 className="h-4 w-4 text-gold" />Customize Home</p>
        <div className="flex gap-2"><button className="btn btn-secondary btn-sm" onClick={reset} disabled={busy} data-testid="home-reset"><RotateCcw className="h-3.5 w-3.5" />Reset to default</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy} data-testid="home-save-layout">Save</button><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close" data-testid="home-customize-close"><X className="h-4 w-4" /></button></div></div>
      <ul className="mt-3 grid gap-1.5 md:grid-cols-2" data-testid="home-widget-list">
        {ws.map((w, i) => (
          <li key={w.id} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag != null && drag !== i) move(drag, i); setDrag(null); }}
              className={cn("flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm", drag === i ? "border-gold" : "border-warm-200", !w.visible && "opacity-60")} data-testid={`home-widget-${w.id}`}>
            <GripVertical className="h-4 w-4 cursor-grab text-txt-muted" />
            <span className="flex-1 font-medium">{labels[w.id] || w.id}</span>
            <div className="flex rounded-lg border border-warm-200" role="radiogroup" aria-label="Size">{["S", "M", "L"].map((s) => <button key={s} role="radio" aria-checked={w.size === s} onClick={() => set(ws.map((x) => (x.id === w.id ? { ...x, size: s } : x)))} className={cn("px-2 py-0.5 text-xs", w.size === s ? "bg-ink-950 text-white" : "text-txt-secondary")} data-testid={`home-size-${w.id}-${s}`}>{s}</button>)}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => move(i, i - 1)} aria-label="Move up" data-testid={`home-up-${w.id}`}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button className="btn btn-ghost btn-sm" onClick={() => move(i, i + 1)} aria-label="Move down" data-testid={`home-down-${w.id}`}><ArrowDown className="h-3.5 w-3.5" /></button>
            <button className="btn btn-ghost btn-sm" onClick={() => set(ws.map((x) => (x.id === w.id ? { ...x, visible: !x.visible } : x)))} aria-label={w.visible ? "Hide" : "Show"} aria-pressed={w.visible} data-testid={`home-toggle-${w.id}`}>{w.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
          </li>))}
      </ul>
    </div>
  );
}
