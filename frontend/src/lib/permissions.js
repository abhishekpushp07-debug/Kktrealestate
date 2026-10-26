// Shared permission manifest (mirrors backend permissions.py PERMISSION_META). Hierarchical module.feature.action ↔ legacy code.
export const HIER = {
  "admin.user.edit": "users.manage", "admin.role.edit": "roles.manage", "admin.settings.edit": "settings.manage", "admin.audit.view": "audit.view",
  "masters.master.view": "master.read", "masters.master.edit": "master.write", "masters.catalogue.create": "catalogue.write",
  "inventory.project.view": "project.read", "inventory.project.edit": "project.write", "inventory.block.edit": "block.write", "inventory.flat.edit": "flat.write", "inventory.flat.approve": "flat.status",
  "inventory.construction.edit": "construction.update", "inventory.construction.delete": "construction.undo",
  "crm.customer.view": "customer.read", "crm.customer.edit": "customer.write", "crm.customer.custom": "customer.kyc_view", "crm.lead.view": "lead.read", "crm.lead.edit": "lead.write", "crm.visit.view": "visit.read", "crm.visit.edit": "visit.write",
  "sales.booking.view": "booking.read", "sales.booking.create": "booking.create", "sales.booking.delete": "booking.cancel", "sales.agreement.edit": "agreement.edit",
  "finance.payment.view": "payment.read", "finance.payment.create": "payment.post", "finance.payment.delete": "payment.reverse", "finance.receipt.export": "receipt.print",
  "reports.report.view": "report.view", "website.cms.view": "cms.read", "website.cms.edit": "cms.write",
  "service.portal.edit": "customer.portal_manage", "service.ticket.view": "service.read", "service.ticket.edit": "service.write", "service.ticket.approve": "service.assign",
};
export const UI_ONLY = ["reports.collection.export"];
export const canonical = (code) => HIER[code] || code;
