"""REQ-259/274: the one report registry. A report is declared once here; the engine and the React sheet read it.
CATALOGUE = the hub's 5 segments × 10 tiles; a tile with `legacy` opens the existing report until it moves onto the engine."""

from reports_v3 import customers as C
from reports_v3 import customers2 as C2

M = "money"
SEGMENTS = ["Customers", "Finance", "Bookings", "Project & inventory", "Leads"]

LOCATION_FILTERS = [
    {"key": "project", "label": "Project", "kind": "multi", "field": "project_id", "label_field": "project"},
    {
        "key": "tower",
        "label": "Tower",
        "kind": "multi",
        "field": "tower_id",
        "label_field": "tower",
        "parent": "project",
    },
    {
        "key": "floor",
        "label": "Floor",
        "kind": "multi",
        "field": "floor_id",
        "label_field": "floor_label",
        "parent": "tower",
    },
    {"key": "flat", "label": "Flat", "kind": "multi", "field": "flat_id", "label_field": "flat", "parent": "floor"},
]
CUSTOMER_FILTER = {
    "key": "customer",
    "label": "Customer",
    "kind": "multi",
    "field": "customer_id",
    "label_field": "customer_label",
}
LOCATION_GROUPS = [
    {"key": "project", "label": "Project", "field": "project"},
    {"key": "tower", "label": "Tower", "field": "tower"},
    {"key": "floor", "label": "Floor", "field": "floor"},
    {"key": "flat", "label": "Flat", "field": "flat_code"},
    {"key": "customer", "label": "Customer", "field": "customer_name"},
]

REGISTRY = {
    "customer-status": {
        "segment": "Customers",
        "title": "Customer status",
        "one_click": True,
        "purpose": "Every live booking's agreement, bills raised, what came in on each share and what is due — one click.",
        "unit": ("booking", "bookings"),
        "permission": "reports.outstanding.view",
        "export_permission": "reports.outstanding.export",
        "row_link": "/bookings/{booking_id}",
        "headline": "account_dues",
        "tieout": "Σ Account dues + Σ Cash dues = instalment outstanding (Outstanding & ageing, Cash + Account shares)",
        "provider": C.customer_status,
        "formula": C.customer_status_formula,
        "illustration": C.customer_status_illustration,
        "date_mode": "as_of",
        "columns": [
            {"key": "customer_name", "label": "Customer name", "type": "text", "default": True, "width": 18},
            {"key": "flat_code", "label": "Flat code", "type": "code", "default": True, "width": 18},
            {"key": "agreement_value", "label": "Agreement value", "type": M, "default": True, "width": 12},
            {"key": "cash_component", "label": "Cash component", "type": M, "default": True, "width": 12},
            {"key": "bills_raised", "label": "Bills raised till date", "type": M, "default": True, "width": 12},
            {"key": "account_received", "label": "Account received", "type": M, "default": True, "width": 12},
            {"key": "cash_received", "label": "Cash received", "type": M, "default": True, "width": 12},
            {"key": "account_dues", "label": "Account dues", "type": M, "default": True, "width": 12},
            {"key": "cash_dues", "label": "Cash dues", "type": M, "default": True, "width": 12},
            {"key": "final_status", "label": "Final status", "type": "status", "default": True, "width": 14},
            {"key": "account_component", "label": "Account component", "type": M, "width": 12},
            {"key": "waived", "label": "Waived", "type": M, "width": 11},
            {"key": "other_charges_due", "label": "Other charges due", "type": M, "width": 12},
            {"key": "overdue_amount", "label": "Overdue ₹", "type": M, "width": 12},
            {"key": "next_due_date", "label": "Next due date", "type": "date", "width": 11},
            {"key": "phone", "label": "Phone", "type": "code", "width": 13},
            {"key": "sales_person", "label": "Sales person", "type": "text", "width": 13},
            {"key": "plan", "label": "Plan", "type": "text", "width": 12},
            {"key": "stage", "label": "Stage", "type": "text", "width": 8},
            {"key": "booking_number", "label": "Booking no.", "type": "code", "width": 13},
            {"key": "booking_date", "label": "Booking date", "type": "date", "width": 11},
        ],
        "totals": [
            "agreement_value",
            "cash_component",
            "account_component",
            "bills_raised",
            "account_received",
            "cash_received",
            "waived",
            "account_dues",
            "cash_dues",
            "instalment_advance",
            "other_charges_due",
            "total_due",
            "overdue_amount",
        ],
        "filters": [
            *LOCATION_FILTERS,
            CUSTOMER_FILTER,
            {
                "key": "status",
                "label": "Final status",
                "kind": "multi",
                "field": "status_kind",
                "options": [
                    ["overdue", "Overdue"],
                    ["due", "Due (not yet late)"],
                    ["clear", "All clear"],
                    ["advance", "Advance"],
                    ["cancelled", "Cancelled"],
                    ["transferred", "Transferred"],
                ],
            },
            {
                "key": "sales",
                "label": "Sales person",
                "kind": "multi",
                "field": "sales_id",
                "label_field": "sales_person",
            },
            {"key": "plan", "label": "Plan", "kind": "multi", "field": "plan_id", "label_field": "plan"},
            {"key": "booked", "label": "Booking date", "kind": "date_range", "field": "booking_date"},
            {"key": "dues", "label": "Dues", "kind": "range", "type": M, "field": ("account_dues", "cash_dues")},
            {
                "key": "overdue_days",
                "label": "Days overdue ≥",
                "kind": "min",
                "field": "days_overdue",
                "sentence": "overdue {v}+ days",
            },
            {"key": "include_cancelled", "label": "Include cancelled", "kind": "bool", "field": "live"},
        ],
        "groups": LOCATION_GROUPS
        + [
            {"key": "sales", "label": "Sales person", "field": "sales_person"},
            {"key": "status", "label": "Final status", "field": "status_group"},
        ],
    },
}


def _col(key, label, type_="text", default=True, width=12):
    return {"key": key, "label": label, "type": type_, "default": default, "width": width}


def _spec(segment, title, purpose, provider, formula, illus, columns, totals, filters, groups, **kw):
    return {
        "segment": segment,
        "title": title,
        "purpose": purpose,
        "unit": kw.pop("unit", ("booking", "bookings")),
        "permission": kw.pop("permission", "reports.outstanding.view"),
        "export_permission": kw.pop("export_permission", "reports.outstanding.export"),
        "row_link": kw.pop("row_link", "/bookings/{booking_id}"),
        "provider": provider,
        "formula": formula,
        "illustration": illus,
        "date_mode": kw.pop("date_mode", "as_of"),
        "columns": columns,
        "totals": totals,
        "filters": filters,
        "groups": groups,
        **kw,
    }


_CS = REGISTRY["customer-status"]
from reports_v3 import bridges as _BR0  # noqa: E402

_CS["bridge"] = _BR0.customer_status
_F = {f["key"]: f for f in _CS["filters"]}
_G = {g["key"]: g for g in _CS["groups"]}
_NAME, _FLAT = _col("customer_name", "Customer name", width=18), _col("flat_code", "Flat code", "code", width=18)
_PHONE, _SALES = _col("phone", "Phone", "code", width=13), _col("sales_person", "Sales person", default=False, width=13)
_BANDS = [
    ("band_not_due", "Not due"),
    ("band_0_30", "0–30 days"),
    ("band_31_60", "31–60 days"),
    ("band_61_90", "61–90 days"),
    ("band_90p", "90+ days"),
]
_DUE_TOTAL = "total_due"

REGISTRY |= {
    "customer-statement": _spec(
        "Customers",
        "Customer statement",
        "One customer, every booking: bills, receipts, waivers and the running balance, up to any date.",
        C2.statement,
        C2.statement_formula,
        C2.statement_illus,
        [
            _col("date", "Date", "date", width=11),
            _col("flat_code", "Flat code", "code", width=18),
            _col("particulars", "Particulars", width=26),
            _col("ref", "Ref", "code", width=14),
            _col("bill", "Bill raised", "money"),
            _col("received", "Received", "money"),
            _col("waived", "Waived", "money"),
            _col("balance", "Balance", "money"),
            _col("mode", "Mode", default=False, width=10),
            _col("booking_number", "Booking no.", "code", False, 13),
        ],
        ["bill", "received", "waived"],
        [
            {
                "key": "customer",
                "label": "Customer",
                "kind": "multi",
                "field": "customer_id",
                "label_field": "customer_name",
            },
            {"key": "bill", "label": "Bill raised", "kind": "range", "type": M, "field": "bill"},
            {"key": "kind", "label": "Line type", "kind": "multi", "field": "kind"},
            {"key": "period", "label": "Date", "kind": "date_range", "field": "date"},
        ],
        [
            {"key": "flat", "label": "Booking", "field": "flat_code"},
            {"key": "kind", "label": "Line type", "field": "kind"},
        ],
        unit=("line", "lines"),
        derived=C2.statement_derived,
        pushdown=["customer"],
        options_provider=C2.statement_options,
        needs={"filter": "customer", "message": "Pick a customer to see their statement"},
        tieout="Last balance per booking = the booking page balance (ledger running balance)",
    ),
    "customer-ageing": _spec(
        "Customers",
        "Overdue & ageing by customer",
        "Who owes what and for how long — bands, days overdue, last payment.",
        C2.ageing,
        C2.ageing_formula,
        C2.ageing_illus,
        [
            _NAME,
            _FLAT,
            *[_col(k, l, "money") for k, l in _BANDS],
            _col("total_due", "Total due", "money"),
            _col("days_overdue", "Days overdue", "num", width=9),
            _col("last_payment", "Last payment", "date", width=11),
            _PHONE | {"default": False},
            _SALES,
        ],
        [k for k, _ in _BANDS] + ["total_due", "overdue_amount"],
        [
            *LOCATION_FILTERS,
            CUSTOMER_FILTER,
            _F["sales"],
            _F["overdue_days"],
            {"key": "due", "label": "Total due", "kind": "range", "type": M, "field": "total_due"},
            {"key": "only_overdue", "label": "Only overdue", "kind": "only", "field": "overdue_amount"},
        ],
        LOCATION_GROUPS + [_G["sales"]],
        headline="total_due",
        tieout="Σ bands = Outstanding & ageing total (Cash + Account + billed other charges)",
    ),
    "advance-holders": _spec(
        "Customers",
        "Advance holders",
        "Money received beyond the bills raised, held to settle the next bills.",
        C2.advance_holders,
        C2.advance_formula,
        C2.advance_illus,
        [
            _NAME,
            _FLAT,
            _PHONE,
            _col("bills_raised", "Bills raised", "money"),
            _col("received_total", "Received", "money"),
            _col("advance_total", "Advance held", "money"),
            _col("stage", "Stage", width=8),
            _SALES,
        ],
        ["bills_raised", "received_total", "advance_total"],
        [
            *LOCATION_FILTERS,
            CUSTOMER_FILTER,
            _F["sales"],
            {"key": "advance", "label": "Advance", "kind": "range", "type": M, "field": "advance_total"},
        ],
        LOCATION_GROUPS + [_G["sales"]],
        headline="advance_total",
        tieout="Σ advance = Home 'advance held' = Σ booking summary advance",
    ),
    "call-list": _spec(
        "Customers",
        "Collection call list",
        "Due and overdue in a window, oldest first, with phone and follow-ups.",
        C2.call_list,
        C2.call_formula,
        C2.call_illus,
        [
            _NAME,
            _PHONE,
            _FLAT,
            _col("total_due", "Due", "money"),
            _col("overdue_amount", "Overdue ₹", "money"),
            _col("days_overdue", "Days overdue", "num", width=9),
            _col("next_due_date", "Oldest unpaid due", "date", width=11),
            _col("last_payment", "Last payment", "date", width=11),
            _col("last_follow_up", "Last follow-up", "date", False, 11),
            _col("next_follow_up", "Next follow-up", "date", False, 11),
            _col("last_note", "Last note", default=False, width=22),
            _SALES,
        ],
        ["total_due", "overdue_amount"],
        [
            *LOCATION_FILTERS,
            CUSTOMER_FILTER,
            {"key": "due", "label": "Due", "kind": "range", "type": M, "field": "total_due"},
            {"key": "reason", "label": "Why call", "kind": "multi", "field": "call_reason"},
            {"key": "window", "label": "Oldest unpaid due", "kind": "date_range", "field": "next_due_date"},
            _F["overdue_days"],
            _F["sales"],
        ],
        LOCATION_GROUPS + [_G["sales"]],
        default_sort=("days_overdue", True),
        headline="total_due",
        tieout="Σ due = Customer status dues + billed other charges for the same bookings",
    ),
    "kyc-pending": _spec(
        "Customers",
        "KYC, agreement & documents pending",
        "What each booking still owes on paper.",
        C2.paper_pending,
        C2.paper_formula,
        C2.paper_illus,
        [
            _NAME,
            _FLAT,
            _PHONE,
            _col("kyc_status", "KYC", width=10),
            _col("agreement", "Agreement", width=16),
            _col("docs_missing", "Documents missing", width=26),
            _col("days_since_booking", "Days since booking", "num", False, 9),
            _SALES,
        ],
        ["pending_n", "docs_missing_n"],
        [
            *LOCATION_FILTERS,
            CUSTOMER_FILTER,
            {
                "key": "pending",
                "label": "Pending",
                "kind": "multi",
                "field": "pending_what",
                "options": [["kyc", "KYC"], ["agreement", "Agreement"], ["documents", "Documents"]],
            },
            _F["sales"],
            {"key": "show_complete", "label": "Include complete", "kind": "bool", "field": "pending_any"},
        ],
        LOCATION_GROUPS + [_G["sales"]],
        tieout="Agreement pending count = customer cards with 'agreement pending'",
    ),
    "payment-behaviour": _spec(
        "Customers",
        "Payment behaviour",
        "On-time %, average days late, bounced cheques and waivers per customer.",
        C2.behaviour,
        C2.behaviour_formula,
        C2.behaviour_illus,
        [
            _NAME,
            _col("flats", "Flats", "code", width=14),
            _col("bills_due", "Bills due", "num", width=8),
            _col("on_time", "Paid on time", "num", width=8),
            _col("on_time_pct", "On time %", "pct", width=8),
            _col("avg_days_late", "Avg days late", "num", width=8),
            _col("bounces", "Bounced cheques", "num", width=8),
            _col("waivers", "Waivers", "num", width=8),
            _col("behaviour", "Behaviour", "status", width=12),
            _col("received", "Received", "money", False),
            _PHONE | {"default": False},
            _SALES,
        ],
        ["bills_due", "on_time", "late_days", "late_n", "bounces", "waivers", "received"],
        [
            {"key": "project", "label": "Project", "kind": "multi", "field": "project_id", "label_field": "project"},
            CUSTOMER_FILTER,
            {"key": "behaviour", "label": "Behaviour", "kind": "multi", "field": "behaviour"},
            _F["sales"],
            {
                "key": "late",
                "label": "Avg days late ≥",
                "kind": "min",
                "field": "avg_days_late",
                "sentence": "late {v}+ days on average",
            },
            {"key": "received", "label": "Received", "kind": "range", "type": M, "field": "received"},
        ],
        [_G["project"], _G["sales"], {"key": "behaviour", "label": "Behaviour", "field": "behaviour"}],
        unit=("customer", "customers"),
        row_link="/customers/{customer_id}",
        derived=C2.behaviour_derived,
        headline=("on_time_pct", "on time"),
        tieout="Σ bills due = instalment bills due by the as-of day for these bookings",
    ),
    "customer-directory": _spec(
        "Customers",
        "Customer directory",
        "Contacts, co-applicants, city, source and sales person for every customer.",
        C2.directory,
        C2.directory_formula,
        C2.directory_illus,
        [
            _NAME,
            _col("customer_code", "Code", "code", width=14),
            _PHONE,
            _col("email", "Email", width=18),
            _col("co_applicants", "Co-applicants", width=16),
            _col("city", "City", width=10),
            _col("source", "Source", width=10),
            _col("sales_person", "Sales person", width=13),
            _col("flats", "Flats", "code", False, 18),
            _col("kyc_status", "KYC", default=False, width=9),
            _col("stage", "Stage", default=False, width=10),
        ],
        ["bookings"],
        [
            {"key": "project", "label": "Project", "kind": "multi", "field": "project_id", "label_field": "project"},
            CUSTOMER_FILTER,
            {"key": "city", "label": "City", "kind": "multi", "field": "city"},
            {"key": "source", "label": "Source", "kind": "multi", "field": "source"},
            _F["sales"],
            {"key": "kyc", "label": "KYC", "kind": "multi", "field": "kyc_status"},
        ],
        [
            _G["project"],
            {"key": "city", "label": "City", "field": "city"},
            {"key": "source", "label": "Source", "field": "source"},
            _G["sales"],
        ],
        unit=("customer", "customers"),
        row_link="/customers/{customer_id}",
        date_mode=None,
        tieout="Rows = customers in scope (Customers list count)",
    ),
    "cancelled-customers": _spec(
        "Customers",
        "Cancelled & transferred customers",
        "Refunds paid and pending, forfeits, and who moved to which flat.",
        C2.cancelled,
        C2.cancelled_formula,
        C2.cancelled_illus,
        [
            _NAME,
            _FLAT,
            _col("kind", "What happened", "status", width=11),
            _col("event_date", "On", "date", width=11),
            _col("received", "Received", "money"),
            _col("forfeit", "Forfeited", "money"),
            _col("refund_payable", "Refund payable", "money"),
            _col("refund_paid", "Refund paid", "money"),
            _col("refund_pending", "Refund pending", "money"),
            _col("new_flat", "Flat moved", "code", width=14),
            _col("reason", "Reason", default=False, width=24),
            _SALES,
        ],
        ["received", "forfeit", "refund_payable", "refund_paid", "refund_pending"],
        [
            *LOCATION_FILTERS,
            CUSTOMER_FILTER,
            {"key": "kind", "label": "What happened", "kind": "multi", "field": "kind"},
            {"key": "on", "label": "Date", "kind": "date_range", "field": "event_date"},
            _F["sales"],
            {"key": "pending", "label": "Refund pending", "kind": "range", "type": M, "field": "refund_pending"},
        ],
        [_G["project"], _G["tower"], {"key": "kind", "label": "What happened", "field": "kind"}, _G["sales"]],
        unit=("case", "cases"),
        default_sort=("event_date", True),
        permission="reports.cancellations_refunds.view",
        headline="refund_pending",
        export_permission="reports.cancellations_refunds.export",
        tieout="Σ refund payable / paid = Cancellations & refunds report",
    ),
}

# Hub tiles: (key, title, purpose, legacy report key or None, permission)
_O, _C, _S = "reports.outstanding.view", "reports.collections.view", "reports.sales_team.view"
_I, _L = "reports.inventory.view", "reports.lead_funnel.view"
CATALOGUE = {
    "Customers": [
        ("customer-status", "Customer status", "Agreement, bills raised, received and dues per booking", None, _O),
        ("customer-statement", "Customer statement", "One customer, every booking: bills, receipts, waivers", None, _O),
        ("customer-ageing", "Overdue & ageing by customer", "Bands, days overdue, last payment", "outstanding-v2", _O),
        ("advance-holders", "Advance holders", "Money received beyond the bills raised", "advances", _O),
        ("call-list", "Collection call list", "Due and overdue in a window, with phone and follow-ups", None, _O),
        ("kyc-pending", "KYC, agreement & documents pending", "What each customer still owes on paper", None, _O),
        ("payment-behaviour", "Payment behaviour", "On-time %, average days late, bounces, waivers", None, _O),
        ("customer-directory", "Customer directory", "Contacts, co-applicants, city, source, sales person", None, _O),
        (
            "service-sla",
            "Service requests & SLA",
            "Requests by status and time to close",
            "service-sla",
            "reports.service_sla.view",
        ),
        (
            "cancelled-customers",
            "Cancelled & transferred customers",
            "Refunds paid / pending, forfeits, new flat",
            "cancellations",
            "reports.cancellations_refunds.view",
        ),
    ],
    "Finance": [
        ("collections", "Collections", "Cash / Account / Other by period, mode and bank", "collections-v2", _C),
        (
            "day-book",
            "Day book — Roznamcha",
            "Opening + in − out = closing",
            "roznamcha-summary",
            "reports.roznamcha.view",
        ),
        (
            "bank-receipts",
            "Bank-wise receipts",
            "Receipts per bank, cleared vs pending",
            "bank-receipts",
            "reports.bank_wise.view",
        ),
        ("cheques", "Cheque register", "In hand / cleared / bounced", "cheques", "reports.cheque_register.view"),
        (
            "bills-vs-collection",
            "Bills vs Collection",
            "Billed − received − waived, recovery %",
            "demand-vs-collection",
            "reports.demand_vs_collection.view",
        ),
        ("outstanding", "Outstanding & ageing", "Bill raised − received with ageing bands", "outstanding-v2", _O),
        (
            "cash-vs-account",
            "Cash vs Account split",
            "Agreed vs raised vs received per share",
            "cash-vs-account",
            "reports.cash_vs_account.view",
        ),
        (
            "other-charges",
            "Other charges & GST",
            "By head: demanded, received, waived, due",
            "other-charges",
            "reports.other_charges.view",
        ),
        (
            "receivables-forecast",
            "Receivables forecast",
            "Bills still to be raised, next 30 / 60 / 90 days",
            "receivables-forecast",
            "reports.receivables_forecast.view",
        ),
        (
            "waivers",
            "Waivers & credit notes",
            "States, GST credit, credit notes",
            "waiver-register",
            "reports.waiver_register.view",
        ),
    ],
    "Bookings": [
        ("booking-register", "Booking register", "Every booking with plan, agreement and status", None, _S),
        ("sales-summary", "Sales summary", "Bookings, value, area, average rate by period", None, _S),
        (
            "discount-register",
            "Discount register",
            "Discount given per booking with reasons",
            "discount-register",
            "reports.discount_register.view",
        ),
        ("plan-position", "Plan & stage position", "Stage k of n, % billed, % received", None, _O),
        ("agreements", "Agreements pending / signed", "Days since booking", None, _S),
        (
            "cancellations",
            "Cancellations & refunds",
            "Deductions, refund payable / paid",
            "cancellations",
            "reports.cancellations_refunds.view",
        ),
        ("transfers", "Transfers, revisions & plan changes", "Every change to a booking after it was made", None, _S),
        ("sales-team", "Sales team performance", "Bookings and value per sales person", "sales-team", _S),
        ("realised-rate", "Realised rate", "Agreed vs list per sq ft", None, _S),
        ("booking-health", "Booking health", "Age, % collected vs % billed, overdue", None, _O),
    ],
    "Project & inventory": [
        (
            "project-statement",
            "Project statement",
            "One project's money and stock in one page",
            "project-statement",
            "reports.project_statement.view",
        ),
        (
            "inventory-status",
            "Inventory status",
            "Available / Hold / Booked / Sold",
            "inventory-control",
            "reports.inventory_control.view",
        ),
        ("stacking-plan", "Stacking plan", "Floors × flats coloured by status", None, _I),
        ("price-list", "Price list & unsold stock value", "What is left to sell and what it is worth", None, _I),
        ("hold-register", "Hold register", "Flats on hold and when they lapse", "hold-register", _I),
        ("landowner", "Landowner & masked units", "Landowner share and masked units", "landowner-share", _I),
        ("parking", "Parking inventory", "Slots by type: available / allotted", None, _I),
        (
            "construction-vs-plan",
            "Construction vs plan",
            "Stage dates planned vs done",
            "construction-vs-plan",
            "reports.construction_vs_plan.view",
        ),
        ("stage-bills", "Stage bills by tower", "Stage done, bills raised, received", None, _O),
        ("sales-velocity", "Sales velocity", "Units per month, months of stock left", None, _I),
    ],
    "Leads": [
        ("lead-funnel", "Lead funnel", "Enquiry → visit → booking", "sales-leads", _L),
        ("lead-register", "Lead register", "Every lead with source, status and owner", None, _L),
        (
            "source-performance",
            "Source performance",
            "Leads, visits, bookings and conversion by source",
            "sales-leads",
            _L,
        ),
        ("follow-ups", "Follow-ups due & missed", "Who to call and who was missed", None, _L),
        (
            "visit-register",
            "Site visit register",
            "Scheduled / done / no-show",
            "site-visits",
            "reports.site_visit_conversion.view",
        ),
        (
            "visit-conversion",
            "Site visit conversion",
            "By outcome, project, sales person",
            "site-visits",
            "reports.site_visit_conversion.view",
        ),
        ("lost-leads", "Lost leads & reasons", "Why leads were lost", None, _L),
        ("response-time", "Response time", "First response distribution", None, _L),
        ("team-pipeline", "Team pipeline", "Open leads, follow-ups, visits per sales person", None, _L),
        ("lead-ageing", "Lead ageing", "Days since enquiry / last action", None, _L),
    ],
}
CONTROL_ROOM = [
    ("activity", "Activity log", "Who changed what, when", "activity", "reports.audit.view"),
    ("data-quality", "Data quality", "Missing or inconsistent records", "data-quality", "reports.data_quality.view"),
]
# REQ-275: old report keys → their v3 key (filled as each report moves onto the engine)
REDIRECTS: dict[str, str] = {}


# ---------- F3: Finance — the existing reports, now providers behind the registry (REQ-275) ----------
from reports_v3 import bridges as BR  # noqa: E402
from reports_v3 import finance as FN  # noqa: E402
from reports_v3 import legacy as LG  # noqa: E402

_LF = [*LOCATION_FILTERS, CUSTOMER_FILTER, _F["sales"]]


def _rng(key, label, field):
    return {"key": key, "label": label, "kind": "range", "type": M, "field": field}


def _multi(key, label, field, options=None):
    return {"key": key, "label": label, "kind": "multi", "field": field} | ({"options": options} if options else {})


_LG = [_G["project"], _G["tower"], _G["customer"], _G["sales"]]
_PERIOD = {"key": "period", "label": "Period", "kind": "date_range", "field": None, "pushdown": True}


def _pct(num, den):
    return lambda t, rows=None: {num[0]: round(100 * t.get(num[1], 0) / t[den], 1) if t.get(den) else None}


def _many(*fns):
    return lambda t, rows=None: {k: v for f in fns for k, v in f(t, rows).items()}


def _roz(t, rows):
    days = sorted(rows, key=lambda r: r.get("date") or "")
    return {"opening_paise": days[0]["opening_paise"], "closing_paise": days[-1]["closing_paise"]} if days else {}


def _legacy(
    title,
    purpose,
    path,
    cols,
    totals,
    *,
    perm,
    fixed=None,
    period=False,
    hide=(),
    filters=None,
    groups=None,
    link="{_legacy_link}",
    unit=("row", "rows"),
    push=(),
    enrich=None,
    **kw,
):
    return _spec(
        kw.pop("segment", "Finance"),
        title,
        purpose,
        kw.pop("provider", None) or LG.provider(path, fixed, period, push, enrich),
        kw.pop("formula", lambda t: None),
        kw.pop("illus", lambda rows, t: None),
        LG.columns(cols, hide),
        totals,
        ([_PERIOD] if period else []) + (filters if filters is not None else _LF),
        groups if groups is not None else _LG,
        unit=unit,
        permission=perm,
        export_permission=perm.replace(".view", ".export"),
        row_link=link,
        date_mode=kw.pop("date_mode", None),
        pushdown=["period_from", "period_to"] if period else [],
        default_period="this_fy" if period else None,
        legacy=path.split("?")[0],
        **kw,
    )


def _money_split(title, parts):
    return lambda rows, t: {
        "type": "split_bar",
        "title": title,
        "parts": [{"label": l, "value": t.get(k, 0) or 0, "tone": tone} for k, l, tone in parts],
    }


def _f(text):
    """Formula in words from totals: text uses {key} for ₹ figures."""
    import re

    from services.pdf import inr

    def money(v):
        v = round(v or 0)
        return f"−{inr(-v)}" if v < 0 else inr(v)

    return lambda t: re.sub(r"\{(\w+)\}", lambda m: money(t.get(m.group(1))), text)


REGISTRY |= {
    "collections": _legacy(
        "Collections",
        "Every receipt in the period — Cash, Account and Other — with reversals.",
        "collections-v2",
        [
            ("date", "Date", "date", 11),
            ("group", "Receipt", "str", 14),
            ("customer_name", "Customer name", "str", 18),
            ("booking_number", "Booking no.", "str", 13),
            ("tag", "Mode", "str", 10),
            ("cash_paise", "Cash", "money"),
            ("account_paise", "Account", "money"),
            ("other_paise", "Other", "money"),
            ("reversal_paise", "Reversed", "money"),
            ("total_paise", "Total", "money"),
        ],
        ["count", "cash_paise", "account_paise", "other_paise", "reversal_paise", "total_paise"],
        perm="reports.collections.view",
        fixed={"group_by": "receipt"},
        period=True,
        push=(("basis", "date_basis"),),
        enrich=FN.collections,
        filters=[
            {
                "key": "basis",
                "label": "Date basis",
                "kind": "choice",
                "pushdown": True,
                "options": [["receipt", "Receipt date"], ["clearance", "Clearance date"]],
            },
            _multi("mode", "Mode", "mode"),
            _multi("bank", "Bank", "bank"),
            _multi("share", "Share", "shares", [["cash", "Cash"], ["account", "Account"], ["other", "Other"]]),
            _rng("amount", "Amount", "total_paise"),
            {"key": "no_reversals", "label": "Exclude reversals", "kind": "only", "field": "is_regular"},
            *_LF,
        ],
        groups=_LG
        + [{"key": "mode", "label": "Mode", "field": "mode"}, {"key": "bank", "label": "Bank", "field": "bank"}],
        unit=("receipt", "receipts"),
        default_sort=("date", True, "group"),
        headline="total_paise",
        formula=_f(
            "Cash {cash_paise} + Account {account_paise} + Other {other_paise} = collected {total_paise} (already net of reversals {reversal_paise})"
        ),
        illus=_money_split(
            "What came in",
            [
                ("account_paise", "Account", "sapphire"),
                ("cash_paise", "Cash", "graphite"),
                ("other_paise", "Other", "steel"),
            ],
        ),
        tieout="Σ = Collections (Received) report total for the same period, every grouping",
    ),
    "day-book": _legacy(
        "Day book — Roznamcha",
        "Cash book by day: opening + in − out = closing.",
        "roznamcha-summary",
        [
            ("date", "Date", "date", 11),
            ("opening_paise", "Opening", "money"),
            ("receipts", "Receipts", "num", 8),
            ("cash_in_paise", "Cash in", "money"),
            ("bank_in_paise", "Bank in", "money"),
            ("deposit_paise", "Deposited", "money"),
            ("withdrawal_paise", "Withdrawn", "money"),
            ("cash_refund_paise", "Cash refunds", "money"),
            ("closing_paise", "Closing", "money"),
        ],
        ["receipts", "cash_in_paise", "bank_in_paise", "deposit_paise", "withdrawal_paise", "cash_refund_paise"],
        perm="reports.roznamcha.view",
        fixed={"group_by": "day"},
        period=True,
        enrich=FN.day_book,
        filters=[
            _multi("book", "Book", "books", [["cash", "Cash"], ["bank", "Bank"]]),
            _rng("cash_in", "Cash in", "cash_in_paise"),
        ],
        groups=[],
        link="/roznamcha?date={date}",
        unit=("day", "days"),
        default_sort=("date", True),
        derived=_roz,
        headline="cash_in_paise",
        formula=_f(
            (
                "Opening {opening_paise} + cash in {cash_in_paise} + withdrawn {withdrawal_paise} − deposited {deposit_paise} "
                "− cash refunds {cash_refund_paise} = closing {closing_paise}"
            )
        ),
        illus=_money_split(
            "Cash movement",
            [
                ("cash_in_paise", "Cash in", "sapphire"),
                ("deposit_paise", "Deposited", "graphite"),
                ("cash_refund_paise", "Cash refunds", "coral"),
            ],
        ),
        tieout="Closing = next day's opening; Σ cash in = Roznamcha range",
    ),
    "bank-receipts": _legacy(
        "Bank-wise receipts",
        "Receipts per bank and mode, cleared vs pending.",
        "bank-receipts",
        [
            ("bank", "Bank", "str", 18),
            ("mode", "Mode", "str", 10),
            ("count", "Receipts", "num", 8),
            ("cleared_paise", "Cleared", "money"),
            ("pending_paise", "Pending", "money"),
            ("total_paise", "Total", "money"),
        ],
        ["count", "cleared_paise", "pending_paise", "total_paise"],
        perm="reports.bank_wise.view",
        period=True,
        filters=[_multi("bank", "Bank", "bank"), _multi("mode", "Mode", "mode"), _rng("total", "Total", "total_paise")],
        groups=[{"key": "bank", "label": "Bank", "field": "bank"}, {"key": "mode", "label": "Mode", "field": "mode"}],
        link=None,
        unit=("bank · mode", "bank · modes"),
        headline="total_paise",
        formula=lambda t: (
            _f("Cleared {cleared_paise} + pending {pending_paise} = {total_paise}")(t)
            + (
                (
                    f" · total {_f('{total_paise}')(t)} − pending (not cleared yet) {_f('{pending_paise}')(t)} + cash receipts "
                    f"{_f('{br_cash}')(t)} ({t['br_cash_n']:,})"
                )
                + (f" − reversals {_f('{x}')({'x': -t['br_reversal']})}" if t["br_reversal"] else "")
                + (f" ± other {_f('{br_rest}')(t)}" if t["br_rest"] else "")
                + f" = Collections {_f('{br_collections}')(t)} ({t['br_collections_n']:,} receipts)"
                if "br_collections" in t
                else ""
            )
        ),
        bridge=BR.bank,
        illus=_money_split(
            "Cleared vs pending", [("cleared_paise", "Cleared", "sapphire"), ("pending_paise", "Pending", "steel")]
        ),
        tieout="Σ = Collections non-cash receipts for the period",
    ),
    "cheques": _legacy(
        "Cheque register",
        "Every cheque: in hand, cleared or bounced.",
        "cheques",
        [
            ("receipt_number", "Receipt", "str", 14),
            ("customer_name", "Customer name", "str", 18),
            ("booking_number", "Booking no.", "str", 13),
            ("instrument_number", "Cheque no.", "str", 11),
            ("instrument_date", "Cheque date", "date", 11),
            ("received_on", "Received", "date", 11),
            ("bank", "Bank", "str", 14),
            ("amount_paise", "Amount", "money"),
            ("status", "Status", "str", 10),
            ("days_in_hand", "Days in hand", "num", 8),
            ("cleared_on", "Cleared on", "date", 11),
        ],
        ["amount_paise"],
        perm="reports.cheque_register.view",
        enrich=FN.cheques,
        hide=("cleared_on",),
        filters=[
            _multi("status", "State", "status"),
            _multi("bank", "Bank", "bank"),
            {"key": "cheque_date", "label": "Cheque date", "kind": "date_range", "field": "instrument_date"},
            {"key": "received", "label": "Received", "kind": "date_range", "field": "received_on"},
            {
                "key": "in_hand",
                "label": "Days in hand ≥",
                "kind": "min",
                "field": "days_in_hand",
                "sentence": "in hand {v}+ days",
            },
            _rng("amount", "Amount", "amount_paise"),
            *_LF,
        ],
        groups=_LG
        + [{"key": "status", "label": "Status", "field": "status"}, {"key": "bank", "label": "Bank", "field": "bank"}],
        link="/bookings/{booking_id}",
        unit=("cheque", "cheques"),
        default_sort=("instrument_date", True, "receipt_number"),
        headline="amount_paise",
        formula=_f("Cheques {amount_paise}"),
        tieout="Σ = cheque receipts in Collections",
    ),
    "bills-vs-collection": _legacy(
        "Bills vs Collection",
        "Per tower and stage: bill raised, received, recovery %.",
        "demand-vs-collection",
        [
            ("block", "Tower", "str", 14),
            ("milestone", "Stage", "str", 18),
            ("percent", "Plan %", "pct", 7),
            ("count", "Bills", "num", 7),
            ("cash_demand_paise", "Cash billed", "money"),
            ("account_demand_paise", "Account billed", "money"),
            ("demand_paise", "Bill raised", "money"),
            ("collected_paise", "Received", "money"),
            ("pct_collected", "Recovery %", "pct", 8),
        ],
        ["count", "cash_demand_paise", "account_demand_paise", "demand_paise", "collected_paise"],
        perm="reports.demand_vs_collection.view",
        filters=[
            _multi("block", "Tower", "block"),
            _multi("stage", "Stage", "milestone"),
            _rng("billed", "Bill raised", "demand_paise"),
        ],
        groups=[
            {"key": "block", "label": "Tower", "field": "block"},
            {"key": "milestone", "label": "Stage", "field": "milestone"},
        ],
        link=None,
        unit=("stage", "stages"),
        derived=_pct(("pct_collected", "collected_paise"), "demand_paise"),
        headline="demand_paise",
        formula=lambda t: (
            _f(
                "Bill raised {demand_paise} (Cash {cash_demand_paise} + Account {account_demand_paise}) · received {collected_paise}"
            )(t)
            + (
                (
                    f" · bill raised {_f('{br_instalment}')(t)} − on cancelled / transferred bookings {_f('{br_not_live}')(t)} "
                    f"{'−' if t['br_adjust'] < 0 else '+'} transfer adjustments {_f('{x}')({'x': abs(t['br_adjust'])})} = live "
                    f"bookings {_f('{br_live}')(t)}, as in Customer status"
                )
                if "br_live" in t
                else ""
            )
        ),
        bridge=BR.bills,
        illus=_money_split(
            "Received against bills",
            [("collected_paise", "Received", "sapphire"), ("demand_paise", "Bill raised", "graphite")],
        ),
        tieout="Σ bill raised = Σ instalment bills (Bills register)",
    ),
    "outstanding": _legacy(
        "Outstanding & ageing",
        "Bill raised − received − waived per booking, with ageing bands.",
        "outstanding-v2",
        [
            ("customer_name", "Customer name", "str", 18),
            ("unit", "Flat", "str", 14),
            ("udhar_paise", "Bill raised", "money"),
            ("jama_paise", "Received", "money"),
            ("waived_paise", "Waived", "money"),
            ("outstanding_paise", "Outstanding", "money"),
            ("advance_paise", "Advance", "money"),
            ("band_Not due", "Not due", "money"),
            ("band_0-30", "0–30 days", "money"),
            ("band_31-60", "31–60 days", "money"),
            ("band_61-90", "61–90 days", "money"),
            ("band_90+", "90+ days", "money"),
            ("overdue_paise", "Overdue", "money"),
            ("promise", "Promise", "str", 12),
            ("net_balance_paise", "Net balance", "money"),
        ],
        [
            "udhar_paise",
            "jama_paise",
            "waived_paise",
            "outstanding_paise",
            "advance_paise",
            "band_Not due",
            "band_0-30",
            "band_31-60",
            "band_61-90",
            "band_90+",
            "overdue_paise",
            "net_balance_paise",
        ],
        perm="reports.outstanding.view",
        fixed={"group_by": "booking"},
        provider=FN.outstanding_asof,
        date_mode="as_of",
        filters=[
            *_LF,
            _multi(
                "band",
                "Ageing band",
                "bands",
                [
                    ["Not due", "Not due"],
                    ["0-30", "0–30 days"],
                    ["31-60", "31–60 days"],
                    ["61-90", "61–90 days"],
                    ["90+", "90+ days"],
                ],
            ),
            {
                "key": "overdue_days",
                "label": "Days overdue ≥",
                "kind": "min",
                "field": "days_overdue",
                "sentence": "overdue {v}+ days",
            },
            _rng("outstanding", "Outstanding", "outstanding_paise"),
            {"key": "only_overdue", "label": "Only overdue", "kind": "only", "field": "is_overdue"},
        ],
        hide=("band_Not due", "promise", "net_balance_paise", "advance_paise"),
        link="/bookings/{booking_id}",
        unit=("booking", "bookings"),
        headline="outstanding_paise",
        formula=_f(
            "Bill raised {udhar_paise} − received {jama_paise} − waived {waived_paise} + advance {advance_paise} = outstanding {outstanding_paise}"
        ),
        illus=_money_split(
            "How old the outstanding is",
            [
                ("band_Not due", "Not due", "muted"),
                ("band_0-30", "0–30", "sapphire"),
                ("band_31-60", "31–60", "graphite"),
                ("band_61-90", "61–90", "coral-soft"),
                ("band_90+", "90+", "coral"),
            ],
        ),
        tieout="Σ outstanding = Overdue & ageing by customer total due = Home receivable",
    ),
    "cash-vs-account": _legacy(
        "Cash vs Account split",
        "Agreed, raised, received and balance on each share.",
        "cash-vs-account",
        [
            ("customer_name", "Customer name", "str", 18),
            ("group", "Booking", "str", 14),
            ("cash_agreed_paise", "Cash agreed", "money"),
            ("cash_raised_paise", "Cash raised", "money"),
            ("cash_received_paise", "Cash received", "money"),
            ("cash_balance_paise", "Cash balance", "money"),
            ("account_agreed_paise", "Account agreed", "money"),
            ("account_raised_paise", "Account raised", "money"),
            ("account_received_paise", "Account received", "money"),
            ("account_balance_paise", "Account balance", "money"),
            ("cash_share_agreed_pct", "Cash % agreed", "pct", 8),
            ("cash_share_raised_pct", "Cash % raised", "pct", 8),
            ("variance", "Variance", "str", 10),
        ],
        [
            "cash_agreed_paise",
            "cash_raised_paise",
            "cash_received_paise",
            "cash_balance_paise",
            "account_agreed_paise",
            "account_raised_paise",
            "account_received_paise",
            "account_balance_paise",
        ],
        perm="reports.cash_vs_account.view",
        fixed={"group_by": "booking"},
        filters=[
            *_LF,
            _multi("variance", "Variance", "variance"),
            _rng("cash_balance", "Cash balance", "cash_balance_paise"),
            _rng("account_balance", "Account balance", "account_balance_paise"),
        ],
        hide=("cash_share_raised_pct", "variance"),
        link="/bookings/{booking_id}",
        unit=("booking", "bookings"),
        derived=lambda t, rows=None: {
            "cash_share_agreed_pct": round(
                100 * t["cash_agreed_paise"] / (t["cash_agreed_paise"] + t["account_agreed_paise"]), 1
            )
            if t.get("cash_agreed_paise", 0) + t.get("account_agreed_paise", 0)
            else None,
            "cash_share_raised_pct": round(
                100 * t["cash_raised_paise"] / (t["cash_raised_paise"] + t["account_raised_paise"]), 1
            )
            if t.get("cash_raised_paise", 0) + t.get("account_raised_paise", 0)
            else None,
        },
        headline="cash_balance_paise",
        formula=_f(
            (
                "Cash raised {cash_raised_paise} − received {cash_received_paise} = {cash_balance_paise} · Account raised "
                "{account_raised_paise} − received {account_received_paise} = {account_balance_paise}"
            )
        ),
        illus=_money_split(
            "Received on each share",
            [
                ("account_received_paise", "Account received", "sapphire"),
                ("cash_received_paise", "Cash received", "graphite"),
                ("account_balance_paise", "Account balance", "coral"),
                ("cash_balance_paise", "Cash balance", "coral-soft"),
            ],
        ),
        tieout="Cash + Account received = Customer status received columns",
    ),
    "other-charges": _legacy(
        "Other charges & GST",
        "Every other-charge line: agreed, billed, received, due.",
        "other-charges",
        [
            ("customer_name", "Customer name", "str", 18),
            ("group", "Booking", "str", 14),
            ("lines", "Lines", "num", 6),
            ("agreed_paise", "Agreed", "money"),
            ("demanded_paise", "Billed", "money"),
            ("collected_paise", "Received", "money"),
            ("balance_paise", "Balance", "money"),
            ("pct_collected", "Received %", "pct", 8),
        ],
        ["lines", "agreed_paise", "demanded_paise", "collected_paise", "balance_paise"],
        perm="reports.other_charges.view",
        fixed={"group_by": "booking"},
        enrich=FN.other_charges,
        filters=[*_LF, _multi("head", "Charge head", "heads"), _rng("balance", "Balance", "balance_paise")],
        link="/bookings/{booking_id}",
        unit=("booking", "bookings"),
        derived=_pct(("pct_collected", "collected_paise"), "demanded_paise"),
        headline="balance_paise",
        formula=_f(
            "Agreed {agreed_paise} · billed {demanded_paise} − received {collected_paise} · balance {balance_paise}"
        ),
        illus=_money_split(
            "Other charges", [("collected_paise", "Received", "sapphire"), ("balance_paise", "Balance", "coral")]
        ),
        tieout="Σ balance = other charges due in Customer status bridge line (billed part)",
    ),
    "receivables-forecast": _legacy(
        "Receivables forecast",
        "Bills still to be raised and when they are expected.",
        "receivables-forecast",
        [
            ("expected_on", "Expected on", "date", 11),
            ("customer_name", "Customer name", "str", 18),
            ("booking_number", "Booking no.", "str", 13),
            ("group", "Stage", "str", 16),
            ("basis", "Basis", "str", 12),
            ("cash_paise", "Cash", "money"),
            ("account_paise", "Account", "money"),
            ("expected_paise", "Expected", "money"),
        ],
        ["cash_paise", "account_paise", "expected_paise"],
        perm="reports.receivables_forecast.view",
        fixed={"group_by": "booking"},
        filters=[
            {"key": "when", "label": "Expected on", "kind": "date_range", "field": "expected_on"},
            _multi("stage", "Stage", "stage"),
            _multi("basis", "Basis", "basis"),
            _rng("expected", "Expected", "expected_paise"),
            *_LF,
        ],
        link="/bookings/{booking_id}",
        unit=("bill to come", "bills to come"),
        default_sort=("expected_on", False),
        headline="expected_paise",
        formula=_f("Cash {cash_paise} + Account {account_paise} = expected {expected_paise}"),
        illus=_money_split(
            "Still to be billed", [("account_paise", "Account", "sapphire"), ("cash_paise", "Cash", "graphite")]
        ),
        tieout="Σ expected = Σ agreement − Σ bills raised (unbilled plan)",
    ),
    "waivers": _legacy(
        "Waivers & credit notes",
        "Every waiver, its state, GST credit and credit note.",
        "waiver-register",
        [
            ("waiver_number", "Waiver no.", "str", 13),
            ("requested_on", "Requested", "date", 11),
            ("booking_number", "Booking no.", "str", 13),
            ("customer", "Customer name", "str", 18),
            ("against", "Against", "str", 16),
            ("amount_paise", "Amount", "money"),
            ("gst_paise", "GST credit", "money"),
            ("status", "Status", "str", 10),
            ("cn_number", "Credit note", "str", 13),
            ("reason", "Reason", "str", 20),
            ("by", "Asked by", "str", 12),
            ("decided_by", "Decided by", "str", 12),
        ],
        ["amount_paise", "gst_paise"],
        perm="reports.waiver_register.view",
        period=True,
        hide=("reason", "by", "decided_by"),
        filters=[
            _multi("status", "State", "status"),
            _multi("share", "Against", "against"),
            _rng("amount", "Amount", "amount_paise"),
            *_LF,
        ],
        groups=_LG + [{"key": "status", "label": "Status", "field": "status"}],
        link="/bookings/{booking_id}",
        unit=("waiver", "waivers"),
        default_sort=("requested_on", True),
        derived=lambda t, rows: {
            "approved_paise": sum(
                r.get("amount_paise") or 0 for r in rows if str(r.get("status") or "").startswith("Approved")
            ),
            "gst_paise": sum(
                r.get("gst_paise") or 0 for r in rows if str(r.get("status") or "").startswith("Approved")
            ),
        },
        headline="amount_paise",
        formula=_f(
            "Asked {amount_paise} · approved {approved_paise} (incl. GST credit, self-approved too) · GST credit on approved {gst_paise}"
        ),
        tieout="Σ approved = booking summaries' waived",
    ),
}
REDIRECTS |= {
    "collections-v2": "collections",
    "roznamcha-summary": "day-book",
    "bank-receipts": "bank-receipts",
    "cheques": "cheques",
    "demand-vs-collection": "bills-vs-collection",
    "outstanding-v2": "outstanding",
    "cash-vs-account": "cash-vs-account",
    "other-charges": "other-charges",
    "receivables-forecast": "receivables-forecast",
    "waiver-register": "waivers",
}


# ---------- Phase 3F F4: Bookings ----------
from reports_v3 import bookings as BK  # noqa: E402

_BKF = [*LOCATION_FILTERS, CUSTOMER_FILTER, _F["sales"]]
_FT = _multi("flat_type", "Flat type", "flat_type")
_BOOKED_FY = {"key": "period", "label": "Booked", "kind": "date_range", "field": "booking_date"}
_BG = [
    *LOCATION_GROUPS,
    _G["sales"],
    {"key": "flat_type", "label": "Flat type", "field": "flat_type"},
    {"key": "plan", "label": "Plan", "field": "plan"},
]
_BOOKING_NO = _col("booking_number", "Booking no.", "code", width=13)
_BOOKED = _col("booking_date", "Booked", "date", width=11)


def _bk(title, purpose, provider, formula, illus, cols, totals, filters, groups=_BG, **kw):
    return _spec(
        "Bookings",
        title,
        purpose,
        provider,
        formula,
        illus,
        cols,
        totals,
        filters,
        groups,
        permission=kw.pop("permission", "reports.sales_team.view"),
        export_permission=kw.pop("export_permission", "reports.sales_team.export"),
        date_mode=kw.pop("date_mode", "as_of"),
        **kw,
    )


REGISTRY |= {
    "booking-register": _bk(
        "Booking register",
        "Every booking with its flat, plan, agreement value, discount, agreement state and status.",
        BK.register,
        BK.register_formula,
        BK.register_illus,
        [
            _BOOKED,
            _BOOKING_NO,
            _NAME,
            _FLAT,
            _col("flat_type", "Flat type", width=10),
            _col("area", "Area sq ft", "num", width=9),
            _col("plan", "Plan", width=14),
            _col("list_value", "List value", "money", False),
            _col("discount", "Discount", "money"),
            _col("agreement_value", "Agreement value", "money"),
            _col("agreement_state", "Agreement", "status", width=10),
            _col("booking_status", "Status", "status", width=10),
            _SALES,
            _col("broker", "Broker", default=False, width=12),
        ],
        ["agreement_value", "list_value", "discount", "area"],
        [
            *_BKF,
            _F["plan"],
            _FT,
            _multi("booking_status", "Status", "booking_status"),
            _multi("agreement", "Agreement", "agreement_state"),
            _multi("broker", "Broker", "broker"),
            _BOOKED_FY,
            _rng("value", "Agreement value", "agreement_value"),
        ],
        _BG + [{"key": "booking_status", "label": "Status", "field": "booking_status"}],
        default_sort=("booking_date", True, "booking_number"),
        headline="agreement_value",
        tieout="Σ agreement value (Active + Completed) = bookings collection",
    ),
    "sales-summary": _bk(
        "Sales summary",
        "Bookings, agreement value, area and average rate per sq ft by month, project and flat type.",
        BK.sales_summary,
        BK.sales_formula,
        BK.sales_illus,
        [
            _col("month_label", "Month", width=10),
            _col("project", "Project", width=8),
            _col("flat_type", "Flat type", width=10),
            _col("bookings", "Bookings", "num", width=8),
            _col("area", "Area sq ft", "num", width=10),
            _col("list_value", "List value", "money", False),
            _col("discount", "Discount", "money"),
            _col("agreement_value", "Agreement value", "money"),
            _col("avg_rate", "Avg ₹/sq ft", "money"),
        ],
        ["bookings", "area", "list_value", "discount", "agreement_value"],
        [
            {"key": "project", "label": "Project", "kind": "multi", "field": "project_id", "label_field": "project"},
            _FT,
            {"key": "period", "label": "Booked", "kind": "date_range", "field": "month_start"},
            _rng("value", "Agreement value", "agreement_value"),
        ],
        [
            {"key": "month", "label": "Month", "field": "month_label"},
            _G["project"],
            {"key": "flat_type", "label": "Flat type", "field": "flat_type"},
        ],
        unit=("line", "lines"),
        row_link=None,
        derived=BK.rate_totals,
        default_period="this_fy",
        default_sort=("month_start", True, "project"),
        headline="agreement_value",
        tieout="Σ bookings / value = booking register (not cancelled) for the same period",
    ),
    "discount-register": _legacy(
        "Discount register",
        "List price − agreed price = discount, per booking, with the reason and who gave it.",
        "discount-register",
        [
            ("date", "Booked", "date", 11),
            ("booking_number", "Booking no.", "str", 13),
            ("customer", "Customer name", "str", 18),
            ("unit", "Flat", "str", 16),
            ("sales_person", "Sales person", "str", 14),
            ("list_paise", "List price", "money"),
            ("agreed_paise", "Agreed price", "money"),
            ("discount_paise", "Discount", "money"),
            ("pct", "Discount %", "pct", 8),
            ("reason", "Reason", "str", 24),
        ],
        ["list_paise", "agreed_paise", "discount_paise"],
        perm="reports.discount_register.view",
        segment="Bookings",
        fixed={"group_by": "booking"},
        period=True,
        filters=[
            *_LF,
            {"key": "given", "label": "Only with a discount", "kind": "only", "field": "discount_paise"},
            {"key": "pct", "label": "Discount % ≥", "kind": "min", "field": "pct", "sentence": "discount {v}%+"},
            _rng("discount", "Discount", "discount_paise"),
        ],
        link="/bookings/{booking_id}",
        unit=("booking", "bookings"),
        default_sort=("date", True, "booking_number"),
        derived=lambda t, rows: {
            "pct": round(100 * t["discount_paise"] / t["list_paise"], 2) if t.get("list_paise") else 0
        },
        headline="discount_paise",
        formula=_f("List price {list_paise} − agreed price {agreed_paise} = discount {discount_paise}"),
        illus=_money_split(
            "List price split", [("agreed_paise", "Agreed", "sapphire"), ("discount_paise", "Discount", "steel")]
        ),
        tieout="Σ discount = existing Discount register",
    ),
    "plan-position": _bk(
        "Plan & stage position",
        "Where each live booking stands on its plan: stage k of n, % billed and % received of the agreement.",
        BK.live,
        BK.plan_formula,
        BK.plan_illus,
        [
            _NAME,
            _FLAT,
            _col("plan", "Plan", width=14),
            _col("stage", "Stage", width=8),
            _col("agreement_value", "Agreement value", "money"),
            _col("bills_raised", "Bills raised", "money"),
            _col("pct_billed", "% billed", "pct", width=8),
            _col("received", "Received", "money"),
            _col("pct_received", "% received", "pct", width=8),
            _col("next_due_date", "Next due", "date", width=11),
            _col("total_due", "Total due", "money", False),
            _SALES,
        ],
        ["agreement_value", "bills_raised", "received", "total_due"],
        [
            *_BKF,
            _F["plan"],
            {"key": "billed", "label": "% billed ≥", "kind": "min", "field": "pct_billed", "sentence": "billed {v}%+"},
            _rng("value", "Agreement value", "agreement_value"),
            _rng("bills", "Bills raised", "bills_raised"),
        ],
        permission="reports.outstanding.view",
        export_permission="reports.outstanding.export",
        default_sort=("pct_billed", True),
        headline="bills_raised",
        tieout="Σ bills raised / received = Customer status (live bookings)",
    ),
    "agreements": _bk(
        "Agreements pending / signed",
        "Which live bookings have a signed agreement, how long it took, and how long the rest have waited.",
        BK.live,
        BK.agreements_formula,
        BK.agreements_illus,
        [
            _BOOKED,
            _BOOKING_NO,
            _NAME,
            _FLAT,
            _col("agreement_state", "Agreement", "status", width=10),
            _col("signed_on", "Signed on", "date", width=11),
            _col("days_to_sign", "Days to sign", "num", width=8),
            _col("days_pending", "Days pending", "num", width=8),
            _col("agreement_value", "Agreement value", "money"),
            _SALES,
        ],
        ["agreement_value"],
        [
            *_BKF,
            _multi("agreement", "Agreement", "agreement_state"),
            {
                "key": "pending_days",
                "label": "Days pending ≥",
                "kind": "min",
                "field": "days_pending",
                "sentence": "pending {v}+ days",
            },
            _BOOKED_FY,
            _rng("value", "Agreement value", "agreement_value"),
        ],
        _BG + [{"key": "agreement", "label": "Agreement", "field": "agreement_state"}],
        derived=BK.agreements_totals,
        default_sort=("days_pending", True, "booking_date"),
        headline="pending_value",
        tieout="signed + pending = live bookings; signed = bookings with an accepted plan",
    ),
    "cancellations": _legacy(
        "Cancellations & refunds",
        "Every cancelled booking: received, deduction kept, refund payable and paid.",
        "cancellations",
        [
            ("cancelled_on", "Cancelled", "date", 11),
            ("booking_number", "Booking no.", "str", 13),
            ("customer_name", "Customer name", "str", 18),
            ("unit", "Flat", "str", 14),
            ("paid_paise", "Received", "money"),
            ("forfeiture_paise", "Deduction kept", "money"),
            ("refund_paise", "Refund payable", "money"),
            ("refund_paid_paise", "Refund paid", "money"),
            ("refund_status", "Refund", "status", 9),
            ("reason", "Reason", "str", 24),
        ],
        ["paid_paise", "forfeiture_paise", "refund_paise", "refund_paid_paise"],
        perm="reports.cancellations_refunds.view",
        segment="Bookings",
        period=True,
        enrich=BK.cancellations_enrich,
        hide=("reason",),
        filters=[
            *_LF,
            _multi("refund", "Refund", "refund_status"),
            _rng("refund_amt", "Refund payable", "refund_paise"),
        ],
        groups=_LG + [{"key": "refund", "label": "Refund", "field": "refund_status"}],
        link="/bookings/{booking_id}",
        unit=("cancellation", "cancellations"),
        default_sort=("cancelled_on", True),
        headline="refund_paise",
        formula=_f(
            "Received {paid_paise} − deduction kept {forfeiture_paise} = refund payable {refund_paise} · refund paid {refund_paid_paise}"
        ),
        illus=_money_split(
            "Where the money received went",
            [("refund_paid_paise", "Refunded", "sapphire"), ("forfeiture_paise", "Deduction kept", "graphite")],
        ),
        tieout="Σ refund payable / paid = existing Cancellations report",
    ),
    "transfers": _bk(
        "Transfers, revisions & plan changes",
        "Every change made to a booking after it was booked — flat moves, agreement revisions, price events, plan changes.",
        BK.changes,
        BK.changes_formula,
        BK.changes_illus,
        [
            _col("on", "On", "date", width=11),
            _BOOKING_NO,
            _NAME,
            _FLAT,
            _col("kind", "What changed", "status", width=14),
            _col("from", "From", width=14),
            _col("to", "To", width=14),
            _col("change", "Agreement change", "money"),
            _col("by", "By", width=12),
            _col("reason", "Reason", default=False, width=24),
        ],
        ["change"],
        [
            *_BKF,
            _multi("kind", "What changed", "kind"),
            {"key": "period", "label": "Changed", "kind": "date_range", "field": "on"},
            _rng("change", "Agreement change", "change"),
        ],
        [*LOCATION_GROUPS, {"key": "kind", "label": "What changed", "field": "kind"}, _G["sales"]],
        unit=("change", "changes"),
        derived=BK.changes_totals,
        default_period="this_fy",
        default_sort=("on", True, "booking_number"),
        headline="changes",
        tieout="transfers + revisions + price events = counts on the bookings; plan changes = audit log",
    ),
    "sales-team": _legacy(
        "Sales team performance",
        "Leads, site visits, bookings, value sold, collected and overdue per sales person.",
        "sales-team",
        [
            ("group", "Sales person", "str", 16),
            ("leads", "Leads", "num", 7),
            ("visits", "Site visits", "num", 8),
            ("bookings", "Bookings", "num", 8),
            ("sold_paise", "Sold", "money"),
            ("collected_paise", "Collected", "money"),
            ("overdue_paise", "Overdue", "money"),
        ],
        ["leads", "visits", "bookings", "sold_paise", "collected_paise", "overdue_paise"],
        perm="reports.sales_team.view",
        segment="Bookings",
        period=True,
        filters=[
            _multi("person", "Sales person", "group"),
            _rng("sold", "Sold", "sold_paise"),
            {
                "key": "min_bookings",
                "label": "Bookings ≥",
                "kind": "min",
                "field": "bookings",
                "sentence": "{v}+ bookings",
            },
        ],
        groups=[],
        link=None,
        unit=("person", "people"),
        default_sort=("sold_paise", True),
        headline="sold_paise",
        formula=_f("Sold {sold_paise} · collected {collected_paise} · overdue {overdue_paise}"),
        illus=_money_split(
            "Collected vs overdue",
            [("collected_paise", "Collected", "sapphire"), ("overdue_paise", "Overdue", "coral")],
        ),
        tieout="Σ sold = existing Sales team report",
    ),
    "realised-rate": _bk(
        "Realised rate",
        "Agreed rate against list rate per sq ft, booking by booking, weighted by area.",
        BK.realised,
        BK.rate_formula,
        BK.rate_illus,
        [
            _BOOKING_NO,
            _NAME,
            _FLAT,
            _col("flat_type", "Flat type", width=10),
            _col("area", "Area sq ft", "num", width=9),
            _col("list_value", "List value", "money"),
            _col("agreement_value", "Agreement value", "money"),
            _col("list_rate", "List ₹/sq ft", "money"),
            _col("agreed_rate", "Agreed ₹/sq ft", "money"),
            _col("rate_gap", "Gap ₹/sq ft", "money"),
            _col("discount_pct", "Discount %", "pct", width=8),
            _SALES,
        ],
        ["area", "list_value", "agreement_value", "discount"],
        [
            *_BKF,
            _FT,
            _BOOKED_FY,
            _rng("rate", "Agreed ₹/sq ft", "agreed_rate"),
            {"key": "only_discounted", "label": "Only below list", "kind": "only", "field": "discount"},
        ],
        default_sort=("agreed_rate", False),
        headline="agreement_value",
        tieout="Σ agreement value ÷ Σ area = weighted realised rate",
    ),
    "booking-health": _bk(
        "Booking health",
        "Age, % received against % billed and overdue, rolled into Healthy / Watch / At risk.",
        BK.health,
        BK.health_formula,
        BK.health_illus,
        [
            _NAME,
            _FLAT,
            _col("health", "Health", "status", width=9) | {"tones": {"At risk": "overdue"}},
            _col("why", "Why", width=22),
            _col("age_days", "Age (days)", "num", width=8),
            _col("pct_billed", "% billed", "pct", width=8),
            _col("pct_received", "% received", "pct", width=8),
            _col("gap", "Gap (pts)", "num", width=8),
            _col("overdue_amount", "Overdue", "money"),
            _col("days_overdue", "Days overdue", "num", width=8),
            _col("total_due", "Total due", "money"),
            _SALES,
        ],
        ["overdue_amount", "total_due"],
        [
            *_BKF,
            _multi("health", "Health", "health", [[h, h] for h in BK.HEALTH]),
            _F["overdue_days"],
            _rng("overdue", "Overdue", "overdue_amount"),
        ],
        _BG + [{"key": "health", "label": "Health", "field": "health"}],
        permission="reports.outstanding.view",
        export_permission="reports.outstanding.export",
        derived=BK.health_totals,
        default_sort=("days_overdue", True, "gap"),
        headline="overdue_amount",
        tieout="Σ overdue / total due = Customer status (live bookings)",
    ),
}
REDIRECTS |= {"discount-register": "discount-register", "sales-team": "sales-team"}


# ---------- Phase 3F F5: Project & inventory ----------
from reports_v3 import inventory as IV  # noqa: E402


async def _project_options(user):
    from db import db
    from deps import report_scope_filter

    q = {"company_id": user["company_id"], **report_scope_filter(user, "id")}
    return {
        "project": [
            {"value": p["id"], "label": f"{p.get('code')} · {p.get('name')}"}
            async for p in db.projects.find(q, {"_id": 0, "id": 1, "code": 1, "name": 1}).sort("code", 1)
        ]
    }


_IF = [
    *LOCATION_FILTERS,
    _multi("flat_type", "Flat type", "flat_type"),
    _multi("status", "Status", "status"),
    _multi("category", "Category", "category"),
    _rng("price", "List price", "price"),
    {"key": "min_area", "label": "Area ≥ sq ft", "kind": "min", "field": "area", "sentence": "{v}+ sq ft"},
]
_IG = [
    *LOCATION_GROUPS,
    {"key": "status", "label": "Status", "field": "status"},
    {"key": "flat_type", "label": "Flat type", "field": "flat_type"},
    {"key": "category", "label": "Category", "field": "category"},
]
_PUB_PRICE = _col("price", "List price", "money") | {"public": True}
# REQ-282 / JRN-114: Sales opens the display-layer inventory reports (list prices only, no money received)
_SALES_OK = {"permission_any": ["masters.flat.view"], "public_money": True}
_FLATCOLS = [
    _FLAT,
    _col("flat_type", "Flat type", width=10),
    _col("facing", "Facing", default=False, width=6),
    _col("area", "Area sq ft", "num", width=9),
    _col("category", "Category", default=False, width=10),
]


def _iv(title, purpose, provider, formula, illus, cols, totals, filters, groups=_IG, **kw):
    perm = kw.pop("permission", "reports.inventory.view")
    return _spec(
        "Project & inventory",
        title,
        purpose,
        provider,
        formula,
        illus,
        cols,
        totals,
        filters,
        groups,
        permission=perm,
        export_permission=perm.replace(".view", ".export"),
        date_mode=kw.pop("date_mode", None),
        row_link=kw.pop("row_link", None),
        **kw,
    )


REGISTRY |= {
    "project-statement": _legacy(
        "Project statement",
        "One project on one page: every customer per tower with bill raised, received and balance.",
        "project-statement",
        [
            ("tower", "Tower", "str", 10),
            ("booking_number", "Booking no.", "str", 13),
            ("customer", "Customer name", "str", 18),
            ("flat_number", "Flat", "str", 8),
            ("bill_raised_paise", "Bill raised", "money"),
            ("received_paise", "Received", "money"),
            ("balance_signed_paise", "Balance (− due)", "money"),
            ("balance_status", "Balance", "status", 9),
        ],
        ["bill_raised_paise", "received_paise", "balance_signed_paise"],
        perm="reports.project_statement.view",
        segment="Project & inventory",
        push=(("project", "project_id"),),
        filters=[
            {"key": "project", "label": "Project", "kind": "multi", "pushdown": True, "field": "project_id"},
            *LOCATION_FILTERS[1:],
            CUSTOMER_FILTER,
            _multi("balance", "Balance", "balance_status"),
            _rng("bill", "Bill raised", "bill_raised_paise"),
            _rng("bal", "Balance", "balance_signed_paise"),
        ],
        groups=[_G["tower"], {"key": "balance", "label": "Balance", "field": "balance_status"}],
        link="/bookings/{booking_id}",
        unit=("booking", "bookings"),
        needs={"filter": "project", "message": "Pick a project to see its statement"},
        options_provider=_project_options,
        headline="bill_raised_paise",
        formula=_f(
            "Bill raised {bill_raised_paise} − received {received_paise} = balance {balance_signed_paise} (− = due, + = advance)"
        ),
        illus=_money_split("Bill raised", [("received_paise", "Received", "sapphire")]),
        tieout="Σ bill raised / received = existing Project statement",
    ),
    "inventory-status": _iv(
        "Inventory status",
        "Every flat with its status, list price and area — in the layer you are allowed to see.",
        IV.flats,
        IV.status_formula,
        IV.status_illus,
        [
            *_FLATCOLS,
            _col("status", "Status", width=10),
            _col("shown_as", "Shown as", default=False, width=14),
            _PUB_PRICE,
            _col("customer_name", "Customer", default=False, width=16),
        ],
        ["price", "area"],
        [*_IF, CUSTOMER_FILTER],
        derived=IV.status_totals,
        unit=("flat", "flats"),
        default_sort=("flat_code", False),
        headline="flats",
        real_only=["shown_as"],
        **_SALES_OK,
        tieout="counts per status = existing Inventory report (same viewer)",
    ),
    "stacking-plan": _iv(
        "Stacking plan",
        "Floors × flats for each tower, coloured by status — the picture first, the list below.",
        IV.flats,
        IV.status_formula,
        IV.stack_illus,
        [*_FLATCOLS, _col("status", "Status", width=10), _PUB_PRICE],
        ["price", "area"],
        [*_IF],
        illus_always=True,
        derived=IV.status_totals,
        unit=("flat", "flats"),
        default_sort=("flat_code", False),
        headline="flats",
        **_SALES_OK,
        tieout="cells = flats in Inventory status (same viewer)",
    ),
    "price-list": _iv(
        "Price list & unsold stock value",
        "What is left to sell (available + on hold), at list price and rate per sq ft.",
        IV.unsold,
        IV.price_formula,
        IV.price_illus,
        [
            *_FLATCOLS,
            _col("status", "Status", width=10),
            _col("rate", "Rate ₹/sq ft", "money") | {"public": True},
            _PUB_PRICE,
        ],
        ["price", "area"],
        [*_IF, _rng("rate", "Rate ₹/sq ft", "rate")],
        derived=IV.status_totals,
        unit=("flat", "flats"),
        default_sort=("price", True),
        headline="price",
        **_SALES_OK,
        tieout="Σ list price of available flats = existing Inventory report available value",
    ),
    "hold-register": _iv(
        "Hold register",
        "Flats on hold now: why, for whom, by whom and when the hold lapses.",
        IV.holds,
        IV.holds_formula,
        IV.holds_illus,
        [
            *_FLATCOLS[:2],
            _col("state", "State", "status", width=11) | {"tones": {"Expiring < 48 h": "due"}},
            _col("expires_on", "Lapses on", "date", width=11),
            _col("hours_left", "Hours left", "num", width=8),
            _col("reason", "Reason", width=16),
            _col("customer_name", "For customer", width=16),
            _col("held_by", "Held by", width=13),
            _col("note", "Note", default=False, width=20),
            _PUB_PRICE,
        ],
        ["price"],
        [
            *LOCATION_FILTERS,
            CUSTOMER_FILTER,
            _multi("state", "State", "state"),
            _multi("reason", "Reason", "reason"),
            {"key": "held_by", "label": "Held by", "kind": "multi", "field": "held_by_id", "label_field": "held_by"},
            {"key": "lapse", "label": "Lapses", "kind": "date_range", "field": "expires_on"},
            _rng("price", "List price", "price"),
        ],
        [
            *LOCATION_GROUPS,
            {"key": "reason", "label": "Reason", "field": "reason"},
            {"key": "held_by", "label": "Held by", "field": "held_by"},
        ],
        derived=IV.holds_totals,
        unit=("hold", "holds"),
        default_sort=("hours_left", False),
        headline="holds",
        real_only=["note"],
        **_SALES_OK,
        tieout="holds = flats on Hold in the flats master; expiring = existing Hold register",
    ),
    "landowner": _iv(
        "Landowner & masked units",
        "Units outside the Builder's saleable stock, and (real-status viewers only) units shown differently from their real status.",
        IV.special,
        IV.special_formula,
        lambda rows, t: {"type": "counts", "title": "Units by kind", "counts": t.get("kinds") or {}},
        [
            *_FLATCOLS[:4],
            _col("kind", "Kind", "status", width=12),
            _col("category", "Category", width=10),
            _col("status", "Status", width=10),
            _col("shown_as", "Shown as", width=14),
            _col("display_reason", "Why", width=18),
            _col("display_since", "Since", "date", width=11),
            _col("price", "List price", "money"),
        ],
        ["price", "area"],
        [
            *LOCATION_FILTERS,
            _multi("kind", "Kind", "kind"),
            _multi("category", "Category", "category"),
            _rng("price", "List price", "price"),
        ],
        [*LOCATION_GROUPS, {"key": "kind", "label": "Kind", "field": "kind"}],
        permission="reports.inventory_control.view",
        derived=IV.special_totals,
        unit=("unit", "units"),
        headline="n",
        real_only=["shown_as", "display_reason", "display_since"],
        tieout="landowner = existing Landowner share; masked = existing Masked inventory",
    ),
    "parking": _iv(
        "Parking inventory",
        "Every parking slot by type and level: available, allotted or attached, and to whom.",
        IV.parking,
        IV.parking_formula,
        IV.parking_illus,
        [
            _col("project", "Project", width=7),
            _col("number", "Slot", "code", width=8),
            _col("type", "Type", width=9),
            _col("level", "Level", width=6),
            _col("status", "Status", width=9),
            _col("booking_number", "Booking no.", "code", width=13),
            _col("customer_name", "Customer", width=16),
            _col("price", "Price", "money") | {"public": True},
        ],
        ["price"],
        [
            {"key": "project", "label": "Project", "kind": "multi", "field": "project_id", "label_field": "project"},
            CUSTOMER_FILTER,
            _multi("type", "Type", "type"),
            _multi("level", "Level", "level"),
            _multi("status", "Status", "status"),
            _rng("price", "Price", "price"),
        ],
        [
            _G["project"],
            {"key": "type", "label": "Type", "field": "type"},
            {"key": "status", "label": "Status", "field": "status"},
            {"key": "level", "label": "Level", "field": "level"},
        ],
        derived=IV.parking_totals,
        unit=("slot", "slots"),
        default_sort=("number", False),
        headline="slots",
        **_SALES_OK,
        tieout="slots per status = parking slots master",
    ),
    "construction-vs-plan": _legacy(
        "Construction vs plan",
        "Every tower's stages: planned against done, with the bills each stage raised and what came in.",
        "construction-vs-plan",
        [
            ("project", "Project", "str", 8),
            ("tower", "Tower", "str", 10),
            ("stage", "Stage", "str", 18),
            ("status", "Status", "status", 9),
            ("planned_on", "Planned", "date", 11),
            ("completed_on", "Done", "date", 11),
            ("bookings", "Bookings", "num", 7),
            ("demanded_paise", "Bills raised", "money"),
            ("collected_paise", "Received", "money"),
            ("balance_paise", "Balance", "money"),
            ("expected_paise", "Next bill expected", "money"),
            ("expected_note", "Note", "str", 18),
        ],
        ["demanded_paise", "collected_paise", "balance_paise", "expected_paise"],
        perm="reports.construction_vs_plan.view",
        segment="Project & inventory",
        hide=("expected_note",),
        filters=[
            _multi("project", "Project", "project"),
            _multi("tower", "Tower", "tower"),
            _multi("status", "Status", "status"),
            {"key": "planned", "label": "Planned", "kind": "date_range", "field": "planned_on"},
            {"key": "done", "label": "Done", "kind": "date_range", "field": "completed_on"},
            _rng("balance", "Balance", "balance_paise"),
        ],
        groups=[
            {"key": "project", "label": "Project", "field": "project"},
            {"key": "tower", "label": "Tower", "field": "tower"},
            {"key": "status", "label": "Status", "field": "status"},
        ],
        link=None,
        unit=("stage", "stages"),
        headline="balance_paise",
        formula=_f(
            "Stage bills raised {demanded_paise} − received {collected_paise} = balance {balance_paise} · next stage bills expected {expected_paise}"
        ),
        illus=_money_split(
            "Stage bills", [("collected_paise", "Received", "sapphire"), ("balance_paise", "Balance", "coral")]
        ),
        tieout="Σ bills raised = existing Construction vs plan",
    ),
    "stage-bills": _iv(
        "Stage bills by tower",
        "Per tower: stages done, bills raised to live bookings, received and instalment dues.",
        IV.stage_bills,
        IV.stage_formula,
        IV.stage_illus,
        [
            _col("project", "Project", width=7),
            _col("tower", "Tower", width=12),
            _col("stages_done", "Stages done", width=9),
            _col("last_stage", "Last stage done", width=14),
            _col("last_done_on", "On", "date", width=11),
            _col("bookings", "Bookings", "num", width=7),
            _col("agreement_value", "Agreement value", "money", False),
            _col("bills_raised", "Bills raised", "money"),
            _col("received", "Received", "money"),
            _col("pct_received", "% received", "pct", width=8),
            _col("waived", "Waived", "money", False),
            _col("instalment_dues", "Instalment dues", "money"),
            _col("advance", "Advance", "money", False),
        ],
        ["bookings", "agreement_value", "bills_raised", "received", "instalment_dues", "advance", "waived"],
        [
            LOCATION_FILTERS[0],
            LOCATION_FILTERS[1],
            _rng("dues", "Instalment dues", "instalment_dues"),
            {
                "key": "min_pct",
                "label": "% received ≥",
                "kind": "min",
                "field": "pct_received",
                "sentence": "{v}%+ received",
            },
        ],
        [_G["project"]],
        permission="reports.outstanding.view",
        date_mode="as_of",
        unit=("tower", "towers"),
        default_sort=("instalment_dues", True),
        headline="instalment_dues",
        tieout="Σ bills raised / received / dues = Customer status (live)",
    ),
    "sales-velocity": _iv(
        "Sales velocity",
        "Bookings a month per tower and how many months the unsold stock lasts at that pace.",
        IV.velocity,
        IV.velocity_formula,
        IV.velocity_illus,
        [
            _col("project", "Project", width=7),
            _col("tower", "Tower", width=12),
            _col("flats", "Flats", "num", width=6),
            _col("m3", "Last 3 m", "num", width=7),
            _col("m6", "Last 6 m", "num", width=7),
            _col("m12", "Last 12 m", "num", width=7),
            _col("per_month", "A month", "num", width=7),
            _col("unsold", "Unsold", "num", width=7),
            _col("unsold_value", "Unsold value", "money") | {"public": True},
            _col("months_left", "Months left", "num", width=8),
        ],
        ["flats", "m3", "m6", "m12", "unsold", "unsold_value"],
        [
            LOCATION_FILTERS[0],
            LOCATION_FILTERS[1],
            _rng("unsold_value", "Unsold value", "unsold_value"),
            {
                "key": "min_left",
                "label": "Months left ≥",
                "kind": "min",
                "field": "months_left",
                "sentence": "{v}+ months left",
            },
        ],
        [_G["project"]],
        date_mode="as_of",
        derived=IV.velocity_totals,
        unit=("tower", "towers"),
        default_sort=("months_left", True),
        headline="unsold_value",
        **_SALES_OK,
        tieout="Σ unsold = Inventory status available + hold; Σ last 12 m = booking register",
    ),
}
REDIRECTS |= {
    "inventory-control": "inventory-status",
    "inventory": "inventory-status",
    "landowner-share": "landowner",
    "masked-inventory": "landowner",
    "project-statement": "project-statement",
    "hold-register": "hold-register",
    "construction-vs-plan": "construction-vs-plan",
}


# ---------- Phase 3F F6: Leads ----------
from reports_v3 import leads as LD  # noqa: E402
from services.pdf import inr  # noqa: E402

_LDF = [
    {"key": "project", "label": "Project", "kind": "multi", "field": "project_id", "label_field": "project"},
    _multi("source", "Source", "source"),
    {"key": "owner", "label": "Sales person", "kind": "multi", "field": "owner_id", "label_field": "owner"},
]
_LDF_PUSH = [f | {"pushdown": True} for f in _LDF]
_LDG = [
    {"key": "project", "label": "Project", "field": "project"},
    {"key": "source", "label": "Source", "field": "source"},
    {"key": "owner", "label": "Sales person", "field": "owner"},
    {"key": "status", "label": "Stage", "field": "status"},
]
_CREATED = {"key": "period", "label": "Enquiry", "kind": "date_range", "field": "created_on"}
_LEAD_NO, _LEAD_NAME = _col("lead_number", "Lead no.", "code", width=13), _col("name", "Lead name", width=18)
_OWNER, _SRC, _STAGE = (
    _col("owner", "Sales person", width=13),
    _col("source", "Source", width=10),
    _col("status", "Stage", "status", width=14),
)
_LPHONE = _col("phone", "Phone", "code", False, width=13)


def _ld(title, purpose, provider, formula, illus, cols, totals, filters, groups=_LDG, **kw):
    perm = kw.pop("permission", _L)
    return _spec(
        "Leads",
        title,
        purpose,
        provider,
        formula,
        illus,
        cols,
        totals,
        filters,
        groups,
        permission=perm,
        export_permission=perm.replace(".view", ".export"),
        date_mode=None,
        row_link=kw.pop("row_link", None),
        **kw,
    )


REGISTRY |= {
    "lead-funnel": _ld(
        "Lead funnel",
        "Enquiry → contacted → visit → negotiation → booking: how many reached each stage and how many are there now.",
        LD.funnel,
        LD.funnel_formula,
        LD.funnel_illus,
        [
            _col("stage", "Stage", width=16),
            _col("leads", "Now in stage", "num", width=9),
            _col("pct", "% of leads", "pct", width=8),
            _col("reached", "Reached", "num", width=8),
            _col("step_pct", "From previous step", "pct", width=10),
        ],
        ["leads"],
        [_CREATED | {"pushdown": True}, *_LDF_PUSH],
        [],
        pushdown=["period_from", "period_to"],
        options_provider=LD.options,
        derived=LD.funnel_totals,
        default_period="this_fy",
        default_sort=("seq", False),
        unit=("stage", "stages"),
        headline="leads",
        tieout="leads per stage = existing Sales & leads funnel (same period)",
    ),
    "lead-register": _ld(
        "Lead register",
        "Every lead with source, stage, owner, first response, last action and next follow-up.",
        LD.register,
        lambda t: (
            f"{t.get('n', 0):,} leads · {t.get('open_n', 0):,} open · {t.get('converted_n', 0):,} converted · bookings "
            f"from leads {inr(t.get('booking_value', 0))}"
        ),
        lambda rows, t: {
            "type": "counts",
            "title": "Leads by stage",
            "counts": {
                s: sum(1 for r in rows if r["status"] == s) for s in LD.STAGES if any(r["status"] == s for r in rows)
            },
        },
        [
            _col("created_on", "Enquiry", "date", width=11),
            _LEAD_NO,
            _LEAD_NAME,
            _LPHONE,
            _col("project", "Project", width=7),
            _SRC,
            _STAGE,
            _OWNER,
            _col("first_response_hours", "First response (h)", "num", width=9),
            _col("last_action_on", "Last action", "date", width=11),
            _col("next_follow_up", "Next follow-up", "date", width=11),
            _col("visits_done", "Visits done", "num", width=7),
            _col("booking_value", "Booking value", "money", False),
            _col("budget", "Budget", "money", False),
        ],
        ["booking_value", "visits_done"],
        [
            *_LDF,
            _multi("status", "Stage", "status", [[s, s] for s in LD.STAGES]),
            _CREATED,
            {"key": "idle", "label": "Idle days ≥", "kind": "min", "field": "idle_days", "sentence": "idle {v}+ days"},
            _rng("budget", "Budget", "budget"),
        ],
        derived=lambda t, rows: {
            "n": len(rows),
            "open_n": sum(1 for r in rows if r["open"]),
            "converted_n": sum(1 for r in rows if r["status"] == "Converted"),
        },
        default_sort=("created_on", True, "lead_number"),
        unit=("lead", "leads"),
        headline="n",
        tieout="leads = leads master (live)",
    ),
    "source-performance": _ld(
        "Source performance",
        "Leads, visits, bookings and conversion by source — which sources are worth the spend.",
        LD.sources,
        LD.sources_formula,
        LD.sources_illus,
        [
            _col("source", "Source", width=12),
            _col("leads", "Leads", "num", width=7),
            _col("contacted", "Contacted", "num", width=8),
            _col("visited", "Visited", "num", width=7),
            _col("visit_pct", "Visit %", "pct", width=7),
            _col("converted", "Converted", "num", width=8),
            _col("conversion_pct", "Conversion %", "pct", width=9),
            _col("lost", "Lost", "num", width=6),
            _col("booking_value", "Booking value", "money"),
        ],
        ["leads", "contacted", "visited", "converted", "lost", "booking_value"],
        [_CREATED | {"pushdown": True}, *_LDF_PUSH, _rng("value", "Booking value", "booking_value")],
        [],
        pushdown=["period_from", "period_to"],
        options_provider=LD.options,
        derived=LD.pct_totals,
        default_period="this_fy",
        default_sort=("converted", True),
        unit=("source", "sources"),
        headline="conversion_pct",
        tieout="leads / converted per source = existing Sales & leads (same period)",
    ),
    "follow-ups": _ld(
        "Follow-ups due & missed",
        "Open leads with a follow-up: who is overdue, who is due today, who is next.",
        LD.follow_ups,
        LD.fu_formula,
        LD.fu_illus,
        [
            _col("next_follow_up", "Follow-up on", "date", width=11),
            _col("follow_up_state", "State", "status", width=9) | {"tones": {"Overdue": "overdue", "Today": "due"}},
            _col("follow_up_days_late", "Days late", "num", width=7),
            _LEAD_NO,
            _LEAD_NAME,
            _LPHONE,
            _STAGE,
            _OWNER,
            _col("last_note", "Last note", width=24),
        ],
        [],
        [
            *_LDF,
            _multi(
                "state",
                "State",
                "follow_up_state",
                [["Overdue", "Overdue"], ["Today", "Today"], ["Upcoming", "Upcoming"]],
            ),
            {"key": "due", "label": "Follow-up on", "kind": "date_range", "field": "next_follow_up"},
            {
                "key": "late",
                "label": "Days late ≥",
                "kind": "min",
                "field": "follow_up_days_late",
                "sentence": "{v}+ days late",
            },
        ],
        derived=LD.fu_totals,
        default_sort=("next_follow_up", False),
        unit=("lead", "leads"),
        headline="n",
        tieout="overdue = existing Sales & leads follow-ups overdue",
    ),
    "visit-register": _ld(
        "Site visit register",
        "Every site visit: scheduled, done, no-show or cancelled, with the outcome and whether the lead booked.",
        LD.visits,
        LD.visit_formula,
        LD.visit_illus,
        [
            _col("date", "Date", "date", width=11),
            _col("slot", "Slot", width=6),
            _col("visit_number", "Visit no.", "code", width=13),
            _col("name", "Visitor", width=16),
            _col("project", "Project", width=7),
            _col("status", "Status", "status", width=10),
            _col("outcome", "Outcome", width=14),
            _OWNER,
            _col("lead_number", "Lead no.", "code", width=13),
            _col("source", "Source", default=False, width=10),
            _col("converted", "Booked", width=6),
        ],
        [],
        [
            {"key": "project", "label": "Project", "kind": "multi", "field": "project_id", "label_field": "project"},
            {"key": "owner", "label": "Sales person", "kind": "multi", "field": "owner_id", "label_field": "owner"},
            _multi("status", "Status", "status"),
            _multi("outcome", "Outcome", "outcome"),
            _multi("converted", "Booked", "converted"),
            {"key": "period", "label": "Visit date", "kind": "date_range", "field": "date"},
        ],
        [
            {"key": "project", "label": "Project", "field": "project"},
            {"key": "owner", "label": "Sales person", "field": "owner"},
            {"key": "status", "label": "Status", "field": "status"},
            {"key": "outcome", "label": "Outcome", "field": "outcome"},
        ],
        permission="reports.site_visit_conversion.view",
        derived=LD.visit_totals,
        default_period="this_fy",
        default_sort=("date", True, "visit_number"),
        unit=("visit", "visits"),
        headline="n",
        tieout="visits per status = existing Site visit conversion (same period)",
    ),
    "visit-conversion": _legacy(
        "Site visit conversion",
        "Scheduled → completed → booked, by sales person, project, month or outcome.",
        "site-visits",
        [
            ("group", "Group", "str", 16),
            ("scheduled", "Scheduled", "num", 8),
            ("completed", "Completed", "num", 8),
            ("no_show", "No-show", "num", 7),
            ("cancelled", "Cancelled", "num", 7),
            ("show_pct", "Show %", "pct", 7),
            ("converted", "Booked", "num", 7),
            ("conversion_pct", "Conversion %", "pct", 9),
        ],
        ["scheduled", "completed", "no_show", "cancelled", "converted"],
        perm="reports.site_visit_conversion.view",
        segment="Leads",
        period=True,
        push=(("by", "group_by"),),
        filters=[
            {
                "key": "by",
                "label": "By",
                "kind": "choice",
                "pushdown": True,
                "options": [["rm", "Sales person"], ["project", "Project"], ["month", "Month"], ["outcome", "Outcome"]],
            },
            _multi("group", "Group", "group"),
            {
                "key": "min_sched",
                "label": "Scheduled ≥",
                "kind": "min",
                "field": "scheduled",
                "sentence": "{v}+ scheduled",
            },
        ],
        groups=[],
        link=None,
        unit=("group", "groups"),
        default_sort=("scheduled", True),
        derived=lambda t, rows: {
            "show_pct": round(100 * t["completed"] / t["scheduled"], 1) if t.get("scheduled") else 0,
            "conversion_pct": round(100 * t["converted"] / t["completed"], 1) if t.get("completed") else 0,
        },
        headline="conversion_pct",
        formula=lambda t: (
            f"{t.get('scheduled', 0):,} scheduled → {t.get('completed', 0):,} completed ({t.get('show_pct', 0)}%) → "
            f"{t.get('converted', 0):,} booked = {t.get('conversion_pct', 0)}% of completed visits"
        ),
        illus=lambda rows, t: {
            "type": "split_bar",
            "title": "Visits",
            "count": True,
            "parts": [
                {"label": "Booked", "value": t.get("converted", 0), "tone": "sapphire"},
                {
                    "label": "Completed, not booked",
                    "value": t.get("completed", 0) - t.get("converted", 0),
                    "tone": "graphite",
                },
                {"label": "No-show", "value": t.get("no_show", 0), "tone": "steel"},
                {"label": "Cancelled", "value": t.get("cancelled", 0), "tone": "muted"},
            ],
        },
        tieout="= existing Site visit conversion",
    ),
    "lost-leads": _ld(
        "Lost leads & reasons",
        "Why leads were lost, how long they lasted, and from which source and owner.",
        LD.lost,
        LD.lost_formula,
        LD.lost_illus,
        [
            _col("lost_on", "Lost on", "date", width=11),
            _LEAD_NO,
            _LEAD_NAME,
            _col("lost_reason", "Reason", width=18),
            _col("days_to_lose", "Days open", "num", width=7),
            _col("project", "Project", width=7),
            _SRC,
            _OWNER,
            _col("visits_done", "Visits done", "num", width=7),
            _col("created_on", "Enquiry", "date", False, width=11),
        ],
        [],
        [
            *_LDF,
            _multi("reason", "Reason", "lost_reason"),
            {"key": "period", "label": "Lost on", "kind": "date_range", "field": "lost_on"},
            {
                "key": "days",
                "label": "Days open ≥",
                "kind": "min",
                "field": "days_to_lose",
                "sentence": "open {v}+ days",
            },
        ],
        _LDG[:3] + [{"key": "reason", "label": "Reason", "field": "lost_reason"}],
        derived=LD.lost_totals,
        default_sort=("lost_on", True),
        unit=("lead", "leads"),
        headline="n",
        tieout="lost = leads master status Lost",
    ),
    "response-time": _ld(
        "Response time",
        "How fast each enquiry got its first response (first stage after New), banded, by owner and source.",
        LD.register,
        LD.resp_formula,
        LD.resp_illus,
        [
            _col("created_on", "Enquiry", "date", width=11),
            _LEAD_NO,
            _LEAD_NAME,
            _SRC,
            _OWNER,
            _col("first_response_hours", "First response (h)", "num", width=9),
            _col("response_band", "Band", width=11),
            _STAGE,
        ],
        [],
        [
            *_LDF,
            _multi("band", "Band", "response_band", [[b, b] for b in LD.RESP_BANDS]),
            _CREATED,
            {
                "key": "slow",
                "label": "Hours ≥",
                "kind": "min",
                "field": "first_response_hours",
                "sentence": "{v}+ h to respond",
            },
        ],
        _LDG[:3] + [{"key": "band", "label": "Band", "field": "response_band"}],
        derived=LD.resp_totals,
        default_period="this_fy",
        default_sort=("first_response_hours", True),
        unit=("lead", "leads"),
        headline="median_h",
        tieout="responded + not yet = leads in the period",
    ),
    "team-pipeline": _ld(
        "Team pipeline",
        "Per sales person: open leads by stage, follow-ups overdue, visits in the next 7 days, converted and lost.",
        LD.team,
        LD.team_formula,
        LD.team_illus,
        [
            _col("owner", "Sales person", width=14),
            _col("open", "Open", "num", width=6),
            _col("new", "New", "num", width=6),
            _col("contacted", "Contacted", "num", width=7),
            _col("visit_scheduled", "Visit booked", "num", width=7),
            _col("visit_done", "Visited", "num", width=7),
            _col("negotiation", "Negotiating", "num", width=8),
            _col("fu_overdue", "Follow-ups overdue", "num", width=9),
            _col("visits_next_7", "Visits next 7 d", "num", width=8),
            _col("converted", "Converted", "num", width=8),
            _col("lost", "Lost", "num", width=6),
            _col("booking_value", "Booking value", "money", False),
        ],
        [
            "open",
            "new",
            "contacted",
            "visit_scheduled",
            "visit_done",
            "negotiation",
            "fu_overdue",
            "visits_next_7",
            "converted",
            "lost",
            "booking_value",
        ],
        [
            *_LDF_PUSH,
            {"key": "min_open", "label": "Open ≥", "kind": "min", "field": "open", "sentence": "{v}+ open"},
            _rng("value", "Booking value", "booking_value"),
        ],
        [],
        options_provider=LD.options,
        default_sort=("open", True),
        unit=("person", "people"),
        headline="open",
        tieout="Σ open = open leads in Lead ageing; Σ overdue = Follow-ups overdue",
    ),
    "lead-ageing": _ld(
        "Lead ageing",
        "Open leads by days since enquiry and days since the last action — what is going cold.",
        LD.ageing,
        LD.age_formula,
        LD.age_illus,
        [
            _col("created_on", "Enquiry", "date", width=11),
            _LEAD_NO,
            _LEAD_NAME,
            _STAGE,
            _OWNER,
            _SRC,
            _col("age_days", "Age (days)", "num", width=7),
            _col("age_band", "Age band", width=11),
            _col("last_action_on", "Last action", "date", width=11),
            _col("idle_days", "Idle days", "num", width=7),
            _col("next_follow_up", "Next follow-up", "date", width=11),
        ],
        [],
        [
            *_LDF,
            _multi("status", "Stage", "status", [[s, s] for s in LD.STAGES[:5]]),
            _multi("band", "Age band", "age_band", [[b, b] for b in LD.AGE_BANDS]),
            {"key": "age", "label": "Age ≥", "kind": "min", "field": "age_days", "sentence": "{v}+ days old"},
            {"key": "idle", "label": "Idle days ≥", "kind": "min", "field": "idle_days", "sentence": "idle {v}+ days"},
        ],
        _LDG + [{"key": "band", "label": "Age band", "field": "age_band"}],
        derived=LD.age_totals,
        default_sort=("idle_days", True),
        unit=("lead", "leads"),
        headline="n",
        tieout="open leads = leads master open stages",
    ),
}
REDIRECTS |= {"sales-leads": "lead-funnel", "site-visits": "visit-conversion"}


# Customers segment: the tenth report (service requests) moves onto the sheet too
def _sla_totals(t, rows):
    res = t.get("resolved", 0)
    w = lambda k: round(sum((r.get(k) or 0) * r["resolved"] for r in rows) / res, 1) if res else None  # noqa: E731
    return {"sla_met_pct": w("sla_met_pct"), "avg_resolution_h": w("avg_resolution_h")}


REGISTRY["service-sla"] = _legacy(
    "Service requests & SLA",
    "Customer service requests by category: open, resolved, SLA met and hours to resolve.",
    "service-sla",
    [
        ("category", "Category", "str", 14),
        ("total", "Requests", "num", 8),
        ("open", "Open", "num", 6),
        ("resolved", "Resolved", "num", 8),
        ("sla_met_pct", "SLA met %", "pct", 8),
        ("avg_resolution_h", "Avg hours to resolve", "num", 10),
        ("avg_rating", "Avg rating", "num", 7),
    ],
    ["total", "open", "resolved"],
    perm="reports.service_sla.view",
    segment="Customers",
    period=True,
    filters=[
        _multi("category", "Category", "category"),
        {"key": "min_open", "label": "Open ≥", "kind": "min", "field": "open", "sentence": "{v}+ open"},
    ],
    groups=[],
    link=None,
    unit=("category", "categories"),
    default_sort=("total", True),
    derived=_sla_totals,
    headline="open",
    formula=lambda t: (
        f"{t.get('total', 0):,} requests = {t.get('open', 0):,} open + {t.get('resolved', 0):,} resolved · SLA "
        f"met on {t.get('sla_met_pct') or 0}% of resolved · {t.get('avg_resolution_h') or 0} h average to resolve"
    ),
    illus=lambda rows, t: {
        "type": "split_bar",
        "title": "Requests",
        "count": True,
        "parts": [
            {"label": "Resolved", "value": t.get("resolved", 0), "tone": "sapphire"},
            {"label": "Open", "value": t.get("open", 0), "tone": "steel"},
        ],
    },
    tieout="= existing Service requests & SLA",
)
REDIRECTS["service-sla"] = "service-sla"
