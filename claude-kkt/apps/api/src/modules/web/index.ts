import type { FastifyInstance } from "fastify";
import { registerCmsRoutes } from "./cms.js";
import { registerProjectWebsiteRoutes } from "./projectWebsite.js";
import { registerPublicContentRoutes } from "./publicContent.js";
import { registerPublicFormRoutes } from "./publicForms.js";
import { registerPublicVisitRoutes } from "./publicVisits.js";
import { registerVisitRoutes } from "./visitRoutes.js";

export { ensureSiteSettings, loadSiteSettings, latestPosts, publishedPostCondition, RESERVED_PAGE_SLUGS, type SiteSettingsRecord } from "./cms.js";
export { ensureWebsiteSettings, publishBlockers, brochureSparkline, loadScopedProject, type DbWebsiteSettings } from "./projectWebsite.js";
export { publishedProjects, livePublishedProject, buildProjectCards, buildProjectDetail, siteIsLive, publicMediaAllowed, isFloorPlanDocument, type PublishedProject } from "./publicContent.js";
export { signVisitorToken, verifyVisitorToken, FORM_RATE_LIMIT } from "./publicForms.js";
export { availabilityCachePath } from "./publicVisits.js";
export {
  ensureVisitSettings, loadVisitSettings, domainSettings, visitSettingsWire, bookedCounts, projectAvailability, clampRange, matchSlot, reserveSeat, bookVisit, cancelVisit, rescheduleVisit, markOutcome,
  nudgeVisitOutcomes, visitRow, loadVisitSelect, loadVisitByToken, visitIcs, icsUrl, manageUrl, isPast, otherUpcomingVisits, scheduleLeadStage, completeLeadStage, revertLeadAfterCancel,
  type DbVisit, type DbVisitSettings, type VisitSelect, type BookVisitInput, type BookedVisit,
} from "./visitService.js";
export { publicCached, publicCacheKey, bustPublicCache, mediaUrl, documentUrls, isPublicDocument, fakeNumber, PUBLIC_CACHE_CONTROL, PUBLIC_CACHE_VERSION_KEY, IMMUTABLE_CACHE_CONTROL } from "./shared.js";

/**
 * Web module (SPEC §15, §2, Appendix B): marketing website CMS, per-project website/visit settings, the public read API, enquiry and
 * brochure forms, and the site-visit scheduler (public + ERP). Auto-registered under /api/v1.
 */
export default async function webModule(app: FastifyInstance): Promise<void> {
  registerCmsRoutes(app);
  registerProjectWebsiteRoutes(app);
  registerPublicContentRoutes(app);
  registerPublicFormRoutes(app);
  registerPublicVisitRoutes(app);
  registerVisitRoutes(app);
}
