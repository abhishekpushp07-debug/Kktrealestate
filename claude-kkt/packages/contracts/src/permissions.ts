import { z } from "zod";

/** Every fine-grained permission code known to the system (SPEC §1). */
export const ALL_PERMISSIONS = [
  // administration
  "users.manage",
  "roles.manage",
  "settings.manage",
  "audit.view",
  "admin.tools",
  // masters
  "master.read",
  "master.write",
  // inventory
  "project.read",
  "project.write",
  "block.write",
  "flat.write",
  "flat.status",
  "parking.write",
  "rate_card.write",
  // construction
  "construction.update",
  "construction.undo",
  // customers
  "customer.read",
  "customer.write",
  "customer.kyc_view",
  "customer.portal_manage",
  // leads & visits
  "lead.read",
  "lead.write",
  "visit.read",
  "visit.write",
  // bookings
  "booking.read",
  "booking.create",
  "booking.cancel",
  "booking.complete",
  "agreement.edit",
  "plan.manage",
  // money
  "payment.read",
  "payment.post",
  "payment.clear",
  "payment.reverse",
  "receipt.print",
  // reporting
  "report.view",
  "dashboard.view",
  // content
  "cms.read",
  "cms.write",
  // documents
  "document.read",
  "document.write",
  // service desk
  "service.read",
  "service.write",
  "service.assign",
  // notifications
  "notification.read",
] as const;

/** A permission code literal. */
export type Permission = (typeof ALL_PERMISSIONS)[number];

/** Zod schema accepting exactly one known permission code. */
export const PermissionSchema = z.enum(ALL_PERMISSIONS);

/** Zod schema for a list of distinct permission codes. */
export const PermissionListSchema = z
  .array(PermissionSchema)
  .refine((codes) => new Set(codes).size === codes.length, { message: "Duplicate permission codes" });

export interface PermissionDefinition {
  readonly code: Permission;
  readonly label: string;
}

export interface PermissionGroup {
  readonly key: string;
  readonly label: string;
  readonly permissions: readonly PermissionDefinition[];
}

/** Permissions grouped for the role editor UI. Every code in ALL_PERMISSIONS appears exactly once. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    key: "administration",
    label: "Administration",
    permissions: [
      { code: "users.manage", label: "Manage users and project scopes" },
      { code: "roles.manage", label: "Manage roles" },
      { code: "settings.manage", label: "Manage company settings" },
      { code: "audit.view", label: "View audit log" },
      { code: "admin.tools", label: "Admin tools (backup, reseed, integrity, recompute, erasure)" },
    ],
  },
  {
    key: "masters",
    label: "Master data",
    permissions: [
      { code: "master.read", label: "View master data" },
      { code: "master.write", label: "Create, edit, deactivate master data" },
    ],
  },
  {
    key: "inventory",
    label: "Projects & inventory",
    permissions: [
      { code: "project.read", label: "View projects, blocks, flats" },
      { code: "project.write", label: "Create and edit projects" },
      { code: "block.write", label: "Create and edit blocks, generate flats" },
      { code: "flat.write", label: "Edit flat details and prices" },
      { code: "flat.status", label: "Change flat status (Available / Hold / Blocked)" },
      { code: "parking.write", label: "Manage parking inventory" },
      { code: "rate_card.write", label: "Manage rate cards and apply pricing" },
    ],
  },
  {
    key: "construction",
    label: "Construction",
    permissions: [
      { code: "construction.update", label: "Update tower construction status and photos" },
      { code: "construction.undo", label: "Undo the latest completed stage" },
    ],
  },
  {
    key: "customers",
    label: "Customers & KYC",
    permissions: [
      { code: "customer.read", label: "View customers (masked KYC)" },
      { code: "customer.write", label: "Create and edit customers" },
      { code: "customer.kyc_view", label: "Reveal unmasked KYC (audited)" },
      { code: "customer.portal_manage", label: "Manage customer portal access" },
    ],
  },
  {
    key: "leads",
    label: "Leads & site visits",
    permissions: [
      { code: "lead.read", label: "View leads and enquiries inbox" },
      { code: "lead.write", label: "Create, edit, move and convert leads" },
      { code: "visit.read", label: "View site visits" },
      { code: "visit.write", label: "Create, reschedule and close site visits" },
    ],
  },
  {
    key: "bookings",
    label: "Bookings",
    permissions: [
      { code: "booking.read", label: "View bookings, ledgers and schedules" },
      { code: "booking.create", label: "Create bookings" },
      { code: "booking.cancel", label: "Cancel bookings" },
      { code: "booking.complete", label: "Complete / hand over bookings" },
      { code: "agreement.edit", label: "Revise agreement values" },
      { code: "plan.manage", label: "Manage payment plans and tower assignments" },
    ],
  },
  {
    key: "payments",
    label: "Payments & ledger",
    permissions: [
      { code: "payment.read", label: "View payments, demands, roznamcha" },
      { code: "payment.post", label: "Post payments and contra entries" },
      { code: "payment.clear", label: "Clear or bounce pending instruments" },
      { code: "payment.reverse", label: "Reverse payments" },
      { code: "receipt.print", label: "Print receipts and demand letters" },
    ],
  },
  {
    key: "reports",
    label: "Reports & dashboards",
    permissions: [
      { code: "report.view", label: "View and export reports" },
      { code: "dashboard.view", label: "View dashboards" },
    ],
  },
  {
    key: "cms",
    label: "Website CMS",
    permissions: [
      { code: "cms.read", label: "View website content" },
      { code: "cms.write", label: "Edit website content and project website settings" },
    ],
  },
  {
    key: "documents",
    label: "Documents",
    permissions: [
      { code: "document.read", label: "View and download documents" },
      { code: "document.write", label: "Upload and manage documents" },
    ],
  },
  {
    key: "service",
    label: "Service requests",
    permissions: [
      { code: "service.read", label: "View service requests" },
      { code: "service.write", label: "Reply to and resolve service requests" },
      { code: "service.assign", label: "Assign service requests" },
    ],
  },
  {
    key: "notifications",
    label: "Notifications",
    permissions: [{ code: "notification.read", label: "Read in-app notifications" }],
  },
];

export interface SystemRoleDefinition {
  readonly description: string;
  readonly permissions: readonly Permission[];
}

const COMMON_STAFF: readonly Permission[] = ["dashboard.view", "notification.read", "master.read", "project.read"];

/** Names of the system roles, in display order (SPEC §1). */
export const SYSTEM_ROLE_NAMES = [
  "Super Admin",
  "Project Admin",
  "Accounts",
  "Sales",
  "Marketing",
  "Employee",
] as const;

/** A system role name literal. */
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

/** Zod schema accepting exactly one system role name. */
export const SystemRoleNameSchema = z.enum(SYSTEM_ROLE_NAMES);

/** System roles (cannot be deleted) with their permission bundles, exactly per SPEC §1. */
export const SYSTEM_ROLES: Readonly<Record<SystemRoleName, SystemRoleDefinition>> = {
  "Super Admin": {
    description: "Everything, including users/roles, settings, agreement edits, CMS, backups and integrity tools.",
    permissions: [...ALL_PERMISSIONS],
  },
  "Project Admin": {
    description:
      "Assigned projects only: blocks, flats, construction status, bookings view/create, customers, leads, reports.",
    permissions: [
      ...COMMON_STAFF,
      "project.write",
      "block.write",
      "flat.write",
      "flat.status",
      "parking.write",
      "construction.update",
      "construction.undo",
      "customer.read",
      "customer.write",
      "customer.portal_manage",
      "lead.read",
      "lead.write",
      "visit.read",
      "visit.write",
      "booking.read",
      "booking.create",
      "payment.read",
      "report.view",
      "document.read",
      "document.write",
      "service.read",
    ],
  },
  Accounts: {
    description: "Payments (post, clear, bounce, reverse), receipts, roznamcha, demands, ledgers, reports, audit view.",
    permissions: [
      ...COMMON_STAFF,
      "customer.read",
      "booking.read",
      "payment.read",
      "payment.post",
      "payment.clear",
      "payment.reverse",
      "receipt.print",
      "report.view",
      "audit.view",
      "document.read",
      "document.write",
      "service.read",
    ],
  },
  Sales: {
    description:
      "Customers, leads, enquiries inbox, availability grid, create bookings, site visits. Cannot post payments or see unmasked KYC.",
    permissions: [
      ...COMMON_STAFF,
      "customer.read",
      "customer.write",
      "lead.read",
      "lead.write",
      "visit.read",
      "visit.write",
      "booking.read",
      "booking.create",
      "payment.read",
      "document.read",
      "document.write",
      "service.read",
    ],
  },
  Marketing: {
    description: "Website CMS read/write and the enquiries inbox.",
    permissions: [...COMMON_STAFF, "cms.read", "cms.write", "lead.read", "document.read", "document.write"],
  },
  Employee: {
    description: "Read-only dashboard and inventory for assigned projects.",
    permissions: [...COMMON_STAFF],
  },
};

/** Returns true when the name is one of the system roles. */
export function isSystemRoleName(name: string): name is SystemRoleName {
  return (SYSTEM_ROLE_NAMES as readonly string[]).includes(name);
}

/** Returns true when the permission set grants the given code. */
export function hasPermission(granted: readonly string[], code: Permission): boolean {
  return granted.includes(code);
}
