/**
 * Dashboards by role (SPEC §14): Owner / Super Admin, Accounts, Sales, Project Admin, Employee. Every widget applies the caller's project scope;
 * the whole payload is cached in Redis for 15 s per role + user scope (+ project filter).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { Redis } from "ioredis";
import type {
  AccountsDashboardResponse,
  ChequeRow,
  DashboardQuery,
  DashboardResponse,
  DashboardRole,
  DemandStatus,
  EmployeeDashboardResponse,
  LeadStage,
  MoneyCategory,
  OwnerDashboardResponse,
  ProjectAdminDashboardResponse,
  SalesDashboardResponse,
  VisitStatus,
} from "@kkt/contracts";
import {
  blockStages,
  blocks,
  bookings,
  demands,
  enquiries,
  leads,
  notices,
  payments,
  projects,
  type Executor,
} from "@kkt/db";
import { addDays, compareDates, diffDays, installmentAmounts } from "@kkt/domain";
import { cached } from "../../../lib/cache.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../../lib/scope.js";
import {
  DEMAND_SELECT,
  PAYMENT_SELECT,
  demandJoins,
  paymentJoins,
  toDemandRow,
  toPaymentRow,
  type DemandSelect,
  type PaymentSelect,
} from "../../money/index.js";
import { lastMonths, monthKey, monthStart, scopeSql, today as todayDate, weekStart } from "../common.js";
import {
  advancesTotal,
  clearedTotal,
  outstandingReport,
  pendingChequesTotal,
  toChequeRow,
  upcomingDues,
} from "./moneyReports.js";
import { projectInventory, visitsOn } from "./salesReports.js";

/** Dashboard cache TTL (seconds). */
export const DASHBOARD_TTL_SECONDS = 15;

function defined(conds: (SQL | undefined)[]): SQL | undefined {
  const list = conds.filter((c): c is SQL => c !== undefined);
  return list.length ? and(...list) : undefined;
}

/** Which dashboard a staff member sees: system role name first, then a permission heuristic for custom roles. */
export function dashboardRoleFor(user: Pick<StaffContext, "roleName" | "permissions">): DashboardRole {
  switch (user.roleName) {
    case "Super Admin":
      return "OWNER";
    case "Accounts":
      return "ACCOUNTS";
    case "Sales":
      return "SALES";
    case "Project Admin":
      return "PROJECT_ADMIN";
    case "Employee":
    case "Marketing":
      return "EMPLOYEE";
    default:
      if (user.permissions.has("settings.manage") || user.permissions.has("users.manage")) return "OWNER";
      if (user.permissions.has("payment.post")) return "ACCOUNTS";
      if (user.permissions.has("lead.write")) return "SALES";
      if (user.permissions.has("construction.update")) return "PROJECT_ADMIN";
      return "EMPLOYEE";
  }
}

/**
 * Redis key: role + scope + project filter, plus the user id for the SALES dashboard only — the one whose widgets are the caller's own
 * (assigned leads, own bookings). Every other dashboard is a function of company, role and project scope, so all users with the same
 * role and scope share one entry: at production size a dashboard costs up to a few hundred ms of database time to build, and 200 staff
 * each rebuilding their own copy every 15 s was the dashboard's tail (docs/PERFORMANCE.md "Production-size run").
 */
export function dashboardCacheKey(user: StaffContext, role: DashboardRole, q: DashboardQuery): string {
  const scope = user.allProjects ? "all" : [...user.projectIds].sort().join(",");
  const owner = role === "SALES" ? user.id : "-";
  return `dash:${user.companyId}:${role}:${owner}:${scope}:${q.project_id ?? "-"}`;
}

/** Builds in flight per cache key in this process: concurrent misses of one key share one build (no stampede when an entry expires). */
const building = new Map<string, Promise<DashboardResponse>>();

/** The caller's dashboard (cached 15 s). */
export async function dashboardFor(
  db: Executor,
  redis: Redis,
  user: StaffContext,
  q: DashboardQuery,
): Promise<DashboardResponse> {
  if (q.project_id) ensureProjectAccess(user, q.project_id);
  const role = dashboardRoleFor(user);
  const key = dashboardCacheKey(user, role, q);
  return cached(redis, key, DASHBOARD_TTL_SECONDS, () => {
    let pending = building.get(key);
    if (!pending) {
      pending = buildDashboard(db, user, role, q).finally(() => building.delete(key));
      building.set(key, pending);
    }
    return pending;
  });
}

async function buildDashboard(
  db: Executor,
  user: StaffContext,
  role: DashboardRole,
  q: DashboardQuery,
): Promise<DashboardResponse> {
  switch (role) {
    case "OWNER":
      return { role, data: await ownerDashboard(db, user, q) };
    case "ACCOUNTS":
      return { role, data: await accountsDashboard(db, user, q) };
    case "SALES":
      return { role, data: await salesDashboard(db, user, q) };
    case "PROJECT_ADMIN":
      return { role, data: await projectAdminDashboard(db, user, q) };
    case "EMPLOYEE":
      return { role, data: await employeeDashboard(db, user, q) };
  }
}

// ---------------------------------------------------------------------------
// shared widgets
// ---------------------------------------------------------------------------

interface BlockProgress {
  block_id: string;
  block_name: string;
  project_name: string;
  percent: number;
  current_stage: string | null;
  next_stage: string | null;
}

/** Construction progress per block: completed / total stages, current (last completed or in-progress) and next stage. */
async function constructionProgress(db: Executor, user: StaffContext, projectId?: string): Promise<BlockProgress[]> {
  const rows = await db
    .select({
      blockId: blocks.id,
      blockName: blocks.name,
      projectName: projects.name,
      stageName: blockStages.name,
      status: blockStages.status,
      sort: blockStages.sortOrder,
    })
    .from(blocks)
    .innerJoin(projects, eq(projects.id, blocks.projectId))
    .leftJoin(blockStages, eq(blockStages.blockId, blocks.id))
    .where(
      defined([
        eq(blocks.companyId, user.companyId),
        eq(blocks.isActive, true),
        scopeFilter(user, blocks.projectId),
        projectId ? eq(blocks.projectId, projectId) : undefined,
      ]),
    )
    .orderBy(asc(projects.name), asc(blocks.sortOrder), asc(blocks.name), asc(blockStages.sortOrder));
  const out = new Map<string, BlockProgress & { total: number; done: number }>();
  for (const r of rows) {
    const b = out.get(r.blockId) ?? {
      block_id: r.blockId,
      block_name: r.blockName,
      project_name: r.projectName,
      percent: 0,
      current_stage: null,
      next_stage: null,
      total: 0,
      done: 0,
    };
    if (r.stageName) {
      b.total += 1;
      if (r.status === "COMPLETED") {
        b.done += 1;
        b.current_stage = r.stageName;
      } else if (r.status === "IN_PROGRESS") b.current_stage = r.stageName;
      else if (b.next_stage === null) b.next_stage = r.stageName;
    }
    out.set(r.blockId, b);
  }
  return [...out.values()].map(({ total, done, ...b }) => ({
    ...b,
    percent: total > 0 ? Math.round((done / total) * 10000) / 100 : 0,
  }));
}

async function demandsRaised(
  db: Executor,
  user: StaffContext,
  from: string,
  to: string,
  projectId?: string,
): Promise<{ count: number; amount_paise: number }> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${demands.totalDemandPaise}), 0)` })
    .from(demands)
    .where(
      defined([
        eq(demands.companyId, user.companyId),
        sql`${demands.status} <> 'VOID'`,
        gte(demands.demandDate, from),
        lte(demands.demandDate, to),
        scopeFilter(user, demands.projectId),
        projectId ? eq(demands.projectId, projectId) : undefined,
      ]),
    );
  return { count: Number(r?.n ?? 0), amount_paise: Number(r?.amount ?? 0) };
}

async function bookingsCount(
  db: Executor,
  user: StaffContext,
  from: string,
  to: string,
  projectId?: string,
  extra: SQL[] = [],
): Promise<{ count: number; value: number }> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${bookings.agreementValuePaise}), 0)` })
    .from(bookings)
    .where(
      defined([
        eq(bookings.companyId, user.companyId),
        gte(bookings.bookingDate, from),
        lte(bookings.bookingDate, to),
        scopeFilter(user, bookings.projectId),
        projectId ? eq(bookings.projectId, projectId) : undefined,
        ...extra,
      ]),
    );
  return { count: Number(r?.n ?? 0), value: Number(r?.value ?? 0) };
}

async function pendingCheques(
  db: Executor,
  user: StaffContext,
  projectId: string | undefined,
  limit: number,
  status: "PENDING" | "BOUNCED",
  since?: string,
): Promise<ChequeRow[]> {
  const today = todayDate();
  const rows = (await paymentJoins(db.select(PAYMENT_SELECT).from(payments).$dynamic())
    .where(
      defined([
        eq(payments.companyId, user.companyId),
        eq(payments.status, status),
        scopeFilter(user, payments.projectId),
        projectId ? eq(payments.projectId, projectId) : undefined,
        since ? gte(payments.paymentDate, since) : undefined,
      ]),
    )
    .orderBy(
      status === "PENDING" ? asc(sql`(${payments.instrument} ->> 'date')`) : desc(payments.bouncedAt),
      asc(payments.paymentDate),
    )
    .limit(limit)) as unknown as PaymentSelect[];
  return rows.map((r) => toChequeRow(toPaymentRow(r), today));
}

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

async function ownerDashboard(db: Executor, user: StaffContext, q: DashboardQuery): Promise<OwnerDashboardResponse> {
  const today = todayDate();
  const months = lastMonths(today, 12);
  const from12 = `${months[0]}-01`;
  const weekFrom = weekStart(today);
  const projectCond = q.project_id ? eq(payments.projectId, q.project_id) : undefined;
  const [
    collections,
    velocity,
    outstanding,
    inventory,
    cheques,
    enquiriesWeek,
    progress,
    duesMonth,
    upcoming,
    advances,
    monthCollected,
    active,
  ] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${payments.paymentDate}, 'YYYY-MM')`,
        against: payments.against,
        bucket: payments.bucket,
        amount: sql<string>`coalesce(sum(${payments.amountPaise}), 0)`,
      })
      .from(payments)
      .where(
        defined([
          eq(payments.companyId, user.companyId),
          eq(payments.status, "CLEARED"),
          gte(payments.paymentDate, from12),
          lte(payments.paymentDate, today),
          scopeFilter(user, payments.projectId),
          projectCond,
        ]),
      )
      .groupBy(sql`to_char(${payments.paymentDate}, 'YYYY-MM')`, payments.against, payments.bucket),
    db
      .select({
        month: sql<string>`to_char(${bookings.bookingDate}, 'YYYY-MM')`,
        n: sql<number>`count(*)::int`,
        value: sql<string>`coalesce(sum(${bookings.agreementValuePaise}), 0)`,
      })
      .from(bookings)
      .where(
        defined([
          eq(bookings.companyId, user.companyId),
          gte(bookings.bookingDate, from12),
          lte(bookings.bookingDate, today),
          scopeFilter(user, bookings.projectId),
          q.project_id ? eq(bookings.projectId, q.project_id) : undefined,
        ]),
      )
      .groupBy(sql`to_char(${bookings.bookingDate}, 'YYYY-MM')`),
    outstandingReport(db, user, { group_by: "PROJECT", top_n: 10, project_id: q.project_id }),
    projectInventory(db, user, q.project_id),
    pendingChequesTotal(db, user, q.project_id),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(enquiries)
      .where(
        defined([
          eq(enquiries.companyId, user.companyId),
          gte(enquiries.createdAt, new Date(`${weekFrom}T00:00:00+05:30`)),
          q.project_id ? eq(enquiries.projectId, q.project_id) : undefined,
          user.allProjects
            ? undefined
            : user.projectIds.length
              ? or(isNull(enquiries.projectId), inArray(enquiries.projectId, user.projectIds))
              : sql`false`,
        ]),
      ),
    constructionProgress(db, user, q.project_id),
    demandsRaised(db, user, monthStart(today), today, q.project_id),
    upcomingDues(db, user, { from: today, to: addDays(today, 30), project_id: q.project_id }),
    advancesTotal(db, user, q.project_id),
    clearedTotal(db, user, monthStart(today), today, projectCond ? [projectCond] : []),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        defined([
          eq(bookings.companyId, user.companyId),
          eq(bookings.status, "ACTIVE"),
          scopeFilter(user, bookings.projectId),
          q.project_id ? eq(bookings.projectId, q.project_id) : undefined,
        ]),
      ),
  ]);
  const byMonth = new Map(
    months.map((m) => [m, { month: m, cash_paise: 0, account_paise: 0, other_paise: 0, total_paise: 0 }]),
  );
  for (const c of collections) {
    const row = byMonth.get(c.month);
    if (!row) continue;
    const amount = Number(c.amount);
    if (c.against === "OTHER_CHARGE") row.other_paise += amount;
    else if (c.bucket === "ACCOUNT") row.account_paise += amount;
    else row.cash_paise += amount;
    row.total_paise += amount;
  }
  const velByMonth = new Map(velocity.map((v) => [v.month, v]));
  return {
    collections_12m: [...byMonth.values()],
    due_ageing: outstanding.totals.ageing,
    inventory_by_project: inventory,
    sales_velocity: months.map((m) => ({
      month: m,
      bookings: Number(velByMonth.get(m)?.n ?? 0),
      value_paise: Number(velByMonth.get(m)?.value ?? 0),
    })),
    top_overdue: outstanding.top_overdue,
    pending_cheques: cheques,
    enquiries_this_week: Number(enquiriesWeek[0]?.n ?? 0),
    construction_progress: progress.map(({ next_stage: _n, ...p }) => p),
    dues_raised_this_month: duesMonth,
    upcoming_installments_30d: { count: upcoming.totals.count, amount_paise: upcoming.totals.total_paise },
    totals: {
      total_due_paise: outstanding.totals.total_due_paise,
      total_advance_paise: advances,
      collected_this_month_paise: monthCollected.amount_paise,
      active_bookings: Number(active[0]?.n ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

async function accountsDashboard(
  db: Executor,
  user: StaffContext,
  q: DashboardQuery,
): Promise<AccountsDashboardResponse> {
  const today = todayDate();
  const projectCond = q.project_id ? eq(payments.projectId, q.project_id) : undefined;
  const [todayTotals, monthTotals, byCategory, toClear, overdue, bounced, statusCounts] = await Promise.all([
    clearedTotal(db, user, today, today, projectCond ? [projectCond] : []),
    clearedTotal(db, user, monthStart(today), today, projectCond ? [projectCond] : []),
    db
      .select({
        against: payments.against,
        bucket: payments.bucket,
        amount: sql<string>`coalesce(sum(${payments.amountPaise}), 0)`,
      })
      .from(payments)
      .where(
        defined([
          eq(payments.companyId, user.companyId),
          eq(payments.status, "CLEARED"),
          gte(payments.paymentDate, monthStart(today)),
          lte(payments.paymentDate, today),
          scopeFilter(user, payments.projectId),
          projectCond,
        ]),
      )
      .groupBy(payments.against, payments.bucket),
    pendingCheques(db, user, q.project_id, 50, "PENDING"),
    demandJoins(db.select(DEMAND_SELECT).from(demands).$dynamic())
      .where(
        defined([
          eq(demands.companyId, user.companyId),
          inArray(demands.status, ["OPEN", "PARTIALLY_PAID"]),
          sql`${demands.dueDate} < ${today}::date`,
          scopeFilter(user, demands.projectId),
          q.project_id ? eq(demands.projectId, q.project_id) : undefined,
        ]),
      )
      .orderBy(asc(demands.dueDate))
      .limit(50) as unknown as Promise<DemandSelect[]>,
    pendingCheques(db, user, q.project_id, 20, "BOUNCED", addDays(today, -30)),
    db
      .select({
        status: demands.status,
        n: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${demands.totalDemandPaise}), 0)`,
      })
      .from(demands)
      .where(
        defined([
          eq(demands.companyId, user.companyId),
          sql`${demands.status} <> 'VOID'`,
          scopeFilter(user, demands.projectId),
          q.project_id ? eq(demands.projectId, q.project_id) : undefined,
        ]),
      )
      .groupBy(demands.status),
  ]);
  const cat = new Map<MoneyCategory, number>();
  for (const r of byCategory) {
    const key: MoneyCategory = r.against === "OTHER_CHARGE" ? "OTHER" : r.bucket === "ACCOUNT" ? "ACCOUNT" : "CASH";
    cat.set(key, (cat.get(key) ?? 0) + Number(r.amount));
  }
  return {
    today: todayTotals,
    this_month: {
      ...monthTotals,
      by_category: [...cat.entries()].map(([category, amount_paise]) => ({ category, amount_paise })),
    },
    cheques_to_clear: toClear,
    overdue_demands: overdue.map((d) => {
      const row = toDemandRow(d, today);
      return {
        id: row.id,
        demand_number: row.demand_number,
        booking_number: row.booking_number,
        customer_name: row.customer_name,
        project_name: row.project_name,
        flat_number: row.flat_number,
        installment_name: row.installment_name,
        total_demand_paise: row.total_demand_paise,
        paid_paise: row.paid_paise,
        due_date: row.due_date,
        status: row.status,
        days_overdue: row.days_overdue,
      };
    }),
    bounced_recent: bounced,
    demand_status_counts: statusCounts.map((s) => ({
      status: s.status as DemandStatus,
      count: Number(s.n),
      amount_paise: Number(s.amount),
    })),
  };
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

async function salesDashboard(db: Executor, user: StaffContext, q: DashboardQuery): Promise<SalesDashboardResponse> {
  const today = todayDate();
  const weekFrom = weekStart(today);
  const leadScope = user.allProjects
    ? undefined
    : user.projectIds.length === 0
      ? sql`false`
      : or(isNull(leads.projectId), inArray(leads.projectId, user.projectIds));
  const leadProject = q.project_id ? eq(leads.projectId, q.project_id) : undefined;
  const endOfToday = new Date(`${today}T23:59:59.999+05:30`);
  const [pipeline, followUps, newEnquiries, brochureWeek, visits, availability, mine, mineMonth] = await Promise.all([
    db
      .select({ stage: leads.stage, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(defined([eq(leads.companyId, user.companyId), leadScope, leadProject]))
      .groupBy(leads.stage),
    db
      .select({
        id: leads.id,
        number: leads.leadNumber,
        name: leads.fullName,
        phone: leads.phone,
        next: leads.nextFollowUpAt,
        projectName: projects.name,
      })
      .from(leads)
      .leftJoin(projects, eq(projects.id, leads.projectId))
      .where(
        defined([
          eq(leads.companyId, user.companyId),
          leadScope,
          leadProject,
          eq(leads.assignedUserId, user.id),
          sql`${leads.nextFollowUpAt} is not null`,
          lte(leads.nextFollowUpAt, endOfToday),
          sql`${leads.stage} not in ('CONVERTED', 'LOST')`,
        ]),
      )
      .orderBy(asc(leads.nextFollowUpAt))
      .limit(50),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(enquiries)
      .where(
        defined([
          eq(enquiries.companyId, user.companyId),
          eq(enquiries.isRead, false),
          q.project_id ? eq(enquiries.projectId, q.project_id) : undefined,
          user.allProjects
            ? undefined
            : user.projectIds.length
              ? or(isNull(enquiries.projectId), inArray(enquiries.projectId, user.projectIds))
              : sql`false`,
        ]),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        defined([
          eq(leads.companyId, user.companyId),
          eq(leads.source, "BROCHURE"),
          gte(leads.createdAt, new Date(`${weekFrom}T00:00:00+05:30`)),
          leadScope,
          leadProject,
        ]),
      ),
    visitsOn(db, user, today, q.project_id),
    projectInventory(db, user, q.project_id),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        defined([
          eq(bookings.companyId, user.companyId),
          eq(bookings.salesUserId, user.id),
          scopeFilter(user, bookings.projectId),
          q.project_id ? eq(bookings.projectId, q.project_id) : undefined,
        ]),
      ),
    bookingsCount(db, user, monthStart(today), today, q.project_id, [eq(bookings.salesUserId, user.id)]),
  ]);
  const stages: LeadStage[] = [
    "NEW",
    "CONTACTED",
    "SITE_VISIT_SCHEDULED",
    "SITE_VISIT_DONE",
    "NEGOTIATION",
    "CONVERTED",
    "LOST",
  ];
  const stageCounts = new Map(pipeline.map((p) => [p.stage, Number(p.n)]));
  return {
    pipeline: stages.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
    follow_ups_due: followUps.map((l) => ({
      lead_id: l.id,
      lead_number: l.number,
      full_name: l.name,
      phone: l.phone,
      next_follow_up_at: (l.next as Date).toISOString(),
      project_name: l.projectName ?? null,
    })),
    new_enquiries: Number(newEnquiries[0]?.n ?? 0),
    brochure_leads_this_week: Number(brochureWeek[0]?.n ?? 0),
    todays_visits: visits.map((r) => ({
      visit_id: r.v.id,
      visit_number: r.v.visitNumber,
      visit_date: r.v.visitDate,
      slot_start: String(r.v.slotStart).slice(0, 5),
      slot_end: String(r.v.slotEnd).slice(0, 5),
      name: r.v.name,
      phone: r.v.phone,
      project_name: r.projectName,
      status: r.v.status as VisitStatus,
      visitors: r.v.visitors,
      lead_id: r.v.leadId,
      version: r.v.version,
    })),
    availability,
    my_bookings: { this_month: mineMonth.count, value_paise: mineMonth.value, total: Number(mine[0]?.n ?? 0) },
  };
}

// ---------------------------------------------------------------------------
// Project Admin
// ---------------------------------------------------------------------------

async function projectAdminDashboard(
  db: Executor,
  user: StaffContext,
  q: DashboardQuery,
): Promise<ProjectAdminDashboardResponse> {
  const today = todayDate();
  const [projectsRows, progress, duesMonth, bookingsMonth, tickets, activeBookings] = await Promise.all([
    projectInventory(db, user, q.project_id),
    constructionProgress(db, user, q.project_id),
    demandsRaised(db, user, monthStart(today), today, q.project_id),
    bookingsCount(db, user, monthStart(today), today, q.project_id),
    db.execute<{ n: number }>(sql`
      select count(*)::int as n from service_requests t left join bookings b on b.id = t.booking_id
      where t.company_id = ${user.companyId}::uuid and t.status not in ('RESOLVED', 'CLOSED')
        and (${user.allProjects ? sql`true` : sql`b.id is not null and ${scopeSql(user, sql`b.project_id`)}`})
        ${q.project_id ? sql`and b.project_id = ${q.project_id}::uuid` : sql``}`),
    db
      .select({
        blockId: bookings.blockId,
        cash: bookings.cashAgreedPaise,
        account: bookings.accountAgreedPaise,
        plan: bookings.planSnapshot,
      })
      .from(bookings)
      .where(
        defined([
          eq(bookings.companyId, user.companyId),
          eq(bookings.status, "ACTIVE"),
          scopeFilter(user, bookings.projectId),
          q.project_id ? eq(bookings.projectId, q.project_id) : undefined,
        ]),
      ),
  ]);
  // upcoming stage per block: the first stage not yet completed; installment total = Σ over the block's active bookings of installments linked to it
  const nextStages = await db
    .select({
      blockId: blockStages.blockId,
      stageId: blockStages.stageId,
      name: blockStages.name,
      isPossession: blockStages.isPossession,
      sort: blockStages.sortOrder,
      status: blockStages.status,
    })
    .from(blockStages)
    .innerJoin(blocks, eq(blocks.id, blockStages.blockId))
    .where(
      defined([
        eq(blocks.companyId, user.companyId),
        eq(blocks.isActive, true),
        sql`${blockStages.status} <> 'COMPLETED'`,
        scopeFilter(user, blocks.projectId),
        q.project_id ? eq(blocks.projectId, q.project_id) : undefined,
      ]),
    )
    .orderBy(asc(blockStages.blockId), asc(blockStages.sortOrder));
  const firstPending = new Map<string, (typeof nextStages)[number]>();
  for (const s of nextStages) if (!firstPending.has(s.blockId)) firstPending.set(s.blockId, s);
  const blockName = new Map(progress.map((p) => [p.block_id, p.block_name]));
  const upcoming_stages: ProjectAdminDashboardResponse["upcoming_stages"] = [];
  for (const [blockId, stage] of firstPending) {
    const bs = activeBookings.filter((b) => b.blockId === blockId);
    let total = 0;
    for (const b of bs) {
      const amounts = installmentAmounts(
        b.cash,
        b.account,
        b.plan.installments.map((i) => ({ seq: i.seq, percent: i.percent })),
      );
      for (const i of b.plan.installments) {
        const linked =
          (i.trigger_type === "ON_STAGE" && i.trigger_stage_id === stage.stageId) ||
          (i.trigger_type === "ON_POSSESSION" && stage.isPossession);
        if (!linked) continue;
        const a = amounts.find((x) => x.seq === i.seq);
        if (a) total += a.cashPaise + a.accountPaise;
      }
    }
    upcoming_stages.push({
      block_id: blockId,
      block_name: blockName.get(blockId) ?? "",
      stage_name: stage.name,
      active_bookings: bs.length,
      installment_total_paise: total,
    });
  }
  return {
    projects: projectsRows,
    construction: progress,
    upcoming_stages,
    demands_raised_this_month: duesMonth,
    bookings_this_month: bookingsMonth.count,
    open_tickets: Number(tickets[0]?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

async function employeeDashboard(
  db: Executor,
  user: StaffContext,
  q: DashboardQuery,
): Promise<EmployeeDashboardResponse> {
  const now = new Date();
  const [projectsRows, noticeRows] = await Promise.all([
    projectInventory(db, user, q.project_id),
    db
      .select({ id: notices.id, title: notices.title, publishAt: notices.publishAt })
      .from(notices)
      .where(
        defined([
          eq(notices.companyId, user.companyId),
          eq(notices.isPublished, true),
          or(isNull(notices.publishAt), lte(notices.publishAt, now)),
          or(isNull(notices.expiresAt), gte(notices.expiresAt, now)),
          user.allProjects
            ? undefined
            : user.projectIds.length
              ? or(isNull(notices.projectId), inArray(notices.projectId, user.projectIds))
              : isNull(notices.projectId),
        ]),
      )
      .orderBy(desc(notices.publishAt))
      .limit(10),
  ]);
  return {
    projects: projectsRows,
    notices: noticeRows.map((n) => ({ id: n.id, title: n.title, publish_at: (n.publishAt ?? now).toISOString() })),
  };
}

export { compareDates, diffDays, monthKey };
