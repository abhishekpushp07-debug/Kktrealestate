import type { IconName } from "@/ui/Icon";

export interface Destination {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  /** Tab route name inside the (app) group. */
  route: "index" | "flat" | "payments" | "construction" | "more";
}

/** The five bottom tabs (phones). */
export const TAB_DESTINATIONS: ReadonlyArray<Destination> = [
  { key: "home", label: "Home", icon: "home", href: "/", route: "index" },
  { key: "flat", label: "My Flat", icon: "flat", href: "/flat", route: "flat" },
  { key: "payments", label: "Payments", icon: "rupee", href: "/payments", route: "payments" },
  { key: "construction", label: "Construction", icon: "construction", href: "/construction", route: "construction" },
  { key: "more", label: "More", icon: "more", href: "/more", route: "more" },
];

export interface SidebarLink {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  /** Pathname prefix that marks the link active. */
  match: (pathname: string) => boolean;
}

const startsWith = (p: string) => (pathname: string) => pathname === p || pathname.startsWith(`${p}/`);

/** Desktop sidebar: the tab destinations plus the "More" sub-destinations as first-class links. */
export const SIDEBAR_SECTIONS: ReadonlyArray<{ title?: string; links: ReadonlyArray<SidebarLink> }> = [
  {
    links: [
      { key: "home", label: "Home", icon: "home", href: "/", match: (p) => p === "/" || p === "" },
      { key: "flat", label: "My Flat", icon: "flat", href: "/flat", match: startsWith("/flat") },
      { key: "payments", label: "Payments", icon: "rupee", href: "/payments", match: startsWith("/payments") },
      { key: "construction", label: "Construction", icon: "construction", href: "/construction", match: startsWith("/construction") },
    ],
  },
  {
    title: "Services",
    links: [
      { key: "documents", label: "Documents", icon: "document", href: "/more/documents", match: startsWith("/more/documents") },
      { key: "requests", label: "Requests", icon: "request", href: "/more/requests", match: startsWith("/more/requests") },
      { key: "notices", label: "Notices", icon: "notice", href: "/more/notices", match: startsWith("/more/notices") },
      { key: "notifications", label: "Notifications", icon: "bell", href: "/more/notifications", match: startsWith("/more/notifications") },
    ],
  },
  {
    title: "Account",
    links: [
      { key: "profile", label: "Profile", icon: "user", href: "/more/profile", match: (p) => startsWith("/more/profile")(p) || startsWith("/more/password")(p) || startsWith("/more/sessions")(p) },
      { key: "bank", label: "Bank details", icon: "bank", href: "/more/bank-details", match: startsWith("/more/bank-details") },
    ],
  },
];
