import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { NotificationBell } from "@/components/common/NotificationBell";
import { BarChart3, Building2, ChevronLeft, ChevronRight, Database, Grid3X3, LayoutDashboard, LogOut, Search, Settings, ShieldCheck, History, Users, KeyRound, Menu, UserRound, Funnel, FileSignature, Receipt, BookOpenText, Globe , LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { initials } from "@/lib/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChangePasswordDialog } from "@/components/common/ChangePasswordDialog";
import { CommandPalette } from "@/components/common/CommandPalette";
import { VersionConflictDialog } from "@/components/common/VersionConflictDialog";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "project.read" },
  { to: "/projects", label: "Projects", icon: Building2, perm: "project.read" },
  { to: "/flats", label: "Inventory", icon: Grid3X3, perm: "project.read" },
  { to: "/customers", label: "Customers", icon: UserRound, perm: "customer.read", match: "/customers" },
  { to: "/leads", label: "Leads", icon: Funnel, perm: "lead.read" },
  { to: "/bookings", label: "Bookings", icon: FileSignature, perm: "booking.read", match: "/bookings" },
  { to: "/payments", label: "Payments", icon: Receipt, perm: "payment.read" },
  { to: "/roznamcha", label: "Roznamcha", icon: BookOpenText, perm: "payment.read" },
  { to: "/reports", label: "Reports", icon: BarChart3, perm: "report.view", match: "/reports" },
  { to: "/service-requests", label: "Service Requests", icon: LifeBuoy, perm: "service.read", match: "/service-requests" },
  { to: "/master/flat-types", label: "Master Data", icon: Database, perm: "master.read", match: "/master" },
  { to: "/users", label: "Users", icon: Users, perm: "users.manage" },
  { to: "/roles", label: "Roles", icon: ShieldCheck, perm: "roles.manage" },
  { to: "/audit", label: "Audit Log", icon: History, perm: "audit.view" },
  { to: "/settings", label: "Settings", icon: Settings, perm: "settings.manage" },
  { to: "/website/settings", label: "Website", icon: Globe, perm: "cms.read", match: "/website" },
];

function Sidebar({ collapsed, setCollapsed }) {
  const { can, company } = useAuth();
  return (
    <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col bg-navy text-white transition-[width] duration-200 md:flex", collapsed ? "w-[72px]" : "w-[260px]")} data-testid="sidebar">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold font-extrabold text-navy">K</div>
        {!collapsed && <div className="min-w-0"><p className="truncate text-base font-extrabold tracking-wide">KKT</p><p className="truncate text-[11px] text-slate-400">{company?.name || "Real Estate ERP"}</p></div>}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV.filter((n) => can(n.perm)).map((n) => (
          <NavLink key={n.to} to={n.to} data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
            className={({ isActive }) => cn("nav-item", (isActive || (n.match && window.location.pathname.startsWith(n.match))) && "active", collapsed && "justify-center px-0")} title={n.label}>
            <n.icon className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span>{n.label}</span>}
          </NavLink>
        ))}
      </nav>
      <button onClick={() => setCollapsed(!collapsed)} className="flex h-12 items-center justify-center border-t border-white/10 text-slate-400 hover:text-white" data-testid="sidebar-toggle">
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}

function TopBar({ onMenu }) {
  const { user, company, logout } = useAuth();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-6" data-testid="topbar">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} data-testid="mobile-menu-btn"><Menu className="h-5 w-5" /></Button>
      <div className="hidden items-center gap-2 sm:flex">
        <span className="text-lg font-extrabold text-navy">KKT</span>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-semibold text-slate-600" data-testid="topbar-company-name">{company?.name}</span>
      </div>
      <button onClick={() => window.dispatchEvent(new Event("kkt:open-palette"))} className="relative ml-auto hidden w-full max-w-md md:block" data-testid="global-search">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
        <div className="flex h-10 w-full items-center rounded-full border border-slate-200 bg-ivory pl-9 pr-2 text-left text-sm text-slate-600 transition-colors hover:border-gold"><span className="min-w-0 flex-1 truncate">Search projects, flats, customers…</span><kbd className="ml-2 shrink-0 rounded-full border border-slate-300 bg-white px-2 py-0.5 font-sans text-[10px] font-semibold leading-4 text-slate-600">⌘K</kbd></div>
      </button>
      <div className="ml-auto md:ml-2"><NotificationBell /></div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 hover:bg-slate-50 md:ml-2" data-testid="user-menu-trigger">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{initials(user?.name)}</span>
            <span className="hidden text-left sm:block"><span className="block text-xs font-semibold leading-none text-navy">{user?.name}</span><span className="block text-[10px] text-gold-hover">{user?.role_name}</span></span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel><p className="text-sm font-semibold">{user?.name}</p><p className="text-xs font-normal text-slate-500">{user?.email}</p></DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPwOpen(true)} data-testid="menu-change-password"><KeyRound className="mr-2 h-4 w-4" />Change password</DropdownMenuItem>
          <DropdownMenuItem onClick={async () => { await logout(); navigate("/login"); }} data-testid="menu-logout"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </header>
  );
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { can } = useAuth();
  return (
    <div className="min-h-screen bg-surface">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="h-full w-64 bg-navy p-4 text-white" onClick={(e) => e.stopPropagation()}>
            <p className="mb-4 text-lg font-extrabold">KKT</p>
            {NAV.filter((n) => can(n.perm)).map((n) => <NavLink key={n.to} to={n.to} onClick={() => setMobileOpen(false)} className={({ isActive }) => cn("nav-item", isActive && "active")}><n.icon className="h-4 w-4" />{n.label}</NavLink>)}
          </div>
        </div>
      )}
      <div className={cn("transition-[margin] duration-200", collapsed ? "md:ml-[72px]" : "md:ml-[260px]")}>
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="p-4 md:p-6 lg:p-8"><Outlet /></main>
      </div>
      <CommandPalette />
      <VersionConflictDialog />
    </div>
  );
}
