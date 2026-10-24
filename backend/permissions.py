PERMISSION_GROUPS = [
    ("Administration", [
        ("users.manage", "Manage users"),
        ("roles.manage", "Manage roles & permissions"),
        ("settings.manage", "Manage company settings"),
        ("audit.view", "View audit log"),
    ]),
    ("Master Data", [
        ("master.read", "View master data"),
        ("master.write", "Create / edit master data"),
    ]),
    ("Projects & Inventory", [
        ("project.read", "View projects"),
        ("project.write", "Create / edit projects"),
        ("block.write", "Create / edit blocks"),
        ("flat.write", "Edit flats & pricing"),
        ("flat.status", "Change flat status (Hold/Block)"),
        ("milestone.update", "Update construction milestones"),
        ("milestone.undo", "Undo milestone completion"),
    ]),
    ("Customers & Leads", [
        ("customer.read", "View customers"),
        ("customer.write", "Create / edit customers"),
        ("customer.kyc_view", "View unmasked KYC (PAN/Aadhaar)"),
        ("lead.read", "View leads"),
        ("lead.write", "Create / edit leads"),
    ]),
    ("Bookings", [
        ("booking.read", "View bookings"),
        ("booking.create", "Create bookings"),
        ("booking.cancel", "Cancel bookings"),
        ("agreement.edit", "Edit agreement values"),
    ]),
    ("Payments", [
        ("payment.read", "View payments"),
        ("payment.post", "Post payments"),
        ("payment.reverse", "Reverse payments"),
        ("receipt.print", "Print receipts"),
    ]),
    ("Reports & Website", [
        ("report.view", "View reports"),
        ("cms.read", "View website CMS"),
        ("cms.write", "Edit website CMS"),
        ("cms.write", "Edit website content"),
    ]),
]

ALL_PERMISSIONS = [code for _, perms in PERMISSION_GROUPS for code, _ in perms]
PERMISSION_SET = set(ALL_PERMISSIONS)

SYSTEM_ROLES = {
    "Super Admin": {"description": "Full access to everything", "permissions": ALL_PERMISSIONS},
    "Project Admin": {
        "description": "Manages project structure, inventory and sales for assigned projects",
        "permissions": [
            "project.read", "master.read", "block.write", "flat.write", "flat.status", "milestone.update",
            "booking.read", "booking.create", "booking.cancel", "customer.read", "customer.write", "customer.kyc_view", "lead.read", "lead.write",
            "payment.read", "receipt.print", "report.view",
        ],
    },
    "Accounts": {
        "description": "Payments, receipts and financial reporting",
        "permissions": [
            "payment.read", "payment.post", "payment.reverse", "receipt.print", "booking.read",
            "customer.read", "customer.kyc_view", "project.read", "master.read", "report.view", "audit.view",
        ],
    },
    "Marketing": {
        "description": "Manages the public website, blog, gallery and enquiries",
        "permissions": ["cms.read", "cms.write", "lead.read", "lead.write", "project.read", "master.read", "customer.read"],
    },
    "Sales": {
        "description": "Customers, leads and bookings",
        "permissions": [
            "customer.read", "customer.write", "lead.read", "lead.write",
            "booking.read", "booking.create", "project.read", "master.read", "payment.read",
        ],
    },
    "Employee": {
        "description": "Read-only access",
        "permissions": ["project.read", "master.read", "booking.read"],
    },
}
