/**
 * Per-project website toggles (project_website_settings), site-visit settings (project_visit_settings) and brochure statistics (SPEC §15).
 * Publishing requires at least one hero image, a description and a location → 422 PUBLISH_REQUIREMENTS with details.missing.
 */
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BrochureStatsResponseSchema, IdSchema, ProjectWebsitePublishSchema, ProjectWebsiteSettingsRowSchema, ProjectWebsiteSettingsUpdateSchema, VisitSettingsRowSchema, VisitSettingsUpdateSchema,
  type ProjectWebsiteSettingsRow, type VisitSettingsRow,
} from "@kkt/contracts";
import { brochureDownloads, projectVisitSettings, projectWebsiteSettings, projects, type Executor } from "@kkt/db";
import { addDays, slugify, toISTDateString, todayIST } from "@kkt/domain";
import { actorFromRequest, auditMeta, writeAudit } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { camelRow } from "../../lib/rows.js";
import { ensureProjectAccess, hasAnyPermission, type StaffContext } from "../../lib/scope.js";
import { expectedVersion, withOptionalVersion } from "../../lib/version.js";
import { seoWire } from "./cms.js";
import { assertDocuments, bustPublicCache, documentUrls, isPublicDocument, loadDocuments, loadProjectById, updateByKey, type DocumentRecord } from "./shared.js";
import { ensureVisitSettings, visitSettingsWire } from "./visitService.js";

export type DbProject = typeof projects.$inferSelect;
export type DbWebsiteSettings = typeof projectWebsiteSettings.$inferSelect;

const idParams = z.object({ id: IdSchema });

/** 403 unless the user may edit website/visit settings (project.write or cms.write — Marketing edits them too). */
function assertWebsiteWrite(user: StaffContext): void {
  if (!hasAnyPermission(user, ["project.write", "cms.write"])) throw ApiError.forbidden("Missing permission project.write", { permission: "project.write" });
}

/** Loads a project in the user's scope (404 outside it or when missing). */
export async function loadScopedProject(db: Executor, user: StaffContext, projectId: string): Promise<DbProject> {
  ensureProjectAccess(user, projectId);
  const p = await loadProjectById(db, user.companyId, projectId);
  if (!p) throw ApiError.notFound("Project");
  return p;
}

/** Unique slug for a project: slugified name, then name-code, then name-code-n. */
async function uniqueSlug(tx: Executor, project: DbProject): Promise<string> {
  const base = slugify(project.name) || slugify(project.code) || project.id.slice(0, 8);
  const candidates = [base, `${base}-${slugify(project.code)}`];
  for (let i = 2; i < 50; i++) candidates.push(`${base}-${i}`);
  for (const slug of candidates) {
    const [taken] = await tx.select({ projectId: projectWebsiteSettings.projectId }).from(projectWebsiteSettings).where(eq(projectWebsiteSettings.slug, slug)).limit(1);
    if (!taken) return slug;
  }
  return `${base}-${project.id.slice(0, 8)}`;
}

/** Loads the website settings row of a project, creating the default (unpublished, slug from the name) when missing. */
export async function ensureWebsiteSettings(tx: Executor, project: DbProject): Promise<DbWebsiteSettings> {
  const [existing] = await tx.select().from(projectWebsiteSettings).where(eq(projectWebsiteSettings.projectId, project.id)).limit(1);
  if (existing) return existing;
  const slug = await uniqueSlug(tx, project);
  const [created] = await tx.insert(projectWebsiteSettings).values({ projectId: project.id, slug }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await tx.select().from(projectWebsiteSettings).where(eq(projectWebsiteSettings.projectId, project.id)).limit(1);
  if (!again) throw new Error("project_website_settings insert produced no row");
  return again;
}

/** What still blocks publishing: hero image, description, location (SPEC §15 "Cannot publish without hero image, description and location"). */
export function publishBlockers(project: DbProject, w: Pick<DbWebsiteSettings, "heroDocumentIds">, docs: Map<string, DocumentRecord>): string[] {
  const missing: string[] = [];
  const heroes = w.heroDocumentIds.filter((id) => isPublicDocument(docs.get(id)) && docs.get(id)!.mime.startsWith("image/"));
  if (heroes.length === 0) missing.push("hero_image");
  if (!project.description || project.description.trim().length === 0) missing.push("description");
  const hasAddress = Boolean(project.address?.line1 && project.address.city);
  const hasCoords = project.latitude !== null && project.longitude !== null;
  if (!hasAddress && !hasCoords) missing.push("location");
  return missing;
}

/** Zero-filled daily download counts for the last 30 IST days (inclusive of today). */
export async function brochureSparkline(db: Executor, projectId: string, days = 30): Promise<{ date: string; count: number }[]> {
  const today = todayIST();
  const start = addDays(today, -(days - 1));
  const since = new Date(`${start}T00:00:00+05:30`);
  const rows = await db.select({ downloadedAt: brochureDownloads.downloadedAt }).from(brochureDownloads).where(and(eq(brochureDownloads.projectId, projectId), isNotNull(brochureDownloads.downloadedAt), gte(brochureDownloads.downloadedAt, since)));
  const counts = new Map<string, number>();
  for (const r of rows) {
    const d = toISTDateString(r.downloadedAt!);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const out: { date: string; count: number }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

async function websiteRow(db: Executor, project: DbProject, w: DbWebsiteSettings): Promise<ProjectWebsiteSettingsRow> {
  const docs = await loadDocuments(db, [...w.heroDocumentIds, w.brochureDocumentId]);
  const blockers = publishBlockers(project, w, docs);
  const brochure = w.brochureDocumentId ? docs.get(w.brochureDocumentId) : undefined;
  return {
    slug: w.slug ?? "",
    is_published: w.isPublished,
    show_prices: w.showPrices,
    show_availability: w.showAvailability,
    show_progress: w.showProgress,
    starting_price_override_paise: w.startingPriceOverridePaise ?? null,
    hero_document_ids: w.heroDocumentIds,
    highlights: w.highlights,
    video_urls: w.videoUrls,
    tour_urls: w.tourUrls,
    map_embed_url: w.mapEmbedUrl ?? null,
    brochure_document_id: w.brochureDocumentId ?? null,
    faqs: w.faqs,
    seo: seoWire(w.seo),
    project_id: project.id,
    project_name: project.name,
    hero_urls: w.heroDocumentIds.map((id) => documentUrls(docs.get(id)).url).filter((u): u is string => Boolean(u)),
    brochure_file_name: brochure && !brochure.isDeleted ? brochure.fileName : null,
    brochure_download_count: w.brochureDownloadCount,
    brochure_downloads_30d: await brochureSparkline(db, project.id),
    published_at: w.publishedAt ? w.publishedAt.toISOString() : null,
    can_publish: blockers.length === 0,
    publish_blockers: blockers,
    updated_at: w.updatedAt.toISOString(),
    version: w.version,
  };
}

/** Applies a website-settings patch inside `tx` with the publish rule, slug uniqueness and document checks; returns the new row. */
async function applyWebsitePatch(tx: Executor, user: StaffContext, project: DbProject, patch: Record<string, unknown>, version: number): Promise<DbWebsiteSettings> {
  const existing = await ensureWebsiteSettings(tx, project);
  const heroIds = (patch["hero_document_ids"] as string[] | undefined) ?? existing.heroDocumentIds;
  const brochureId = patch["brochure_document_id"] === undefined ? existing.brochureDocumentId : (patch["brochure_document_id"] as string | null);
  const seo = patch["seo"] as { og_image_document_id?: string | null } | null | undefined;
  await assertDocuments(tx, user.companyId, heroIds, "image", "hero_document_ids");
  await assertDocuments(tx, user.companyId, [brochureId], "pdf", "brochure_document_id");
  await assertDocuments(tx, user.companyId, [seo?.og_image_document_id], "image", "seo.og_image_document_id");
  const willPublish = (patch["is_published"] as boolean | undefined) ?? existing.isPublished;
  if (willPublish) {
    const docs = await loadDocuments(tx, heroIds);
    const missing = publishBlockers(project, { heroDocumentIds: heroIds }, docs);
    if (missing.length > 0) throw new ApiError(422, "PUBLISH_REQUIREMENTS", `Cannot publish: add ${missing.map((m) => m.replace(/_/g, " ")).join(", ")} first`, { rule: "PUBLISH_REQUIREMENTS", missing });
  }
  if (typeof patch["slug"] === "string" && patch["slug"] !== existing.slug) {
    const [taken] = await tx.select({ projectId: projectWebsiteSettings.projectId }).from(projectWebsiteSettings).where(and(eq(projectWebsiteSettings.slug, patch["slug"]), sql`${projectWebsiteSettings.projectId} <> ${project.id}`)).limit(1);
    if (taken) throw ApiError.conflict("DUPLICATE", "Another project already uses this slug", { field: "slug", value: patch["slug"] });
  }
  const changes = camelRow(patch);
  for (const k of Object.keys(changes)) if (changes[k] === undefined) delete changes[k];
  if (changes["seo"] === null) changes["seo"] = {};
  if (willPublish && !existing.isPublished) changes["publishedAt"] = new Date();
  if (!willPublish && existing.isPublished) changes["publishedAt"] = null;
  return updateByKey(tx, projectWebsiteSettings, projectWebsiteSettings.projectId, project.id, version, changes, "project_website_settings");
}

export function registerProjectWebsiteRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/projects/:id/website", permission: "project.read",
    schema: { params: idParams, response: { 200: ProjectWebsiteSettingsRowSchema }, summary: "Project website toggles, hero images, brochure, FAQs, SEO" },
    handler: async (req) => {
      const user = req.user!;
      const project = await loadScopedProject(app.db, user, req.params.id);
      const w = await app.db.transaction((tx) => ensureWebsiteSettings(tx, project));
      return websiteRow(app.db, project, w);
    },
  });

  route(app, {
    method: "PATCH", url: "/projects/:id/website", permission: "project.read",
    schema: { params: idParams, body: withOptionalVersion(ProjectWebsiteSettingsUpdateSchema), response: { 200: ProjectWebsiteSettingsRowSchema }, summary: "Update project website settings (project.write or cms.write); publishing needs hero image, description and location" },
    handler: async (req) => {
      const user = req.user!;
      assertWebsiteWrite(user);
      const body = req.body as Record<string, unknown> & { version?: number };
      const version = expectedVersion(req, body);
      const { version: _v, ...patch } = body;
      const project = await loadScopedProject(app.db, user, req.params.id);
      const view = await app.db.transaction(async (tx) => {
        const before = await websiteRow(tx, project, await ensureWebsiteSettings(tx, project));
        const updated = await applyWebsitePatch(tx, user, project, patch, version);
        const after = await websiteRow(tx, project, updated);
        await writeAudit(tx, { companyId: user.companyId, actor: actorFromRequest(req), action: "project_website_settings.update", entityType: "project_website_settings", entityId: project.id, before, after, ...auditMeta(req) });
        return after;
      });
      await bustPublicCache(app);
      return view;
    },
  });

  route(app, {
    method: "POST", url: "/projects/:id/website/publish", permission: "project.read",
    schema: { params: idParams, body: withOptionalVersion(ProjectWebsitePublishSchema), response: { 200: ProjectWebsiteSettingsRowSchema }, summary: "Publish / unpublish a project on the website" },
    handler: async (req) => {
      const user = req.user!;
      assertWebsiteWrite(user);
      const body = req.body as { version?: number; is_published: boolean };
      const version = expectedVersion(req, body);
      const project = await loadScopedProject(app.db, user, req.params.id);
      const view = await app.db.transaction(async (tx) => {
        const before = await websiteRow(tx, project, await ensureWebsiteSettings(tx, project));
        const updated = await applyWebsitePatch(tx, user, project, { is_published: body.is_published }, version);
        const after = await websiteRow(tx, project, updated);
        await writeAudit(tx, { companyId: user.companyId, actor: actorFromRequest(req), action: body.is_published ? "project_website_settings.publish" : "project_website_settings.unpublish", entityType: "project_website_settings", entityId: project.id, before: { is_published: before.is_published }, after: { is_published: after.is_published }, ...auditMeta(req) });
        return after;
      });
      await bustPublicCache(app);
      return view;
    },
  });

  route(app, {
    method: "GET", url: "/projects/:id/brochure-stats", permission: "project.read",
    schema: { params: idParams, response: { 200: BrochureStatsResponseSchema }, summary: "Brochure download counts with a 30-day daily sparkline" },
    handler: async (req) => {
      const user = req.user!;
      const project = await loadScopedProject(app.dbReplica, user, req.params.id);
      const [w] = await app.dbReplica.select({ count: projectWebsiteSettings.brochureDownloadCount }).from(projectWebsiteSettings).where(eq(projectWebsiteSettings.projectId, project.id)).limit(1);
      const since = new Date(`${addDays(todayIST(), -29)}T00:00:00+05:30`);
      const [agg] = await app.dbReplica
        .select({
          requests: sql<number>`count(*)::int`,
          downloads30: sql<number>`count(*) filter (where ${brochureDownloads.downloadedAt} >= ${since.toISOString()}::timestamptz)::int`,
          last: sql<Date | string | null>`max(${brochureDownloads.downloadedAt})`,
        })
        .from(brochureDownloads)
        .where(eq(brochureDownloads.projectId, project.id));
      return {
        project_id: project.id,
        download_count: w?.count ?? 0,
        requests_count: Number(agg?.requests ?? 0),
        downloads_30d: Number(agg?.downloads30 ?? 0),
        last_download_at: agg?.last ? new Date(agg.last).toISOString() : null,
        sparkline: await brochureSparkline(app.dbReplica, project.id),
      };
    },
  });

  route(app, {
    method: "GET", url: "/projects/:id/visit-settings", permission: "project.read",
    schema: { params: idParams, response: { 200: VisitSettingsRowSchema }, summary: "Site-visit scheduler settings of a project" },
    handler: async (req) => {
      const user = req.user!;
      const project = await loadScopedProject(app.db, user, req.params.id);
      const row = await app.db.transaction((tx) => ensureVisitSettings(tx, project.id));
      return visitSettingsRow(row);
    },
  });

  route(app, {
    method: "PATCH", url: "/projects/:id/visit-settings", permission: "project.read",
    schema: { params: idParams, body: withOptionalVersion(VisitSettingsUpdateSchema), response: { 200: VisitSettingsRowSchema }, summary: "Update site-visit settings (project.write or cms.write)" },
    handler: async (req) => {
      const user = req.user!;
      assertWebsiteWrite(user);
      const body = req.body as z.infer<typeof VisitSettingsUpdateSchema> & { version?: number };
      const version = expectedVersion(req, body);
      const project = await loadScopedProject(app.db, user, req.params.id);
      const s = body.settings;
      const view = await app.db.transaction(async (tx) => {
        const existing = await ensureVisitSettings(tx, project.id);
        const updated = await updateByKey(tx, projectVisitSettings, projectVisitSettings.projectId, project.id, version, {
          enabled: s.enabled, visitDays: s.visit_days, startTime: s.start_time, endTime: s.end_time, slotMinutes: s.slot_minutes, seatsPerSlot: s.seats_per_slot, minLeadHours: s.min_lead_hours,
          maxDaysAhead: s.max_days_ahead, blackoutDates: s.blackout_dates, siteOfficeAddress: s.site_office_address ?? null, mapsLink: s.maps_link ?? null, instructions: s.instructions ?? null,
        }, "project_visit_settings");
        await writeAudit(tx, { companyId: user.companyId, actor: actorFromRequest(req), action: "project_visit_settings.update", entityType: "project_visit_settings", entityId: project.id, before: visitSettingsWire(existing), after: visitSettingsWire(updated), ...auditMeta(req) });
        return visitSettingsRow(updated);
      });
      await bustPublicCache(app);
      return view;
    },
  });
}

function visitSettingsRow(row: typeof projectVisitSettings.$inferSelect): VisitSettingsRow {
  return { project_id: row.projectId, settings: visitSettingsWire(row), updated_at: row.updatedAt.toISOString(), version: row.version };
}
