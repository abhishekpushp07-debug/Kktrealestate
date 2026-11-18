import { PinnedViews } from "@/components/home/PinnedViews";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  Building2,
  CalendarClock,
  Clock3,
  Filter,
  Hammer,
  IndianRupee,
  Layers,
  Percent,
  Phone,
  RotateCw,
  TrendingUp,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { rs } from "./WidgetCard";
import { CallTodayList, ReadyToBill } from "./HomeElite";

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const pctBar = (p) => [{ w: p, c: "var(--accent)" }];

/** One Home widget (REQ-202): icon · tag · big figure · label · caption · one quiet visual. */
function Widget({ w, onOpen }) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <span className="e-wi">
          <w.icon />
        </span>
        <span className="e-wtag">{w.tag}</span>
      </div>
      <p
        className="e-wfig"
        style={w.tone ? { color: w.tone } : undefined}
        data-testid={`hw-${w.id}-figure`}
      >
        {w.err ? "—" : w.figure}
      </p>
      <p className="e-wlab">{w.label}</p>
      <p className="e-wcap">{w.err ? "Couldn't load · tap to retry" : w.caption}</p>
      {!w.err && w.bar && (
        <div className="e-wvis">
          <div className="e-line">
            {w.bar.map((b) => (
              <i key={`${b.c}-${b.w}`} style={{ width: `${b.w}%`, background: b.c }} />
            ))}
          </div>
        </div>
      )}
    </>
  );
  if (w.err)
    return (
      <button type="button" className="e-w" onClick={w.retry} data-testid={`hw-${w.id}`}>
        {body}
        <RotateCw className="absolute bottom-4 right-4 h-4 w-4 text-txt-muted" />
      </button>
    );
  if (w.open)
    return (
      <button
        type="button"
        className="e-w"
        onClick={() => onOpen(w.open)}
        data-testid={`hw-${w.id}`}
      >
        {body}
      </button>
    );
  return (
    <Link to={w.to || "/reports"} className="e-w" data-testid={`hw-${w.id}`}>
      {body}
    </Link>
  );
}

function money(W, period) {
  const due = W.due_vs_received;
  const age = W.ageing;
  const inf = W.inflow_30;
  const mt = W.money_today;
  const bands = age && ["not_due", "d0_30", "d31_60", "d61_90", "d90"].map((k) => age[k]);
  const grey = ["#5f6880", "#737c92", "#8a93a6", "#a3abbb"];
  return [
    due && {
      id: "recovery",
      icon: Clock3,
      tag: due.label || period,
      figure: due.recovery_pct == null ? "—" : `${due.recovery_pct}%`,
      label: "recovered",
      caption: `${rs(due.received.amount)} of ${rs(due.due.amount)} due`,
      bar: pctBar(Math.min(100, due.recovery_pct || 0)),
      to: due.received.drill?.to,
    },
    age && {
      id: "outstanding",
      icon: IndianRupee,
      tag: "Live",
      figure: rs(age.total.amount),
      label: "outstanding",
      caption: `${rs(age.overdue.amount)} overdue`,
      bar: age.total.amount
        ? bands.map((b, i) => ({
            w: (b.amount * 100) / age.total.amount,
            c: i === 4 ? "var(--due)" : grey[i],
          }))
        : null,
      to: age.total.drill?.to,
    },
    age && {
      id: "overdue90",
      icon: AlertTriangle,
      tag: "Live",
      figure: rs(age.d90.amount),
      tone: age.d90.amount ? "var(--due)" : undefined,
      label: "overdue 90+ days",
      caption: `${age.d90.bookings} bookings`,
      to: age.d90.drill?.to,
    },
    inf && {
      id: "next30",
      icon: TrendingUp,
      tag: "Next 30 days",
      figure: rs(inf.total ?? (inf.bills.amount || 0) + (inf.cheques.amount || 0)),
      label: "coming in",
      caption: `bills ${rs(inf.bills.amount)} · ${inf.awaiting_stage.count} wait for a stage`,
      to: inf.bills.drill?.to,
    },
    mt && {
      id: "cheques",
      icon: Banknote,
      tag: "Live",
      figure: String(mt.cheques.count || 0),
      label: mt.cheques.count === 1 ? "cheque to clear" : "cheques to clear",
      caption: mt.cheques.count ? rs(mt.cheques.amount) : "nothing waiting at the bank",
      to: mt.cheques.drill?.to,
    },
  ];
}

function work(W) {
  const ct = W.call_today;
  const nm = W.next_milestone;
  const at = W.attention;
  const ready = (nm?.towers || []).filter((t) => t.stage && t.expected?.amount);
  const first = ct?.overdue_customers?.[0];
  const att =
    at &&
    [at.holds_expiring, at.bounced, at.stale_part_paid, at.waivers_to_approve].filter(Boolean);
  return [
    ct && {
      id: "call",
      icon: Phone,
      tag: "Today",
      figure: String(ct.overdue_customers.length),
      label: "customers to call",
      caption: first ? `first: ${first.name} · ${rs(first.overdue)}` : "nobody overdue",
      open: "call",
    },
    ct?.followups && {
      id: "followups",
      icon: CalendarClock,
      tag: "Today",
      figure: String(ct.followups.count || 0),
      label: ct.followups.count === 1 ? "follow-up due" : "follow-ups due",
      caption: ct.visits_today
        ? `${ct.visits_today.count || 0} site ${ct.visits_today.count === 1 ? "visit" : "visits"} today`
        : "leads to call back",
      to: ct.followups.drill?.to,
    },
    nm && {
      id: "ready",
      icon: Layers,
      tag: "Stage pending",
      figure: rs(sum(ready, (t) => t.expected.amount)),
      label: "ready to bill",
      caption: ready.length
        ? `${ready.map((t) => t.tower).join(" + ")} · incl. GST`
        : "every booked tower is billed",
      open: "ready",
    },
    at && {
      id: "attention",
      icon: AlertTriangle,
      tag: "Live",
      figure: String(sum(att, (x) => x.count)),
      label: "need attention",
      caption: `${at.holds_expiring.count} holds expiring · ${at.bounced.count} bounced · ${at.stale_part_paid.count} part-paid`,
      to: (att.find((x) => x.count) || at.holds_expiring).drill?.to,
    },
  ];
}

function sales(W) {
  const pl = W.pipeline;
  const inv = W.inventory;
  const towers = inv?.towers || [];
  const total = sum(towers, (t) => t.total);
  const taken = sum(towers, (t) => (t.booked?.count || 0) + (t.sold?.count || 0)); // masked roles get no "booked" state
  return [
    pl && {
      id: "pipeline",
      icon: Filter,
      tag: pl.label,
      figure: String(pl.leads.count),
      label: "new leads",
      caption: `${pl.visits.count} visits · ${pl.bookings.count} bookings · ${pl.conversion_pct ?? 0}% converted`,
      bar: pl.leads.count
        ? [
            {
              w: Math.min(100, ((pl.bookings.count || 0) * 100) / pl.leads.count),
              c: "var(--accent)",
            },
          ]
        : null,
      to: pl.leads.drill?.to,
    },
    pl?.discount && {
      id: "discount",
      icon: Percent,
      tag: pl.label,
      figure: rs(pl.discount.amount_paise / 100),
      label: "discount given",
      caption: `${pl.discount.bookings} ${pl.discount.bookings === 1 ? "booking" : "bookings"} · list − agreed`,
      to: pl.discount.link,
    },
    inv && {
      id: "available",
      icon: Building2,
      tag: "Live",
      figure: String(sum(towers, (t) => t.available.count)),
      label: "flats available",
      caption: sum(towers, (t) => t.unsold)
        ? `unsold value ${rs(sum(towers, (t) => t.unsold))}`
        : `across ${towers.length} ${towers.length === 1 ? "tower" : "towers"}`,
      to: "/flats?status=Available",
    },
    inv && {
      id: "sold",
      icon: TrendingUp,
      tag: "Live",
      figure: `${taken} of ${total}`,
      label: "booked or sold",
      caption: `${total ? Math.round((taken * 100) / total) : 0}% of all flats${
        towers.length && !towers[0].states?.includes("Booked") ? " · as shown to sales" : ""
      }`, // masked roles see the display view (display rules), not the real inventory
      bar: total ? pctBar((taken * 100) / total) : null,
      to: "/flats",
    },
  ];
}

function build(W) {
  return (W.construction?.towers || [])
    .filter((t) => t.total)
    .slice(0, 4)
    .map((t) => ({
      id: `tower-${t.block_id}`,
      icon: Hammer,
      tag: t.project,
      figure: `${t.pct}%`,
      label: t.tower,
      caption: t.last_stage
        ? `last: ${t.last_stage} · ${t.done} of ${t.total} stages`
        : `${t.total} stages · not started`,
      bar: pctBar(t.pct),
      to: t.drill?.to,
    }));
}

/** REQ-201: captioned groups of widgets (Money · Today's work · Sales & stock · Construction). */
export function HomeWidgets({ data, on, reload }) {
  const [open, setOpen] = useState(null);
  const W = {};
  const errs = new Set();
  for (const id of on) {
    const st = data?.widgets?.[id];
    if (st?.ok) W[id] = st.data;
    else if (st && !st.ok) errs.add(id);
  }
  const groups = [
    ["Money", money(W, data?.period?.label)],
    ["Today's work", work(W)],
    ["Sales & stock", sales(W)],
    ["Construction", build(W)],
  ];
  const ERR_LABEL = {
    due_vs_received: "recovery",
    ageing: "outstanding",
    inflow_30: "coming in",
    call_today: "customers to call",
    next_milestone: "ready to bill",
    attention: "need attention",
    pipeline: "new leads",
    inventory: "flats available",
    construction: "construction",
  };
  const errW = [...errs].map((id) => ({
    id: `err-${id}`,
    icon: AlertTriangle,
    tag: "",
    label: ERR_LABEL[id] || id,
    err: true,
    retry: reload,
  }));
  return (
    <div data-testid="home-grid">
      <PinnedViews />
      {groups.map(([name, ws], gi) => {
        const list = ws.filter(Boolean).concat(gi === 0 ? errW : []);
        if (!list.length) return null;
        return (
          <section key={name} data-testid={`home-group-${gi}`}>
            <div className="e-sec">
              <h2>
                {name}
                <span className="e-count">{list.length}</span>
              </h2>
            </div>
            <div className="e-wgrid">
              {list.map((w) => (
                <Widget key={w.id} w={w} onOpen={setOpen} />
              ))}
            </div>
          </section>
        );
      })}
      <Sheet open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-xl"
          data-testid="home-drawer"
        >
          <SheetHeader>
            <SheetTitle>{open === "call" ? "call today." : "ready to bill."}</SheetTitle>
          </SheetHeader>
          <div className="-mt-4">
            {open === "call" && W.call_today && <CallTodayList d={W.call_today} />}
            {open === "ready" && W.next_milestone && <ReadyToBill d={W.next_milestone} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
