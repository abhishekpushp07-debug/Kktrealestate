// Indian number / date formatting that does not depend on Intl (Hermes-safe).

function groupIndian(intStr: string): string {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export function inr(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(Math.abs(n));
  return `${n < 0 ? "-" : ""}₹${groupIndian(String(v))}`;
}

const trim = (s: string) => s.replace(/\.?0+$/, "");

export function inrShort(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${trim((a / 1e7).toFixed(2))} Cr`;
  if (a >= 1e5) return `${sign}₹${trim((a / 1e5).toFixed(2))} L`;
  return inr(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso?: string | null): string {
  const d = parse(iso);
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateTime(iso?: string | null): string {
  const d = parse(iso);
  if (!d) return "—";
  const h = d.getHours();
  const hh = h % 12 || 12;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}, ${hh}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function firstName(full?: string | null): string {
  if (!full) return "";
  return full.trim().split(/\s+/)[0];
}

export function isPast(iso?: string | null): boolean {
  const d = parse(iso);
  return !!d && d.getTime() < Date.now();
}

// Normalises an Indian phone to digits with country code for wa.me / tel:
export function phoneDigits(p?: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return `91${d}`;
  return d;
}
