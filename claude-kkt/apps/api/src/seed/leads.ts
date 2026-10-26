/** Step 6 — the 8 leads across the pipeline (website enquiry + brochure gate through the public API, the rest through the ERP) and brochure-download history. */
import { randomBytes } from "node:crypto";
import { sha256 } from "../lib/crypto.js";
import { SeedError, type SeedContext } from "./context.js";
import { customerBody, KAVITA, setKyc } from "./customers.js";
import { SGH_SLUG } from "./projects.js";

interface LeadRow { id: string; lead_number: string; phone: string; version: number; stage: string }

async function remember(ctx: SeedContext, key: string, l: LeadRow): Promise<LeadRow> {
  ctx.leads[key] = { id: l.id, number: l.lead_number, phone: l.phone, version: l.version, stage: l.stage };
  return l;
}

async function leadByPhone(ctx: SeedContext, phone: string): Promise<LeadRow> {
  const r = await ctx.get<{ items: LeadRow[] }>(`/api/v1/leads?search=${phone}&page_size=5`);
  const l = r.items.find((i) => i.phone === phone);
  if (!l) throw new SeedError(`lead ${phone} not found`);
  return l;
}

/** Moves a lead to a stage (ERP) and refreshes the cached version. */
export async function setStage(ctx: SeedContext, key: string, stage: string, extra: Record<string, unknown> = {}): Promise<void> {
  const l = ctx.leads[key]!;
  const r = await ctx.post<LeadRow>(`/api/v1/leads/${l.id}/stage`, { version: l.version, stage, ...extra }, "sales", { idempotent: false });
  l.version = r.version;
  l.stage = r.stage;
}

export async function seedLeads(ctx: SeedContext): Promise<void> {
  ctx.log("leads: website enquiry, brochure gate, walk-in, referral, broker, campaign (UTM), converted → Kavita Roy, lost");
  const sgh = ctx.project("SGH");
  const ggv = ctx.project("GGV");
  const flatType = (k: string) => ctx.ids[`flatType:${k}`]!;

  // 1 · Website enquiry → lead source WEBSITE, NEW, unread (public form, honeypot empty)
  await ctx.call("POST", "/api/v1/public/enquiries", { ip: ctx.freshIp(), body: { name: "Rohit Anand", phone: "9811100001", email: "rohit.anand@example.com", project_slug: SGH_SLUG, flat_type_code: "3BHK-A", message: "Looking for a 3 BHK on a higher floor in Tower C. Please share the price list.", consent: true, website: "", source_page: `/projects/${SGH_SLUG}`, utm: { source: "google", medium: "organic" } } });
  await remember(ctx, "website", await leadByPhone(ctx, "9811100001"));

  // 2 · Brochure gate → lead source BROCHURE (the signed link is opened once so the download is counted), then CONTACTED
  const brochure = await ctx.call<{ download_url: string }>("POST", "/api/v1/public/brochure-requests", { ip: ctx.freshIp(), body: { project_slug: SGH_SLUG, name: "Shalini Kumari", phone: "9811100002", email: "shalini.k@example.com", consent: true, website: "" } });
  const path = new URL(brochure.download_url).pathname;
  await ctx.call("GET", path, { ip: ctx.freshIp(), expect: 200 });
  await remember(ctx, "brochure", await leadByPhone(ctx, "9811100002"));
  await setStage(ctx, "brochure", "CONTACTED", { note: "Called back; wants a 2 BHK in Tower A" });
  await ctx.post(`/api/v1/leads/${ctx.leads["brochure"]!.id}/follow-ups`, { note: "Shared the Tower A price list on WhatsApp", next_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }, "sales");

  // 3 · Walk-in → SITE_VISIT_SCHEDULED (the upcoming visit is created in visits.ts)
  await remember(ctx, "walkin", await ctx.post<LeadRow>("/api/v1/leads", { full_name: "Deepak Choudhary", phone: "9811100003", email: "deepak.c@example.com", source: "WALK_IN", project_id: sgh.id, flat_type_id: flatType("B2"), budget_min_paise: 55_00_000_00, budget_max_paise: 70_00_000_00, message: "Walked into the Boring Road office; wants to see Tower A model flat", consent: true }, "sales"));

  // 4 · Referral → SITE_VISIT_DONE (visit completed in visits.ts)
  await remember(ctx, "referral", await ctx.post<LeadRow>("/api/v1/leads", { full_name: "Meera Thakur", phone: "9811100004", email: "meera.thakur@example.com", source: "REFERRAL", project_id: sgh.id, flat_type_id: flatType("A3"), budget_min_paise: 80_00_000_00, budget_max_paise: 95_00_000_00, message: "Referred by Mr Rajesh Sinha (P1)", consent: true }, "sales"));

  // 5 · Broker → NEGOTIATION
  await remember(ctx, "broker", await ctx.post<LeadRow>("/api/v1/leads", { full_name: "Arvind Sahay", phone: "9811100005", source: "BROKER", project_id: ggv.id, flat_type_id: flatType("VILLA"), budget_min_paise: 95_00_000_00, budget_max_paise: 110_00_000_00, message: "Via Patna Realty – interested in villa Q5", consent: true }, "sales"));
  await setStage(ctx, "broker", "CONTACTED");
  await setStage(ctx, "broker", "NEGOTIATION", { note: "Asked for ₹2 L discount and free club membership" });
  await ctx.post(`/api/v1/leads/${ctx.leads["broker"]!.id}/follow-ups`, { note: "Offer sent: club membership waived if booked this month", next_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }, "sales");

  // 6 · Campaign with UTM → NEW
  await remember(ctx, "campaign", await ctx.post<LeadRow>("/api/v1/leads", { full_name: "Nitin Agrawal", phone: "9811100006", email: "nitin.agrawal@example.com", source: "CAMPAIGN", project_id: sgh.id, flat_type_id: flatType("A2"), utm: { source: "facebook", medium: "cpc", campaign: "diwali-dhamaka-2025", content: "carousel-2bhk" }, consent: true }, "sales"));

  // 7 · Converted → customer Kavita Roy (customer #12, CUST-…/0012)
  const kavitaLead = await remember(ctx, "converted", await ctx.post<LeadRow>("/api/v1/leads", { full_name: KAVITA.name, phone: KAVITA.phone, email: KAVITA.email, source: "SITE_VISIT", project_id: sgh.id, flat_type_id: flatType("B3"), budget_min_paise: 90_00_000_00, budget_max_paise: 105_00_000_00, consent: true }, "sales"));
  await setStage(ctx, "converted", "CONTACTED");
  await setStage(ctx, "converted", "NEGOTIATION", { note: "Finalising B-402; token expected this week" });
  const converted = await ctx.post<{ lead: LeadRow; customer_id: string; customer_code: string }>(`/api/v1/leads/${kavitaLead.id}/convert`, { version: ctx.leads["converted"]!.version, customer: customerBody(KAVITA, ctx) }, "sales");
  ctx.leads["converted"]!.version = converted.lead.version;
  ctx.leads["converted"]!.stage = converted.lead.stage;
  const kavita = await ctx.get<{ id: string; version: number }>(`/api/v1/customers/${converted.customer_id}`);
  ctx.customers[KAVITA.phone] = { id: kavita.id, code: converted.customer_code, name: KAVITA.name, phone: KAVITA.phone, email: KAVITA.email, version: kavita.version };
  ctx.customerOrder.push(KAVITA.phone);
  await setKyc(ctx, KAVITA.phone, KAVITA.kyc);

  // 8 · Lost – "Budget mismatch"
  await remember(ctx, "lost", await ctx.post<LeadRow>("/api/v1/leads", { full_name: "Sanjeev Rana", phone: "9811100008", source: "WALK_IN", project_id: ggv.id, flat_type_id: flatType("VILLA"), budget_min_paise: 60_00_000_00, budget_max_paise: 70_00_000_00, consent: true }, "sales"));
  await setStage(ctx, "lost", "CONTACTED");
  await setStage(ctx, "lost", "LOST", { lost_reason: "Budget mismatch" });

  await seedBrochureDownloads(ctx);
}

/**
 * Brochure-download history for the ERP sparkline: 14 downloads on SGH over the last 30 days (13 back-dated rows plus the one real
 * download above) and 3 on GGV. The public endpoint can only record "now", so these rows are inserted directly (documented fallback)
 * and the projects' download counters are bumped the same way the endpoint does.
 */
async function seedBrochureDownloads(ctx: SeedContext): Promise<void> {
  const sgh = ctx.project("SGH");
  const ggv = ctx.project("GGV");
  const brochureLead = ctx.leads["brochure"]!;
  const rows: { projectId: string; leadId: string | null; daysAgo: number; hour: number }[] = [];
  for (const [i, d] of [1, 2, 2, 4, 6, 7, 9, 12, 14, 17, 21, 24, 28].entries()) rows.push({ projectId: sgh.id, leadId: i % 3 === 0 ? brochureLead.id : null, daysAgo: d, hour: 9 + (i % 9) });
  for (const d of [5, 12, 20]) rows.push({ projectId: ggv.id, leadId: null, daysAgo: d, hour: 11 });
  for (const r of rows) {
    const at = `${ctx.D(r.daysAgo)}T${String(r.hour).padStart(2, "0")}:15:00+05:30`;
    const token = randomBytes(24).toString("base64url");
    await ctx.sql`insert into brochure_downloads (company_id, project_id, lead_id, token_hash, expires_at, downloaded_at, ip, user_agent, created_at)
      values (${ctx.companyId}, ${r.projectId}, ${r.leadId}, ${sha256(token)}, ${at}::timestamptz + interval '15 minutes', ${at}::timestamptz + interval '1 minute', ${`49.37.${r.daysAgo}.${r.hour}`}, 'Mozilla/5.0 (seed)', ${at}::timestamptz)`;
  }
  await ctx.sql`update project_website_settings set brochure_download_count = brochure_download_count + 13 where project_id = ${sgh.id}`;
  await ctx.sql`update project_website_settings set brochure_download_count = brochure_download_count + 3 where project_id = ${ggv.id}`;
  ctx.counts["brochure_downloads"] = rows.length + 1;
}
