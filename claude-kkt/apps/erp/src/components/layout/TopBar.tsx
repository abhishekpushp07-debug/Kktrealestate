import { Menu, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { IconButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { findNavItem } from "@/lib/permissions";
import { isMac } from "@/lib/utils";
import { BrandMark } from "./BrandMark";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";

export interface TopBarProps {
  onOpenMenu: () => void;
  onOpenSearch: () => void;
}

/** 64 px top bar: hamburger (compact), ⌘K search, bell, user menu. */
export function TopBar({ onOpenMenu, onOpenSearch }: TopBarProps) {
  const location = useLocation();
  const title = findNavItem(location.pathname)?.label;
  const modifier = isMac() ? "⌘" : "Ctrl";

  return (
    <header className="sticky top-0 z-40 flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:px-4">
      <IconButton
        icon={Menu}
        label="Open navigation"
        className="lg:hidden"
        onClick={onOpenMenu}
        data-testid="topbar-menu-btn"
      />
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <BrandMark size="sm" />
        {title && <span className="truncate font-display text-base font-bold text-navy-950">{title}</span>}
      </div>
      {title && <h2 className="hidden truncate font-display text-base font-bold text-navy-950 lg:block">{title}</h2>}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          data-testid="topbar-search-btn"
          className="hidden h-9 w-64 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-left text-sm text-ink-subtle transition-colors hover:border-navy-300 hover:text-ink focus-ring md:flex xl:w-80"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate">Search projects, flats, buyers…</span>
          <span className="flex items-center gap-0.5">
            <Kbd>{modifier}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <IconButton icon={Search} label="Search" className="md:hidden" onClick={onOpenSearch} />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
