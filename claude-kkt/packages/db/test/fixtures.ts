// Minimal fixture rows: company → block type / flat type / plan → project → block → flat → customer → booking.
import { randomUUID } from "node:crypto";
import type { DB } from "../src/client.js";
import {
  blockTypes,
  blocks,
  bookings,
  companies,
  customers,
  flatTypes,
  flats,
  paymentPlans,
  projects,
} from "../src/schema/index.js";

export interface Fixture {
  companyId: string;
  projectId: string;
  blockId: string;
  flatId: string;
  flatTypeId: string;
  customerId: string;
  planId: string;
  bookingId: string;
}

const short = (): string => randomUUID().slice(0, 8).toUpperCase();

/** Inserts one of everything needed for a booking and returns the ids. */
export async function createFixture(db: DB): Promise<Fixture> {
  const tag = short();
  const [company] = await db.insert(companies).values({ name: `Test Builders ${tag}` }).returning({ id: companies.id });
  if (!company) throw new Error("company insert failed");
  const companyId = company.id;

  const [blockType] = await db
    .insert(blockTypes)
    .values({ companyId, name: "Tower", code: `TOWER-${tag}` })
    .returning({ id: blockTypes.id });
  const [flatType] = await db
    .insert(flatTypes)
    .values({ companyId, name: "3BHK", code: `3BHK-${tag}`, carpetSqft: 1000, builtupSqft: 1100, superBuiltupSqft: 1250 })
    .returning({ id: flatTypes.id });
  const [plan] = await db
    .insert(paymentPlans)
    .values({ companyId, name: "Standard CLP", code: `CLP-${tag}`, planType: "CONSTRUCTION_LINKED" })
    .returning({ id: paymentPlans.id });
  if (!blockType || !flatType || !plan) throw new Error("master insert failed");

  const [project] = await db
    .insert(projects)
    .values({ companyId, name: `Project ${tag}`, code: `PRJ-${tag}` })
    .returning({ id: projects.id });
  if (!project) throw new Error("project insert failed");
  const [block] = await db
    .insert(blocks)
    .values({ companyId, projectId: project.id, blockTypeId: blockType.id, name: "A", code: "A", floors: 8 })
    .returning({ id: blocks.id });
  if (!block) throw new Error("block insert failed");
  const [flat] = await db
    .insert(flats)
    .values({
      companyId,
      projectId: project.id,
      blockId: block.id,
      flatNumber: "A-101",
      floor: 1,
      position: 1,
      flatTypeId: flatType.id,
      flatTypeCode: "3BHK",
      pricePaise: 10_000_000_00,
    })
    .returning({ id: flats.id });
  if (!flat) throw new Error("flat insert failed");
  const [customer] = await db
    .insert(customers)
    .values({ companyId, customerCode: `CUST-${tag}`, fullName: "Asha Verma", phone: "9876543210" })
    .returning({ id: customers.id });
  if (!customer) throw new Error("customer insert failed");

  const bookingId = await createBooking(db, {
    companyId,
    projectId: project.id,
    blockId: block.id,
    flatId: flat.id,
    customerId: customer.id,
    planId: plan.id,
    flatTypeId: flatType.id,
  });

  return {
    companyId,
    projectId: project.id,
    blockId: block.id,
    flatId: flat.id,
    flatTypeId: flatType.id,
    customerId: customer.id,
    planId: plan.id,
    bookingId,
  };
}

export type BookingRefs = Omit<Fixture, "bookingId">;

/** Inserts an ACTIVE booking (or `status`) for the given refs and returns its id. */
export async function createBooking(db: DB, refs: BookingRefs, status: "ACTIVE" | "CANCELLED" | "COMPLETED" = "ACTIVE"): Promise<string> {
  const [row] = await db
    .insert(bookings)
    .values({
      companyId: refs.companyId,
      bookingNumber: `BK-2526/${short()}`,
      projectId: refs.projectId,
      blockId: refs.blockId,
      flatId: refs.flatId,
      customerId: refs.customerId,
      bookingDate: "2025-06-01",
      status,
      agreementValuePaise: 10_000_000_00,
      cashAgreedPaise: 6_000_000_00,
      accountAgreedPaise: 4_000_000_00,
      flatSnapshot: {
        flat_number: "A-101",
        floor: 1,
        flat_type_id: refs.flatTypeId,
        flat_type_code: "3BHK",
        carpet_sqft: 1000,
        builtup_sqft: 1100,
        super_builtup_sqft: 1250,
        price_paise: 10_000_000_00,
        price_breakup: [],
        rooms: [],
        areas: [],
      },
      paymentPlanId: refs.planId,
      planSnapshot: {
        plan_id: refs.planId,
        name: "Standard CLP",
        code: "CLP",
        plan_type: "CONSTRUCTION_LINKED",
        grace_days: 0,
        installments: [{ seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING", due_days: 15 }],
      },
    })
    .returning({ id: bookings.id });
  if (!row) throw new Error("booking insert failed");
  return row.id;
}
