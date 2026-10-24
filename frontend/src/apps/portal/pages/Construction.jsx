import { useState } from "react";
import { Check, HardHat, X } from "lucide-react";
import { Empty, PageTitle, Skeleton } from "../PortalShell";
import { fmtDate, useActiveBooking, useBookingSub } from "../hooks";
import { BookingSwitcher } from "./Home";

const BK = process.env.REACT_APP_BACKEND_URL;

export default function Construction() {
  const { items, active, select, isLoading } = useActiveBooking();
  const { data, isLoading: l2 } = useBookingSub(active?.id, "construction");
  const [lb, setLb] = useState(null);
  if (isLoading || l2) return <div className="space-y-4"><Skeleton h={48} /><Skeleton h={300} /></div>;
  if (!active || !data) return <Empty title="No booking yet" icon={HardHat} />;
  return (
    <div data-testid="portal-construction">
      <PageTitle title="Construction" sub={`${data.block_name} · ${data.construction_percent}% complete${data.up_next ? ` · up next: ${data.up_next}` : ""}`} />
      <BookingSwitcher items={items} active={active} select={select} />
      <div className="pcard mb-4 p-5 fade-up"><div className="flex items-center justify-between text-sm"><span className="text-slate-500">Overall progress</span><span className="font-bold text-[#0B1F3A]" data-testid="construction-percent">{data.construction_percent}%</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-[#F8F6F1]"><div className="h-full rounded-full bg-[#0B1F3A] transition-[width] duration-700" style={{ width: `${data.construction_percent}%` }} /></div></div>
      <ol className="pcard p-5 fade-up" data-testid="construction-timeline">
        {data.milestones.map((m, i) => {
          const next = m.status !== "Completed" && (i === 0 || data.milestones[i - 1].status === "Completed");
          return <li key={m.seq} className={`tl pb-6 ${m.status === "Completed" ? "done" : next ? "next" : ""}`} data-testid={`construction-milestone-${m.seq}`}>
            <span className="dot">{m.status === "Completed" ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold">{m.seq}</span>}</span>
            <div className="flex flex-wrap items-baseline gap-x-2"><p className="font-bold text-[#0B1F3A]">{m.name}</p><span className="text-xs text-slate-500">{m.cumulative_percent}%{m.completed_on ? ` · ${fmtDate(m.completed_on)}` : next ? " · in progress" : ""}</span></div>
            {m.update && <p className="mt-1 text-sm text-slate-600">{m.update}</p>}
            {m.photos.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">{m.photos.map((p) => <button key={p.id} onClick={() => setLb(p)} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100" data-testid={`construction-photo-${p.id}`}><img src={`${BK}${p.url}`} alt={p.caption || m.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /></button>)}</div>}
          </li>;
        })}
      </ol>
      {lb && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F3A]/95 p-4" onClick={() => setLb(null)} data-testid="photo-lightbox"><button className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white" aria-label="Close" data-testid="lightbox-close"><X className="h-5 w-5" /></button><figure className="max-w-3xl"><img src={`${BK}${lb.url}`} alt={lb.caption} className="max-h-[75vh] w-full rounded-2xl object-contain" /><figcaption className="mt-3 text-center text-sm text-slate-200">{lb.caption}{lb.taken_on ? ` · ${fmtDate(lb.taken_on)}` : ""}</figcaption></figure></div>}
    </div>
  );
}
