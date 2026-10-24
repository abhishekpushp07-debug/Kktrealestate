import { Bell, Pin } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Empty, PageTitle, Skeleton } from "../PortalShell";
import { fmtDate } from "../hooks";
import papi from "../api";

export default function Notices() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["p-notices"], queryFn: () => papi.get("/notices").then((r) => r.data) });
  const markRead = async (n) => { if (n.read) return; await papi.post(`/notices/${n.id}/read`); qc.invalidateQueries({ queryKey: ["p-notices"] }); };
  if (isLoading) return <div className="space-y-4"><Skeleton h={48} /><Skeleton h={160} /></div>;
  return (
    <div data-testid="portal-notices">
      <PageTitle title="Notices" sub={data?.unread ? `${data.unread} unread` : "You're up to date"} />
      {data?.items?.length ? <div className="space-y-3">{data.items.map((n) => <article key={n.id} onClick={() => markRead(n)} className={`pcard cursor-pointer p-5 fade-up ${n.read ? "" : "border-l-4 border-l-[#C9A227]"}`} data-testid={`notice-${n.id}`}><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">{n.pinned && <Pin className="h-3 w-3 text-[#C9A227]" />}{n.project_names?.length ? n.project_names.join(", ") : "All projects"} · {fmtDate(n.publish_at)}{n.expires_at ? ` · till ${fmtDate(n.expires_at)}` : ""}{!n.read && <span className="pchip bg-[#FFF9E6] text-[#8a6d12]">New</span>}</div><h2 className="serif mt-1 text-2xl font-semibold text-[#0B1F3A]">{n.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{n.body}</p></article>)}</div> : <Empty title="No notices" icon={Bell} />}
    </div>
  );
}
