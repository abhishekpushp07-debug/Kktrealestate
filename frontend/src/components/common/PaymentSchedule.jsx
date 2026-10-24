import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";

export const STATUS_TONE = { "Not yet due": "bg-slate-100 text-slate-600", Raised: "bg-blue-50 text-blue-700", "Partially paid": "bg-amber-50 text-amber-700", Paid: "bg-emerald-50 text-emerald-700", Overdue: "bg-red-50 text-red-700" };

// Live schedule preview used by the booking wizard (plan + agreed amounts, no booking yet).
export function pctPaise(amount, pct) { return Math.round(amount * pct) / 100; }

export function SchedulePreview({ plan, cash, account, bookingDate }) {
  let cum = 0;
  const rows = plan.installments.map((i) => { cum += i.percent; const exp = i.trigger_type === "ON_BOOKING" ? bookingDate : i.trigger_type === "DAYS_AFTER_BOOKING" ? new Date(new Date(bookingDate).getTime() + i.trigger_days * 864e5).toISOString().slice(0, 10) : i.trigger_type === "ON_DATE" ? i.trigger_date : null; return { ...i, cum, exp, c: pctPaise(cash, i.percent), a: pctPaise(account, i.percent) }; });
  return <table className="w-full text-xs" data-testid="schedule-preview"><thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Installment</th><th className="py-1 pr-2 text-right">%</th><th className="py-1 pr-2">Trigger</th><th className="py-1 pr-2">Expected</th><th className="py-1 pr-2 text-right">Cash</th><th className="py-1 pr-2 text-right">Account</th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.seq} className="border-t"><td className="py-1 pr-2">{r.seq}</td><td className="py-1 pr-2 font-medium text-navy">{r.name}</td><td className="py-1 pr-2 text-right tabular">{r.percent}%</td><td className="py-1 pr-2 text-slate-600">{r.trigger_label}</td><td className="py-1 pr-2">{r.exp ? fmtDate(r.exp) : "on stage"}</td><td className="py-1 pr-2 text-right tabular">{inr(r.c)}</td><td className="py-1 pr-2 text-right tabular">{inr(r.a)}</td></tr>)}</tbody></table>;
}

// Booking detail tab: server-computed installment schedule with statuses.
export function BookingScheduleTab({ bookingId }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/bookings/${bookingId}/schedule`).then((r) => setD(r.data)).catch((e) => toast.error(errMsg(e))); }, [bookingId]);
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!d.plan?.name) return <div className="card-elev p-5 text-sm text-slate-500" data-testid="schedule-none">No payment plan on this booking (legacy).</div>;
  return (
    <div className="space-y-4" data-testid="booking-schedule">
      <div className="card-elev flex flex-wrap items-center gap-6 p-4 text-sm"><div><p className="label-xs">Payment plan</p><p className="font-bold text-navy" data-testid="schedule-plan-name">{d.plan.name} <span className="text-xs font-normal text-slate-500">· {d.plan.plan_type}</span></p></div>{d.acceptance && <div><p className="label-xs">Accepted</p><p>{fmtDate(d.acceptance.accepted_on)} · {d.acceptance.mode}</p></div>}{d.next && <div><p className="label-xs">Next installment</p><p>{d.next.name} · {d.next.trigger_label}{d.next.expected_date ? ` · ${fmtDate(d.next.expected_date)}` : ""}</p></div>}</div>
      <div className="card-elev overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">#</th><th className="px-3 py-2">Installment</th><th className="px-3 py-2 text-right">%</th><th className="px-3 py-2">Trigger</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Raised</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Cash</th><th className="px-3 py-2 text-right">Account</th><th className="px-3 py-2 text-right">Paid</th></tr></thead>
        <tbody>{d.items.map((r) => <tr key={r.seq} className="border-t" data-testid={`schedule-row-${r.seq}`}><td className="px-3 py-2">{r.seq}</td><td className="px-3 py-2 font-medium text-navy">{r.name}{r.demand_number && <span className="block font-mono text-[10px] text-slate-400">{r.demand_number}</span>}</td><td className="px-3 py-2 text-right tabular">{r.percent}%</td><td className="px-3 py-2 text-slate-600">{r.trigger_label}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[r.status]}`} data-testid={`schedule-status-${r.seq}`}>{r.status}</span></td><td className="px-3 py-2">{r.raised_on ? fmtDate(r.raised_on) : r.expected_date ? <span className="text-slate-400">exp. {fmtDate(r.expected_date)}</span> : <span className="text-slate-400">on stage</span>}</td><td className="px-3 py-2">{r.due_date ? fmtDate(r.due_date) : "—"}</td><td className="px-3 py-2 text-right tabular">{inr(r.cash_expected)}</td><td className="px-3 py-2 text-right tabular">{inr(r.account_expected)}</td><td className="px-3 py-2 text-right tabular">{inr(r.paid)}</td></tr>)}</tbody></table></div>
    </div>
  );
}
