/** Step 10 — five service tickets across statuses (customers raise theirs through the portal) and the two buyer notices. */
import { SeedError, type SeedContext } from "./context.js";
import { portalLogin } from "./customers.js";

interface Ticket {
  id: string;
  ticket_number: string;
  version: number;
  status: string;
  rating: number | null;
}

async function staffStatus(ctx: SeedContext, t: Ticket, status: string, note?: string): Promise<Ticket> {
  return ctx.post<Ticket>(
    `/api/v1/service-requests/${t.id}/status`,
    { version: t.version, status, ...(note ? { note } : {}) },
    "admin",
    { idempotent: false },
  );
}

async function ticket(ctx: SeedContext, id: string): Promise<Ticket> {
  return ctx.get<Ticket>(`/api/v1/service-requests/${id}`);
}

/** Staff reply / internal note on a ticket, sent with the ticket's current version (If-Match; contract C6). */
async function staffMessage(ctx: SeedContext, id: string, body: Record<string, unknown>): Promise<Ticket> {
  const current = await ticket(ctx, id);
  return ctx.post<Ticket>(`/api/v1/service-requests/${id}/messages`, body, "admin", {
    idempotent: false,
    ifMatch: current.version,
  });
}

export async function seedService(ctx: SeedContext): Promise<void> {
  ctx.log("service requests: NEW, IN_PROGRESS (internal note), AWAITING_CUSTOMER, RESOLVED, CLOSED (rated 5); notices");
  const cat = (name: string) => ctx.serviceCategories[name]!;
  const b = (n: number) => ctx.bookings[n]!;
  const sales = ctx.staffUser("sales@sgb.in");

  // 1 · NEW payment query – raised by Priya Verma from the portal
  {
    const token = await portalLogin(ctx, "9876543211");
    await ctx.call<Ticket>("POST", "/api/v1/portal/requests", {
      token,
      body: {
        booking_id: b(2).id,
        category_id: cat("Payment query"),
        subject: "Receipt for my NEFT of ₹15,00,000 not visible",
        description:
          "I transferred ₹15 lakh from my HDFC loan account but the receipt is not showing under Payments. Please check and share the receipt PDF.",
      },
    });
  }

  // 2 · IN_PROGRESS document request – Amit Kumar, with an INTERNAL staff note the customer never sees
  {
    let t = await ctx.post<Ticket>(
      "/api/v1/service-requests",
      {
        customer_id: ctx.customer("9876543212").id,
        booking_id: b(3).id,
        category_id: cat("Document request"),
        subject: "Need the allotment letter for my bank",
        description: "ICICI Bank needs the allotment letter and a payment schedule on letterhead for the loan file.",
        assignee_user_id: sales.id,
      },
      "admin",
    );
    t = await staffStatus(ctx, t, "IN_PROGRESS", "Picked up by sales desk");
    await staffMessage(ctx, t.id, {
      body: "Bounced cheque 118822 was replaced by UPI on time – no need to mention it in the letter. Loan file is urgent for the customer.",
      is_internal: true,
    });
    await staffMessage(ctx, t.id, {
      body: "Hello Mr Kumar, the allotment letter and schedule are being prepared on letterhead; you will have them in the portal by tomorrow evening.",
    });
  }

  // 3 · AWAITING_CUSTOMER construction query – Vikram Singh (portal) → staff asked for details
  {
    const token = await portalLogin(ctx, "9876543214");
    const created = await ctx.call<Ticket>("POST", "/api/v1/portal/requests", {
      token,
      body: {
        booking_id: b(5).id,
        category_id: cat("Construction query"),
        subject: "When will Tower B plinth work start?",
        description:
          "The foundation photos look complete. Please share the expected plinth and first-slab dates for Tower B.",
      },
    });
    let t = await ticket(ctx, created.id);
    t = await staffStatus(ctx, t, "IN_PROGRESS");
    await staffMessage(ctx, t.id, {
      body: "Plinth work starts next week; could you confirm whether you want the stage-wise schedule by email or WhatsApp?",
      status: "AWAITING_CUSTOMER",
    });
  }

  // 4 · RESOLVED defect/snag – Anjali Sharma (portal); the customer can still rate it from the portal
  {
    const token = await portalLogin(ctx, "9876543217");
    const created = await ctx.call<Ticket>("POST", "/api/v1/portal/requests", {
      token,
      body: {
        booking_id: b(8).id,
        category_id: cat("Defect/Snag"),
        subject: "Seepage in the master bathroom of P3",
        description:
          "There is a damp patch under the window of the master bathroom after the first rains. Please inspect.",
      },
    });
    let t = await ticket(ctx, created.id);
    t = await staffStatus(ctx, t, "IN_PROGRESS", "Site engineer assigned");
    await staffMessage(ctx, t.id, {
      body: "Our team re-sealed the window frame and applied waterproofing; please check after the next rain.",
    });
    t = await ticket(ctx, t.id);
    await staffStatus(ctx, t, "RESOLVED", "Window frame sealed and waterproofed");
  }

  // 5 · CLOSED possession – Rajesh Kumar Sinha; rated 5 by the customer (rating a resolved request closes it)
  {
    let t = await ctx.post<Ticket>(
      "/api/v1/service-requests",
      {
        customer_id: ctx.customer("9876543210").id,
        booking_id: b(1).id,
        category_id: cat("Possession"),
        subject: "Handover checklist and keys for P1",
        description: "Please schedule the final walkthrough and key handover for villa P1.",
        assignee_user_id: sales.id,
      },
      "admin",
    );
    t = await staffStatus(ctx, t, "IN_PROGRESS", "Walkthrough scheduled");
    await staffMessage(ctx, t.id, {
      body: "Walkthrough completed and keys handed over along with the registry documents. Welcome home!",
    });
    t = await ticket(ctx, t.id);
    t = await staffStatus(ctx, t, "RESOLVED", "Keys handed over");
    const token = await portalLogin(ctx, "9876543210");
    const rated = await ctx.call<{ status: string; rating: number | null }>(
      "POST",
      `/api/v1/portal/requests/${t.id}/rate`,
      { token, body: { rating: 5, comment: "Smooth handover, very professional team." } },
    );
    if (rated.status !== "CLOSED" || rated.rating !== 5)
      throw new SeedError(`ticket 5 should be CLOSED with rating 5, got ${rated.status}/${String(rated.rating)}`);
  }

  // notices for buyers
  await ctx.post(
    "/api/v1/notices",
    {
      title: "Diwali holiday schedule",
      body_md:
        "Our site offices and the accounts desk will remain **closed from 20 to 23 October** for Diwali. Online payments and the portal stay available. Happy Diwali!",
      is_published: true,
    },
    "admin",
  );
  await ctx.post(
    "/api/v1/notices",
    {
      project_id: ctx.project("SGH").id,
      title: "Tower A 4th slab casting on 2 Nov",
      body_md:
        "The 4th slab of Tower A will be cast on **2 November** from 6 am. Site access will be restricted that day; buyers are welcome to watch from the viewing deck.",
      is_published: true,
    },
    "admin",
  );
  ctx.counts["notices"] = 2;
  ctx.counts["service_requests"] = 5;
}
