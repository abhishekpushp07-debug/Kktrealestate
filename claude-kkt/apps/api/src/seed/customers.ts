/** Step 4 — the 12 customers (11 here, Kavita Roy by lead conversion in leads.ts), KYC statuses and, later, portal access for all. */
import { verhoeffCheckDigit } from "@kkt/domain";
import { PORTAL_PASSWORD, SeedError, type SeedContext } from "./context.js";

/** Verhoeff-valid 12-digit Aadhaar from an 11-digit base (first digit 2–9). */
export function aadhaarFrom(base11: string): string {
  if (!/^[2-9][0-9]{10}$/.test(base11)) throw new SeedError(`bad aadhaar base ${base11}`);
  return `${base11}${verhoeffCheckDigit(base11)}`;
}

export interface CustomerSpec {
  name: string; phone: string; email: string; gender: "MALE" | "FEMALE"; father: string; dob: string; occupation: string; company: string | null; income: string;
  pan: string; aadhaarBase: string; bank: { bank_name: string; ifsc: string; account_number: string } | null; nominee: { name: string; relation: string } | null;
  address: { line1: string; locality: string; city: string; state: string; pincode: string }; kyc: "VERIFIED" | "SUBMITTED" | "PENDING"; tags: string[];
}

/** docs/SEED.md customers 1–11 in order (12 = Kavita Roy, converted from a lead). */
export const CUSTOMERS: readonly CustomerSpec[] = [
  { name: "Rajesh Kumar Sinha", phone: "9876543210", email: "rajesh.sinha@example.com", gender: "MALE", father: "Late Ram Prasad Sinha", dob: "1978-04-12", occupation: "Chartered Accountant", company: "Sinha & Associates", income: "25L+", pan: "ABCPS1234K", aadhaarBase: "23456789012", bank: { bank_name: "HDFC Bank", ifsc: "HDFC0000123", account_number: "50100123456789" }, nominee: { name: "Sunita Sinha", relation: "Wife" }, address: { line1: "12 Boring Road", locality: "Sri Krishna Puri", city: "Patna", state: "Bihar", pincode: "800001" }, kyc: "VERIFIED", tags: ["vip", "repeat"] },
  { name: "Priya Verma", phone: "9876543211", email: "priya.verma@example.com", gender: "FEMALE", father: "Anil Verma", dob: "1986-09-23", occupation: "Doctor", company: "Paras HMRI Hospital", income: "15-25L", pan: "BCDPV2345L", aadhaarBase: "34567890123", bank: { bank_name: "State Bank of India", ifsc: "SBIN0000152", account_number: "32112345678" }, nominee: { name: "Anil Verma", relation: "Father" }, address: { line1: "C-4 Patliputra Colony", locality: "Patliputra", city: "Patna", state: "Bihar", pincode: "800013" }, kyc: "VERIFIED", tags: ["doctor"] },
  { name: "Amit Kumar", phone: "9876543212", email: "amit.kumar@example.com", gender: "MALE", father: "Suresh Kumar", dob: "1990-01-30", occupation: "Software Engineer", company: "Infosys", income: "15-25L", pan: "CDEPK3456M", aadhaarBase: "45678901234", bank: { bank_name: "ICICI Bank", ifsc: "ICIC0000321", account_number: "032101234567" }, nominee: { name: "Suresh Kumar", relation: "Father" }, address: { line1: "Flat 301, Shanti Apartments", locality: "Kankarbagh", city: "Patna", state: "Bihar", pincode: "800020" }, kyc: "VERIFIED", tags: ["nri-family"] },
  { name: "Sunita Devi", phone: "9876543213", email: "sunita.devi@example.com", gender: "FEMALE", father: "Mahesh Prasad", dob: "1975-07-08", occupation: "School Principal", company: "DAV Public School", income: "10-15L", pan: "DEFPD4567N", aadhaarBase: "56789012345", bank: { bank_name: "Punjab National Bank", ifsc: "PUNB0045600", account_number: "4560001234567" }, nominee: { name: "Ravi Prasad", relation: "Son" }, address: { line1: "House 22, Road 5", locality: "Rajendra Nagar", city: "Patna", state: "Bihar", pincode: "800016" }, kyc: "VERIFIED", tags: [] },
  { name: "Vikram Singh", phone: "9876543214", email: "vikram.singh@example.com", gender: "MALE", father: "Col. Harbhajan Singh", dob: "1982-11-19", occupation: "Business Owner", company: "Singh Logistics", income: "25L+", pan: "EFGPS5678P", aadhaarBase: "67890123456", bank: { bank_name: "Axis Bank", ifsc: "UTIB0000234", account_number: "917010012345678" }, nominee: { name: "Harpreet Kaur", relation: "Wife" }, address: { line1: "Singh Villa, Exhibition Road", locality: "Gandhi Maidan", city: "Patna", state: "Bihar", pincode: "800001" }, kyc: "VERIFIED", tags: ["business"] },
  { name: "Neha Gupta", phone: "9876543215", email: "neha.gupta@example.com", gender: "FEMALE", father: "Rakesh Gupta", dob: "1992-03-14", occupation: "Bank Manager", company: "HDFC Bank", income: "10-15L", pan: "FGHPG6789Q", aadhaarBase: "78901234567", bank: null, nominee: null, address: { line1: "B-12 Anandpuri", locality: "West Boring Canal Road", city: "Patna", state: "Bihar", pincode: "800001" }, kyc: "SUBMITTED", tags: [] },
  { name: "Manoj Prasad", phone: "9876543216", email: "manoj.prasad@example.com", gender: "MALE", father: "Shiv Prasad", dob: "1988-06-02", occupation: "Government Officer", company: "Bihar Govt", income: "10-15L", pan: "GHIPP7890R", aadhaarBase: "89012345678", bank: { bank_name: "Bank of India", ifsc: "BKID0004550", account_number: "455010110001234" }, nominee: { name: "Rekha Prasad", relation: "Wife" }, address: { line1: "Qtr 14, Secretariat Colony", locality: "Bailey Road", city: "Patna", state: "Bihar", pincode: "800015" }, kyc: "VERIFIED", tags: [] },
  { name: "Anjali Sharma", phone: "9876543217", email: "anjali.sharma@example.com", gender: "FEMALE", father: "Dinesh Sharma", dob: "1984-12-25", occupation: "Architect", company: "Sharma Design Studio", income: "25L+", pan: "HIJPS8901S", aadhaarBase: "90123456789", bank: { bank_name: "HDFC Bank", ifsc: "HDFC0000123", account_number: "50100987654321" }, nominee: { name: "Dinesh Sharma", relation: "Father" }, address: { line1: "7 Fraser Road", locality: "Dak Bungalow", city: "Patna", state: "Bihar", pincode: "800001" }, kyc: "VERIFIED", tags: ["vip"] },
  { name: "Rakesh Yadav", phone: "9876543218", email: "rakesh.yadav@example.com", gender: "MALE", father: "Ramashish Yadav", dob: "1979-08-17", occupation: "Contractor", company: "Yadav Constructions", income: "25L+", pan: "IJKPY9012T", aadhaarBase: "21345678901", bank: { bank_name: "State Bank of India", ifsc: "SBIN0000152", account_number: "32198765432" }, nominee: { name: "Sita Yadav", relation: "Wife" }, address: { line1: "Main Road", locality: "Danapur Bazar", city: "Patna", state: "Bihar", pincode: "801503" }, kyc: "VERIFIED", tags: [] },
  { name: "Pooja Mishra", phone: "9876543219", email: "pooja.mishra@example.com", gender: "FEMALE", father: "Satyendra Mishra", dob: "1991-02-09", occupation: "Lecturer", company: "Patna University", income: "5-10L", pan: "JKLPM0123U", aadhaarBase: "32456789012", bank: { bank_name: "Canara Bank", ifsc: "CNRB0001234", account_number: "1234101000567" }, nominee: { name: "Sanjay Jha", relation: "Husband" }, address: { line1: "Flat 2B, Ganga Residency", locality: "Ashok Rajpath", city: "Patna", state: "Bihar", pincode: "800004" }, kyc: "SUBMITTED", tags: [] },
  { name: "Sanjay Jha", phone: "9876543220", email: "sanjay.jha@example.com", gender: "MALE", father: "Ramesh Jha", dob: "1989-10-05", occupation: "Pharmacist", company: "Apollo Pharmacy", income: "5-10L", pan: "KLMPJ1234V", aadhaarBase: "43567890123", bank: null, nominee: null, address: { line1: "Flat 2B, Ganga Residency", locality: "Ashok Rajpath", city: "Patna", state: "Bihar", pincode: "800004" }, kyc: "PENDING", tags: ["co-applicant"] },
];

/** Kavita Roy (customer 12) is created by converting a lead; same KYC shape so her portal/KYC steps are identical. */
export const KAVITA: CustomerSpec = { name: "Kavita Roy", phone: "9876543221", email: "kavita.roy@example.com", gender: "FEMALE", father: "Subrata Roy", dob: "1987-05-21", occupation: "Marketing Manager", company: "Dabur India", income: "10-15L", pan: "LMNPR2345W", aadhaarBase: "54678901234", bank: null, nominee: null, address: { line1: "Flat 5C, Lotus Enclave", locality: "Boring Canal Road", city: "Patna", state: "Bihar", pincode: "800001" }, kyc: "PENDING", tags: ["referral"] };

/** The customer create body of a spec (PAN/Aadhaar/bank are encrypted by the API). */
export function customerBody(c: CustomerSpec, ctx: SeedContext): Record<string, unknown> {
  return {
    full_name: c.name, father_or_spouse_name: c.father, dob: c.dob, gender: c.gender, phone: c.phone, email: c.email,
    address_current: c.address, same_as_current: true, occupation: c.occupation, company_name: c.company, income_band: c.income, source: "WALK_IN",
    relationship_manager_id: ctx.staffUser("sales@sgb.in").id, pan: c.pan, aadhaar: aadhaarFrom(c.aadhaarBase),
    bank: c.bank ? { ...c.bank, holder_name: c.name } : null, nominee: c.nominee, tags: c.tags,
  };
}

/** Moves a customer's KYC to the target status (PENDING → SUBMITTED → VERIFIED) through POST /customers/:id/kyc. */
export async function setKyc(ctx: SeedContext, phone: string, target: CustomerSpec["kyc"]): Promise<void> {
  const c = ctx.customer(phone);
  if (target === "PENDING") return;
  const submitted = await ctx.post<{ version: number }>(`/api/v1/customers/${c.id}/kyc`, { version: c.version, kyc_status: "SUBMITTED" }, "sales", { idempotent: false });
  c.version = submitted.version;
  if (target === "VERIFIED") {
    const verified = await ctx.post<{ version: number }>(`/api/v1/customers/${c.id}/kyc`, { version: c.version, kyc_status: "VERIFIED", kyc_remarks: "PAN and Aadhaar verified against originals" }, "admin", { idempotent: false });
    c.version = verified.version;
  }
}

export async function seedCustomers(ctx: SeedContext): Promise<void> {
  ctx.log("customers: 11 with valid PAN / Verhoeff Aadhaar, KYC statuses (Kavita Roy arrives by lead conversion)");
  for (const spec of CUSTOMERS) {
    const r = await ctx.post<{ id: string; customer_code: string; version: number }>("/api/v1/customers", customerBody(spec, ctx), "sales");
    ctx.customers[spec.phone] = { id: r.id, code: r.customer_code, name: spec.name, phone: spec.phone, email: spec.email, version: r.version };
    ctx.customerOrder.push(spec.phone);
    await setKyc(ctx, spec.phone, spec.kyc);
  }
}

/**
 * Portal access for every customer: enable (temporary password shown once) → log in with it → change it to Welcome@123 through the
 * portal's own change-password route, so `must_change_password` is cleared the way a real buyer clears it.
 */
export async function enablePortalForAll(ctx: SeedContext): Promise<void> {
  ctx.log("portal access: enable for all 12 customers and set the password Welcome@123 via /portal/auth/change-password");
  for (const phone of ctx.customerOrder) {
    const c = ctx.customer(phone);
    const enabled = await ctx.post<{ temp_password: string | null; must_change_password: boolean }>(`/api/v1/customers/${c.id}/portal/enable`, {}, "admin", { idempotent: false });
    if (!enabled.temp_password) throw new SeedError(`portal enable for ${phone} returned no temporary password`);
    const login = await ctx.call<{ access_token: string }>("POST", "/api/v1/portal/auth/login", { body: { phone, password: enabled.temp_password }, ip: ctx.freshIp(), idempotent: false });
    await ctx.call("POST", "/api/v1/portal/auth/change-password", { token: login.access_token, body: { current_password: enabled.temp_password, new_password: PORTAL_PASSWORD }, ip: ctx.freshIp(), idempotent: false });
  }
}

/** Logs a customer into the portal with the demo password. */
export async function portalLogin(ctx: SeedContext, phone: string): Promise<string> {
  const r = await ctx.call<{ access_token: string }>("POST", "/api/v1/portal/auth/login", { body: { phone, password: PORTAL_PASSWORD }, ip: ctx.freshIp(), idempotent: false });
  return r.access_token;
}
