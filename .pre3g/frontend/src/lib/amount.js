// Shared ₹ amount typing: what the user sees is Indian-grouped; what forms keep and send is the plain number.

export function cleanAmount(input, { allowNegative = false } = {}) {
  let s = String(input ?? "").replace(/[₹,\s]/g, "");
  const neg = allowNegative && s.startsWith("-");
  s = s.replace(/[^0-9.]/g, "");
  if (!s) return neg ? "-" : "";
  const [intPart, ...rest] = s.split(".");
  const int = intPart.replace(/^0+(?=\d)/, "");
  const out = s.includes(".") ? `${int || "0"}.${rest.join("").slice(0, 2)}` : int;
  return (neg ? "-" : "") + out;
}

export function groupINR(raw) {
  const s = String(raw ?? "");
  const neg = s.startsWith("-");
  const [int, dec] = (neg ? s.slice(1) : s).split(".");
  const grouped =
    int.length > 3
      ? `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${int.slice(-3)}`
      : int;
  return (neg ? "-" : "") + grouped + (dec !== undefined ? `.${dec}` : "");
}

export const formatAmountInput = (input, opts) => groupINR(cleanAmount(input, opts));

/** Exact paise from the typed text (string maths, no float drift); null when empty. */
export function toPaise(input, opts) {
  const raw = cleanAmount(input, opts);
  if (!raw || raw === "-") return null;
  const neg = raw.startsWith("-");
  const [int, dec = ""] = (neg ? raw.slice(1) : raw).split(".");
  const p = Number(int || "0") * 100 + Number((dec + "00").slice(0, 2));
  return neg ? -p : p;
}
