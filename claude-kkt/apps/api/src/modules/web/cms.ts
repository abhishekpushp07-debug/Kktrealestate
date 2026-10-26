/**
 * CMS inside the ERP (SPEC §15): site settings singleton, banners, home sections, testimonials, gallery, posts, pages, people and the
 * media library upload. Permissions cms.read / cms.write; idempotent creates; versions; every write is audited and busts the public cache.
 */
import { and, desc, eq, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CmsBannerCreateSchema,
  CmsBannerRowSchema,
  CmsBannerUpdateSchema,
  CmsGalleryCreateSchema,
  CmsGalleryFilterSchema,
  CmsGalleryRowSchema,
  CmsGalleryUpdateSchema,
  CmsHomeSectionCreateSchema,
  CmsHomeSectionRowSchema,
  CmsHomeSectionUpdateSchema,
  CmsListFilterSchema,
  CmsPageCreateSchema,
  CmsPageRowSchema,
  CmsPageUpdateSchema,
  CmsPersonCreateSchema,
  CmsPersonRowSchema,
  CmsPersonUpdateSchema,
  CmsPostCreateSchema,
  CmsPostFilterSchema,
  CmsPostRowSchema,
  CmsPostUpdateSchema,
  CmsTestimonialCreateSchema,
  CmsTestimonialRowSchema,
  CmsTestimonialUpdateSchema,
  DocumentListResponseSchema,
  DocumentUploadResponseSchema,
  IdSchema,
  ListQuerySchema,
  SiteSettingsRowSchema,
  SiteSettingsUpdateSchema,
  listEnvelope,
  type ListQuery,
  type SiteSettingsRow,
} from "@kkt/contracts";
import {
  cmsBanners,
  cmsGallery,
  cmsHomeSections,
  cmsPages,
  cmsPeople,
  cmsPosts,
  cmsTestimonials,
  companies,
  customers,
  documents,
  projects,
  siteSettings,
  users,
  type Executor,
} from "@kkt/db";
import { actorFromRequest, auditMeta, writeAudit } from "../../lib/audit.js";
import { invalidateCompany } from "../../lib/company.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { camelRow, snakeRow } from "../../lib/rows.js";
import { applyUpdate, expectedVersion, withOptionalVersion } from "../../lib/version.js";
import {
  DOCUMENT_SELECT,
  loadJoined,
  storeBuffer,
  toDocumentRow,
  withDocumentJoins,
  type DocumentJoined,
} from "../documents/index.js";
import {
  assertDocuments,
  assertProjects,
  bustPublicCache,
  documentUrls,
  loadDocuments,
  updateByKey,
  type DocumentRecord,
} from "./shared.js";

const idParams = z.object({ id: IdSchema });

// ---------------------------------------------------------------------------
// Site settings (singleton per company)
// ---------------------------------------------------------------------------

export type SiteSettingsRecord = typeof siteSettings.$inferSelect;

/** Loads the site settings row, creating the default one (brand = company name) when the company has none yet. */
export async function ensureSiteSettings(tx: Executor, companyId: string): Promise<SiteSettingsRecord> {
  const [existing] = await tx.select().from(siteSettings).where(eq(siteSettings.companyId, companyId)).limit(1);
  if (existing) return existing;
  const [c] = await tx
    .select({ name: companies.name, phone: companies.phone, email: companies.email, letterhead: companies.letterhead })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!c) throw ApiError.notFound("Company");
  const [created] = await tx
    .insert(siteSettings)
    .values({
      companyId,
      brand: { name: c.name, tagline: c.letterhead?.tagline ?? null },
      contacts: { phone: c.phone ?? null, email: c.email ?? null },
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx.select().from(siteSettings).where(eq(siteSettings.companyId, companyId)).limit(1);
  if (!again) throw new Error("site_settings insert produced no row");
  return again;
}

/** Loads the site settings row without creating it (public reads); null when none exists yet. */
export async function loadSiteSettings(db: Executor, companyId: string): Promise<SiteSettingsRecord | null> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.companyId, companyId)).limit(1);
  return row ?? null;
}

function siteRow(s: SiteSettingsRecord, roundRobin: boolean): SiteSettingsRow {
  return {
    brand: {
      name: s.brand.name,
      tagline: s.brand.tagline ?? null,
      logo_document_id: s.brand.logo_document_id ?? null,
      favicon_document_id: s.brand.favicon_document_id ?? null,
    },
    contacts: {
      phone: s.contacts.phone ?? null,
      whatsapp: s.contacts.whatsapp ?? null,
      email: s.contacts.email ?? null,
    },
    offices: s.offices as SiteSettingsRow["offices"],
    social: s.social as SiteSettingsRow["social"],
    trust_stats: s.trustStats,
    value_props: s.valueProps as SiteSettingsRow["value_props"],
    disclaimer: s.disclaimer ?? null,
    seo_defaults: {
      title: s.seoDefaults.title ?? null,
      description: s.seoDefaults.description ?? null,
      og_image_document_id: s.seoDefaults.og_image_document_id ?? null,
      noindex: Boolean((s.seoDefaults as { noindex?: boolean }).noindex),
    },
    analytics: { ga_id: s.analytics.ga_id ?? null },
    site_live: s.siteLive,
    coming_soon_message: s.comingSoonMessage ?? null,
    portal_url: s.portalUrl ?? null,
    erp_url: s.erpUrl ?? null,
    featured_project_ids: s.featuredProjectIds,
    walkthrough_video_url: s.walkthroughVideoUrl ?? null,
    company_id: s.companyId,
    round_robin_enabled: roundRobin,
    updated_at: s.updatedAt.toISOString(),
    version: s.version,
  };
}

async function roundRobinEnabled(db: Executor, companyId: string): Promise<boolean> {
  const [c] = await db
    .select({ settings: companies.settings })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return Boolean(c?.settings.round_robin_enabled);
}

function registerSiteSettings(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/cms/site",
    permission: "cms.read",
    schema: {
      response: { 200: SiteSettingsRowSchema },
      summary: "Site settings (brand, contacts, SEO, site live switch…)",
    },
    handler: async (req) => {
      const companyId = req.user!.companyId;
      const row = await app.db.transaction((tx) => ensureSiteSettings(tx, companyId));
      return siteRow(row, await roundRobinEnabled(app.db, companyId));
    },
  });

  route(app, {
    method: "PATCH",
    url: "/cms/site",
    permission: "cms.write",
    schema: {
      body: withOptionalVersion(SiteSettingsUpdateSchema),
      response: { 200: SiteSettingsRowSchema },
      summary: "Update site settings (round_robin_enabled is mirrored to company settings)",
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as z.infer<typeof SiteSettingsUpdateSchema> & { version?: number };
      const version = expectedVersion(req, body);
      const { version: _v, round_robin_enabled, ...patch } = body;
      const result = await app.db.transaction(async (tx) => {
        const existing = await ensureSiteSettings(tx, user.companyId);
        const beforeRr = await roundRobinEnabled(tx, user.companyId);
        await assertDocuments(
          tx,
          user.companyId,
          [patch.brand?.logo_document_id, patch.brand?.favicon_document_id, patch.seo_defaults?.og_image_document_id],
          "image",
          "brand",
        );
        await assertProjects(tx, user.companyId, patch.featured_project_ids ?? [], "featured_project_ids");
        const changes = camelRow(patch as Record<string, unknown>);
        for (const k of Object.keys(changes)) if (changes[k] === undefined) delete changes[k];
        if (changes["seoDefaults"] === null) changes["seoDefaults"] = {};
        if (changes["offices"] === undefined && patch.offices !== undefined) changes["offices"] = patch.offices;
        const updated = await updateByKey(
          tx,
          siteSettings,
          siteSettings.companyId,
          user.companyId,
          version,
          changes,
          "site_settings",
        );
        let rr = beforeRr;
        if (round_robin_enabled !== undefined && round_robin_enabled !== beforeRr) {
          await tx
            .update(companies)
            .set({
              settings: sql`${companies.settings} || jsonb_build_object('round_robin_enabled', ${round_robin_enabled}::boolean)`,
            })
            .where(eq(companies.id, user.companyId));
          rr = round_robin_enabled;
        }
        const before = siteRow(existing, beforeRr);
        const after = siteRow(updated, rr);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorFromRequest(req),
          action: "site_settings.update",
          entityType: "site_settings",
          entityId: user.companyId,
          before,
          after,
          ...auditMeta(req),
        });
        return after;
      });
      await invalidateCompany(app.redis, user.companyId);
      await bustPublicCache(app);
      return result;
    },
  });
}

// ---------------------------------------------------------------------------
// Generic CMS kinds
// ---------------------------------------------------------------------------

type CmsTable = PgTable & { id: AnyPgColumn; companyId: AnyPgColumn; version: AnyPgColumn };
type Row = Record<string, unknown>;

interface CmsKindDef {
  path: string;
  entity: string;
  table: CmsTable;
  createSchema: z.ZodType;
  updateSchema: z.ZodObject;
  rowSchema: z.ZodType;
  filterSchema: z.ZodObject;
  searchColumns: readonly AnyPgColumn[];
  sortable: Record<string, AnyPgColumn>;
  defaultSort: string;
  csvColumns: readonly string[];
  /** Validates references and returns the camelCase column values for the insert/update. */
  prepare: (tx: Executor, input: Row, companyId: string, req: FastifyRequest, existing: Row | null) => Promise<Row>;
  /** Hydrates wire rows in one batch (documents, project names…). */
  toRows: (db: Executor, rows: Row[], companyId: string) => Promise<Row[]>;
  /** Business key that must be unique per company (slug/key) → 409 DUPLICATE. */
  uniqueKey?: { field: string; column: AnyPgColumn };
  extraWhere?: (q: Row) => SQL | undefined;
}

async function loadRow(db: Executor, def: CmsKindDef, companyId: string, id: string, forUpdate = false): Promise<Row> {
  const q = db
    .select()
    .from(def.table)
    .where(and(eq(def.table.id, id), eq(def.table.companyId, companyId)))
    .limit(1)
    .$dynamic();
  const rows = (await (forUpdate ? q.for("update") : q)) as Row[];
  const row = rows[0];
  if (!row) throw ApiError.notFound(def.entity.replace(/_/g, " "));
  return row;
}

async function assertUnique(
  tx: Executor,
  def: CmsKindDef,
  companyId: string,
  values: Row,
  excludeId: string | null,
): Promise<void> {
  if (!def.uniqueKey) return;
  const camel = def.uniqueKey.field.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  const value = values[camel];
  if (typeof value !== "string") return;
  const rows = await tx
    .select({ id: def.table.id })
    .from(def.table)
    .where(
      and(
        eq(def.table.companyId, companyId),
        eq(def.uniqueKey.column, value),
        excludeId ? sql`${def.table.id} <> ${excludeId}` : undefined,
      ),
    )
    .limit(1);
  if (rows.length > 0)
    throw ApiError.conflict(
      "DUPLICATE",
      `A ${def.entity.replace(/_/g, " ")} with this ${def.uniqueKey.field} already exists`,
      { field: def.uniqueKey.field, value },
    );
}

function registerCmsKind(app: FastifyInstance, def: CmsKindDef): void {
  const base = `/cms/${def.path}`;
  const label = def.entity.replace(/_/g, " ");
  const viewOne = async (db: Executor, row: Row, companyId: string): Promise<Row> =>
    (await def.toRows(db, [row], companyId))[0]!;

  route(app, {
    method: "GET",
    url: base,
    permission: "cms.read",
    schema: {
      querystring: def.filterSchema,
      response: { 200: listEnvelope(def.rowSchema) },
      summary: `List ${def.path.replace(/-/g, " ")}`,
      tags: ["cms"],
    },
    handler: async (req, reply) => {
      const q = req.query as ListQuery & Row;
      const companyId = req.user!.companyId;
      const where: (SQL | undefined)[] = [eq(def.table.companyId, companyId)];
      if (def.extraWhere) where.push(def.extraWhere(q));
      const result = await paginate<Row>(app.dbReplica, {
        table: def.table,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: def.searchColumns, term: q.search },
        sort: { allowed: def.sortable, default: def.defaultSort, requested: q.sort },
        ...listPaging(q),
      });
      const items = await def.toRows(app.dbReplica, result.items, companyId);
      if (q.format === "csv")
        return sendCsv(
          reply,
          `${def.path}.csv`,
          def.csvColumns.map((k) => ({ key: k, header: k })),
          items,
        );
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST",
    url: base,
    permission: "cms.write",
    idempotent: true,
    schema: { body: def.createSchema, response: { 201: def.rowSchema }, summary: `Create ${label}`, tags: ["cms"] },
    handler: async (req, reply) => {
      const user = req.user!;
      const view = await app.db.transaction(async (tx) => {
        const values = await def.prepare(tx, req.body as Row, user.companyId, req, null);
        await assertUnique(tx, def, user.companyId, values, null);
        let created: Row | undefined;
        try {
          created = (
            (await tx
              .insert(def.table)
              .values({ ...values, companyId: user.companyId, createdBy: user.id } as never)
              .returning()) as Row[]
          )[0];
        } catch (e) {
          translatePgError(e, `A ${label} with this key`);
        }
        if (!created) throw new Error("insert returned no row");
        const v = await viewOne(tx, created, user.companyId);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorFromRequest(req),
          action: `${def.entity}.create`,
          entityType: def.entity,
          entityId: String(created["id"]),
          after: v,
          ...auditMeta(req),
        });
        return v;
      });
      await bustPublicCache(app);
      return reply.code(201).send(view);
    },
  });

  route(app, {
    method: "GET",
    url: `${base}/:id`,
    permission: "cms.read",
    schema: { params: idParams, response: { 200: def.rowSchema }, summary: `Get ${label}`, tags: ["cms"] },
    handler: async (req) =>
      viewOne(
        app.dbReplica,
        await loadRow(app.dbReplica, def, req.user!.companyId, req.params.id),
        req.user!.companyId,
      ),
  });

  route(app, {
    method: "PATCH",
    url: `${base}/:id`,
    permission: "cms.write",
    schema: {
      params: idParams,
      body: withOptionalVersion(def.updateSchema),
      response: { 200: def.rowSchema },
      summary: `Update ${label}`,
      tags: ["cms"],
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as Row & { version?: number };
      const version = expectedVersion(req, body);
      const view = await app.db.transaction(async (tx) => {
        const existing = await loadRow(tx, def, user.companyId, req.params.id, true);
        const before = await viewOne(tx, existing, user.companyId);
        const { version: _v, ...patch } = body;
        const values = await def.prepare(tx, patch, user.companyId, req, existing);
        await assertUnique(tx, def, user.companyId, values, req.params.id);
        let updated: Row;
        try {
          updated = (await applyUpdate(tx, def.table, req.params.id, version, values, def.entity)) as Row;
        } catch (e) {
          translatePgError(e, `A ${label} with this key`);
        }
        const after = await viewOne(tx, updated, user.companyId);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorFromRequest(req),
          action: `${def.entity}.update`,
          entityType: def.entity,
          entityId: req.params.id,
          before,
          after,
          ...auditMeta(req),
        });
        return after;
      });
      await bustPublicCache(app);
      return view;
    },
  });

  route(app, {
    method: "DELETE",
    url: `${base}/:id`,
    permission: "cms.write",
    schema: { params: idParams, response: { 204: z.null() }, summary: `Delete ${label}`, tags: ["cms"] },
    handler: async (req, reply) => {
      const user = req.user!;
      await app.db.transaction(async (tx) => {
        const existing = await loadRow(tx, def, user.companyId, req.params.id, true);
        const before = await viewOne(tx, existing, user.companyId);
        await tx.delete(def.table).where(eq(def.table.id, req.params.id));
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorFromRequest(req),
          action: `${def.entity}.delete`,
          entityType: def.entity,
          entityId: req.params.id,
          before,
          ...auditMeta(req),
        });
      });
      await bustPublicCache(app);
      return reply.code(204).send();
    },
  });
}

// ---------------------------------------------------------------------------
// Kind definitions
// ---------------------------------------------------------------------------

/** Removes undefined values so PATCH only touches the keys that were sent. */
function compact(values: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) out[k] = v;
  return out;
}

async function projectNames(db: Executor, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string"))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function assertCustomer(db: Executor, companyId: string, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const [c] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.companyId, companyId)))
    .limit(1);
  if (!c) throw ApiError.badRequest(`customer_id: customer ${id} not found`, { field: "customer_id" });
}

/** Website routes a CMS page slug may not shadow (the sitemap and the Next.js router already own them). */
export const RESERVED_PAGE_SLUGS = new Set([
  "projects",
  "blog",
  "gallery",
  "contact",
  "visit",
  "api",
  "sitemap",
  "robots",
  "admin",
  "portal",
  "public",
]);

const publishedWhere =
  (col: AnyPgColumn) =>
  (q: Row): SQL | undefined =>
    typeof q["is_published"] === "boolean" ? eq(col, q["is_published"]) : undefined;

const imageOf = (docs: Map<string, DocumentRecord>, id: string | null | undefined) =>
  documentUrls(id ? docs.get(id) : undefined);

const KINDS: CmsKindDef[] = [
  {
    path: "banners",
    entity: "cms_banner",
    table: cmsBanners,
    createSchema: CmsBannerCreateSchema,
    updateSchema: CmsBannerUpdateSchema,
    rowSchema: CmsBannerRowSchema,
    filterSchema: CmsListFilterSchema,
    searchColumns: [cmsBanners.title, cmsBanners.subtitle],
    sortable: {
      sort_order: cmsBanners.sortOrder,
      title: cmsBanners.title,
      created_at: cmsBanners.createdAt,
      starts_at: cmsBanners.startsAt,
    },
    defaultSort: "sort_order",
    csvColumns: [
      "id",
      "title",
      "subtitle",
      "cta_label",
      "cta_url",
      "image_url",
      "sort_order",
      "starts_at",
      "ends_at",
      "is_active",
      "version",
    ],
    extraWhere: (q) => (q["include_inactive"] ? undefined : eq(cmsBanners.isActive, true)),
    prepare: async (tx, input, companyId) => {
      await assertDocuments(tx, companyId, [input["document_id"] as string | undefined], "image", "document_id");
      const v = compact(camelRow(input));
      if (typeof v["startsAt"] === "string") v["startsAt"] = new Date(v["startsAt"]);
      if (typeof v["endsAt"] === "string") v["endsAt"] = new Date(v["endsAt"]);
      if (v["isActive"] === false) v["deactivatedAt"] = new Date();
      if (v["isActive"] === true) v["deactivatedAt"] = null;
      return v;
    },
    toRows: async (db, rows) => {
      const docs = await loadDocuments(
        db,
        rows.map((r) => r["documentId"] as string),
      );
      return rows.map((r) => ({ ...snakeRow(r), image_url: imageOf(docs, r["documentId"] as string).url }));
    },
  },
  {
    path: "home-sections",
    entity: "cms_home_section",
    table: cmsHomeSections,
    createSchema: CmsHomeSectionCreateSchema,
    updateSchema: CmsHomeSectionUpdateSchema,
    rowSchema: CmsHomeSectionRowSchema,
    filterSchema: CmsListFilterSchema,
    searchColumns: [cmsHomeSections.key, cmsHomeSections.title],
    sortable: {
      sort_order: cmsHomeSections.sortOrder,
      key: cmsHomeSections.key,
      created_at: cmsHomeSections.createdAt,
    },
    defaultSort: "sort_order",
    csvColumns: ["id", "key", "title", "sort_order", "is_active", "version"],
    uniqueKey: { field: "key", column: cmsHomeSections.key },
    extraWhere: (q) => (q["include_inactive"] ? undefined : eq(cmsHomeSections.isActive, true)),
    prepare: async (_tx, input) => {
      const v = compact(camelRow(input));
      if (v["isActive"] === false) v["deactivatedAt"] = new Date();
      if (v["isActive"] === true) v["deactivatedAt"] = null;
      return v;
    },
    toRows: async (_db, rows) => rows.map((r) => snakeRow(r)),
  },
  {
    path: "testimonials",
    entity: "cms_testimonial",
    table: cmsTestimonials,
    createSchema: CmsTestimonialCreateSchema,
    updateSchema: CmsTestimonialUpdateSchema,
    rowSchema: CmsTestimonialRowSchema,
    filterSchema: CmsListFilterSchema,
    searchColumns: [cmsTestimonials.name, cmsTestimonials.quote],
    sortable: {
      sort_order: cmsTestimonials.sortOrder,
      name: cmsTestimonials.name,
      created_at: cmsTestimonials.createdAt,
      rating: cmsTestimonials.rating,
    },
    defaultSort: "sort_order",
    csvColumns: ["id", "name", "project_name", "quote", "rating", "is_published", "sort_order", "version"],
    extraWhere: publishedWhere(cmsTestimonials.isPublished),
    prepare: async (tx, input, companyId) => {
      await assertDocuments(
        tx,
        companyId,
        [input["photo_document_id"] as string | undefined],
        "image",
        "photo_document_id",
      );
      await assertProjects(tx, companyId, [input["project_id"] as string | undefined], "project_id");
      await assertCustomer(tx, companyId, input["customer_id"] as string | undefined);
      return compact(camelRow(input));
    },
    toRows: async (db, rows) => {
      const [docs, names] = await Promise.all([
        loadDocuments(
          db,
          rows.map((r) => r["photoDocumentId"] as string | null),
        ),
        projectNames(
          db,
          rows.map((r) => r["projectId"] as string | null),
        ),
      ]);
      return rows.map((r) => ({
        ...snakeRow(r),
        project_name: r["projectId"] ? (names.get(r["projectId"] as string) ?? null) : null,
        photo_url: imageOf(docs, r["photoDocumentId"] as string | null).thumb_url,
      }));
    },
  },
  {
    path: "gallery",
    entity: "cms_gallery",
    table: cmsGallery,
    createSchema: CmsGalleryCreateSchema,
    updateSchema: CmsGalleryUpdateSchema,
    rowSchema: CmsGalleryRowSchema,
    filterSchema: CmsGalleryFilterSchema,
    searchColumns: [cmsGallery.caption, cmsGallery.category],
    sortable: { sort_order: cmsGallery.sortOrder, created_at: cmsGallery.createdAt, category: cmsGallery.category },
    defaultSort: "sort_order",
    csvColumns: [
      "id",
      "project_name",
      "caption",
      "category",
      "thumb_url",
      "medium_url",
      "is_published",
      "sort_order",
      "version",
    ],
    extraWhere: (q) =>
      and(
        publishedWhere(cmsGallery.isPublished)(q),
        typeof q["project_id"] === "string" ? eq(cmsGallery.projectId, q["project_id"]) : undefined,
        typeof q["category"] === "string" ? eq(cmsGallery.category, q["category"]) : undefined,
      ),
    prepare: async (tx, input, companyId) => {
      await assertDocuments(tx, companyId, [input["document_id"] as string | undefined], "image", "document_id");
      await assertProjects(tx, companyId, [input["project_id"] as string | undefined], "project_id");
      return compact(camelRow(input));
    },
    toRows: async (db, rows) => {
      const [docs, names] = await Promise.all([
        loadDocuments(
          db,
          rows.map((r) => r["documentId"] as string),
        ),
        projectNames(
          db,
          rows.map((r) => r["projectId"] as string | null),
        ),
      ]);
      return rows.map((r) => {
        const u = imageOf(docs, r["documentId"] as string);
        return {
          ...snakeRow(r),
          project_name: r["projectId"] ? (names.get(r["projectId"] as string) ?? null) : null,
          thumb_url: u.thumb_url,
          medium_url: u.medium_url,
          width: u.width,
          height: u.height,
        };
      });
    },
  },
  {
    path: "posts",
    entity: "cms_post",
    table: cmsPosts,
    createSchema: CmsPostCreateSchema,
    updateSchema: CmsPostUpdateSchema,
    rowSchema: CmsPostRowSchema,
    filterSchema: CmsPostFilterSchema,
    searchColumns: [cmsPosts.title, cmsPosts.excerpt, cmsPosts.slug],
    sortable: {
      published_at: cmsPosts.publishedAt,
      created_at: cmsPosts.createdAt,
      title: cmsPosts.title,
      status: cmsPosts.status,
    },
    defaultSort: "-created_at",
    csvColumns: ["id", "title", "slug", "status", "published_at", "author_name", "tags", "version"],
    uniqueKey: { field: "slug", column: cmsPosts.slug },
    extraWhere: (q) =>
      and(
        typeof q["status"] === "string" ? eq(cmsPosts.status, q["status"] as "DRAFT" | "PUBLISHED") : undefined,
        typeof q["tag"] === "string" ? sql`${q["tag"]} = any(${cmsPosts.tags})` : undefined,
      ),
    prepare: async (tx, input, companyId, req, existing) => {
      await assertDocuments(
        tx,
        companyId,
        [
          input["cover_document_id"] as string | undefined,
          (input["seo"] as { og_image_document_id?: string } | null | undefined)?.og_image_document_id,
        ],
        "image",
        "cover_document_id",
      );
      const v = compact(camelRow(input));
      if (typeof v["publishedAt"] === "string") v["publishedAt"] = new Date(v["publishedAt"]);
      if (v["seo"] === null) v["seo"] = {};
      const status = (v["status"] ?? existing?.["status"]) as string | undefined;
      const publishedAt = v["publishedAt"] !== undefined ? v["publishedAt"] : existing?.["publishedAt"];
      if (status === "PUBLISHED" && !publishedAt) v["publishedAt"] = new Date();
      if (!existing) v["authorUserId"] = req.user?.id ?? null;
      return v;
    },
    toRows: async (db, rows) => {
      const authorIds = [
        ...new Set(rows.map((r) => r["authorUserId"] as string | null).filter((x): x is string => Boolean(x))),
      ];
      const [docs, authors] = await Promise.all([
        loadDocuments(
          db,
          rows.map((r) => r["coverDocumentId"] as string | null),
        ),
        authorIds.length
          ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds))
          : Promise.resolve([] as { id: string; name: string }[]),
      ]);
      const names = new Map(authors.map((a) => [a.id, a.name]));
      return rows.map((r) => ({
        ...snakeRow(r),
        seo: seoWire(r["seo"]),
        cover_url: imageOf(docs, r["coverDocumentId"] as string | null).url,
        author_name: r["authorUserId"] ? (names.get(r["authorUserId"] as string) ?? null) : null,
      }));
    },
  },
  {
    path: "pages",
    entity: "cms_page",
    table: cmsPages,
    createSchema: CmsPageCreateSchema,
    updateSchema: CmsPageUpdateSchema,
    rowSchema: CmsPageRowSchema,
    filterSchema: CmsListFilterSchema,
    searchColumns: [cmsPages.title, cmsPages.slug],
    sortable: { title: cmsPages.title, slug: cmsPages.slug, created_at: cmsPages.createdAt },
    defaultSort: "title",
    csvColumns: ["id", "slug", "title", "is_published", "version"],
    uniqueKey: { field: "slug", column: cmsPages.slug },
    extraWhere: publishedWhere(cmsPages.isPublished),
    prepare: async (tx, input, companyId) => {
      if (typeof input["slug"] === "string" && RESERVED_PAGE_SLUGS.has(input["slug"]))
        throw ApiError.badRequest(`slug: "${input["slug"]}" is reserved by the website`, {
          issues: [{ path: "slug", message: "Reserved slug" }],
        });
      await assertDocuments(
        tx,
        companyId,
        [(input["seo"] as { og_image_document_id?: string } | null | undefined)?.og_image_document_id],
        "image",
        "seo.og_image_document_id",
      );
      const v = compact(camelRow(input));
      if (v["seo"] === null) v["seo"] = {};
      return v;
    },
    toRows: async (_db, rows) => rows.map((r) => ({ ...snakeRow(r), seo: seoWire(r["seo"]) })),
  },
  {
    path: "people",
    entity: "cms_person",
    table: cmsPeople,
    createSchema: CmsPersonCreateSchema,
    updateSchema: CmsPersonUpdateSchema,
    rowSchema: CmsPersonRowSchema,
    filterSchema: CmsListFilterSchema,
    searchColumns: [cmsPeople.name, cmsPeople.title],
    sortable: { sort_order: cmsPeople.sortOrder, name: cmsPeople.name, created_at: cmsPeople.createdAt },
    defaultSort: "sort_order",
    csvColumns: ["id", "name", "title", "is_published", "sort_order", "version"],
    extraWhere: publishedWhere(cmsPeople.isPublished),
    prepare: async (tx, input, companyId) => {
      await assertDocuments(
        tx,
        companyId,
        [input["photo_document_id"] as string | undefined],
        "image",
        "photo_document_id",
      );
      return compact(camelRow(input));
    },
    toRows: async (db, rows) => {
      const docs = await loadDocuments(
        db,
        rows.map((r) => r["photoDocumentId"] as string | null),
      );
      return rows.map((r) => ({
        ...snakeRow(r),
        title: (r["title"] as string | null) ?? "",
        photo_url: imageOf(docs, r["photoDocumentId"] as string | null).thumb_url,
      }));
    },
  },
];

/** Stored SEO json → contract shape (noindex defaults to false). */
export function seoWire(seo: unknown): {
  title: string | null;
  description: string | null;
  og_image_document_id: string | null;
  noindex: boolean;
} {
  const s = (seo ?? {}) as {
    title?: string | null;
    description?: string | null;
    og_image_document_id?: string | null;
    noindex?: boolean;
  };
  return {
    title: s.title ?? null,
    description: s.description ?? null,
    og_image_document_id: s.og_image_document_id ?? null,
    noindex: Boolean(s.noindex),
  };
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

async function readUpload(
  req: FastifyRequest,
): Promise<{ buffer: Buffer; filename: string; fields: Record<string, string> }> {
  if (!req.isMultipart()) throw ApiError.badRequest("Expected a multipart/form-data upload with a `file` part");
  const fields: Record<string, string> = {};
  let file: { buffer: Buffer; filename: string } | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        if (file) throw ApiError.badRequest("Upload exactly one file per request");
        file = { buffer, filename: part.filename || "file" };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw new ApiError(413, "PAYLOAD_TOO_LARGE", "File exceeds the 15 MB limit");
    if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT")
      throw ApiError.badRequest("Too many parts in the upload");
    throw err;
  }
  if (!file) throw ApiError.badRequest("Missing `file` part");
  return { ...file, fields };
}

function registerMedia(app: FastifyInstance): void {
  route(app, {
    method: "POST",
    url: "/cms/media",
    permission: "cms.write",
    idempotent: true,
    schema: {
      response: { 201: DocumentUploadResponseSchema },
      summary: "Upload website media (multipart `file`, optional `title`) into the CMS library",
      tags: ["cms"],
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const upload = await readUpload(req);
      const view = await app.db.transaction(async (tx) => {
        const row = await storeBuffer(tx, {
          companyId: user.companyId,
          entityType: "CMS",
          entityId: user.companyId,
          buffer: upload.buffer,
          filename: upload.filename,
          title: upload.fields["title"] ?? null,
          uploadedBy: user.id,
          uploadedByType: "STAFF",
        });
        const doc = toDocumentRow((await loadJoined(tx, user.companyId, row.id))!);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorFromRequest(req),
          action: "cms_media.upload",
          entityType: "document",
          entityId: row.id,
          after: { id: doc.id, title: doc.title, file_name: doc.file_name, mime: doc.mime, size_bytes: doc.size_bytes },
          ...auditMeta(req),
        });
        return doc;
      });
      return reply.code(201).send({ document: view });
    },
  });

  route(app, {
    method: "GET",
    url: "/cms/media",
    permission: "cms.read",
    schema: {
      querystring: ListQuerySchema,
      response: { 200: DocumentListResponseSchema },
      summary: "Website media library",
      tags: ["cms"],
    },
    handler: async (req) => {
      const q = req.query;
      const companyId = req.user!.companyId;
      const result = await paginate<DocumentJoined>(app.dbReplica, {
        table: documents,
        select: DOCUMENT_SELECT,
        join: withDocumentJoins,
        where: and(eq(documents.companyId, companyId), eq(documents.entityType, "CMS"), eq(documents.isDeleted, false)),
        search: { columns: [documents.title, documents.fileName], term: q.search },
        sort: {
          allowed: {
            created_at: documents.createdAt,
            title: documents.title,
            file_name: documents.fileName,
            size_bytes: documents.sizeBytes,
          },
          default: "-created_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      return { ...result, items: result.items.map(toDocumentRow) };
    },
  });
}

/** Registers every CMS route. */
export function registerCmsRoutes(app: FastifyInstance): void {
  registerSiteSettings(app);
  for (const def of KINDS) registerCmsKind(app, def);
  registerMedia(app);
}

/** Published posts condition (status PUBLISHED and published_at in the past). */
export function publishedPostCondition(now = new Date()): SQL {
  return and(
    eq(cmsPosts.status, "PUBLISHED"),
    or(lte(cmsPosts.publishedAt, now), sql`${cmsPosts.publishedAt} is null`),
  )!;
}

/** Latest published posts (public home). */
export async function latestPosts(db: Executor, companyId: string, limit: number) {
  return db
    .select()
    .from(cmsPosts)
    .where(and(eq(cmsPosts.companyId, companyId), publishedPostCondition()))
    .orderBy(desc(cmsPosts.publishedAt), desc(cmsPosts.id))
    .limit(limit);
}
