// @kkt/contracts — the single source of truth for every wire shape.
// Enums, permission registry, error codes, common scalars and one file per API module.

export * from "./enums.js";
export * from "./permissions.js";
export * from "./errors.js";
export * from "./rules.js";
export * from "./common.js";
export * from "./moneyFormat.js";

export * from "./modules/auth.js";
export * from "./modules/users.js";
export * from "./modules/roles.js";
export * from "./modules/masters.js";
export * from "./modules/projects.js";
export * from "./modules/blocks.js";
export * from "./modules/flats.js";
export * from "./modules/parking.js";
export * from "./modules/rateCards.js";
export * from "./modules/customers.js";
export * from "./modules/leads.js";
export * from "./modules/paymentPlans.js";
export * from "./modules/construction.js";
export * from "./modules/bookings.js";
export * from "./modules/payments.js";
export * from "./modules/dues.js";
export * from "./modules/documents.js";
export * from "./modules/service.js";
export * from "./modules/notifications.js";
export * from "./modules/reports.js";
export * from "./modules/cms.js";
export * from "./modules/public.js";
export * from "./modules/visits.js";
export * from "./modules/portal.js";
export * from "./modules/admin.js";
export * from "./modules/system.js";
