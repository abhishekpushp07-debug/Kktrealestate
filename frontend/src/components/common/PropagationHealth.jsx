import { useEffect, useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import api from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

export function PropagationHealthCard() {
  const [d, setD] = useState(null);
  const failingRows = useMemo(() => (d?.failing || []).map((f) => ({ ...f, errors: Object.entries(f.propagated || {}).filter(([, v]) => String(v).startsWith("ERR")).map(([k, v]) => `${k}: ${v}`).join("; ") })), [d]);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get("/admin/propagation").then((r) => setD(r.data)).catch((e) => setErr(e?.response?.data?.error?.message || "Unavailable")); }, []);
  return (
    <section className="card p-6" data-testid="propagation-health-card">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-[10px] bg-warm-100"><GitBranch className="h-5 w-5" strokeWidth={1.75} /></span>
        <div><h3 className="font-display text-lg">Propagation health</h3><p className="text-sm text-txt-muted">Outbox: every entry's effects, replayed by the sweep if incomplete.</p></div></div>
      {err && <p className="mt-4 text-sm text-brick">{err}</p>}
      {d && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["Unpropagated", d.unpropagated], ["Lag", `${d.lag_s}s`], ["Last sweep", d.last_sweep ? fmtDateTime(d.last_sweep) : "—"], ["Events", d.registered_events]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-warm-50 p-3" data-testid={`prop-kpi-${l.toLowerCase().replace(" ", "-")}`}><p className="label">{l}</p><p className="font-display text-xl">{v}</p></div>))}
          </div>
          {d.failing?.length > 0 && <ul className="mt-4 space-y-1 text-xs text-brick" data-testid="prop-failing">{failingRows.map((f) => <li key={f.id}>{f.action} · {fmtDateTime(f.created_at)} · {f.errors}</li>)}</ul>}
        </>
      )}
    </section>
  );
}
