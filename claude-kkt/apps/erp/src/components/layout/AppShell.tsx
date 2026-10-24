import { Dialog } from "radix-ui";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette, useCommandPaletteHotkey, type CommandGroupDef, type CommandItem } from "@/components/ui/command-palette";
import { PageSkeleton } from "@/components/ui/skeleton";
import { api, type ListEnvelope } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { filterNav } from "@/lib/permissions";
import { BREAKPOINTS, cn, useLocalStorageState, useMediaQuery } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const SIDEBAR_KEY = "kkt.erp.sidebar.collapsed";

interface SearchHit {
  id: string;
  type?: string;
  label?: string;
  title?: string;
  name?: string;
  subtitle?: string;
  description?: string;
  href?: string;
  url?: string;
}

function toCommandItem(hit: SearchHit): CommandItem | null {
  const label = hit.label ?? hit.title ?? hit.name;
  if (!label) return null;
  return {
    id: `${hit.type ?? "result"}:${hit.id}`,
    label,
    description: hit.subtitle ?? hit.description,
    href: hit.href ?? hit.url,
    group: hit.type ? hit.type.charAt(0).toUpperCase() + hit.type.slice(1).toLowerCase().replaceAll("_", " ") : "Results",
  };
}

/** Collapsible navy sidebar + 64 px top bar + fluid content area; off-canvas drawer below 1024 px. */
export function AppShell() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const compact = useMediaQuery(BREAKPOINTS.compact);
  const [collapsed, setCollapsed] = useLocalStorageState<boolean>(SIDEBAR_KEY, false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Close the drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);
  useCommandPaletteHotkey(togglePalette);

  const commandGroups = useMemo<CommandGroupDef[]>(
    () =>
      filterNav(can).map((group) => ({
        id: group.id,
        label: group.label,
        items: group.items.map((item) => ({ id: `nav:${item.id}`, label: item.label, href: item.to, icon: item.icon, keywords: item.keywords, description: item.to })),
      })),
    [can],
  );

  const search = useCallback(async (query: string): Promise<CommandItem[]> => {
    const result = await api.get<ListEnvelope<SearchHit> | SearchHit[]>("/search", { query: { q: query, limit: 12 } });
    const hits = Array.isArray(result) ? result : result.items;
    return hits.map(toCommandItem).filter((item): item is CommandItem => item !== null);
  }, []);

  const handleSelect = useCallback(
    (item: CommandItem) => {
      if (item.href) navigate(item.href);
    },
    [navigate],
  );

  const sidebarCollapsed = !compact && collapsed;

  return (
    <div className="min-h-dvh bg-surface">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[80] focus:rounded-md focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy-950">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
        <Sidebar collapsed={sidebarCollapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} className="h-dvh" />
      </div>

      {/* Off-canvas drawer (<1024 px) */}
      <Dialog.Root open={mobileOpen && compact} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/55 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out lg:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-sidebar max-w-[85vw] outline-none data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left lg:hidden"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} className="h-dvh w-full" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className={cn("flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200", sidebarCollapsed ? "lg:pl-sidebar-collapsed" : "lg:pl-sidebar")}>
        <TopBar onOpenMenu={() => setMobileOpen(true)} onOpenSearch={() => setPaletteOpen(true)} />
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none md:p-6">
          <RouteErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={commandGroups} onSearch={search} onSelect={handleSelect} />
    </div>
  );
}
