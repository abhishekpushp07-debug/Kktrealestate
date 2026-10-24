export function parseHostMap(raw) {
  try { const m = JSON.parse(raw || "{}"); return m && typeof m === "object" ? m : {}; } catch { return {}; }
}

// Returns { app: "site"|"erp"|"portal", base: "" | "/erp" | "/portal", redirect?: string, hostMode: boolean }
export function resolveApp(hostname, pathname, hostMap) {
  const host = (hostname || "").toLowerCase();
  const bound = hostMap[host];
  if (bound === "erp" || bound === "portal" || bound === "site") {
    const prefix = bound === "site" ? null : `/${bound}`;
    if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      const rest = pathname.slice(prefix.length) || "/";
      return { app: bound, base: "", hostMode: true, redirect: rest };
    }
    if (bound === "site" && (pathname.startsWith("/erp") || pathname.startsWith("/portal"))) return { app: "site", base: "", hostMode: true, redirect: "/" };
    return { app: bound, base: "", hostMode: true };
  }
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return { app: "portal", base: "/portal", hostMode: false };
  if (pathname === "/erp" || pathname.startsWith("/erp/")) return { app: "erp", base: "/erp", hostMode: false };
  return { app: "site", base: "", hostMode: false };
}
