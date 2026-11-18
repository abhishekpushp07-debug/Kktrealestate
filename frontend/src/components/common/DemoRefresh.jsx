import { useEffect, useState } from "react";
import { CalendarClock, Play } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

/** F-44: "Demo last refreshed <date> · <status>" + Super Admin "Run now" (same job as 03:00 IST). */
export function DemoRefresh({ tick }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    api
      .get("/admin/demo-refresh")
      .then((r) => alive && setD(r.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tick, n]);
  if (!d) return null;
  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api.post("/admin/demo-refresh/run", {});
      toast.success(`Demo refresh: ${r.data.outcome}`);
      setN((x) => x + 1);
    } catch (e) {
      toast.error(e?.response?.data?.error?.message || "Could not start the demo refresh");
    } finally {
      setBusy(false);
    }
  };
  const done = d.last_done;
  const last = d.last;
  return (
    <div className="mb-5 rounded-xl border border-warm-200 p-4" data-testid="ops-demo-refresh">
      <div className="flex items-start justify-between gap-3">
        <p className="label flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" />
          Demo data · {d.schedule}
        </p>
        <Button
          variant="quiet"
          onClick={runNow}
          why={d.running ? "A refresh is already running" : undefined}
          disabled={busy || d.running}
          data-testid="ops-demo-refresh-run"
        >
          <Play className="h-4 w-4" />
          {d.running ? "Refreshing…" : "Run now"}
        </Button>
      </div>
      <p className="mt-2 text-sm" data-testid="ops-demo-refresh-last">
        Demo last refreshed {done ? done.as_of : "never"} · {done ? "done" : "—"}
      </p>
      {last && last.id !== done?.id && (
        <p className="mt-1 text-sm" data-testid="ops-demo-refresh-attempt">
          Last attempt {when(last.finished_at)} · {last.outcome}
        </p>
      )}
      <p className="mt-1 text-xs text-txt-muted" data-testid="ops-demo-refresh-guard">
        {d.enabled ? "Nightly refresh on (preview)" : d.guard}
        {d.story_as_of?.as_of ? ` · demo as-of ${d.story_as_of.as_of}` : ""}
      </p>
    </div>
  );
}
