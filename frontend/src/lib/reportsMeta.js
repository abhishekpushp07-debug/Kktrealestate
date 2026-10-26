// Reports hub metadata shared by the Reports page and the command palette. Purpose lines come from the backend registry (/reports).
export const REPORT_CODE = {
  "roznamcha-range": "roznamcha", "roznamcha-summary": "roznamcha", "bank-receipts": "bank_wise", cheques: "cheque_register", advances: "outstanding", "outstanding-v2": "outstanding", "collections-v2": "collections",
  "upcoming-dues": "receivables_forecast", "receivables-forecast": "receivables_forecast", cancellations: "cancellations_refunds", "sales-leads": "lead_funnel", "service-sla": "service_sla",
  "construction-progress": "construction_vs_plan", "construction-vs-plan": "construction_vs_plan", activity: "audit", "demand-vs-collection": "demand_vs_collection", "cash-vs-account": "cash_vs_account",
  "other-charges": "other_charges", "site-visits": "site_visit_conversion", "sales-team": "sales_team", "data-quality": "data_quality",
};
export const permFor = (key) => `reports.${REPORT_CODE[key] || key.replace(/-/g, "_")}`;
export const FILTERS = {
  "collections-v2": ["from_date", "to_date", "project_id", "group"], "outstanding-v2": ["project_id", "group"], "cash-vs-account": ["project_id", "group"], "receivables-forecast": ["project_id", "group"], "other-charges": ["project_id", "group"],
  "roznamcha-summary": ["from_date", "to_date", "group"], "site-visits": ["from_date", "to_date", "project_id", "group"], "sales-team": ["from_date", "to_date"], "construction-vs-plan": ["project_id"], "data-quality": [],
  collections: ["from_date", "to_date", "project_id", "mode", "category", "status", "group_by"], outstanding: ["project_id", "group_by_out"], advances: ["project_id"], "demand-vs-collection": ["project_id"], "upcoming-dues": ["project_id"],
  inventory: ["project_id", "group_by_inv"], cheques: ["project_id", "cheque_status"], cancellations: ["from_date", "to_date", "project_id"], "sales-leads": ["from_date", "to_date"], "roznamcha-range": ["from_date", "to_date"], "bank-receipts": ["from_date", "to_date"], activity: ["from_date", "to_date"],
  "service-sla": ["from_date", "to_date", "project_id"], "construction-progress": ["project_id"],
};
export const GROUP_LABEL = { day: "By day", week: "By week", month: "By month", project: "By project", block: "By tower", bucket: "By ledger", mode: "By mode", bank: "By bank account", rm: "By RM", receipt: "Receipts", booking: "By booking", customer: "By customer", charge: "By charge type" };
export const GROUP_ORDER = ["Finance", "Sales", "Construction", "Operations", "Admin"];
