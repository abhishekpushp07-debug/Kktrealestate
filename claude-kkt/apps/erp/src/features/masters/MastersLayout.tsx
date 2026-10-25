import { Navigate, NavLink, Outlet, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { MASTER_CONFIG_LIST, getMasterConfig } from "./masterConfig";
import { MASTER_GROUP_LABELS, type MasterGroup } from "./types";

const GROUP_ORDER: readonly MasterGroup[] = ["structure", "money", "documents"];

/** Left sub-navigation (lg+) or scrollable pills (phones/tablets) listing the 16 master kinds. */
export default function MastersLayout() {
  const groups = GROUP_ORDER.map((group) => ({ group, items: MASTER_CONFIG_LIST.filter((config) => config.group === group) }));

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <nav aria-label="Master data kinds" className="-mx-4 min-w-0 overflow-x-auto px-4 scrollbar-thin lg:hidden">
        <ul className="flex w-max gap-1.5 pb-1">
          {MASTER_CONFIG_LIST.map((config) => (
            <li key={config.kind}>
              <NavLink
                to={`/masters/${config.slug}`}
                data-testid={`master-tab-${config.slug}`}
                className={({ isActive }) =>
                  cn(
                    "inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-ring",
                    isActive ? "border-navy-950 bg-navy-950 text-white" : "border-border bg-card text-ink-muted hover:border-navy-300 hover:text-navy-950",
                  )
                }
              >
                <config.icon className="size-3.5" aria-hidden="true" />
                {config.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <aside className="hidden w-60 shrink-0 lg:block">
        <nav aria-label="Master data kinds" className="sticky top-[calc(var(--spacing-topbar)+1.5rem)] space-y-4 rounded-lg border border-border bg-card p-2 shadow-card">
          {groups.map(({ group, items }) => (
            <div key={group}>
              <p className="label-caps px-2 pb-1 pt-1">{MASTER_GROUP_LABELS[group]}</p>
              <ul className="space-y-0.5">
                {items.map((config) => (
                  <li key={config.kind}>
                    <NavLink
                      to={`/masters/${config.slug}`}
                      data-testid={`master-nav-${config.slug}`}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors focus-ring",
                          isActive ? "bg-navy-50 text-navy-950" : "text-ink-muted hover:bg-surface hover:text-navy-950",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-gold" aria-hidden="true" />}
                          <config.icon className={cn("size-4 shrink-0", isActive ? "text-gold-text" : "text-ink-subtle group-hover:text-navy-950")} aria-hidden="true" />
                          <span className="truncate">{config.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

/** `/masters` → first kind. */
export function MastersIndexRedirect() {
  const first = MASTER_CONFIG_LIST[0];
  return <Navigate to={first ? `/masters/${first.slug}` : "/"} replace />;
}

/** Alias `/master/:kind` → `/masters/:kind` (unknown kinds fall through to the 404 inside /masters). */
export function MasterAliasRedirect() {
  const { kind } = useParams<{ kind: string }>();
  const config = getMasterConfig(kind);
  return <Navigate to={config ? `/masters/${config.slug}` : "/masters"} replace />;
}
