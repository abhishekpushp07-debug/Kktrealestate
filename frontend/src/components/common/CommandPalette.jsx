import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Grid3X3, Layers, LayoutDashboard, Database, Users, History, Settings, ShieldCheck, Home, Clock } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { inrShort } from "@/lib/format";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const PAGES = [
  ["Dashboard", "/dashboard", LayoutDashboard, "project.read"], ["Projects", "/projects", Building2, "project.read"], ["Inventory", "/flats", Grid3X3, "project.read"],
  ["Master Data", "/master/flat-types", Database, "master.read"], ["Users", "/users", Users, "users.manage"], ["Roles", "/roles", ShieldCheck, "roles.manage"],
  ["Audit Log", "/audit", History, "audit.view"], ["Settings", "/settings", Settings, "settings.manage"],
];
const ICON = { projects: Building2, blocks: Layers, flats: Home, users: Users, flat_types: Database };
const LABEL = { projects: "Projects", blocks: "Blocks", flats: "Flats", users: "Users", flat_types: "Flat types" };

const pushRecent = (item) => { const r = JSON.parse(localStorage.getItem("kkt:recent") || "[]").filter((x) => x.to !== item.to); localStorage.setItem("kkt:recent", JSON.stringify([item, ...r].slice(0, 6))); };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState([]);
  const navigate = useNavigate();
  const { can } = useAuth();
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey); window.addEventListener("kkt:open-palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("kkt:open-palette", onOpen); };
  }, []);
  useEffect(() => {
    if (!q.trim()) { setGroups([]); return; }
    const t = setTimeout(() => api.get("/search", { params: { q: q.trim(), limit: 6 } }).then((r) => setGroups(r.data.groups)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  const go = (to, label) => { setOpen(false); setQ(""); if (label) pushRecent({ to, label }); navigate(to); };
  const recent = JSON.parse(localStorage.getItem("kkt:recent") || "[]");
  const href = (type, x) => type === "projects" ? `/projects/${x.id}` : type === "blocks" ? `/blocks/${x.id}` : type === "flats" ? `/blocks/${x.block_id}?flat=${x.id}` : type === "users" ? "/users" : "/master/flat-types";
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a page, project, block, flat, user…  (⌘K)" value={q} onValueChange={setQ} data-testid="command-palette-input" />
      <CommandList data-testid="command-palette-list">
        <CommandEmpty>No results.</CommandEmpty>
        {!q.trim() && recent.length > 0 && <CommandGroup heading="Recent">
          {recent.map((r) => <CommandItem key={r.to} value={`recent ${r.label}`} onSelect={() => go(r.to, r.label)} data-testid="palette-recent"><Clock className="mr-2 h-4 w-4 text-slate-500" />{r.label}</CommandItem>)}
        </CommandGroup>}
        <CommandGroup heading="Pages">
          {PAGES.filter(([, , , p]) => can(p)).map(([l, to, Icon]) => <CommandItem key={to} value={`page ${l}`} onSelect={() => go(to)} data-testid={`palette-page-${l.toLowerCase().replace(/\s+/g, "-")}`}><Icon className="mr-2 h-4 w-4 text-gold-hover" />{l}</CommandItem>)}
        </CommandGroup>
        {groups.map((g) => {
          const Icon = ICON[g.type] || Home;
          return (
            <CommandGroup key={g.type} heading={LABEL[g.type] || g.type}>
              {g.items.map((x) => (
                <CommandItem key={x.id} value={`${g.type} ${x.name || x.flat_number || x.email} ${x.code || ""} ${x.id}`} onSelect={() => go(href(g.type, x), `${x.name || x.flat_number || x.email}${x.code ? ` · ${x.code}` : ""}`)} data-testid={`palette-result-${x.id}`}>
                  <Icon className="mr-2 h-4 w-4 text-navy" />
                  <span className="font-semibold">{x.name || x.flat_number}</span>
                  <span className="ml-2 text-xs text-slate-500">{x.code || x.project_code || x.email}{x.status ? ` · ${x.status}` : ""}{x.price ? ` · ${inrShort(x.price)}` : ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
