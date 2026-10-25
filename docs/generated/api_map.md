## A. API map (generated from the OpenAPI specification)

Total endpoints: **396** across **39** routers. All paths are prefixed `/api`. Permission is the `require(...)` guard on the endpoint (blank = public or authenticated-only).

### admin

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/admin/backup` | settings.manage | Create Backup |
| GET | `/api/admin/backups` | settings.manage | List Backups |
| GET | `/api/admin/backups/{backup_id}/download` |  | Download Backup |
| POST | `/api/admin/customers/{customer_id}/erase` | settings.manage | Erase Customer |
| POST | `/api/admin/docs/regenerate` | settings.manage | Docs Regenerate |
| GET | `/api/admin/docs/technical.md` | settings.manage | Docs Md |
| GET | `/api/admin/docs/technical.pdf` | settings.manage | Docs Pdf |
| POST | `/api/admin/recompute-counters` | settings.manage | Recompute Counters |
| POST | `/api/admin/reconcile-ledgers` | settings.manage | Reconcile |
| POST | `/api/admin/reseed` | settings.manage | Reseed |

### audit

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/audit-logs` |  | List Audit Logs |
| GET | `/api/audit-logs/entity-types` | audit.view | Entity Types |
| GET | `/api/audit-logs/entity/{entity_type}/{entity_id}` | project.read | Entity History |
| GET | `/api/audit-logs/login-events` | audit.view | Login Events |

### auth

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/auth/change-password` |  | Change Password |
| POST | `/api/auth/login` |  | Login |
| POST | `/api/auth/login/mfa` |  | Login Mfa |
| POST | `/api/auth/logout` |  | Logout |
| GET | `/api/auth/me` |  | Me |
| POST | `/api/auth/mfa/disable` |  | Mfa Disable |
| POST | `/api/auth/mfa/enroll` |  | Mfa Enroll |
| POST | `/api/auth/mfa/verify` |  | Mfa Verify |
| POST | `/api/auth/refresh` |  | Refresh |
| DELETE | `/api/auth/sessions` |  | Revoke All Sessions |
| GET | `/api/auth/sessions` |  | Sessions |
| DELETE | `/api/auth/sessions/{session_id}` |  | Revoke Session |

### blocks

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/blocks` |  | List Blocks |
| POST | `/api/blocks` |  | Create Block |
| GET | `/api/blocks/{block_id}` | project.read | Get Block |
| PATCH | `/api/blocks/{block_id}` | block.write | Update Block |
| POST | `/api/blocks/{block_id}/bulk-price` | flat.write | Bulk Price |
| POST | `/api/blocks/{block_id}/bulk-status` | flat.status | Bulk Status |
| POST | `/api/blocks/{block_id}/floors` | block.write | Add Floors |
| POST | `/api/blocks/{block_id}/generate-flats` | block.write | Regenerate Flats |
| GET | `/api/blocks/{block_id}/grid` | project.read | Block Grid |

### bookings

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/bookings` |  | List Bookings |
| POST | `/api/bookings` |  | Create Booking |
| GET | `/api/bookings/{booking_id}` | booking.read | Get Booking |
| POST | `/api/bookings/{booking_id}/agreement-revisions` | agreement.edit | Revise Agreement |
| POST | `/api/bookings/{booking_id}/cancel` | booking.cancel | Cancel Booking |
| POST | `/api/bookings/{booking_id}/complete` | booking.create | Complete Booking |
| GET | `/api/bookings/{booking_id}/demands/{demand_id}/letter` | booking.read | Demand Letter |
| GET | `/api/bookings/{booking_id}/ledger` | booking.read | Ledger |
| POST | `/api/bookings/{booking_id}/other-charges/demand` | booking.create | Demand Other Charge |
| POST | `/api/bookings/{booking_id}/recompute` | settings.manage | Recompute |

### bootstrap

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/admin/recompute-read-models` | settings.manage | Recompute |
| GET | `/api/blocks/{block_id}/summary` | payment.read | Block Summary |
| GET | `/api/bootstrap` |  | Bootstrap |
| GET | `/api/customers/{customer_id}/summary` | payment.read | Customer Summary |
| GET | `/api/dashboard/snapshot` | project.read | Dashboard Snapshot |
| GET | `/api/projects/{project_id}/summary` | payment.read | Project Summary |

### catalogues

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/catalogues` |  | Get Bundle |
| GET | `/api/catalogues/{ctype}` |  | Get Type |
| GET | `/api/catalogues/{ctype}/export.csv` |  | Export Csv |
| POST | `/api/catalogues/{ctype}/import` | catalogue.write | Import Csv |
| POST | `/api/catalogues/{ctype}/items` | catalogue.write | Add Item |
| PATCH | `/api/catalogues/{ctype}/items/{item_id}` | catalogue.write | Patch Item |
| POST | `/api/catalogues/{ctype}/reorder` | catalogue.write | Reorder |

### cms

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/cms/media` | cms.write | Upload Media |
| GET | `/api/cms/projects/{project_id}/website` | project.read | Project Website |
| PATCH | `/api/cms/projects/{project_id}/website` | project.write | Update Project Website |
| GET | `/api/cms/site` | cms.read | Site |
| PATCH | `/api/cms/site` | cms.write | Update Site |
| GET | `/api/cms/{coll}` | cms.read | List Items |
| POST | `/api/cms/{coll}` | cms.write | Create Item |
| DELETE | `/api/cms/{coll}/{item_id}` | cms.write | Delete Item |
| PATCH | `/api/cms/{coll}/{item_id}` | cms.write | Update Item |

### construction

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/admin/integrity-repair` | settings.manage | Integrity Repair Route |
| GET | `/api/admin/integrity-report` | settings.manage | Integrity Report Route |
| GET | `/api/admin/migration-report` | settings.manage | Migration Report |
| POST | `/api/admin/run-dues` | settings.manage | Run Dues |
| GET | `/api/blocks/{block_id}/construction` | project.read | Block Construction |
| POST | `/api/blocks/{block_id}/construction/stage` | construction.update | Set Current Stage |
| POST | `/api/blocks/{block_id}/construction/undo` | construction.undo | Undo Stage |
| PATCH | `/api/blocks/{block_id}/stage-sequence` | project.write | Set Block Sequence |
| POST | `/api/bookings/{booking_id}/payment-plan` | agreement.edit | Change Booking Plan |
| GET | `/api/bookings/{booking_id}/schedule` | booking.read | Booking Schedule |
| GET | `/api/payment-plan-assignments` | project.read | List Assignments |
| POST | `/api/payment-plan-assignments` | master.write | Assign Plan |
| DELETE | `/api/payment-plan-assignments/{assignment_id}` | master.write | Unassign Plan |
| GET | `/api/projects/{project_id}/blocks/{block_id}/payment-plans` | project.read | Block Payment Plans |
| PATCH | `/api/projects/{project_id}/stage-sequence` | project.write | Set Project Sequence |
| GET | `/api/reports/upcoming-dues` | report.view | Upcoming Dues |

### crm

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/bookings/{booking_id}/ledgers` | booking.read | Booking Three Ledgers |
| GET | `/api/communications` | customer.read | List Communications |
| POST | `/api/communications` | customer.write | Log Communication |
| GET | `/api/customers/{customer_id}/ledgers` | booking.read | Customer Three Ledgers |
| PATCH | `/api/customers/{customer_id}/profile` | customer.write | Update Profile |
| GET | `/api/customers/{customer_id}/timeline` | customer.read | Customer Timeline |

### customers

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/customers` |  | List Customers |
| POST | `/api/customers` |  | Create Customer |
| GET | `/api/customers/rm-options` | customer.read | Rm Options |
| GET | `/api/customers/{customer_id}` | customer.read | Get Customer |
| PATCH | `/api/customers/{customer_id}` | customer.write | Update Customer |
| POST | `/api/customers/{customer_id}/kyc-status` | customer.kyc_view | Set Kyc Status |
| GET | `/api/customers/{customer_id}/payments` | payment.read | Customer Payments |

### dashboard

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/dashboard` |  | Dashboard |
| GET | `/api/dashboard/widgets` | project.read | Widgets |

### documents

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/documents` |  | List Documents |
| POST | `/api/documents` |  | Upload |
| DELETE | `/api/documents/{doc_id}` |  | Soft Delete |
| GET | `/api/documents/{doc_id}/download` |  | Download |

### flats

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/flats` |  | List Flats |
| GET | `/api/flats/{flat_id}` | project.read | Get Flat |
| PATCH | `/api/flats/{flat_id}` | flat.write | Update Flat |
| PATCH | `/api/flats/{flat_id}/status` | flat.status | Change Status |

### home

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/dashboard/home` | project.read | Home |

### imports

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/imports/template/{kind}` | master.read | Template |
| POST | `/api/imports/{kind}/confirm` | master.write | Confirm |
| POST | `/api/imports/{kind}/preview` | master.write | Preview |

### leads

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/leads` |  | List Leads |
| POST | `/api/leads` |  | Create Lead |
| GET | `/api/leads/board` | lead.read | Board |
| GET | `/api/leads/stages` | lead.read | Stages |
| GET | `/api/leads/{lead_id}` | lead.read | Get Lead |
| PATCH | `/api/leads/{lead_id}` | lead.write | Update Lead |
| POST | `/api/leads/{lead_id}/convert` | lead.write | Convert |
| POST | `/api/leads/{lead_id}/follow-ups` | lead.write | Add Follow Up |
| POST | `/api/leads/{lead_id}/stage` | lead.write | Move Stage |

### master

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/master/amenities` |  | List Amenities |
| POST | `/api/master/amenities` |  | Create Amenities |
| GET | `/api/master/amenities/{item_id}` |  | Get Amenities |
| PATCH | `/api/master/amenities/{item_id}` |  | Update Amenities |
| POST | `/api/master/amenities/{item_id}/activate` |  | Activate Amenities |
| POST | `/api/master/amenities/{item_id}/deactivate` |  | Deactivate Amenities |
| POST | `/api/master/amenities/{item_id}/restore` |  | Restore Amenities |
| GET | `/api/master/area-types` |  | List Area Types |
| POST | `/api/master/area-types` |  | Create Area Types |
| GET | `/api/master/area-types/{item_id}` |  | Get Area Types |
| PATCH | `/api/master/area-types/{item_id}` |  | Update Area Types |
| POST | `/api/master/area-types/{item_id}/activate` |  | Activate Area Types |
| POST | `/api/master/area-types/{item_id}/deactivate` |  | Deactivate Area Types |
| POST | `/api/master/area-types/{item_id}/restore` |  | Restore Area Types |
| GET | `/api/master/bank-accounts` |  | List Bank Accounts |
| POST | `/api/master/bank-accounts` |  | Create Bank Accounts |
| GET | `/api/master/bank-accounts/{item_id}` |  | Get Bank Accounts |
| PATCH | `/api/master/bank-accounts/{item_id}` |  | Update Bank Accounts |
| POST | `/api/master/bank-accounts/{item_id}/activate` |  | Activate Bank Accounts |
| POST | `/api/master/bank-accounts/{item_id}/deactivate` |  | Deactivate Bank Accounts |
| POST | `/api/master/bank-accounts/{item_id}/restore` |  | Restore Bank Accounts |
| GET | `/api/master/block-types` |  | List Block Types |
| POST | `/api/master/block-types` |  | Create Block Types |
| GET | `/api/master/block-types/{item_id}` |  | Get Block Types |
| PATCH | `/api/master/block-types/{item_id}` |  | Update Block Types |
| POST | `/api/master/block-types/{item_id}/activate` |  | Activate Block Types |
| POST | `/api/master/block-types/{item_id}/deactivate` |  | Deactivate Block Types |
| POST | `/api/master/block-types/{item_id}/restore` |  | Restore Block Types |
| GET | `/api/master/charge-types` |  | List Charge Types |
| POST | `/api/master/charge-types` |  | Create Charge Types |
| GET | `/api/master/charge-types/{item_id}` |  | Get Charge Types |
| PATCH | `/api/master/charge-types/{item_id}` |  | Update Charge Types |
| POST | `/api/master/charge-types/{item_id}/activate` |  | Activate Charge Types |
| POST | `/api/master/charge-types/{item_id}/deactivate` |  | Deactivate Charge Types |
| POST | `/api/master/charge-types/{item_id}/restore` |  | Restore Charge Types |
| GET | `/api/master/construction-stages` |  | List Construction Stages |
| POST | `/api/master/construction-stages` |  | Create Construction Stages |
| GET | `/api/master/construction-stages/{item_id}` |  | Get Construction Stages |
| PATCH | `/api/master/construction-stages/{item_id}` |  | Update Construction Stages |
| POST | `/api/master/construction-stages/{item_id}/activate` |  | Activate Construction Stages |
| POST | `/api/master/construction-stages/{item_id}/deactivate` |  | Deactivate Construction Stages |
| POST | `/api/master/construction-stages/{item_id}/restore` |  | Restore Construction Stages |
| GET | `/api/master/document-types` |  | List Document Types |
| POST | `/api/master/document-types` |  | Create Document Types |
| GET | `/api/master/document-types/{item_id}` |  | Get Document Types |
| PATCH | `/api/master/document-types/{item_id}` |  | Update Document Types |
| POST | `/api/master/document-types/{item_id}/activate` |  | Activate Document Types |
| POST | `/api/master/document-types/{item_id}/deactivate` |  | Deactivate Document Types |
| POST | `/api/master/document-types/{item_id}/restore` |  | Restore Document Types |
| GET | `/api/master/flat-types` |  | List Flat Types |
| POST | `/api/master/flat-types` |  | Create Flat Types |
| GET | `/api/master/flat-types/{item_id}` |  | Get Flat Types |
| PATCH | `/api/master/flat-types/{item_id}` |  | Update Flat Types |
| POST | `/api/master/flat-types/{item_id}/activate` |  | Activate Flat Types |
| POST | `/api/master/flat-types/{item_id}/deactivate` |  | Deactivate Flat Types |
| POST | `/api/master/flat-types/{item_id}/restore` |  | Restore Flat Types |
| GET | `/api/master/floor-plan-templates` |  | List Floor Plan Templates |
| POST | `/api/master/floor-plan-templates` |  | Create Floor Plan Templates |
| GET | `/api/master/floor-plan-templates/{item_id}` |  | Get Floor Plan Templates |
| PATCH | `/api/master/floor-plan-templates/{item_id}` |  | Update Floor Plan Templates |
| POST | `/api/master/floor-plan-templates/{item_id}/activate` |  | Activate Floor Plan Templates |
| POST | `/api/master/floor-plan-templates/{item_id}/deactivate` |  | Deactivate Floor Plan Templates |
| POST | `/api/master/floor-plan-templates/{item_id}/restore` |  | Restore Floor Plan Templates |
| GET | `/api/master/payment-modes` |  | List Payment Modes |
| POST | `/api/master/payment-modes` |  | Create Payment Modes |
| GET | `/api/master/payment-modes/{item_id}` |  | Get Payment Modes |
| PATCH | `/api/master/payment-modes/{item_id}` |  | Update Payment Modes |
| POST | `/api/master/payment-modes/{item_id}/activate` |  | Activate Payment Modes |
| POST | `/api/master/payment-modes/{item_id}/deactivate` |  | Deactivate Payment Modes |
| POST | `/api/master/payment-modes/{item_id}/restore` |  | Restore Payment Modes |
| GET | `/api/master/payment-plans` |  | List Payment Plans |
| POST | `/api/master/payment-plans` |  | Create Payment Plans |
| GET | `/api/master/payment-plans/{item_id}` |  | Get Payment Plans |
| PATCH | `/api/master/payment-plans/{item_id}` |  | Update Payment Plans |
| POST | `/api/master/payment-plans/{item_id}/activate` |  | Activate Payment Plans |
| POST | `/api/master/payment-plans/{item_id}/deactivate` |  | Deactivate Payment Plans |
| POST | `/api/master/payment-plans/{item_id}/restore` |  | Restore Payment Plans |
| GET | `/api/master/plc-types` |  | List Plc Types |
| POST | `/api/master/plc-types` |  | Create Plc Types |
| GET | `/api/master/plc-types/{item_id}` |  | Get Plc Types |
| PATCH | `/api/master/plc-types/{item_id}` |  | Update Plc Types |
| POST | `/api/master/plc-types/{item_id}/activate` |  | Activate Plc Types |
| POST | `/api/master/plc-types/{item_id}/deactivate` |  | Deactivate Plc Types |
| POST | `/api/master/plc-types/{item_id}/restore` |  | Restore Plc Types |
| GET | `/api/master/room-types` |  | List Room Types |
| POST | `/api/master/room-types` |  | Create Room Types |
| GET | `/api/master/room-types/{item_id}` |  | Get Room Types |
| PATCH | `/api/master/room-types/{item_id}` |  | Update Room Types |
| POST | `/api/master/room-types/{item_id}/activate` |  | Activate Room Types |
| POST | `/api/master/room-types/{item_id}/deactivate` |  | Deactivate Room Types |
| POST | `/api/master/room-types/{item_id}/restore` |  | Restore Room Types |
| GET | `/api/master/spec-categories` |  | List Spec Categories |
| POST | `/api/master/spec-categories` |  | Create Spec Categories |
| GET | `/api/master/spec-categories/{item_id}` |  | Get Spec Categories |
| PATCH | `/api/master/spec-categories/{item_id}` |  | Update Spec Categories |
| POST | `/api/master/spec-categories/{item_id}/activate` |  | Activate Spec Categories |
| POST | `/api/master/spec-categories/{item_id}/deactivate` |  | Deactivate Spec Categories |
| POST | `/api/master/spec-categories/{item_id}/restore` |  | Restore Spec Categories |
| GET | `/api/master/spec-items` |  | List Spec Items |
| POST | `/api/master/spec-items` |  | Create Spec Items |
| GET | `/api/master/spec-items/{item_id}` |  | Get Spec Items |
| PATCH | `/api/master/spec-items/{item_id}` |  | Update Spec Items |
| POST | `/api/master/spec-items/{item_id}/activate` |  | Activate Spec Items |
| POST | `/api/master/spec-items/{item_id}/deactivate` |  | Deactivate Spec Items |
| POST | `/api/master/spec-items/{item_id}/restore` |  | Restore Spec Items |

### milestones (legacy alias)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/blocks/{block_id}/milestones` | project.read | List Milestones |
| POST | `/api/blocks/{block_id}/milestones/{seq}/complete` | construction.update | Complete Milestone |
| POST | `/api/blocks/{block_id}/milestones/{seq}/undo` | construction.undo | Undo Milestone |

### notifications

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/notifications` |  | List Notifications |
| POST | `/api/notifications/read-all` | project.read | Mark All Read |
| GET | `/api/notifications/unread-count` | project.read | Unread Count |
| POST | `/api/notifications/{notification_id}/read` | project.read | Mark Read |

### parking

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/parking` |  | List Slots |
| POST | `/api/parking` |  | Create Slot |
| POST | `/api/parking/bulk-generate` | block.write | Bulk Generate |
| PATCH | `/api/parking/{slot_id}` | block.write | Update Slot |

### payments

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/payments` |  | List Payments |
| POST | `/api/payments` |  | Post Payment |
| GET | `/api/payments/cheques-in-hand` | payment.read | Cheques In Hand |
| GET | `/api/payments/demands` | payment.read | List Open Demands |
| GET | `/api/payments/summary` | payment.read | Payments Summary |
| GET | `/api/payments/{payment_id}` | payment.read | Get Payment |
| POST | `/api/payments/{payment_id}/bounce` | payment.post | Bounce Payment |
| POST | `/api/payments/{payment_id}/clear` | payment.post | Clear Payment |
| GET | `/api/payments/{payment_id}/receipt` | receipt.print | Receipt |
| POST | `/api/payments/{payment_id}/reverse` | payment.reverse | Reverse Payment |

### pdf

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/bookings/{booking_id}/demands/{demand_id}/letter.pdf` | booking.read | Demand Letter Pdf |
| GET | `/api/payments/{payment_id}/receipt.pdf` | receipt.print | Receipt Pdf |

### portal

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/portal/auth/change-password` |  | Change Password |
| POST | `/api/portal/auth/login` |  | Login |
| POST | `/api/portal/auth/logout` |  | Logout |
| POST | `/api/portal/auth/logout-all` |  | Logout All |
| GET | `/api/portal/auth/me` |  | Me |
| POST | `/api/portal/auth/refresh` |  | Refresh |
| GET | `/api/portal/bank-details` |  | Bank Details |
| GET | `/api/portal/bookings` |  | My Bookings |
| GET | `/api/portal/bookings/{booking_id}` | booking.read | Booking Detail |
| GET | `/api/portal/bookings/{booking_id}/allotment.pdf` |  | Allotment Pdf |
| GET | `/api/portal/bookings/{booking_id}/construction` |  | Booking Construction |
| GET | `/api/portal/bookings/{booking_id}/demands` | payment.read | Booking Demands |
| GET | `/api/portal/bookings/{booking_id}/demands/{demand_id}/letter.pdf` | booking.read | Demand Pdf |
| GET | `/api/portal/bookings/{booking_id}/documents` |  | Booking Documents |
| GET | `/api/portal/bookings/{booking_id}/documents/{doc_id}/download` |  | Booking Document Download |
| GET | `/api/portal/bookings/{booking_id}/ledger` | booking.read | Booking Ledger |
| GET | `/api/portal/bookings/{booking_id}/payments` |  | Booking Payments |
| GET | `/api/portal/bookings/{booking_id}/payments/{payment_id}/receipt.pdf` | receipt.print | Receipt Pdf |
| GET | `/api/portal/bookings/{booking_id}/schedule` | booking.read | Booking Schedule |
| GET | `/api/portal/bookings/{booking_id}/statement.pdf` |  | Statement Pdf |
| POST | `/api/portal/change-password` |  | Change Password |
| GET | `/api/portal/config` |  | Portal Config |
| GET | `/api/portal/me` |  | Me |
| PATCH | `/api/portal/me` |  | Update Me |
| GET | `/api/portal/notices` | cms.read | Notices |
| POST | `/api/portal/notices/{notice_id}/read` |  | Read Notice |
| GET | `/api/portal/notifications` |  | Portal Notifications |
| POST | `/api/portal/notifications/read-all` | project.read | Portal Read All |
| GET | `/api/portal/notifications/unread-count` | project.read | Portal Unread |
| POST | `/api/portal/notifications/{notification_id}/read` | project.read | Portal Read One |
| GET | `/api/portal/service-categories` |  | Sr Categories |
| GET | `/api/portal/service-requests` | service.read | My Requests |
| POST | `/api/portal/service-requests` | service.write | Create Request |
| GET | `/api/portal/service-requests/{sr_id}` | service.read | My Request |
| GET | `/api/portal/service-requests/{sr_id}/attachments/{idx}` | service.read | My Request Attachment |
| POST | `/api/portal/service-requests/{sr_id}/rate` |  | Rate Request |
| POST | `/api/portal/service-requests/{sr_id}/reopen` |  | Reopen Request |
| POST | `/api/portal/service-requests/{sr_id}/reply` | service.write | Reply Request |

### portal-admin

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/customers/portal/bulk-enable` |  | Portal Bulk Enable |
| GET | `/api/customers/{customer_id}/portal` |  | Portal Status |
| POST | `/api/customers/{customer_id}/portal/enable` |  | Portal Enable |
| POST | `/api/customers/{customer_id}/portal/revoke-sessions` |  | Portal Revoke |
| POST | `/api/customers/{customer_id}/portal/toggle` |  | Portal Toggle |

### project-setup

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/projects/{project_id}/setup` | project.read | Get Setup |
| PUT | `/api/projects/{project_id}/setup/{section}` | project.write | Save Section |

### projects

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/projects` |  | List Projects |
| POST | `/api/projects` |  | Create Project |
| GET | `/api/projects/suggest-code` | project.write | Suggest Code |
| GET | `/api/projects/{project_id}` | project.read | Get Project |
| PATCH | `/api/projects/{project_id}` | project.write | Update Project |

### public

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/public/brochure/{doc_id}` |  | Brochure |
| POST | `/api/public/enquiries` |  | Enquiry |
| GET | `/api/public/flat-types` |  | Flat Types |
| GET | `/api/public/gallery` |  | Gallery |
| GET | `/api/public/home` |  | Home |
| GET | `/api/public/media/photo/{photo_id}` |  | Construction Photo |
| GET | `/api/public/media/{media_id}` |  | Media |
| GET | `/api/public/pages/{slug}` |  | Page |
| GET | `/api/public/posts` |  | Posts |
| GET | `/api/public/posts/{slug}` |  | Post |
| GET | `/api/public/projects` |  | Projects |
| GET | `/api/public/projects/{slug}` |  | Project Detail |
| GET | `/api/public/published-projects` |  | Published Projects |
| GET | `/api/public/robots.txt` |  | Robots |
| GET | `/api/public/site` | cms.read | Site |
| GET | `/api/public/sitemap.xml` |  | Sitemap |

### public (visits & brochure)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/public/brochure-requests` |  | Brochure Request |
| GET | `/api/public/brochure/{token}` |  | Brochure Download |
| POST | `/api/public/site-visits` |  | Public Book |
| GET | `/api/public/site-visits/availability` | visit.read | Public Availability |
| GET | `/api/public/site-visits/{token}` |  | Visit Public Detail |
| GET | `/api/public/site-visits/{token}.ics` |  | Visit Ics |
| POST | `/api/public/site-visits/{token}/cancel` |  | Visit Public Cancel |

### rate-cards

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/projects/{project_id}/rate-cards` |  | List Rate Cards |
| POST | `/api/projects/{project_id}/rate-cards` |  | Create Rate Card |
| GET | `/api/projects/{project_id}/rate-cards/{rc_id}` | project.read | Get Rate Card |
| PATCH | `/api/projects/{project_id}/rate-cards/{rc_id}` | flat.write | Update Rate Card |
| POST | `/api/projects/{project_id}/rate-cards/{rc_id}/activate` | flat.write | Activate Rate Card |
| POST | `/api/projects/{project_id}/rate-cards/{rc_id}/apply` | flat.write | Apply Rate Card |

### reports

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/reports` |  | List Reports |
| GET | `/api/reports/activity` | audit.view | Activity |
| GET | `/api/reports/advances` | report.view | Advances |
| GET | `/api/reports/allotment/{booking_id}` | booking.read | Allotment |
| GET | `/api/reports/bank-receipts` | report.view | Bank Receipts |
| GET | `/api/reports/cancellations` | report.view | Cancellations |
| GET | `/api/reports/cheques` | report.view | Cheques |
| GET | `/api/reports/collections` | report.view | Collections |
| GET | `/api/reports/construction-progress` | report.view | Construction Progress |
| GET | `/api/reports/demand-vs-collection` | report.view | Demand Vs Collection |
| GET | `/api/reports/demand-vs-collection-installment` |  | Demand Vs Collection |
| GET | `/api/reports/inventory` | report.view | Inventory |
| GET | `/api/reports/outstanding` | report.view | Outstanding |
| GET | `/api/reports/presets` | report.view | List Presets |
| POST | `/api/reports/presets` | report.view | Create Preset |
| DELETE | `/api/reports/presets/{preset_id}` | report.view | Delete Preset |
| PATCH | `/api/reports/presets/{preset_id}` | report.view | Rename Preset |
| GET | `/api/reports/roznamcha-range` | report.view | Roznamcha Range |
| GET | `/api/reports/sales-leads` | report.view | Sales Leads |
| GET | `/api/reports/service-sla` | report.view | Service Sla |
| GET | `/api/reports/statement/{booking_id}` | booking.read | Statement |

### roles

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/permissions` |  | List Permissions |
| GET | `/api/roles` |  | List Roles |
| POST | `/api/roles` | roles.manage | Create Role |
| DELETE | `/api/roles/{role_id}` | roles.manage | Delete Role |
| GET | `/api/roles/{role_id}` | roles.manage | Get Role |
| PATCH | `/api/roles/{role_id}` | roles.manage | Update Role |

### roznamcha

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/roznamcha` |  | Day Book |
| POST | `/api/roznamcha/contra` | payment.post | Contra |
| GET | `/api/roznamcha/range` | payment.read | Day Book Range |

### search

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/search` |  | Global Search |

### settings

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/settings/company` |  | Get Company |
| PATCH | `/api/settings/company` | settings.manage | Update Company |
| GET | `/api/settings/numbering/preview` | settings.manage | Numbering Preview |

### site visits

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/site-visits` |  | List Visits |
| POST | `/api/site-visits` |  | Erp Create |
| GET | `/api/site-visits/availability` | visit.read | Erp Availability |
| GET | `/api/site-visits/brochure-stats` | lead.read | Brochure Stats |
| GET | `/api/site-visits/calendar` | visit.read | Calendar |
| GET | `/api/site-visits/export` | visit.read | Export Visits |
| GET | `/api/site-visits/today` | visit.read | Today Visits |
| PATCH | `/api/site-visits/{visit_id}` | visit.write | Visit Notes |
| POST | `/api/site-visits/{visit_id}/reschedule` | visit.write | Reschedule |
| POST | `/api/site-visits/{visit_id}/{action}` | visit.write | Visit Action |

### support

| Method | Path | Permission | Purpose |
|---|---|---|---|
| PATCH | `/api/blocks/{block_id}/milestones/{seq}/note` | milestone.update | Milestone Note |
| POST | `/api/blocks/{block_id}/milestones/{seq}/photos` | milestone.update | Upload Photos |
| GET | `/api/blocks/{block_id}/photos` | project.read | List Photos |
| PATCH | `/api/documents/{doc_id}/share` | customer.write | Share Document |
| GET | `/api/notices` | cms.read | List Notices |
| POST | `/api/notices` | cms.write | Create Notice |
| DELETE | `/api/notices/{notice_id}` | cms.write | Delete Notice |
| PATCH | `/api/notices/{notice_id}` | cms.write | Update Notice |
| DELETE | `/api/photos/{photo_id}` | milestone.update | Delete Photo |
| PATCH | `/api/photos/{photo_id}` | milestone.update | Patch Photo |
| GET | `/api/service-requests` | service.read | List Sr |
| POST | `/api/service-requests` | service.write | Create Sr |
| GET | `/api/service-requests/categories` | service.read | Sr Categories |
| GET | `/api/service-requests/{sr_id}` | service.read | Get Sr |
| POST | `/api/service-requests/{sr_id}/assign` | service.assign | Assign Sr |
| GET | `/api/service-requests/{sr_id}/attachments/{idx}` | service.read | Sr Attachment |
| POST | `/api/service-requests/{sr_id}/reply` | service.write | Reply Sr |
| POST | `/api/service-requests/{sr_id}/status` | service.write | Status Sr |

### system

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/health` |  | Health |
| GET | `/api/metrics` |  | Metrics |
| GET | `/api/ready` |  | Ready |

### users

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/users` |  | List Users |
| POST | `/api/users` |  | Create User |
| GET | `/api/users/{user_id}` | users.manage | Get User |
| PATCH | `/api/users/{user_id}` | users.manage | Update User |
| POST | `/api/users/{user_id}/reset-password` | users.manage | Reset Password |
