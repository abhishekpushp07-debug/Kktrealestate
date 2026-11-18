// E6: ONE business-day helper. A calendar date in this app is the company's day (companies.time_zone, default
// Asia/Kolkata) — never the browser's UTC slice, which is "yesterday" between 00:00 and 05:30 IST.
let tz = "Asia/Kolkata";
let offsetDays = 0;

const fmt = (d) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** Pure calendar arithmetic on YYYY-MM-DD (UTC-midnight anchor, no time zone involved). */
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10); // business-day: ok (UTC-midnight anchor of a calendar date)
};

const diffDays = (a, b) =>
  Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 864e5);

export const setBusinessTz = (zone) => {
  if (zone) tz = zone;
};
/** The server's business_day (e.g. /dashboard/home) corrects a skewed browser clock. */
export const syncServerDay = (serverDay) => {
  if (serverDay) offsetDays = diffDays(serverDay, fmt(new Date()));
};
export const businessToday = () => addDays(fmt(new Date()), offsetDays);
/** The business day an instant (Date) falls on. */
export const businessDayOf = (d) => fmt(d);
export const daysAgo = (n) => addDays(businessToday(), -n);
export const monthStart = (iso = businessToday()) => `${iso.slice(0, 7)}-01`;
export const fyStart = (iso = businessToday()) => {
  const y = Number(iso.slice(0, 4));
  return `${Number(iso.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
};
/** YYYY-MM shifted by n months (pure calendar math). */
export const addMonths = (ym, n) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
