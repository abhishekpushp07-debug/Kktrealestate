import type { FastifyInstance } from "fastify";
import { registerCmsRoutes } from "./cms.js";
import { registerProjectWebsiteRoutes } from "./projectWebsite.js";
import { registerPublicContentRoutes } from "./publicContent.js";
import { registerPublicFormRoutes } from "./publicForms.js";
import { registerPublicVisitRoutes } from "./publicVisits.js";
import { registerVisitRoutes } from "./visitRoutes.js";

export { ensureSiteSettings, loadSiteSettings, latestPosts, publishedPostCondition, type SiteSettingsRecord } from "./cms.js";
export { ensureWebsiteSettings, publishBlockers, brochureSparkline, loadScopedProject, type DbWebsiteSettings } from "./projectWebsite.js";
export { publishedProjects, buildProjectCards, buildProjectDetail, siteIsLive, type PublishedProject } from "./publicContent.js";
export { signVisitorToken, verifyVisitorToken, FORM_RATE_LIMIT } from "./publicForms.js";
export { availabilityCachePath } from "./publicVisits.js";
export {
  ensureVisitSettings, loadVisitSettings, domainSettings, visitSettingsWire, bookedCounts, projectAvailability, clampRange, matchSlot, reserveSeat, bookVisit, cancelVisit, rescheduleVisit, markOutcome,
  nudgeVisitOutcomes, visitRow, loadVisitSelect, loadVisitByToken, visitIcs, icsUrl, manageUrl, isPast, otherUpcomingVisits, scheduleLeadStage, completeLeadStage, revertLeadAfterCancel,
  type DbVisit, type DbVisitSettings, type VisitSelect, type BookVisitInput, type BookedVisit,
} from "./visitService.js";
export { publicCached, bustPublicCache, mediaUrl, documentUrls, isPublicDocument, PUBLIC_CACHE_CONTROL, IMMUTABLE_CACHE_CONTROL } from "./shared.js";

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
