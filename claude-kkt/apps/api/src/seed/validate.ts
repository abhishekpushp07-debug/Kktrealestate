/** Final step — the seed fails loudly unless the database is in the docs/SEED.md state. Every check goes through the API. */
import { SeedError, type SeedContext } from "./context.js";
import { WORKED_EXAMPLE, type BookingDetail } from "./bookings.js";
import { portalLogin } from "./customers.js";

interface Integrity { ok: boolean; findings: unknown[]; bookings_checked?: number }
interface LedgerRow { seq: number; event: string; bucket: string | null; amount_paise: number; cash_due_paise: number; account_due_paise: number; total_due_paise: number; ref_number: string | null }
interface List<T> { items: T[]; total: number }

function assert(cond: unknown, message: string, details?: unknown): asserts cond {
  if (!cond) throw new SeedError(`seed validation failed: ${message}`, details);
}

/** Expected portal bookings per customer phone (primary or co-applicant), from what the seed created. */
export function expectedPortalBookings(ctx: SeedContext): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const phone of ctx.customerOrder) out.set(phone, new Set());
  for (const b of Object.values(ctx.bookings)) out.get(b.customerPhone)?.add(b.number);
  out.get("9876543220")?.add(ctx.bookings[10]!.number); // Sanjay Jha is co-applicant on #10
  return out;
}

export async function validateSeed(ctx: SeedContext): Promise<Integrity> {
  ctx.log("validating: integrity report, worked example ledger, Tower C, portal isolation, counts");
  const integrity = await ctx.get<Integrity>("/api/v1/dues/integrity");
  assert(integrity.ok && integrity.findings.length === 0, "integrity report must have zero findings", integrity.findings);

  // booking #1: PAYMENT rows exactly as SPEC §11, COMPLETED, flat P1 SOLD
  const b1 = ctx.bookings[1]!;
  const ledger = await ctx.get<List<LedgerRow>>(`/api/v1/bookings/${b1.id}/ledger?page_size=200`);
  const payments = ledger.items.filter((r) => r.event === "PAYMENT");
  assert(payments.length === WORKED_EXAMPLE.length, `worked example must have ${WORKED_EXAMPLE.length} PAYMENT rows, found ${payments.length}`);
  for (const [i, row] of WORKED_EXAMPLE.entries()) {
    const got = payments[i]!;
    const ok = got.bucket === row.bucket && got.amount_paise === row.amount && got.cash_due_paise === row.cash && got.account_due_paise === row.account && got.total_due_paise === row.total;
    assert(ok, `worked example ledger row #${i + 1} differs from SPEC §11`, { expected: row, got });
  }
  const detail = await ctx.get<BookingDetail>(`/api/v1/bookings/${b1.id}`);
  assert(detail.status === "COMPLETED", "booking #1 must be COMPLETED");
  assert(detail.summary.total_due_paise === 0 && detail.summary.other_charges_due_paise === 0, "booking #1 must have zero due");
  const p1 = await ctx.get<{ status: string }>(`/api/v1/flats/${ctx.flat("GGV", "P", "P1").id}`);
  assert(p1.status === "SOLD", "flat P1 must be SOLD");
  const b303 = await ctx.get<{ status: string }>(`/api/v1/flats/${ctx.flat("SGH", "B", "B-303").id}`);
  assert(b303.status === "AVAILABLE", "cancelled booking #6 must have released B-303");

  // Tower C: 52 flats, no 13th floor, no refuge-floor units
  const towerC = await ctx.get<List<{ flat_number: string; floor: number }>>(`/api/v1/flats?block_id=${ctx.block("SGH", "C").id}&page_size=200`);
  assert(towerC.total === 52 && towerC.items.length === 52, `Tower C must have 52 flats, found ${towerC.total}`);
  assert(towerC.items.every((f) => f.floor !== 13 && f.floor !== 7 && !/^C-13\d\d$/.test(f.flat_number) && !/^C-7\d\d$/.test(f.flat_number)), "Tower C must have no 13xx or 7xx flats");

  // every customer logs into the portal and sees exactly their own bookings
  const expected = expectedPortalBookings(ctx);
  for (const phone of ctx.customerOrder) {
    const token = await portalLogin(ctx, phone);
    const mine = await ctx.call<{ booking_number: string }[]>("GET", "/api/v1/portal/bookings", { token, ip: ctx.freshIp() });
    const got = new Set(mine.map((b) => b.booking_number));
    const want = expected.get(phone)!;
    assert(got.size === want.size && [...want].every((n) => got.has(n)), `portal bookings of ${phone} differ`, { got: [...got], want: [...want] });
  }

  // counts (docs/SEED.md)
  const total = async (url: string) => (await ctx.get<List<unknown>>(url)).total;
  const counts: Record<string, number> = {
    customers: await total("/api/v1/customers?page_size=1&exact=true"),
    leads: await total("/api/v1/leads?page_size=1&exact=true"),
    bookings: await total("/api/v1/bookings?page_size=1&exact=true"),
    site_visits: await total("/api/v1/site-visits?page_size=1&exact=true"),
    service_requests: await total("/api/v1/service-requests?page_size=1&exact=true"),
    notices: await total("/api/v1/notices?page_size=1&exact=true"),
    posts_published: await total("/api/v1/cms/posts?status=PUBLISHED&page_size=1&exact=true"),
    posts_draft: await total("/api/v1/cms/posts?status=DRAFT&page_size=1&exact=true"),
    projects: await total("/api/v1/projects?page_size=1&exact=true"),
    blocks: await total("/api/v1/blocks?page_size=1&exact=true"),
    flats: await total("/api/v1/flats?page_size=1&exact=true"),
    payments: await total("/api/v1/payments?page_size=1&exact=true"),
    demands: await total("/api/v1/demands?page_size=1&exact=true"),
    testimonials: await total("/api/v1/cms/testimonials?page_size=1&exact=true"),
    gallery: await total("/api/v1/cms/gallery?page_size=1&exact=true"),
    banners: await total("/api/v1/cms/banners?page_size=1&exact=true"),
    people: await total("/api/v1/cms/people?page_size=1&exact=true"),
    pages: await total("/api/v1/cms/pages?page_size=1&exact=true"),
    home_sections: await total("/api/v1/cms/home-sections?page_size=1&exact=true"),
    stage_photos: ctx.counts["stage_photos"] ?? 0,
    brochure_downloads: ctx.counts["brochure_downloads"] ?? 0,
  };
  const expectedCounts: Record<string, number> = { customers: 12, leads: 8, bookings: 10, site_visits: 10, service_requests: 5, notices: 2, posts_published: 4, posts_draft: 1, projects: 2, blocks: 5, flats: 32 + 32 + 52 + 6 + 8, testimonials: 6, gallery: 18, banners: 3, people: 3, pages: 3, home_sections: 5 };
  for (const [k, v] of Object.entries(expectedCounts)) assert(counts[k] === v, `${k}: expected ${v}, found ${counts[k]}`, counts);
  Object.assign(ctx.counts, counts);
  return integrity;
}
