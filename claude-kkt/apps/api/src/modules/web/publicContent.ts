/**
 * Public website read API (docs/API-CONVENTIONS.md Appendix B): site, projects, posts, pages, gallery, people, media, sitemap, robots.
 * Unauthenticated, read-only, cached 60 s in Redis (path + query), allow-listed serialisers: never ids of users/customers, costs or storage keys.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  PublicGalleryResponseSchema, PublicListQuerySchema, PublicMediaQuerySchema, PublicPageSchema, PublicPersonSchema, PublicPostCardSchema, PublicPostDetailSchema, PublicProjectCardSchema,
  PublicProjectDetailSchema, PublicProjectsQuerySchema, PublicSiteResponseSchema, PublicSitemapResponseSchema, SlugSchema, listEnvelope, toPublicAvailability,
  type PublicAvailabilityGrid, type PublicConfiguration, type PublicGalleryItem, type PublicPostCard, type PublicProgressBlock, type PublicProjectCard, type PublicProjectDetail, type PublicSiteResponse,
  type PublicStageProgress,
} from "@kkt/contracts";
import {
  amenities, blockStages, blockTypes, blocks, cmsBanners, cmsGallery, cmsHomeSections, cmsPages, cmsPeople, cmsPosts, cmsTestimonials, documentTypes, documents, flatTypes, flats, projectAmenities,
  projectVisitSettings, projectWebsiteSettings, projects, specCategories, specItems, stagePhotos, users, type Executor,
} from "@kkt/db";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { streamDocument } from "../documents/service.js";
import { latestPosts, loadSiteSettings, publishedPostCondition, type SiteSettingsRecord } from "./cms.js";
import { IMMUTABLE_CACHE_CONTROL, documentUrls, isPublicDocument, loadDocuments, publicCached, publicCompanyId, publicHeaders, webOrigin, type DocumentRecord } from "./shared.js";
import { loadVisitSettings } from "./visitService.js";

type DbProject = typeof projects.$inferSelect;
type DbWebsite = typeof projectWebsiteSettings.$inferSelect;

/** A published project with its website settings. */
export interface PublishedProject { p: DbProject; w: DbWebsite }

/** Published, active projects of the company (optionally one slug), ordered by name. */
export async function publishedProjects(db: Executor, companyId: string, slug?: string): Promise<PublishedProject[]> {
  const rows = await db
    .select({ p: projects, w: projectWebsiteSettings })
    .from(projectWebsiteSettings)
    .innerJoin(projects, eq(projects.id, projectWebsiteSettings.projectId))
    .where(and(eq(projects.companyId, companyId), eq(projects.isActive, true), eq(projectWebsiteSettings.isPublished, true), slug ? eq(projectWebsiteSettings.slug, slug) : undefined))
    .orderBy(asc(projects.name));
  return rows;
}

/** Map project id → published slug (for gallery/testimonial cross references; unpublished projects are absent). */
async function publishedSlugs(db: Executor, companyId: string): Promise<Map<string, { slug: string; name: string }>> {
  const rows = await publishedProjects(db, companyId);
  return new Map(rows.map((r) => [r.p.id, { slug: r.w.slug ?? "", name: r.p.name }]));
}

// ---------------------------------------------------------------------------
// Project cards
// ---------------------------------------------------------------------------

interface FlatAgg { projectId: string; flatTypeId: string; minAvailablePrice: number | null; available: number; total: number }

async function flatAggregates(db: Executor, projectIds: string[]): Promise<FlatAgg[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({
      projectId: flats.projectId, flatTypeId: flats.flatTypeId,
      minAvailablePrice: sql<number | string | null>`min(${flats.pricePaise}) filter (where ${flats.status} = 'AVAILABLE')`,
      available: sql<number>`count(*) filter (where ${flats.status} = 'AVAILABLE')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(flats)
    .innerJoin(blocks, eq(blocks.id, flats.blockId))
    .where(and(inArray(flats.projectId, projectIds), eq(blocks.isActive, true)))
    .groupBy(flats.projectId, flats.flatTypeId);
  return rows.map((r) => ({ projectId: r.projectId, flatTypeId: r.flatTypeId, minAvailablePrice: r.minAvailablePrice === null ? null : Number(r.minAvailablePrice), available: Number(r.available), total: Number(r.total) }));
}

async function blockProgress(db: Executor, projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: blocks.projectId, percent: sql<number | string | null>`avg(${blocks.constructionPercent})` })
    .from(blocks)
    .where(and(inArray(blocks.projectId, projectIds), eq(blocks.isActive, true)))
    .groupBy(blocks.projectId);
  return new Map(rows.map((r) => [r.projectId, r.percent === null ? 0 : Math.round(Number(r.percent) * 100) / 100]));
}

/** Starting price shown on cards/detail: the override, else the cheapest AVAILABLE flat; null unless show_prices. */
function startingPrice(w: DbWebsite, aggs: FlatAgg[]): number | null {
  if (!w.showPrices) return null;
  if (w.startingPriceOverridePaise !== null && w.startingPriceOverridePaise !== undefined) return w.startingPriceOverridePaise;
  const prices = aggs.map((a) => a.minAvailablePrice).filter((p): p is number => p !== null && p > 0);
  return prices.length ? Math.min(...prices) : null;
}

/** Builds public project cards for published projects in a handful of batched queries (no N+1). */
export async function buildProjectCards(db: Executor, items: PublishedProject[], site: SiteSettingsRecord | null): Promise<PublicProjectCard[]> {
  const ids = items.map((i) => i.p.id);
  const [aggs, progress, docs] = await Promise.all([flatAggregates(db, ids), blockProgress(db, ids), loadDocuments(db, items.map((i) => i.w.heroDocumentIds[0]))]);
  const typeIds = [...new Set(aggs.map((a) => a.flatTypeId))];
  const types = typeIds.length ? await db.select({ id: flatTypes.id, name: flatTypes.name, bhk: flatTypes.bhk }).from(flatTypes).where(inArray(flatTypes.id, typeIds)) : [];
  const typeById = new Map(types.map((t) => [t.id, t]));
  const featured = new Set(site?.featuredProjectIds ?? []);
  return items.map(({ p, w }) => {
    const mine = aggs.filter((a) => a.projectId === p.id);
    const bhk = [...new Set(mine.map((a) => typeById.get(a.flatTypeId)?.bhk).filter((b): b is number => typeof b === "number"))].sort((a, b) => a - b);
    const configurations = [...new Set(mine.map((a) => typeById.get(a.flatTypeId)?.name).filter((n): n is string => Boolean(n)))].sort();
    const hero = documentUrls(docs.get(w.heroDocumentIds[0] ?? ""));
    const projectType = p.projectType;
    return {
      slug: w.slug ?? "", name: p.name, city: p.city ?? p.address?.city ?? "", locality: p.address?.locality ?? null, project_type: projectType, type: projectType, status: p.status,
      rera_number: p.reraNumber ?? null, possession_date: p.possessionDate ?? null, starting_price_paise: startingPrice(w, mine), hero_image_url: hero.url, highlights: w.highlights,
      bhk_options: bhk, configurations, construction_percent: progress.get(p.id) ?? null, is_featured: featured.has(p.id), tagline: w.highlights[0] ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Project detail
// ---------------------------------------------------------------------------

function imageItem(doc: DocumentRecord | undefined, caption: string | null): { url: string | null; thumb_url: string | null; medium_url: string | null; width: number | null; height: number | null; alt: string | null } {
  const u = documentUrls(doc);
  return { url: u.medium_url ?? u.url, thumb_url: u.thumb_url, medium_url: u.medium_url ?? u.url, width: u.width, height: u.height, alt: caption };
}

async function galleryFor(db: Executor, companyId: string, projectId: string | null, slugs: Map<string, { slug: string; name: string }>): Promise<PublicGalleryItem[]> {
  const rows = await db
    .select()
    .from(cmsGallery)
    .where(and(eq(cmsGallery.companyId, companyId), eq(cmsGallery.isPublished, true), projectId ? eq(cmsGallery.projectId, projectId) : undefined))
    .orderBy(asc(cmsGallery.sortOrder), asc(cmsGallery.createdAt));
  const docs = await loadDocuments(db, rows.map((r) => r.documentId));
  const out: PublicGalleryItem[] = [];
  for (const r of rows) {
    const doc = docs.get(r.documentId);
    if (!isPublicDocument(doc) || !doc.mime.startsWith("image/")) continue;
    if (r.projectId && !slugs.has(r.projectId)) continue; // unpublished project: invisible everywhere
    const img = imageItem(doc, r.caption);
    const ref = r.projectId ? slugs.get(r.projectId) : undefined;
    out.push({ url: img.medium_url ?? undefined, alt: r.caption, thumb_url: img.thumb_url ?? img.medium_url ?? "", medium_url: img.medium_url ?? "", width: img.width, height: img.height, caption: r.caption, category: r.category, project_slug: ref?.slug ?? null, project_name: ref?.name ?? null });
  }
  return out;
}

interface FlatLite { id: string; blockId: string; flatNumber: string; floor: number; floorLabel: string | null; position: number; flatTypeId: string; flatTypeCode: string; facing: string | null; status: "AVAILABLE" | "HOLD" | "BLOCKED" | "BOOKED" | "SOLD"; pricePaise: number }

async function configurationsFor(db: Executor, companyId: string, project: DbProject, w: DbWebsite, projectFlats: FlatLite[]): Promise<PublicConfiguration[]> {
  const typeIds = [...new Set(projectFlats.map((f) => f.flatTypeId))];
  if (typeIds.length === 0) return [];
  const types = await db.select().from(flatTypes).where(inArray(flatTypes.id, typeIds)).orderBy(asc(flatTypes.bhk), asc(flatTypes.name));
  const specIds = [...new Set(types.flatMap((t) => t.specItemIds))];
  const [specs, floorPlans] = await Promise.all([
    specIds.length
      ? db.select({ id: specItems.id, name: specItems.name, category: specCategories.name, categoryOrder: specCategories.sortOrder, order: specItems.sortOrder }).from(specItems).innerJoin(specCategories, eq(specCategories.id, specItems.categoryId)).where(and(inArray(specItems.id, specIds), eq(specItems.isActive, true)))
      : Promise.resolve([] as { id: string; name: string; category: string; categoryOrder: number; order: number }[]),
    db
      .select({ d: documents, typeCode: documentTypes.code })
      .from(documents)
      .leftJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.companyId, companyId), eq(documents.entityType, "PROJECT"), eq(documents.entityId, project.id), eq(documents.isDeleted, false), eq(documents.isSensitive, false), sql`${documents.mime} like 'image/%'`)),
  ]);
  const specById = new Map(specs.map((s) => [s.id, s]));
  return types.map((t) => {
    const mine = projectFlats.filter((f) => f.flatTypeId === t.id);
    const available = mine.filter((f) => f.status === "AVAILABLE");
    const prices = available.map((f) => f.pricePaise).filter((p) => p > 0);
    const price = w.showPrices && prices.length ? Math.min(...prices) : null;
    const groups = new Map<string, { order: number; items: { order: number; name: string }[] }>();
    for (const id of t.specItemIds) {
      const s = specById.get(id);
      if (!s) continue;
      const g = groups.get(s.category) ?? { order: s.categoryOrder, items: [] };
      g.items.push({ order: s.order, name: s.name });
      groups.set(s.category, g);
    }
    const specifications = [...groups.entries()].sort((a, b) => a[1].order - b[1].order).map(([category, g]) => ({ category, items: g.items.sort((a, b) => a.order - b.order).map((i) => i.name) }));
    const plan = floorPlans.find((fp) => {
      const title = (fp.d.title ?? fp.d.fileName).toLowerCase();
      const isPlan = fp.typeCode === "FLOOR_PLAN" || title.includes("floor plan") || title.includes("floorplan");
      return isPlan && (title.includes(t.code.toLowerCase()) || title.includes(t.name.toLowerCase()));
    });
    const floorPlanUrl = plan ? documentUrls(plan.d).medium_url : null;
    return {
      code: t.code, name: t.name, bhk: t.bhk ?? 0, facing: t.facing ?? null, description: t.description ?? null,
      rooms: t.rooms.map((r) => ({ label: r.label, room_type_name: r.room_type_name, length_ft: r.length_ft, width_ft: r.width_ft, sqft: r.sqft })),
      areas: t.areas.map((a) => ({ name: a.area_type_name, code: a.area_type_code, area_type_code: a.area_type_code, area_type_name: a.area_type_name, sqft: a.sqft })),
      carpet_sqft: t.carpetSqft, builtup_sqft: t.builtupSqft, super_builtup_sqft: t.superBuiltupSqft, specifications,
      floor_plan_url: floorPlanUrl, floor_plan_image_url: floorPlanUrl, price_from_paise: price, price_paise: price,
      available_count: w.showAvailability ? available.length : null,
    };
  });
}

interface BlockLite { id: string; name: string; floors: number; typeName: string | null; percent: number; status: DbProject["status"] }

function availabilityGrid(w: DbWebsite, blockRows: BlockLite[], projectFlats: FlatLite[]): PublicAvailabilityGrid {
  const blocksOut = blockRows.map((b) => {
    const mine = projectFlats.filter((f) => f.blockId === b.id);
    const byFloor = new Map<number, FlatLite[]>();
    for (const f of mine) byFloor.set(f.floor, [...(byFloor.get(f.floor) ?? []), f]);
    const floors = [...byFloor.entries()].sort((a, b) => b[0] - a[0]).map(([floor, cells]) => {
      const label = cells[0]?.floorLabel ?? String(floor);
      return {
        floor_label: label, label, has_units: cells.length > 0,
        cells: cells.sort((a, b) => a.position - b.position).map((f) => {
          const availability = toPublicAvailability(f.status);
          return { flat_number: f.flatNumber, position: f.position, availability, status: availability, configuration: f.flatTypeCode, flat_type_code: f.flatTypeCode, facing: f.facing, price_paise: w.showPrices && availability === "AVAILABLE" && f.pricePaise > 0 ? f.pricePaise : null };
        }),
      };
    });
    return { name: b.name, positions: Math.max(0, ...floors.map((f) => f.cells.length)), floors, available_count: mine.filter((f) => f.status === "AVAILABLE").length, total_count: mine.length };
  });
  return { project_slug: w.slug ?? "", show_prices: w.showPrices, blocks: blocksOut, generated_at: new Date().toISOString() };
}

/** Construction progress per block: stages in order with the photos flagged for the website (local implementation; no construction module yet). */
async function constructionFor(db: Executor, blockRows: BlockLite[]): Promise<PublicProgressBlock[]> {
  if (blockRows.length === 0) return [];
  const stages = await db.select().from(blockStages).where(inArray(blockStages.blockId, blockRows.map((b) => b.id))).orderBy(asc(blockStages.sortOrder));
  const photoRows = stages.length
    ? await db.select().from(stagePhotos).where(and(inArray(stagePhotos.blockStageId, stages.map((s) => s.id)), eq(stagePhotos.showOnWebsite, true))).orderBy(asc(stagePhotos.sortOrder))
    : [];
  const docs = await loadDocuments(db, photoRows.map((p) => p.documentId));
  return blockRows.map((b) => ({
    name: b.name, percent: b.percent, status: b.status,
    stages: stages.filter((s) => s.blockId === b.id).map((s): PublicStageProgress => ({
      name: s.name, status: s.status, started_on: s.startedOn ?? null, completed_on: s.completedOn ?? null,
      photos: photoRows.filter((p) => p.blockStageId === s.id).flatMap((p) => {
        const doc = docs.get(p.documentId);
        if (!isPublicDocument(doc) || !doc.mime.startsWith("image/")) return [];
        const img = imageItem(doc, p.caption);
        return [{ thumb_url: img.thumb_url ?? img.medium_url ?? "", medium_url: img.medium_url ?? "", url: img.medium_url ?? undefined, alt: p.caption, caption: p.caption, width: img.width, height: img.height, taken_on: s.completedOn ?? null }];
      }),
    })),
  }));
}

/** Assembles the public project detail; null when the slug is not a published project. */
export async function buildProjectDetail(db: Executor, companyId: string, slug: string, site: SiteSettingsRecord | null): Promise<PublicProjectDetail | null> {
  const [item] = await publishedProjects(db, companyId, slug);
  if (!item) return null;
  const { p, w } = item;
  const [card] = await buildProjectCards(db, [item], site);
  const slugs = await publishedSlugs(db, companyId);
  const [amenityRows, blockRows, flatRows, heroDocs, visitSettings, gallery] = await Promise.all([
    db.select({ name: amenities.name, category: amenities.category, icon: amenities.icon }).from(projectAmenities).innerJoin(amenities, eq(amenities.id, projectAmenities.amenityId)).where(eq(projectAmenities.projectId, p.id)).orderBy(asc(amenities.name)),
    db.select({ id: blocks.id, name: blocks.name, floors: blocks.floors, typeName: blockTypes.name, percent: blocks.constructionPercent, status: blocks.status }).from(blocks).leftJoin(blockTypes, eq(blockTypes.id, blocks.blockTypeId)).where(and(eq(blocks.projectId, p.id), eq(blocks.isActive, true))).orderBy(asc(blocks.sortOrder), asc(blocks.name)),
    db.select({ id: flats.id, blockId: flats.blockId, flatNumber: flats.flatNumber, floor: flats.floor, floorLabel: flats.floorLabel, position: flats.position, flatTypeId: flats.flatTypeId, flatTypeCode: flats.flatTypeCode, facing: flats.facing, status: flats.status, pricePaise: flats.pricePaise }).from(flats).innerJoin(blocks, eq(blocks.id, flats.blockId)).where(and(eq(flats.projectId, p.id), eq(blocks.isActive, true))),
    loadDocuments(db, [...w.heroDocumentIds, w.brochureDocumentId, w.seo.og_image_document_id]),
    loadVisitSettings(db, p.id),
    galleryFor(db, companyId, p.id, slugs),
  ]);
  const blockLite: BlockLite[] = blockRows.map((b) => ({ ...b, percent: Number(b.percent ?? 0) }));
  const flatLite: FlatLite[] = flatRows.map((f) => ({ ...f, pricePaise: Number(f.pricePaise) }));
  const configurations = await configurationsFor(db, companyId, p, w, flatLite);
  const progressBlocks = w.showProgress ? await constructionFor(db, blockLite) : null;
  const heroUrls = w.heroDocumentIds.map((id) => heroDocs.get(id)).filter((d): d is DocumentRecord => isPublicDocument(d) && d.mime.startsWith("image/"));
  const brochure = w.brochureDocumentId ? heroDocs.get(w.brochureDocumentId) : undefined;
  const ogDoc = w.seo.og_image_document_id ? heroDocs.get(w.seo.og_image_document_id) : undefined;
  const ogUrl = (isPublicDocument(ogDoc) ? documentUrls(ogDoc).medium_url : null) ?? (heroUrls[0] ? documentUrls(heroUrls[0]).medium_url : null);
  const totalUnits = flatLite.length;
  const leadBlock = progressBlocks ? [...progressBlocks].sort((a, b) => b.percent - a.percent)[0] : undefined;
  const currentStage = leadBlock ? (leadBlock.stages.find((s) => s.status === "IN_PROGRESS")?.name ?? [...leadBlock.stages].reverse().find((s) => s.status === "COMPLETED")?.name ?? null) : null;
  const floorsLabel = blockLite.length ? (() => { const fl = blockLite.map((b) => b.floors); const lo = Math.min(...fl), hi = Math.max(...fl); return lo === hi ? `${hi}` : `${lo}–${hi}`; })() : null;
  const address = { line1: p.address?.line1 ?? "", line2: p.address?.line2 ?? null, locality: p.address?.locality ?? null, city: p.address?.city ?? p.city ?? "", state: p.address?.state ?? "", pincode: p.address?.pincode ?? "" };
  return {
    ...card!,
    description: p.description ?? null,
    address: { line1: address.line1, locality: address.locality, city: address.city, state: address.state, pincode: address.pincode },
    latitude: p.latitude ?? null, longitude: p.longitude ?? null,
    landmarks: p.landmarks.map((l) => ({ name: l.name, distance_km: l.distance_km })),
    approvals: p.approvals.map((a) => ({ name: a.name, number: a.number ?? null, status: a.status })),
    launch_date: p.launchDate ?? null, land_area_sqft: p.landAreaSqft ?? null,
    amenities: amenityRows.map((a) => ({ name: a.name, category: a.category ?? null, icon: a.icon ?? null })),
    hero_urls: heroUrls.map((d) => documentUrls(d).medium_url ?? documentUrls(d).url!),
    gallery, configurations,
    show_prices: w.showPrices, show_availability: w.showAvailability, show_progress: w.showProgress,
    availability: w.showAvailability ? availabilityGrid(w, blockLite, flatLite) : null,
    construction: progressBlocks ? { percent: card!.construction_percent ?? 0, current_stage: currentStage, stages: leadBlock?.stages ?? [] } : null,
    video_urls: w.videoUrls, tour_urls: w.tourUrls, map_embed_url: w.mapEmbedUrl ?? null,
    brochure_available: Boolean(brochure && !brochure.isDeleted && !brochure.isSensitive && brochure.mime === "application/pdf"),
    faqs: w.faqs.map((f) => ({ q: f.q, a: f.a })),
    visit_booking_enabled: Boolean(visitSettings?.enabled),
    blocks: blockLite.map((b) => ({ name: b.name, type: b.typeName ?? "", floors: b.floors, total_units: flatLite.filter((f) => f.blockId === b.id).length, available_units: w.showAvailability ? flatLite.filter((f) => f.blockId === b.id && f.status === "AVAILABLE").length : null })),
    seo: { title: w.seo.title ?? p.name, description: w.seo.description ?? (p.description ? p.description.slice(0, 160) : null), og_image_url: ogUrl },
    hero_images: heroUrls.map((d) => { const u = documentUrls(d); return { url: u.medium_url ?? u.url!, alt: d.title ?? p.name, caption: d.title ?? null, width: u.width, height: u.height }; }),
    overview: p.description ?? "",
    key_facts: { project_type: p.projectType, status: p.status, rera_number: p.reraNumber ?? null, launch_date: p.launchDate ?? null, possession_date: p.possessionDate ?? null, land_area_sqft: p.landAreaSqft ?? null, total_units: totalUnits, block_count: blockLite.length, floors: floorsLabel, address },
    construction_progress: progressBlocks ? { blocks: progressBlocks } : null,
    videos: w.videoUrls, tours: w.tourUrls,
  };
}

// ---------------------------------------------------------------------------
// Site + home
// ---------------------------------------------------------------------------

function postCard(r: typeof cmsPosts.$inferSelect, docs: Map<string, DocumentRecord>, authors: Map<string, string>): PublicPostCard {
  const cover = r.coverDocumentId ? documentUrls(docs.get(r.coverDocumentId)).medium_url : null;
  const words = r.bodyMd.split(/\s+/).filter(Boolean).length;
  return { title: r.title, slug: r.slug, excerpt: r.excerpt ?? null, cover_url: cover, cover_image_url: cover, published_at: (r.publishedAt ?? r.createdAt).toISOString(), tags: r.tags, author_name: r.authorUserId ? (authors.get(r.authorUserId) ?? null) : null, reading_minutes: Math.max(1, Math.round(words / 200)) };
}

async function authorNames(db: Executor, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function buildSite(db: Executor, companyId: string): Promise<PublicSiteResponse> {
  const site = await loadSiteSettings(db, companyId);
  const docs = await loadDocuments(db, [site?.brand.logo_document_id, site?.brand.favicon_document_id, site?.seoDefaults.og_image_document_id]);
  const base = {
    brand: { name: site?.brand.name || "", tagline: site?.brand.tagline ?? null, logo_url: documentUrls(site?.brand.logo_document_id ? docs.get(site.brand.logo_document_id) : undefined).url, favicon_url: documentUrls(site?.brand.favicon_document_id ? docs.get(site.brand.favicon_document_id) : undefined).url },
    contacts: { phone: site?.contacts.phone ?? null, whatsapp: site?.contacts.whatsapp ?? null, email: site?.contacts.email ?? null },
    offices: ((site?.offices ?? []) as { name: string; address: string; phone?: string | null; maps_link?: string | null }[]).map((o) => ({ name: o.name, address: o.address, phone: o.phone ?? null, maps_link: o.maps_link ?? null })),
    social: Object.fromEntries(Object.entries(site?.social ?? {}).filter(([, v]) => typeof v === "string" && v)) as Record<string, string>,
    trust_stats: site?.trustStats ?? [],
    value_props: ((site?.valueProps ?? []) as { title: string; body?: string | null; icon?: string | null }[]).map((v) => ({ title: v.title, body: v.body ?? "", icon: v.icon ?? null })),
    disclaimer: site?.disclaimer ?? null,
    seo_defaults: { title: site?.seoDefaults.title ?? null, description: site?.seoDefaults.description ?? null, og_image_url: documentUrls(site?.seoDefaults.og_image_document_id ? docs.get(site.seoDefaults.og_image_document_id) : undefined).medium_url },
    analytics: { ga_id: site?.analytics.ga_id ?? null },
    site_live: site?.siteLive ?? true,
    coming_soon_message: site?.comingSoonMessage ?? null,
    portal_url: site?.portalUrl ?? null,
    walkthrough_video_url: site?.walkthroughVideoUrl ?? null,
  };
  if (!base.site_live) return { ...base, banners: [], featured_projects: [], home_sections: [], testimonials: [], latest_posts: [] };
  const [bannerRows, sectionRows, testimonialRows, postRows, published] = await Promise.all([
    db.select().from(cmsBanners).where(and(eq(cmsBanners.companyId, companyId), eq(cmsBanners.isActive, true), sql`(${cmsBanners.startsAt} is null or ${cmsBanners.startsAt} <= now())`, sql`(${cmsBanners.endsAt} is null or ${cmsBanners.endsAt} >= now())`)).orderBy(asc(cmsBanners.sortOrder), asc(cmsBanners.createdAt)),
    db.select().from(cmsHomeSections).where(and(eq(cmsHomeSections.companyId, companyId), eq(cmsHomeSections.isActive, true))).orderBy(asc(cmsHomeSections.sortOrder)),
    db.select({ t: cmsTestimonials, projectName: projects.name, projectId: cmsTestimonials.projectId }).from(cmsTestimonials).leftJoin(projects, eq(projects.id, cmsTestimonials.projectId)).where(and(eq(cmsTestimonials.companyId, companyId), eq(cmsTestimonials.isPublished, true))).orderBy(asc(cmsTestimonials.sortOrder)),
    latestPosts(db, companyId, 3),
    publishedProjects(db, companyId),
  ]);
  const mediaDocs = await loadDocuments(db, [...bannerRows.map((b) => b.documentId), ...testimonialRows.map((t) => t.t.photoDocumentId), ...postRows.map((p) => p.coverDocumentId)]);
  const publishedIds = new Set(published.map((p) => p.p.id));
  const featuredIds = site?.featuredProjectIds ?? [];
  const featuredItems = featuredIds.length ? featuredIds.map((id) => published.find((p) => p.p.id === id)).filter((p): p is PublishedProject => Boolean(p)) : published.slice(0, 6);
  const featured = await buildProjectCards(db, featuredItems, site);
  const authors = await authorNames(db, postRows.map((p) => p.authorUserId));
  return {
    ...base,
    banners: bannerRows.flatMap((b) => {
      const doc = b.documentId ? mediaDocs.get(b.documentId) : undefined;
      if (!isPublicDocument(doc)) return [];
      const u = documentUrls(doc);
      return [{ title: b.title, subtitle: b.subtitle ?? null, cta_label: b.ctaLabel ?? null, cta_url: b.ctaUrl ?? null, image_url: u.url!, image_medium_url: u.medium_url }];
    }),
    featured_projects: featured,
    home_sections: sectionRows.map((s) => ({ key: s.key, title: s.title ?? null, body: s.body })),
    testimonials: testimonialRows.map((t) => ({ name: t.t.name, project_name: t.projectId && publishedIds.has(t.projectId) ? (t.projectName ?? null) : null, quote: t.t.quote, rating: t.t.rating ?? null, photo_url: documentUrls(t.t.photoDocumentId ? mediaDocs.get(t.t.photoDocumentId) : undefined).thumb_url })),
    latest_posts: postRows.map((p) => postCard(p, mediaDocs, authors)),
  };
}

/** True when the website is switched on (site_live); public lists are empty and detail pages 404 otherwise. */
export async function siteIsLive(db: Executor, companyId: string): Promise<boolean> {
  const site = await loadSiteSettings(db, companyId);
  return site?.siteLive ?? true;
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

async function sitemapEntries(db: Executor, companyId: string): Promise<{ path: string; updated_at: string; priority: number }[]> {
  if (!(await siteIsLive(db, companyId))) return [];
  const now = new Date().toISOString();
  const [published, posts, pages] = await Promise.all([
    publishedProjects(db, companyId),
    db.select({ slug: cmsPosts.slug, updatedAt: cmsPosts.updatedAt }).from(cmsPosts).where(and(eq(cmsPosts.companyId, companyId), publishedPostCondition())),
    db.select({ slug: cmsPages.slug, updatedAt: cmsPages.updatedAt }).from(cmsPages).where(and(eq(cmsPages.companyId, companyId), eq(cmsPages.isPublished, true))),
  ]);
  return [
    { path: "/", updated_at: now, priority: 1 },
    { path: "/projects", updated_at: now, priority: 0.9 },
    ...published.map((p) => ({ path: `/projects/${p.w.slug}`, updated_at: p.w.updatedAt.toISOString(), priority: 0.9 })),
    { path: "/about", updated_at: now, priority: 0.5 },
    { path: "/gallery", updated_at: now, priority: 0.5 },
    { path: "/blog", updated_at: now, priority: 0.6 },
    ...posts.map((p) => ({ path: `/blog/${p.slug}`, updated_at: p.updatedAt.toISOString(), priority: 0.6 })),
    { path: "/contact", updated_at: now, priority: 0.5 },
    ...pages.map((p) => ({ path: `/${p.slug}`, updated_at: p.updatedAt.toISOString(), priority: 0.3 })),
  ];
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const slugParams = z.object({ slug: SlugSchema });

async function companyOr404(app: FastifyInstance): Promise<string> {
  const id = await publicCompanyId(app.dbReplica);
  if (!id) throw ApiError.notFound("Site");
  return id;
}

export function registerPublicContentRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/public/site", public: true,
    schema: { response: { 200: PublicSiteResponseSchema }, summary: "Site settings (allow-listed) plus home-page content; coming-soon payload when the site is not live" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => buildSite(app.dbReplica, await companyOr404(app))),
  });

  route(app, {
    method: "GET", url: "/public/projects", public: true,
    schema: { querystring: PublicProjectsQuerySchema, response: { 200: z.array(PublicProjectCardSchema) }, summary: "Published project cards (empty when the site is not live)" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => {
      const companyId = await companyOr404(app);
      if (!(await siteIsLive(app.dbReplica, companyId))) return [];
      const q = req.query;
      const items = await publishedProjects(app.dbReplica, companyId);
      const cards = await buildProjectCards(app.dbReplica, items, await loadSiteSettings(app.dbReplica, companyId));
      return cards.filter((c) =>
        (!q.city || c.city.toLowerCase() === q.city.toLowerCase()) &&
        (!q.status || c.status === q.status) &&
        (!q.project_type || c.project_type === q.project_type) &&
        (q.bhk === undefined || c.bhk_options.includes(q.bhk)) &&
        (!q.q || `${c.name} ${c.city} ${c.locality ?? ""} ${c.configurations.join(" ")}`.toLowerCase().includes(q.q.toLowerCase())));
    }),
  });

  route(app, {
    method: "GET", url: "/public/projects/:slug", public: true,
    schema: { params: slugParams, response: { 200: PublicProjectDetailSchema }, summary: "Published project detail (404 when unpublished)" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => {
      const companyId = await companyOr404(app);
      if (!(await siteIsLive(app.dbReplica, companyId))) return null;
      return buildProjectDetail(app.dbReplica, companyId, req.params.slug, await loadSiteSettings(app.dbReplica, companyId));
    }, "Project"),
  });

  route(app, {
    method: "GET", url: "/public/posts", public: true,
    schema: { querystring: PublicListQuerySchema, response: { 200: listEnvelope(PublicPostCardSchema) }, summary: "Published blog posts" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => {
      const companyId = await companyOr404(app);
      const { page, page_size } = req.query;
      if (!(await siteIsLive(app.dbReplica, companyId))) return { items: [], total: 0, page, page_size, next_cursor: null };
      const where = and(eq(cmsPosts.companyId, companyId), publishedPostCondition());
      const [rows, [{ n } = { n: 0 }]] = await Promise.all([
        app.dbReplica.select().from(cmsPosts).where(where).orderBy(desc(cmsPosts.publishedAt), desc(cmsPosts.id)).limit(page_size).offset((page - 1) * page_size),
        app.dbReplica.select({ n: sql<number>`count(*)::int` }).from(cmsPosts).where(where),
      ]);
      const [docs, authors] = await Promise.all([loadDocuments(app.dbReplica, rows.map((r) => r.coverDocumentId)), authorNames(app.dbReplica, rows.map((r) => r.authorUserId))]);
      return { items: rows.map((r) => postCard(r, docs, authors)), total: Number(n), page, page_size, next_cursor: null };
    }),
  });

  route(app, {
    method: "GET", url: "/public/posts/:slug", public: true,
    schema: { params: slugParams, response: { 200: PublicPostDetailSchema }, summary: "One published post" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => {
      const companyId = await companyOr404(app);
      if (!(await siteIsLive(app.dbReplica, companyId))) return null;
      const [r] = await app.dbReplica.select().from(cmsPosts).where(and(eq(cmsPosts.companyId, companyId), eq(cmsPosts.slug, req.params.slug), publishedPostCondition())).limit(1);
      if (!r) return null;
      const [docs, authors] = await Promise.all([loadDocuments(app.dbReplica, [r.coverDocumentId, r.seo.og_image_document_id]), authorNames(app.dbReplica, [r.authorUserId])]);
      const card = postCard(r, docs, authors);
      const og = r.seo.og_image_document_id ? documentUrls(docs.get(r.seo.og_image_document_id)).medium_url : null;
      return { ...card, body_md: r.bodyMd, author_name: card.author_name ?? null, seo: { title: r.seo.title ?? r.title, description: r.seo.description ?? r.excerpt ?? null, og_image_url: og ?? card.cover_url } };
    }, "Post"),
  });

  route(app, {
    method: "GET", url: "/public/pages/:slug", public: true,
    schema: { params: slugParams, response: { 200: PublicPageSchema }, summary: "One published page (privacy, disclaimer, about…)" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => {
      const companyId = await companyOr404(app);
      if (!(await siteIsLive(app.dbReplica, companyId))) return null;
      const [r] = await app.dbReplica.select().from(cmsPages).where(and(eq(cmsPages.companyId, companyId), eq(cmsPages.slug, req.params.slug), eq(cmsPages.isPublished, true))).limit(1);
      if (!r) return null;
      return { slug: r.slug, title: r.title, body_md: r.bodyMd, seo: { title: r.seo.title ?? r.title, description: r.seo.description ?? null } };
    }, "Page"),
  });

  route(app, {
    method: "GET", url: "/public/gallery", public: true,
    schema: { querystring: z.object({ project: SlugSchema.optional(), category: z.string().max(60).optional() }), response: { 200: PublicGalleryResponseSchema }, summary: "Published gallery images, optionally for one project" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => {
      const companyId = await companyOr404(app);
      if (!(await siteIsLive(app.dbReplica, companyId))) return { items: [], projects: [] };
      const slugs = await publishedSlugs(app.dbReplica, companyId);
      let projectId: string | null = null;
      if (req.query.project) {
        const hit = [...slugs.entries()].find(([, v]) => v.slug === req.query.project);
        if (!hit) return null;
        projectId = hit[0];
      }
      const items = (await galleryFor(app.dbReplica, companyId, projectId, slugs)).filter((i) => !req.query.category || i.category === req.query.category);
      const withImages = await app.dbReplica.selectDistinct({ projectId: cmsGallery.projectId }).from(cmsGallery).where(and(eq(cmsGallery.companyId, companyId), eq(cmsGallery.isPublished, true), sql`${cmsGallery.projectId} is not null`));
      return { items, projects: withImages.flatMap((r) => (r.projectId && slugs.has(r.projectId) ? [slugs.get(r.projectId)!] : [])) };
    }, "Project"),
  });

  route(app, {
    method: "GET", url: "/public/people", public: true,
    schema: { response: { 200: z.array(PublicPersonSchema) }, summary: "Leadership / people" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => {
      const companyId = await companyOr404(app);
      if (!(await siteIsLive(app.dbReplica, companyId))) return [];
      const rows = await app.dbReplica.select().from(cmsPeople).where(and(eq(cmsPeople.companyId, companyId), eq(cmsPeople.isPublished, true))).orderBy(asc(cmsPeople.sortOrder), asc(cmsPeople.name));
      const docs = await loadDocuments(app.dbReplica, rows.map((r) => r.photoDocumentId));
      return rows.map((r) => ({ name: r.name, title: r.title ?? "", bio: r.bio ?? null, photo_url: documentUrls(r.photoDocumentId ? docs.get(r.photoDocumentId) : undefined).medium_url }));
    }),
  });

  route(app, {
    method: "GET", url: "/public/media/:id", public: true,
    schema: { params: z.object({ id: z.uuid() }), querystring: PublicMediaQuerySchema, response: { 200: z.any() }, summary: "Immutable public image bytes (CMS media, project/stage photos)", hide: true },
    handler: async (req, reply) => {
      const [doc] = await app.dbReplica.select().from(documents).where(eq(documents.id, req.params.id)).limit(1);
      if (!isPublicDocument(doc) || !doc.mime.startsWith("image/")) throw ApiError.notFound("Media");
      const file = await streamDocument(app.dbReplica, doc.id, req.query.variant ?? "original");
      if (!file) throw ApiError.notFound("Media");
      reply.header("Content-Type", file.mime);
      reply.header("Content-Disposition", "inline");
      reply.header("Cache-Control", IMMUTABLE_CACHE_CONTROL);
      reply.header("X-Content-Type-Options", "nosniff");
      if (file.size !== null) reply.header("Content-Length", String(file.size));
      return reply.send(file.stream);
    },
  });

  route(app, {
    method: "GET", url: "/public/sitemap", public: true,
    schema: { response: { 200: PublicSitemapResponseSchema }, summary: "Sitemap entries as JSON (published projects, posts, pages)" },
    handler: async (req, reply) => publicCached(app, req, reply, async () => ({ entries: await sitemapEntries(app.dbReplica, await companyOr404(app)) })),
  });

  route(app, {
    method: "GET", url: "/public/sitemap.xml", public: true,
    schema: { response: { 200: z.string() }, summary: "sitemap.xml generated from published content" },
    handler: async (req, reply) => {
      const entries = await publicCached(app, req, reply, async () => ({ entries: await sitemapEntries(app.dbReplica, await companyOr404(app)) }));
      const body = [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`, ...entries.entries.map((e) => `  <url><loc>${xmlEscape(webOrigin + e.path)}</loc><lastmod>${e.updated_at.slice(0, 10)}</lastmod><priority>${e.priority.toFixed(1)}</priority></url>`), `</urlset>`, ``].join("\n");
      return sendText(reply, "application/xml; charset=utf-8", body);
    },
  });

  route(app, {
    method: "GET", url: "/public/robots.txt", public: true,
    schema: { response: { 200: z.string() }, summary: "robots.txt (Disallow everything while the site is not live)" },
    handler: async (req, reply) => {
      const live = await publicCached(app, req, reply, async () => ({ live: await siteIsLive(app.dbReplica, await companyOr404(app)) }));
      const body = live.live ? `User-agent: *\nAllow: /\nDisallow: /visit/\nDisallow: /api/\nSitemap: ${webOrigin}/sitemap.xml\n` : `User-agent: *\nDisallow: /\n`;
      return sendText(reply, "text/plain; charset=utf-8", body);
    },
  });
}

function sendText(reply: FastifyReply, contentType: string, body: string): FastifyReply {
  publicHeaders(reply);
  reply.header("Content-Type", contentType);
  return reply.send(body);
}
