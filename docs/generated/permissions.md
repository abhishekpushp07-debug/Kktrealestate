### 3.4 Permission registry (generated from `permissions.py`)

| Group | Permission | Description |
|---|---|---|
| Administration | `users.manage` | Manage users |
| Administration | `roles.manage` | Manage roles & permissions |
| Administration | `settings.manage` | Manage company settings |
| Administration | `audit.view` | View audit log |
| Master Data | `master.read` | View master data |
| Master Data | `master.write` | Create / edit master data |
| Projects & Inventory | `project.read` | View projects |
| Projects & Inventory | `project.write` | Create / edit projects |
| Projects & Inventory | `block.write` | Create / edit blocks |
| Projects & Inventory | `flat.write` | Edit flats & pricing |
| Projects & Inventory | `flat.status` | Change flat status (Hold/Block) |
| Projects & Inventory | `construction.update` | Update tower construction status (alias: milestone.update) |
| Projects & Inventory | `construction.undo` | Undo last completed construction stage (alias: milestone.undo) |
| Customers & Leads | `customer.read` | View customers |
| Customers & Leads | `customer.write` | Create / edit customers |
| Customers & Leads | `customer.kyc_view` | View unmasked KYC (PAN/Aadhaar) |
| Customers & Leads | `lead.read` | View leads |
| Customers & Leads | `lead.write` | Create / edit leads |
| Customers & Leads | `visit.read` | View site visits |
| Customers & Leads | `visit.write` | Create / manage site visits |
| Bookings | `booking.read` | View bookings |
| Bookings | `booking.create` | Create bookings |
| Bookings | `booking.cancel` | Cancel bookings |
| Bookings | `agreement.edit` | Edit agreement values |
| Payments | `payment.read` | View payments |
| Payments | `payment.post` | Post payments |
| Payments | `payment.reverse` | Reverse payments |
| Payments | `receipt.print` | Print receipts |
| Reports & Website | `report.view` | View reports |
| Reports & Website | `cms.read` | View website CMS |
| Reports & Website | `cms.write` | Edit website CMS |
| Customer Portal & Service | `customer.portal_manage` | Manage customer portal access |
| Customer Portal & Service | `service.read` | View service requests |
| Customer Portal & Service | `service.write` | Reply / update service requests |
| Customer Portal & Service | `service.assign` | Assign service requests |

### 3.5 Role × permission matrix (6 system roles × 35 permissions)

| Permission | Super Admin | Project Admin | Accounts | Marketing | Sales | Employee |
|---|---|---|---|---|---|---|
| `users.manage` | ● |  |  |  |  |  |
| `roles.manage` | ● |  |  |  |  |  |
| `settings.manage` | ● |  |  |  |  |  |
| `audit.view` | ● |  | ● |  |  |  |
| `master.read` | ● | ● | ● | ● | ● | ● |
| `master.write` | ● |  |  |  |  |  |
| `project.read` | ● | ● | ● | ● | ● | ● |
| `project.write` | ● |  |  |  |  |  |
| `block.write` | ● | ● |  |  |  |  |
| `flat.write` | ● | ● |  |  |  |  |
| `flat.status` | ● | ● |  |  |  |  |
| `construction.update` | ● | ● |  |  |  |  |
| `construction.undo` | ● |  |  |  |  |  |
| `customer.read` | ● | ● | ● | ● | ● |  |
| `customer.write` | ● | ● |  |  | ● |  |
| `customer.kyc_view` | ● | ● | ● |  |  |  |
| `lead.read` | ● | ● |  | ● | ● |  |
| `lead.write` | ● | ● |  | ● | ● |  |
| `visit.read` | ● | ● |  | ● | ● |  |
| `visit.write` | ● | ● |  |  | ● |  |
| `booking.read` | ● | ● | ● |  | ● | ● |
| `booking.create` | ● | ● |  |  | ● |  |
| `booking.cancel` | ● | ● |  |  |  |  |
| `agreement.edit` | ● |  |  |  |  |  |
| `payment.read` | ● | ● | ● |  | ● |  |
| `payment.post` | ● |  | ● |  |  |  |
| `payment.reverse` | ● |  | ● |  |  |  |
| `receipt.print` | ● | ● | ● |  |  |  |
| `report.view` | ● | ● | ● |  |  |  |
| `cms.read` | ● |  |  | ● |  |  |
| `cms.write` | ● |  |  | ● |  |  |
| `customer.portal_manage` | ● |  | ● |  | ● |  |
| `service.read` | ● | ● | ● |  | ● | ● |
| `service.write` | ● | ● | ● |  | ● |  |
| `service.assign` | ● | ● | ● |  | ● |  |

Role scope notes:

- **Super Admin** — Full access to everything. Project scope: all projects.
- **Project Admin** — Manages project structure, inventory and sales for assigned projects. Project scope: assigned projects only.
- **Accounts** — Payments, receipts and financial reporting. Project scope: all projects.
- **Marketing** — Manages the public website, blog, gallery and enquiries. Project scope: all projects.
- **Sales** — Customers, leads and bookings. Project scope: assigned projects only.
- **Employee** — Read-only access. Project scope: assigned projects only.