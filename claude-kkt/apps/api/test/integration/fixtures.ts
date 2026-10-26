import type { TestContext } from "./helpers.js";

/** Minimal master-data fixtures created through the API (so audit/idempotency paths are exercised too). */
export interface Basics {
  roomTypeId: string;
  areaTypes: { CARPET: string; BUILT_UP: string; SUPER_BUILT_UP: string };
  flatTypeId: string;
  stageIds: string[];
  possessionStageId: string;
  specCategoryId: string;
}

async function post<T = Record<string, unknown>>(
  t: TestContext,
  token: string,
  url: string,
  body: unknown,
): Promise<T> {
  const r = await t.request<T>("POST", url, { token, body });
  if (r.status !== 201) throw new Error(`POST ${url} → ${r.status} ${r.text}`);
  return r.body;
}

/** Creates room/area types, a valid flat type, construction stages (one possession) and a spec category. */
export async function createBasics(t: TestContext, token: string, suffix = ""): Promise<Basics> {
  const room = await post<{ id: string }>(t, token, "/api/v1/masters/room-types", {
    name: `Bedroom${suffix}`,
    code: `BED${suffix}`,
    sort_order: 1,
  });
  const carpet = await post<{ id: string }>(t, token, "/api/v1/masters/area-types", {
    name: `Carpet${suffix}`,
    code: `CARPET${suffix}`,
    sort_order: 1,
  });
  const builtup = await post<{ id: string }>(t, token, "/api/v1/masters/area-types", {
    name: `Built-up${suffix}`,
    code: `BUILT_UP${suffix}`,
    sort_order: 2,
  });
  const superB = await post<{ id: string }>(t, token, "/api/v1/masters/area-types", {
    name: `Super built-up${suffix}`,
    code: `SUPER_BUILT_UP${suffix}`,
    sort_order: 3,
  });
  const flatType = await post<{ id: string }>(t, token, "/api/v1/masters/flat-types", {
    name: `3BHK-A${suffix}`,
    code: `3BHK-A${suffix}`,
    bhk: 3,
    facing: "East",
    rooms: [{ room_type_id: room.id, label: "Master Bedroom", length_ft: 12, width_ft: 14 }],
    areas: [
      { area_type_id: carpet.id, sqft: 1050 },
      { area_type_id: builtup.id, sqft: 1250 },
      { area_type_id: superB.id, sqft: 1520 },
    ],
    base_rate_per_sqft_paise: 560000,
  });
  const stageIds: string[] = [];
  for (const [i, name] of ["Excavation", "Foundation", "Plinth"].entries()) {
    const s = await post<{ id: string }>(t, token, "/api/v1/masters/construction-stages", {
      name: `${name}${suffix}`,
      code: `${name.toUpperCase()}${suffix}`,
      sort_order: (i + 1) * 10,
    });
    stageIds.push(s.id);
  }
  const possession = await post<{ id: string }>(t, token, "/api/v1/masters/construction-stages", {
    name: `Possession${suffix}`,
    code: `POSSESSION${suffix}`,
    sort_order: 140,
    is_possession: true,
  });
  const cat = await post<{ id: string }>(t, token, "/api/v1/masters/spec-categories", {
    name: `Flooring${suffix}`,
    sort_order: 1,
  });
  return {
    roomTypeId: room.id,
    areaTypes: { CARPET: carpet.id, BUILT_UP: builtup.id, SUPER_BUILT_UP: superB.id },
    flatTypeId: flatType.id,
    stageIds,
    possessionStageId: possession.id,
    specCategoryId: cat.id,
  };
}

/** Inserts a customer with portal access (phone 9876543210 unless given) directly in the database. */
export async function createPortalCustomer(
  t: TestContext,
  opts: { phone?: string; password?: string; mustChangePassword?: boolean; name?: string } = {},
): Promise<{ customerId: string; portalUserId: string; phone: string }> {
  const { hashPassword } = await import("../../src/lib/password.js");
  const phone = opts.phone ?? "9876543210";
  const hash = await hashPassword(opts.password ?? "Welcome@123");
  const [c] = await t.app.sql<
    { id: string }[]
  >`insert into customers (company_id, customer_code, full_name, phone) values (${t.companyId}, ${`CUST-${phone.slice(-4)}`}, ${opts.name ?? "Rajesh Kumar Sinha"}, ${phone}) returning id`;
  const [pu] = await t.app.sql<
    { id: string }[]
  >`insert into portal_users (company_id, customer_id, phone, password_hash, must_change_password) values (${t.companyId}, ${c!.id}, ${phone}, ${hash}, ${opts.mustChangePassword ?? false}) returning id`;
  return { customerId: c!.id, portalUserId: pu!.id, phone };
}

/** Inserts a project directly (the projects module is built by a later phase). */
export async function createProject(t: TestContext, name: string, code: string): Promise<string> {
  const [p] = await t.app.sql<
    { id: string }[]
  >`insert into projects (company_id, name, code, city) values (${t.companyId}, ${name}, ${code}, 'Patna') returning id`;
  return p!.id;
}
