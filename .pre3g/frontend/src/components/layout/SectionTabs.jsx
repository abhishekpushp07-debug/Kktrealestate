import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

/** Phase S2.3 — second-level tabs for the grouped navigation (Customers, Payments, Admin). Old routes keep working. */
const SECTIONS = [
  {
    match: ["/customers", "/leads", "/site-visits"],
    tabs: [
      ["Customers", "/customers", "sales.customer.view"],
      ["Leads & Visits", "/leads", "sales.lead.view"],
    ],
  },
  {
    match: [], // Payments: the sidebar sub-items are the only second-level navigation
    tabs: [
      ["Received", "/payments", "finance.payment.view"],
      ["Bills raised", "/demands", "demands.register.view"],
      ["Roznamcha", "/roznamcha", "finance.payment.view"],
    ],
  },
  {
    match: ["/settings", "/users", "/roles", "/audit", "/admin", "/messaging", "/service-requests"],
    tabs: [
      ["Settings", "/settings", "admin.settings.view"],
      ["Users", "/users", "admin.user.view"],
      ["Roles", "/roles", "admin.role.view"],
      ["Audit", "/audit", "admin.audit.view"],
      ["System", "/settings/definitions", "admin.settings.view"],
      ["Messaging", "/messaging", "messaging.message.view"],
      ["Service requests", "/service-requests", "service.ticket.view"],
      ["Advanced", "/admin/advanced", "admin.settings.view"],
    ],
  },
];

export function SectionTabs() {
  const { pathname } = useLocation();
  const { can } = useAuth();
  const sec = SECTIONS.find((s) =>
    s.match.some(
      (m) => pathname === m || pathname.startsWith(m + "/") || pathname.startsWith(m + "?"),
    ),
  );
  if (!sec || /\/(new|[0-9a-f-]{36})(\/|$)/.test(pathname.replace("/settings/definitions", "")))
    return null;
  const tabs = sec.tabs.filter(([, , p]) => can(p));
  if (tabs.length < 2) return null;
  return (
    <div
      className="mb-5 flex gap-1 overflow-x-auto border-b border-warm-200"
      data-testid="section-tabs"
    >
      {tabs.map(([label, to]) => {
        const active = pathname === to || (to !== "/settings" && pathname.startsWith(to));
        return (
          <Link
            key={to}
            to={to}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
              active
                ? "border-ink-950 font-semibold text-ink-950"
                : "border-transparent text-txt-secondary hover:text-ink-950",
            )}
            data-testid={`section-tab-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
