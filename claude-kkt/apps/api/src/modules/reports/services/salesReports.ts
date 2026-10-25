/**
 * Inventory, sales-funnel and activity reports (SPEC §14): availability by type/floor/block with sold vs available value, sales velocity
 * (bookings and cancellations per month), realised rate vs the active rate card; leads by source/stage, first-response time, bookings per
 * salesperson, website enquiries / brochure downloads / site visits; audit summary, logins and failed logins.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type {
  ActivityReportQuery, ActivityReportResponse, ActivityReportRow, InventoryReportQuery, InventoryReportResponse, LeadSource, LeadStage, SalesFunnelQuery, SalesFunnelResponse, VisitStatus,
} from "@kkt/contracts";
import { auditLogs, blocks, bookings, brochureDownloads, enquiries, flatTypes, flats, leadActivities, leads, loginEvents, projects, rateCardRates, rateCards, siteVisits, users, type Executor } from "@kkt/db";
import { listPaging, paginate } from "../../../lib/list.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../../lib/scope.js";
import { lastMonths, monthKey, percentOf, scopeSql, today as todayDate } from "../common.js";

type Scope = Pick<StaffContext, "companyId" | "allProjects" | "projectIds">;

function defined(conds: (SQL | undefined)[]): SQL | undefined {
  const list = conds.filter((c): c is SQL => c !== undefined);
  return list.length ? and(...list) : undefined;
}

/** IST day boundaries as UTC instants for timestamptz comparisons. */
export function istDayStart(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}
export function istDayEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999+05:30`);
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

type CountRow = { label: string; available: number; hold: number; blocked: number; booked: number; sold: number; total: number; available_value_paise: number; sold_value_paise: number };

function emptyCounts(label: string): CountRow {
  return { label, available: 0, hold: 0, blocked: 0, booked: 0, sold: 0, total: 0, available_value_paise: 0, sold_value_paise: 0 };
}

function addCount(row: CountRow, status: string, n: number, value: number): void {
  const key = status.toLowerCase() as "available" | "hold" | "blocked" | "booked" | "sold";
  row[key] += n;
  row.total += n;
  if (status === "AVAILABLE") row.available_value_paise += value;
  if (status === "BOOKED" || status === "SOLD") row.sold_value_paise += value;
}

/** Inventory report: counts and values by flat type, floor and block; monthly sales velocity; realised rate vs rate card per flat type. */
export async function inventoryReport(db: Executor, user: Scope, q: InventoryReportQuery): Promise<InventoryReportResponse> {
  if (q.project_id) ensureProjectAccess(user, q.project_id);
  const today = todayDate();
  const from = q.from ?? `${lastMonths(today, 12)[0]}-01`;
  const to = q.to ?? today;
  const flatWhere = defined([eq(flats.companyId, user.companyId), scopeFilter(user, flats.projectId), q.project_id ? eq(flats.projectId, q.project_id) : undefined, q.block_id ? eq(flats.blockId, q.block_id) : undefined]);
  const bookingWhere = defined([
    eq(bookings.companyId, user.companyId), scopeFilter(user, bookings.projectId), q.project_id ? eq(bookings.projectId, q.project_id) : undefined, q.block_id ? eq(bookings.blockId, q.block_id) : undefined,
  ]);
  const [counts, velocityRows, cancelRows, realised, cardRates] = await Promise.all([
    db.select({
      blockId: flats.blockId, blockName: blocks.name, floor: flats.floor, flatTypeId: flats.flatTypeId, flatTypeName: flatTypes.name, status: flats.status,
      n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${flats.pricePaise}), 0)`,
    }).from(flats).innerJoin(blocks, eq(blocks.id, flats.blockId)).innerJoin(flatTypes, eq(flatTypes.id, flats.flatTypeId)).where(flatWhere)
      .groupBy(flats.blockId, blocks.name, flats.floor, flats.flatTypeId, flatTypes.name, flats.status),
    db.select({ month: sql<string>`to_char(${bookings.bookingDate}, 'YYYY-MM')`, n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${bookings.agreementValuePaise}), 0)` }).from(bookings)
      .where(defined([bookingWhere, gte(bookings.bookingDate, from), lte(bookings.bookingDate, to)])).groupBy(sql`to_char(${bookings.bookingDate}, 'YYYY-MM')`),
    db.select({ month: sql<string>`to_char(((${bookings.cancellation} ->> 'at')::timestamptz at time zone 'Asia/Kolkata'), 'YYYY-MM')`, n: sql<number>`count(*)::int` }).from(bookings)
      .where(defined([bookingWhere, eq(bookings.status, "CANCELLED"), sql`((${bookings.cancellation} ->> 'at')::timestamptz at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date`]))
      .groupBy(sql`to_char(((${bookings.cancellation} ->> 'at')::timestamptz at time zone 'Asia/Kolkata'), 'YYYY-MM')`),
    db.select({
      flatTypeId: flats.flatTypeId, flatTypeName: flatTypes.name, n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${bookings.agreementValuePaise}), 0)`,
      sqft: sql<string>`coalesce(sum(coalesce((${bookings.flatSnapshot} ->> 'super_builtup_sqft')::numeric, ${flats.superBuiltupSqft})), 0)`,
    }).from(bookings).innerJoin(flats, eq(flats.id, bookings.flatId)).innerJoin(flatTypes, eq(flatTypes.id, flats.flatTypeId))
      .where(defined([bookingWhere, inArray(bookings.status, ["ACTIVE", "COMPLETED"])])).groupBy(flats.flatTypeId, flatTypes.name),
    db.select({ projectId: rateCards.projectId, flatTypeId: rateCardRates.flatTypeId, rate: rateCardRates.ratePerSqftPaise, lump: rateCardRates.lumpSumPaise, superSqft: flatTypes.superBuiltupSqft })
      .from(rateCards).innerJoin(rateCardRates, eq(rateCardRates.rateCardId, rateCards.id)).innerJoin(flatTypes, eq(flatTypes.id, rateCardRates.flatTypeId))
      .where(defined([eq(rateCards.companyId, user.companyId), eq(rateCards.status, "ACTIVE"), scopeFilter(user, rateCards.projectId), q.project_id ? eq(rateCards.projectId, q.project_id) : undefined])),
  ]);
  const byType = new Map<string, CountRow & { flat_type_id: string }>();
  const byFloor = new Map<string, CountRow & { block_id: string; floor: number }>();
  const byBlock = new Map<string, CountRow & { block_id: string }>();
  const totals = emptyCounts("Total");
  for (const c of counts) {
    const value = Number(c.value);
    const t = byType.get(c.flatTypeId) ?? { ...emptyCounts(c.flatTypeName), flat_type_id: c.flatTypeId };
    addCount(t, c.status, c.n, value); byType.set(c.flatTypeId, t);
    const fk = `${c.blockId}:${c.floor}`;
    const f = byFloor.get(fk) ?? { ...emptyCounts(`${c.blockName} · Floor ${c.floor}`), block_id: c.blockId, floor: c.floor };
    addCount(f, c.status, c.n, value); byFloor.set(fk, f);
    const b = byBlock.get(c.blockId) ?? { ...emptyCounts(c.blockName), block_id: c.blockId };
    addCount(b, c.status, c.n, value); byBlock.set(c.blockId, b);
    addCount(totals, c.status, c.n, value);
  }
  const months = lastMonths(to, Math.max(1, Math.min(36, monthsBetween(from, to))));
  const velByMonth = new Map(velocityRows.map((r) => [r.month, r]));
  const cancelByMonth = new Map(cancelRows.map((r) => [r.month, r]));
  const velocity = months.map((m) => ({ month: m, bookings: Number(velByMonth.get(m)?.n ?? 0), cancellations: Number(cancelByMonth.get(m)?.n ?? 0), value_paise: Number(velByMonth.get(m)?.value ?? 0) }));
  // rate card rate per flat type: a single project → its active card; several projects → the first active card that prices the type
  const cardRate = new Map<string, number | null>();
  for (const r of cardRates) {
    if (cardRate.has(r.flatTypeId)) continue;
    const rate = r.rate ?? (r.lump && r.superSqft > 0 ? Math.round(r.lump / r.superSqft) : null);
    cardRate.set(r.flatTypeId, rate);
  }
  const realised_rate = realised.map((r) => {
    const sqft = Number(r.sqft);
    return { flat_type_id: r.flatTypeId, flat_type_name: r.flatTypeName, rate_card_rate_paise: cardRate.get(r.flatTypeId) ?? null, realised_rate_paise: sqft > 0 ? Math.round(Number(r.value) / sqft) : null, bookings: Number(r.n) };
  });
  const sortCounts = <T extends CountRow>(rows: T[]): T[] => rows.sort((a, b) => a.label.localeCompare(b.label));
  return {
    by_type: sortCounts([...byType.values()]),
    by_floor: [...byFloor.values()].sort((a, b) => a.label.localeCompare(b.label) || a.floor - b.floor),
    by_block: sortCounts([...byBlock.values()]),
    totals,
    velocity,
    realised_rate: realised_rate.sort((a, b) => a.flat_type_name.localeCompare(b.flat_type_name)),
  };
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/** Per-project inventory snapshot (counts from flats, construction % from block stages) – used by the dashboards. */
export async function projectInventory(db: Executor, user: Scope, projectId?: string): Promise<{ project_id: string; project_name: string; available: number; hold: number; blocked: number; booked: number; sold: number; total: number; construction_percent: number }[]> {
  if (projectId) ensureProjectAccess(user, projectId);
  const where = defined([eq(projects.companyId, user.companyId), eq(projects.isActive, true), scopeFilter(user, projects.id), projectId ? eq(projects.id, projectId) : undefined]);
  const [projRows, counts, progress] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects).where(where).orderBy(asc(projects.name)),
    db.select({ projectId: flats.projectId, status: flats.status, n: sql<number>`count(*)::int` }).from(flats)
      .where(defined([eq(flats.companyId, user.companyId), scopeFilter(user, flats.projectId), projectId ? eq(flats.projectId, projectId) : undefined])).groupBy(flats.projectId, flats.status),
    db.execute<{ project_id: string; pct: string }>(sql`
      select b.project_id, coalesce(avg(case when s.total > 0 then s.done * 100.0 / s.total else 0 end), 0) as pct
      from blocks b join (select block_id, count(*) as total, count(*) filter (where status = 'COMPLETED') as done from block_stages group by block_id) s on s.block_id = b.id
      where b.company_id = ${user.companyId}::uuid and b.is_active and ${scopeSql(user, sql`b.project_id`)} ${projectId ? sql`and b.project_id = ${projectId}::uuid` : sql``}
      group by b.project_id`),
  ]);
  const pct = new Map(progress.map((p) => [p.project_id, Math.round(Number(p.pct) * 100) / 100]));
  return projRows.map((p) => {
    const row = { project_id: p.id, project_name: p.name, available: 0, hold: 0, blocked: 0, booked: 0, sold: 0, total: 0, construction_percent: pct.get(p.id) ?? 0 };
    for (const c of counts) {
      if (c.projectId !== p.id) continue;
      const key = c.status.toLowerCase() as "available" | "hold" | "blocked" | "booked" | "sold";
      row[key] += c.n;
      row.total += c.n;
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Sales & leads funnel
// ---------------------------------------------------------------------------

/** Funnel: leads created in the range by stage/source, salesperson productivity (leads, visits, bookings, first response), website figures. */
export async function salesFunnel(db: Executor, user: Scope, q: SalesFunnelQuery): Promise<SalesFunnelResponse> {
  if (q.project_id) ensureProjectAccess(user, q.project_id);
  const start = istDayStart(q.from);
  const end = istDayEnd(q.to);
  // leads of projects in scope (leads without a project are visible to users who see every project)
  const leadScope = user.allProjects ? undefined : user.projectIds.length === 0 ? sql`false` : inArray(leads.projectId, user.projectIds);
  const leadWhere = defined([
    eq(leads.companyId, user.companyId), gte(leads.createdAt, start), lte(leads.createdAt, end), leadScope,
    q.project_id ? eq(leads.projectId, q.project_id) : undefined, q.source ? eq(leads.source, q.source) : undefined, q.assigned_user_id ? eq(leads.assignedUserId, q.assigned_user_id) : undefined,
  ]);
  const firstResponse = db
    .select({ leadId: leadActivities.leadId, firstAt: sql<Date>`min(${leadActivities.at})`.as("first_at") })
    .from(leadActivities)
    .where(and(eq(leadActivities.actorType, "STAFF"), inArray(leadActivities.type, ["FOLLOW_UP", "NOTE", "STAGE_CHANGED", "VISIT_BOOKED", "CONVERTED"])))
    .groupBy(leadActivities.leadId)
    .as("fr");
  const [leadRows, visitRows, bookingRows, websiteEnquiries, brochures, visitStatus] = await Promise.all([
    db.select({ id: leads.id, stage: leads.stage, source: leads.source, assignedUserId: leads.assignedUserId, userName: users.name, createdAt: leads.createdAt, firstAt: firstResponse.firstAt })
      .from(leads).leftJoin(users, eq(users.id, leads.assignedUserId)).leftJoin(firstResponse, eq(firstResponse.leadId, leads.id)).where(leadWhere),
    db.select({ userId: siteVisits.assigneeUserId, n: sql<number>`count(*)::int` }).from(siteVisits)
      .where(defined([eq(siteVisits.companyId, user.companyId), gte(siteVisits.visitDate, q.from), lte(siteVisits.visitDate, q.to), scopeFilter(user, siteVisits.projectId), q.project_id ? eq(siteVisits.projectId, q.project_id) : undefined, sql`${siteVisits.status} <> 'CANCELLED'`]))
      .groupBy(siteVisits.assigneeUserId),
    db.select({ userId: bookings.salesUserId, userName: users.name, n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${bookings.agreementValuePaise}), 0)` }).from(bookings).leftJoin(users, eq(users.id, bookings.salesUserId))
      .where(defined([eq(bookings.companyId, user.companyId), gte(bookings.bookingDate, q.from), lte(bookings.bookingDate, q.to), scopeFilter(user, bookings.projectId), q.project_id ? eq(bookings.projectId, q.project_id) : undefined, q.assigned_user_id ? eq(bookings.salesUserId, q.assigned_user_id) : undefined]))
      .groupBy(bookings.salesUserId, users.name),
    db.select({ n: sql<number>`count(*)::int` }).from(enquiries)
      .where(defined([eq(enquiries.companyId, user.companyId), gte(enquiries.createdAt, start), lte(enquiries.createdAt, end), q.project_id ? eq(enquiries.projectId, q.project_id) : undefined, user.allProjects ? undefined : user.projectIds.length ? inArray(enquiries.projectId, user.projectIds) : sql`false`])),
    db.select({ n: sql<number>`count(*)::int` }).from(brochureDownloads)
      .where(defined([eq(brochureDownloads.companyId, user.companyId), sql`${brochureDownloads.downloadedAt} is not null`, gte(brochureDownloads.downloadedAt, start), lte(brochureDownloads.downloadedAt, end), scopeFilter(user, brochureDownloads.projectId), q.project_id ? eq(brochureDownloads.projectId, q.project_id) : undefined])),
    db.select({ status: siteVisits.status, n: sql<number>`count(*)::int` }).from(siteVisits)
      .where(defined([eq(siteVisits.companyId, user.companyId), gte(siteVisits.createdAt, start), lte(siteVisits.createdAt, end), scopeFilter(user, siteVisits.projectId), q.project_id ? eq(siteVisits.projectId, q.project_id) : undefined]))
      .groupBy(siteVisits.status),
  ]);
  const stageCounts = new Map<LeadStage, number>();
  const sourceCounts = new Map<LeadSource, { leads: number; converted: number }>();
  const perUser = new Map<string, { user_id: string; user_name: string; leads: number; visits: number; bookings: number; booking_value_paise: number; responseHours: number[] }>();
  const responseHours: number[] = [];
  for (const l of leadRows) {
    stageCounts.set(l.stage, (stageCounts.get(l.stage) ?? 0) + 1);
    const s = sourceCounts.get(l.source) ?? { leads: 0, converted: 0 };
    s.leads += 1; if (l.stage === "CONVERTED") s.converted += 1; sourceCounts.set(l.source, s);
    const hours = l.firstAt ? Math.max(0, (new Date(l.firstAt).getTime() - new Date(l.createdAt).getTime()) / 3_600_000) : null;
    if (hours !== null) responseHours.push(hours);
    if (l.assignedUserId) {
      const u = perUser.get(l.assignedUserId) ?? { user_id: l.assignedUserId, user_name: l.userName ?? "—", leads: 0, visits: 0, bookings: 0, booking_value_paise: 0, responseHours: [] };
      u.leads += 1; if (hours !== null) u.responseHours.push(hours); perUser.set(l.assignedUserId, u);
    }
  }
  for (const v of visitRows) {
    if (!v.userId) continue;
    const u = perUser.get(v.userId) ?? { user_id: v.userId, user_name: "—", leads: 0, visits: 0, bookings: 0, booking_value_paise: 0, responseHours: [] };
    u.visits += Number(v.n); perUser.set(v.userId, u);
  }
  let bookingsTotal = 0;
  for (const b of bookingRows) {
    bookingsTotal += Number(b.n);
    if (!b.userId) continue;
    const u = perUser.get(b.userId) ?? { user_id: b.userId, user_name: b.userName ?? "—", leads: 0, visits: 0, bookings: 0, booking_value_paise: 0, responseHours: [] };
    if (u.user_name === "—" && b.userName) u.user_name = b.userName;
    u.bookings += Number(b.n); u.booking_value_paise += Number(b.value); perUser.set(b.userId, u);
  }
  const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);
  const stages: LeadStage[] = ["NEW", "CONTACTED", "SITE_VISIT_SCHEDULED", "SITE_VISIT_DONE", "NEGOTIATION", "CONVERTED", "LOST"];
  const converted = stageCounts.get("CONVERTED") ?? 0;
  return {
    by_stage: stages.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
    by_source: [...sourceCounts.entries()].map(([source, s]) => ({ source, leads: s.leads, converted: s.converted, conversion_percent: percentOf(s.converted, s.leads) })).sort((a, b) => b.leads - a.leads),
    by_salesperson: [...perUser.values()].map(({ responseHours: rh, ...u }) => ({ ...u, avg_first_response_hours: avg(rh) })).sort((a, b) => b.bookings - a.bookings || b.leads - a.leads),
    website: {
      enquiries: Number(websiteEnquiries[0]?.n ?? 0),
      brochure_downloads: Number(brochures[0]?.n ?? 0),
      site_visits_booked: visitStatus.reduce((s, r) => s + Number(r.n), 0),
      site_visits_by_status: visitStatus.map((r) => ({ status: r.status as VisitStatus, count: Number(r.n) })),
    },
    avg_response_hours: avg(responseHours),
    totals: { leads: leadRows.length, converted, lost: stageCounts.get("LOST") ?? 0, bookings: bookingsTotal },
  };
}

// ---------------------------------------------------------------------------
// Activity / logins / failed logins
// ---------------------------------------------------------------------------

/** Paged activity: audit rows (kind AUDIT) or login events (LOGIN = successful, FAILED_LOGIN = failed), newest first. */
export async function activityReport(db: Executor, user: Scope, q: ActivityReportQuery): Promise<ActivityReportResponse> {
  if (q.kind === "AUDIT") {
    const where = defined([
      eq(auditLogs.companyId, user.companyId), q.from ? gte(auditLogs.createdAt, istDayStart(q.from)) : undefined, q.to ? lte(auditLogs.createdAt, istDayEnd(q.to)) : undefined,
      q.user_id ? eq(auditLogs.actorId, q.user_id) : undefined, q.entity_type ? eq(auditLogs.entityType, q.entity_type) : undefined,
    ]);
    const r = await paginate<typeof auditLogs.$inferSelect>(db, {
      table: auditLogs, where, search: { columns: [auditLogs.action, auditLogs.actorName, auditLogs.entityType], term: q.search },
      sort: { allowed: { created_at: auditLogs.createdAt, action: auditLogs.action, entity_type: auditLogs.entityType, actor_name: auditLogs.actorName }, default: "-created_at", requested: q.sort }, ...listPaging(q),
    });
    const items: ActivityReportRow[] = r.items.map((a) => ({ at: a.createdAt.toISOString(), kind: "AUDIT", actor_type: a.actorType, actor_name: a.actorName, identifier: null, action: a.action, entity_type: a.entityType, entity_id: a.entityId, ip: a.ip, reason: null }));
    return { ...r, items };
  }
  const success = q.kind === "LOGIN";
  let identifier: string | undefined;
  if (q.user_id) {
    const [u] = await db.select({ email: users.email }).from(users).where(and(eq(users.id, q.user_id), eq(users.companyId, user.companyId))).limit(1);
    identifier = u?.email ?? "\u0000"; // unknown user → no rows
  }
  const where = defined([
    sql`(${loginEvents.companyId} = ${user.companyId}::uuid or ${loginEvents.companyId} is null)`, eq(loginEvents.success, success),
    q.from ? gte(loginEvents.createdAt, istDayStart(q.from)) : undefined, q.to ? lte(loginEvents.createdAt, istDayEnd(q.to)) : undefined, identifier ? eq(loginEvents.identifier, identifier) : undefined,
  ]);
  const r = await paginate<typeof loginEvents.$inferSelect>(db, {
    table: loginEvents, where, search: { columns: [loginEvents.identifier, loginEvents.ip, loginEvents.reason], term: q.search },
    sort: { allowed: { created_at: loginEvents.createdAt, identifier: loginEvents.identifier }, default: "-created_at", requested: q.sort }, ...listPaging(q),
  });
  const items: ActivityReportRow[] = r.items.map((l) => ({
    at: l.createdAt.toISOString(), kind: success ? "LOGIN" : "FAILED_LOGIN", actor_type: l.subjectType === "CUSTOMER" ? "CUSTOMER" : "STAFF", actor_name: null, identifier: l.identifier,
    action: success ? "auth.login" : "auth.login_failed", entity_type: null, entity_id: null, ip: l.ip, reason: l.reason,
  }));
  return { ...r, items };
}

/** Site visits of one IST date in scope (dashboard "today's site visits"). */
export async function visitsOn(db: Executor, user: Scope, date: string, projectId?: string) {
  return db
    .select({ v: siteVisits, projectName: projects.name })
    .from(siteVisits)
    .innerJoin(projects, eq(projects.id, siteVisits.projectId))
    .where(defined([eq(siteVisits.companyId, user.companyId), eq(siteVisits.visitDate, date), scopeFilter(user, siteVisits.projectId), projectId ? eq(siteVisits.projectId, projectId) : undefined, sql`${siteVisits.status} <> 'CANCELLED'`]))
    .orderBy(asc(siteVisits.slotStart), asc(siteVisits.name));
}

export { desc, monthKey };
