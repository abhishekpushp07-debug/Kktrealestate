const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const inr = (n) => (n == null ? "—" : `₹${fmt.format(Math.round(n))}`);

export const inrShort = (n) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.?0+$/, "")} L`;
  return inr(n);
};

export const sqft = (n) => (n == null ? "—" : `${fmt.format(n)} sq.ft.`);

export const num = (n) => (n == null ? "—" : fmt.format(n));

export const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export const initials = (name = "") => name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
