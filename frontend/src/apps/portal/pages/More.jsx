import { Link } from "react-router-dom";
import { Bell, ChevronRight, FileText, Home, Landmark, LogOut, Phone, UserRound } from "lucide-react";
import { usePortalAuth } from "../PortalAuth";
import { PageTitle, useBase } from "../PortalShell";
import { useBookings } from "../hooks";

export default function More() {
  const { me, logout } = usePortalAuth();
  const base = useBase();
  const { data: bookings } = useBookings();
  const rows = [
    ...(bookings || []).map((b) => [`My Flat ${b.flat_number}`, `${b.project_name} · ${b.booking_number}`, Home, `${base}/flat/${b.id}`, `more-flat-${b.booking_number}`]),
    ["Documents", "Allotment, statement, shared files", FileText, `${base}/documents`, "more-documents"],
    ["Notices", me?.unread_notices ? `${me.unread_notices} unread` : "Updates from KKT", Bell, `${base}/notices`, "more-notices"],
    ["Bank details", "Where to transfer", Landmark, `${base}/payments?tab=bank`, "more-bank"],
    ["Profile & security", "Contact details, password", UserRound, `${base}/profile`, "more-profile"],
  ];
  return (
    <div data-testid="portal-more">
      <PageTitle title="More" sub={me?.customer?.full_name} />
      <div className="pcard px-5 fade-up">{rows.map(([t, s, I, to, tid]) => <Link key={tid} to={to} className="row min-h-16" data-testid={tid}><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#F8F6F1] text-[#0B1F3A]"><I className="h-5 w-5" /></span><div><p className="font-bold text-[#0B1F3A]">{t}</p><p className="text-xs text-slate-500">{s}</p></div></div><ChevronRight className="h-4 w-4 text-slate-400" /></Link>)}</div>
      {me?.relationship_manager && <div className="pcard mt-4 flex items-center gap-4 p-4 fade-up"><div className="grid h-11 w-11 place-items-center rounded-full bg-[#0B1F3A] font-bold text-[#C9A227]">{me.relationship_manager.name[0]}</div><div className="min-w-0 flex-1"><p className="text-xs text-slate-500">Relationship Manager</p><p className="truncate font-bold text-[#0B1F3A]">{me.relationship_manager.name}</p></div>{me.relationship_manager.phone && <a href={`tel:${me.relationship_manager.phone}`} className="pbtn pbtn-sm"><Phone className="h-4 w-4" />Call</a>}</div>}
      <button onClick={logout} className="pbtn pbtn-ghost mt-6 w-full" data-testid="more-logout"><LogOut className="h-4 w-4" />Sign out</button>
      <p className="mt-6 text-center text-xs text-slate-400">{me?.company?.legal_name || me?.company?.name} · Customer portal</p>
    </div>
  );
}
