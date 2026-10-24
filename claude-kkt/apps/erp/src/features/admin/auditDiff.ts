export type DiffStatus = "added" | "removed" | "changed" | "same";

export interface DiffRow {
  key: string;
  before: unknown;
  after: unknown;
  status: DiffStatus;
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(",")}}`;
}

/** Key-by-key comparison of two audit snapshots; changed keys first, then the rest alphabetically. */
export function diffSnapshots(before: Record<string, unknown> | null, after: Record<string, unknown> | null): DiffRow[] {
  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const rows: DiffRow[] = [];
  for (const key of keys) {
    const inBefore = before !== null && key in before;
    const inAfter = after !== null && key in after;
    const b = inBefore ? before[key] : undefined;
    const a = inAfter ? after[key] : undefined;
    let status: DiffStatus;
    if (inBefore && !inAfter) status = "removed";
    else if (!inBefore && inAfter) status = "added";
    else status = stable(a) === stable(b) ? "same" : "changed";
    rows.push({ key, before: b, after: a, status });
  }
  const rank: Record<DiffStatus, number> = { changed: 0, added: 1, removed: 2, same: 3 };
  return rows.sort((x, y) => rank[x.status] - rank[y.status] || x.key.localeCompare(y.key));
}

/** Compact display of a snapshot value. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? '""' : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

/** Route for an audited entity when the ERP has a detail page for it. */
export function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  const type = entityType.toLowerCase().replace(/[\s-]+/g, "_");
  switch (type) {
    case "project":
      return `/projects/${entityId}`;
    case "block":
    case "tower":
      return `/projects?block=${entityId}`;
    case "flat":
    case "unit":
      return `/flats/${entityId}`;
    case "customer":
      return `/customers/${entityId}`;
    case "booking":
      return `/bookings/${entityId}`;
    case "lead":
    case "enquiry":
      return `/leads/${entityId}`;
    case "payment":
      return `/payments/${entityId}`;
    case "demand":
      return `/demands/${entityId}`;
    case "site_visit":
    case "visit":
      return `/site-visits/${entityId}`;
    case "service_request":
    case "ticket":
      return `/service-requests/${entityId}`;
    case "user":
      return `/admin/users?q=${entityId}`;
    case "role":
      return "/admin/roles";
    case "company":
    case "company_settings":
    case "settings":
      return "/admin/settings";
    default:
      return null;
  }
}
