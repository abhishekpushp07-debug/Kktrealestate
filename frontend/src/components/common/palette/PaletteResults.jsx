import { Clock, Home } from "lucide-react";
import { inrShort } from "@/lib/format";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { ICON, LABEL, href } from "./meta";

export function PaletteResults({ q, actions, pages, recent, groups, go }) {
  return (<>
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
  </>);
}
