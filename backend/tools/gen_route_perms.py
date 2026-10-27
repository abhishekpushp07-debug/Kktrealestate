"""Generates backend/route_perms.py: every guarded route → specific module.feature.action code(s), plus legacy expansion (for migration).
Run once (idempotent): python tools/gen_route_perms.py. Rules by file/method/path; explicit overrides win."""
import ast
import glob
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]


def routes():
    out = []
    for f in sorted(glob.glob(str(ROOT / "routers" / "*.py"))):
        t = ast.parse(open(f).read())
        for fn in [n for n in ast.walk(t) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
            for d in fn.decorator_list:
                if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in ("get", "post", "patch", "put", "delete"):
                    path = d.args[0].value if d.args else ""
                    codes = [a.value for c in ast.walk(fn.args) if isinstance(c, ast.Call) and getattr(c.func, "id", "") in ("require", "require_any") for a in c.args if isinstance(a, ast.Constant)]
                    out.append((pathlib.Path(f).stem, d.func.attr.upper(), path, fn.name, codes))
    return out


REPORT = {"collections": "collections", "outstanding": "outstanding", "advances": "outstanding", "demand-vs-collection": "demand_vs_collection", "demand-vs-collection-installment": "demand_vs_collection",
          "inventory": "inventory", "cheques": "cheque_register", "cancellations": "cancellations_refunds", "sales-leads": "lead_funnel", "roznamcha-range": "roznamcha", "bank-receipts": "bank_wise",
          "service-sla": "service_sla", "construction-progress": "construction_vs_plan", "upcoming-dues": "receivables_forecast", "activity": "audit"}

OVERRIDES = {
    "bookings:POST /{booking_id}/agreement-revisions": ("sales.agreement.revise",), "bookings:POST /{booking_id}/transfer": ("sales.booking.transfer",), "bookings:POST /{booking_id}/swap": ("sales.booking.transfer",),
    "construction:POST /bookings/{booking_id}/payment-plan": ("masters.payment_plan.assign",), "bookings:POST /{booking_id}/cancel": ("sales.booking.cancel",), "bookings:POST /{booking_id}/complete": ("sales.booking.edit",),
    "bookings:POST /{booking_id}/other-charges/demand": ("finance.demand.create",), "bookings:GET /{booking_id}/ledger": ("finance.ledger.view",), "bookings:GET /{booking_id}/cancellation-preview": ("sales.booking.cancel",),
    "bookings:GET /{booking_id}/refunds": ("finance.refund.view",), "bookings:GET /{booking_id}/demands/{demand_id}/letter": ("finance.demand.export",), "construction:GET /bookings/{booking_id}/schedule": ("sales.agreement.view",),
    "crm:GET /bookings/{booking_id}/ledgers": ("finance.ledger.view",), "crm:GET /customers/{customer_id}/ledgers": ("finance.ledger.view",), "pdfs:GET /bookings/{booking_id}/demands/{demand_id}/letter.pdf": ("finance.demand.export",),
    "pdfs:GET /bookings/{booking_id}/statement.pdf": ("finance.ledger.export",), "pdfs:GET /bookings/{booking_id}/allotment.pdf": ("sales.booking.export",), "reports:GET /statement/{booking_id}": ("finance.ledger.export",), "reports:GET /allotment/{booking_id}": ("sales.booking.export",),
    "bookings:POST /{booking_id}/recompute": ("admin.data.recompute",),
    "blocks:POST ": ("masters.tower.create",), "blocks:PATCH /{block_id}": ("masters.tower.edit",), "blocks:POST /{block_id}/generate-flats": ("masters.flat.create",), "blocks:POST /{block_id}/floors": ("masters.tower.edit",),
    "parking:POST ": ("masters.flat.create",), "parking:POST /bulk-generate": ("masters.flat.create",), "parking:PATCH /{slot_id}": ("masters.flat.edit",), "parking:GET ": ("masters.flat.view",),
    "blocks:POST /{block_id}/bulk-status": ("sales.hold.create", "sales.hold.release"), "flats:PATCH /{flat_id}/status": ("sales.hold.create", "sales.hold.release"), "blocks:POST /{block_id}/bulk-price": ("masters.flat.edit",), "flats:PATCH /{flat_id}": ("masters.flat.edit",),
    "rate_cards:POST ": ("masters.rate_card.create",), "rate_cards:PATCH /{rc_id}": ("masters.rate_card.edit",), "rate_cards:POST /{rc_id}/activate": ("masters.rate_card.edit",), "rate_cards:POST /{rc_id}/apply": ("masters.rate_card.apply",), "rate_cards:GET ": ("masters.rate_card.view",), "rate_cards:GET /{rc_id}": ("masters.rate_card.view",),
    "catalogues:POST /{ctype}/items": ("masters.catalogue.create",), "catalogues:PATCH /{ctype}/items/{item_id}": ("masters.catalogue.edit",), "catalogues:POST /{ctype}/reorder": ("masters.catalogue.edit",), "catalogues:POST /{ctype}/import": ("masters.catalogue.create",),
    "catalogues:GET ": ("masters.catalogue.view",), "catalogues:GET /{ctype}": ("masters.catalogue.view",), "catalogues:GET /{ctype}/export.csv": ("masters.catalogue.view",),
    "cms:GET /site": ("website.cms.view",), "cms:GET /{coll}": ("website.cms.view",), "cms:PATCH /site": ("website.cms.edit",), "cms:POST /media": ("website.cms.edit",), "cms:POST /{coll}": ("website.cms.edit",), "cms:PATCH /{coll}/{item_id}": ("website.cms.edit",), "cms:DELETE /{coll}/{item_id}": ("website.cms.edit",),
    "cms:GET /projects/{project_id}/website": ("website.cms.view",), "cms:PATCH /projects/{project_id}/website": ("website.cms.edit",),
    "support:GET /notices": ("construction.notice.view",), "support:POST /notices": ("construction.notice.create",), "support:PATCH /notices/{notice_id}": ("construction.notice.edit",), "support:DELETE /notices/{notice_id}": ("construction.notice.delete",),
    "construction:POST /blocks/{block_id}/construction/undo": ("construction.stage.undo",), "milestones:POST /{block_id}/milestones/{seq}/undo": ("construction.stage.undo",), "construction:POST /blocks/{block_id}/construction/stage": ("construction.stage.update",), "milestones:POST /{block_id}/milestones/{seq}/complete": ("construction.stage.update",),
    "construction:GET /blocks/{block_id}/construction": ("construction.stage.view",), "milestones:GET /{block_id}/milestones": ("construction.stage.view",), "support:GET /blocks/{block_id}/photos": ("construction.stage.view",),
    "support:POST /blocks/{block_id}/milestones/{seq}/photos": ("construction.photo.upload",), "support:PATCH /photos/{photo_id}": ("construction.photo.upload",), "support:DELETE /photos/{photo_id}": ("construction.photo.delete",), "support:PATCH /blocks/{block_id}/milestones/{seq}/note": ("construction.stage.update",),
    "construction:PATCH /projects/{project_id}/stage-sequence": ("masters.construction_stage.edit",), "construction:PATCH /blocks/{block_id}/stage-sequence": ("masters.construction_stage.edit",),
    "customers:POST /{customer_id}/kyc-status": ("sales.kyc.edit",), "customers:GET /{customer_id}/panels": ("sales.customer.view",),
    "portal:GET /{customer_id}/portal": ("service.portal.view",), "portal:POST /{customer_id}/portal/enable": ("service.portal.manage",), "portal:POST /{customer_id}/portal/toggle": ("service.portal.manage",), "portal:POST /{customer_id}/portal/revoke-sessions": ("service.portal.manage",), "portal:POST /portal/bulk-enable": ("service.portal.manage",),
    "crm:GET /communications": ("sales.customer.view",), "crm:POST /communications": ("sales.customer.edit",), "crm:PATCH /customers/{customer_id}/profile": ("sales.customer.edit",), "support:PATCH /documents/{doc_id}/share": ("sales.customer.edit",),
    "leads:GET /stages": ("sales.lead.view",), "leads:POST /{lead_id}/stage": ("sales.lead.edit",), "leads:POST /{lead_id}/follow-ups": ("sales.lead.edit",), "leads:POST /{lead_id}/convert": ("sales.lead.edit", "sales.customer.create"), "visits:GET /brochure-stats": ("sales.lead.view",),
    "imports:GET /template/{kind}": ("masters.project.view",), "imports:POST /{kind}/preview": ("masters.flat.create",), "imports:POST /{kind}/confirm": ("masters.flat.create",),
    "construction:POST /payment-plan-assignments": ("masters.payment_plan.assign",), "construction:DELETE /payment-plan-assignments/{assignment_id}": ("masters.payment_plan.assign",), "construction:GET /payment-plan-assignments": ("masters.payment_plan.view",), "construction:GET /projects/{project_id}/blocks/{block_id}/payment-plans": ("masters.payment_plan.view",),
    "payments:POST ": ("finance.payment.create",), "payments:POST /{payment_id}/clear": ("finance.cheque.clear",), "payments:POST /{payment_id}/bounce": ("finance.cheque.bounce",), "roznamcha:POST /contra": ("finance.roznamcha.deposit",), "payments:POST /{payment_id}/reverse": ("finance.payment.reverse",),
    "propagation:POST /refunds/{refund_id}/pay": ("finance.refund.pay",), "propagation:GET /refunds": ("finance.refund.view",), "payments:GET /demands": ("finance.demand.view",), "roznamcha:GET /opening": ("finance.roznamcha.view",), "roznamcha:GET ": ("finance.roznamcha.view",), "roznamcha:GET /range": ("finance.roznamcha.view",), "roznamcha:POST /opening": ("finance.roznamcha.opening_balance",),
    "customers:GET /{customer_id}/payments": ("finance.payment.view",), "payments:GET /{payment_id}/receipt": ("finance.receipt.print",), "pdfs:GET /payments/{payment_id}/receipt.pdf": ("finance.receipt.download",),
    "audit:GET /entity/{entity_type}/{entity_id}": ("admin.audit.view",), "audit:GET /export.csv": ("admin.audit.export",),
    "bootstrap:GET /dashboard/snapshot": ("masters.project.view",), "dashboard:GET ": ("masters.project.view",), "dashboard_widgets:GET /widgets": ("masters.project.view",), "home:GET /dashboard/home": ("masters.project.view",),
    "notifications:GET /unread-count": ("masters.project.view",), "notifications:GET ": ("masters.project.view",), "notifications:POST /{notification_id}/read": ("masters.project.view",), "notifications:POST /read-all": ("masters.project.view",),
    "propagation:GET /definitions": ("admin.definitions.view",), "propagation:GET /journey/{audit_id}": ("admin.audit.view",), "propagation:GET /journey/entity/{entity_type}/{entity_id}": ("admin.audit.view",),
    "projects:GET /suggest-code": ("masters.project.create",), "projects:POST ": ("masters.project.create",), "projects:PATCH /{project_id}": ("masters.project.edit",), "project_setup:PUT /{project_id}/setup/{section}": ("masters.project.edit",), "project_setup:GET /{project_id}/setup": ("masters.project.view",),
    "reports:GET ": ("reports.collections.view",), "reports:GET /presets": ("reports.collections.view",), "reports:POST /presets": ("reports.collections.view",), "reports:DELETE /presets/{preset_id}": ("reports.collections.view",), "reports:PATCH /presets/{preset_id}": ("reports.collections.view",),
    "roles:GET /roles": ("admin.role.view",), "roles:GET /permissions": ("admin.role.view",), "roles:GET /roles/{role_id}": ("admin.role.view",), "roles:POST /roles": ("admin.role.create",), "roles:PATCH /roles/{role_id}": ("admin.role.edit",), "roles:DELETE /roles/{role_id}": ("admin.role.delete",),
    "access:POST /roles/{role_id}/clone": ("admin.role.create",), "access:GET /roles/{role_id}/users": ("admin.role.view",), "access:GET /registry": ("admin.access_control.manage",), "access:GET /users/{user_id}": ("admin.access_control.manage",), "access:PUT /users/{user_id}": ("admin.access_control.manage",), "access:GET /tree": ("admin.role.view",),
    "users:GET ": ("admin.user.view",), "users:GET /{user_id}": ("admin.user.view",), "users:POST ": ("admin.user.create",), "users:PATCH /{user_id}": ("admin.user.edit", "admin.user.deactivate"), "users:POST /{user_id}/reset-password": ("admin.user.edit",),
    "support:POST /service-requests/{sr_id}/assign": ("service.ticket.assign",), "support:GET /service-requests/categories": ("service.ticket.view",), "support:POST /service-requests/{sr_id}/status": ("service.ticket.close", "service.ticket.reopen", "service.ticket.edit"), "support:POST /service-requests/{sr_id}/reply": ("service.ticket.edit",), "support:POST /service-requests": ("service.ticket.create",),
    "admin:POST /recompute-counters": ("admin.data.recompute",), "admin:POST /reconcile-ledgers": ("admin.data.recompute",), "admin:GET /reseed/status": ("admin.data.reseed",), "admin:POST /story-marker": ("admin.data.reseed",), "admin:GET /story-marker": ("admin.data.reseed",), "admin:POST /reseed": ("admin.data.reseed",),
    "admin:POST /backup": ("admin.data.backup",), "admin:GET /backups": ("admin.data.backup",), "admin:GET /backups/{backup_id}/download": ("admin.data.backup",), "admin:POST /customers/{customer_id}/erase": ("admin.data.erase",),
    "admin:GET /docs/technical.pdf": ("admin.documentation.view",), "admin:GET /docs/technical.md": ("admin.documentation.view",), "admin:POST /docs/regenerate": ("admin.documentation.view",),
    "bootstrap:POST /admin/recompute-read-models": ("admin.data.recompute",), "construction:POST /admin/run-dues": ("admin.data.recompute",), "construction:GET /admin/integrity-report": ("admin.system_health.view",), "construction:POST /admin/integrity-repair": ("admin.data.recompute",), "construction:GET /admin/migration-report": ("admin.system_health.view",),
    "ops:GET /ops": ("admin.system_health.view",), "propagation:GET /admin/propagation": ("admin.system_health.view",), "settings:GET /numbering/preview": ("admin.settings.view",), "settings:PATCH /company": ("admin.settings.edit",), "settings:GET /company": ("admin.settings.view",),
    "visits:GET /export": ("sales.site_visit.export",), "visits:POST /{visit_id}/reschedule": ("sales.site_visit.edit",), "visits:POST /{visit_id}/{action}": ("sales.site_visit.cancel", "sales.site_visit.complete", "sales.site_visit.edit"), "visits:PATCH /{visit_id}": ("sales.site_visit.edit",),
    "documents:POST ": ("sales.customer.edit",), "documents:GET ": ("sales.customer.view",), "documents:GET /{doc_id}/download": ("sales.customer.view",), "documents:DELETE /{doc_id}": ("sales.customer.delete",),
    "search:GET /search": ("masters.project.view",), "bootstrap:GET /bootstrap": ("masters.project.view",),
}
FEATURE_OF = {"booking": "sales.booking", "customer": "sales.customer", "lead": "sales.lead", "visit": "sales.site_visit", "payment": "finance.payment", "project": "masters.project", "service": "service.ticket", "flat": "masters.flat", "block": "masters.tower", "demand": "finance.demand"}


def rule(key, legacy, method, path):
    if key in OVERRIDES:
        return OVERRIDES[key]
    if legacy and all(c.count(".") == 2 for c in legacy):
        return tuple(legacy)
    f, m2 = key.split(":")[0], method
    if f == "reports":
        seg = path.strip("/").split("/")[0]
        return (f"reports.{REPORT.get(seg, seg.replace('-', '_'))}.view",)
    if f == "construction" and path.startswith("/reports/"):
        return (f"reports.{REPORT[path.split('/')[2]]}.view",)
    if f == "audit":
        return ("admin.audit.view",)
    act = {"GET": "view", "POST": "create", "PATCH": "edit", "PUT": "edit", "DELETE": "delete"}[m2]
    for lg in legacy:
        base = lg.split(".")[0]
        if base in FEATURE_OF:
            return (f"{FEATURE_OF[base]}.{act}",)
    return None


def main():
    rp, old, unmapped = {}, {}, []
    for f, m, p, fn, codes in routes():
        if f in ("auth", "public", "portal") and not codes:
            continue
        if f == "portal" and p.startswith("/portal/") and not p.startswith("/portal/bulk"):
            continue
        key = f"{f}:{m} {p}"
        new = rule(key, codes, m, p)
        if not new:
            if codes:
                unmapped.append((key, codes))
            continue
        rp[key] = {"fn": fn, "codes": list(new), "legacy": codes}
        old[key] = codes
    exp = {}
    for key, v in rp.items():
        for lg in v["legacy"]:
            exp.setdefault(lg, set()).update(v["codes"])
    out = {"ROUTE_PERMS": rp, "LEGACY_EXPANSION": {k: sorted(v) for k, v in sorted(exp.items())}}
    (ROOT / "route_perms.json").write_text(json.dumps(out, indent=1, sort_keys=True))
    print("routes", len(rp), "unmapped", unmapped)
    return rp


if __name__ == "__main__":
    main()
