import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { BACKEND } from "@/lib/api";

const STATUS = { QUEUED: "bg-warm-100 text-txt-secondary", RUNNING: "bg-amber-50 text-amber-900", DONE: "bg-sage/10 text-sage", FAILED: "bg-brick/10 text-brick" };

export default function Exports() {
  const [d, setD] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { let alive = true; api.get("/exports").then((r) => alive && setD(r.data)).catch(() => {}); const t = setInterval(() => setTick((x) => x + 1), 5000); return () => { alive = false; clearInterval(t); }; }, [tick]);
  const items = d?.items || [];
  return (
    <section className="page" data-testid="exports-page">
      <div className="flex items-start justify-between gap-4">
        <div><p className="label">Reports</p><h1 className="font-display text-4xl text-ink-950">Exports</h1>
          <p className="mt-1 text-sm text-txt-secondary">Reports above {d?.limits?.sync_max_rows?.toLocaleString("en-IN") || "10,000"} rows are prepared in the background. Links are valid 15 minutes; files are kept {d?.limits?.retention_days || 7} days; max {d?.limits?.max_in_flight || 3} in progress.</p></div>
        <button className="btn btn-ghost" onClick={() => setTick((x) => x + 1)} data-testid="exports-refresh"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full text-sm" data-testid="exports-table">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-txt-muted"><th className="px-3 py-2">Report</th><th className="px-3 py-2">Requested</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2 text-right">Size</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="border-t border-warm-100" data-testid={`export-row-${e.id}`}>
                <td className="px-3 py-2 font-medium">{e.title}</td>
                <td className="px-3 py-2 text-txt-secondary">{new Date(e.created_at).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[e.status]}`} data-testid={`export-status-${e.id}`}>{e.status}</span>{e.error && <span className="ml-2 text-xs text-brick">{e.error}</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.rows?.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.bytes ? `${(e.bytes / 1048576).toFixed(1)} MB` : "—"}</td>
                <td className="px-3 py-2 text-txt-secondary">{new Date(e.expires_at).toLocaleDateString("en-IN")}</td>
                <td className="px-3 py-2 text-right">{e.download_url && <a className="btn btn-secondary !h-8" href={`${BACKEND}${e.download_url}`} data-testid={`export-download-${e.id}`}><Download className="h-4 w-4" />Download</a>}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-txt-muted" data-testid="exports-empty">No exports yet. Large report exports (CSV) will appear here.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
