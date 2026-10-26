"""Phase R3 — human diff for audit rows: changed_fields [{field,label,old,new,kind}], module names, record labels, sensitive masking."""
import re

MASKED = "•••• (masked)"
SENSITIVE = re.compile(r"(pan|aadhaar|aadhar|password|passwd|secret|token|otp|bank_account|account_number|ifsc|cvv|card)", re.I)
SKIP = {"updated_at", "version", "created_at", "_id", "propagated", "propagated_complete", "summary", "search_text", "cache"}
MODULES = {"project": "Project Master", "block": "Tower / Block", "flat": "Flat", "customer": "Customer", "booking": "Booking", "payment": "Payment", "demand": "Demand", "lead": "Lead",
           "visit": "Site Visit", "site_visit": "Site Visit", "ticket": "Service Request", "service_request": "Service Request", "user": "User", "role": "Role", "catalogue": "Catalogue",
           "settings": "Settings", "setting": "Settings", "refund": "Refund", "company": "Company", "charge_type": "Charge Type", "payment_plan": "Payment Plan", "stage_plan": "Construction Stage Plan", "rate_card": "Rate Card",
           "parking": "Parking", "document": "Document", "notice": "Notice", "cms": "Website CMS", "stage": "Construction Stage", "roznamcha": "Roznamcha"}
LABEL_KEYS = ("booking_number", "receipt_number", "demand_number", "visit_number", "ticket_number", "full_name", "customer_name", "flat_number", "name", "title", "email", "code")


def module_name(entity_type: str | None) -> str:
    return MODULES.get(entity_type or "", (entity_type or "").replace("_", " ").title())


def record_label(before, after) -> str | None:
    for d in (after, before):
        if isinstance(d, dict):
            for k in LABEL_KEYS:
                if d.get(k):
                    return str(d[k])
    return None


def _label(field: str) -> str:
    return field.replace("_paise", "").replace("_", " ").strip().capitalize()


def _kind(field: str, v) -> str:
    if field.endswith("_paise"):
        return "money"
    if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}", v):
        return "date"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (dict, list)):
        return "json"
    return "text"


def mask(v):
    if isinstance(v, dict):
        return {k: (MASKED if SENSITIVE.search(k) else mask(x)) for k, x in v.items()}
    if isinstance(v, list):
        return [mask(x) for x in v]
    return v


def _val(v):
    if isinstance(v, (dict, list)):
        return mask(v)
    return v


def action_kind(action: str) -> str:
    a = action.rsplit(".", 1)[-1]
    return {"create": "created", "update": "updated", "delete": "deleted", "deactivate": "deleted", "reverse": "reversed", "cancel": "status_changed", "bounce": "status_changed", "clear": "status_changed",
            "status": "status_changed", "complete": "status_changed", "transfer": "updated", "revise": "updated", "access_update": "updated"}.get(a, "updated" if a.startswith("update") else a)


def changed_fields(before, after) -> list[dict]:
    if not isinstance(before, dict) or not isinstance(after, dict):
        return []
    out = []
    for k in sorted(set(before) | set(after)):
        if k in SKIP or k.startswith("_"):
            continue
        o, n = before.get(k), after.get(k)
        if o == n or (not k.endswith("_paise") and f"{k}_paise" in before | after):
            continue
        if SENSITIVE.search(k):
            out.append({"field": k, "label": _label(k), "old": MASKED if o is not None else None, "new": MASKED if n is not None else None, "kind": "masked"})
            continue
        out.append({"field": k, "label": _label(k), "old": _val(o), "new": _val(n), "kind": _kind(k, n if n is not None else o)})
    return out
