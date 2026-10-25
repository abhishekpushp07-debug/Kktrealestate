import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { SearchQuerySchema, SearchResponseSchema, type SearchEntityType, type SearchResult } from "@kkt/contracts";
import { blocks, bookings, customers, flats, projects } from "@kkt/db";
import { escapeLike } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { scopeFilter, type StaffContext } from "../../lib/scope.js";

const BUDGET_MS = 150;

function withBudget<T>(p: Promise<T[]>, log: (msg: string) => void, what: string): Promise<T[]> {
  return Promise.race([p, new Promise<T[]>((resolve) => setTimeout(() => { log(`search: ${what} exceeded ${BUDGET_MS} ms budget`); resolve([]); }, BUDGET_MS))]);
}

/** Command-palette search across projects, blocks, flats, customers and bookings (ILIKE: prefix on codes/numbers/phones, contains on names; scope-aware; 20 results max). */
export async function searchModule(app: FastifyInstance): Promise<void> {
  route(app, {
    method: "GET", url: "/search", permission: "project.read",
    schema: { querystring: SearchQuerySchema, response: { 200: SearchResponseSchema }, summary: "Global search (Ctrl/Cmd+K)" },
    handler: async (req) => {
      const user = req.user as StaffContext;
      const q = req.query;
      const limit = Math.min(20, q.limit);
      const per = Math.max(3, Math.ceil(limit / 2));
      const prefix = `${escapeLike(q.q)}%`;
      const contains = `%${escapeLike(q.q)}%`;
      const types = new Set<SearchEntityType>(q.types ?? ["PROJECT", "BLOCK", "FLAT", "CUSTOMER", "BOOKING"]);
      const db = app.dbReplica;
      const company = user.companyId;
      const log = (m: string) => req.log.warn(m);
      const scoped = (col: AnyPgColumn): SQL | undefined => scopeFilter(user, col);

      const tasks: Promise<SearchResult[]>[] = [];
      if (types.has("PROJECT")) tasks.push(withBudget(db.select({ id: projects.id, name: projects.name, code: projects.code, city: projects.city }).from(projects)
        .where(and(eq(projects.companyId, company), eq(projects.isActive, true), scoped(projects.id), or(ilike(projects.name, contains), ilike(projects.code, prefix)))).limit(per)
        .then((rows) => rows.map((r) => ({ type: "PROJECT" as const, id: r.id, label: r.name, sublabel: [r.code, r.city].filter(Boolean).join(" · ") || null, href: `/projects/${r.id}` }))), log, "projects"));
      if (types.has("BLOCK")) tasks.push(withBudget(db.select({ id: blocks.id, name: blocks.name, code: blocks.code, projectId: blocks.projectId, projectName: projects.name }).from(blocks).innerJoin(projects, eq(projects.id, blocks.projectId))
        .where(and(eq(blocks.companyId, company), eq(blocks.isActive, true), scoped(blocks.projectId), or(ilike(blocks.name, contains), ilike(blocks.code, prefix)))).limit(per)
        .then((rows) => rows.map((r) => ({ type: "BLOCK" as const, id: r.id, label: r.name, sublabel: r.projectName, href: `/blocks/${r.id}` }))), log, "blocks"));
      if (types.has("FLAT")) tasks.push(withBudget(db.select({ id: flats.id, number: flats.flatNumber, status: flats.status, projectId: flats.projectId, blockId: flats.blockId, blockName: blocks.name }).from(flats).innerJoin(blocks, eq(blocks.id, flats.blockId))
        .where(and(eq(flats.companyId, company), scoped(flats.projectId), ilike(flats.flatNumber, prefix))).limit(per)
        .then((rows) => rows.map((r) => ({ type: "FLAT" as const, id: r.id, label: r.number, sublabel: `${r.blockName} · ${r.status}`, href: `/blocks/${r.blockId}?flat=${r.id}` }))), log, "flats"));
      if (types.has("CUSTOMER")) tasks.push(withBudget(db.select({ id: customers.id, name: customers.fullName, phone: customers.phone, code: customers.customerCode }).from(customers)
        .where(and(eq(customers.companyId, company), eq(customers.isActive, true), or(ilike(customers.fullName, contains), ilike(customers.phone, prefix), ilike(customers.customerCode, prefix)))).limit(per)
        .then((rows) => rows.map((r) => ({ type: "CUSTOMER" as const, id: r.id, label: r.name, sublabel: `${r.code} · ${r.phone}`, href: `/customers/${r.id}` }))), log, "customers"));
      if (types.has("BOOKING")) tasks.push(withBudget(db.select({ id: bookings.id, number: bookings.bookingNumber, customerName: customers.fullName, status: bookings.status, flat: sql<string>`${bookings.flatSnapshot}->>'flat_number'` }).from(bookings).innerJoin(customers, eq(customers.id, bookings.customerId))
        .where(and(eq(bookings.companyId, company), scoped(bookings.projectId), or(ilike(bookings.bookingNumber, prefix), ilike(customers.fullName, contains)))).limit(per)
        .then((rows) => rows.map((r) => ({ type: "BOOKING" as const, id: r.id, label: r.number, sublabel: `${r.customerName} · ${r.flat} · ${r.status}`, href: `/bookings/${r.id}` }))), log, "bookings"));
      const results = (await Promise.all(tasks)).flat().slice(0, limit);
      return { results, recent: [] };
    },
  });
}
