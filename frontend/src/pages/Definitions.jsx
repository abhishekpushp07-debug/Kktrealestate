import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpenCheck } from "lucide-react";
import api from "@/lib/api";
import { PageHeader } from "@/components/common/Bits";
import { Skeleton } from "@/components/ui/skeleton";

export default function Definitions() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/definitions").then((r) => setD(r.data)).catch(() => setD({ items: [], events: [] })); }, []);
  return (
    <div data-testid="definitions-page">
      <PageHeader title="Definitions" subtitle="The single source of truth for every money figure in KKT ERP. Read-only — every tile, report and projection imports these." actions={<Link to="/settings" className="btn btn-ghost">← Settings</Link>} />
      {!d ? <Skeleton className="h-64" /> : (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            {d.items.map((x) => (
              <article key={x.key} className="card p-5" data-testid={`definition-${x.key}`}>
                <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-warm-100"><BookOpenCheck className="h-5 w-5" strokeWidth={1.75} /></span>
                  <div className="min-w-0"><h3 className="font-display text-lg">{x.name}</h3><p className="mt-1 rounded-lg bg-warm-50 px-3 py-2 font-mono text-xs text-ink-950">{x.formula}</p><p className="mt-2 text-sm text-txt-secondary">{x.note}</p>
                    <p className="mt-2 text-xs text-txt-muted">Used by: {x.used_by.join(" · ")}</p></div></div>
              </article>
            ))}
          </section>
          <section className="card mt-6 overflow-x-auto !p-0" data-testid="event-registry">
            <div className="border-b border-warm-100 px-6 py-4"><h3 className="font-display text-lg">Event registry</h3><p className="text-sm text-txt-muted">{d.events.length} canonical events · each drives caches, notifications, projections and the Journey panel.</p></div>
            <table className="w-full text-sm"><thead className="text-[11px] font-semibold uppercase tracking-wide text-txt-muted"><tr><th className="px-4 py-2 text-left">Event</th><th className="px-4 py-2 text-left">Entity</th><th className="px-4 py-2 text-left">Surfaces</th><th className="px-4 py-2 text-left">Notifies</th></tr></thead>
              <tbody>{d.events.map((e) => <tr key={e.event} className="border-t border-warm-100"><td className="px-4 py-2 font-mono text-xs">{e.event}</td><td className="px-4 py-2">{e.entity}</td><td className="px-4 py-2 text-xs text-txt-secondary">{e.surfaces.join(", ")}</td><td className="px-4 py-2 text-xs text-txt-secondary">{[...e.roles, ...e.parties].join(", ") || "—"}</td></tr>)}</tbody></table>
          </section>
        </>
      )}
    </div>
  );
}
