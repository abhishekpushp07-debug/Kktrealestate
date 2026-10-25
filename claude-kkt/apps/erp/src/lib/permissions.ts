import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpenText,
  Building2,
  CalendarCheck2,
  ClipboardList,
  Contact,
  FileStack,
  FileText,
  Grid3x3,
  HardHat,
  Image,
  Images,
  Inbox,
  IndianRupee,
  LayoutDashboard,
  LayoutList,
  LifeBuoy,
  Megaphone,
  MessageSquareQuote,
  Newspaper,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  Sliders,
  Tags,
  UserRound,
  Users,
} from "lucide-react";
import type { Permission } from "@kkt/contracts";

export type { Permission };

/** One or more permission codes; any match grants access. */
export type PermissionRequirement = Permission | readonly Permission[];

export interface NavItem {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  /** Omit for pages every signed-in user may open. */
  permission?: PermissionRequirement;
  /** Match child routes too (default true; false = exact). */
  exact?: boolean;
  keywords?: readonly string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [{ id: "dashboard", label: "Dashboard", to: "/", icon: LayoutDashboard, exact: true, keywords: ["home"] }],
  },
  {
    id: "inventory",
    label: "Inventory",
    items: [
      { id: "projects", label: "Projects", to: "/projects", icon: Building2, permission: "project.read", keywords: ["towers", "blocks"] },
      { id: "flats", label: "Flats", to: "/flats", icon: Grid3x3, permission: "project.read", keywords: ["units", "grid", "availability"] },
      { id: "rate-cards", label: "Rate cards", to: "/rate-cards", icon: Tags, permission: "project.read", keywords: ["pricing", "plc"] },
      { id: "masters", label: "Master data", to: "/masters", icon: Sliders, permission: "master.read", keywords: ["flat types", "stages", "plans", "charges"] },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    items: [
      { id: "leads", label: "Leads", to: "/leads", icon: ClipboardList, permission: "lead.read", keywords: ["pipeline", "enquiries"] },
      { id: "visits", label: "Site visits", to: "/site-visits", icon: CalendarCheck2, permission: "visit.read" },
      { id: "customers", label: "Customers", to: "/customers", icon: Contact, permission: "customer.read", keywords: ["buyers", "kyc"] },
      { id: "bookings", label: "Bookings", to: "/bookings", icon: FileText, permission: "booking.read", keywords: ["agreements", "wizard"] },
    ],
  },
  {
    id: "accounts",
    label: "Accounts",
    items: [
      { id: "payments", label: "Payments", to: "/payments", icon: IndianRupee, permission: "payment.read", keywords: ["receipts", "cheques"] },
      { id: "demands", label: "Demands", to: "/demands", icon: ReceiptText, permission: "payment.read", keywords: ["dues", "installments"] },
      { id: "roznamcha", label: "Roznamcha", to: "/roznamcha", icon: BookOpenText, permission: "payment.read", keywords: ["day book", "cash"] },
    ],
  },
  {
    id: "construction",
    label: "Construction",
    items: [{ id: "construction", label: "Construction", to: "/construction", icon: HardHat, permission: "project.read", keywords: ["stages", "progress"] }],
  },
  {
    id: "service",
    label: "Service",
    items: [{ id: "service", label: "Service requests", to: "/service-requests", icon: LifeBuoy, permission: "service.read", keywords: ["tickets", "sla"] }],
  },
  {
    id: "website",
    label: "Website",
    items: [
      { id: "site-settings", label: "Site settings", to: "/website/settings", icon: Settings, permission: "cms.read" },
      { id: "banners", label: "Banners", to: "/website/banners", icon: Image, permission: "cms.read" },
      { id: "home-sections", label: "Home sections", to: "/website/home-sections", icon: LayoutList, permission: "cms.read", keywords: ["blocks", "trust strip", "value props"] },
      { id: "posts", label: "Posts", to: "/website/posts", icon: Newspaper, permission: "cms.read", keywords: ["blog", "news"] },
      { id: "gallery", label: "Gallery", to: "/website/gallery", icon: Images, permission: "cms.read" },
      { id: "testimonials", label: "Testimonials", to: "/website/testimonials", icon: MessageSquareQuote, permission: "cms.read" },
      { id: "pages", label: "Pages", to: "/website/pages", icon: FileStack, permission: "cms.read", keywords: ["legal", "privacy"] },
      { id: "people", label: "People", to: "/website/people", icon: UserRound, permission: "cms.read", keywords: ["team", "leadership"] },
      { id: "notices", label: "Notices", to: "/website/notices", icon: Megaphone, permission: "cms.read" },
      { id: "enquiries", label: "Enquiries", to: "/website/enquiries", icon: Inbox, permission: ["cms.read", "lead.read"], keywords: ["inbox"] },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    items: [{ id: "reports", label: "Reports", to: "/reports", icon: BarChart3, permission: "report.view", keywords: ["collections", "outstanding", "ageing"] }],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { id: "users", label: "Users", to: "/admin/users", icon: Users, permission: "users.manage" },
      { id: "roles", label: "Roles", to: "/admin/roles", icon: ShieldCheck, permission: "roles.manage", keywords: ["permissions"] },
      { id: "settings", label: "Settings", to: "/admin/settings", icon: Settings, permission: "settings.manage" },
      { id: "audit", label: "Audit log", to: "/admin/audit-log", icon: ScrollText, permission: "audit.view" },
    ],
  },
];

/** Every nav item flattened (routes are generated from this list). */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export type CanFn = (permission: PermissionRequirement) => boolean;

/** Nav groups filtered to what the current user may open; empty groups are dropped. */
export function filterNav(can: CanFn): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);
}

/** Longest-prefix match of the current path to a nav item. */
export function findNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of NAV_ITEMS) {
    const matches = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
    if (matches && (!best || item.to.length > best.to.length)) best = item;
  }
  return best;
}
