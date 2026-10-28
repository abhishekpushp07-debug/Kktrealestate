import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Grid3X3, LayoutDashboard, Database, Users, History, Settings, ShieldCheck, Plus, IndianRupee, PhoneCall, Hammer, Receipt, UserPlus, Keyboard, LifeBuoy, BarChart3 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { CommandDialog, CommandEmpty, CommandInput, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GO, useKeyboardNav, usePaletteSearch } from "./palette/usePaletteHooks";
import { PaletteResults } from "./palette/PaletteResults";

export { GO };

const PAGES = [
  ["Home", "/dashboard", LayoutDashboard, "masters.project.view"], ["Messaging · message log", "/messaging", LayoutDashboard, "messaging.message.view"], ["Messaging · reminder log", "/messaging?tab=reminders", LayoutDashboard, "messaging.message.view"], ["Masters · Message templates", "/masters/templates", Database, "masters.template.view"], ["Masters · Company & letterhead · Reminders", "/masters/company", Database, "masters.company.view"], ["Projects", "/projects", Building2, "masters.project.view"], ["Customers", "/customers", Users, "sales.customer.view"], ["Bookings", "/bookings", Grid3X3, "sales.booking.view"],
  ["Payments", "/payments", IndianRupee, "finance.payment.view"], ["Leads & Visits", "/leads", PhoneCall, "sales.lead.view"], ["Service", "/service-requests", LifeBuoy, "service.ticket.view"], ["Reports", "/reports", BarChart3, "reports.collections.view"],
  ["Catalogues", "/settings/catalogues", Database, "masters.catalogue.view"], ["Users", "/users", Users, "admin.user.view"], ["Roles", "/roles", ShieldCheck, "admin.role.edit"], ["Audit Log", "/audit", History, "admin.audit.view"], ["Settings", "/settings", Settings, "admin.settings.edit"],
  ["Report · Collections (Received)", "/reports/collections-v2", BarChart3, "reports.collections.view"], ["Report · Outstanding & Ageing", "/reports/outstanding-v2", BarChart3, "reports.outstanding.view"], ["Report · Demand vs Collection", "/reports/demand-vs-collection", BarChart3, "reports.demand_vs_collection.view"],
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
  ["New lead", "/leads?new=1", PhoneCall, "sales.lead.create"], ["Log a call", "/customers?log=1", PhoneCall, "sales.customer.create"], ["Mark construction stage", "/construction", Hammer, "construction.stage.update"], ["Roznamcha (today)", "/payments?tab=roznamcha", Receipt, "finance.payment.view"],
  ["Raise manual demand", "/demands?new=manual", Plus, "demands.register.create"], ["Generate document", "/documents?mode=generate", Plus, "documents.document.generate"], ["Place a hold", "/flats?hold=1", Plus, "inventory.hold.create"],
  ["New project", "/projects/new", Plus, "masters.project.create"], ["New tower", "/masters/towers?new=1", Plus, "masters.tower.create"], ["Add floors / flats", "/masters/towers?structure=1", Plus, "masters.flat.create"], ["New flat type", "/masters/m/flat-types?new=1", Plus, "masters.flat_type.create"],
  ["New construction stage", "/masters/m/construction-stages?new=1", Plus, "masters.construction_stage.create"], ["New stage plan", "/masters/stage-plans?new=1", Plus, "masters.stage_plan.create"], ["New payment plan", "/masters/payment-plans?new=1", Plus, "masters.payment_plan.create"],
  ["New site visit", "/site-visits?new=1", Plus, "sales.site_visit.create"], ["New user", "/users?new=1", Plus, "admin.user.create"], ["New role", "/roles?new=1", Plus, "admin.role.create"],
];
// localStorage: recent palette destinations (labels + routes) — non-sensitive (CR-7)
const pushRecent = (item) => { const r = JSON.parse(localStorage.getItem("kkt:recent") || "[]").filter((x) => x.to !== item.to); localStorage.setItem("kkt:recent", JSON.stringify([item, ...r].slice(0, 6))); };

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
  const navigate = useNavigate();
  const { can } = useAuth();
  const actions = useMemo(() => ACTIONS.filter(([, , , p]) => can(p)), [can]);
  const pages = useMemo(() => PAGES.filter(([, , , p]) => can(p)), [can]);
  useKeyboardNav({ setOpen, setHelp });
  const groups = usePaletteSearch(q);
  const go = (to, label) => { setOpen(false); setQ(""); if (label) pushRecent({ to, label }); navigate(to); };
  const recent = JSON.parse(localStorage.getItem("kkt:recent") || "[]");
  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, records or actions…  (⌘K · ? for shortcuts)" value={q} onValueChange={setQ} data-testid="command-palette-input" />
        <CommandList data-testid="command-palette-list">
          <CommandEmpty>No results.</CommandEmpty>
          <PaletteResults q={q} actions={actions} pages={pages} recent={recent} groups={groups} go={go} />
        </CommandList>
      </CommandDialog>
      <ShortcutsSheet open={help} onOpenChange={setHelp} />
    </>
  );
}
