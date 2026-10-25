import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.js";
import * as enums from "../src/enums.js";
import * as permissions from "../src/permissions.js";
import * as errors from "../src/errors.js";
import * as common from "../src/common.js";
import * as auth from "../src/modules/auth.js";
import * as users from "../src/modules/users.js";
import * as roles from "../src/modules/roles.js";
import * as masters from "../src/modules/masters.js";
import * as projects from "../src/modules/projects.js";
import * as blocks from "../src/modules/blocks.js";
import * as flats from "../src/modules/flats.js";
import * as parking from "../src/modules/parking.js";
import * as rateCards from "../src/modules/rateCards.js";
import * as customers from "../src/modules/customers.js";
import * as leads from "../src/modules/leads.js";
import * as paymentPlans from "../src/modules/paymentPlans.js";
import * as construction from "../src/modules/construction.js";
import * as bookings from "../src/modules/bookings.js";
import * as payments from "../src/modules/payments.js";
import * as dues from "../src/modules/dues.js";
import * as documents from "../src/modules/documents.js";
import * as service from "../src/modules/service.js";
import * as notifications from "../src/modules/notifications.js";
import * as reports from "../src/modules/reports.js";
import * as cms from "../src/modules/cms.js";
import * as pub from "../src/modules/public.js";
import * as visits from "../src/modules/visits.js";
import * as portal from "../src/modules/portal.js";
import * as admin from "../src/modules/admin.js";

const MODULES: Record<string, object> = {
  enums, permissions, errors, common, auth, users, roles, masters, projects, blocks, flats, parking, rateCards, customers,
  leads, paymentPlans, construction, bookings, payments, dues, documents, service, notifications, reports, cms, pub, visits,
  portal, admin,
};

describe("index exports", () => {
  it("has no export name collisions between files", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const [file, mod] of Object.entries(MODULES)) {
      for (const name of Object.keys(mod)) {
        const prev = seen.get(name);
        if (prev !== undefined) collisions.push(`${name} (${prev} vs ${file})`);
        seen.set(name, file);
      }
    }
    expect(collisions).toEqual([]);
    for (const name of seen.keys()) expect(name in contracts).toBe(true);
  });
});

describe("permissions registry", () => {
  it("lists every permission exactly once across groups", () => {
    const grouped = permissions.PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.code));
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...permissions.ALL_PERMISSIONS].sort());
  });
  it("system roles follow SPEC §1", () => {
    const roles = permissions.SYSTEM_ROLES;
    expect(Object.keys(roles)).toEqual(["Super Admin", "Project Admin", "Accounts", "Sales", "Marketing", "Employee"]);
    expect([...roles["Super Admin"]!.permissions].sort()).toEqual([...permissions.ALL_PERMISSIONS].sort());
    const sales = roles["Sales"]!.permissions;
    expect(sales).not.toContain("payment.post");
    expect(sales).not.toContain("customer.kyc_view");
    expect(sales).toContain("booking.create");
    expect(sales).toContain("visit.write");
    expect(roles["Accounts"]!.permissions).toEqual(expect.arrayContaining(["payment.post", "payment.clear", "payment.reverse", "receipt.print", "audit.view"]));
    expect(roles["Marketing"]!.permissions).toEqual(expect.arrayContaining(["cms.read", "cms.write", "lead.read"]));
    expect(roles["Marketing"]!.permissions).not.toContain("cms.manage");
    expect(roles["Employee"]!.permissions.every((p) => /\.(read|view)$/.test(p))).toBe(true);
    for (const def of Object.values(roles)) {
      expect(new Set(def.permissions).size).toBe(def.permissions.length);
      for (const code of def.permissions) expect(permissions.PermissionSchema.safeParse(code).success).toBe(true);
    }
  });
  it("includes every code the task requires", () => {
    const required = [
      "users.manage", "roles.manage", "settings.manage", "audit.view", "master.read", "master.write", "project.read", "project.write",
      "block.write", "flat.write", "flat.status", "construction.update", "construction.undo", "customer.read", "customer.write",
      "customer.kyc_view", "customer.portal_manage", "lead.read", "lead.write", "visit.read", "visit.write", "booking.read",
      "booking.create", "booking.cancel", "agreement.edit", "plan.manage", "payment.read", "payment.post", "payment.reverse",
      "receipt.print", "report.view", "cms.read", "cms.write", "document.read", "document.write", "service.read", "service.write",
      "service.assign", "notification.read", "admin.tools",
    ];
    for (const code of required) expect(permissions.ALL_PERMISSIONS).toContain(code);
  });
});

describe("error codes", () => {
  it("maps every code to a status and validates the envelope", () => {
    for (const code of errors.ERROR_CODES) expect(errors.ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    expect(errors.statusForError("VERSION_CONFLICT")).toBe(409);
    expect(errors.statusForError("RATE_LIMITED")).toBe(429);
    expect(errors.isApiError({ error: { code: "NOT_FOUND", message: "x", request_id: "r1" } })).toBe(true);
    // Unknown but well-formed codes parse (a newer server must never break an older client); malformed ones do not.
    expect(errors.isApiError({ error: { code: "NOPE", message: "x" } })).toBe(true);
    expect(errors.isKnownErrorCode("NOPE")).toBe(false);
    expect(errors.isApiError({ error: { code: "nope", message: "x" } })).toBe(false);
    expect(errors.isApiError({ error: { message: "x" } })).toBe(false);
  });

  it("registry has no duplicates and exactly one status per code", () => {
    expect(new Set(errors.ERROR_CODES).size).toBe(errors.ERROR_CODES.length);
    expect(Object.keys(errors.ERROR_STATUS).sort()).toEqual([...errors.ERROR_CODES].sort());
    for (const code of errors.ERROR_CODES) expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    for (const code of ["TICKET_CLOSED", "DUPLICATE_CUSTOMER", "REOPEN_WINDOW_CLOSED", "ALREADY_RATED", "CASH_INSUFFICIENT", "UNSUPPORTED_MEDIA_TYPE"] as const) {
      expect(errors.isKnownErrorCode(code), code).toBe(true);
    }
    expect(errors.statusForError("NOT_IMPLEMENTED")).toBe(501);
    expect(errors.statusForError("SUPER_ADMIN_ONLY")).toBe(403);
    expect(errors.statusForError("PUBLISH_REQUIREMENTS")).toBe(422);
  });
});

describe("enums", () => {
  it("every label map covers every value of its enum", () => {
    const names = Object.keys(enums).filter((k) => k.endsWith("_LABELS"));
    expect(names.length).toBeGreaterThan(30);
    for (const labelName of names) {
      const base = labelName.slice(0, -"_LABELS".length);
      const valuesName = Object.keys(enums).find((k) => k === `${base}S` || k === `${base}ES` || k === base.replace(/Y$/, "IES"));
      expect(valuesName, `values array for ${labelName}`).toBeDefined();
      const values = (enums as Record<string, unknown>)[valuesName as string] as readonly string[];
      const labels = (enums as Record<string, unknown>)[labelName] as Record<string, string>;
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
    }
  });
  it("exposes zod enums alongside the arrays", () => {
    expect(enums.FlatStatusSchema.options).toEqual([...enums.FLAT_STATUSES]);
    expect(enums.TriggerTypeSchema.safeParse("ON_STAGE").success).toBe(true);
    expect(enums.TriggerTypeSchema.safeParse("on_stage").success).toBe(false);
    expect(enums.labelOf(enums.FLAT_STATUS_LABELS, "HOLD")).toBe("On Hold");
  });
});
