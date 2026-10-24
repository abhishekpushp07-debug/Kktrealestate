import { useState } from "react";
import { CheckCircle2, Circle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "./Bits";
import { inr, fmtDate } from "@/lib/format";

export function MilestonesPanel({ blockId, onChanged }) {
  const { can } = useAuth();
  const { data, reload } = useFetch(`/blocks/${blockId}/milestones`, [blockId]);
  const [dlg, setDlg] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  if (!data) return null;
  const run = async (path, body, msg) => { try { const r = await api.post(path, body); toast.success(typeof msg === "function" ? msg(r.data) : msg); setDlg(null); reload(); onChanged?.(); } catch (e) { toast.error(errMsg(e), { duration: 8000 }); } };
  const latestDone = [...data.milestones].reverse().find((m) => m.status === "Completed");
  return (
    <div className="card-elev p-5" data-testid="milestones-panel">
      <div className="mb-4 flex items-center justify-between"><div><h3 className="text-base font-bold text-navy">Construction milestones</h3><p className="text-xs text-slate-500">{data.block.construction_percent}% complete · {data.active_bookings} active booking(s) receive demands on completion</p></div></div>
      <ol className="relative ml-3 border-l-2 border-slate-200">
        {data.milestones.map((m) => {
          const done = m.status === "Completed";
          const isNext = m.seq === data.next_seq;
          return <li key={m.seq} className="mb-5 ml-5" data-testid={`milestone-${m.seq}`}>
            <span className={`absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-emerald-500 text-white" : isNext ? "bg-gold text-navy" : "bg-slate-200 text-slate-500"}`}>{done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}</span>
            <div className="flex flex-wrap items-center gap-3">
              <p className={`text-sm font-semibold ${done ? "text-navy" : "text-slate-600"}`}>{m.seq}. {m.name} <span className="ml-1 rounded bg-surface px-1.5 py-0.5 text-[10px] tabular">{m.cumulative_percent}%</span></p>
              {done && <span className="text-xs text-slate-500">{fmtDate(m.completed_on)} · {m.completed_by_name}</span>}
              {m.demands?.count > 0 && <span className="text-xs text-slate-500">{m.demands.count} demand(s) · {inr(m.demands.total)} raised · {inr(m.demands.paid)} paid</span>}
              <span className="ml-auto flex gap-1">
                {isNext && can("milestone.update") && <Button size="sm" className="bg-navy hover:bg-navy-700" onClick={() => setDlg({ kind: "complete", m })} data-testid={`milestone-complete-${m.seq}`}>Mark complete</Button>}
                {done && latestDone?.seq === m.seq && can("milestone.undo") && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDlg({ kind: "undo", m })} data-testid={`milestone-undo-${m.seq}`}><Undo2 className="mr-1 h-3.5 w-3.5" />Undo</Button>}
              </span>
            </div>
            {m.notes && <p className="mt-1 text-xs text-slate-500">{m.notes}</p>}
          </li>;
        })}
      </ol>
      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}><DialogContent data-testid="milestone-dialog">
        <DialogHeader><DialogTitle>{dlg?.kind === "complete" ? `Complete “${dlg?.m.name}” (${dlg?.m.cumulative_percent}%)` : `Undo “${dlg?.m.name}”`}</DialogTitle><DialogDescription>{dlg?.kind === "complete" ? `Raises incremental demands for ${data.active_bookings} active booking(s).` : "Allowed only if no payment was posted after completion. Its demands will be voided."}</DialogDescription></DialogHeader>
        {dlg?.kind === "complete" ? <div className="space-y-3"><Field label="Completed on" required><Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} data-testid="milestone-date" /></Field><Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field><Button className="w-full bg-navy hover:bg-navy-700" onClick={() => run(`/blocks/${blockId}/milestones/${dlg.m.seq}/complete`, { completed_on: date, notes: notes || null, version: data.block.version }, (r) => `Milestone complete · ${r.demands_raised} demand(s) raised`)} data-testid="milestone-confirm">Confirm completion</Button></div>
          : <div className="space-y-3"><Field label="Reason" required><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="milestone-undo-reason" /></Field><Button disabled={notes.length < 3} className="w-full bg-red-600 hover:bg-red-700" onClick={() => run(`/blocks/${blockId}/milestones/${dlg.m.seq}/undo`, { reason: notes, version: data.block.version }, (r) => `Undone · ${r.demands_voided} demand(s) voided`)} data-testid="milestone-undo-confirm">Undo milestone</Button></div>}
      </DialogContent></Dialog>
    </div>
  );
}
