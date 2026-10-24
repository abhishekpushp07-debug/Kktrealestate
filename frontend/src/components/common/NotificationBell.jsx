import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import api from "@/lib/api";
import { fmtRelative, fmtDateTime } from "@/lib/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/* Polls unread-count only (30 s); the full list loads when the panel opens. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const count = useQuery({ queryKey: ["notif-unread"], queryFn: () => api.get("/notifications/unread-count").then((r) => r.data.unread), refetchInterval: 30000, staleTime: 25000 });
  const list = useQuery({ queryKey: ["notif-list"], queryFn: () => api.get("/notifications", { params: { limit: 20 } }).then((r) => r.data), enabled: open, staleTime: 10000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["notif-unread"] }); qc.invalidateQueries({ queryKey: ["notif-list"] }); };
  const unread = count.data || 0;
  const openItem = async (n) => { if (!n.read) await api.post(`/notifications/${n.id}/read`); refresh(); if (n.link) nav(n.link.replace(/^\/erp(\/|$)/, "/")); };
  const items = list.data?.items || [];
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-navy transition-colors hover:bg-ivory" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} data-testid="notif-bell">
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white" data-testid="notif-count">{unread > 9 ? "9+" : unread}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] max-w-[92vw] p-0" data-testid="notif-panel">
        <div className="flex items-center justify-between border-b px-4 py-2.5"><p className="text-sm font-semibold text-navy">Notifications{unread > 0 && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">{unread} unread</span>}</p>{unread > 0 && <button onClick={async () => { await api.post("/notifications/read-all"); refresh(); }} className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-navy" data-testid="notif-read-all"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}</div>
        <div className="max-h-[420px] overflow-y-auto">{list.isPending ? <p className="p-4 text-center text-xs text-slate-500">Loading…</p> : items.length === 0 ? <p className="p-6 text-center text-sm text-slate-600">You're all caught up.</p> : items.map((n) => <button key={n.id} onClick={() => openItem(n)} className={`block w-full border-b px-4 py-3 text-left transition-colors hover:bg-ivory ${n.read ? "" : "bg-gold-light/60"}`} data-testid={`notif-${n.kind}`}><p className="text-sm font-semibold leading-snug text-navy">{n.title}</p><p className="mt-0.5 text-xs leading-snug text-slate-600">{n.body}</p><p className="mt-1 text-[11px] text-slate-500" title={fmtDateTime(n.created_at)}>{fmtRelative(n.created_at)}</p></button>)}</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
