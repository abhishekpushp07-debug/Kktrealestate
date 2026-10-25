import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { filterNav } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useEnquiryUnreadCount } from "@/features/crm/api";
import { BrandMark } from "./BrandMark";

/** Unread website enquiries: a count pill when expanded, a gold dot when collapsed. */
function EnquiriesBadge({ collapsed, enabled }: { collapsed: boolean; enabled: boolean }) {
  const unread = useEnquiryUnreadCount(enabled);
  const count = unread.data ?? 0;
  if (!enabled || count <= 0) return null;
  if (collapsed) return <span className="absolute right-2 top-1.5 size-2 rounded-full bg-gold ring-2 ring-navy-950" aria-label={`${count} unread enquiries`} data-testid="sidebar-enquiries-dot" />;
  return (
    <span className="money ml-auto rounded-full bg-gold px-1.5 text-2xs font-bold leading-4 text-navy-950" aria-label={`${count} unread enquiries`} data-testid="sidebar-enquiries-badge">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  /** Called after a link is clicked (closes the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
}

/** Navy navigation rail: 260 px expanded / 72 px collapsed, gold indicator on the active item. */
export function Sidebar({ collapsed, onToggleCollapsed, onNavigate, className }: SidebarProps) {
  const { user, company, can } = useAuth();
  const groups = filterNav(can);

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn("flex h-full flex-col bg-navy-950 text-navy-100 transition-[width] duration-200", collapsed ? "w-sidebar-collapsed" : "w-sidebar", className)}
    >
      <div className={cn("flex h-topbar shrink-0 items-center border-b border-navy-800 px-3", collapsed ? "justify-center" : "justify-between")}>
        <BrandMark withText={!collapsed} onDark subtitle={company?.name ?? "Real-estate ERP"} />
        {onToggleCollapsed && !collapsed && (
          <IconButton
            icon={PanelLeftClose}
            label="Collapse sidebar"
            size="sm"
            className="text-navy-200 hover:bg-navy-800 hover:text-white"
            onClick={onToggleCollapsed}
            data-testid="sidebar-collapse-btn"
          />
        )}
      </div>

      <nav aria-label="Primary" className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2">
        {groups.map((group, groupIndex) => (
          <div key={group.id} className={cn("px-2", groupIndex > 0 && "mt-1")}>
            {collapsed ? (
              groupIndex > 0 && <div className="mx-3 my-2 h-px bg-navy-800" aria-hidden="true" />
            ) : (
              <p className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-navy-300">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Tooltip content={item.label} side="right" disabled={!collapsed}>
                      <NavLink
                        to={item.to}
                        end={item.exact}
                        onClick={onNavigate}
                        data-testid={`sidebar-${item.id}-link`}
                        className={({ isActive }) =>
                          cn(
                            "group relative flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold lg:h-9",
                            collapsed && "justify-center px-0",
                            isActive ? "bg-navy-900 text-white" : "text-navy-100/85 hover:bg-navy-900/70 hover:text-white",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-gold" aria-hidden="true" />}
                            <Icon className={cn("size-[18px] shrink-0", isActive ? "text-gold" : "text-navy-200 group-hover:text-white")} aria-hidden="true" />
                            {!collapsed && <span className="truncate">{item.label}</span>}
                            {item.id === "enquiries" && <EnquiriesBadge collapsed={collapsed} enabled={can(["lead.read", "cms.read"])} />}
                          </>
                        )}
                      </NavLink>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("shrink-0 border-t border-navy-800 p-3", collapsed && "flex flex-col items-center gap-2")}>
        {collapsed ? (
          <>
            <Avatar name={user?.name} src={user?.avatar_url} size="sm" tone="navy" />
            {onToggleCollapsed && (
              <IconButton icon={PanelLeftOpen} label="Expand sidebar" size="sm" className="text-navy-200 hover:bg-navy-800 hover:text-white" onClick={onToggleCollapsed} data-testid="sidebar-expand-btn" />
            )}
          </>
        ) : (
          <div className="flex items-center gap-2.5">
            <Avatar name={user?.name} src={user?.avatar_url} size="sm" tone="navy" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold text-white">{user?.name ?? "—"}</p>
              <p className="truncate text-2xs text-navy-300">{user?.role.name ?? ""}</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
