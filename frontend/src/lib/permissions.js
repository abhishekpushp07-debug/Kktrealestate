// Shared permission manifest — hierarchical module.feature.action codes (mirrors backend permissions.py).
// Legacy coarse codes are no longer accepted by the backend; this map lets any stray legacy call resolve to its closest specific code.
export const LEGACY = {
  "project.read": "masters.project.view", "project.write": "masters.project.edit", "block.write": "masters.tower.edit", "flat.write": "masters.flat.edit", "flat.status": "sales.hold.create",
  "customer.read": "sales.customer.view", "customer.write": "sales.customer.edit", "customer.kyc_view": "sales.kyc.reveal", "customer.portal_manage": "service.portal.manage",
  "lead.read": "sales.lead.view", "lead.write": "sales.lead.create", "visit.read": "sales.site_visit.view", "visit.write": "sales.site_visit.create",
  "booking.read": "sales.booking.view", "booking.create": "sales.booking.create", "booking.cancel": "sales.booking.cancel", "agreement.edit": "sales.agreement.revise",
  "payment.read": "finance.payment.view", "payment.post": "finance.payment.create", "payment.reverse": "finance.payment.reverse", "receipt.print": "finance.receipt.print",
  "report.view": "reports.collections.view", "cms.read": "website.cms.view", "cms.write": "website.cms.edit",
  "service.read": "service.ticket.view", "service.write": "service.ticket.edit", "service.assign": "service.ticket.assign",
  "settings.manage": "admin.settings.edit", "users.manage": "admin.user.view", "roles.manage": "admin.role.edit", "audit.view": "admin.audit.view",
  "master.read": "masters.catalogue.view", "master.write": "masters.payment_plan.edit", "catalogue.write": "masters.catalogue.create",
  "milestone.update": "construction.stage.update", "milestone.undo": "construction.stage.undo", "construction.update": "construction.stage.update", "construction.undo": "construction.stage.undo",
};
export const canonical = (code) => LEGACY[code] || code;
