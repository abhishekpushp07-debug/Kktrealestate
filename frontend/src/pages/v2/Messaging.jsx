import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Mail, MessageSquare, Smartphone, RefreshCw, Plug } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card, EmptyState, Skeleton } from "@/components/v2";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/format";

const ICON = { email: Mail, whatsapp: MessageSquare, sms: Smartphone };
const TONE = { sent: "bg-sage/15 text-sage", delivered: "bg-sage/20 text-sage", failed: "bg-brick/10 text-brick", queued: "bg-gold-light text-[#8a6d12]", skipped_no_contact: "bg-warm-100 text-txt-secondary", skipped_no_consent: "bg-warm-100 text-txt-secondary", not_configured: "bg-warm-50 text-txt-muted" };
export const StatusChip = ({ s, testId }) => <span className={cn("pill text-[11px]", TONE[s] || "bg-warm-100")} data-testid={testId}>{(s || "").replace(/_/g, " ")}</span>;

function ChannelCard({ c }) {
  const I = ICON[c.channel] || Mail;
  return (
    <Card className="!p-4" testId={`channel-${c.channel}`}>
      <div className="flex items-center gap-3"><span className={cn("grid h-9 w-9 place-items-center rounded-xl", c.configured ? "bg-sage/15 text-sage" : "bg-warm-100 text-txt-muted")}><I className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink-950">{c.label}</p><p className="text-xs text-txt-secondary">{c.configured ? `Live · ${c.provider}` : "Not configured"}</p></div>
        <span className={cn("pill text-[11px]", c.configured ? "bg-sage/15 text-sage" : "bg-brick/10 text-brick")} data-testid={`channel-${c.channel}-state`}>{c.configured ? "Connected" : "Not configured"}</span></div>
      {!c.configured && <details className="mt-3 text-xs" data-testid={`channel-${c.channel}-connect`}><summary className="flex cursor-pointer items-center gap-1 font-semibold text-gold"><Plug className="h-3.5 w-3.5" />Connect provider — fields needed</summary>
        <ul className="mt-2 space-y-1 text-txt-secondary">{c.needs.map((n) => <li key={n.key}><code className="rounded bg-warm-100 px-1 text-[10px]">{n.key}</code> {n.label}</li>)}</ul>
        <p className="mt-2 text-txt-muted">Nothing is sent on this channel until the provider is connected — messages are logged as “not configured”.</p></details>}
    </Card>
  );
}

function ReminderLog() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/messaging/reminder-log").then((r) => setD(r.data)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!d) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <Card className="!p-0" testId="reminder-log">
      <div className="flex flex-wrap items-center gap-3 border-b border-warm-100 px-5 py-3 text-xs"><span className="font-bold text-ink-950">Reminder log</span>{Object.entries(d.by_status).map(([k, v]) => <span key={k} className="flex items-center gap-1"><StatusChip s={k} /> <b className="tabular-nums">{v}</b></span>)}<span className="ml-auto text-txt-muted" data-testid="reminder-log-tieout">Σ {d.total} = messages {d.tie_out_count} {d.total === d.tie_out_count ? "✓" : "✗"}</span></div>
      {d.rows.length === 0 ? <EmptyState title="No reminders yet" hint="The nightly job writes here; use “Send reminder now” on an overdue booking to try it." /> :
        <table className="w-full text-sm"><thead className="text-left text-[11px] uppercase tracking-wide text-txt-muted"><tr><th className="px-5 py-2">Project</th><th className="px-5 py-2">Status</th><th className="px-5 py-2 text-right">Count</th><th className="px-5 py-2 text-right">₹ overdue reminded</th></tr></thead>
          <tbody>{d.rows.map((r, i) => <tr key={i} className="border-t border-warm-100"><td className="px-5 py-2">{r.project}</td><td className="px-5 py-2"><StatusChip s={r.status} /></td><td className="px-5 py-2 text-right tabular-nums">{r.count}</td><td className="px-5 py-2 text-right tabular-nums">₹{Math.round(r.amount_paise / 100).toLocaleString("en-IN")}</td></tr>)}</tbody></table>}
    </Card>
  );
}

export default function Messaging() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || "log";
  const [ch, setCh] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const status = sp.get("status") || "";
  const load = useCallback(() => { api.get("/messaging/messages", { params: { status: status || undefined, limit: 200 } }).then((r) => setMsgs(r.data)).catch((e) => toast.error(errMsg(e))); }, [status]);
  useEffect(() => { api.get("/messaging/channels").then((r) => setCh(r.data.channels)).catch((e) => toast.error(errMsg(e))); }, []);
  useEffect(() => { load(); }, [load]);
  const retry = async (m) => { try { const r = await api.post(`/messaging/messages/${m.id}/retry`); toast[r.data.status === "sent" ? "success" : "error"](`${r.data.status}${r.data.error ? " · " + r.data.error : ""}`); load(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-6" data-testid="messaging-page">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-3xl text-ink-950">Messaging</h1><p className="mt-1 text-sm text-txt-secondary">Every message the system sent, tried to send, or chose not to — with the real reason. Reminders run nightly inside the IST window set in <Link to="/masters/company" className="font-semibold text-gold hover:underline">Masters → Company → Reminders</Link>; templates live in <Link to="/masters/templates" className="font-semibold text-gold hover:underline">Masters → Templates</Link>.</p></div>
        <div className="flex gap-1 rounded-full bg-warm-100 p-1">{[["log", "Message log"], ["reminders", "Reminder log"]].map(([k, l]) => <button key={k} onClick={() => { const n = new URLSearchParams(sp); n.set("tab", k); setSp(n); }} className={cn("rounded-full px-3 py-1 text-xs font-semibold", tab === k ? "bg-white text-ink-950 shadow" : "text-txt-secondary")} data-testid={`msg-tab-${k}`}>{l}</button>)}</div></div>
      <div className="grid gap-3 md:grid-cols-3" data-testid="channels">{!ch ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />) : ch.map((c) => <ChannelCard key={c.channel} c={c} />)}</div>
      {tab === "reminders" ? <ReminderLog /> : <Card className="!p-0" testId="message-log">
        <div className="flex flex-wrap items-center gap-2 border-b border-warm-100 px-5 py-3 text-xs">{msgs && Object.entries(msgs.kpis).map(([k, v]) => <button key={k} onClick={() => { const n = new URLSearchParams(sp); status === k ? n.delete("status") : n.set("status", k); setSp(n); }} className={cn("flex items-center gap-1 rounded-full px-2 py-0.5", status === k && "ring-2 ring-gold")} data-testid={`kpi-${k}`}><StatusChip s={k} /><b className="tabular-nums">{v}</b></button>)}<button onClick={load} className="btn btn-ghost btn-sm ml-auto" data-testid="msg-refresh"><RefreshCw className="h-3.5 w-3.5" /></button></div>
        {!msgs ? <Skeleton className="h-40" /> : msgs.items.length === 0 ? <EmptyState title="No messages yet" hint="Reminders will appear here nightly — or use “Send reminder now” on an overdue booking." /> :
          <table className="w-full text-sm"><thead className="text-left text-[11px] uppercase tracking-wide text-txt-muted"><tr><th className="px-5 py-2">When</th><th className="px-5 py-2">Customer</th><th className="px-5 py-2">Template</th><th className="px-5 py-2">Channel · to</th><th className="px-5 py-2">Status</th><th className="px-5 py-2">Provider id / error</th><th className="px-5 py-2 text-right"></th></tr></thead>
            <tbody>{msgs.items.map((m) => <tr key={m.id} className="border-t border-warm-100 align-top" data-testid={`msg-row-${m.id}`}><td className="px-5 py-2 text-xs text-txt-secondary">{fmtDateTime(m.created_at)}</td><td className="px-5 py-2">{m.customer_id ? <Link to={`/customers/${m.customer_id}`} className="font-semibold text-ink-950 hover:text-gold">{m.customer_name}</Link> : m.customer_name}{m.booking_number && <div className="text-[11px] text-txt-muted">{m.booking_number}</div>}</td><td className="px-5 py-2 text-xs">{m.template_code}{m.threshold ? ` · day ${m.threshold}` : ""}</td><td className="px-5 py-2 text-xs">{m.channel || "—"} · {m.to || <span className="text-txt-muted">no contact</span>}</td><td className="px-5 py-2"><StatusChip s={m.status} testId={`msg-status-${m.id}`} /></td><td className="max-w-[260px] px-5 py-2 text-[11px] text-txt-secondary"><span className="line-clamp-2" title={m.error || m.provider_message_id}>{m.provider_message_id || m.error || "—"}</span></td>
              <td className="px-5 py-2 text-right"><div className="flex justify-end gap-0.5">{can("messaging.message.send") && m.status === "failed" && <button onClick={() => retry(m)} className="btn btn-ghost btn-sm text-[10px]" data-testid={`msg-retry-${m.id}`}>retry</button>}<HistoryButton entityType="message" entityId={m.id} label={m.subject} compact testId={`msg-history-${m.id}`} /></div></td></tr>)}</tbody></table>}
      </Card>}
    </div>
  );
}
