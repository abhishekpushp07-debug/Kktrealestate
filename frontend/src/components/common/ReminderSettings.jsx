import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Field } from "@/components/common/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Masters → Company → Reminders: owner controls for OVERDUE_REMINDERS. */
export function ReminderSettings({ canEdit }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/messaging/reminders/settings").then((r) => setS(r.data)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!s) return <div className="h-24 animate-pulse rounded-xl bg-warm-50" />;
  const save = async () => {
    setBusy(true);
    try { const r = await api.patch("/messaging/reminders/settings", { enabled: s.enabled, thresholds: s.thresholds, escalate_days: s.escalate_days, window_from: s.window_from, window_to: s.window_to, channel_order: s.channel_order, cc_rm: s.cc_rm }); setS(r.data); toast.success("Reminder settings saved"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const move = (i, d) => { const o = [...s.channel_order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setS({ ...s, channel_order: o }); };
  return (
    <section className="space-y-4" data-testid="reminder-settings">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold text-ink-950">Reminders</h2><p className="text-xs text-txt-secondary">Nightly overdue reminders (letter PDF + message). Configured channels now: <b>{s.configured_channels.join(", ") || "none"}</b>{s.in_window_now ? " · inside send window" : " · outside send window (job defers)"}</p></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} disabled={!canEdit} data-testid="rem-enabled" />Enabled</label></div>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Thresholds (days overdue)"><Input value={s.thresholds.join(", ")} onChange={(e) => setS({ ...s, thresholds: e.target.value.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)) })} disabled={!canEdit} data-testid="rem-thresholds" /></Field>
        <Field label="Escalate to RM after (days)"><Input type="number" value={s.escalate_days} onChange={(e) => setS({ ...s, escalate_days: +e.target.value })} disabled={!canEdit} data-testid="rem-escalate" /></Field>
        <Field label="Send window from (IST)"><Input type="time" value={s.window_from} onChange={(e) => setS({ ...s, window_from: e.target.value })} disabled={!canEdit} data-testid="rem-from" /></Field>
        <Field label="Send window to (IST)"><Input type="time" value={s.window_to} onChange={(e) => setS({ ...s, window_to: e.target.value })} disabled={!canEdit} data-testid="rem-to" /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2" data-testid="rem-channel-order"><span className="text-xs text-txt-secondary">Channel order:</span>{s.channel_order.map((c, i) => <span key={c} className="pill bg-warm-100 text-xs">{i + 1}. {c}{canEdit && <><button onClick={() => move(i, -1)} className="ml-1 text-txt-muted" aria-label="move up">↑</button><button onClick={() => move(i, 1)} className="text-txt-muted" aria-label="move down">↓</button></>}</span>)}</div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.cc_rm} onChange={(e) => setS({ ...s, cc_rm: e.target.checked })} disabled={!canEdit} data-testid="rem-cc-rm" />Notify RM on every reminder</label>
        {canEdit && <Button type="button" onClick={save} disabled={busy} className="ml-auto" data-testid="rem-save">{busy ? "Saving…" : "Save reminders"}</Button>}
      </div>
    </section>
  );
}
