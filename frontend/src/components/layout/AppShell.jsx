import monogram from "@/assets/kkt-monogram.svg";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Send, BarChart3, Building2, ChevronLeft, ChevronRight, Database, Files, FileSignature, FileText, Funnel, Globe, HardHat, Home, KeyRound, LifeBuoy, LogOut, Menu, Plus, Receipt, Search, Settings, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { initials } from "@/lib/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/components/common/ChangePasswordDialog";
import { CommandPalette } from "@/components/common/CommandPalette";
import { VersionConflictDialog } from "@/components/common/VersionConflictDialog";
import { NotificationBell } from "@/components/common/NotificationBell";
import { prefetchRoute } from "@/lib/prefetch";
import { useDensity } from "@/hooks/useDensity";

const NAV = [
  { to: "/dashboard", label: "Home", icon: Home, perm: "masters.project.view" },
  { to: "/masters", label: "Masters", icon: Database, perm: "masters.*", match: ["/masters", "/master"] },
  { to: "/projects", label: "Projects", icon: Building2, perm: "masters.project.view", match: ["/projects", "/blocks", "/flats"] },
  { to: "/construction", label: "Construction", icon: HardHat, perm: "construction.update.view", match: ["/construction"] },
  { to: "/customers", label: "Customers", icon: UserRound, perm: "sales.customer.view", match: ["/customers"] },
  { to: "/leads", label: "Leads & Visits", icon: Funnel, perm: "sales.lead.view", match: ["/leads", "/site-visits"] },
  { to: "/bookings", label: "Bookings", icon: FileSignature, perm: "sales.booking.view", match: ["/bookings"] },
  { to: "/payments", label: "Payments", icon: Receipt, perm: "finance.payment.view", match: ["/payments", "/roznamcha"] },
  { to: "/demands", label: "Demands", icon: FileText, perm: "demands.register.view", match: ["/demands"] },
  { to: "/documents", label: "Documents", icon: Files, perm: "documents.document.view", match: ["/documents"] },
  { to: "/messaging", label: "Messaging", icon: Send, perm: "messaging.message.view", match: ["/messaging"] },
  { to: "/service-requests", label: "Service", icon: LifeBuoy, perm: "service.ticket.view", match: ["/service-requests"] },
  { to: "/reports", label: "Reports", icon: BarChart3, perm: "reports.*", match: ["/reports"] },
  { to: "/website/settings", label: "Website", icon: Globe, perm: "website.cms.view", match: ["/website"], surface: "public_website" },
  { to: "/settings", label: "Admin", icon: Settings, perm: "admin.settings.view", match: ["/settings", "/users", "/roles", "/audit", "/admin"] },
];
const QUICK = [
  ["Booking", "/bookings/new", "sales.booking.create"], ["Customer", "/customers?new=1", "sales.customer.create"], ["Payment", "/payments?new=1", "finance.payment.create"], ["Manual demand", "/demands?new=manual", "demands.register.create"],
  ["Lead", "/leads?new=1", "sales.lead.create"], ["Visit", "/site-visits?new=1", "sales.site_visit.create"], ["Document", "/documents?mode=generate", "documents.document.generate"], ["Hold", "/flats?hold=1", "inventory.hold.create"],
  ["Project", "/projects/new", "masters.project.create"], ["Tower", "/masters/towers?new=1", "masters.tower.create"], ["Floors / Flats", "/masters/towers?structure=1", "masters.flat.create"], ["Flat type", "/masters/m/flat-types?new=1", "masters.flat_type.create"],
  ["Stage", "/masters/m/construction-stages?new=1", "masters.construction_stage.create"], ["Stage plan", "/masters/stage-plans?new=1", "masters.stage_plan.create"], ["Payment plan", "/masters/payment-plans?new=1", "masters.payment_plan.create"], ["Construction update", "/construction", "construction.stage.update"],
  ["User", "/users?new=1", "admin.user.create"], ["Role", "/roles?new=1", "admin.role.create"],
];
const CRUMB = { dashboard: "Home", projects: "Projects", customers: "Customers", leads: "Leads", "site-visits": "Site Visits", bookings: "Bookings", payments: "Payments", roznamcha: "Roznamcha", reports: "Reports", demands: "Demands", documents: "Documents", "service-requests": "Service", website: "Website", settings: "Settings", users: "Users", roles: "Roles", audit: "Audit log", master: "Catalogues", blocks: "Tower", flats: "Inventory", new: "New", setup: "Setup", catalogues: "Catalogues", "flat-types": "Flat types", "floor-plan-templates": "Floor plans", "plc-types": "PLC types", "spec-categories": "Spec categories", "spec-items": "Spec items", "room-types": "Room types", "area-types": "Area types", "block-types": "Block types", amenities: "Amenities", "construction-stages": "Construction stages", "payment-plans": "Payment plans", "charge-types": "Charge types", "payment-modes": "Payment modes", "bank-accounts": "Bank accounts", "document-types": "Document types", "service-sla": "Service SLA", "construction-progress": "Construction progress", collections: "Collections", outstanding: "Outstanding", inventory: "Inventory", cheques: "Cheques", advances: "Advances", activity: "Activity", "sales-leads": "Sales & Leads", "upcoming-dues": "Upcoming dues", "demand-vs-collection": "Demand vs collection", cancellations: "Cancellations", "roznamcha-range": "Roznamcha range", "bank-receipts": "Bank receipts" };

function Sidebar({ collapsed, setCollapsed, mobile, onClose }) {
  const { can, company, user, surfaces } = useAuth();
  const navItems = useMemo(() => NAV.filter((n) => can(n.perm) && (!n.surface || surfaces?.[n.surface])), [can, surfaces]);
  const loc = useLocation();
  return (
    <aside className={cn("flex h-full flex-col bg-ink-950 text-warm-50", collapsed ? "w-[72px]" : "w-[260px]")} data-testid="sidebar">
      <div className="flex h-[72px] items-center gap-3 px-5">
        <img src={monogram} alt="KKT" className="h-9 w-9 shrink-0 rounded-xl" data-testid="sidebar-monogram" />
        {!collapsed && <div className="min-w-0"><p className="font-display text-lg leading-none tracking-wide">KKT Constructions</p><p className="mt-1 truncate text-[11px] text-warm-200/75">{company?.tagline || "Real estate ERP"}</p></div>}
        {mobile && <button onClick={onClose} className="ml-auto text-warm-200/70" aria-label="Close menu"><X className="h-5 w-5" /></button>}
      </div>
      <div className="hero-hair mx-5" />
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
        {navItems.map((n) => {
          const active = loc.pathname.startsWith(n.to) || (n.match || []).some((m) => loc.pathname.startsWith(m));
          return <NavLink key={n.to} to={n.to} onClick={onClose} onMouseEnter={() => prefetchRoute(n.to)} onFocus={() => prefetchRoute(n.to)} className={cn("sb-item", active && "active", collapsed && "justify-center px-0")} data-testid={`nav-${n.label.toLowerCase().replace(/[^a-z]+/g, "-")}`} title={n.label}><n.icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />{!collapsed && <span>{n.label}</span>}</NavLink>;
        })}
      </nav>
      <div className="border-t border-white/5 p-3">
        <div className={cn("flex items-center gap-3 rounded-xl px-2 py-2", collapsed && "justify-center")}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-700 text-xs font-bold text-gold-400">{initials(user?.name)}</span>
          {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user?.name}</p><p className="truncate text-[11px] text-warm-200/75">{user?.role_name}</p></div>}
        </div>
        {!mobile && <button onClick={() => setCollapsed(!collapsed)} className="mt-1 flex h-9 w-full items-center justify-center rounded-lg text-warm-200/75 hover:bg-white/5 hover:text-warm-50" data-testid="sidebar-toggle" aria-label="Toggle sidebar">{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>}
      </div>
    </aside>
  );
}

function Crumbs() {
  const parts = useLocation().pathname.split("/").filter(Boolean);
  return (
    <nav className="hidden min-w-0 items-center gap-1 text-[13px] text-txt-secondary md:flex" aria-label="Breadcrumb">
      {parts.slice(0, 3).map((p, i) => <span key={parts.slice(0, i + 1).join("/")} className="flex items-center gap-1">{i > 0 && <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />}<Link to={"/" + parts.slice(0, i + 1).join("/")} className={cn("truncate hover:text-ink-950", i === parts.length - 1 && "font-semibold text-ink-950")}>{CRUMB[p] || (p.length > 20 ? "Detail" : p)}</Link></span>)}
    </nav>
  );
}

function TopBar({ onMenu }) {
  const { user, logout, can } = useAuth();
  const quickItems = useMemo(() => QUICK.filter((q) => can(q[2])), [can]);
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-warm-200/70 bg-warm-50/85 px-4 backdrop-blur-md md:px-8" data-testid="topbar">
      <button onClick={onMenu} className="grid h-10 w-10 place-items-center rounded-[10px] border border-warm-200 bg-warm-100 md:hidden" aria-label="Menu" data-testid="mobile-menu"><Menu className="h-5 w-5" strokeWidth={1.75} /></button>
      <Crumbs />
      <div className="ml-auto flex items-center gap-2">
        <button onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))} className="hidden h-10 w-64 items-center gap-2 rounded-[10px] border border-warm-200 bg-warm-100 px-3.5 text-sm text-txt-secondary transition-colors hover:border-gold hover:bg-white md:flex" data-testid="search-pill"><Search className="h-4 w-4" strokeWidth={1.75} /><span className="flex-1 text-left">Search…</span><kbd className="rounded-md border border-warm-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-txt-secondary">⌘K</kbd></button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="btn btn-primary h-10 !px-4" data-testid="quick-new"><Plus className="h-4 w-4" /><span className="hidden sm:inline">New</span></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="grid w-[420px] grid-cols-2 gap-0.5 rounded-xl p-2" data-testid="quick-new-menu">{quickItems.map(([l, to]) => <DropdownMenuItem key={l} onClick={() => navigate(to)} data-testid={`quick-${l.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{l}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="grid h-10 w-10 place-items-center rounded-full bg-ink-950 text-xs font-bold text-gold-400" data-testid="user-menu">{initials(user?.name)}</button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-xl">
            <DropdownMenuLabel><p className="text-sm font-semibold">{user?.name}</p><p className="text-xs font-normal text-txt-muted">{user?.email} · {user?.role_name}</p></DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPwOpen(true)} data-testid="menu-change-password"><KeyRound className="mr-2 h-4 w-4" />Change password</DropdownMenuItem>
            <DropdownMenuItem onClick={async () => { await logout(); navigate("/login"); }} data-testid="menu-logout"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </header>
  );
}

export default function AppShell() {
  // localStorage: sidebar collapsed flag — non-sensitive UI preference (CR-7)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("kkt_sb") === "1");
  const { user, company } = useAuth();
  const [mobile, setMobile] = useState(false);
  const loc = useLocation();
  useEffect(() => { localStorage.setItem("kkt_sb", collapsed ? "1" : "0"); }, [collapsed]);
  useEffect(() => { setMobile(false); }, [loc.pathname]);
  const [density] = useDensity();
  return (
    <div className={cn("v2 min-h-screen", density === "compact" && "density-compact")} data-density={density}>
      <div className="fixed inset-y-0 left-0 z-30 hidden md:block"><Sidebar collapsed={collapsed} setCollapsed={setCollapsed} /></div>
      {mobile && <div className="fixed inset-0 z-40 md:hidden"><div className="absolute inset-0 bg-ink-950/60" onClick={() => setMobile(false)} /><div className="absolute inset-y-0 left-0"><Sidebar mobile onClose={() => setMobile(false)} /></div></div>}
      <div className={cn("min-h-screen transition-[padding] duration-200", collapsed ? "md:pl-[72px]" : "md:pl-[260px]")}>
        <TopBar onMenu={() => setMobile(true)} />
        <main key={loc.pathname} className="page-enter mx-auto w-full min-w-0 max-w-[1400px] overflow-x-clip p-4 md:p-8"><div className="print-brand"><span className="font-display text-xl">KKT · {company?.name || ""}</span><span className="text-xs text-txt-secondary">Printed {new Date().toLocaleDateString("en-IN")} by {user?.name}</span></div><Outlet /></main>
      </div>
      <CommandPalette />
      <VersionConflictDialog />
    </div>
  );
}
