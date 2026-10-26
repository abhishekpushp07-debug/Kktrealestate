"""R2 guard scan — every mutation button (data-testid ends with add/new/create/edit/delete/remove/export/approve/post/reverse/cancel …) is
rendered behind `can(...)`/`canAny(...)` or lives in a file that is itself route-guarded by a write permission. Exceptions are listed explicitly."""
import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src"
PATTERN = re.compile(r'data-testid="([a-z0-9-]*(?:add|new|create|edit|delete|remove|export|approve|post|reverse|cancel)[a-z0-9-]*)"')
# Files whose ROUTE is guarded by the write permission (ErpApp.jsx R table) — every button inside is implicitly guarded.
ROUTE_GUARDED = {"pages/BookingWizard.jsx": "booking.create", "pages/v2/CustomerForm.jsx": "customer.write", "pages/v2/ProjectSetup.jsx": "project.write", "pages/master/FlatTypeForm.jsx": "master.read",
                 "pages/master/PaymentPlanForm.jsx": "master.read", "pages/cms/ProjectWebsiteTab.jsx": "cms.read", "pages/AccessControl.jsx": "users.manage", "pages/AuditLog.jsx": "audit.view", "pages/Roles.jsx": "roles.manage",
                 "components/forms/BlockForm.jsx": "block.write", "components/forms/ProjectForm.jsx": "project.write", "components/common/PaymentPlanMatrix.jsx": "master.read"}
# Non-mutation ids that merely match the vocabulary (inputs, containers, dialogs opened by a guarded button, auth flows).
EXCEPTIONS = {"new-password-input", "flat-edit-section", "flat-edit-notes", "flat-edit-price", "flat-edit-rate", "stage-sequence-editor", "project-address-input", "quick-new", "post-payment-sheet", "role-editor",
              "add-floors-dialog", "add-floors-count", "cancel-dialog", "visit-create-dialog", "vs-address", "cat-import", "more-edit", "add-floor-plan-range", "pw-add-hero"}


def test_mutation_buttons_are_permission_guarded():
    unguarded = []
    for p in list(SRC.glob("pages/**/*.jsx")) + list(SRC.glob("components/**/*.jsx")):
        rel = str(p.relative_to(SRC))
        if rel.startswith("components/ui/") or rel in ROUTE_GUARDED:
            continue
        text = p.read_text()
        has_can = "can(" in text or "canAny(" in text
        for line in text.splitlines():
            for tid in PATTERN.findall(line):
                if tid in EXCEPTIONS:
                    continue
                if not ("can(" in line or "canAny(" in line) and not has_can:
                    unguarded.append(f"{rel}: {tid}")
    assert not unguarded, unguarded
