// Formatting helpers: Indian rupee grouping (₹1,00,00,000), short forms (₹1.2 Cr / ₹45 L),
// dates and times rendered in IST, relative times. All money arrives as integer paise.

import { formatInr, formatInrShort, groupIndian } from "@kkt/contracts";

const IST = "Asia/Kolkata";

/** Groups an integer rupee string the Indian way: 1234567 → "12,34,567" (the shared @kkt/contracts helper). */
export { groupIndian };

/*
 * Money delegates to @kkt/contracts moneyFormat, the one INR formatter the portal, the ERP and the website share (BigInt
 * arithmetic, SPEC short forms Cr / L only, "round first, then promote": ₹99,96,000 is "₹1 Cr"). Negatives print "-₹…".
 */

/** ₹ with Indian grouping; paise shown only when non-zero (or `showPaise`). Negative → "-₹…". */
export function formatINR(paise: number, opts: { showPaise?: boolean; signed?: boolean } = {}): string {
  if (!Number.isFinite(paise)) return "—";
  return formatInr(paise, { paise: opts.showPaise ? "always" : "auto", signed: opts.signed === true });
}

/** Short Indian money form: ₹1.2 Cr, ₹45 L, ₹12,500 (full rupees below a lakh). */
export function formatINRShort(paise: number): string {
  if (!Number.isFinite(paise)) return "—";
  return formatInrShort(paise);
}

/** Percent with at most one decimal: 33.333 → "33.3%". */
export function formatPercent(value: number): string {
  const r = Math.round(value * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
}

/** Square feet: 1234.5 → "1,234.5 sq ft". */
/** Floor label for display: bare numbers read as "Floor 8"; named floors ("Ground", "G", "Villa") pass through. */
export function formatFloor(label: string | null | undefined): string {
  const v = (label ?? "").trim();
  if (!v) return "";
  if (/^\d+$/.test(v)) return `Floor ${v}`;
  if (/^-\d+$/.test(v)) return `Basement ${v.slice(1)}`;
  return v;
}

export function formatSqft(value: number): string {
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })} sq ft`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Business date "2025-04-01" → "1 Apr 2025". Tolerates timestamps by taking their IST calendar day. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const month = MONTHS[Number(m[2]) - 1] ?? m[2];
    return `${Number(m[3])} ${month} ${m[1]}`;
  }
  return formatDateTime(value, { time: false });
}

/** RFC 3339 timestamp → "1 Apr 2025, 10:30 am" in IST. */
export function formatDateTime(value: string | null | undefined, opts: { time?: boolean } = {}): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    const date = new Intl.DateTimeFormat("en-IN", {
      timeZone: IST,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
    if (opts.time === false) return date;
    const time = new Intl.DateTimeFormat("en-IN", {
      timeZone: IST,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    return `${date}, ${time}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else the date. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(value);
}

/** Days from today (IST) to a YYYY-MM-DD date; negative when in the past. */
export function daysUntil(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return 0;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const nowIst = new Date(Date.now() + 5.5 * 3_600_000);
  const today = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/** "Good morning / afternoon / evening" by IST clock. */
export function greetingForNow(): string {
  const hour = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Upper-snake enum → "Title case" when no label map covers it. */
export function humanise(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Bytes → "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Initials for an avatar: "Asha Rani Verma" → "AV". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
