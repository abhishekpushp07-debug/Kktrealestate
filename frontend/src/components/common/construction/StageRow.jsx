import { Check } from "lucide-react";
import { fmtDate, inr } from "@/lib/format";

/** One construction stage row — Completed / In progress / Pending share the markup; status drives colours and the planned-date editor. */
export function StageRow({ s, canEdit, savePlanned, setJourney }) {
  return (
    <li className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${s.status === "Completed" ? "border-emerald-200 bg-sage-50/50" : s.status === "In Progress" ? "border-gold-border bg-gold-light" : "bg-white"}`} data-testid={`cs-stage-${s.seq}`}>
      <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${s.status === "Completed" ? "bg-emerald-600 text-white" : "bg-warm-50 text-txt-secondary"}`}>{s.status === "Completed" ? <Check className="h-4 w-4" /> : s.seq}</span>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink-950">{s.name}{s.is_possession && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-[#6B4E00]">Possession</span>}</p><p className="text-xs text-txt-secondary">{s.status}{s.completed_on ? ` · ${fmtDate(s.completed_on)}` : ""}{s.completed_by_name ? ` · ${s.completed_by_name}` : ""}</p></div>
      {s.status !== "Completed" && <label className="flex items-center gap-1 text-xs text-txt-secondary" title="Planned completion date (drives the Receivables Forecast month)">Planned<input type="date" className="h-7 rounded border px-1 text-xs" defaultValue={s.planned_date || ""} data-testid={`cs-stage-${s.seq}-planned`}
        onKeyDown={(e) => { if (e.key === "Enter") savePlanned(s, e.currentTarget.value); }} /><button type="button" className="rounded border px-2 py-0.5 text-[11px] font-semibold text-ink-950 hover:bg-warm-100" data-testid={`cs-stage-${s.seq}-planned-save`} onClick={(e) => savePlanned(s, e.currentTarget.previousSibling.value)}>Save</button></label>}
      {s.demands?.count > 0 && <span className="text-xs text-txt-secondary" data-testid={`cs-stage-${s.seq}-demands`}>{s.demands.count} demand(s) · {inr(s.demands.total)} · paid {inr(s.demands.paid)}</span>}
    </li>
  );
}
