import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPortalCustomer } from "./fixtures.js";
import { buildTestApp, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await buildTestApp(); });
afterAll(async () => { await t?.close(); });

describe("notifications", () => {
  it("lists, counts and marks read for the current staff user; withdraw applies the retraction rule", async () => {
    const { notify, notifyRole, withdraw } = await import("../../src/modules/notifications/index.js");
    const admin = await t.loginAs("admin");
    const sales = await t.loginAs("sales");
    const demandId = "11111111-1111-4111-8111-111111111111";
    await t.app.db.transaction(async (tx) => {
      await notify(tx, { companyId: t.companyId, recipients: [{ type: "STAFF", id: admin.user.id }, { type: "STAFF", id: admin.user.id }], type: "DEMAND_RAISED", title: "Demand DM-2526/0001 raised", body: "₹4,00,000", entityType: "demand", entityId: demandId, link: "/bookings/x" });
      await notify(tx, { companyId: t.companyId, recipients: [{ type: "STAFF", id: admin.user.id }], type: "STAGE_COMPLETED", title: "Tower A: Plinth completed", entityType: "block_stage", entityId: "22222222-2222-4222-8222-222222222222" });
      const n = await notifyRole(tx, t.companyId, ["Accounts", "Super Admin"], { type: "CHEQUE_BOUNCED", title: "Cheque bounced", entityType: "payment", entityId: "33333333-3333-4333-8333-333333333333" });
      expect(n).toBe(2);
    });
    const list = await t.request<{ items: { id: string; type: string; is_read: boolean }[]; total: number }>("GET", "/api/v1/notifications", { token: admin.access_token });
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(3);
    expect(list.body.items.map((i) => i.type).sort()).toEqual(["CHEQUE_BOUNCED", "DEMAND_RAISED", "STAGE_COMPLETED"]);
    const salesList = await t.request<{ total: number }>("GET", "/api/v1/notifications", { token: sales.access_token });
    expect(salesList.body.total).toBe(0);
    const count = await t.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: admin.access_token });
    expect(count.body.unread).toBe(3);
    const demandNotif = list.body.items.find((i) => i.type === "DEMAND_RAISED")!;
    const mark = await t.request<{ updated: number }>("POST", "/api/v1/notifications/mark-read", { token: admin.access_token, body: { ids: [demandNotif.id] } });
    expect(mark.body.updated).toBe(1);
    expect((await t.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: admin.access_token })).body.unread).toBe(2);
    const unreadOnly = await t.request<{ total: number }>("GET", "/api/v1/notifications?unread_only=true", { token: admin.access_token });
    expect(unreadOnly.body.total).toBe(2);
    // retraction: the read DEMAND_RAISED is flagged withdrawn, an unread one for the same demand is deleted
    await t.app.db.transaction(async (tx) => {
      await notify(tx, { companyId: t.companyId, recipients: [{ type: "STAFF", id: sales.user.id }], type: "DEMAND_RAISED", title: "dup", entityType: "demand", entityId: demandId });
      const r = await withdraw(tx, "demand", demandId);
      expect(r).toEqual({ deleted: 1, withdrawn: 1 });
    });
    const after = await t.request<{ items: { id: string }[]; total: number }>("GET", "/api/v1/notifications", { token: admin.access_token });
    expect(after.body.total).toBe(2);
    expect(after.body.items.map((i) => i.id)).not.toContain(demandNotif.id);
    const withWithdrawn = await t.request<{ items: { id: string; is_withdrawn: boolean }[] }>("GET", "/api/v1/notifications?include_withdrawn=true", { token: admin.access_token });
    expect(withWithdrawn.body.items.find((i) => i.id === demandNotif.id)?.is_withdrawn).toBe(true);
    expect((await t.request<{ total: number }>("GET", "/api/v1/notifications", { token: sales.access_token })).body.total).toBe(0);
    const all = await t.request<{ updated: number }>("POST", "/api/v1/notifications/mark-read", { token: admin.access_token, body: { all: true } });
    expect(all.body.updated).toBe(2);
    expect((await t.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: admin.access_token })).body.unread).toBe(0);
    const one = await t.request<{ id: string }>("GET", `/api/v1/notifications/${demandNotif.id}`, { token: admin.access_token });
    expect(one.status).toBe(200);
    expect((await t.request("GET", `/api/v1/notifications/${demandNotif.id}`, { token: sales.access_token })).status).toBe(404);
  });

  it("serves the customer bell on the portal audience", async () => {
    const { notify } = await import("../../src/modules/notifications/index.js");
    const c = await createPortalCustomer(t, { phone: "9876543212", name: "Amit Kumar" });
    await t.app.db.transaction(async (tx) => {
      await notify(tx, { companyId: t.companyId, recipients: [{ type: "CUSTOMER", id: c.customerId }], type: "DEMAND_RAISED", title: "Installment due", body: "Pay ₹4,00,000 by 30 Nov", entityType: "demand", entityId: "44444444-4444-4444-8444-444444444444" });
    });
    const login = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", { body: { phone: "9876543212", password: "Welcome@123" } });
    expect(login.status).toBe(200);
    const list = await t.request<{ items: { screen: string; type: string; is_read: boolean }[]; total: number }>("GET", "/api/v1/portal/notifications", { token: login.body.access_token });
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]!.screen).toBe("DEMANDS");
    expect((await t.request<{ unread: number }>("GET", "/api/v1/portal/notifications/unread-count", { token: login.body.access_token })).body.unread).toBe(1);
    const mark = await t.request<{ updated: number }>("POST", "/api/v1/portal/notifications/mark-read", { token: login.body.access_token, body: { all: true } });
    expect(mark.body.updated).toBe(1);
    const staff = await t.loginAs("admin");
    expect((await t.request("GET", "/api/v1/portal/notifications", { token: staff.access_token })).status).toBe(401);
  });
});
