import { verhoeffCheckDigit } from "@kkt/domain";
import type { TestContext } from "../helpers.js";

let seq = 0;

/** A Verhoeff-valid 12-digit Aadhaar number derived from an 11-digit base (first digit 2-9). */
export function validAadhaar(base11 = "23456789012"): string {
  return `${base11}${verhoeffCheckDigit(base11)}`;
}

/** The same number with a wrong check digit (fails the Verhoeff checksum but matches the 12-digit shape). */
export function invalidAadhaar(base11 = "23456789012"): string {
  const check = verhoeffCheckDigit(base11);
  return `${base11}${(check + 1) % 10}`;
}

/**
 * Inserts an ACTIVE booking for a customer directly in the database (block type, flat type, payment plan, block and flat are created too).
 * The bookings module is built separately; the CRM tests only need "this customer has an active booking in this project".
 */
export async function createActiveBooking(
  t: TestContext,
  customerId: string,
  projectId: string,
  opts: { coApplicantId?: string } = {},
): Promise<{ bookingId: string; blockId: string; flatId: string }> {
  seq += 1;
  const sql = t.app.sql;
  const [bt] = await sql<
    { id: string }[]
  >`insert into block_types (company_id, name, code) values (${t.companyId}, ${`Tower ${seq}`}, ${`TWR${seq}`}) returning id`;
  const [ft] = await sql<
    { id: string }[]
  >`insert into flat_types (company_id, name, code, bhk) values (${t.companyId}, ${`3BHK-T${seq}`}, ${`3BHK-T${seq}`}, 3) returning id`;
  const [plan] = await sql<
    { id: string }[]
  >`insert into payment_plans (company_id, name, code, plan_type) values (${t.companyId}, ${`Plan ${seq}`}, ${`PLAN${seq}`}, 'CONSTRUCTION_LINKED') returning id`;
  const [block] = await sql<
    { id: string }[]
  >`insert into blocks (company_id, project_id, block_type_id, name, code, floors) values (${t.companyId}, ${projectId}, ${bt!.id}, ${`Block ${seq}`}, ${`B${seq}`}, 8) returning id`;
  const [flat] = await sql<
    { id: string }[]
  >`insert into flats (company_id, project_id, block_id, flat_number, floor, flat_type_id, flat_type_code, status, price_paise)
    values (${t.companyId}, ${projectId}, ${block!.id}, ${`B${seq}-101`}, 1, ${ft!.id}, ${`3BHK-T${seq}`}, 'BOOKED', 650000000) returning id`;
  const flatSnapshot = {
    flat_number: `B${seq}-101`,
    floor: 1,
    flat_type_id: ft!.id,
    flat_type_code: `3BHK-T${seq}`,
    carpet_sqft: 1050,
    builtup_sqft: 1250,
    super_builtup_sqft: 1520,
    price_paise: 650000000,
    price_breakup: [],
    rooms: [],
    areas: [],
  };
  const planSnapshot = {
    plan_id: plan!.id,
    name: `Plan ${seq}`,
    code: `PLAN${seq}`,
    plan_type: "CONSTRUCTION_LINKED",
    grace_days: 0,
    installments: [],
  };
  const [booking] = await sql<
    { id: string }[]
  >`insert into bookings (company_id, booking_number, project_id, block_id, flat_id, customer_id, booking_date, status, agreement_value_paise, cash_agreed_paise, account_agreed_paise, flat_snapshot, payment_plan_id, plan_snapshot)
    values (${t.companyId}, ${`BK-TEST/${String(seq).padStart(4, "0")}`}, ${projectId}, ${block!.id}, ${flat!.id}, ${customerId}, current_date, 'ACTIVE', 650000000, 400000000, 250000000, ${JSON.stringify(flatSnapshot)}::jsonb, ${plan!.id}, ${JSON.stringify(planSnapshot)}::jsonb) returning id`;
  if (opts.coApplicantId)
    await sql`insert into booking_co_applicants (booking_id, customer_id) values (${booking!.id}, ${opts.coApplicantId})`;
  return { bookingId: booking!.id, blockId: block!.id, flatId: flat!.id };
}
