import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Grid3X3, Layers, LayoutDashboard, Database, Users, History, Settings, ShieldCheck, Home, Clock, Plus, IndianRupee, PhoneCall, Hammer, Receipt, UserPlus, Keyboard, LifeBuoy, BarChart3 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { inrShort } from "@/lib/format";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PAGES = [
  ["Home", "/dashboard", LayoutDashboard, "masters.project.view"], ["Messaging · message log", "/messaging", LayoutDashboard, "messaging.message.view"], ["Messaging · reminder log", "/messaging?tab=reminders", LayoutDashboard, "messaging.message.view"], ["Masters · Message templates", "/masters/templates", Database, "masters.template.view"], ["Masters · Company & letterhead · Reminders", "/masters/company", Database, "masters.company.view"], ["Projects", "/projects", Building2, "masters.project.view"], ["Customers", "/customers", Users, "sales.customer.view"], ["Bookings", "/bookings", Grid3X3, "sales.booking.view"],
  ["Payments", "/payments", IndianRupee, "finance.payment.view"], ["Leads & Visits", "/leads", PhoneCall, "sales.lead.view"], ["Service", "/service-requests", LifeBuoy, "service.ticket.view"], ["Reports", "/reports", BarChart3, "reports.collections.view"],
  ["Catalogues", "/settings/catalogues", Database, "masters.catalogue.view"], ["Users", "/users", Users, "admin.user.view"], ["Roles", "/roles", ShieldCheck, "admin.role.edit"], ["Audit Log", "/audit", History, "admin.audit.view"], ["Settings", "/settings", Settings, "admin.settings.edit"],
  ["Report · Collections (Jama)", "/reports/collections-v2", BarChart3, "reports.collections.view"], ["Report · Outstanding & Ageing", "/reports/outstanding-v2", BarChart3, "reports.outstanding.view"], ["Report · Demand vs Collection", "/reports/demand-vs-collection", BarChart3, "reports.demand_vs_collection.view"],
  ["Report · Cash vs Account Split", "/reports/cash-vs-account", BarChart3, "reports.cash_vs_account.view"], ["Report · Cheque Register", "/reports/cheques", BarChart3, "reports.cheque_register.view"], ["Report · Receivables Forecast", "/reports/receivables-forecast", BarChart3, "reports.receivables_forecast.view"],
  ["Report · Cancellations & Refunds", "/reports/cancellations", BarChart3, "reports.cancellations_refunds.view"], ["Report · Bank-wise Receipts", "/reports/bank-receipts", BarChart3, "reports.bank_wise.view"], ["Report · Other Charges", "/reports/other-charges", BarChart3, "reports.other_charges.view"],
  ["Report · Roznamcha Summary", "/reports/roznamcha-summary", BarChart3, "reports.roznamcha.view"], ["Report · Project Sales & Inventory", "/reports/inventory", BarChart3, "reports.inventory.view"], ["Report · Lead Funnel", "/reports/sales-leads", BarChart3, "reports.lead_funnel.view"],
  ["Report · Site Visit Conversion", "/reports/site-visits", BarChart3, "reports.site_visit_conversion.view"], ["Report · Sales Team Performance", "/reports/sales-team", BarChart3, "reports.sales_team.view"], ["Report · Construction vs Plan", "/reports/construction-vs-plan", BarChart3, "reports.construction_vs_plan.view"],
  ["Report · Service SLA", "/reports/service-sla", BarChart3, "reports.service_sla.view"], ["Report · Audit Trail", "/reports/activity", BarChart3, "reports.audit.view"], ["Report · Data Quality", "/reports/data-quality", BarChart3, "reports.data_quality.view"],
  ["Report · Inventory by Category / Status / Display", "/reports/inventory-control", BarChart3, "reports.inventory_control.view"], ["Report · Landowner Share", "/reports/landowner-share", BarChart3, "reports.inventory_control.view"],
  ["Report · Hold Register", "/reports/hold-register", BarChart3, "reports.inventory_control.view"], ["Report · Masked Inventory", "/reports/masked-inventory", BarChart3, "inventory.real_status.view"],
];
const ACTIONS = [
  ["New booking", "/bookings/new", Plus, "sales.booking.create"], ["Post payment", "/payments?post=1", IndianRupee, "finance.payment.create"], ["New customer", "/customers/new", UserPlus, "sales.customer.create"],
  ["New lead", "/leads?new=1", PhoneCall, "sales.lead.create"], ["Log a call", "/customers?log=1", PhoneCall, "sales.customer.create"], ["Mark construction stage", "/projects", Hammer, "masters.tower.edit"], ["Roznamcha (today)", "/payments?tab=roznamcha", Receipt, "finance.payment.view"],
];
export const GO = { p: ["/projects", "Projects"], c: ["/customers", "Customers"], b: ["/bookings", "Bookings"], h: ["/dashboard", "Home"], y: ["/payments", "Payments"], l: ["/leads", "Leads"], s: ["/service-requests", "Service"], r: ["/reports", "Reports"] };
const ICON = { projects: Building2, blocks: Layers, flats: Home, users: Users, flat_types: Database };
const LABEL = { projects: "Projects", blocks: "Blocks", flats: "Flats", users: "Users", flat_types: "Flat types" };
// localStorage: recent palette destinations (labels + routes) — non-sensitive (CR-7)
const pushRecent = (item) => { const r = JSON.parse(localStorage.getItem("kkt:recent") || "[]").filter((x) => x.to !== item.to); localStorage.setItem("kkt:recent", JSON.stringify([item, ...r].slice(0, 6))); };
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;

export function ShortcutsSheet({ open, onOpenChange }) {
  const rows = [["⌘ K", "Command palette — pages, records, actions"], ["?", "This shortcuts sheet"], ["g then p / c / b / h", "Go to Projects / Customers / Bookings / Home"], ["g then y / l / s / r", "Go to Payments / Leads / Service / Reports"], ["← →", "Move a focused kanban card between columns"], ["Esc", "Close sheets and dialogs"]];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="v2 max-w-md" data-testid="shortcuts-sheet"><DialogHeader><DialogTitle className="flex items-center gap-2 font-display text-xl"><Keyboard className="h-5 w-5" />Keyboard shortcuts</DialogTitle></DialogHeader>
        <ul className="divide-y divide-warm-100 text-sm">{rows.map(([k, d]) => <li key={k} className="flex items-center justify-between gap-4 py-2.5"><span className="text-txt-secondary">{d}</span><kbd className="rounded-md border border-warm-200 bg-warm-100 px-2 py-0.5 font-mono text-xs text-ink-950">{k}</kbd></li>)}</ul>
      </DialogContent>
    </Dialog>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState([]);
  const navigate = useNavigate();
  const { can } = useAuth();
  const actions = useMemo(() => ACTIONS.filter(([, , , p]) => can(p)), [can]);
  const pages = useMemo(() => PAGES.filter(([, , , p]) => can(p)), [can]);
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {  // Ctrl/Cmd+S submits the nearest open form instead of "Save page"
        const form = document.activeElement?.closest?.("form") || document.querySelector("[role=dialog] form, form[data-save-on-shortcut]");
        if (form) { e.preventDefault(); form.requestSubmit(); }
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {  // `/` focuses the first search box on the page
        const s = document.querySelector("main input[type=search], main input[data-search], main input[placeholder*='Search' i], input[type=search], input[placeholder*='Search' i]");
        if (s) { e.preventDefault(); s.focus(); s.select?.(); }
        return;
      }
      if (e.key === "?") { e.preventDefault(); setHelp((h) => !h); return; }
      if (e.key === "g") { pendingG = Date.now(); return; }
      if (pendingG && Date.now() - pendingG < 1200 && GO[e.key]) { e.preventDefault(); pendingG = 0; navigate(GO[e.key][0]); return; }
      pendingG = 0;
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey); window.addEventListener("kkt:open-palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("kkt:open-palette", onOpen); };
  }, [navigate]);
  useEffect(() => {
    if (!q.trim()) { setGroups([]); return; }
    const t = setTimeout(() => api.get("/search", { params: { q: q.trim(), limit: 6 } }).then((r) => setGroups(r.data.groups)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  const go = (to, label) => { setOpen(false); setQ(""); if (label) pushRecent({ to, label }); navigate(to); };
  const recent = JSON.parse(localStorage.getItem("kkt:recent") || "[]");
  const href = (type, x) => type === "projects" ? `/projects/${x.id}` : type === "blocks" ? `/blocks/${x.id}` : type === "flats" ? `/blocks/${x.block_id}?flat=${x.id}` : type === "users" ? "/users" : "/master/flat-types";
  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, records or actions…  (⌘K · ? for shortcuts)" value={q} onValueChange={setQ} data-testid="command-palette-input" />
        <CommandList data-testid="command-palette-list">
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Actions">
            {actions.map(([l, to, Icon]) => <CommandItem key={to} value={`action ${l}`} onSelect={() => go(to)} data-testid={`palette-action-${l.toLowerCase().replace(/[^a-z]+/g, "-")}`}><Icon className="mr-2 h-4 w-4 text-gold-hover" />{l}</CommandItem>)}
          </CommandGroup>
          {!q.trim() && recent.length > 0 && <CommandGroup heading="Recent">
            {recent.map((r) => <CommandItem key={r.to} value={`recent ${r.label}`} onSelect={() => go(r.to, r.label)} data-testid="palette-recent"><Clock className="mr-2 h-4 w-4 text-txt-secondary" />{r.label}</CommandItem>)}
          </CommandGroup>}
          <CommandGroup heading="Pages">
            {pages.map(([l, to, Icon]) => <CommandItem key={to} value={`page ${l}`} onSelect={() => go(to)} data-testid={`palette-page-${l.toLowerCase().replace(/[^a-z]+/g, "-")}`}><Icon className="mr-2 h-4 w-4 text-ink-950" />{l}</CommandItem>)}
          </CommandGroup>
          {groups.map((g) => { const Icon = ICON[g.type] || Home; return (
            <CommandGroup key={g.type} heading={LABEL[g.type] || g.type}>
              {g.items.map((x) => <CommandItem key={x.id} value={`${g.type} ${x.name || x.flat_number || x.email} ${x.code || ""} ${x.id}`} onSelect={() => go(href(g.type, x), `${x.name || x.flat_number || x.email}${x.code ? ` · ${x.code}` : ""}`)} data-testid={`palette-result-${x.id}`}>
                <Icon className="mr-2 h-4 w-4 text-ink-950" /><span className="font-semibold">{x.name || x.flat_number}</span><span className="ml-2 text-xs text-txt-secondary">{x.code || x.project_code || x.email}{x.status ? ` · ${x.status}` : ""}{x.price ? ` · ${inrShort(x.price)}` : ""}</span>
              </CommandItem>)}
            </CommandGroup>); })}
        </CommandList>
      </CommandDialog>
      <ShortcutsSheet open={help} onOpenChange={setHelp} />
    </>
  );
}
