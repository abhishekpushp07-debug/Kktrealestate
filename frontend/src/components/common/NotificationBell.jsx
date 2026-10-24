import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import api from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function NotificationBell() {
  const [data, setData] = useState({ items: [], unread: 0 });
  const nav = useNavigate();
  const load = () => api.get("/notifications", { params: { limit: 20 } }).then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const open = async (n) => { if (!n.read) { await api.post(`/notifications/${n.id}/read`); } load(); if (n.link) nav(n.link.replace(/^\/erp(\/|$)/, "/")); };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 hover:bg-slate-50" aria-label="Notifications" data-testid="notif-bell">
          <Bell className="h-4 w-4 text-navy" />{data.unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy" data-testid="notif-count">{data.unread}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0" data-testid="notif-panel">
        <div className="flex items-center justify-between border-b px-3 py-2"><p className="text-sm font-bold text-navy">Notifications</p>{data.unread > 0 && <button onClick={async () => { await api.post("/notifications/read-all"); load(); }} className="flex items-center gap-1 text-xs text-slate-500 hover:text-navy" data-testid="notif-read-all"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}</div>
        <div className="max-h-96 overflow-y-auto">{data.items.length === 0 ? <p className="p-4 text-center text-xs text-slate-500">You're all caught up.</p> : data.items.map((n) => <button key={n.id} onClick={() => open(n)} className={`block w-full border-b px-3 py-2.5 text-left hover:bg-slate-50 ${n.read ? "" : "bg-gold/10"}`} data-testid={`notif-${n.kind}`}><p className="text-sm font-semibold text-navy">{n.title}</p><p className="text-xs text-slate-600">{n.body}</p><p className="mt-0.5 text-[10px] text-slate-400">{fmtDateTime(n.created_at)}</p></button>)}</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
