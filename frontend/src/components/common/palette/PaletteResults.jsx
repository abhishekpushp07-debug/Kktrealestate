import { Clock, Home } from "lucide-react";
import { inrShort } from "@/lib/format";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { ICON, LABEL, ORDER, href, sub, title } from "./meta";

const slug = (l) => l.toLowerCase().replace(/[^a-z]+/g, "-");

function Records({ groups, go }) {
  const sorted = [...groups].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  return sorted.map((g) => {
    const Icon = ICON[g.type] || Home;
    return (
      <CommandGroup
        key={g.type}
        heading={LABEL[g.type] || g.type}
        data-testid={`palette-group-${g.type}`}
      >
        {g.items.map((x) => (
          <CommandItem
            key={x.id}
            value={`${g.type} ${title(g.type, x)} ${sub(g.type, x)} ${x.id}`}
            onSelect={() => go(href(g.type, x), title(g.type, x))}
            data-testid={`palette-result-${x.id}`}
          >
            <Icon className="mr-2 h-4 w-4 text-txt-secondary" />
            <span className="font-semibold">{title(g.type, x)}</span>
            <span className="ml-2 truncate text-xs text-txt-secondary">
              {sub(g.type, x)}
              {x.price ? ` · ${inrShort(x.price)}` : ""}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    );
  });
}

function Links({ heading, items, go, prefix, iconClass }) {
  return (
    <CommandGroup heading={heading}>
      {items.map(([l, to, Icon]) => (
        <CommandItem
          key={to}
          value={`${prefix} ${l}`}
          onSelect={() => go(to)}
          data-testid={`palette-${prefix}-${slug(l)}`}
        >
          <Icon className={`mr-2 h-4 w-4 ${iconClass}`} />
          {l}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function PaletteResults({ q, actions, pages, recent, groups, go }) {
  const typed = q.trim();
  const has = ([l]) => !typed || l.toLowerCase().includes(typed.toLowerCase());
  actions = actions.filter(has);
  pages = pages.filter(has);
  return (
    <>
      {typed && <Records groups={groups} go={go} />}
      {actions.length > 0 && (
        <Links heading="Actions" items={actions} go={go} prefix="action" iconClass="text-gold" />
      )}
      {!typed && recent.length > 0 && (
        <CommandGroup heading="Recent">
          {recent.map((r) => (
            <CommandItem
              key={r.to}
              value={`recent ${r.label}`}
              onSelect={() => go(r.to, r.label)}
              data-testid="palette-recent"
            >
              <Clock className="mr-2 h-4 w-4 text-txt-secondary" />
              {r.label}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {pages.length > 0 && (
        <Links heading="Pages" items={pages} go={go} prefix="page" iconClass="text-ink-950" />
      )}
    </>
  );
}
