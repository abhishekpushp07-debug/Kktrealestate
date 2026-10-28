import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Route, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";

const fmtVal = (v) => (v && typeof v === "object" ? Object.entries(v).filter(([k]) => !k.endsWith("_paise")).map(([k, x]) => `${k}: ${typeof x === "number" ? x.toLocaleString("en-IN") : Array.isArray(x) ? x.length : String(x ?? "—")}`).join(" · ") : String(v ?? "—"));

const fmtV = (k, v) => (v == null ? "—" : typeof v === "number" ? (k.endsWith("_paise") ? "₹" + (v / 100).toLocaleString("en-IN") : v.toLocaleString("en-IN")) : String(v));
function BeforeAfter({ rows }) {
  const changed = rows.filter((r) => r.changed);
  const show = changed.length ? changed : rows.slice(0, 4);
  return (
    <table className="mt-1 w-full text-[11px]" data-testid="journey-before-after"><tbody>
      {show.map((r) => <tr key={r.field} className={r.changed ? "text-ink-950" : "text-txt-muted"}><td className="pr-2 font-mono">{r.field.replace(/_paise$/, "")}</td><td className="pr-1 text-right font-mono">{fmtV(r.field, r.before)}</td><td className="px-1 text-txt-muted">→</td><td className={`text-right font-mono ${r.changed ? "font-semibold" : ""}`}>{fmtV(r.field, r.after)}</td></tr>)}
      {changed.length === 0 && <tr><td colSpan={4} className="text-txt-muted">unchanged by this entry</td></tr>}
    </tbody></table>
  );
}

function Detail({ d }) {
  if (!d) return null;
  return (
    <div className="mt-1 text-xs text-txt-secondary">
      <p>{d.label}</p>
      {d.now && <p className="mt-0.5 break-words font-mono text-[11px]">{fmtVal(d.now)}</p>}
      {d.before !== undefined && <p className="mt-0.5 font-mono text-[11px]">before: {String(d.before)} → now: {fmtVal(d.now)}</p>}
      {d.rows?.length > 0 && <ul className="mt-1 space-y-0.5 font-mono text-[11px]">{d.rows.slice(0, 6).map((r) => <li key={fmtVal(r)} className="truncate">{fmtVal(r)}</li>)}</ul>}
    </div>
  );
}

export function JourneyPanel({ entityType, entityId, open, onOpenChange, initialAuditId }) {
  const [entries, setEntries] = useState([]);
  const [sel, setSel] = useState(initialAuditId || null);
  const [j, setJ] = useState(null);
  useEffect(() => { if (!open || !entityId) return; api.get(`/journey/entity/${entityType}/${entityId}`).then((r) => { setEntries(r.data.items); setSel((cur) => cur || r.data.items[0]?.id || cur); }).catch(() => setEntries([])); }, [open, entityType, entityId]);
  useEffect(() => { if (!sel) return; setJ(null); api.get(`/journey/${sel}`).then((r) => setJ(r.data)).catch(() => setJ(null)); }, [sel]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="journey-panel">
        <SheetHeader><SheetTitle className="flex items-center gap-2"><Route className="h-5 w-5" strokeWidth={1.75} />Where did this go?</SheetTitle><SheetDescription>Every surface this entry touched, from the outbox. Click a surface to open it.</SheetDescription></SheetHeader>
        <div className="mt-4 flex flex-wrap gap-1.5" data-testid="journey-entries">
          {entries.map((e) => <button key={e.id} onClick={() => setSel(e.id)} className={`pill ${sel === e.id ? "bg-ink-950 text-warm-50" : "bg-warm-100 text-ink-950"}`} data-testid={`journey-entry-${e.action}`}>{e.action} · {fmtDateTime(e.created_at)}</button>)}
          {entries.length === 0 && <p className="text-sm text-txt-muted">No entries recorded yet.</p>}
        </div>
        {j && (
          <div className="mt-5">
            <div className="rounded-xl bg-warm-50 p-3 text-xs" data-testid="journey-entry-meta">
              <p className="font-semibold text-ink-950">{j.entry.action} <span className="font-normal text-txt-muted">by {j.entry.actor_name} · {fmtDateTime(j.entry.created_at)}</span></p>
              <p className="mt-1 flex items-center gap-1">{j.entry.propagated_complete ? <CheckCircle2 className="h-3.5 w-3.5 text-sage" /> : <AlertTriangle className="h-3.5 w-3.5 text-brick" />}{Object.keys(j.entry.propagated || {}).length} propagation handlers · <span data-testid="journey-surface-count">{j.surfaces_total} surfaces</span> · <span data-testid="journey-ba-count">{j.with_before_after} with before→after</span></p>
            </div>
            <ul className="mt-4 divide-y divide-warm-100" data-testid="journey-surfaces">
              {j.surfaces.map((s) => (
                <li key={s.surface} className="py-2.5" data-testid={`journey-surface-${s.surface}`}>
                  <Link to={s.link} onClick={() => onOpenChange(false)} className="flex items-center justify-between gap-2 text-sm font-medium text-ink-950 hover:text-gold">
                    <span className="capitalize">{s.surface.replace("360", " 360")}</span><span className="flex items-center gap-1 text-xs text-txt-muted">{s.caches.length > 0 && `${s.caches.length} cache${s.caches.length > 1 ? "s" : ""} refreshed`}<ChevronRight className="h-4 w-4" /></span>
                  </Link>
                  {s.before_after ? <BeforeAfter rows={s.before_after} /> : s.done ? <p className="mt-1 text-xs text-txt-secondary" data-testid="journey-done">{s.done}</p> : null}
                  {!s.before_after && <Detail d={s.detail} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function JourneyButton({ entityType, entityId, size = "sm", className = "", label = "Where did this go?" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="ghost" className={className} onClick={() => setOpen(true)} data-testid={`journey-btn-${entityType}`}><Route className="h-4 w-4" strokeWidth={1.75} />{label}</Button>
      {open && <JourneyPanel entityType={entityType} entityId={entityId} open={open} onOpenChange={setOpen} />}
    </>
  );
}
