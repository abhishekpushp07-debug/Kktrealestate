import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verhoeffCheckDigit } from "@kkt/domain";
import {
  BOOT_TIMEOUT,
  bookingBySeq,
  bootAcceptance,
  customerByPhone,
  findKeys,
  pathOf,
  type Booking,
  type ErrorBody,
  type Harness,
  type List,
} from "./harness.js";

/**
 * SPEC §18 scenario 10 (L251): "KYC masked for Sales; revealed only to permitted users on explicit request and audit-logged; buyers never see
 * unmasked values; public APIs never expose internal fields; a buyer cannot access another buyer's booking or PDFs."
 * SPEC L37 field-level encryption + masked API + audited reveal, L42 public allow-list, L232 buyer rules, L12 separate token audiences.
 */

// docs/SEED.md / seed/customers.ts: Rajesh Kumar Sinha — PAN ABCPS1234K, Aadhaar 23456789012 + Verhoeff check digit, HDFC account 50100123456789
const RAJESH = {
  phone: "9876543210",
  pan: "ABCPS1234K",
  aadhaar: `23456789012${verhoeffCheckDigit("23456789012")}`,
  bank: "50100123456789",
};
const PRIYA_PHONE = "9876543211";
/** A real (unmasked) PAN: five letters that are not the XXXXX mask, four digits, one letter. */
const PAN_RE = /(?<![A-Z])(?!XXXXX)[A-Z]{5}[0-9]{4}[A-Z](?![A-Z])/;

type Revealed = { pan: string; aadhaar: string; bank_account_number: string; pan_masked: string; revealed_at: string };
type Masked = {
  id: string;
  pan_masked: string | null;
  aadhaar_masked: string | null;
  bank_account_masked?: string | null;
  pan?: unknown;
  aadhaar?: unknown;
};

let h: Harness;
let admin: string;
let sales: string;
let accounts: string;
let rajeshId: string;
let rajeshPortal: string;
let priyaPortal: string;
let bk1: Booking; // Rajesh's booking (GGV P1)
let bk2: Booking; // Priya's booking (SGH A-301)

async function auditReveals(): Promise<{ action: string; actor_name?: string | null }[]> {
  const r = await h.request<List<{ action: string; actor_name?: string | null }>>(
    "GET",
    `/api/v1/audit-logs/entity/customer/${rajeshId}?page_size=200`,
    { token: admin },
  );
  expect(r.status, r.text).toBe(200);
  return r.body.items.filter((a) => a.action === "customer.kyc_reveal");
}

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  sales = (await h.loginAs("sales")).access_token;
  accounts = (await h.loginAs("accounts")).access_token;
  rajeshId = (await customerByPhone(h, admin, RAJESH.phone)).id;
  rajeshPortal = (await h.portalLogin(RAJESH.phone)).access_token;
  priyaPortal = (await h.portalLogin(PRIYA_PHONE)).access_token;
  bk1 = await bookingBySeq(h, admin, 1);
  bk2 = await bookingBySeq(h, admin, 2);
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 10 — KYC masking and the audited reveal", () => {
  it("Sales sees masked PAN / Aadhaar / bank values only and cannot reveal (403, not audited)", async () => {
    const r = await h.request<Masked>("GET", `/api/v1/customers/${rajeshId}`, { token: sales });
    expect(r.status, r.text).toBe(200);
    // SPEC L37: API returns masked values (XXXXX1234X / XXXX XXXX 1234)
    expect(r.body.pan_masked).toBe("XXXXX1234K");
    expect(r.body.aadhaar_masked).toBe(`XXXX XXXX ${RAJESH.aadhaar.slice(-4)}`);
    expect(r.body.bank_account_masked).toMatch(/^X+6789$/);
    expect(r.body).not.toHaveProperty("pan");
    expect(r.body).not.toHaveProperty("aadhaar");
    expect(r.text).not.toContain(RAJESH.pan);
    expect(r.text).not.toContain(RAJESH.aadhaar);
    expect(r.text).not.toContain(RAJESH.bank);
    // the list and the 360 view never carry unmasked values either
    const list = await h.request<List<Masked>>("GET", `/api/v1/customers?search=${RAJESH.phone}`, { token: sales });
    expect(list.text).not.toMatch(PAN_RE);
    const view360 = await h.request("GET", `/api/v1/customers/${rajeshId}/360`, { token: sales });
    expect(view360.status).toBe(200);
    expect(view360.text).not.toContain(RAJESH.pan);
    // SPEC L26: Sales "cannot see unmasked KYC" — the explicit reveal is refused and leaves no reveal audit row
    const before = (await auditReveals()).length;
    const reveal = await h.request<ErrorBody>("GET", `/api/v1/customers/${rajeshId}?reveal=true`, { token: sales });
    expect(reveal.status).toBe(403);
    expect(reveal.body.error.code).toBe("FORBIDDEN");
    expect(reveal.body.error.details?.["permission"]).toBe("customer.kyc_view");
    expect((await auditReveals()).length).toBe(before);
    // Accounts (customer.read without customer.kyc_view) is refused as well
    expect((await h.request("GET", `/api/v1/customers/${rajeshId}?reveal=true`, { token: accounts })).status).toBe(403);
  });

  it("a permitted user sees the real values only with ?reveal=true, and every reveal writes a customer.kyc_reveal audit row", async () => {
    const plain = await h.request<Masked>("GET", `/api/v1/customers/${rajeshId}`, { token: admin });
    expect(plain.body.pan_masked).toBe("XXXXX1234K"); // SPEC L37: masked unless the caller "explicitly asks to reveal"
    expect(plain.body).not.toHaveProperty("pan");
    const before = (await auditReveals()).length;
    const r = await h.request<Revealed>("GET", `/api/v1/customers/${rajeshId}?reveal=true`, { token: admin });
    expect(r.status, r.text).toBe(200);
    // SPEC L37: decrypted values for a caller with customer.kyc_view (Super Admin)
    expect(r.body.pan).toBe(RAJESH.pan);
    expect(r.body.aadhaar).toBe(RAJESH.aadhaar);
    expect(r.body.bank_account_number).toBe(RAJESH.bank);
    expect(r.body.pan_masked).toBe("XXXXX1234K");
    expect(r.body.revealed_at).toBeTruthy();
    // SPEC L37: "every reveal is audit-logged"
    const after = await auditReveals();
    expect(after.length).toBe(before + 1);
    expect(after[0]?.actor_name).toBeTruthy();
    await h.request("GET", `/api/v1/customers/${rajeshId}?reveal=true`, { token: admin });
    expect((await auditReveals()).length).toBe(before + 2);
    // the audit rows themselves never carry the secrets (SPEC L134 API-CONVENTIONS: sensitive fields stripped)
    const audit = await h.request("GET", `/api/v1/audit-logs/entity/customer/${rajeshId}?page_size=200`, {
      token: admin,
    });
    expect(audit.text).not.toContain(RAJESH.pan);
    expect(audit.text).not.toContain(RAJESH.aadhaar);
    expect(audit.text).not.toContain(RAJESH.bank);
  });

  it("buyers never see unmasked values, not even their own", async () => {
    const profile = await h.request<{ pan_masked: string | null; aadhaar_masked: string | null; phone: string }>(
      "GET",
      "/api/v1/portal/profile",
      { token: rajeshPortal },
    );
    expect(profile.status, profile.text).toBe(200);
    // SPEC L232: "KYC values are masked even to themselves"
    expect(profile.body.pan_masked).toBe("XXXXX1234K");
    expect(profile.body.aadhaar_masked).toBe(`XXXX XXXX ${RAJESH.aadhaar.slice(-4)}`);
    expect(profile.text).not.toContain(RAJESH.pan);
    expect(profile.text).not.toContain(RAJESH.aadhaar);
    expect(profile.text).not.toContain(RAJESH.bank);
    // ?reveal=true means nothing on the portal (strict query keys → 400, or still masked)
    const reveal = await h.request("GET", "/api/v1/portal/profile?reveal=true", { token: rajeshPortal });
    expect(reveal.text).not.toContain(RAJESH.pan);
    for (const suffix of ["home", "flat", "ledger", "documents", "bank-details"]) {
      const r = await h.request("GET", `/api/v1/portal/bookings/${bk1.id}/${suffix}`, { token: rajeshPortal });
      expect(r.status, suffix).toBe(200);
      expect(r.text, suffix).not.toMatch(PAN_RE);
      expect(r.text, suffix).not.toContain(RAJESH.aadhaar);
    }
    // SPEC L232: no internal ids of staff users or storage paths leak through the portal
    const home = await h.request("GET", `/api/v1/portal/bookings/${bk1.id}/home`, { token: rajeshPortal });
    expect(findKeys(home.body, (k) => /storage_key|password|_hash|user_id|sales_user/i.test(k))).toEqual([]);
  });
});

describe("scenario 10 — public APIs expose no internal fields", () => {
  it("/public/site, /public/projects, the project detail, posts, gallery and people carry no ids, storage keys, costs or Hold/Booked/Blocked words", async () => {
    const bodies: [string, unknown][] = [];
    for (const url of [
      "/api/v1/public/site",
      "/api/v1/public/projects",
      "/api/v1/public/projects/shree-ganesh-heights",
      "/api/v1/public/projects/ganesh-green-villas",
      "/api/v1/public/posts",
      "/api/v1/public/gallery",
      "/api/v1/public/people",
    ]) {
      const r = await h.request("GET", url);
      expect(r.status, url).toBe(200);
      bodies.push([url, r.body]);
    }
    for (const [url, body] of bodies) {
      // SPEC L42: "strict allow-listed output (never expose internal ids of users, customers, costs, storage paths)"
      expect(
        findKeys(body, (k) => (k.endsWith("_id") && k !== "ga_id") || k === "id"),
        url,
      ).toEqual([]);
      expect(
        findKeys(body, (k) =>
          /storage_key|storage_path|cost|password|token_hash|assigned|customer_|user_|_enc$/i.test(k),
        ),
        url,
      ).toEqual([]);
      const text = JSON.stringify(body);
      expect(text, url).not.toMatch(PAN_RE);
      expect(text, url).not.toContain(RAJESH.phone);
      expect(text, url).not.toContain(rajeshId);
      expect(text, url).not.toContain(bk1.id);
    }
    // SPEC L217: the availability grid shows only Available vs Not available — Hold/Booked/Blocked/Sold never appear
    const detail = JSON.stringify(bodies[2]![1]);
    expect(detail).not.toMatch(/"(HOLD|BOOKED|BLOCKED|SOLD)"/);
    expect(detail).toContain("NOT_AVAILABLE");
    // SPEC L42: public APIs are unauthenticated and read-only
    expect(
      (await h.request("PATCH", "/api/v1/public/projects/shree-ganesh-heights", { body: {} })).status,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe("scenario 10 — a buyer cannot reach another buyer's booking or PDFs", () => {
  it("every booking route and PDF link of booking #1 is 404 for Priya; Rajesh's signed file link is refused for any other bearer; staff tokens are 401 on the portal", async () => {
    // the switchers never list the other buyer's booking (SPEC L232: only bookings where they are primary or co-applicant)
    const mine = await h.request<{ booking_id: string }[]>("GET", "/api/v1/portal/bookings", { token: priyaPortal });
    expect(mine.body.map((b) => b.booking_id)).toEqual([bk2.id]);
    const his = await h.request<{ booking_id: string }[]>("GET", "/api/v1/portal/bookings", { token: rajeshPortal });
    expect(his.body.map((b) => b.booking_id)).toEqual([bk1.id]);
    const receipt = (
      await h.request<List<{ payment_id: string }>>("GET", `/api/v1/portal/bookings/${bk1.id}/receipts`, {
        token: rajeshPortal,
      })
    ).body.items[0]!;
    const demand = (
      await h.request<List<{ demand_id: string }>>("GET", `/api/v1/portal/bookings/${bk1.id}/demands`, {
        token: rajeshPortal,
      })
    ).body.items[0]!;
    for (const suffix of [
      "home",
      "flat",
      "ledger",
      "receipts",
      "demands",
      "schedule",
      "construction",
      "documents",
      "bank-details",
      "statement.pdf",
      "allotment-letter.pdf",
      `receipts/${receipt.payment_id}/pdf`,
      `demands/${demand.demand_id}/pdf`,
    ]) {
      const r = await h.request<ErrorBody>("GET", `/api/v1/portal/bookings/${bk1.id}/${suffix}`, {
        token: priyaPortal,
      });
      // SPEC L232: "anything else behaves as not-found, including PDF routes"; Appendix C: every :id checked → 404
      expect(r.status, suffix).toBe(404);
      expect(r.body.error.code, suffix).toBe("NOT_FOUND");
    }
    // nested ids crossed between bookings are 404 too (a receipt of #1 under #2's path)
    expect(
      (
        await h.request("GET", `/api/v1/portal/bookings/${bk2.id}/receipts/${receipt.payment_id}/pdf`, {
          token: priyaPortal,
        })
      ).status,
    ).toBe(404);
    // the signed statement link is bound to Rajesh: no bearer / his bearer stream the PDF; Priya's, a staff token or garbage are 404
    const link = await h.request<{ download_url: string }>("GET", `/api/v1/portal/bookings/${bk1.id}/statement.pdf`, {
      token: rajeshPortal,
    });
    expect(link.status, link.text).toBe(200);
    const path = pathOf(link.body.download_url);
    const anon = await h.request("GET", path);
    expect(anon.status).toBe(200);
    expect(anon.headers["content-type"]).toContain("application/pdf");
    expect(anon.raw.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect((await h.request("GET", path, { token: rajeshPortal })).status).toBe(200);
    for (const [label, token] of [
      ["priya", priyaPortal],
      ["admin", admin],
      ["garbage", "not.a.jwt"],
    ] as const) {
      const r = await h.request<ErrorBody>("GET", path, { token });
      expect(r.status, label).toBe(404);
    }
    // a tampered token is rejected
    expect((await h.request("GET", path.slice(0, -3) + "xyz")).status).toBe(404);
    // SPEC L12: a staff token must never open portal data (401 INVALID_AUDIENCE), and vice versa
    const staffOnPortal = await h.request<ErrorBody>("GET", "/api/v1/portal/bookings", { token: admin });
    expect(staffOnPortal.status).toBe(401);
    expect(staffOnPortal.body.error.code).toBe("INVALID_AUDIENCE");
    const portalOnStaff = await h.request<ErrorBody>("GET", `/api/v1/bookings/${bk1.id}`, { token: rajeshPortal });
    expect(portalOnStaff.status).toBe(401);
  });
});
