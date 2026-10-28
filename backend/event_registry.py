"""Event registry: ONE row per domain event. Drives cache invalidation (no hand-kept prefix maps), party-based notifications,
the Journey panel ("where did this go?") and the effect tests. `surfaces` are the read surfaces an event is expected to change."""

# surface -> ttlcache prefixes to invalidate
SURFACE_CACHE = {
    "home": ("home:",), "dashboard": ("dash:",), "widgets": ("widgets:",), "bootstrap": ("boot:",), "bundle": ("bundle:",),
    "payments": ("list:payments",), "demands": ("list:demands",), "bookings": ("list:bookings",), "flats": ("list:flats",), "blocks": ("list:blocks",), "projects": ("list:projects",),
    "customers": ("list:customers",), "leads": ("list:leads",), "visits": ("list:site_visits", "avail:"), "service": ("list:service_requests",), "users": ("list:users",),
    "ledgers": (), "roznamcha": (), "reports": (), "search": (), "customer360": (), "notifications": (), "audit": (), "inventory": ("list:flats", "dash:"), "refunds": (), "cheques": (),
}

MONEY = ["ledgers", "bookings", "demands", "payments", "customer360", "home", "dashboard", "widgets", "bootstrap", "roznamcha", "reports", "audit", "projects", "blocks"]
INVENTORY = ["flats", "inventory", "blocks", "projects", "home", "dashboard", "bootstrap", "reports", "audit"]

# event -> spec. notify: roles (ERP roles), parties (assignee|rm|customer), title(after)->(title, body) or None
EVENTS = {
    "lead.create": {"entity": "lead", "surfaces": ["leads", "home", "bootstrap", "reports", "search", "audit", "notifications"], "roles": ["Sales", "Marketing", "Super Admin"], "parties": ["assignee"], "title": lambda a: ("New website enquiry" if a.get("source") == "Website" else "New enquiry", f"{a.get('lead_number', '')} · {a.get('project') or a.get('project_name') or 'General'}")},
    "lead.stage": {"entity": "lead", "surfaces": ["leads", "home", "reports", "audit", "customer360", "notifications"], "parties": ["assignee"], "title": lambda a: ("Lead stage changed", f"{a.get('lead_number', '')} → {a.get('status', '')}")},
    "lead.update": {"entity": "lead", "surfaces": ["leads", "audit", "notifications"], "parties": ["assignee"], "title": lambda a: ("Lead assigned to you", f"{a.get('lead_number', '')} · {a.get('name', '')}") if a.get("assigned_to") else None},
    "lead.convert": {"entity": "lead", "surfaces": ["leads", "home", "reports", "audit", "customer360"], "parties": ["assignee"], "title": lambda a: ("Lead converted", f"{a.get('lead_number', '')} → {a.get('booking_number', '')}")},
    "visit.book": {"entity": "site_visit", "surfaces": ["visits", "leads", "home", "bootstrap", "customer360", "audit", "notifications"], "parties": ["assignee"], "title": lambda a: ("Site visit booked", f"{a.get('visit_number', '')} · {a.get('date', '')} {a.get('slot_start', '')}")},
    "visit.status": {"entity": "site_visit", "surfaces": ["visits", "leads", "home", "bootstrap", "customer360", "reports", "audit", "notifications"], "parties": ["assignee"], "title": lambda a: ("Site visit " + str(a.get("status", "")).lower(), f"{a.get('visit_number', '')}")},
    "roznamcha.opening": {"entity": "company", "surfaces": ["roznamcha", "audit"]},
    "customer.create": {"entity": "customer", "surfaces": ["customers", "search", "audit"]},
    "customer.update": {"entity": "customer", "surfaces": ["customers", "customer360", "bookings", "payments", "search", "audit"]},
    "customer.kyc": {"entity": "customer", "surfaces": ["customers", "customer360", "audit", "notifications"], "roles": ["Accounts", "Super Admin"], "title": lambda a: ("KYC status changed", f"{a.get('customer_code', '')} · {a.get('kyc_status', '')}")},
    "booking.create": {"entity": "booking", "surfaces": MONEY + ["flats", "inventory", "blocks", "projects", "leads", "search", "notifications"], "roles": ["Accounts", "Project Admin", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("New booking", f"{a.get('booking_number', '')} · {a.get('customer_name', '')} · {(a.get('flat_snapshot') or {}).get('flat_number', '')}")},
    "booking.agreement_revision": {"entity": "booking", "surfaces": MONEY + ["notifications"], "roles": ["Accounts", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Agreement revised", f"{a.get('booking_number', '')} · {a.get('reason', '')}")},
    "booking.cancel": {"entity": "booking", "surfaces": MONEY + ["flats", "inventory", "blocks", "projects", "refunds", "notifications"], "roles": ["Accounts", "Sales", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Booking cancelled", f"{a.get('booking_number', '')} · {a.get('reason', '')} · refund ₹{(a.get('refund_paise') or 0) / 100:,.0f}")},
    "booking.complete": {"entity": "booking", "surfaces": MONEY + ["flats", "inventory", "notifications"], "roles": ["Accounts", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Booking completed / possession", f"{a.get('booking_number', '')}")},
    "booking.transfer": {"entity": "booking", "surfaces": MONEY + ["flats", "inventory", "blocks", "projects", "notifications"], "roles": ["Accounts", "Project Admin", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Booking transferred", f"{a.get('booking_number', '')} · {a.get('from_flat', '')} → {a.get('to_flat', '')}")},
    "booking.other_charge_demand": {"entity": "booking", "surfaces": MONEY + ["notifications"], "roles": ["Accounts", "Super Admin"], "parties": ["customer"], "title": lambda a: ("Other charge demanded", f"{a.get('line', '')} · ₹{(a.get('amount_paise') or 0) / 100:,.0f}")},
    "refund.create": {"entity": "refund", "surfaces": ["refunds", "reports", "audit", "notifications"], "roles": ["Accounts", "Super Admin"], "parties": ["customer"], "title": lambda a: ("Refund pending approval", f"{a.get('booking_number', '')} · ₹{(a.get('amount_paise') or 0) / 100:,.0f}")},
    "refund.paid": {"entity": "refund", "surfaces": MONEY + ["refunds", "notifications"], "roles": ["Accounts", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Refund paid", f"{a.get('booking_number', '')} · ₹{(a.get('amount_paise') or 0) / 100:,.0f} · {a.get('mode', '')}")},
    "payment.post": {"entity": "payment", "surfaces": MONEY + ["cheques", "notifications"], "roles": ["Accounts"], "parties": ["rm", "customer"], "title": lambda a: ("Receipt posted", f"{a.get('receipt_number', '')} · ₹{(a.get('amount_paise') or 0) / 100:,.0f} · {a.get('payment_mode_name') or a.get('category') or ''} · {a.get('status', '')}") if a.get("receipt_number") and "payment_mode_name" in a else None},
    "payment.clear": {"entity": "payment", "surfaces": MONEY + ["cheques", "notifications"], "roles": ["Accounts"], "parties": ["rm", "customer"], "title": lambda a: ("Cheque cleared", f"{a.get('receipt_number', '')}")},
    "payment.bounce": {"entity": "payment", "surfaces": MONEY + ["cheques", "notifications"], "roles": ["Accounts", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Cheque bounced", f"{a.get('receipt_number', '')} · {a.get('customer_name', '')} · {a.get('reason', '')}")},
    "payment.reverse": {"entity": "payment", "surfaces": MONEY + ["cheques", "notifications"], "roles": ["Accounts", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Receipt reversed", f"{a.get('receipt_number', '')} · {a.get('reason', '')}") if a.get("by") else None},
    "demand.create": {"entity": "booking", "surfaces": MONEY + ["notifications"], "roles": ["Accounts", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Installment demand raised", f"{a.get('demand_number', '')} · {a.get('customer_name', '')} · {a.get('milestone', '')} · due {a.get('due_date', '')}")},
    "demand.rebind": {"entity": "booking", "surfaces": MONEY, "title": None},
    "demand.reproportion": {"entity": "booking", "surfaces": MONEY, "title": None},
    "demand.close": {"entity": "demand", "surfaces": MONEY, "title": None},
    "demand.overdue": {"entity": "booking", "surfaces": ["notifications", "audit"], "roles": ["Accounts", "Super Admin"], "parties": ["rm", "customer"], "title": lambda a: ("Demand overdue", f"{a.get('demand_number', '')} · {a.get('customer_name', '')} · due {a.get('due_date', '')}")},
    "milestone.complete": {"entity": "block", "surfaces": MONEY + ["blocks", "projects", "notifications"], "roles": ["Accounts", "Project Admin", "Super Admin"], "title": lambda a: ("Stage completed", f"{a.get('block_name') or a.get('block_code') or ''} · {a.get('milestone_name') or a.get('stage_name') or ''} ({a.get('cumulative_percent', '')}%)")},
    "milestone.undo": {"entity": "block", "surfaces": MONEY + ["blocks", "projects", "notifications"], "roles": ["Accounts", "Project Admin", "Super Admin"], "title": lambda a: ("Stage completion undone", f"{a.get('block_name') or a.get('block_code') or ''} · {a.get('milestone_name') or a.get('stage_name') or ''}")},
    "stage.photo": {"entity": "block", "surfaces": ["blocks", "customer360", "audit"]},
    "flat.status": {"entity": "flat", "surfaces": INVENTORY + ["notifications"], "roles": ["Sales"], "title": lambda a: ("Unit on hold", f"{a.get('flat_number', '')} · {a.get('reason', '')}") if a.get("status") == "Hold" else None},
    "flat.price": {"entity": "flat", "surfaces": INVENTORY},
    "flat.create": {"entity": "flat", "surfaces": INVENTORY + ["wizard", "public", "portal"], "title": None},  # X.3 single-flat add (structure builder / wizard quick-add)
    "flat.category_changed": {"entity": "flat", "surfaces": INVENTORY + ["wizard", "public", "portal"], "title": None},
    "flat.held": {"entity": "flat", "surfaces": INVENTORY + ["wizard", "public", "portal", "notifications"], "roles": ["Sales"], "title": lambda a: ("Unit on hold", f"{a.get('flat_number', '')} · until {str((a.get('hold') or {}).get('expires_at', ''))[:16].replace('T', ' ')}")},
    "flat.hold_extended": {"entity": "flat", "surfaces": INVENTORY + ["notifications"], "title": None},
    "flat.released": {"entity": "flat", "surfaces": INVENTORY + ["wizard", "public", "portal", "notifications"], "title": None},
    "flat.hold_expired": {"entity": "flat", "surfaces": INVENTORY + ["wizard", "public", "portal", "notifications"], "title": None},
    "flat.blocked": {"entity": "flat", "surfaces": INVENTORY + ["wizard", "public", "portal"], "title": None},
    "flat.unblocked": {"entity": "flat", "surfaces": INVENTORY + ["wizard", "public", "portal"], "title": None},
    "flat.display_changed": {"entity": "flat", "surfaces": INVENTORY + ["public", "portal"], "title": None},
    "flat.update": {"entity": "flat", "surfaces": INVENTORY},
    "block.update": {"entity": "block", "surfaces": INVENTORY + ["notifications"], "roles": ["Project Admin", "Accounts"], "title": lambda a: ("Tower setup changed", f"{a.get('code') or a.get('name') or ''}") if a.get("construction_stages") or a.get("payment_plan_ids") else None},
    "project.update": {"entity": "project", "surfaces": INVENTORY + ["bundle"]},
    "service.create": {"entity": "service_request", "surfaces": ["service", "home", "customer360", "reports", "audit", "notifications"], "roles": ["Sales", "Super Admin"], "parties": ["assignee"], "title": lambda a: ("New service request", f"{a.get('ticket_number', '')} · {a.get('subject', '')} · {a.get('customer_name', '')}")},
    "service.status": {"entity": "service_request", "surfaces": ["service", "home", "customer360", "reports", "audit", "notifications"], "parties": ["assignee", "customer"], "title": lambda a: ("Ticket " + str(a.get("status", "")).lower(), f"{a.get('ticket_number', '')} · {a.get('subject', '')}")},
    "service.update": {"entity": "service_request", "surfaces": ["service", "audit", "notifications"], "parties": ["assignee"], "title": lambda a: ("Ticket assigned to you", f"{a.get('ticket_number', '')} · {a.get('subject', '')}") if a.get("assigned_to") else None},
    "service.customer_reply": {"entity": "service_request", "surfaces": ["service", "audit", "notifications"], "roles": ["Sales", "Super Admin"], "parties": ["assignee"], "title": lambda a: ("Customer replied on ticket", f"{a.get('ticket_number', '')} · {a.get('customer_name', '')}")},
    "service.sla_breach": {"entity": "service_request", "surfaces": ["service", "audit", "notifications"], "roles": ["Sales", "Super Admin", "Project Admin"], "parties": ["assignee"], "title": lambda a: ("SLA breached", f"{a.get('ticket_number', '')} · {a.get('subject', '')}")},
    "document.upload": {"entity": "document", "surfaces": ["customer360", "audit"]},
    "document.generated": {"entity": "generated_document", "surfaces": ["customer360", "audit", "documents"], "roles": ["Accounts", "Super Admin"], "title": lambda a: (f"{a.get('type', 'Document').title()} generated · {a.get('number', '')}", a.get("customer_name"))},
    "document.shared": {"entity": "generated_document", "surfaces": ["audit", "documents"]},
    "document.sent": {"entity": "generated_document", "surfaces": ["customer360", "audit", "documents"]},
    "message.queued": {"entity": "message", "surfaces": ["customer360", "audit", "messaging"]},
    "message.sent": {"entity": "message", "surfaces": ["customer360", "audit", "messaging"]},
    "message.delivered": {"entity": "message", "surfaces": ["customer360", "audit", "messaging"]},
    "message.failed": {"entity": "message", "surfaces": ["audit", "messaging", "notifications"], "roles": ["Accounts", "Super Admin"]},
    "message.not_configured": {"entity": "message", "surfaces": ["audit", "messaging"]},
    "message.skipped_no_contact": {"entity": "message", "surfaces": ["audit", "messaging"]},
    "message.skipped_no_consent": {"entity": "message", "surfaces": ["audit", "messaging"]},
    "message.retry": {"entity": "message", "surfaces": ["audit", "messaging"]},
    "reminder.sent": {"entity": "booking", "surfaces": ["customer360", "audit", "notifications", "documents"], "roles": ["Sales", "Accounts", "Super Admin"], "title": lambda a: (f"Reminder sent · {a.get('booking_number', '')} · {a.get('days_overdue', '')} days overdue", a.get("to"))},
    "reminder.skipped": {"entity": "booking", "surfaces": ["customer360", "audit", "notifications"], "roles": ["Sales", "Accounts", "Super Admin"], "title": lambda a: (f"Reminder {str(a.get('status', '')).replace('_', ' ')} · {a.get('booking_number', '')}", a.get("channel"))},
    "admin.load_test_purge": {"entity": "system", "surfaces": ["audit"], "roles": ["Super Admin"]},
    "reminders.run": {"entity": "company", "surfaces": ["audit"]},
    "company.reminders_updated": {"entity": "company", "surfaces": ["audit"]},
    "template.created": {"entity": "message_template", "surfaces": ["audit"]},
    "template.updated": {"entity": "message_template", "surfaces": ["audit"]},
    "document.voided": {"entity": "generated_document", "surfaces": ["customer360", "audit", "documents"], "roles": ["Accounts", "Super Admin"], "title": lambda a: (f"Document voided · {a.get('number', '')}", a.get("void_reason"))},
    "demand.void": {"entity": "booking", "surfaces": MONEY + ["notifications"], "roles": ["Accounts", "Super Admin"], "title": lambda a: (f"Demand voided · {a.get('demand_number', '')}", a.get("reason"))},
    "demand.reminder_sent": {"entity": "booking", "surfaces": MONEY, "title": None},
    "notice.create": {"entity": "notice", "surfaces": ["customer360", "audit", "notifications"]},
    "user.update": {"entity": "user", "surfaces": ["users", "bootstrap", "audit"]},
    "role.update": {"entity": "role", "surfaces": ["users", "bootstrap", "bundle", "audit"]},
    "catalogue.update": {"entity": "catalogue_item", "surfaces": ["bundle", "bootstrap", "audit"]},
}

ENTITY_DEFAULT_SURFACES = {
    "payment": MONEY, "demand": MONEY, "booking": MONEY + ["flats"], "refund": MONEY + ["refunds"], "flat": INVENTORY, "block": INVENTORY, "project": INVENTORY + ["bundle"],
    "customer": ["customers", "customer360", "audit"], "lead": ["leads", "home", "bootstrap", "audit"], "site_visit": ["visits", "home", "bootstrap", "audit"],
    "service_request": ["service", "audit"], "catalogue_item": ["bundle", "audit"], "notification": ["bootstrap"], "user": ["users", "bootstrap", "audit"], "role": ["bundle", "bootstrap", "audit"],
}


def spec_for(action: str | None, entity_type: str | None) -> dict:
    e = EVENTS.get(action or "")
    if not e:
        # prefix fallback: "lead.assign" -> entity defaults
        return {"event": action or f"{entity_type}.changed", "entity": entity_type, "surfaces": ENTITY_DEFAULT_SURFACES.get(entity_type or "", ["audit"]), "roles": [], "parties": [], "title": None, "registered": False}
    return {"event": action, "entity": e["entity"], "surfaces": e["surfaces"], "roles": e.get("roles", []), "parties": e.get("parties", []), "title": e.get("title"), "registered": True}


def cache_prefixes(surfaces: list[str]) -> set[str]:
    out = set()
    for s in surfaces:
        out.update(SURFACE_CACHE.get(s, ()))
    return out
