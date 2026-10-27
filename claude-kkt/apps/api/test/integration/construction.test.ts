import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIST } from "@kkt/domain";
import { blockStageTimeline } from "../../src/modules/construction/index.js";
import {
  createConstructionWorld,
  insertImageDocument,
  STAGE_NAMES,
  type ConstructionWorld,
  type StageName,
} from "./fixtures/construction.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Construction module (SPEC §9 tower status, jump-ahead, UNDO RULE, photo flags, notifications; §13 bells; §18 scenario 9 stage parts).
 * Fixture: one 14-stage tower with two ACTIVE bookings on Standard CLP (60/40 split of ₹1 Cr); money's engine raises the demands.
 */

const L = 10_000_000; // ₹1,00,000 in paise
const CR = 100 * L;
const NO_ID = "00000000-0000-4000-8000-000000000000";

type Photo = {
  id: string;
  block_stage_id: string;
  document_id: string;
  caption: string | null;
  visible_to_buyers: boolean;
  show_on_website: boolean;
  sort_order: number;
  thumb_url: string | null;
  medium_url: string | null;
  version: number;
};
type Stage = {
  id: string;
  stage_id: string;
  sort_order: number;
  name: string;
  is_possession: boolean;
  status: string;
  started_on: string | null;
  completed_on: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
  notes: string | null;
  photos: Photo[];
  demands_raised: number;
  can_undo: boolean;
};
type Construction = {
  block_id: string;
  block_name: string;
  project_id: string;
  construction_percent: number;
  current_stage_id: string | null;
  next_stage_id: string | null;
  stages: Stage[];
  version: number;
};
type StatusResponse = {
  block_id: string;
  completed_stage_ids: string[];
  demands_raised: number;
  demand_numbers: string[];
  buyers_notified: number;
  construction_percent: number;
  version: number;
};
type UndoResponse = {
  block_id: string;
  stage_id: string;
  voided_demand_numbers: string[];
  undemanded_charge_numbers?: string[];
  withdrawn_notifications: number;
  construction_percent: number;
  version: number;
};
type Demand = {
  id: string;
  demand_number: string;
  installment_seq: number;
  status: string;
  paid_paise: number;
  cash_demand_paise: number;
  account_demand_paise: number;
  demand_date: string;
  trigger_stage_id: string | null;
};
type OtherCharge = {
  id: string;
  name: string;
  demand_number: string | null;
  demanded_at: string | null;
  due_date: string | null;
  paid_paise: number;
  due_paise: number;
};
type Booking = {
  id: string;
  version: number;
  status: string;
  summary: {
    total_due_paise: number;
    other_charges_due_paise: number;
    cash: { due_paise: number; order_raised_paise: number };
    account: { due_paise: number; order_raised_paise: number };
  };
  other_charges: OtherCharge[];
};
type LedgerRow = {
  seq: number;
  event: string;
  ref_number: string | null;
  other_charges_due_paise: number;
  amount_paise: number;
  note: string | null;
};
type List<T> = { items: T[]; total: number };
type Notification = {
  recipient_type: string;
  recipient_id: string;
  type: string;
  is_read: boolean;
  is_withdrawn: boolean;
};

let t: TestContext;
let admin: string;
let adminId: string;
let sales: string;
let accounts: string;
let paSgh: string;
let paSghId: string;
let paGgv: string;
let paGgvId: string;
let w: ConstructionWorld;
let today: string;
let b1: Booking;
let b2: Booking;
let keyCounter = 0;
const key = () => `construction-${Date.now()}-${++keyCounter}`;

async function construction(blockId: string, token = admin): Promise<Construction> {
  const r = await t.request<Construction>("GET", `/api/v1/blocks/${blockId}/construction`, { token });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
async function stageOf(name: StageName, blockId = w.sgh.towerId): Promise<Stage> {
  const c = await construction(blockId);
  return c.stages.find((s) => s.name === name)!;
}
async function versionOf(blockId = w.sgh.towerId): Promise<number> {
  return (await construction(blockId)).version;
}
async function status(
  body: Record<string, unknown>,
  opts: { token?: string; blockId?: string; headers?: Record<string, string>; version?: number } = {},
) {
  const version = opts.version ?? (await versionOf(opts.blockId ?? w.sgh.towerId));
  return t.request<StatusResponse & ErrorBody>(
    "POST",
    `/api/v1/blocks/${opts.blockId ?? w.sgh.towerId}/construction/status`,
    { token: opts.token ?? admin, body: { version, ...body }, headers: opts.headers },
  );
}
async function undo(
  stageId: string,
  reason: string,
  opts: { token?: string; blockId?: string; version?: number } = {},
) {
  const version = opts.version ?? (await versionOf(opts.blockId ?? w.sgh.towerId));
  return t.request<UndoResponse & ErrorBody>(
    "POST",
    `/api/v1/blocks/${opts.blockId ?? w.sgh.towerId}/construction/undo`,
    { token: opts.token ?? admin, body: { version, stage_id: stageId, reason } },
  );
}
async function demandsOf(bookingId: string): Promise<Demand[]> {
  const r = await t.request<List<Demand>>(
    "GET",
    `/api/v1/bookings/${bookingId}/demands?include_inactive=true&page_size=200&sort=posted_at`,
    { token: admin },
  );
  expect(r.status, r.text).toBe(200);
  return r.body.items;
}
async function booking(id: string): Promise<Booking> {
  const r = await t.request<Booking>("GET", `/api/v1/bookings/${id}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
async function notificationsFor(entityId: string): Promise<Notification[]> {
  return t.app.sql<
    Notification[]
  >`select recipient_type, recipient_id, type, is_read, is_withdrawn from notifications where entity_type = 'block_stage' and entity_id = ${entityId} order by created_at`;
}
async function demandCount(): Promise<number> {
  return Number(
    (await t.app.sql<{ n: string }[]>`select count(*)::text as n from demands where status <> 'VOID'`)[0]!.n,
  );
}
async function auditRows(action: string, entityId: string): Promise<number> {
  return Number(
    (
      await t.app.sql<
        { n: string }[]
      >`select count(*)::text as n from audit_logs where action = ${action} and entity_id = ${entityId}`
    )[0]!.n,
  );
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  const a = await t.loginAs("admin");
  admin = a.access_token;
  adminId = a.user.id;
  sales = (await t.loginAs("sales")).access_token;
  accounts = (await t.loginAs("accounts")).access_token;
  w = await createConstructionWorld(t, admin);
  const roles = await t.request<List<{ id: string; name: string }>>("GET", "/api/v1/roles", { token: admin });
  const pa = roles.body.items.find((r) => r.name === "Project Admin")!;
  for (const [name, email, projectId] of [
    ["PA SGH", "pa.sgh@sgb.in", w.sgh.id],
    ["PA GGV", "pa.ggv@sgb.in", w.ggv.id],
  ] as const) {
    const r = await t.request("POST", "/api/v1/users", {
      token: admin,
      body: {
        name,
        email,
        role_id: pa.id,
        all_projects: false,
        project_ids: [projectId],
        password: "Project@12345",
        must_change_password: false,
      },
    });
    expect(r.status, r.text).toBe(201);
  }
  const s = await t.login("pa.sgh@sgb.in", "Project@12345");
  paSgh = s.access_token;
  paSghId = s.user.id;
  const g = await t.login("pa.ggv@sgb.in", "Project@12345");
  paGgv = g.access_token;
  paGgvId = g.user.id;
  const bookingDate = addDays(today, -30);
  for (const [flat, customer] of [
    ["A-101", w.customers[0]!],
    ["A-102", w.customers[1]!],
  ] as const) {
    const r = await t.request<Booking>("POST", "/api/v1/bookings", {
      token: sales,
      headers: { "idempotency-key": key() },
      body: {
        flat_id: w.sgh.flats.get(flat)!.id,
        customer_id: customer,
        booking_date: bookingDate,
        agreement_value_paise: CR,
        cash_agreed_paise: 60 * L,
        account_agreed_paise: 40 * L,
        plan_acceptance_mode: "IN_PERSON",
        plan_accepted_on: bookingDate,
      },
    });
    expect(r.status, r.text).toBe(201);
    if (flat === "A-101") b1 = r.body;
    else b2 = r.body;
  }
});
afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------

describe("tower construction status (SPEC §9) – reading", () => {
  it("lists the 14 stage records in master order, all PENDING, 0 %, nothing current, Excavation up next; Sales may read; scope → 404", async () => {
    const c = await construction(w.sgh.towerId);
    expect(c.block_name).toBe("Tower A");
    expect(c.project_id).toBe(w.sgh.id);
    expect(c.stages.map((s) => s.name)).toEqual([...STAGE_NAMES]);
    expect(c.stages.map((s) => s.stage_id)).toEqual(w.stageOrder);
    expect(
      c.stages.every(
        (s) =>
          s.status === "PENDING" &&
          s.completed_on === null &&
          s.photos.length === 0 &&
          s.demands_raised === 0 &&
          !s.can_undo,
      ),
    ).toBe(true);
    expect(c.stages.filter((s) => s.is_possession).map((s) => s.name)).toEqual(["Possession"]);
    expect(c.construction_percent).toBe(0);
    expect(c.current_stage_id).toBeNull();
    expect(c.next_stage_id).toBe(w.stages.Excavation);
    expect(c.version).toBeGreaterThanOrEqual(1);
    expect((await t.request("GET", `/api/v1/blocks/${w.sgh.towerId}/construction`, { token: sales })).status).toBe(200);
    expect((await t.request("GET", `/api/v1/blocks/${w.sgh.towerId}/construction`, { token: paSgh })).status).toBe(200);
    const foreign = await t.request<ErrorBody>("GET", `/api/v1/blocks/${w.sgh.towerId}/construction`, { token: paGgv });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("NOT_FOUND");
    expect((await t.request("GET", `/api/v1/blocks/${NO_ID}/construction`, { token: admin })).status).toBe(404);
    expect((await t.request("GET", `/api/v1/blocks/${w.sgh.towerId}/construction`)).status).toBe(401);
    // every construction route is a staff route guarded by a permission (route registry)
    // staff construction routes only (the portal module registers its own /portal/bookings/:id/construction read)
    const mine = t.app.routeRegistry.filter(
      (r) => /\/construction(\/|$)/.test(r.url) && !r.url.startsWith("/api/v1/portal/"),
    );
    expect(mine.length).toBe(8);
    expect(mine.every((r) => r.permission !== null && r.audience === "erp" && !r.public)).toBe(true);
    expect(new Set(mine.map((r) => r.permission))).toEqual(
      new Set(["project.read", "construction.update", "construction.undo"]),
    );
  });
});

describe("stage photos (flags visible_to_buyers / show_on_website)", () => {
  let hiddenPhoto: Photo;
  let plinthDoc: string;

  it("attaches STAGE / PROJECT / BLOCK image documents with flags; rejects foreign, non-image, sensitive and unknown documents; Sales 403", async () => {
    const foundation = await stageOf("Foundation");
    const plinth = await stageOf("Plinth");
    const stageDoc = await insertImageDocument(t, "STAGE", foundation.id);
    const r1 = await t.request<Photo>(
      "POST",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.Foundation}/photos`,
      {
        token: paSgh,
        body: {
          document_id: stageDoc,
          caption: "Footings done",
          visible_to_buyers: true,
          show_on_website: true,
          sort_order: 1,
        },
        headers: { "idempotency-key": key() },
      },
    );
    expect(r1.status, r1.text).toBe(201);
    expect(r1.body).toMatchObject({
      block_stage_id: foundation.id,
      document_id: stageDoc,
      caption: "Footings done",
      visible_to_buyers: true,
      show_on_website: true,
      sort_order: 1,
    });
    expect(r1.body.thumb_url).toMatch(/\/api\/v1\/files\//);
    expect(r1.body.medium_url).toMatch(/\/api\/v1\/files\//);

    plinthDoc = await insertImageDocument(t, "PROJECT", w.sgh.id);
    // the stage may also be addressed by its block_stages row id
    const r2 = await t.request<Photo>("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/${plinth.id}/photos`, {
      token: admin,
      body: { document_id: plinthDoc, caption: "Plinth beam", visible_to_buyers: true },
    });
    expect(r2.status, r2.text).toBe(201);
    expect(r2.body.show_on_website).toBe(false);
    const noVariants = await insertImageDocument(t, "BLOCK", w.sgh.towerId, { withVariants: false });
    const r3 = await t.request<Photo>(
      "POST",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.Plinth}/photos`,
      { token: admin, body: { document_id: noVariants, caption: "internal", visible_to_buyers: false, sort_order: 2 } },
    );
    expect(r3.status, r3.text).toBe(201);
    expect(r3.body.thumb_url).toBeNull();
    expect(r3.body.version).toBe(1); // the photo row version is always returned (If-Match on PATCH)
    hiddenPhoto = r3.body;

    const ggvStage = (await construction(w.ggv.towerId)).stages[1]!;
    const bad: [string, string][] = [
      [await insertImageDocument(t, "CUSTOMER", w.customers[0]!), "customer document"],
      [await insertImageDocument(t, "STAGE", ggvStage.id), "another tower's stage"],
      [await insertImageDocument(t, "PROJECT", w.ggv.id), "another project"],
      [await insertImageDocument(t, "STAGE", plinth.id, { mime: "application/pdf" }), "pdf"],
      [await insertImageDocument(t, "STAGE", plinth.id, { sensitive: true }), "sensitive"],
      [NO_ID, "unknown"],
    ];
    for (const [doc, label] of bad) {
      const r = await t.request<ErrorBody>(
        "POST",
        `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.Plinth}/photos`,
        { token: admin, body: { document_id: doc } },
      );
      expect(r.status, label).toBe(400);
      expect(r.body.error.code, label).toBe("VALIDATION_ERROR");
    }
    expect(
      (
        await t.request("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.Plinth}/photos`, {
          token: sales,
          body: { document_id: plinthDoc },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.request("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.Plinth}/photos`, {
          token: paGgv,
          body: { document_id: plinthDoc },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.request("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/${NO_ID}/photos`, {
          token: admin,
          body: { document_id: plinthDoc },
        })
      ).status,
    ).toBe(404);

    const c = await construction(w.sgh.towerId);
    expect(c.stages.find((s) => s.name === "Foundation")!.photos).toHaveLength(1);
    expect(c.stages.find((s) => s.name === "Plinth")!.photos.map((p) => p.sort_order)).toEqual([0, 2]);
  });

  it("PATCH updates caption and flags (version required: If-Match or body.version; stale → 409); DELETE removes the link but keeps the document; scope → 404", async () => {
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/construction/photos/${hiddenPhoto.id}`, {
      token: admin,
      body: { caption: "x" },
      headers: { "if-match": '"99"' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    // no longer exempt from the staff PATCH version policy (TODO-integration item 13)
    const versionless = await t.request<ErrorBody>("PATCH", `/api/v1/construction/photos/${hiddenPhoto.id}`, {
      token: admin,
      body: { caption: "x" },
    });
    expect(versionless.status, versionless.text).toBe(428);
    expect(versionless.body.error.code).toBe("VERSION_REQUIRED");
    const patched = await t.request<Photo>("PATCH", `/api/v1/construction/photos/${hiddenPhoto.id}`, {
      token: paSgh,
      body: { caption: "Site office view", show_on_website: true },
      headers: { "if-match": `"${hiddenPhoto.version}"` },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body).toMatchObject({
      caption: "Site office view",
      show_on_website: true,
      visible_to_buyers: false,
      version: hiddenPhoto.version + 1,
    });
    // body.version works as well as If-Match
    const viaBody = await t.request<Photo>("PATCH", `/api/v1/construction/photos/${hiddenPhoto.id}`, {
      token: admin,
      body: { sort_order: 2, version: patched.body.version },
    });
    expect(viaBody.status, viaBody.text).toBe(200);
    expect(viaBody.body.version).toBe(patched.body.version + 1);
    hiddenPhoto = viaBody.body;
    expect(
      (
        await t.request("PATCH", `/api/v1/construction/photos/${hiddenPhoto.id}`, {
          token: sales,
          body: { caption: "no", version: hiddenPhoto.version },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.request("PATCH", `/api/v1/construction/photos/${hiddenPhoto.id}`, {
          token: paGgv,
          body: { caption: "no", version: hiddenPhoto.version },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.request("PATCH", `/api/v1/construction/photos/${hiddenPhoto.id}`, {
          token: admin,
          body: { document_id: NO_ID },
        })
      ).status,
    ).toBe(400);

    const extraDoc = await insertImageDocument(t, "BLOCK", w.sgh.towerId);
    const extra = await t.request<Photo>(
      "POST",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.Excavation}/photos`,
      { token: admin, body: { document_id: extraDoc, visible_to_buyers: false } },
    );
    expect(extra.status).toBe(201);
    expect(
      (
        await t.request("DELETE", `/api/v1/construction/photos/${extra.body.id}`, {
          token: sales,
          headers: { "if-match": `"v${extra.body.version}"` },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.request("DELETE", `/api/v1/construction/photos/${extra.body.id}`, {
          token: paGgv,
          headers: { "if-match": `"v${extra.body.version}"` },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.request("DELETE", `/api/v1/construction/photos/${extra.body.id}`, {
          token: admin,
          headers: { "if-match": `"v${extra.body.version}"` },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await t.request("DELETE", `/api/v1/construction/photos/${extra.body.id}`, {
          token: admin,
          headers: { "if-match": `"v${extra.body.version}"` },
        })
      ).status,
    ).toBe(404);
    const [doc] = await t.app.sql<{ is_deleted: boolean }[]>`select is_deleted from documents where id = ${extraDoc}`;
    expect(doc!.is_deleted).toBe(false);
    expect((await stageOf("Excavation")).photos).toHaveLength(0);
    expect(await auditRows("stage_photo.delete", extra.body.id)).toBe(1);
  });
});

describe("marking stages (jump-ahead, dues, bells)", () => {
  const d0 = () => addDays(today, -10);
  const dFoundation = () => addDays(today, -5);
  const dPlinth = () => addDays(today, -2);

  it("validates: completed_on in the future, intermediate date after completed_on or for a stage not being completed, unknown stage, missing/stale version, Sales 403, scope 404", async () => {
    const future = await status({ stage_id: w.stages.Excavation, completed_on: addDays(today, 1) });
    expect(future.status).toBe(400);
    expect(future.body.error.code).toBe("VALIDATION_ERROR");
    const lateIntermediate = await status({
      stage_id: w.stages.Plinth,
      completed_on: dPlinth(),
      intermediate_dates: { [w.stages.Foundation]: today },
    });
    expect(lateIntermediate.status).toBe(400);
    const notCompleting = await status({
      stage_id: w.stages.Plinth,
      completed_on: dPlinth(),
      intermediate_dates: { [w.stages["Top Slab"]]: d0() },
    });
    expect(notCompleting.status).toBe(400);
    expect(notCompleting.body.error.code).toBe("VALIDATION_ERROR");
    const unknownStage = await status({ stage_id: NO_ID, completed_on: d0() });
    expect(unknownStage.status).toBe(404);
    const noVersion = await t.request<ErrorBody>("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/status`, {
      token: admin,
      body: { stage_id: w.stages.Excavation, completed_on: d0() },
    });
    expect(noVersion.status).toBe(428);
    const stale = await status({ stage_id: w.stages.Excavation, completed_on: d0() }, { version: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const forbidden = await status({ stage_id: w.stages.Excavation, completed_on: d0() }, { token: sales });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
    const foreign = await status({ stage_id: w.stages.Excavation, completed_on: d0() }, { token: paGgv });
    expect(foreign.status).toBe(404);
    expect(await demandCount()).toBe(2); // only the two ON_BOOKING demands exist
    expect((await construction(w.sgh.towerId)).stages.every((s) => s.status === "PENDING")).toBe(true);
  });

  it("Excavation completed: 5 % × agreed per bucket raised for both bookings with demand_date = completed_on; admins of the project notified, buyers not (no visible photos); % = 1/14; Idempotency-Key replay creates nothing", async () => {
    const k = key();
    const body = { stage_id: w.stages.Excavation, completed_on: d0(), notes: "Started late due to rain" };
    const version = await versionOf();
    const r = await status(body, { headers: { "idempotency-key": k }, version });
    expect(r.status, r.text).toBe(200);
    expect(r.body.completed_stage_ids).toEqual([w.stages.Excavation]);
    expect(r.body.demands_raised).toBe(2);
    expect(r.body.demand_numbers).toHaveLength(2);
    expect(r.body.buyers_notified).toBe(0);
    expect(r.body.construction_percent).toBe(7.14);
    expect(r.body.version).toBe(version + 1);

    const replay = await status(body, { headers: { "idempotency-key": k }, version });
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body).toEqual(r.body);
    expect(await demandCount()).toBe(4);

    for (const b of [b1, b2]) {
      const d = (await demandsOf(b.id)).find((x) => x.installment_seq === 2)!;
      expect(d).toBeDefined();
      expect(d.cash_demand_paise).toBe(3 * L);
      expect(d.account_demand_paise).toBe(2 * L);
      expect(d.demand_date).toBe(d0());
      expect(d.trigger_stage_id).toBe(w.stages.Excavation);
      expect(d.status).toBe("OPEN");
    }
    const excavation = await stageOf("Excavation");
    expect(excavation).toMatchObject({
      status: "COMPLETED",
      completed_on: d0(),
      completed_by: adminId,
      notes: "Started late due to rain",
      demands_raised: 2,
      can_undo: true,
    });
    expect(excavation.completed_by_name).toBeTruthy();
    expect(excavation.completed_at).toBeTruthy();
    const c = await construction(w.sgh.towerId);
    expect(c.construction_percent).toBe(7.14);
    expect(c.current_stage_id).toBe(w.stages.Excavation);
    expect(c.next_stage_id).toBe(w.stages.Foundation);
    const [blk] = await t.app.sql<
      { construction_percent: string }[]
    >`select construction_percent::text from blocks where id = ${w.sgh.towerId}`;
    expect(Number(blk!.construction_percent)).toBe(7.14);

    const bells = await notificationsFor(excavation.id);
    expect(bells.every((n) => n.type === "STAGE_COMPLETED")).toBe(true);
    expect(bells.filter((n) => n.recipient_type === "CUSTOMER")).toHaveLength(0);
    const staff = bells.filter((n) => n.recipient_type === "STAFF").map((n) => n.recipient_id);
    expect(staff).toContain(paSghId);
    expect(staff).not.toContain(paGgvId);
    expect(staff).not.toContain(adminId); // the actor is not told what they just did
    expect(await auditRows("block_stage.complete", excavation.id)).toBe(1);
    expect(await auditRows("construction.status_update", w.sgh.towerId)).toBe(1);
  });

  it("jump Excavation → Plinth marks Foundation and Plinth COMPLETED with the given dates, raises exactly those installments for both bookings (% × agreed per bucket) and notifies both buyers for each stage with visible photos (scenario 9)", async () => {
    const r = await status({
      stage_id: w.stages.Plinth,
      completed_on: dPlinth(),
      intermediate_dates: { [w.stages.Foundation]: dFoundation() },
      notes: "Plinth level reached",
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.completed_stage_ids).toEqual([w.stages.Foundation, w.stages.Plinth]);
    expect(r.body.demands_raised).toBe(4);
    expect(r.body.buyers_notified).toBe(4); // 2 stages × 2 buyers
    expect(r.body.construction_percent).toBe(21.43);

    for (const b of [b1, b2]) {
      const ds = await demandsOf(b.id);
      const foundation = ds.find((x) => x.installment_seq === 3)!;
      const plinth = ds.find((x) => x.installment_seq === 4)!;
      expect(foundation).toMatchObject({
        cash_demand_paise: 6 * L,
        account_demand_paise: 4 * L,
        demand_date: dFoundation(),
        trigger_stage_id: w.stages.Foundation,
        status: "OPEN",
      });
      expect(plinth).toMatchObject({
        cash_demand_paise: 3 * L,
        account_demand_paise: 2 * L,
        demand_date: dPlinth(),
        trigger_stage_id: w.stages.Plinth,
        status: "OPEN",
      });
      expect(ds.filter((x) => x.status !== "VOID")).toHaveLength(4); // booking, excavation, foundation, plinth
      // telescoping: cumulative raised = 30 % of each bucket
      const cash = ds.filter((x) => x.status !== "VOID").reduce((a, x) => a + x.cash_demand_paise, 0);
      const account = ds.filter((x) => x.status !== "VOID").reduce((a, x) => a + x.account_demand_paise, 0);
      expect(cash).toBe(18 * L);
      expect(account).toBe(12 * L);
      expect((await booking(b.id)).summary.total_due_paise).toBe(30 * L);
    }
    const c = await construction(w.sgh.towerId);
    const byName = new Map(c.stages.map((s) => [s.name, s]));
    expect(byName.get("Foundation")).toMatchObject({
      status: "COMPLETED",
      completed_on: dFoundation(),
      demands_raised: 2,
      can_undo: false,
      notes: null,
    });
    expect(byName.get("Plinth")).toMatchObject({
      status: "COMPLETED",
      completed_on: dPlinth(),
      demands_raised: 2,
      can_undo: true,
      notes: "Plinth level reached",
    });
    expect(byName.get("Excavation")!.can_undo).toBe(false);
    expect(c.current_stage_id).toBe(w.stages.Plinth);
    expect(c.next_stage_id).toBe(w.stages["1st Slab"]);
    expect(c.construction_percent).toBe(21.43);

    for (const name of ["Foundation", "Plinth"] as const) {
      const bells = await notificationsFor(byName.get(name)!.id);
      const buyers = bells
        .filter((n) => n.recipient_type === "CUSTOMER")
        .map((n) => n.recipient_id)
        .sort();
      expect(buyers).toEqual([w.customers[0]!, w.customers[1]!].sort());
      expect(bells.filter((n) => n.recipient_type === "STAFF").map((n) => n.recipient_id)).toContain(paSghId);
    }
    // the demand bells are money's: one DEMAND_RAISED per demand for each buyer
    const demandBells = await t.app.sql<
      { n: string }[]
    >`select count(*)::text as n from notifications where type = 'DEMAND_RAISED' and recipient_type = 'CUSTOMER'`;
    expect(Number(demandBells[0]!.n)).toBe(8);
  });

  it("IN_PROGRESS is a non-financial marker: PATCH raises nothing and leaves the %; COMPLETED cannot be set or unset through PATCH; notes stay editable", async () => {
    const before = await demandCount();
    const version = await versionOf();
    const r = await t.request<Construction & ErrorBody>(
      "PATCH",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages["1st Slab"]}`,
      {
        token: paSgh,
        body: { status: "IN_PROGRESS", started_on: addDays(today, -1), notes: "Shuttering" },
        headers: { "if-match": `"${version}"` },
      },
    );
    expect(r.status, r.text).toBe(200);
    const slab = r.body.stages.find((s) => s.name === "1st Slab")!;
    expect(slab).toMatchObject({
      status: "IN_PROGRESS",
      started_on: addDays(today, -1),
      notes: "Shuttering",
      completed_on: null,
    });
    expect(r.body.construction_percent).toBe(21.43);
    expect(r.body.current_stage_id).toBe(w.stages["1st Slab"]);
    expect(r.body.next_stage_id).toBe(w.stages["2nd Slab"]);
    expect(r.body.version).toBe(version + 1);
    expect(await demandCount()).toBe(before);

    const completedViaPatch = await t.request<ErrorBody>(
      "PATCH",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages["2nd Slab"]}`,
      { token: admin, body: { version: version + 1, status: "COMPLETED" } },
    );
    expect(completedViaPatch.status).toBe(400);
    const reopenViaPatch = await t.request<ErrorBody>(
      "PATCH",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.Foundation}`,
      { token: admin, body: { version: version + 1, status: "PENDING" } },
    );
    expect(reopenViaPatch.status).toBe(422);
    expect(reopenViaPatch.body.error.code).toBe("BUSINESS_RULE");
    expect(reopenViaPatch.body.error.details?.["rule"]).toBe("STAGE_COMPLETED");
    const futureStart = await t.request<ErrorBody>(
      "PATCH",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages["2nd Slab"]}`,
      { token: admin, body: { version: version + 1, started_on: addDays(today, 3) } },
    );
    expect(futureStart.status).toBe(400);
    expect(
      (
        await t.request("PATCH", `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages["2nd Slab"]}`, {
          token: sales,
          body: { version: version + 1, notes: "x" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.request("PATCH", `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages["2nd Slab"]}`, {
          token: paGgv,
          body: { version: version + 1, notes: "x" },
        })
      ).status,
    ).toBe(404);

    const notes = await t.request<Construction>(
      "PATCH",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.Foundation}`,
      { token: admin, body: { version: version + 1, notes: "RCC footing M30" } },
    );
    expect(notes.status, notes.text).toBe(200);
    expect(notes.body.stages.find((s) => s.name === "Foundation")!.notes).toBe("RCC footing M30");
    const back = await t.request<Construction>(
      "PATCH",
      `/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages["1st Slab"]}`,
      { token: admin, body: { version: version + 2, status: "PENDING" } },
    );
    expect(back.status, back.text).toBe(200);
    expect(back.body.stages.find((s) => s.name === "1st Slab")).toMatchObject({ status: "PENDING", started_on: null });
    expect(back.body.current_stage_id).toBe(w.stages.Plinth);
    expect(await demandCount()).toBe(before);
  });
});

describe("UNDO RULE (SPEC §9)", () => {
  it("only the latest completed stage can be undone (409 UNDO_NOT_LATEST); a pending stage cannot (422); Sales lacks construction.undo (403); scope 404", async () => {
    const notLatest = await undo(w.stages.Foundation, "Wrong date entered");
    expect(notLatest.status).toBe(409);
    expect(notLatest.body.error.code).toBe("UNDO_NOT_LATEST");
    expect(notLatest.body.error.details).toMatchObject({
      latest_stage_id: w.stages.Plinth,
      latest_stage_name: "Plinth",
    });
    const pending = await undo(w.stages["Top Slab"], "Wrong date entered");
    expect(pending.status).toBe(422);
    expect(pending.body.error.details?.["rule"]).toBe("STAGE_NOT_COMPLETED");
    expect((await undo(w.stages.Plinth, "Wrong date entered", { token: sales })).status).toBe(403);
    expect((await undo(w.stages.Plinth, "Wrong date entered", { token: paGgv })).status).toBe(404);
    const stale = await undo(w.stages.Plinth, "Wrong date entered", { version: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const shortReason = await t.request<ErrorBody>("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/undo`, {
      token: admin,
      body: { version: await versionOf(), stage_id: w.stages.Plinth, reason: "x" },
    });
    expect(shortReason.status).toBe(400);
    expect((await stageOf("Plinth")).status).toBe("COMPLETED");
  });

  it("undo Plinth with no payments: its demands become VOID, ledgers rebuilt, stage back to PENDING, % recomputed, unread notifications deleted and read ones flagged withdrawn", async () => {
    const plinth = await stageOf("Plinth");
    await t.app
      .sql`update notifications set is_read = true, read_at = now() where entity_type = 'block_stage' and entity_id = ${plinth.id} and recipient_type = 'CUSTOMER' and recipient_id = ${w.customers[0]!}`;
    const plinthDemands = [b1, b2].map(async (b) => (await demandsOf(b.id)).find((d) => d.installment_seq === 4)!);
    const numbers = (await Promise.all(plinthDemands)).map((d) => d.demand_number).sort();

    const r = await undo(w.stages.Plinth, "Plinth not yet certified by the engineer", { token: paSgh });
    expect(r.status, r.text).toBe(200);
    expect(r.body.stage_id).toBe(w.stages.Plinth);
    expect([...r.body.voided_demand_numbers].sort()).toEqual(numbers);
    expect(r.body.withdrawn_notifications).toBeGreaterThanOrEqual(3); // 2 buyers + at least PA SGH
    expect(r.body.construction_percent).toBe(14.29);

    for (const b of [b1, b2]) {
      const ds = await demandsOf(b.id);
      expect(ds.find((d) => d.installment_seq === 4)!.status).toBe("VOID");
      expect(ds.filter((d) => d.status !== "VOID")).toHaveLength(3);
      expect((await booking(b.id)).summary.total_due_paise).toBe(25 * L);
    }
    const c = await construction(w.sgh.towerId);
    const byName = new Map(c.stages.map((s) => [s.name, s]));
    expect(byName.get("Plinth")).toMatchObject({
      status: "PENDING",
      completed_on: null,
      completed_by: null,
      completed_at: null,
      demands_raised: 0,
      can_undo: false,
      notes: "Plinth level reached",
    });
    expect(byName.get("Plinth")!.photos).toHaveLength(2); // photos survive an undo
    expect(byName.get("Foundation")!.can_undo).toBe(true);
    expect(c.construction_percent).toBe(14.29);
    expect(c.current_stage_id).toBe(w.stages.Foundation);

    const bells = await notificationsFor(plinth.id);
    expect(bells).toHaveLength(1);
    expect(bells[0]).toMatchObject({
      recipient_type: "CUSTOMER",
      recipient_id: w.customers[0]!,
      is_read: true,
      is_withdrawn: true,
    });
    // the Foundation bells are untouched
    expect(
      (await notificationsFor(byName.get("Foundation")!.id)).filter(
        (n) => n.recipient_type === "CUSTOMER" && !n.is_withdrawn,
      ),
    ).toHaveLength(2);
    // money withdrew the voided demands' bells too
    const demandBells = await t.app.sql<
      { n: string }[]
    >`select count(*)::text as n from notifications where type = 'DEMAND_RAISED' and recipient_type = 'CUSTOMER' and is_withdrawn = false`;
    expect(Number(demandBells[0]!.n)).toBe(6);
    expect(await auditRows("construction.undo", plinth.id)).toBe(1);
  });

  it("undo is blocked once a demand the stage raised has been paid by a payment dated on/after the demand (409 UNDO_BLOCKED with details.reasons)", async () => {
    const again = await status({ stage_id: w.stages.Plinth, completed_on: addDays(today, -1) });
    expect(again.status, again.text).toBe(200);
    expect(again.body.completed_stage_ids).toEqual([w.stages.Plinth]);
    expect(again.body.demands_raised).toBe(2);
    const plinthDemand = (await demandsOf(b1.id)).find((d) => d.installment_seq === 4 && d.status !== "VOID")!;
    expect(plinthDemand.demand_date).toBe(addDays(today, -1));
    // FIFO per bucket: 18 L cash settles booking (6) + excavation (3) + foundation (6) and funds the plinth demand (3) with today's receipt
    const pay = await t.request<{ payment: { receipt_number: string; status: string } } & ErrorBody>(
      "POST",
      "/api/v1/payments",
      {
        token: accounts,
        headers: { "idempotency-key": key() },
        body: {
          booking_id: b1.id,
          against: "FLAT_VALUE",
          bucket: "CASH",
          amount_paise: 18 * L,
          payment_date: today,
          payment_mode_id: w.upiModeId,
          instrument: { number: "UPI-PLINTH-1" },
          bank_account_id: w.bankAccountId,
        },
      },
    );
    expect(pay.status, pay.text).toBe(201);
    expect(pay.body.payment.status).toBe("CLEARED");
    expect((await demandsOf(b1.id)).find((d) => d.installment_seq === 4 && d.status !== "VOID")!.paid_paise).toBe(
      3 * L,
    );

    const blocked = await undo(w.stages.Plinth, "Trying to roll back after collection");
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("UNDO_BLOCKED");
    const details = blocked.body.error.details as {
      reasons: string[];
      blocking_payments: { receipt_number: string; payment_date: string; demand_number: string }[];
    };
    expect(details.reasons.length).toBeGreaterThanOrEqual(1);
    expect(details.reasons[0]).toContain(plinthDemand.demand_number);
    expect(details.blocking_payments).toEqual([
      {
        demand_number: plinthDemand.demand_number,
        receipt_number: pay.body.payment.receipt_number,
        payment_date: today,
      },
    ]);
    // nothing changed
    expect((await stageOf("Plinth")).status).toBe("COMPLETED");
    expect((await demandsOf(b1.id)).find((d) => d.installment_seq === 4 && d.status !== "VOID")).toMatchObject({
      status: "PARTIALLY_PAID",
      paid_paise: 3 * L,
    }); // cash side funded, account side still open
    expect((await demandsOf(b2.id)).find((d) => d.installment_seq === 4 && d.status !== "VOID")!.status).toBe("OPEN");
    expect((await construction(w.sgh.towerId)).construction_percent).toBe(21.43);
  });
});

describe("mark-in-progress, repeat completion, photo-triggered bells, summaries", () => {
  it("mark_in_progress_stage_id sets the following stage IN_PROGRESS in the same call; completing an already completed stage is 422; a bad in-progress stage is 400", async () => {
    const r = await status({
      stage_id: w.stages["1st Slab"],
      completed_on: today,
      mark_in_progress_stage_id: w.stages["2nd Slab"],
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.completed_stage_ids).toEqual([w.stages["1st Slab"]]);
    expect(r.body.demands_raised).toBe(2);
    const c = await construction(w.sgh.towerId);
    const byName = new Map(c.stages.map((s) => [s.name, s]));
    expect(byName.get("1st Slab")).toMatchObject({
      status: "COMPLETED",
      completed_on: today,
      demands_raised: 2,
      can_undo: true,
    });
    expect(byName.get("2nd Slab")).toMatchObject({ status: "IN_PROGRESS", started_on: today });
    expect(c.current_stage_id).toBe(w.stages["2nd Slab"]);
    expect(c.next_stage_id).toBe(w.stages["3rd Slab"]);
    expect(c.construction_percent).toBe(28.57);
    for (const b of [b1, b2])
      expect((await demandsOf(b.id)).find((d) => d.installment_seq === 5)).toMatchObject({
        cash_demand_paise: 6 * L,
        account_demand_paise: 4 * L,
        demand_date: today,
      });

    const twice = await status({ stage_id: w.stages["1st Slab"], completed_on: today });
    expect(twice.status).toBe(422);
    expect(twice.body.error.details?.["rule"]).toBe("STAGE_ALREADY_COMPLETED");
    const badInProgress = await status({
      stage_id: w.stages["2nd Slab"],
      completed_on: today,
      mark_in_progress_stage_id: w.stages.Excavation,
    });
    expect(badInProgress.status).toBe(400);
    expect((await stageOf("2nd Slab")).status).toBe("IN_PROGRESS");
  });

  it("buyers are told about a completed stage when its first buyer-visible photo arrives (photos usually follow the status update); later photos do not repeat the bell", async () => {
    const slab = await stageOf("1st Slab");
    expect((await notificationsFor(slab.id)).filter((n) => n.recipient_type === "CUSTOMER")).toHaveLength(0);
    const hidden = await t.request<Photo>("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/${slab.id}/photos`, {
      token: admin,
      body: { document_id: await insertImageDocument(t, "STAGE", slab.id), visible_to_buyers: false },
    });
    expect(hidden.status).toBe(201);
    expect((await notificationsFor(slab.id)).filter((n) => n.recipient_type === "CUSTOMER")).toHaveLength(0);
    const flipped = await t.request<Photo>("PATCH", `/api/v1/construction/photos/${hidden.body.id}`, {
      token: admin,
      body: { visible_to_buyers: true },
      headers: { "if-match": `"${hidden.body.version}"` },
    });
    expect(flipped.status).toBe(200);
    expect(
      (await notificationsFor(slab.id))
        .filter((n) => n.recipient_type === "CUSTOMER")
        .map((n) => n.recipient_id)
        .sort(),
    ).toEqual([w.customers[0]!, w.customers[1]!].sort());
    const second = await t.request<Photo>("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/${slab.id}/photos`, {
      token: admin,
      body: { document_id: await insertImageDocument(t, "STAGE", slab.id), visible_to_buyers: true },
    });
    expect(second.status).toBe(201);
    expect((await notificationsFor(slab.id)).filter((n) => n.recipient_type === "CUSTOMER")).toHaveLength(2);
    // a pending stage's visible photo never rings the bell
    const brickwork = await stageOf("Brickwork");
    expect(
      (
        await t.request("POST", `/api/v1/blocks/${w.sgh.towerId}/construction/${brickwork.id}/photos`, {
          token: admin,
          body: { document_id: await insertImageDocument(t, "STAGE", brickwork.id), visible_to_buyers: true },
        })
      ).status,
    ).toBe(201);
    expect(await notificationsFor(brickwork.id)).toHaveLength(0);
  });

  it("GET /projects/:id/construction summarises every tower (scope → 404); blockStageTimeline() filters photos for the portal (visible to buyers) and the website", async () => {
    const r = await t.request<{
      project_id: string;
      project_name: string;
      construction_percent: number;
      blocks: Record<string, unknown>[];
    }>("GET", `/api/v1/projects/${w.sgh.id}/construction`, { token: paSgh });
    expect(r.status, r.text).toBe(200);
    expect(r.body.project_name).toBe("Shree Ganesh Heights");
    expect(r.body.construction_percent).toBe(28.57);
    expect(r.body.blocks).toHaveLength(1);
    expect(r.body.blocks[0]).toMatchObject({
      block_id: w.sgh.towerId,
      block_name: "Tower A",
      block_code: "A",
      construction_percent: 28.57,
      total_stages: 14,
      completed_stages: 4,
      current_stage_id: w.stages["2nd Slab"],
      current_stage_name: "2nd Slab",
      next_stage_id: w.stages["3rd Slab"],
      next_stage_name: "3rd Slab",
      in_progress_stage_name: "2nd Slab",
      last_completed_on: today,
      active_bookings: 2,
    });
    const ggv = await t.request<{
      construction_percent: number;
      blocks: { completed_stages: number; active_bookings: number; current_stage_id: string | null }[];
    }>("GET", `/api/v1/projects/${w.ggv.id}/construction`, { token: admin });
    expect(ggv.status).toBe(200);
    expect(ggv.body.construction_percent).toBe(0);
    expect(ggv.body.blocks[0]).toMatchObject({ completed_stages: 0, active_bookings: 0, current_stage_id: null });
    expect((await t.request("GET", `/api/v1/projects/${w.sgh.id}/construction`, { token: paGgv })).status).toBe(404);
    expect((await t.request("GET", `/api/v1/projects/${NO_ID}/construction`, { token: admin })).status).toBe(404);
    expect((await t.request("GET", `/api/v1/projects/${w.sgh.id}/construction`, { token: sales })).status).toBe(200);

    const portal = await blockStageTimeline(t.app.db, w.sgh.towerId, { visibleToBuyersOnly: true });
    expect(portal).not.toBeNull();
    expect(portal!.block_name).toBe("Tower A");
    expect(portal!.construction_percent).toBe(28.57);
    expect(portal!.current_stage_name).toBe("2nd Slab");
    expect(portal!.next_stage_name).toBe("3rd Slab");
    expect(portal!.stages.map((s) => s.name)).toEqual([...STAGE_NAMES]);
    const plinth = portal!.stages.find((s) => s.name === "Plinth")!;
    expect(plinth.photos).toHaveLength(1); // the hidden one is filtered out
    expect(plinth.photos[0]).toMatchObject({
      visible_to_buyers: true,
      caption: "Plinth beam",
      taken_on: addDays(today, -1),
    });
    expect(plinth.photos[0]!.thumb_url).toMatch(/\/api\/v1\/files\//);
    expect(portal!.stages.find((s) => s.name === "Foundation")!.notes).toBe("RCC footing M30");
    const all = await blockStageTimeline(t.app.db, w.sgh.towerId);
    expect(all!.stages.find((s) => s.name === "Plinth")!.photos).toHaveLength(2);
    const web = await blockStageTimeline(t.app.db, w.sgh.towerId, { websiteOnly: true });
    expect(web!.stages.find((s) => s.name === "Plinth")!.photos.map((p) => p.caption)).toEqual(["Site office view"]);
    expect(web!.stages.find((s) => s.name === "Foundation")!.photos).toHaveLength(1);
    expect(await blockStageTimeline(t.app.db, NO_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adversarial review: ordering, concurrency, display-only %, undo twice
// ---------------------------------------------------------------------------

describe("adversarial: date ordering, concurrent updates, display-only percent, undo twice", () => {
  it("intermediate dates must be non-decreasing along the stage sequence (400 VALIDATION_ERROR); the reached stage's own entry must equal completed_on; nothing is written", async () => {
    const before = await demandCount();
    const version = await versionOf();
    // 4th Slab follows 3rd Slab but is dated earlier
    const outOfOrder = await status({
      stage_id: w.stages["Top Slab"],
      completed_on: today,
      intermediate_dates: { [w.stages["3rd Slab"]]: addDays(today, -1), [w.stages["4th Slab"]]: addDays(today, -3) },
    });
    expect(outOfOrder.status, outOfOrder.text).toBe(400);
    expect(outOfOrder.body.error.code).toBe("VALIDATION_ERROR");
    // an undated stage inherits the next dated stage's date, so an earlier stage dated after it is out of order too
    const inherited = await status({
      stage_id: w.stages["Top Slab"],
      completed_on: today,
      intermediate_dates: { [w.stages["2nd Slab"]]: today, [w.stages["4th Slab"]]: addDays(today, -2) },
    });
    expect(inherited.status, inherited.text).toBe(400);
    const targetMismatch = await status({
      stage_id: w.stages["Top Slab"],
      completed_on: today,
      intermediate_dates: { [w.stages["Top Slab"]]: addDays(today, -1) },
    });
    expect(targetMismatch.status, targetMismatch.text).toBe(400);
    // a well-ordered sequence (equal dates allowed) is fine – checked by the possession jump below; here the state is untouched
    expect(await demandCount()).toBe(before);
    const c = await construction(w.sgh.towerId);
    expect(c.version).toBe(version);
    expect(c.construction_percent).toBe(28.57);
    expect(c.stages.filter((s) => s.status === "COMPLETED")).toHaveLength(4);
  });

  it("two concurrent status updates with the same version: exactly one completes the stage and raises dues, the other is 409 VERSION_CONFLICT; a tampered display % never changes what money raises", async () => {
    const before = await demandCount();
    const version = await versionOf();
    await t.app.sql`update blocks set construction_percent = 99 where id = ${w.sgh.towerId}`; // display-only figure; dues come from the stage records
    const body = { stage_id: w.stages["2nd Slab"], completed_on: today };
    const [a, b] = await Promise.all([status(body, { version }), status(body, { version })]);
    const ok = [a, b].filter((r) => r.status === 200);
    const conflict = [a, b].filter((r) => r.status === 409);
    expect(ok, `${a.status} ${a.text} / ${b.status} ${b.text}`).toHaveLength(1);
    expect(conflict).toHaveLength(1);
    expect(conflict[0]!.body.error.code).toBe("VERSION_CONFLICT");
    expect(ok[0]!.body.demands_raised).toBe(2);
    expect(ok[0]!.body.construction_percent).toBe(35.71);
    expect(await demandCount()).toBe(before + 2);
    const slab2 = await stageOf("2nd Slab");
    expect(slab2).toMatchObject({ status: "COMPLETED", completed_on: today, demands_raised: 2, can_undo: true });
    expect(await auditRows("block_stage.complete", slab2.id)).toBe(1);
    for (const bk of [b1, b2]) {
      const live = (await demandsOf(bk.id)).filter((d) => d.installment_seq === 6 && d.status !== "VOID");
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({
        cash_demand_paise: 6 * L,
        account_demand_paise: 4 * L,
        demand_date: today,
        trigger_stage_id: w.stages["2nd Slab"],
      });
    }
    const c = await construction(w.sgh.towerId);
    expect(c.construction_percent).toBe(35.71);
    expect(c.version).toBe(version + 1);
  });

  it("undo twice: the second undo of the same stage is 422 STAGE_NOT_COMPLETED (409 VERSION_CONFLICT with the stale version); demands are voided once and the undo audited once", async () => {
    const slab2 = await stageOf("2nd Slab");
    const version = await versionOf();
    const r = await undo(w.stages["2nd Slab"], "Slab certification still pending", { version });
    expect(r.status, r.text).toBe(200);
    expect(r.body.voided_demand_numbers).toHaveLength(2);
    expect(r.body.construction_percent).toBe(28.57);
    const stale = await undo(w.stages["2nd Slab"], "Slab certification still pending", { version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const again = await undo(w.stages["2nd Slab"], "Slab certification still pending");
    expect(again.status).toBe(422);
    expect(again.body.error.details?.["rule"]).toBe("STAGE_NOT_COMPLETED");
    for (const bk of [b1, b2]) {
      const seq6 = (await demandsOf(bk.id)).filter((d) => d.installment_seq === 6);
      expect(seq6).toHaveLength(1);
      expect(seq6[0]!.status).toBe("VOID");
    }
    expect(await auditRows("construction.undo", slab2.id)).toBe(1);
    expect(await stageOf("2nd Slab")).toMatchObject({
      status: "PENDING",
      completed_on: null,
      demands_raised: 0,
      can_undo: false,
    });
    expect((await stageOf("1st Slab")).can_undo).toBe(true);
    // put the tower back for the possession scenario below
    const re = await status({ stage_id: w.stages["2nd Slab"], completed_on: today });
    expect(re.status, re.text).toBe(200);
    expect(re.body.demands_raised).toBe(2);
  });
});

describe("possession stage: ON_POSSESSION installments and on-possession other charges (money engine) and their undo", () => {
  let registryLine: OtherCharge;
  const remaining = [
    "3rd Slab",
    "4th Slab",
    "Top Slab",
    "Brickwork",
    "Plastering",
    "Flooring",
    "Finishing",
    "External Development",
    "Possession",
  ] as const;

  it("an ON_POSSESSION other charge added to a booking stays undemanded until the possession stage completes", async () => {
    const type = await t.request<{ id: string }>("POST", "/api/v1/masters/charge-types", {
      token: admin,
      body: {
        name: "Registry & Stamp Duty",
        code: "REGISTRY",
        default_amount_paise: 25 * L,
        demand_at: "ON_POSSESSION",
      },
    });
    expect(type.status, type.text).toBe(201);
    const bk = await booking(b2.id);
    const r = await t.request<Booking>("POST", `/api/v1/bookings/${b2.id}/other-charges`, {
      token: admin,
      headers: { "if-match": `"${bk.version}"`, "idempotency-key": key() },
      body: { charge_type_id: type.body.id, amount_paise: 25 * L, gst_percent: 0, demand_at: "ON_POSSESSION" },
    });
    expect(r.status, r.text).toBe(201);
    registryLine = r.body.other_charges.find((c) => c.name === "Registry & Stamp Duty")!;
    expect(registryLine).toBeDefined();
    expect(registryLine.demand_number).toBeNull();
    expect(r.body.summary.other_charges_due_paise).toBe(0);
  });

  it("jumping to Possession completes every remaining stage in order, raises the remaining installments including ON_POSSESSION (attributed to the possession stage) and demands the on-possession charge", async () => {
    const before = await demandCount();
    const r = await status({
      stage_id: w.stages.Possession,
      completed_on: today,
      intermediate_dates: { [w.stages["3rd Slab"]]: addDays(today, -1), [w.stages["Top Slab"]]: today },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.completed_stage_ids).toEqual(remaining.map((n) => w.stages[n]));
    expect(r.body.demands_raised).toBe(10); // seq 7–11 × 2 bookings
    expect(r.body.construction_percent).toBe(100);
    expect(await demandCount()).toBe(before + 10);
    for (const bk of [b1, b2]) {
      const live = (await demandsOf(bk.id)).filter((d) => d.status !== "VOID");
      expect(live.map((d) => d.installment_seq).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      const possession = live.find((d) => d.installment_seq === 11)!;
      expect(possession).toMatchObject({
        cash_demand_paise: 3 * L,
        account_demand_paise: 2 * L,
        demand_date: today,
        trigger_stage_id: w.stages.Possession,
        status: "OPEN",
      });
      expect(live.reduce((a, d) => a + d.cash_demand_paise, 0)).toBe(60 * L);
      expect(live.reduce((a, d) => a + d.account_demand_paise, 0)).toBe(40 * L);
      const summary = (await booking(bk.id)).summary;
      expect(summary.cash.order_raised_paise).toBe(60 * L);
      expect(summary.account.order_raised_paise).toBe(40 * L);
    }
    const c = await construction(w.sgh.towerId);
    const byName = new Map(c.stages.map((s) => [s.name, s]));
    expect(byName.get("3rd Slab")!.completed_on).toBe(addDays(today, -1));
    expect(byName.get("4th Slab")!.completed_on).toBe(today); // undated → the next dated stage's date
    expect(byName.get("Possession")).toMatchObject({
      status: "COMPLETED",
      is_possession: true,
      completed_on: today,
      demands_raised: 2,
      can_undo: true,
    });
    expect(byName.get("Plastering")!.demands_raised).toBe(0); // no installment on it
    expect(c.current_stage_id).toBe(w.stages.Possession);
    expect(c.next_stage_id).toBeNull();
    expect(c.stages.every((s) => s.status === "COMPLETED")).toBe(true);
    // money demanded the on-possession charge of b2 (b1 has none)
    const bk2 = await booking(b2.id);
    registryLine = bk2.other_charges.find((x) => x.id === registryLine.id)!;
    expect(registryLine.demand_number).toMatch(/^DM-/);
    expect(registryLine.demanded_at).toBeTruthy();
    expect(bk2.summary.other_charges_due_paise).toBe(25 * L);
    expect((await booking(b1.id)).summary.other_charges_due_paise).toBe(0);
  });

  it("undo Possession voids the ON_POSSESSION demands (resolved through the possession stage), un-demands the on-possession charge, rebuilds the ledger and withdraws bells; undoing again is 422", async () => {
    const possession = await stageOf("Possession");
    const voidedNumbers = (
      await Promise.all(
        [b1, b2].map(
          async (bk) =>
            (await demandsOf(bk.id)).find((d) => d.installment_seq === 11 && d.status !== "VOID")!.demand_number,
        ),
      )
    ).sort();
    const r = await undo(w.stages.Possession, "Occupancy certificate not yet received", { token: paSgh });
    expect(r.status, r.text).toBe(200);
    expect([...r.body.voided_demand_numbers].sort()).toEqual(voidedNumbers);
    expect(r.body.undemanded_charge_numbers).toEqual([registryLine.demand_number]);
    expect(r.body.construction_percent).toBe(92.86);
    for (const bk of [b1, b2]) {
      const ds = await demandsOf(bk.id);
      expect(ds.filter((d) => d.installment_seq === 11).every((d) => d.status === "VOID")).toBe(true);
      expect(ds.filter((d) => d.status !== "VOID")).toHaveLength(10);
      const summary = (await booking(bk.id)).summary;
      expect(summary.cash.order_raised_paise).toBe(57 * L);
      expect(summary.account.order_raised_paise).toBe(38 * L);
    }
    const bk2 = await booking(b2.id);
    const line = bk2.other_charges.find((x) => x.id === registryLine.id)!;
    expect(line).toMatchObject({ demand_number: null, demanded_at: null, due_date: null, paid_paise: 0 });
    expect(bk2.summary.other_charges_due_paise).toBe(0);
    type EpochLedger = List<LedgerRow> & { epoch: number; current_epoch: number };
    const ledger = await t.request<EpochLedger>("GET", `/api/v1/bookings/${b2.id}/ledger?page_size=200`, {
      token: admin,
    });
    expect(ledger.status, ledger.text).toBe(200);
    // contract C7: the un-demanded charge leaves the canonical ledger, so b2's book was restated as epoch 2 (reason CONSTRUCTION_CHARGE)
    expect(ledger.body).toMatchObject({ epoch: 2, current_epoch: 2 });
    expect(ledger.body.items.filter((row) => row.event === "OTHER_CHARGE_DEMAND")).toHaveLength(0);
    // the voided ON_POSSESSION demand stays in the book with its DEMAND_VOIDED row
    const voidedRows = ledger.body.items.filter(
      (row) => row.ref_number !== null && voidedNumbers.includes(row.ref_number),
    );
    expect(voidedRows.map((row) => [row.event, row.amount_paise])).toEqual([
      ["DEMAND", 5 * L],
      ["DEMAND_VOIDED", -5 * L],
    ]);
    expect(ledger.body.items[ledger.body.items.length - 1]!.other_charges_due_paise).toBe(0);
    // epoch 1 is history: it still shows the charge demand and is closed by a LEDGER_RESTATED row
    const old = await t.request<EpochLedger>("GET", `/api/v1/bookings/${b2.id}/ledger?page_size=200&epoch=1`, {
      token: admin,
    });
    expect(old.status, old.text).toBe(200);
    expect(old.body).toMatchObject({ epoch: 1, current_epoch: 2 });
    expect(old.body.items.filter((row) => row.event === "OTHER_CHARGE_DEMAND")).toHaveLength(1);
    expect(old.body.items.at(-1)).toMatchObject({
      event: "LEDGER_RESTATED",
      amount_paise: 0,
      note: "CONSTRUCTION_CHARGE",
    });
    const rebuilds = await t.request<List<{ reason: string; from_epoch: number; to_epoch: number }>>(
      "GET",
      `/api/v1/bookings/${b2.id}/ledger/rebuilds`,
      { token: admin },
    );
    expect(rebuilds.status, rebuilds.text).toBe(200);
    expect(rebuilds.body.items).toMatchObject([{ reason: "CONSTRUCTION_CHARGE", from_epoch: 1, to_epoch: 2 }]);
    // b1 had no charge: its book only gained the DEMAND_VOIDED row, no restatement
    const b1Ledger = await t.request<EpochLedger>("GET", `/api/v1/bookings/${b1.id}/ledger?page_size=200`, {
      token: admin,
    });
    expect(b1Ledger.body).toMatchObject({ epoch: 1, current_epoch: 1 });
    expect(b1Ledger.body.items.at(-1)?.event).toBe("DEMAND_VOIDED");
    expect(await auditRows("other_charge.undemand", registryLine.id)).toBe(1);
    expect(await auditRows("construction.undo", possession.id)).toBe(1);
    const c = await construction(w.sgh.towerId);
    const byName = new Map(c.stages.map((s) => [s.name, s]));
    expect(byName.get("Possession")).toMatchObject({
      status: "PENDING",
      completed_on: null,
      completed_by: null,
      demands_raised: 0,
      can_undo: false,
    });
    expect(byName.get("External Development")!.can_undo).toBe(true);
    expect(c.current_stage_id).toBe(w.stages["External Development"]);
    expect(c.next_stage_id).toBe(w.stages.Possession);
    expect((await notificationsFor(possession.id)).filter((n) => !n.is_withdrawn)).toHaveLength(0);
    const again = await undo(w.stages.Possession, "Occupancy certificate not yet received");
    expect(again.status).toBe(422);
    expect(again.body.error.details?.["rule"]).toBe("STAGE_NOT_COMPLETED");
  });

  it("once the on-possession charge has been paid, undoing Possession is blocked (409 UNDO_BLOCKED naming the charge) and nothing changes", async () => {
    const re = await status({ stage_id: w.stages.Possession, completed_on: today });
    expect(re.status, re.text).toBe(200);
    expect(re.body.demands_raised).toBe(2);
    const bk2 = await booking(b2.id);
    const line = bk2.other_charges.find((x) => x.id === registryLine.id)!;
    expect(line.demand_number).toMatch(/^DM-/);
    expect(bk2.summary.other_charges_due_paise).toBe(25 * L);
    const pay = await t.request<{ payment: { receipt_number: string; status: string } } & ErrorBody>(
      "POST",
      "/api/v1/payments",
      {
        token: accounts,
        headers: { "idempotency-key": key() },
        body: {
          booking_id: b2.id,
          against: "OTHER_CHARGE",
          other_charge_id: line.id,
          amount_paise: 25 * L,
          payment_date: today,
          payment_mode_id: w.upiModeId,
          instrument: { number: "UPI-REG-1" },
          bank_account_id: w.bankAccountId,
        },
      },
    );
    expect(pay.status, pay.text).toBe(201);
    expect(pay.body.payment.status).toBe("CLEARED");
    const blocked = await undo(w.stages.Possession, "Trying to roll back after the registry collection");
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("UNDO_BLOCKED");
    const details = blocked.body.error.details as { reasons: string[] };
    expect(details.reasons.some((x) => x.includes(line.demand_number!))).toBe(true);
    // untouched
    expect((await stageOf("Possession")).status).toBe("COMPLETED");
    for (const bk of [b1, b2])
      expect((await demandsOf(bk.id)).filter((d) => d.installment_seq === 11 && d.status !== "VOID")).toHaveLength(1);
    const after = await booking(b2.id);
    expect(after.other_charges.find((x) => x.id === registryLine.id)).toMatchObject({
      demand_number: line.demand_number,
      paid_paise: 25 * L,
      due_paise: 0,
    });
    expect((await construction(w.sgh.towerId)).construction_percent).toBe(100);
  });
});
