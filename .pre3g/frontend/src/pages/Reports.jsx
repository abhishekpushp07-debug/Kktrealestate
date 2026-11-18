import { ShieldAlert } from "lucide-react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { setCrumbLabel } from "@/lib/crumbs";
import { LEGACY_REDIRECT } from "@/lib/reportsV3";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useMemo, useState } from "react";
import {
  useParams,
  useNavigate,
  Link,
  useSearchParams,
  useLocation,
  Navigate,
} from "react-router-dom";
import {
  Download,
  FileText,
  Printer,
  Save,
  Trash2,
  Pencil,
  BarChart3,
  Receipt,
  Building2,
  Users,
  Wrench,
  Activity,
  Check,
  X,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";
import api, { errMsg } from "@/lib/api";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useList";
import { inr, inrShort, fmtDate, MODE_LABEL } from "@/lib/format";
import { Card, StatTile, Skeleton, EmptyState } from "@/components/v2";
import { Segmented } from "@/components/v2/CustomerBits";
import { DateInput } from "@/components/common/DateInput";
import { cn } from "@/lib/utils";
import {
  FILTERS,
  permFor,
  GROUP_LABEL,
  GROUP_ORDER,
  JOURNEY,
  adaptReport,
  stepOf,
} from "@/lib/reportsMeta";
import { BalanceCell } from "@/components/common/BalanceCell";
import { Button } from "@/components/ui/button";
import { businessToday, fyStart, monthStart } from "@/lib/businessDay";
const GROUP_ICON = {
  Money: Receipt,
  Sales: Users,
  Construction: Building2,
  Inventory: Wrench,
  Admin: Activity,
};

const COLORS = [
  "var(--text-1)",
  "var(--accent)",
  "var(--advance)",
  "var(--due)",
  "var(--text-3)",
  "var(--text-1)",
];
const DESC = {
  collections: "Receipts by period, split across Cash, Account and Other-charges ledgers.",
  outstanding: "Dues by customer, block or project with ageing buckets.",
  advances: "Customers who have paid ahead of their demands.",
  "demand-vs-collection": "Billed vs received per stage / instalment.",
  "upcoming-dues": "Forecast of bills that will be raised soon.",
  inventory: "Available / hold / booked / sold inventory with velocity and realised rates.",
  cheques: "Cheques in hand, bounced or cleared.",
  cancellations: "Cancelled bookings and refunds.",
  "sales-leads": "Lead funnel, enquiries and response times.",
  "roznamcha-range": "Day-book totals across a date range.",
  "bank-receipts": "Receipts grouped by bank account.",
  activity: "Who did what, when.",
  "service-sla":
    "Tickets by category and status, SLA met %, average resolution time and customer ratings.",
  "construction-progress":
    "Per-tower stage status, planned vs actual dates, site photos and bills raised per stage.",
};
const MAP = {
  group_by_out: "group_by",
  group_by_inv: "group_by",
  cheque_status: "status",
  group: "group_by",
};
const PRESET_DATES = {
  Today: () => {
    const t = businessToday();
    return { from_date: t, to_date: t };
  },
  "This month": () => {
    const t = businessToday();
    return { from_date: monthStart(t), to_date: t };
  },
  FY: () => {
    const t = businessToday();
    return { from_date: fyStart(t), to_date: t };
  },
  Custom: () => ({}),
};

function cell(col, v) {
  if (v == null || v === "") return "—";
  if (col.key === "balance_signed_paise") return <BalanceCell balance={v / 100} chip={false} />;
  if (col.type === "money") return inr(v / 100);
  if (col.type === "pct") return `${v}%`;
  if (col.type === "date") return fmtDate(v);
  return String(v);
}
export function openPdf(path) {
  api
    .get(path, { responseType: "blob" })
    .then((r) => {
      const url = URL.createObjectURL(r.data);
      window.open(url, "_blank");
    })
    .catch((e) => toast.error(errMsg(e)));
}
const Sel = ({ value, onChange, children, testId, label }) => (
  <NativeSelect
    className="input !h-10 !w-auto min-w-[130px] !py-0 text-sm"
    value={value}
    onChange={onChange}
    data-testid={testId}
    aria-label={label || testId}
  >
    {children}
  </NativeSelect>
);

function kpis(key, d) {
  if (!d) return [];
  const t = d.totals || {};
  const m = (v) => inrShort((v || 0) / 100);
  if (key === "collections-v2")
    return [
      ["Net received", m(t.total_paise), `${t.count || 0} receipts`],
      ["Cash", m(t.cash_paise)],
      ["Account", m(t.account_paise)],
      [
        "Pending instruments",
        m(t.pending_paise),
        `${t.pending_instruments || 0} not yet cleared`,
        t.pending_paise ? "brick" : undefined,
      ],
    ];
  if (key === "outstanding-v2")
    return [
      ["Bill raised", m(t.bill_raised_paise)],
      ["Received", m(t.received_paise)],
      [
        "Balance (Received − Bill raised)",
        m(t.balance_paise),
        `${t.bookings || 0} live bookings`,
        t.balance_paise > 0 ? "brick" : "sage",
      ],
      [
        "Overdue",
        m(t.overdue_paise),
        `advance held ${m(t.advance_paise)}`,
        t.overdue_paise > 0 ? "brick" : undefined,
      ],
    ];
  if (key === "cash-vs-account")
    return [
      ["Cash agreed", m(t.cash_agreed_paise), `raised ${m(t.cash_raised_paise)}`],
      ["Cash balance", m(t.cash_balance_paise), undefined, t.cash_balance_paise ? "brick" : "sage"],
      ["Account agreed", m(t.account_agreed_paise), `raised ${m(t.account_raised_paise)}`],
      ["Variance", String(t.variance || "—"), `${t.bookings || 0} bookings`],
    ];
  if (key === "receivables-forecast")
    return [
      ["Still to raise", m(t.expected_paise), "Σ forecast"],
      ["Expected Cash", m(t.cash_paise)],
      ["Expected Account", m(t.account_paise)],
      [
        "Agreement total",
        m(t.agreement_paise),
        `raised ${m(t.raised_paise)} · forecast + raised = agreement`,
        "sage",
      ],
    ];
  if (key === "other-charges")
    return [
      ["Bill raised", m(t.demanded_paise), `${t.lines || 0} lines`],
      ["Received", m(t.collected_paise)],
      ["Balance", m(t.balance_paise), undefined, t.balance_paise ? "brick" : "sage"],
      ["% collected", t.pct_collected != null ? `${t.pct_collected}%` : "—"],
    ];
  if (key === "roznamcha-summary")
    return [
      ["Opening cash", m(t.opening_paise)],
      ["Cash received", m(t.cash_in_paise), `${t.receipts || 0} receipts`],
      ["Deposited", m(t.deposit_paise), `withdrawn ${m(t.withdrawal_paise)}`],
      ["Closing cash", m(t.closing_paise), undefined, "sage"],
    ];
  if (key === "waiver-register")
    return [
      ["Approved (credit notes)", m(t.approved_paise), `GST credit ${rs(t.gst_paise)}`],
      [
        "Pending approval",
        m(t.pending_paise),
        `${t.pending ?? 0} request(s) · no money moved`,
        "brick",
      ],
      ["Cancelled", m(t.cancelled_paise), "reversed in full"],
      ["Rejected", String(t.rejected ?? 0)],
    ];
  if (key === "discount-register")
    return [
      ["List price", m(t.list_paise)],
      ["Agreed", m(t.agreed_paise)],
      ["Discount given", m(t.discount_paise), `${t.pct ?? 0}% · list − agreed`, "brick"],
      ["Not recorded", String(t.not_recorded ?? 0), "no stored list price"],
    ];
  if (key === "site-visits")
    return [
      ["Visits", String(t.scheduled ?? 0)],
      ["Completed", String(t.completed ?? 0), `${t.show_pct ?? 0}% show-up`],
      [
        "No-show / cancelled",
        String((t.no_show || 0) + (t.cancelled || 0)),
        undefined,
        t.no_show || 0 ? "brick" : undefined,
      ],
      ["Visit → booking", `${t.conversion_pct ?? 0}%`, `${t.converted || 0} bookings`, "sage"],
    ];
  if (key === "upcoming-dues") {
    const total = (d.rows || []).reduce((a, r) => a + (r.total_paise || 0), 0); // Σ rows
    return [
      ["Instalments", String(d.rows?.length || 0), `next ${d.horizon_days ?? "—"} days`],
      ["Total", inrShort(total / 100), "Σ rows"],
      ["With a date", inrShort((d.dated_total_paise || 0) / 100)],
      [
        "Date not yet known",
        inrShort((total - (d.dated_total_paise || 0)) / 100),
        "stage not completed",
      ],
    ];
  }
  if (key === "sales-team")
    return [
      ["Leads", String(t.leads ?? 0)],
      ["Bookings", String(t.bookings ?? 0), m(t.sold_paise)],
      ["Collections", m(t.collected_paise)],
      [
        "Overdue",
        m(t.overdue_paise),
        "across their customers",
        t.overdue_paise ? "brick" : undefined,
      ],
    ];
  if (key === "construction-vs-plan")
    return [
      ["Towers", String(d.rows?.length || 0)],
      ["Stages done", `${t.completed ?? 0} / ${t.stages ?? 0}`],
      ["Stage bills", m(t.stage_demanded_paise), `collected ${m(t.stage_collected_paise)}`],
      ["Next-stage Bill raised", m(t.next_expected_paise), "expected on completion"],
    ];
  if (key === "data-quality")
    return [
      ["Records to review", String(t.count ?? 0), t.status, t.count ? "brick" : "sage"],
      ["Checks", String(d.rows?.length || 0)],
      [
        "Integrity",
        d.integrity ? (d.integrity.ok ? "OK" : "Findings") : "—",
        d.integrity?.ran_at ? fmtDate(d.integrity.ran_at) : undefined,
        d.integrity && !d.integrity.ok ? "brick" : "sage",
      ],
    ];
  if (key === "collections")
    return [
      ["Collected", inrShort((t.total_paise || 0) / 100), `${d.rows.length} periods`],
      ["Cash", inrShort((t.cash_paise || 0) / 100)],
      ["Account", inrShort((t.account_paise || 0) / 100)],
      [
        "Other charges",
        inrShort((t.other_paise || 0) / 100),
        t.gst_collected_paise != null ? `GST ${inrShort(t.gst_collected_paise / 100)}` : undefined,
      ],
    ];
  if (key === "outstanding")
    return [
      ["Raised", inrShort((t.raised_paise || 0) / 100)],
      ["Paid", inrShort((t.paid_paise || 0) / 100)],
      [
        "Due",
        inrShort((t.due_paise || 0) / 100),
        "all ledgers",
        t.due_paise > 0 ? "brick" : "sage",
      ],
      [
        "Overdue",
        inrShort((t.overdue_paise || 0) / 100),
        `${d.top_overdue?.length || 0} customers`,
        t.overdue_paise > 0 ? "brick" : undefined,
      ],
    ];
  if (key === "inventory")
    return [
      ["Units", String(t.total ?? 0)],
      ["Available", String(t.available ?? 0), inrShort((t.available_value_paise || 0) / 100)],
      ["Booked", String((t.booked || 0) + (t.hold || 0)), `${t.hold || 0} on hold`],
      ["Sold", String(t.sold ?? 0), inrShort((t.sold_value_paise || 0) / 100), "sage"],
    ];
  if (key === "sales-leads")
    return [
      ["Leads", String((d.funnel || []).reduce((a, s) => a + s.count, 0))],
      ["Avg response", d.avg_response_hours != null ? `${d.avg_response_hours} h` : "—"],
      [
        "Follow-ups overdue",
        String(d.follow_ups_overdue ?? 0),
        undefined,
        d.follow_ups_overdue ? "brick" : undefined,
      ],
      ["Web enquiries", String((d.enquiries_per_project || []).reduce((a, e) => a + e.count, 0))],
    ];
  if (key === "service-sla")
    return [
      ["Tickets", String(t.total ?? 0), `${t.open ?? 0} open`],
      [
        "SLA met",
        t.sla_met_pct != null ? `${t.sla_met_pct}%` : "—",
        "resolved within SLA",
        t.sla_met_pct != null && t.sla_met_pct < 80 ? "brick" : "sage",
      ],
      ["Avg resolution", t.avg_resolution_h != null ? `${t.avg_resolution_h} h` : "—"],
      ["Avg rating", t.avg_rating != null ? `${t.avg_rating} ★` : "—", "closed tickets"],
    ];
  if (key === "construction-progress") {
    const tw = d.towers || [];
    return [
      ["Towers", String(tw.length), `${tw.filter((x) => x.pct === 100).length} possession ready`],
      [
        "Avg progress",
        tw.length ? `${Math.round(tw.reduce((a, x) => a + x.pct, 0) / tw.length)}%` : "—",
        "stages completed",
      ],
      ["Site photos", String(t.photos ?? 0)],
      ["Stage bills", String(t.demands ?? 0), inrShort((t.demand_paise || 0) / 100)],
    ];
  }
  if (key === "activity")
    return [
      [
        "Audit rows",
        String((d.actions || []).reduce((a, x) => a + x.count, 0)),
        `${(d.actions || []).length} action types`,
      ],
      ["Logins", String(t.success ?? 0)],
      ["Failed logins", String(t.failed ?? 0), undefined, t.failed ? "brick" : undefined],
      ["Users seen", String(d.rows?.length || 0)],
    ];
  if (key === "cheques")
    return [
      ["Instruments", String(d.rows?.length || 0), inrShort((t.amount_paise || 0) / 100)],
      ...Object.entries(d.by_status || {})
        .slice(0, 3)
        .map(([k, v]) => [
          k,
          String(v.count),
          inrShort(v.amount_paise / 100),
          k === "Bounced" ? "brick" : k === "Cleared" ? "sage" : undefined,
        ]),
    ];
  const money = Object.entries(t)
    .filter(([k]) => k.endsWith("_paise"))
    .slice(0, 4);
  if (money.length)
    return money.map(([k, v]) => [
      k
        .replace(/_paise$/, "")
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase()),
      inrShort((v || 0) / 100),
    ]);
  return [["Entries", String(d.rows?.length || 0)]];
}

export const kpiTuples = (key, data) =>
  data?.kpis
    ? data.kpis.map((k) => [
        k.label,
        k.kind === "money" ? inrShort((k.value_paise || 0) / 100) : String(k.value ?? ""),
        k.hint,
        k.tone || undefined,
      ])
    : kpis(key, data);

const rs = (v) => inrShort((v || 0) / 100);
/** REQ-178: the grand total said in words, from the same totals the report returns. */
function formulaText(key, d, bucket) {
  const t = d?.totals || {};
  if (d?.formula_text) return d.formula_text;
  if (bucket && d?.kpis) {
    const [band, theirs, overdue] = d.kpis;
    return (
      `In band ${bucket} days: ${rs(band?.value_paise)} across ${d.rows?.length || 0} bookings · their outstanding in all bands` +
      ` ${rs(theirs?.value_paise)} · their overdue ${rs(overdue?.value_paise)}`
    );
  }
  if (key === "outstanding-v2" || key === "outstanding")
    return t.bill_raised_paise != null
      ? `Bill raised ${rs(t.bill_raised_paise)} − received ${rs(t.received_paise)} = net ${rs(t.net_balance_paise)} (outstanding` +
          ` ${rs(t.outstanding_paise)} − advance held ${rs(t.advance_paise)}) · outstanding till ${fmtDate(d.as_of)}: overdue ${rs(t.overdue_paise)} ·` +
          ` not due ${rs(t["band_Not due"])}`
      : null;
  if (key === "collections-v2")
    return (
      `Cash ${rs(t.cash_paise)} + Account ${rs(t.account_paise)}${t.other_paise ? ` + Other charges ${rs(t.other_paise)}` : ""} =` +
      ` ${rs(t.total_paise)} received · ${rs(t.pending_paise)} in instruments not yet cleared`
    );
  if (key === "receivables-forecast")
    return `Agreement ${rs(t.agreement_paise)} − already raised ${rs(t.raised_paise)} = ${rs(t.expected_paise)} still to raise`;
  if (key === "other-charges")
    return `Bill raised ${rs(t.demanded_paise)} − received ${rs(t.collected_paise)} = ${rs(t.balance_paise)} balance`;
  if (key === "cash-vs-account")
    return (
      `Cash agreed ${rs(t.cash_agreed_paise)} · raised ${rs(t.cash_raised_paise)} · balance ${rs(t.cash_balance_paise)} — Account agreed` +
      ` ${rs(t.account_agreed_paise)} · raised ${rs(t.account_raised_paise)}`
    );
  if (key === "demand-vs-collection")
    return (
      `Instalment bills ${rs(t.demand_paise)} (cash ${rs(t.cash_demand_paise)} + account ${rs(t.account_demand_paise)}) − received` +
      ` ${rs(t.collected_paise)} = ${rs(t.demand_paise - t.collected_paise)} still due · ${t.pct_collected}% recovered`
    );
  if (key === "advances")
    return (
      `Cash advance ${rs(t.cash_advance_paise)} + account advance ${rs(t.account_advance_paise)} = ${rs(t.total_advance_paise)} advance held` +
      ` (same as the Outstanding report)`
    );
  if (key === "cheques" && d.by_status) {
    const b = (k) => d.by_status[k]?.amount_paise || 0;
    return (
      `Received ${rs(t.amount_paise)} − cleared ${rs(b("Cleared"))} − bounced ${rs(b("Bounced"))} =` +
      ` ${rs(t.amount_paise - b("Cleared") - b("Bounced"))} pending`
    );
  }
  if (key === "cancellations")
    return t.refund_paise
      ? `Refundable ${rs(t.refund_paise)} − paid ${rs(t.refund_paid_paise)} = ${rs(t.refund_paise - t.refund_paid_paise)} refund pending · forfeited` +
          ` ${rs(t.forfeiture_paise)}`
      : "No cancellations in this period — nothing refundable, nothing pending";
  if (key === "bank-receipts")
    return `Sum of ${d.rows?.length || 0} bank lines = ${rs(t.total_paise)} (cleared ${rs(t.cleared_paise)} + pending ${rs(t.pending_paise)})`;
  if (key === "construction-vs-plan")
    return (
      `Stage bills raised ${rs(t.demanded_paise)} − received ${rs(t.collected_paise)} = ${rs(t.balance_paise)} stage balance · next stages` +
      ` expected ${rs(t.expected_paise)}`
    );
  if (key === "roznamcha-summary" && t.opening_paise != null)
    return (
      `Opening cash ${rs(t.opening_paise)} + cash received ${rs(t.cash_in_paise)} − cash paid out ${rs(t.cash_out_paise)} = closing cash` +
      ` ${rs(t.closing_paise)}`
    );
  const k = kpiTuples(key, d).filter(([, v]) => v && v !== "—");
  return k.length ? k.map(([l, v]) => `${l} ${v}`).join(" · ") : null;
}
/** REQ-178: carried from before (ledger) — opening at From + billed in period − received in period = balance at To. */
/** Bills vs Collection → Outstanding: instalment bills reconcile to all bills raised (tieout). */
function bridgeText(d) {
  const b = d?.bridge;
  if (!b) return null;
  const notLive = b.not_live_paise
    ? ` − on cancelled or transferred bookings ${rs(b.not_live_paise)}`
    : "";
  const adjust = b.adjust_paise
    ? ` ${b.adjust_paise < 0 ? "−" : "+"} adjustments ${rs(Math.abs(b.adjust_paise))}`
    : "";
  return (
    `Instalment bills ${rs(b.instalment_paise)}${notLive} + other charges ${rs(b.other_charges_paise)}${adjust}` +
    ` = ${rs(b.all_bills_paise)} all bills raised (as in Outstanding & Ageing)`
  );
}

function carriedText(d) {
  const c = d?.carried;
  if (!c) return null;
  return (
    `Carried from before ${fmtDate(c.from_date)}: ${rs(c.opening_paise)} net balance + bills raised in period ${rs(c.billed_paise)} − received` +
    ` in period ${rs(c.received_paise)}${c.waived_paise ? ` − waived ${rs(c.waived_paise)}` : ""} = ${rs(c.closing_paise)} net balance at ${fmtDate(c.to_date)}`
  );
}

/** Carried counts receipts on the clearance (ledger) day; this line bridges from the payment-date total when they differ. */
function receivedBridgeText(d) {
  const b = d?.received_bridge;
  if (!b || b.by_receipt_date_paise === b.by_clearance_paise) return null;
  const term = (v, sign, words) => (v ? ` ${sign} ${words} ${rs(Math.abs(v))}` : "");
  return (
    `Received (by payment date) ${rs(b.by_receipt_date_paise)}` +
    term(b.not_live_paise, "−", "on cancelled or transferred bookings") +
    term(b.dated_in_cleared_after_paise, "−", "cheques dated in period, cleared after") +
    term(b.dated_before_cleared_in_paise, "+", "cheques dated before, cleared in period") +
    term(b.refunds_paise, b.refunds_paise < 0 ? "−" : "+", "refunds paid") +
    ` = received by clearance ${rs(b.by_clearance_paise)}`
  );
}

/** What the lines of a report are, in words (never "rows"). */
const UNIT = {
  booking: ["booking", "bookings"],
  customer: ["customer", "customers"],
  project: ["project", "projects"],
  block: ["tower", "towers"],
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  bucket: ["ledger", "ledgers"],
  mode: ["mode", "modes"],
  bank: ["bank", "banks"],
  rm: ["RM", "RMs"],
  receipt: ["receipt", "receipts"],
};
const KEY_UNIT = {
  "demand-vs-collection": ["stage", "stages"],
  cheques: ["instrument", "instruments"],
  "bank-receipts": ["bank line", "bank lines"],
  "sales-leads": ["source", "sources"],
  "site-visits": ["line", "lines"],
  "sales-team": ["person", "people"],
  "hold-register": ["hold", "holds"],
  activity: ["action", "actions"],
  "data-quality": ["check", "checks"],
  "construction-vs-plan": ["stage", "stages"],
  "construction-progress": ["stage", "stages"],
  "other-charges": ["charge line", "charge lines"],
  advances: ["booking", "bookings"],
  cancellations: ["cancellation", "cancellations"],
  inventory: ["tower", "towers"],
};
function countWords(key, d, count) {
  const [one, many] = UNIT[d.group_by] || KEY_UNIT[key] || ["entry", "entries"];
  let s = `${count.toLocaleString("en-IN")} ${count === 1 ? one : many}`;
  if (key === "collections-v2" && d.totals?.count != null)
    s += ` · ${d.totals.count.toLocaleString("en-IN")} receipts`;
  return s;
}

const LEGEND = {
  "outstanding-v2":
    "Outstanding = bill raised − received · advance shown separately · cancelled bookings excluded",
  outstanding:
    "Outstanding = bill raised − received · advance shown separately · cancelled bookings excluded",
  "collections-v2":
    "Received = Cash + Account (+ Other charges) · cleared instruments only · bounced and reversed excluded",
  "receivables-forecast":
    "Still to raise = agreement − already raised · forecast by construction plan dates",
  "other-charges": "Balance = bill raised − received, per charge line",
  "demand-vs-collection": "Per stage: bill raised vs received · balance = bill raised − received",
  "cash-vs-account": "Agreed split vs raised and received, per ledger",
};

function ReportView() {
  const { can } = useAuth();
  const { key = "collections-v2" } = useParams();
  const nav = useNavigate();
  const { data: list } = useFetch("/reports");
  const { data: projects } = useFetch("/projects?page_size=50");
  const [sp] = useSearchParams();
  const [f, setF] = useState({
    group_by: "month",
    group_by_out: "customer",
    group_by_inv: "block",
    cheque_status: "All",
    group: "",
    date_basis: "receipt",
    days: "90",
    ...PRESET_DATES.FY(),
    ...(sp.get("project_id") ? { project_id: sp.get("project_id") } : {}),
    // Home drill-downs open the report on the exact range the widget added up
    ...(sp.get("from_date") ? { from_date: sp.get("from_date"), to_date: sp.get("to_date") } : {}),
  });
  useEffect(() => {
    setF((p) => ({ ...p, group: "" }));
  }, [key]);
  const [range, setRange] = useState(sp.get("from_date") ? "Custom" : "FY"); // a drilled range is not the FY
  const [presetName, setPresetName] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [activePreset, setActivePreset] = useState(null);
  const { data: presets, reload: reloadPresets } = useFetch(`/reports/presets?report_key=${key}`, [
    key,
  ]);
  const params = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(f)
          .filter(([k, v]) => v && v !== "All" && FILTERS[key]?.includes(k))
          .map(([k, v]) => [MAP[k] || k, v]),
      ),
    [f, key],
  );
  const qs = new URLSearchParams(params).toString();
  const { data: raw, loading } = useFetch(`/reports/${key}${qs ? `?${qs}` : ""}`, [key, qs]);
  const bucket = key === "outstanding-v2" ? sp.get("bucket") : null;
  const data = useMemo(() => {
    const d = adaptReport(key, raw);
    if (!d || !bucket) return d;
    const rows = (d.rows || []).filter((r) => (r[`band_${bucket}`] || 0) > 0);
    const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const money = (label, v, extra) => ({ label, value_paise: v, kind: "money", ...extra });
    // Opened from a Home ageing band: the cards describe that band too, so the click total == the first card
    const kpis = [
      money(`In band ${bucket}`, sum(`band_${bucket}`), {
        hint: `${rows.length} bookings`,
        tone: "brick",
      }),
      money("Their outstanding", sum("outstanding_paise"), { hint: "all bands, these bookings" }),
      money("Their overdue", sum("overdue_paise")),
      money("Advance held", sum("advance_paise"), { tone: "sage" }),
    ];
    return { ...d, rows, kpis };
  }, [key, raw, bucket]);
  const bandTotal = bucket
    ? (data?.rows || []).reduce((a, r) => a + (r[`band_${bucket}`] || 0), 0)
    : 0;
  const meta = (list?.items || []).find((r) => r.key === key);
  useEffect(() => {
    document.title = `Reports · ${meta?.name || key}`;
    setCrumbLabel(key, meta?.name);
  }, [key, meta]);
  const set = (k) => (e) => {
    setActivePreset(null);
    setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));
  };
  const has = (k) => FILTERS[key]?.includes(k);
  const chart =
    data &&
    (key === "collections"
      ? {
          type: "bar",
          rows: data.rows.map((r) => ({
            name: r.period,
            Cash: r.cash_paise / 100,
            Account: r.account_paise / 100,
            Other: r.other_paise / 100,
          })),
          keys: ["Cash", "Account", "Other"],
          stacked: true,
        }
      : key === "outstanding"
        ? {
            type: "pie",
            rows: data.ageing.map((a) => ({ name: a.bucket, value: a.amount_paise / 100 })),
          }
        : key === "sales-leads"
          ? {
              type: "bar",
              rows: data.funnel.map((s) => ({ name: s.stage, Leads: s.count })),
              keys: ["Leads"],
            }
          : key === "inventory"
            ? {
                type: "bar",
                rows: data.velocity.map((v) => ({ name: v.month, Bookings: v.bookings })),
                keys: ["Bookings"],
              }
            : key === "service-sla"
              ? {
                  type: "bar",
                  rows: data.rows.map((r) => ({
                    name: r.category,
                    Open: r.open,
                    Resolved: r.resolved,
                  })),
                  keys: ["Open", "Resolved"],
                  stacked: true,
                }
              : key === "construction-progress"
                ? {
                    type: "bar",
                    rows: (data.towers || []).map((x) => ({ name: x.tower, Progress: x.pct })),
                    keys: ["Progress"],
                  }
                : key === "demand-vs-collection"
                  ? {
                      type: "bar",
                      rows: data.rows.slice(0, 20).map((r) => ({
                        name: r.milestone.split(". ")[1] || r.milestone,
                        Billed: r.demand_paise / 100,
                        Collected: r.collected_paise / 100,
                      })),
                      keys: ["Billed", "Collected"],
                    }
                  : null);
  const download = () =>
    api
      .get(`/reports/${key}`, { params: { ...params, format: "csv" }, responseType: "blob" })
      .then(async (r) => {
        if (r.status === 202) {
          const j = JSON.parse(await r.data.text());
          toast.success(j.message, {
            action: { label: "Exports", onClick: () => nav("/reports/exports") },
          });
          return;
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(r.data);
        a.download = `${key}.csv`;
        a.click();
      })
      .catch((e) => toast.error(errMsg(e)));
  const savePreset = async () => {
    try {
      const r = await api.post("/reports/presets", {
        report_key: key,
        name: presetName.trim(),
        filters: f,
      });
      setPresetName("");
      setActivePreset(r.data.id);
      reloadPresets();
      toast.success("Preset saved");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const items = presets?.items || [];
  return (
    <div className="space-y-8" data-testid="reports-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/reports" className="e-title hidden md:block" data-testid="page-title">
            reports.
          </Link>
        </div>
      </header>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[260px_1fr]">
        <aside className="hidden min-w-0 md:block print:hidden">
          <Card className="!p-3" testId="report-list">
            {GROUP_ORDER.map((gname) => {
              const steps = JOURNEY[gname];
              const rs = (list?.items || [])
                .filter((r) => stepOf(r)[0] === gname && !r.hidden && can(`${permFor(r.key)}.view`))
                .map((r) => ({ ...r, step: stepOf(r)[1] }))
                .sort((a, b) => steps.indexOf(a.step) - steps.indexOf(b.step));
              if (!rs.length) return null;
              const Icon = GROUP_ICON[gname] || BarChart3;
              return (
                <div key={gname} className="mb-3 last:mb-0">
                  <p
                    className="flex items-center gap-2 px-3 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-txt-muted"
                    data-testid={`report-group-${gname.toLowerCase()}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {gname}
                  </p>
                  {steps.length > 1 && (
                    <p className="px-3 pb-1 text-[10px] leading-4 text-txt-muted">
                      {steps.join(" → ")}
                    </p>
                  )}
                  {rs.map((r, i) => (
                    <div key={r.key}>
                      {steps.length > 1 && r.step && r.step !== rs[i - 1]?.step && (
                        <p
                          className="px-3 pt-1.5 text-[10px] font-semibold text-gold"
                          data-testid={`report-step-${r.key}`}
                        >
                          {r.step}
                        </p>
                      )}
                      <button
                        key={r.key}
                        onClick={() => nav(`/reports/${r.key}`)}
                        title={r.purpose}
                        className={cn(
                          "block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          r.key === key
                            ? "bg-ink-950 font-semibold text-warm-50"
                            : "text-ink-950 hover:bg-warm-100",
                        )}
                        data-testid={`report-${r.key}`}
                      >
                        {r.name}
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </Card>
        </aside>
        <section className="min-w-0 space-y-6">
          {!can(`${permFor(key)}.view`) ? (
            <EmptyState
              icon={ShieldAlert}
              title="Access restricted"
              description={`Your role lacks the ${permFor(key)}.view permission.`}
              testId="forbidden-report"
            />
          ) : (
            <>
              <div className="e-sheet" data-testid="report-sheet">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      to="/reports"
                      className="mb-2 block text-xs text-[#aab4c8] md:hidden"
                      data-testid="report-back-hub"
                    >
                      ‹ all reports
                    </Link>
                    <span className="e-caps-blue" data-testid="report-journey">
                      {meta ? stepOf(meta).filter(Boolean).join(" · ") : ""}
                    </span>
                    <h2 className="e-stitle" data-testid="report-title">
                      {meta?.name || key}
                    </h2>
                    <p className="e-ssub" data-testid="report-scope">
                      {[
                        data &&
                          countWords(
                            key,
                            data,
                            bucket
                              ? data.rows?.length || 0
                              : (data.total_rows ?? data.rows?.length ?? 0),
                          ),
                        f.project_id
                          ? (projects?.items || []).find((p) => p.id === f.project_id)?.name
                          : "all projects",
                        bucket && `ageing band ${bucket} days`,
                        has("from_date")
                          ? `${fmtDate(f.from_date)} → ${fmtDate(f.to_date)}`
                          : data?.as_of && `as of ${fmtDate(data.as_of)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-1 text-xs text-txt-muted" data-testid="report-purpose">
                      {meta?.purpose || DESC[key]}
                      {data?.basis_text ? ` · ${data.basis_text}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2 print:hidden">
                    <button
                      type="button"
                      className="e-ebtn"
                      onClick={() => window.print()}
                      data-testid="rf-print"
                    >
                      <Printer className="h-4 w-4" /> Print
                    </button>
                    {can(`${permFor(key)}.export`) && (
                      <>
                        <button
                          type="button"
                          className="e-ebtn"
                          onClick={() => openPdf(`/reports/${key}?${qs}&format=pdf`)}
                          data-testid="rf-export-pdf"
                        >
                          <FileText className="h-4 w-4" /> PDF
                        </button>
                        <button
                          type="button"
                          className="e-ebtn"
                          onClick={download}
                          data-testid="rf-export-csv"
                        >
                          <Download className="h-4 w-4" /> Excel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Card className="space-y-4 print:hidden" testId="report-filters">
                <div className="flex flex-wrap items-center gap-3">
                  {has("from_date") && (
                    <Segmented
                      options={Object.keys(PRESET_DATES).map((k) => ({ value: k, label: k }))}
                      value={range}
                      onChange={(v) => {
                        setRange(v);
                        setActivePreset(null);
                        setF((p) => ({ ...p, ...PRESET_DATES[v]() }));
                      }}
                      testId="rf-range"
                    />
                  )}
                  {has("from_date") && range === "Custom" && (
                    <>
                      <DateInput
                        value={f.from_date || ""}
                        onChange={set("from_date")}
                        className="input !h-10 w-40"
                        data-testid="rf-from"
                      />
                      <span className="text-txt-muted">→</span>
                      <DateInput
                        value={f.to_date || ""}
                        onChange={set("to_date")}
                        className="input !h-10 w-40"
                        data-testid="rf-to"
                      />
                    </>
                  )}
                  {has("from_date") && range !== "Custom" && (
                    <span className="text-sm text-txt-secondary" data-testid="rf-range-text">
                      {fmtDate(f.from_date)} – {fmtDate(f.to_date)}
                    </span>
                  )}
                  {has("as_of") && (
                    <DateInput
                      className="input h-9"
                      value={f.as_of || ""}
                      onChange={set("as_of")}
                      data-testid="rf-as-of"
                      aria-label="As of"
                    />
                  )}
                  {has("project_id") && (
                    <Sel
                      value={f.project_id || ""}
                      onChange={set("project_id")}
                      testId="rf-project"
                    >
                      <option value="">All projects</option>
                      {(projects?.items || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} · {p.name}
                        </option>
                      ))}
                    </Sel>
                  )}
                  {has("mode") && (
                    <Sel value={f.mode || ""} onChange={set("mode")} testId="rf-mode">
                      <option value="">All modes</option>
                      {["CASH", "UPI", "NEFT_RTGS", "CHEQUE", "DD", "LOAN_DISBURSEMENT"].map(
                        (m) => (
                          <option key={m} value={m}>
                            {MODE_LABEL[m]}
                          </option>
                        ),
                      )}
                    </Sel>
                  )}
                  {has("category") && (
                    <Sel value={f.category || ""} onChange={set("category")} testId="rf-category">
                      <option value="">All ledgers</option>
                      {["Cash", "Account", "Other charges"].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </Sel>
                  )}
                  {has("status") && (
                    <Sel value={f.status || ""} onChange={set("status")} testId="rf-status">
                      <option value="">Cleared</option>
                      {["Pending", "Bounced", "Reversed"].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </Sel>
                  )}
                  {has("date_basis") && (
                    <Sel
                      value={f.date_basis || "receipt"}
                      onChange={set("date_basis")}
                      testId="rf-date-basis"
                      label="Date basis"
                    >
                      <option value="receipt">Date basis: Receipt date</option>
                      <option value="clearance">Date basis: Clearance date</option>
                    </Sel>
                  )}
                  {has("group") && data?.group_options && (
                    <Sel value={f.group || data.group_by} onChange={set("group")} testId="rf-group">
                      {data.group_options.map((m) => (
                        <option key={m} value={m}>
                          {GROUP_LABEL[m] || m}
                        </option>
                      ))}
                    </Sel>
                  )}
                  {has("group_by") && (
                    <Sel value={f.group_by} onChange={set("group_by")} testId="rf-groupby">
                      {["day", "week", "month"].map((m) => (
                        <option key={m} value={m}>
                          By {m}
                        </option>
                      ))}
                    </Sel>
                  )}
                  {has("group_by_out") && (
                    <Sel
                      value={f.group_by_out}
                      onChange={set("group_by_out")}
                      testId="rf-groupby-out"
                    >
                      {["customer", "block", "project"].map((m) => (
                        <option key={m} value={m}>
                          By {m}
                        </option>
                      ))}
                    </Sel>
                  )}
                  {has("group_by_inv") && (
                    <Sel
                      value={f.group_by_inv}
                      onChange={set("group_by_inv")}
                      testId="rf-groupby-inv"
                    >
                      {["project", "block", "flat_type", "floor"].map((m) => (
                        <option key={m} value={m}>
                          By {m.replace("_", " ")}
                        </option>
                      ))}
                    </Sel>
                  )}
                  {has("days") && (
                    <Sel value={f.days} onChange={set("days")} testId="rf-days" label="Horizon">
                      {["30", "90", "365"].map((n) => (
                        <option key={n} value={n}>
                          Next {n} days
                        </option>
                      ))}
                    </Sel>
                  )}
                  {has("cheque_status") && (
                    <Sel
                      value={f.cheque_status}
                      onChange={set("cheque_status")}
                      testId="rf-cheque-status"
                    >
                      {["All", "Pending", "Bounced", "Cleared", "Reversed"].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </Sel>
                  )}
                </div>
                <div
                  className="flex flex-wrap items-center gap-2 border-t border-warm-100 pt-4"
                  data-testid="rf-presets"
                >
                  <span className="label mr-1">Saved views</span>
                  {items.length === 0 && (
                    <span className="text-xs text-txt-muted">
                      None yet — set filters and save a view.
                    </span>
                  )}
                  {items.map((p) =>
                    renaming?.id === p.id ? (
                      <span key={p.id} className="flex items-center gap-1">
                        <input
                          autoFocus
                          className="input !h-8 w-36 text-xs"
                          value={renaming.name}
                          onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                          onKeyDown={async (e) => {
                            if (e.key === "Enter") {
                              await api.patch(
                                `/reports/presets/${p.id}`,
                                { name: renaming.name },
                                { unversioned: true },
                              );
                              setRenaming(null);
                              reloadPresets();
                            }
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          data-testid="rf-preset-rename-input"
                        />
                        <button
                          onClick={async () => {
                            await api.patch(
                              `/reports/presets/${p.id}`,
                              { name: renaming.name },
                              { unversioned: true },
                            );
                            setRenaming(null);
                            reloadPresets();
                          }}
                          className="text-sage"
                          aria-label="Save name"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setRenaming(null)}
                          className="text-txt-muted"
                          aria-label="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </span>
                    ) : (
                      <span
                        key={p.id}
                        className={cn(
                          "group inline-flex items-center gap-1 rounded-full border py-1 pl-3 pr-1.5 text-xs font-semibold transition-colors",
                          activePreset === p.id
                            ? "border-ink-950 bg-ink-950 text-warm-50"
                            : "border-warm-200 bg-white text-ink-950 hover:border-gold",
                        )}
                        data-testid={`rf-preset-${p.id}`}
                      >
                        <button
                          onClick={() => {
                            setActivePreset(p.id);
                            setRange("Custom");
                            setF((o) => ({ ...o, ...p.filters }));
                          }}
                          data-testid={`rf-preset-apply-${p.id}`}
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={() => setRenaming({ id: p.id, name: p.name })}
                          className="rounded-full p-1 opacity-60 hover:opacity-100"
                          aria-label="Rename"
                          data-testid={`rf-preset-rename-${p.id}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={async () => {
                            await api.delete(`/reports/presets/${p.id}`);
                            if (activePreset === p.id) setActivePreset(null);
                            reloadPresets();
                            toast.success("View deleted");
                          }}
                          className="rounded-full p-1 opacity-60 hover:text-brick hover:opacity-100"
                          aria-label="Delete"
                          data-testid={`rf-preset-delete-${p.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    ),
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <input
                      className="input !h-9 w-40 text-sm"
                      placeholder="Name this view"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      data-testid="rf-preset-name"
                    />
                    <Button
                      variant="soft"
                      size="compact"
                      className="!h-9"
                      why={!presetName.trim() ? "Type a name for the preset" : undefined}
                      disabled={!presetName.trim()}
                      onClick={savePreset}
                      data-testid="rf-save-preset"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save
                    </Button>
                  </span>
                </div>
              </Card>
              {loading && !data ? (
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-28" />
                  ))}
                </div>
              ) : (
                data && (
                  <div className="e-gt" data-testid="report-kpis">
                    <div className="e-gth">
                      <span>grand total</span>
                      <span className="text-txt-muted">
                        {f.project_id ? "this project" : "all projects"}
                        {bucket ? ` · band ${bucket}` : ""}
                      </span>
                    </div>
                    <div className="e-gtr">
                      {kpiTuples(key, data).map(([l, v, h, tone], i) => (
                        <div key={l} data-testid={`report-kpi-${i}`}>
                          <small>{l}</small>
                          <b
                            style={
                              tone === "brick"
                                ? { color: "var(--due)" }
                                : tone === "sage"
                                  ? { color: "var(--advance)" }
                                  : undefined
                            }
                          >
                            {v}
                          </b>
                          {h && <em>{h}</em>}
                        </div>
                      ))}
                    </div>
                    {bridgeText(data) && (
                      <p className="e-formula" data-testid="report-bridge">
                        {bridgeText(data)}
                      </p>
                    )}
                    {carriedText(data) && (
                      <p className="e-formula" data-testid="report-carried">
                        {carriedText(data)}
                      </p>
                    )}
                    {receivedBridgeText(data) && (
                      <p className="e-formula" data-testid="report-received-bridge">
                        {receivedBridgeText(data)}
                      </p>
                    )}
                    {formulaText(key, data, bucket) && (
                      <p className="e-formula" data-testid="report-formula">
                        {formulaText(key, data, bucket)}
                      </p>
                    )}
                  </div>
                )
              )}
              {bucket && data && (
                <div
                  className="flex flex-wrap items-center gap-3"
                  data-testid="report-bucket-banner"
                >
                  <span className="text-sm text-txt-secondary">
                    {data.rows.length} bookings · {inrShort(bandTotal / 100)} in this band
                  </span>
                </div>
              )}
              {chart && chart.rows.length > 0 && (
                <Card testId="report-chart">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="e-caps-blue">{chart.type === "pie" ? "Ageing" : "Trend"}</h3>
                    {chart.keys && (
                      <div className="flex gap-3 text-xs text-txt-secondary">
                        {chart.keys.map((k, i) => (
                          <span key={k} className="flex items-center gap-1.5">
                            <i
                              className="h-2.5 w-2.5 rounded-sm"
                              style={{ background: COLORS[i] }}
                            />
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="h-64 min-w-0">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      initialDimension={{ width: 800, height: 250 }}
                    >
                      {chart.type === "pie" ? (
                        <PieChart>
                          <Pie
                            data={chart.rows}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={60}
                            outerRadius={95}
                            paddingAngle={2}
                            stroke="none"
                          >
                            {chart.rows.map((row, i) => (
                              <Cell key={row.name} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Pie>
                          <RTooltip
                            formatter={(v) => inr(v)}
                            contentStyle={{
                              borderRadius: 10,
                              border: "1px solid var(--line)",
                              fontSize: 12,
                            }}
                          />
                        </PieChart>
                      ) : (
                        <BarChart data={chart.rows} barCategoryGap="28%">
                          <CartesianGrid vertical={false} stroke="var(--line)" />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: "var(--text-3)" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: "var(--text-3)" }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => inrShort(v)}
                            width={64}
                          />
                          <RTooltip
                            cursor={{ fill: "var(--surface-2)" }}
                            contentStyle={{
                              borderRadius: 10,
                              border: "1px solid var(--line)",
                              fontSize: 12,
                            }}
                            formatter={(v) => (typeof v === "number" && v > 1000 ? inr(v) : v)}
                          />
                          {chart.keys.map((k, i) => (
                            <Bar
                              key={k}
                              dataKey={k}
                              stackId={chart.stacked ? "a" : undefined}
                              fill={COLORS[i]}
                              radius={chart.stacked && i < chart.keys.length - 1 ? 0 : [6, 6, 0, 0]}
                            />
                          ))}
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                  {chart.type === "pie" && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {chart.rows.map((r, i) => (
                        <span key={r.name} className="pill bg-warm-100 text-ink-950">
                          <i
                            className="h-2 w-2 rounded-full"
                            style={{ background: COLORS[i % COLORS.length] }}
                          />
                          {r.name} · {inrShort(r.value)}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              )}
              {data?.top_overdue?.length > 0 && (
                <Card>
                  <h3 className="mb-3 e-caps-blue">Top overdue customers</h3>
                  <div className="flex flex-wrap gap-2">
                    {data.top_overdue.map((t) => (
                      <button
                        key={t.booking_number}
                        onClick={() => nav(`/customers/${t.customer_id || ""}`)}
                        className="pill bg-brick-50 text-brick hover:bg-brick/15"
                        data-testid={`report-overdue-${t.booking_number}`}
                      >
                        {t.customer_name} · {inrShort(t.overdue_paise / 100)}
                      </button>
                    ))}
                  </div>
                </Card>
              )}
              {data?.towers && (
                <div
                  className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
                  data-testid="report-towers"
                >
                  {data.towers.map((x) => (
                    <Card key={x.block_id} className="!p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[15px] font-semibold text-ink-950">{x.tower}</p>
                          <p className="text-xs text-txt-secondary">{x.project}</p>
                        </div>
                        <span className="font-display text-2xl text-ink-950">{x.pct}%</span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-warm-100">
                        <span
                          className="block h-full rounded-full bg-sage"
                          style={{ width: `${x.pct}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-txt-secondary">
                        {x.completed}/{x.stages} stages ·{" "}
                        <span className="pill bg-gold-light text-[var(--accent)]">
                          Now · {x.current_stage}
                        </span>
                      </p>
                    </Card>
                  ))}
                </div>
              )}
              {data?.status_counts && (
                <div className="flex flex-wrap gap-2" data-testid="report-status-counts">
                  {data.status_counts.map((m) => (
                    <span key={m.status} className="pill bg-warm-100 text-ink-950">
                      {m.status} · {m.count}
                    </span>
                  ))}
                </div>
              )}
              {data?.by_mode && (
                <div className="flex flex-wrap gap-2" data-testid="report-by-mode">
                  {data.by_mode.map((m) => (
                    <span key={m.mode} className="pill bg-warm-100 text-ink-950">
                      {m.mode.replace("_", " / ")} · {inrShort(m.total_paise / 100)}{" "}
                      <span className="text-txt-muted">({m.count})</span>
                    </span>
                  ))}
                </div>
              )}
              <Card className="!p-0 overflow-hidden" testId="report-table">
                {loading && !data ? (
                  <div className="space-y-2 p-6">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                ) : !data?.rows?.length ? (
                  <div className="p-6">
                    <EmptyState
                      icon={BarChart3}
                      title="No data for these filters"
                      description="Widen the date range or clear a filter."
                      testId="report-empty"
                    />
                  </div>
                ) : (
                  <div className="md:max-h-[60vh] md:overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-warm-100 text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
                        <tr>
                          {data.columns.map((c) => (
                            <th
                              key={c.key}
                              className={cn(
                                "px-4 py-3",
                                c.type === "str" ? "text-left" : "text-right",
                              )}
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((r, i) => (
                          <tr
                            key={r.id || data.columns.map((c) => r[c.key]).join("|")}
                            className={cn(
                              "h-11 border-t border-warm-100",
                              i % 2 === 1 && "bg-warm-50/60",
                            )}
                          >
                            {data.columns.map((c, ci) => (
                              <td
                                key={c.key}
                                className={cn(
                                  "px-4",
                                  c.type === "str" ? "text-ink-950" : "text-right tabular-nums",
                                  (c.type !== "str" ||
                                    ci === 0 ||
                                    /unit|number|code|ref/i.test(c.key)) &&
                                    "whitespace-nowrap",
                                )}
                              >
                                {ci === 0 && r._link ? (
                                  <button
                                    className="font-semibold text-ink-950 underline-offset-2 hover:underline"
                                    onClick={() => nav(r._link)}
                                    data-testid={`report-drill-${i}`}
                                  >
                                    {cell(c, r[c.key])}
                                  </button>
                                ) : (
                                  cell(c, r[c.key])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {data.totals && (
                        <tfoot
                          className="sticky bottom-0 bg-ink-950 font-semibold text-warm-50"
                          data-testid="report-totals"
                        >
                          <tr className="h-12">
                            {data.columns.map((c, i) => (
                              <td
                                key={c.key}
                                className={cn(
                                  "px-4",
                                  c.type === "str" ? "" : "text-right tabular-nums",
                                )}
                              >
                                {i === 0
                                  ? "Total"
                                  : data.totals[c.key] != null
                                    ? cell(c, data.totals[c.key])
                                    : ""}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </Card>
              <p className="e-legend" data-testid="report-legend">
                {LEGEND[key] || meta?.purpose || DESC[key]}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const STEP_ICON = {
  Lead: Users,
  Visit: Users,
  Booking: FileText,
  "Bill raised": Receipt,
  Received: Receipt,
  Balance: BarChart3,
  Overdue: BarChart3,
  Refund: Receipt,
  Stage: Building2,
  Bill: Building2,
  "Flat status": Wrench,
  Admin: Activity,
};

/** REQ-199: one tile's figure failing never blocks the hub. Same endpoint (same definitions) as the report. */

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "0%");
const n = (v) => Number(v || 0).toLocaleString("en-IN");
/** REQ-193/194: the one figure an owner wants per report, with its scope in plain words. FY = this financial year. */
const HEADLINE = {
  "sales-leads": (d, t) => ({
    value: `${n(t.leads)} leads`,
    caption: `${pct(t.converted, t.leads)} became bookings · this FY`,
  }),
  "waiver-register": (d, t) => ({
    value: rs(t.approved_paise),
    caption: `waived (credit notes) · ${t.pending ?? 0} pending · this FY`,
  }),
  "discount-register": (d, t) => ({
    value: rs(t.discount_paise),
    caption: `discount given · ${t.pct ?? 0}% of list · this FY`,
  }),
  "site-visits": (d, t) => ({
    value: `${t.conversion_pct ?? 0}%`,
    caption: `of ${n(t.completed)} completed visits converted · this FY`,
  }),
  "sales-team": (d, t) => ({
    value: rs(t.sold_paise),
    caption: `sold by the team · ${n(t.bookings)} bookings this FY`,
  }),
  "masked-inventory": (d) => {
    const m = d.kpis?.[0]?.value || 0;
    return m
      ? { value: `${n(m)} units`, caption: "masked from sales · today" }
      : { value: "none", caption: "no units masked from sales · today" };
  },
  "demand-vs-collection": (d, t) => ({
    value: `${t.pct_collected ?? 0}%`,
    caption: `${rs(t.collected_paise)} received of ${rs(t.demand_paise)} billed · till today`,
  }),
  "receivables-forecast": (d, t) => ({
    value: rs(t.expected_paise),
    caption: "still to bill on the plan · till today",
  }),
  "other-charges": (d, t) => ({
    value: rs(t.balance_paise),
    caption: `other charges still due · ${rs(t.collected_paise)} received till today`,
    tone: t.balance_paise ? "brick" : undefined,
  }),
  "collections-v2": (d, t) => ({
    value: rs(t.total_paise),
    caption: "received (cash + account) · this FY",
  }),
  "cash-vs-account": (d, t) => ({
    value: rs(t.cash_balance_paise),
    caption: `cash still due · account ${rs(t.account_balance_paise)} · till today`,
  }),
  cheques: (d) => {
    const p = d.by_status?.Pending,
      b = d.by_status?.Bounced;
    return p?.count
      ? {
          value: `${p.count} pending`,
          caption: `${rs(p.amount_paise)} not yet cleared · ${b?.count || 0} bounced · till today`,
        }
      : { value: "none pending", caption: `every instrument cleared or returned · till today` };
  },
  "bank-receipts": (d, t) => ({
    value: rs(t.total_paise),
    caption: `received into ${d.rows?.length || 0} bank lines · this FY`,
  }),
  "roznamcha-summary": (d, t) => ({
    value: rs(t.closing_paise),
    caption: "cash in hand at day end · today",
  }),
  advances: (d, t) => ({
    value: rs(t.total_advance_paise),
    caption: "advance held (paid ahead of bills) · till today",
    tone: t.total_advance_paise ? "sage" : undefined,
  }),
  "project-statement": (d) => ({
    value: `${n(d._projects)} projects`,
    caption: "pick one for its full statement · today",
  }),
  "outstanding-v2": (d, t) => ({
    value: rs(t.outstanding_paise),
    caption: `${rs(t.overdue_paise)} overdue · till today`,
    tone: t.outstanding_paise ? "brick" : undefined,
  }),
  cancellations: (d, t) =>
    t.refund_paise || t.paid_paise
      ? {
          value: rs(t.refund_paise - t.refund_paid_paise),
          caption: "refund still to pay · this FY",
        }
      : { value: "none", caption: "no cancellations or refunds this FY" },
  "construction-vs-plan": (d, t) => ({
    value: rs(t.expected_paise),
    caption: "expected as the next stages complete · today",
  }),
  "construction-progress": (d, t) => ({
    value: rs(t.demand_paise),
    caption: `billed on completed stages · ${n(t.photos)} site photos · till today`,
  }),
  inventory: (d, t) => ({
    value: `${n(t.booked + t.sold)} of ${n(t.total)}`,
    caption: "units booked or sold · today",
  }),
  "inventory-control": (d, t) => ({
    value: `${n(t.available)} available`,
    caption: `of ${n(t.total)} units · ${n(t.hold)} on hold · today`,
  }),
  "landowner-share": (d, t) =>
    t.landowner
      ? { value: `${n(t.landowner)} units`, caption: `${t.share_pct}% landowner share · today` }
      : { value: "none", caption: "no landowner units · today" },
  "hold-register": (d) => {
    const k = (i) => d.kpis?.[i]?.value || 0;
    return k(0)
      ? { value: `${n(k(0))} on hold`, caption: `${n(k(1))} expiring within 48 h · today` }
      : { value: "none", caption: "no flats on hold · today" };
  },
  "service-sla": (d, t) => ({
    value: `${n(t.open)} open`,
    caption: `of ${n(t.total)} requests · ${t.sla_met_pct ?? 0}% within the promised time · this FY`,
  }),
  activity: (d, t) => ({
    value: n(t.success),
    caption: `actions recorded · ${n(t.failed)} refused by the rules · this FY`,
  }),
  "data-quality": (d, t) =>
    t.count
      ? { value: `${n(t.count)} to review`, caption: "checks need a look · today", tone: "brick" }
      : { value: "all clear", caption: "every data check passes · today" },
};

export function useHeadlines(reports) {
  const [heads, setHeads] = useState({});
  useEffect(() => {
    let live = true;
    const fy = PRESET_DATES.FY();
    const queue = [...reports];
    const work = async () => {
      while (queue.length && live) {
        const r = queue.shift();
        const params = FILTERS[r.key]?.includes("from_date") ? fy : {};
        try {
          const res = await api.get(`/reports/${r.key}`, { params });
          const d = adaptReport(r.key, res.data) || {};
          if (r.key === "project-statement")
            d._projects = (await api.get("/projects", { params: { page_size: 1 } })).data.total;
          let h = HEADLINE[r.key]?.(d, d.totals || {});
          if (!h) {
            const [l, v, , tone] = kpiTuples(r.key, d)[0] || [];
            h = v ? { value: v, caption: l.toLowerCase(), tone } : null;
          }
          if (live) setHeads((x) => ({ ...x, [r.key]: h }));
        } catch {
          if (live) setHeads((h) => ({ ...h, [r.key]: null }));
        }
      }
    };
    Promise.all([work(), work(), work(), work()]);
    return () => {
      live = false;
    };
  }, [reports]);
  return heads;
}

// REQ-275: an old report key opens its report on the new sheet, carrying the period / project it was opened with
function legacyTarget(key, search) {
  const to = LEGACY_REDIRECT[key];
  if (!to) return null;
  const old = new URLSearchParams(search);
  const n = new URLSearchParams();
  if (old.get("from_date")) n.set("period_from", old.get("from_date"));
  if (old.get("to_date")) n.set("period_to", old.get("to_date"));
  if (old.get("project_id")) n.set("project", old.get("project_id"));
  return `/reports/v3/${to}${n.toString() ? `?${n}` : ""}`;
}

export default function Reports() {
  const { key } = useParams();
  const { search } = useLocation();
  const to = legacyTarget(key, search);
  return to ? <Navigate to={to} replace /> : <ReportView />;
}
