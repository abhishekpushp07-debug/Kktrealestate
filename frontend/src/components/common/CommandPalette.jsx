import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Grid3X3, Layers, LayoutDashboard, Database, Users, History, Settings, ShieldCheck, Home, Clock, Plus, IndianRupee, PhoneCall, Hammer, Receipt, UserPlus, Keyboard, LifeBuoy, BarChart3 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { inrShort } from "@/lib/format";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PAGES = [
  ["Home", "/dashboard", LayoutDashboard, "project.read"], ["Projects", "/projects", Building2, "project.read"], ["Customers", "/customers", Users, "customer.read"], ["Bookings", "/bookings", Grid3X3, "booking.read"],
  ["Payments", "/payments", IndianRupee, "payment.read"], ["Leads & Visits", "/leads", PhoneCall, "lead.read"], ["Service", "/service-requests", LifeBuoy, "service.read"], ["Reports", "/reports", BarChart3, "report.view"],
  ["Catalogues", "/settings/catalogues", Database, "master.read"], ["Users", "/users", Users, "users.manage"], ["Roles", "/roles", ShieldCheck, "roles.manage"], ["Audit Log", "/audit", History, "audit.view"], ["Settings", "/settings", Settings, "settings.manage"],
];
const ACTIONS = [
  ["New booking", "/bookings/new", Plus, "booking.create"], ["Post payment", "/payments?post=1", IndianRupee, "payment.post"], ["New customer", "/customers/new", UserPlus, "customer.write"],
  ["New lead", "/leads?new=1", PhoneCall, "lead.write"], ["Log a call", "/customers?log=1", PhoneCall, "customer.write"], ["Mark construction stage", "/projects", Hammer, "block.write"], ["Roznamcha (today)", "/payments?tab=roznamcha", Receipt, "payment.read"],
];
export const GO = { p: ["/projects", "Projects"], c: ["/customers", "Customers"], b: ["/bookings", "Bookings"], h: ["/dashboard", "Home"], y: ["/payments", "Payments"], l: ["/leads", "Leads"], s: ["/service-requests", "Service"], r: ["/reports", "Reports"] };
const ICON = { projects: Building2, blocks: Layers, flats: Home, users: Users, flat_types: Database };
const LABEL = { projects: "Projects", blocks: "Blocks", flats: "Flats", users: "Users", flat_types: "Flat types" };
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
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); return; }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
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
            {ACTIONS.filter(([, , , p]) => can(p)).map(([l, to, Icon]) => <CommandItem key={to} value={`action ${l}`} onSelect={() => go(to)} data-testid={`palette-action-${l.toLowerCase().replace(/[^a-z]+/g, "-")}`}><Icon className="mr-2 h-4 w-4 text-gold-hover" />{l}</CommandItem>)}
          </CommandGroup>
          {!q.trim() && recent.length > 0 && <CommandGroup heading="Recent">
            {recent.map((r) => <CommandItem key={r.to} value={`recent ${r.label}`} onSelect={() => go(r.to, r.label)} data-testid="palette-recent"><Clock className="mr-2 h-4 w-4 text-txt-secondary" />{r.label}</CommandItem>)}
          </CommandGroup>}
          <CommandGroup heading="Pages">
            {PAGES.filter(([, , , p]) => can(p)).map(([l, to, Icon]) => <CommandItem key={to} value={`page ${l}`} onSelect={() => go(to)} data-testid={`palette-page-${l.toLowerCase().replace(/[^a-z]+/g, "-")}`}><Icon className="mr-2 h-4 w-4 text-ink-950" />{l}</CommandItem>)}
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
