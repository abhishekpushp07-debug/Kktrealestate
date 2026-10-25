/**
 * Public site-visit scheduler (SPEC §15): availability (cached 60 s), atomic booking (409 SLOT_FULL), manage view, .ics and cancel by token.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DateStringSchema, PublicVisitAvailabilityDaysSchema, PublicVisitAvailabilityQuerySchema, PublicVisitBookingInputSchema, PublicVisitCancelInputSchema, PublicVisitManageResponseSchema,
  PublicVisitBookingResponseSchema, SlugSchema, TimeStringSchema, type PublicVisitManageResponse,
} from "@kkt/contracts";
import type { Executor } from "@kkt/db";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { FORM_RATE_LIMIT } from "./publicForms.js";
import { publishedProjects, type PublishedProject } from "./publicContent.js";
import { RelaxedHoneypotSchema, WEBSITE_ACTOR, bustPublicCache, clock, fakeCode, isHoneypotTripped, noStore, publicCached, publicCompanyId, publicMeta, relaxHoneypot } from "./shared.js";
import {
  bookVisit, cancelVisit, clampRange, icsUrl, isPast, loadVisitByToken, loadVisitSettings, manageUrl, projectAvailability, visitIcs, type DbVisitSettings, type VisitSelect,
} from "./visitService.js";

const { website: _website, visit_date: _visitDate, slot_start: _slotStart, ...bookingShape } = PublicVisitBookingInputSchema.shape;

/** Booking body: contracts spellings (visit_date/slot_start) or Appendix B spellings (date/start); honeypot relaxed. */
const BookingBody = z
  .strictObject({ ...bookingShape, website: RelaxedHoneypotSchema, visit_date: DateStringSchema.optional(), slot_start: TimeStringSchema.optional(), date: DateStringSchema.optional(), start: TimeStringSchema.optional() })
  .refine((b) => Boolean(b.visit_date ?? b.date), { message: "visit_date is required", path: ["visit_date"] })
  .refine((b) => Boolean(b.slot_start ?? b.start), { message: "slot_start is required", path: ["slot_start"] });

const CancelBody = relaxHoneypot(PublicVisitCancelInputSchema).optional();
const tokenParams = z.object({ token: z.string().min(16).max(200) });
const slugParams = z.object({ slug: SlugSchema });

async function companyOr404(db: Executor): Promise<string> {
  const id = await publicCompanyId(db);
  if (!id) throw ApiError.notFound("Site");
  return id;
}

async function publishedBySlug(db: Executor, slug: string): Promise<{ companyId: string; project: PublishedProject }> {
  const companyId = await companyOr404(db);
  const [project] = await publishedProjects(db, companyId, slug);
  if (!project) throw ApiError.notFound("Project");
  return { companyId, project };
}

/** Public cache prefix of a project's availability (busted after every booking/cancel/reschedule). */
export function availabilityCachePath(slug: string): string {
  return `/api/v1/public/projects/${slug}/visit-availability`;
}

function manageView(r: VisitSelect, settings: DbVisitSettings | null, token: string, slug: string): PublicVisitManageResponse {
  const v = r.v;
  const start = clock(v.slotStart), end = clock(v.slotEnd);
  const canCancel = (v.status === "CONFIRMED" || v.status === "RESCHEDULED") && !isPast(v);
  return {
    visit_number: v.visitNumber, status: v.status, project_name: r.projectName ?? "", project_slug: slug, visit_date: v.visitDate, slot_start: start, slot_end: end, visitors: v.visitors, name: v.name,
    site_office_address: settings?.siteOfficeAddress ?? null, maps_link: settings?.mapsLink ?? null, instructions: settings?.instructions ?? null, can_cancel: canCancel, ics_url: icsUrl(token),
    date: v.visitDate, start, end, address: settings?.siteOfficeAddress ?? null,
  };
}

/** Loads a visit by manage token with its project slug and settings; 404 when unknown. */
async function visitByToken(db: Executor, token: string): Promise<{ row: VisitSelect; settings: DbVisitSettings | null; slug: string }> {
  const row = await loadVisitByToken(db, token);
  if (!row) throw ApiError.notFound("Site visit");
  const [settings, published] = await Promise.all([loadVisitSettings(db, row.v.projectId), publishedProjects(db, row.v.companyId)]);
  const slug = published.find((p) => p.p.id === row.v.projectId)?.w.slug ?? "";
  return { row, settings, slug };
}

export function registerPublicVisitRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/public/projects/:slug/visit-availability", public: true,
    schema: { params: slugParams, querystring: PublicVisitAvailabilityQuerySchema, response: { 200: PublicVisitAvailabilityDaysSchema }, summary: "Available visit slots per day (IST); hides past, blackout and full slots" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => {
      const { project } = await publishedBySlug(app.dbReplica, req.params.slug);
      const settings = await loadVisitSettings(app.dbReplica, project.p.id);
      if (!settings || !settings.enabled) return [];
      const range = clampRange(settings, req.query.from, req.query.to);
      return projectAvailability(app.dbReplica, project.p.id, settings, range.from, range.to);
    }, "Project"),
  });

  route(app, {
    method: "POST", url: "/public/site-visits", public: true, rateLimit: FORM_RATE_LIMIT, idempotent: true,
    schema: { body: BookingBody, response: { 201: PublicVisitBookingResponseSchema, 200: PublicVisitBookingResponseSchema }, summary: "Book a site visit (capacity re-checked atomically; 409 SLOT_FULL)" },
    handler: async (req, reply) => {
      noStore(reply);
      const body = req.body;
      const date = (body.visit_date ?? body.date)!;
      const start = (body.slot_start ?? body.start)!;
      if (isHoneypotTripped(body)) {
        const token = fakeCode("");
        return reply.code(200).send({ visit_number: fakeCode("SV-"), project_name: "", visit_date: date, slot_start: start, slot_end: start, visitors: body.visitors, site_office_address: null, maps_link: null, instructions: null, ics_url: icsUrl(token), manage_url: manageUrl(token), date, start, end: start, address: null });
      }
      const { companyId, project } = await publishedBySlug(app.db, body.project_slug);
      const settings = await loadVisitSettings(app.db, project.p.id);
      if (!settings || !settings.enabled) throw ApiError.rule("Site visits are not open for this project", "VISITS_DISABLED");
      const booked = await app.db.transaction((tx) => bookVisit(tx, {
        companyId, project: { id: project.p.id, name: project.p.name }, settings, date, start, name: body.name, phone: body.phone, email: body.email ?? null, visitors: body.visitors, message: body.message ?? null,
        source: "WEBSITE", utm: body.utm ?? null, actor: WEBSITE_ACTOR, redis: app.redis, mode: "public", ...publicMeta(req),
      }));
      await bustPublicCache(app, availabilityCachePath(body.project_slug));
      const v = booked.visit;
      const s = clock(v.slotStart), e = clock(v.slotEnd);
      return reply.code(201).send({
        visit_number: v.visitNumber, project_name: project.p.name, visit_date: v.visitDate, slot_start: s, slot_end: e, visitors: v.visitors,
        site_office_address: settings.siteOfficeAddress ?? null, maps_link: settings.mapsLink ?? null, instructions: settings.instructions ?? null, ics_url: icsUrl(booked.token), manage_url: manageUrl(booked.token),
        date: v.visitDate, start: s, end: e, address: settings.siteOfficeAddress ?? null,
      });
    },
  });

  route(app, {
    method: "GET", url: "/public/site-visits/:token.ics", public: true,
    schema: { params: tokenParams, response: { 200: z.string() }, summary: "iCalendar file of a visit (Asia/Kolkata, 1-hour reminder)" },
    handler: async (req, reply) => {
      const { row, settings } = await visitByToken(app.dbReplica, req.params.token);
      noStore(reply);
      reply.header("Content-Type", "text/calendar; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="site-visit-${row.v.visitNumber.replace(/[^A-Za-z0-9-]/g, "-")}.ics"`);
      return reply.send(visitIcs(row.v, row.projectName ?? "Site visit", settings, req.params.token));
    },
  });

  route(app, {
    method: "GET", url: "/public/site-visits/:token", public: true,
    schema: { params: tokenParams, response: { 200: PublicVisitManageResponseSchema }, summary: "Manage view of a visit (signed link, no login)" },
    handler: async (req, reply) => {
      const { row, settings, slug } = await visitByToken(app.dbReplica, req.params.token);
      noStore(reply);
      return manageView(row, settings, req.params.token, slug);
    },
  });

  route(app, {
    method: "POST", url: "/public/site-visits/:token/cancel", public: true, rateLimit: FORM_RATE_LIMIT,
    schema: { params: tokenParams, body: CancelBody, response: { 200: PublicVisitManageResponseSchema }, summary: "Cancel a visit from the manage link (seat freed; lead stage reverts when no other visit is upcoming)" },
    handler: async (req, reply) => {
      noStore(reply);
      const { row, settings, slug } = await visitByToken(app.db, req.params.token);
      if (req.body && isHoneypotTripped(req.body)) return manageView(row, settings, req.params.token, slug);
      if (row.v.status === "CANCELLED") return manageView(row, settings, req.params.token, slug);
      if (isPast(row.v)) throw ApiError.rule("This visit has already taken place", "VISIT_PAST");
      await app.db.transaction(async (tx) => {
        const fresh = await loadVisitByToken(tx, req.params.token);
        if (!fresh) throw ApiError.notFound("Site visit");
        await cancelVisit(tx, fresh.v, req.body?.reason ?? "Cancelled by visitor", { actor: WEBSITE_ACTOR, ...publicMeta(req) });
      });
      if (slug) await bustPublicCache(app, availabilityCachePath(slug));
      const after = await visitByToken(app.db, req.params.token);
      return manageView(after.row, after.settings, req.params.token, after.slug);
    },
  });
}
