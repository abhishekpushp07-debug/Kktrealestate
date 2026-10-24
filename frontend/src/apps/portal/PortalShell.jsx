import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, HardHat, Home, LifeBuoy, Menu, Wallet } from "lucide-react";
import { usePortalAuth } from "./PortalAuth";
import { useQuery } from "@tanstack/react-query";
import papi from "./api";

export const NAV = [
  { to: "", label: "Home", icon: Home, end: true },
  { to: "payments", label: "Payments", icon: Wallet },
  { to: "construction", label: "Construction", icon: HardHat },
  { to: "requests", label: "Requests", icon: LifeBuoy },
  { to: "more", label: "More", icon: Menu },
];

export function useBase() {
  const loc = useLocation();
  return loc.pathname.startsWith("/portal") ? "/portal" : "";
}

export function Skeleton({ h = 80, className = "" }) { return <div className={`skel ${className}`} style={{ height: h }} aria-hidden="true" />; }

export function Empty({ title, hint, icon: Icon }) {
  return <div className="pcard flex flex-col items-center px-6 py-10 text-center fade-up" data-testid="portal-empty">{Icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#F8F6F1] text-[#0B1F3A]"><Icon className="h-6 w-6" /></div>}<p className="font-bold text-[#0B1F3A]">{title}</p>{hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}</div>;
}

export function PageTitle({ title, sub, right }) {
  return <div className="mb-4 flex items-end justify-between gap-3 fade-up"><div><h1 className="serif text-3xl font-semibold leading-tight text-[#0B1F3A] sm:text-4xl">{title}</h1>{sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}</div>{right}</div>;
}

export default function PortalShell() {
  const base = useBase();
  const { me } = usePortalAuth();
  const { data: notices } = useQuery({ queryKey: ["p-notices"], queryFn: () => papi.get("/notices").then((r) => r.data), staleTime: 60_000 });
  const unread = notices?.unread ?? me?.unread_notices ?? 0;
  return (
    <div className="portal pb-24 md:pb-10" data-testid="portal-shell">
      <header className="sticky top-0 z-30 border-b border-[rgba(11,31,58,0.08)] bg-[#F8F6F1]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to={`${base}/`} className="flex items-center gap-2.5" data-testid="portal-logo"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#0B1F3A] text-sm font-extrabold text-[#C9A227]">K</span><span className="serif text-xl font-semibold text-[#0B1F3A]">{me?.company?.name || "KKT"} <span className="text-[#C9A227]">Home</span></span></Link>
          <nav className="hidden items-center gap-1 md:flex" data-testid="portal-topnav">
            {NAV.map((n) => <NavLink key={n.label} to={`${base}/${n.to}`} end={n.end} className={({ isActive }) => `rounded-full px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-[#0B1F3A] text-white" : "text-slate-600 hover:bg-white"}`} data-testid={`topnav-${n.label.toLowerCase()}`}>{n.label}</NavLink>)}
          </nav>
          <Link to={`${base}/notices`} className="relative grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm" aria-label="Notices" data-testid="notices-bell"><Bell className="h-5 w-5 text-[#0B1F3A]" />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#C9A227] px-1 text-[10px] font-extrabold text-[#0B1F3A]" data-testid="notices-unread-badge">{unread}</span>}</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-5 sm:px-6"><Outlet /></main>
      <nav className="bottom-nav md:hidden" data-testid="portal-bottomnav">
        {NAV.map((n) => <NavLink key={n.label} to={`${base}/${n.to}`} end={n.end} data-testid={`bottomnav-${n.label.toLowerCase()}`}><n.icon className="h-5 w-5" />{n.label}</NavLink>)}
      </nav>
    </div>
  );
}
