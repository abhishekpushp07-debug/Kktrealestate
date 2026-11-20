// Phase 3F report engine helpers: India FY date presets and URL ⇄ filter state.
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function istToday() {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60000);
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const fyStart = (d) => new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1);
const qStart = (d) => {
  const m = d.getMonth();
  const fq = m >= 3 ? Math.floor((m - 3) / 3) * 3 + 3 : 0;
  return new Date(d.getFullYear(), m >= 3 ? fq : 0, 1);
};

/** REQ-262: Today · Yesterday · This/Last week · month · quarter (Apr–Jun…) · FY (Apr–Mar), India time. */
export const DATE_PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["this_week", "This week"],
  ["last_week", "Last week"],
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["this_quarter", "This quarter"],
  ["last_quarter", "Last quarter"],
  ["this_fy", "This FY"],
  ["last_fy", "Last FY"],
  ["next_7", "Next 7 days"],
  ["next_30", "Next 30 days"],
  ["next_90", "Next 90 days"],
  ["custom", "Custom range"],
];

export function presetRange(key, now = istToday()) {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const r = (a, b) => ({ from: iso(a), to: iso(b) });
  switch (key) {
    case "today":
      return r(t, t);
    case "yesterday":
      return r(addDays(t, -1), addDays(t, -1));
    case "this_week":
      return r(monday(t), t);
    case "last_week":
      return r(addDays(monday(t), -7), addDays(monday(t), -1));
    case "this_month":
      return r(new Date(t.getFullYear(), t.getMonth(), 1), t);
    case "last_month":
      return r(
        new Date(t.getFullYear(), t.getMonth() - 1, 1),
        new Date(t.getFullYear(), t.getMonth(), 0),
      );
    case "this_quarter":
      return r(qStart(t), t);
    case "last_quarter": {
      const s = qStart(t);
      return r(new Date(s.getFullYear(), s.getMonth() - 3, 1), addDays(s, -1));
    }
    case "this_fy":
      return r(fyStart(t), t);
    case "last_fy": {
      const s = fyStart(t);
      return r(new Date(s.getFullYear() - 1, 3, 1), addDays(s, -1));
    }
    case "next_7":
      return r(t, addDays(t, 7));
    case "next_30":
      return r(t, addDays(t, 30));
    case "next_90":
      return r(t, addDays(t, 90));
    default:
      return null;
  }
}

export const todayIso = () => iso(istToday());

export const splitList = (v) => (v ? v.split(",").filter(Boolean) : []);

export function setParam(sp, key, value) {
  const n = new URLSearchParams(sp);
  if (value == null || value === "" || (Array.isArray(value) && !value.length) || value === false)
    n.delete(key);
  else n.set(key, Array.isArray(value) ? value.join(",") : value === true ? "1" : String(value));
  if (key !== "page") n.delete("page");
  return n;
}

export const STATUS_TONE = {
  overdue: "var(--due)",
  advance: "var(--advance)",
  due: "var(--accent)",
  clear: "var(--text-2)",
  cancelled: "var(--text-3)",
  transferred: "var(--text-3)",
};

export const LEGACY_REDIRECT = {
  "collections-v2": "collections",
  "roznamcha-summary": "day-book",
  "bank-receipts": "bank-receipts",
  cheques: "cheques",
  "demand-vs-collection": "bills-vs-collection",
  "outstanding-v2": "outstanding",
  "cash-vs-account": "cash-vs-account",
  "other-charges": "other-charges",
  "receivables-forecast": "receivables-forecast",
  "waiver-register": "waivers",
};
