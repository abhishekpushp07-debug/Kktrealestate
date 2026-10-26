/**
 * Step 8 — ten site visits through the ERP scheduler (capacity-checked): 4 upcoming CONFIRMED (one RESCHEDULED), 3 COMPLETED,
 * 2 NO_SHOW, 1 CANCELLED, assignee sales@sgb.in. Outcomes are marked through the API; because the scheduler only books future
 * slots, the finished visits are then back-dated with one SQL update (documented fallback).
 */
import { SeedError, type SeedContext } from "./context.js";
import { secondSundayOfNextMonth } from "./projects.js";

interface VisitRow {
  id: string;
  visit_number: string;
  version: number;
  status: string;
  visit_date: string;
  slot_start: string;
}

export async function seedVisits(ctx: SeedContext): Promise<void> {
  ctx.log("site visits: 4 upcoming (one rescheduled), 3 completed, 2 no-show, 1 cancelled");
  const sgh = ctx.project("SGH");
  const sales = ctx.staffUser("sales@sgb.in");
  const days = ctx.nextVisitDays(2, 5, [1, 2, 3, 4, 5, 6], [secondSundayOfNextMonth(ctx.today)]);
  if (days.length < 5) throw new SeedError("not enough visit days");
  const [d1, d2, d3, d4] = days as [string, string, string, string, string];
  const created: Record<string, VisitRow> = {};
  const create = async (key: string, body: Record<string, unknown>): Promise<VisitRow> => {
    const r = await ctx.post<VisitRow>(
      "/api/v1/site-visits",
      { project_id: sgh.id, assignee_user_id: sales.id, visitors: 2, ...body },
      "sales",
    );
    created[key] = r;
    return r;
  };
  const customer = (phone: string) => ({ customer_id: ctx.customer(phone).id, name: ctx.customer(phone).name, phone });
  const lead = (key: string, name: string) => ({ lead_id: ctx.leads[key]!.id, name, phone: ctx.leads[key]!.phone });

  // upcoming
  await create("walkin", {
    ...lead("walkin", "Deepak Choudhary"),
    visit_date: d1,
    slot_start: "11:00",
    message: "Wants to see the Tower A model flat",
    visitors: 3,
  });
  await create("neha", {
    ...customer("9876543215"),
    visit_date: d2,
    slot_start: "12:00",
    notes: "Re-visit after cancellation; interested in Tower C",
  });
  const pooja = await create("pooja", {
    ...customer("9876543219"),
    visit_date: d2,
    slot_start: "15:00",
    notes: "Parking slot inspection",
  });
  await create("sanjay", { ...customer("9876543220"), visit_date: d3, slot_start: "11:00" });
  // rescheduled (keeps the "moved" tag)
  const moved = await ctx.post<VisitRow>(
    `/api/v1/site-visits/${pooja.id}/reschedule`,
    { version: pooja.version, visit_date: d3, slot_start: "10:00", notes: "Customer asked for a morning slot" },
    "sales",
    { idempotent: false },
  );
  created["pooja"] = moved;

  // finished ones: booked at future slots, marked through the API, then back-dated
  const finished: {
    key: string;
    body: Record<string, unknown>;
    outcome: "complete" | "no-show" | "cancel";
    daysAgo: number;
    notes?: string;
  }[] = [
    {
      key: "referral",
      body: { ...lead("referral", "Meera Thakur"), visit_date: d1, slot_start: "10:00" },
      outcome: "complete",
      daysAgo: 6,
      notes: "Liked 3BHK-A on the 6th floor; negotiating",
    },
    {
      key: "amit",
      body: { ...customer("9876543212"), visit_date: d4, slot_start: "10:00" },
      outcome: "complete",
      daysAgo: 9,
      notes: "Inspected A-402 slab work",
    },
    {
      key: "vikram",
      body: { ...customer("9876543214"), visit_date: d4, slot_start: "11:00" },
      outcome: "complete",
      daysAgo: 14,
      notes: "Checked Tower B foundation",
    },
    {
      key: "manoj",
      body: { ...customer("9876543216"), visit_date: d1, slot_start: "14:00" },
      outcome: "no-show",
      daysAgo: 4,
    },
    {
      key: "rakesh",
      body: { ...customer("9876543218"), visit_date: d2, slot_start: "10:00" },
      outcome: "no-show",
      daysAgo: 11,
    },
    {
      key: "anjali",
      body: { ...customer("9876543217"), visit_date: d3, slot_start: "12:00" },
      outcome: "cancel",
      daysAgo: 2,
    },
  ];
  for (const f of finished) {
    const v = await create(f.key, f.body);
    const r =
      f.outcome === "cancel"
        ? await ctx.post<VisitRow>(
            `/api/v1/site-visits/${v.id}/cancel`,
            { version: v.version, reason: "Customer travelling; will rebook next month" },
            "sales",
            { idempotent: false },
          )
        : await ctx.post<VisitRow>(
            `/api/v1/site-visits/${v.id}/${f.outcome}`,
            { version: v.version, ...(f.notes ? { notes: f.notes } : {}) },
            "sales",
            { idempotent: false },
          );
    created[f.key] = r;
    const past = ctx.D(f.daysAgo);
    const at = `${past}T${f.body["slot_start"] as string}:00+05:30`;
    await ctx.sql`update site_visits set visit_date = ${past}, created_at = ${at}::timestamptz - interval '3 days', outcome_marked_at = case when outcome_marked_at is null then null else ${at}::timestamptz + interval '2 hours' end, updated_at = ${at}::timestamptz + interval '2 hours' where id = ${r.id}`;
  }
  const statuses = Object.values(created).map((v) => v.status);
  const count = (s: string) => statuses.filter((x) => x === s).length;
  if (
    count("CONFIRMED") !== 3 ||
    count("RESCHEDULED") !== 1 ||
    count("COMPLETED") !== 3 ||
    count("NO_SHOW") !== 2 ||
    count("CANCELLED") !== 1
  )
    throw new SeedError(`visit statuses off: ${statuses.join(",")}`);
  ctx.counts["site_visits"] = statuses.length;
}
