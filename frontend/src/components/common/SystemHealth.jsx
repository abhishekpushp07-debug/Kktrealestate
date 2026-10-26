import { useEffect, useState } from "react";
import { Activity, Database, RefreshCw, Timer } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const ms = (v) => (v == null ? "—" : `${Math.round(v)} ms`);
const Tone = ({ v, warn, bad }) => <span className={v == null ? "" : v > bad ? "text-brick font-semibold" : v > warn ? "text-amber-700" : "text-sage-700"}>{ms(v)}</span>;

export function SystemHealthCard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (user?.role_name !== "Super Admin") return undefined;
    let alive = true;
    api.get("/admin/ops").then((r) => alive && setD(r.data)).catch((e) => alive && setErr(e?.response?.data?.error?.message || "Unavailable"));
    const t = setTimeout(() => setTick((x) => x + 1), 30000);
    return () => { alive = false; clearTimeout(t); };
  }, [tick, user?.role_name]);
  if (user?.role_name !== "Super Admin") return null;
  const groups = Object.entries(d?.requests?.by_group || {});
  const jobs = Object.entries(d?.jobs || {});
  return (
    <section className="card p-6" data-testid="system-health-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-[10px] bg-warm-100"><Activity className="h-5 w-5" strokeWidth={1.75} /></span>
          <div><h3 className="font-display text-lg">System health</h3><p className="text-sm text-txt-muted">Rolling {Math.round((d?.requests?.window_s || 900) / 60)} min · auto-refresh 30 s · read-only</p></div></div>
        <button className="btn btn-ghost" onClick={() => setTick((x) => x + 1)} data-testid="ops-refresh"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>
      {err && <p className="mt-4 text-sm text-brick" data-testid="ops-error">{err}</p>}
      {d && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[["Requests", d.requests.requests, `${d.requests.rps} rps`], ["p50", ms(d.requests.p50_ms)], ["p95", ms(d.requests.p95_ms)], ["Uptime", `${Math.round(d.uptime_s / 60)} min`, d.startup?.phase],
              ["Pool", `${d.db_pool.live.checked_out}/${d.db_pool.config.maxPoolSize}`, `${d.db_pool.live.created} created`]].map(([l, v, h]) => (
              <div key={l} className="rounded-xl bg-warm-50 p-3" data-testid={`ops-kpi-${l.toLowerCase()}`}><p className="label">{l}</p><p className="font-display text-xl">{v}</p>{h && <p className="text-xs text-txt-muted">{h}</p>}</div>))}
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm" data-testid="ops-groups">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-txt-muted"><th className="py-2 pr-3">Route group</th><th className="pr-3">Count</th><th className="pr-3">p50</th><th className="pr-3">p95</th><th className="pr-3">p99</th><th className="pr-3">DB p95</th><th className="pr-3" title="average Mongo queries per request">Avg q</th><th>4xx / 5xx</th></tr></thead>
              <tbody>{groups.map(([g, s]) => <tr key={g} className="border-t border-warm-100"><td className="py-1.5 pr-3 font-medium">{g}</td><td className="pr-3 tabular-nums">{s.count}</td><td className="pr-3 tabular-nums">{ms(s.p50_ms)}</td><td className="pr-3 tabular-nums"><Tone v={s.p95_ms} warn={150} bad={300} /></td><td className="pr-3 tabular-nums">{ms(s.p99_ms)}</td><td className="pr-3 tabular-nums">{ms(s.db_p95_ms)}</td><td className={`pr-3 tabular-nums ${s.avg_queries > 6 ? "font-semibold text-brick" : ""}`} data-testid={`ops-avgq-${g}`}>{s.avg_queries ?? "—"}</td><td className="tabular-nums">{s.errors_4xx} / <span className={s.errors_5xx ? "text-brick font-semibold" : ""}>{s.errors_5xx}</span></td></tr>)}
                {!groups.length && <tr><td colSpan={7} className="py-3 text-txt-muted">No requests in window yet.</td></tr>}</tbody>
            </table>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div data-testid="ops-jobs"><p className="label flex items-center gap-1"><Timer className="h-3.5 w-3.5" />Background jobs</p>
              <ul className="mt-2 space-y-1 text-sm">{jobs.map(([n, j]) => <li key={n} className="flex justify-between gap-2"><span>{n}</span><span className="text-txt-muted tabular-nums">{j.ok ? "ok" : "failed"} · {ms(j.duration_ms)} · {new Date(j.last_run).toLocaleTimeString()}</span></li>)}
                {!jobs.length && <li className="text-txt-muted">No job has run in this process yet.</li>}</ul>
              <p className="mt-3 text-xs text-txt-muted">Read models: oldest project summary {d.read_models.oldest_project_summary_age_s == null ? "—" : `${Math.round(d.read_models.oldest_project_summary_age_s / 60)} min`} old · last full refresh {d.read_models.last_full_refresh ? new Date(d.read_models.last_full_refresh).toLocaleString() : "—"}</p>
            </div>
            <div data-testid="ops-slow"><p className="label flex items-center gap-1"><Database className="h-3.5 w-3.5" />Slow requests (&gt; 500 ms) · errors {Object.entries(d.requests.errors_by_code).map(([c, n]) => `${c}×${n}`).join(" ") || "none"}</p>
              <ul className="mt-2 space-y-1 text-xs">{d.requests.slow.slice(0, 8).map((s) => <li key={s.request_id} className="flex justify-between gap-2 font-mono"><span className="truncate">{s.path}</span><span className="shrink-0 text-txt-muted">{ms(s.ms)} · {s.status} · {s.request_id}</span></li>)}
                {!d.requests.slow.length && <li className="text-txt-muted">None.</li>}</ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
