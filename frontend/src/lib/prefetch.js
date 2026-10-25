// Route-chunk prefetch on sidebar hover: warms the lazy import so navigation is instant.
const LOADERS = {
  "/dashboard": () => import("@/pages/v2/Home"), "/projects": () => import("@/pages/v2/Projects"), "/customers": () => import("@/pages/v2/Customers"), "/bookings": () => import("@/pages/v2/Bookings"),
  "/payments": () => import("@/pages/v2/Payments"), "/leads": () => import("@/pages/v2/Leads"), "/service-requests": () => import("@/pages/ServiceRequests"), "/reports": () => import("@/pages/Reports"),
  "/website": () => import("@/pages/cms/SiteSettings"), "/settings": () => import("@/pages/Settings"), "/users": () => import("@/pages/Users"),
};
const done = new Set();
export const prefetchRoute = (to) => { const k = Object.keys(LOADERS).find((p) => to.startsWith(p)); if (!k || done.has(k)) return; done.add(k); LOADERS[k]().catch(() => done.delete(k)); };
