import { useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function WhereUsedButton({ path, label = "Where used", testId = "where-used-btn" }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const load = async () => { try { const r = await api.get(path); setData(r.data); setOpen(true); } catch (e) { toast.error(errMsg(e)); } };
  return (<>
    <Button size="sm" variant="outline" onClick={load} data-testid={testId}><Link2 className="mr-1 h-3.5 w-3.5" />{label}{data ? ` (${data.count})` : ""}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent data-testid="where-used-dialog"><DialogHeader><DialogTitle>Where used · {data?.count ?? 0} reference(s)</DialogTitle></DialogHeader>
      {data && <div className="space-y-2 text-sm">
        {data.active_bookings > 0 && <p className="rounded-md bg-amber2-50 px-3 py-2 text-xs text-amber2" data-testid="where-used-bookings">{data.active_bookings} active booking(s) carry this in their plan snapshot.</p>}
        {data.references.length === 0 && !data.active_bookings && <p className="text-txt-secondary">Not referenced anywhere — safe to deactivate.</p>}
        <ul className="divide-y rounded-md border">{data.references.map((r, i) => <li key={r.id || `${r.type}-${r.label}`} className="flex items-center justify-between px-3 py-2" data-testid={`where-used-ref-${i}`}><span>{r.label}</span><span className="rounded-full bg-warm-50 px-2 py-0.5 text-[10px] font-bold uppercase text-txt-secondary">{r.type.replace("_", " ")}</span></li>)}</ul>
      </div>}
    </DialogContent></Dialog>
  </>);
}
