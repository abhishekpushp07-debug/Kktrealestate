import { and, avg, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ActiveStateResponseSchema, IdSchema, ProjectCreateSchema, ProjectFilterSchema, ProjectListResponseSchema, ProjectRowSchema, ProjectStageSequenceUpdateSchema, ProjectUpdateSchema, VersionedSchema,
  type ProjectCreate, type ProjectRow, type ProjectUpdate,
} from "@kkt/contracts";
import { amenities, bankAccounts, blocks, projectAmenities, projectTeam, projectWebsiteSettings, projects, users, type Executor } from "@kkt/db";
import { writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../lib/scope.js";
import { applyUpdate, expectedVersion, optionalExpectedVersion, withOptionalVersion } from "../../lib/version.js";
import { allStagesPending, assertStageSequence, loadProject, masterStageOrder, meta, refreshProjectCounts, type DbProject } from "./service.js";

const idParams = z.object({ id: IdSchema });

/** Hydrates project rows into the wire shape in a fixed number of queries (amenities, team, publication flag, construction %). */
export async function toProjectRows(db: Executor, rows: readonly DbProject[]): Promise<ProjectRow[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [ams, team, web, progress] = await Promise.all([
    db.select({ projectId: projectAmenities.projectId, amenityId: projectAmenities.amenityId }).from(projectAmenities).where(inArray(projectAmenities.projectId, ids)),
    db.select({ projectId: projectTeam.projectId, userId: projectTeam.userId, roleLabel: projectTeam.roleLabel, userName: users.name }).from(projectTeam).innerJoin(users, eq(users.id, projectTeam.userId)).where(inArray(projectTeam.projectId, ids)),
    db.select({ projectId: projectWebsiteSettings.projectId, isPublished: projectWebsiteSettings.isPublished }).from(projectWebsiteSettings).where(inArray(projectWebsiteSettings.projectId, ids)),
    db.select({ projectId: blocks.projectId, pct: avg(blocks.constructionPercent) }).from(blocks).where(and(inArray(blocks.projectId, ids), eq(blocks.isActive, true))).groupBy(blocks.projectId),
  ]);
  const amByProject = new Map<string, string[]>();
  for (const a of ams) amByProject.set(a.projectId, [...(amByProject.get(a.projectId) ?? []), a.amenityId]);
  const teamByProject = new Map<string, ProjectRow["team"]>();
  for (const t of team) teamByProject.set(t.projectId, [...(teamByProject.get(t.projectId) ?? []), { user_id: t.userId, user_name: t.userName, role_label: t.roleLabel }]);
  const published = new Map(web.map((w) => [w.projectId, w.isPublished]));
  const pct = new Map(progress.map((p) => [p.projectId, Math.round(Number(p.pct ?? 0) * 100) / 100]));
  return rows.map((p) => ({
    id: p.id, company_id: p.companyId, created_at: p.createdAt.toISOString(), updated_at: p.updatedAt.toISOString(), created_by: p.createdBy, version: p.version,
    is_active: p.isActive, deactivated_at: p.deactivatedAt ? p.deactivatedAt.toISOString() : null,
    name: p.name, code: p.code, project_type: p.projectType, status: p.status, description: p.description,
    address: p.address ?? { line1: "Address not set", line2: null, locality: null, city: p.city ?? "Unknown", state: "Unknown", pincode: "100000" },
    city: p.city ?? p.address?.city ?? "", rera_number: p.reraNumber, launch_date: p.launchDate, possession_date: p.possessionDate,
    land_area_sqft: p.landAreaSqft, latitude: p.latitude, longitude: p.longitude,
    landmarks: p.landmarks.map((l) => ({ name: l.name, distance_km: Number(l.distance_km) })),
    approvals: p.approvals.map((a) => ({ name: a.name, number: a.number ?? null, issued_on: a.issued_on ?? null, status: (a.status as ProjectRow["approvals"][number]["status"]) ?? "RECEIVED" })),
    escrow_bank_account_id: p.escrowBankAccountId, stage_sequence: p.stageSequence, amenity_ids: amByProject.get(p.id) ?? [], team: teamByProject.get(p.id) ?? [],
    unit_counts: p.unitCounts, block_count: p.blockCount, construction_percent: pct.get(p.id) ?? 0, is_published: published.get(p.id) ?? false,
  }));
}

/** Loads one project (scoped) in wire shape. */
export async function getProjectRow(db: Executor, user: StaffContext, id: string): Promise<ProjectRow> {
  const [row] = await toProjectRows(db, [await loadProject(db, user, id)]);
  if (!row) throw ApiError.notFound("Project");
  return row;
}

async function assertAmenities(tx: Executor, companyId: string, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await tx.select({ id: amenities.id, isActive: amenities.isActive, name: amenities.name }).from(amenities).where(and(eq(amenities.companyId, companyId), inArray(amenities.id, unique)));
  if (found.length !== unique.length) throw ApiError.badRequest("Unknown amenity id", { field: "amenity_ids" });
  const inactive = found.find((a) => !a.isActive);
  if (inactive) throw ApiError.rule(`Amenity ${inactive.name} is inactive`, "AMENITY_INACTIVE");
}

async function assertTeam(tx: Executor, companyId: string, members: readonly { user_id: string }[]): Promise<void> {
  const unique = [...new Set(members.map((m) => m.user_id))];
  if (unique.length !== members.length) throw ApiError.badRequest("Each team member once", { field: "team" });
  if (unique.length === 0) return;
  const found = await tx.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), inArray(users.id, unique)));
  if (found.length !== unique.length) throw ApiError.badRequest("Unknown user id in team", { field: "team" });
}

async function assertBankAccount(tx: Executor, companyId: string, id: string): Promise<void> {
  const [b] = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.id, id))).limit(1);
  if (!b) throw ApiError.badRequest("escrow_bank_account_id does not exist", { field: "escrow_bank_account_id" });
}

async function replaceAmenities(tx: Executor, projectId: string, ids: readonly string[]): Promise<void> {
  await tx.delete(projectAmenities).where(eq(projectAmenities.projectId, projectId));
  const unique = [...new Set(ids)];
  if (unique.length > 0) await tx.insert(projectAmenities).values(unique.map((amenityId) => ({ projectId, amenityId })));
}

async function replaceTeam(tx: Executor, projectId: string, members: readonly { user_id: string; role_label?: string | null }[]): Promise<void> {
  await tx.delete(projectTeam).where(eq(projectTeam.projectId, projectId));
  if (members.length > 0) await tx.insert(projectTeam).values(members.map((m) => ({ projectId, userId: m.user_id, roleLabel: m.role_label ?? null })));
}

/** Column values shared by create and update (snake wire → camel columns). */
function columnValues(b: Partial<ProjectCreate>): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (b.name !== undefined) v["name"] = b.name;
  if (b.code !== undefined) v["code"] = b.code;
  if (b.project_type !== undefined) v["projectType"] = b.project_type;
  if (b.status !== undefined) v["status"] = b.status;
  if (b.description !== undefined) v["description"] = b.description;
  if (b.address !== undefined) { v["address"] = b.address; v["city"] = b.address.city; }
  if (b.rera_number !== undefined) v["reraNumber"] = b.rera_number;
  if (b.launch_date !== undefined) v["launchDate"] = b.launch_date;
  if (b.possession_date !== undefined) v["possessionDate"] = b.possession_date;
  if (b.land_area_sqft !== undefined) v["landAreaSqft"] = b.land_area_sqft;
  if (b.latitude !== undefined) v["latitude"] = b.latitude;
  if (b.longitude !== undefined) v["longitude"] = b.longitude;
  if (b.landmarks !== undefined) v["landmarks"] = b.landmarks;
  if (b.approvals !== undefined) v["approvals"] = b.approvals.map((a) => ({ name: a.name, number: a.number ?? null, issued_on: a.issued_on ?? null, status: a.status }));
  if (b.escrow_bank_account_id !== undefined) v["escrowBankAccountId"] = b.escrow_bank_account_id;
  if (b.stage_sequence !== undefined) v["stageSequence"] = b.stage_sequence;
  return v;
}

const CSV = ["name", "code", "project_type", "status", "city", "rera_number", "launch_date", "possession_date", "block_count", "is_active", "version"];

/** Project routes: list/create/get/patch, stage sequence, deactivate/activate. */
export function registerProjectRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/projects", permission: "project.read",
    schema: { querystring: ProjectFilterSchema, response: { 200: ProjectListResponseSchema }, summary: "List projects (scoped)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      const where: (SQL | undefined)[] = [eq(projects.companyId, user.companyId), scopeFilter(user, projects.id)];
      if (!q.include_inactive) where.push(eq(projects.isActive, true));
      if (q.status) where.push(eq(projects.status, q.status));
      if (q.project_type) where.push(eq(projects.projectType, q.project_type));
      if (q.city) where.push(sql`lower(${projects.city}) = lower(${q.city})`);
      const result = await paginate<DbProject>(app.dbReplica, {
        table: projects,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [projects.name, projects.code, projects.city], term: q.search },
        sort: { allowed: { name: projects.name, code: projects.code, status: projects.status, city: projects.city, created_at: projects.createdAt, launch_date: projects.launchDate }, default: "name", requested: q.sort },
        ...listPaging(q),
      });
      const items = await toProjectRows(app.dbReplica, result.items);
      if (q.format === "csv") return sendCsv(reply, "projects.csv", CSV.map((k) => ({ key: k, header: k })), items as unknown as Record<string, unknown>[]);
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST", url: "/projects", permission: "project.write", idempotent: true,
    schema: { body: ProjectCreateSchema, response: { 201: ProjectRowSchema }, summary: "Create a project" },
    handler: async (req, reply) => {
      const user = req.user!;
      const body = req.body;
      const row = await app.db.transaction(async (tx) => {
        await assertAmenities(tx, user.companyId, body.amenity_ids);
        await assertTeam(tx, user.companyId, body.team);
        if (body.escrow_bank_account_id) await assertBankAccount(tx, user.companyId, body.escrow_bank_account_id);
        const stageSequence = body.stage_sequence ?? (await masterStageOrder(tx, user.companyId));
        await assertStageSequence(tx, user.companyId, stageSequence);
        let created: DbProject | undefined;
        try {
          [created] = await tx.insert(projects).values({ ...(columnValues(body) as object), companyId: user.companyId, stageSequence, createdBy: user.id } as typeof projects.$inferInsert).returning();
        } catch (e) { translatePgError(e, "A project with this code"); }
        if (!created) throw new Error("insert returned no row");
        await replaceAmenities(tx, created.id, body.amenity_ids);
        await replaceTeam(tx, created.id, body.team);
        const [view] = await toProjectRows(tx, [created]);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "project.create", entityType: "project", entityId: created.id, after: view as unknown as Record<string, unknown> });
        return view!;
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "GET", url: "/projects/:id", permission: "project.read",
    schema: { params: idParams, response: { 200: ProjectRowSchema }, summary: "Get a project" },
    handler: async (req) => getProjectRow(app.dbReplica, req.user!, req.params.id),
  });

  route(app, {
    method: "PATCH", url: "/projects/:id", permission: "project.write",
    schema: { params: idParams, body: withOptionalVersion(ProjectUpdateSchema), response: { 200: ProjectRowSchema }, summary: "Update a project (stage sequence only while every block stage is pending)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as ProjectUpdate & { version?: number };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const existing = await loadProject(tx, user, req.params.id, true);
        const [before] = await toProjectRows(tx, [existing]);
        if (body.amenity_ids) await assertAmenities(tx, user.companyId, body.amenity_ids);
        if (body.team) await assertTeam(tx, user.companyId, body.team);
        if (body.escrow_bank_account_id) await assertBankAccount(tx, user.companyId, body.escrow_bank_account_id);
        if (body.stage_sequence) {
          await assertStageSequence(tx, user.companyId, body.stage_sequence);
          const blockIds = (await tx.select({ id: blocks.id }).from(blocks).where(eq(blocks.projectId, existing.id))).map((b) => b.id);
          if (!(await allStagesPending(tx, blockIds))) throw ApiError.rule("Stage sequence can only change while every block stage is pending", "STAGES_STARTED");
        }
        if (body.launch_date !== undefined || body.possession_date !== undefined) {
          const launch = body.launch_date === undefined ? existing.launchDate : body.launch_date;
          const possession = body.possession_date === undefined ? existing.possessionDate : body.possession_date;
          if (launch && possession && launch > possession) throw ApiError.badRequest("Possession date must be after launch date", { field: "possession_date" });
        }
        const { version: _v, amenity_ids, team, ...rest } = body;
        let updated: DbProject;
        try { updated = await applyUpdate(tx, projects, existing.id, version, columnValues(rest), "project"); } catch (e) { translatePgError(e, "A project with this code"); }
        if (amenity_ids) await replaceAmenities(tx, existing.id, amenity_ids);
        if (team) await replaceTeam(tx, existing.id, team);
        const [after] = await toProjectRows(tx, [updated]);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "project.update", entityType: "project", entityId: existing.id, before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown> });
        return after!;
      });
    },
  });

  route(app, {
    method: "POST", url: "/projects/:id/stage-sequence", permission: "project.write",
    schema: { params: idParams, body: withOptionalVersion(ProjectStageSequenceUpdateSchema), response: { 200: ProjectRowSchema }, summary: "Replace the project's construction stage sequence (while every block stage is pending)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; stage_sequence: string[] };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const existing = await loadProject(tx, user, req.params.id, true);
        await assertStageSequence(tx, user.companyId, body.stage_sequence);
        const blockIds = (await tx.select({ id: blocks.id }).from(blocks).where(eq(blocks.projectId, existing.id))).map((b) => b.id);
        if (!(await allStagesPending(tx, blockIds))) throw ApiError.rule("Stage sequence can only change while every block stage is pending", "STAGES_STARTED");
        const updated = await applyUpdate(tx, projects, existing.id, version, { stageSequence: body.stage_sequence }, "project");
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "project.stage_sequence", entityType: "project", entityId: existing.id, before: { stage_sequence: existing.stageSequence }, after: { stage_sequence: updated.stageSequence } });
        const [row] = await toProjectRows(tx, [updated]);
        return row!;
      });
    },
  });

  for (const action of ["deactivate", "activate"] as const) {
    route(app, {
      method: "POST", url: `/projects/:id/${action}`, permission: "project.write",
      schema: { params: idParams, body: VersionedSchema.partial().optional(), response: { 200: ActiveStateResponseSchema }, summary: `${action === "deactivate" ? "Deactivate" : "Restore"} a project (deactivate only when it has no blocks)` },
      handler: async (req) => {
        const user = req.user!;
        return app.db.transaction(async (tx) => {
          const existing = await loadProject(tx, user, req.params.id, true);
          if (action === "deactivate") {
            const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(blocks).where(and(eq(blocks.projectId, existing.id), eq(blocks.isActive, true)));
            const n = Number(c?.n ?? 0);
            if (n > 0) throw ApiError.conflict("IN_USE", `This project has ${n} block(s) and cannot be deactivated`, { usage_count: n, used_by: [{ entity_type: "blocks", count: n }] });
          }
          const version = optionalExpectedVersion(req, req.body, existing.version);
          const updated = await applyUpdate(tx, projects, existing.id, version, action === "deactivate" ? { isActive: false, deactivatedAt: new Date() } : { isActive: true, deactivatedAt: null }, "project");
          await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: `project.${action}`, entityType: "project", entityId: existing.id, before: { is_active: existing.isActive }, after: { is_active: updated.isActive } });
          await refreshProjectCounts(tx, existing.id);
          return { id: updated.id, is_active: updated.isActive, version: updated.version };
        });
      },
    });
  }
}

/** Scoped-404 check for a project_id filter on list endpoints. */
export function assertFilterScope(user: StaffContext, projectId: string | undefined): void {
  if (projectId) ensureProjectAccess(user, projectId);
}
