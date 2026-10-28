import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Plus, Layers } from "lucide-react";
import { MiniBar } from "@/components/v2";
import { FlatRow } from "@/components/structure/FlatRow";
import { cn } from "@/lib/utils";

function Badge({ children, tone = "ink", testId }) {
  const cls = { ink: "bg-ink-100 text-ink-950", sage: "bg-sage/15 text-sage", amber: "bg-amber2/15 text-amber-700", brick: "bg-brick/10 text-brick" }[tone];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)} data-testid={testId}>{children}</span>;
}

export function TowerNode({ tower: t, projectId, can, onAddFloors, onAddFlat, onChanged }) {
  const [open, setOpen] = useState(false);
  const [openFloors, setOpenFloors] = useState({});
  const bs = t.units.by_status;
  return (
    <div className="rounded-2xl border border-warm-200 bg-white" data-testid={`tower-node-${t.code}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-left" data-testid={`tower-toggle-${t.code}`} aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 text-txt-muted" /> : <ChevronRight className="h-4 w-4 text-txt-muted" />}
          <Link to={`/blocks/${t.id}`} className="font-display text-lg text-ink-950 hover:text-gold" onClick={(e) => e.stopPropagation()}>{t.name}</Link>
          <span className="text-xs text-txt-muted">{t.floors} floors · {t.units.total} flats{t.rate_per_sqft ? ` · ₹${t.rate_per_sqft}/sq.ft` : ""}</span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5" data-testid={`tower-badges-${t.code}`}>
          {["Available", "Hold", "Booked", "Sold", "Blocked"].filter((s) => bs[s]).map((s) => <Badge key={s} tone={s === "Available" ? "sage" : s === "Hold" ? "amber" : s === "Blocked" ? "brick" : "ink"}>{bs[s]} {s}</Badge>)}
          {t.units.masked && <Badge tone="amber" testId={`tower-masked-${t.code}`}>display status</Badge>}
          <Badge testId={`tower-stage-plan-${t.code}`}>{t.stage_plan.total ? `Stage plan: ${t.stage_plan.completed}/${t.stage_plan.total} (${t.stage_plan.source})` : "No stage plan"}</Badge>
          <Badge testId={`tower-payment-plans-${t.code}`}>{t.payment_plans.length ? t.payment_plans.map((p) => p.name).join(" · ") : "No payment plan"}</Badge>
          {t.missing_price > 0 && <Badge tone="brick">{t.missing_price} without price</Badge>}
        </div>
        <div className="ml-auto flex gap-1.5">
          {can("masters.tower.edit") && <button className="btn btn-secondary btn-sm" onClick={onAddFloors} data-testid={`tower-add-floors-${t.code}`}><Layers className="h-3.5 w-3.5" />Floors</button>}
          {can("masters.flat.create") && <button className="btn btn-secondary btn-sm" onClick={() => onAddFlat(undefined)} data-testid={`tower-add-flat-${t.code}`}><Plus className="h-3.5 w-3.5" />Flat</button>}
        </div>
      </div>
      <div className="px-4 pb-2"><MiniBar counts={bs} /></div>
      {open && (
        <div className="divide-y divide-warm-100 border-t border-warm-100" data-testid={`tower-floors-${t.code}`}>
          {t.floors_list.length === 0 && <p className="px-6 py-3 text-sm text-txt-muted">No flats yet — add floors to generate them.</p>}
          {[...t.floors_list].reverse().map((fl) => {
            const o = !!openFloors[fl.floor];
            return (
              <div key={fl.floor} data-testid={`floor-node-${t.code}-${fl.floor}`}>
                <div className="flex items-center gap-3 px-6 py-2">
                  <button onClick={() => setOpenFloors((s) => ({ ...s, [fl.floor]: !o }))} className="flex items-center gap-2 text-sm" data-testid={`floor-toggle-${t.code}-${fl.floor}`} aria-expanded={o}>
                    {o ? <ChevronDown className="h-3.5 w-3.5 text-txt-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />}<span className="font-semibold">Floor {fl.label}</span><span className="text-xs text-txt-muted">{fl.flats.length} flats</span></button>
                  {can("masters.flat.create") && <button className="btn btn-ghost btn-sm ml-auto" onClick={() => onAddFlat(fl.floor)} data-testid={`floor-add-flat-${t.code}-${fl.floor}`}><Plus className="h-3.5 w-3.5" />Flat</button>}
                </div>
                {o && <table className="w-full text-sm" data-testid={`floor-flats-${t.code}-${fl.floor}`}><tbody>{fl.flats.map((f) => <FlatRow key={f.id} flat={f} can={can} onChanged={onChanged} />)}</tbody></table>}
              </div>);
          })}
        </div>)}
    </div>
  );
}
