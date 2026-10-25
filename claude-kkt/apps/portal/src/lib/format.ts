// Formatting helpers: Indian rupee grouping (₹1,00,00,000), short forms (₹1.2 Cr / ₹45 L),
// dates and times rendered in IST, relative times. All money arrives as integer paise.

const IST = "Asia/Kolkata";

/** Groups an integer rupee string the Indian way: 1234567 → "12,34,567". */
export function groupIndian(rupees: string): string {
  if (rupees.length <= 3) return rupees;
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const parts: string[] = [];
  for (let i = rest.length; i > 0; i -= 2) parts.unshift(rest.slice(Math.max(0, i - 2), i));
  return `${parts.join(",")},${last3}`;
}

/** ₹ with Indian grouping; paise shown only when non-zero (or `showPaise`). Negative → "−₹…". */
export function formatINR(paise: number, opts: { showPaise?: boolean; signed?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const body = groupIndian(String(rupees));
  const withPaise = opts.showPaise || p !== 0 ? `${body}.${String(p).padStart(2, "0")}` : body;
  const sign = negative ? "−" : opts.signed ? "+" : "";
  return `${sign}₹${withPaise}`;
}

/** Short Indian money form: ₹1.2 Cr, ₹45 L, ₹12.5 K, ₹850. */
export function formatINRShort(paise: number): string {
  const negative = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const fmt = (v: number, unit: string) => {
    const rounded = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    return `${negative ? "−" : ""}₹${rounded.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${unit}`;
  };
  if (rupees >= 1_00_00_000) return fmt(rupees / 1_00_00_000, " Cr");
  if (rupees >= 1_00_000) return fmt(rupees / 1_00_000, " L");
  if (rupees >= 10_000) return fmt(rupees / 1_000, " K");
  return `${negative ? "−" : ""}₹${groupIndian(String(Math.round(rupees)))}`;
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
    const date = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" }).format(d);
    if (opts.time === false) return date;
    const time = new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
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
