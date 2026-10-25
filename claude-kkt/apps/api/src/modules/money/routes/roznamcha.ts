/** Routes: /roznamcha (day book) and contra entries (SPEC §11). */
import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ContraEntryCreateSchema, ContraEntryFilterSchema, ContraEntryListResponseSchema, ContraEntryRowSchema, RoznamchaDayQuerySchema, RoznamchaQuerySchema, RoznamchaResponseSchema } from "@kkt/contracts";
import { bankAccounts, contraEntries, users } from "@kkt/db";
import { listPaging, paginate } from "../../../lib/list.js";
import { route } from "../../../lib/routes.js";
import { ensureProjectAccess } from "../../../lib/scope.js";
import { actorOf, todayDate } from "../common.js";
import { contraRow, createContra, roznamcha, toContraRow } from "../services/roznamcha.js";

export function registerRoznamchaRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/roznamcha", permission: "payment.read",
    schema: { querystring: RoznamchaDayQuerySchema, response: { 200: RoznamchaResponseSchema }, summary: "Day book for one date (default today): opening cash, receipts by mode/category/project, contra, closing cash" },
    handler: async (req) => {
      const user = req.user!;
      if (req.query.project_id) ensureProjectAccess(user, req.query.project_id);
      const date = req.query.date ?? todayDate();
      return roznamcha(app.dbReplica, user, date, date, req.query.project_id);
    },
  });

  route(app, {
    method: "GET", url: "/roznamcha/range", permission: "payment.read",
    schema: { querystring: RoznamchaQuerySchema, response: { 200: RoznamchaResponseSchema }, summary: "Day book for a date range" },
    handler: async (req) => {
      const user = req.user!;
      if (req.query.project_id) ensureProjectAccess(user, req.query.project_id);
      return roznamcha(app.dbReplica, user, req.query.from, req.query.to, req.query.project_id);
    },
  });

  route(app, {
    method: "POST", url: "/roznamcha/contra", permission: "payment.post", idempotent: true,
    schema: { body: ContraEntryCreateSchema, response: { 201: ContraEntryRowSchema }, summary: "Record cash deposited to / withdrawn from bank (deposit ≤ cash in hand)" },
    handler: async (req, reply) => {
      const id = await createContra(app.db, req.user!, req.body, actorOf(req));
      return reply.code(201).send(await contraRow(app.db, req.user!.companyId, id));
    },
  });

  route(app, {
    method: "GET", url: "/roznamcha/contra", permission: "payment.read",
    schema: { querystring: ContraEntryFilterSchema, response: { 200: ContraEntryListResponseSchema }, summary: "List contra entries" },
    handler: async (req) => {
      const user = req.user!;
      const q = req.query;
      const where: (SQL | undefined)[] = [eq(contraEntries.companyId, user.companyId)];
      if (q.from) where.push(gte(contraEntries.entryDate, q.from));
      if (q.to) where.push(lte(contraEntries.entryDate, q.to));
      if (q.type) where.push(eq(contraEntries.type, q.type));
      if (q.bank_account_id) where.push(eq(contraEntries.bankAccountId, q.bank_account_id));
      interface Sel { c: typeof contraEntries.$inferSelect; bankName: string | null; last4: string | null; byName: string | null }
      const result = await paginate<Sel>(app.dbReplica, {
        table: contraEntries, select: { c: contraEntries, bankName: bankAccounts.bankName, last4: bankAccounts.accountNumberLast4, byName: users.name },
        join: (qb) => qb.leftJoin(bankAccounts, eq(bankAccounts.id, contraEntries.bankAccountId)).leftJoin(users, eq(users.id, contraEntries.byUserId)),
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [contraEntries.remarks, bankAccounts.bankName], term: q.search },
        sort: { allowed: { entry_date: contraEntries.entryDate, amount_paise: contraEntries.amountPaise, created_at: contraEntries.createdAt }, default: "-entry_date", requested: q.sort },
        ...listPaging(q),
      });
      return { ...result, items: result.items.map((r) => toContraRow(r.c, r.bankName ? { name: r.bankName, last4: r.last4 ?? "" } : undefined, r.byName)) };
    },
  });
}
