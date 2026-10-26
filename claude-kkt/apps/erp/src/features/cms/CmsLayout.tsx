import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { NAV_GROUPS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** Website group of the nav, filtered to the current user. */
function useCmsNav() {
  const { can } = useAuth();
  const group = NAV_GROUPS.find((candidate) => candidate.id === "website");
  return (group?.items ?? []).filter((item) => !item.permission || can(item.permission));
}

/** Left sub-navigation (lg+) or scrollable pills (phones/tablets) for the CMS sections. */
export default function CmsLayout() {
  const items = useCmsNav();
  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <nav aria-label="Website sections" className="-mx-4 min-w-0 overflow-x-auto px-4 scrollbar-thin lg:hidden">
        <ul className="flex w-max gap-1.5 pb-1">
          {items.map((item) => (
            <li key={item.id}>
              <NavLink
                to={item.to}
                data-testid={`cms-tab-${item.id}`}
                className={({ isActive }) =>
                  cn(
                    "inline-flex h-12 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-ring",
                    isActive ? "border-navy-950 bg-navy-950 text-white" : "border-border bg-card text-ink-muted hover:border-navy-300 hover:text-navy-950",
                  )
                }
              >
                <item.icon className="size-3.5" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <aside className="hidden w-56 shrink-0 lg:block">
        <nav aria-label="Website sections" className="sticky top-[calc(var(--spacing-topbar)+1.5rem)] rounded-lg border border-border bg-card p-2 shadow-card">
          <p className="label-caps px-2 pb-1 pt-1">Website</p>
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={item.to}
                  data-testid={`cms-nav-${item.id}`}
                  className={({ isActive }) =>
                    cn("group relative flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors focus-ring", isActive ? "bg-navy-50 text-navy-950" : "text-ink-muted hover:bg-surface hover:text-navy-950")
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-gold" aria-hidden="true" />}
                      <item.icon className={cn("size-4 shrink-0", isActive ? "text-gold-text" : "text-ink-subtle group-hover:text-navy-950")} aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export const CMS_BREADCRUMBS = [{ label: "Home", to: "/" }, { label: "Website" }] as const;
