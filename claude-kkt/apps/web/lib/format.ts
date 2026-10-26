/**
 * Formatting helpers: Indian rupee grouping, short forms (₹1.2 Cr / ₹45 L), dates in IST.
 */

const IST = "Asia/Kolkata";
const CRORE = 1_00_00_000;
const LAKH = 1_00_000;

const inrFull = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrNumber = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function trimZero(n: number, digits: number): string {
  return n
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

/** Full Indian grouping: 100000000 paise → ₹10,00,000 */
export function formatINR(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "—";
  return inrFull.format(Math.round(paise / 100));
}

/** Short form: ₹1.2 Cr · ₹45 L · ₹12,500 */
export function formatINRShort(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "—";
  const rupees = Math.round(paise / 100);
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= CRORE) return `${sign}₹${trimZero(abs / CRORE, 2)} Cr`;
  if (abs >= LAKH) return `${sign}₹${trimZero(abs / LAKH, 1)} L`;
  return `${sign}₹${inrNumber.format(abs)}`;
}

/** "Starting ₹1.2 Cr*" style label, or null when prices are hidden. */
export function startingPriceLabel(paise: number | null | undefined): string | null {
  if (paise === null || paise === undefined) return null;
  return `${formatINRShort(paise)} onwards`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(n);
}

export function formatSqft(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${formatNumber(n)} sq ft`;
}

function parseDateInput(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // Business dates arrive as YYYY-MM-DD; pin them to IST noon to avoid timezone drift.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T12:00:00+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DateStyle = "short" | "medium" | "long" | "month";

/** 2026-03-12 → "12 Mar 2026" (medium) · "Thursday, 12 March 2026" (long) · "Mar 2026" (month) */
export function formatDate(value: string | Date | null | undefined, style: DateStyle = "medium"): string {
  if (!value) return "—";
  const d = parseDateInput(value);
  if (!d) return "—";
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { day: "numeric", month: "short" }
      : style === "long"
        ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
        : style === "month"
          ? { month: "short", year: "numeric" }
          : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: IST }).format(d);
}

/** RFC 3339 timestamp → "12 Mar 2026, 4:30 pm IST" */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = parseDateInput(value);
  if (!d) return "—";
  return `${new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: IST,
  }).format(d)} IST`;
}

/** "10:30" → "10:30 am" */
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "—";
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!match) return hhmm;
  const h = Number(match[1]);
  const m = match[2];
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${suffix}`;
}

export function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "—";
  return end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start);
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

/** Adds `days` to a YYYY-MM-DD string (calendar arithmetic, timezone-safe). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** Weekday label for a YYYY-MM-DD string: "Mon" */
export function weekdayShort(ymd: string): string {
  const d = parseDateInput(ymd);
  return d ? new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: IST }).format(d) : "";
}

export function dayOfMonth(ymd: string): string {
  const d = parseDateInput(ymd);
  return d ? new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: IST }).format(d) : "";
}

export function monthShort(ymd: string): string {
  const d = parseDateInput(ymd);
  return d ? new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: IST }).format(d) : "";
}

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  PLANNING: "New Launch",
  UNDER_CONSTRUCTION: "Under Construction",
  READY: "Ready to Move",
  COMPLETED: "Completed",
};

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  MIXED: "Mixed Use",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return PROJECT_STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export function typeLabel(type: string | null | undefined): string {
  if (!type) return "";
  return PROJECT_TYPE_LABELS[type] ?? type;
}

export function bhkLabel(options: ReadonlyArray<number> | null | undefined): string {
  if (!options || options.length === 0) return "";
  const sorted = [...new Set(options)].sort((a, b) => a - b);
  if (sorted.length === 1) return `${trimZero(sorted[0] ?? 0, 1)} BHK`;
  return `${sorted.map((b) => trimZero(b, 1)).join(", ")} BHK`;
}

/** Canonical 10-digit Indian mobile: strips +91 / 0 / spaces; returns null if invalid. */
export function canonicalPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const trimmed =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(trimmed) ? trimmed : null;
}

export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits.startsWith("+") ? digits : `+91${digits.replace(/^0/, "")}`}` : null;
}

export function whatsappHref(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const intl = digits.length === 10 ? `91${digits}` : digits;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return intl ? `https://wa.me/${intl}${q}` : null;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function excerpt(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  const clean = text
    .replace(/[#*_>`[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
