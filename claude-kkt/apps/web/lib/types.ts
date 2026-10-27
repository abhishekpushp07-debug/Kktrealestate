/**
 * Public website API types — the `@kkt/contracts` public schemas (docs/API-CONVENTIONS.md Appendix B), which are
 * also the API's response serialisers, so the website can never drift from what the server actually sends.
 *
 * Only the handful of website-side helper shapes (list envelope, error envelope, filter bag) live here. Where the
 * contract documents an optional "apps/web alias" (`type`, `videos`, `url`, `date`…), the components read the
 * canonical field instead (`project_type`, `video_urls`, `medium_url`, `visit_date`…).
 */
import type {
  PublicAvailabilityCell,
  PublicAvailabilityGrid,
  PublicBanner,
  PublicBrochureRepeatRequest,
  PublicBrochureRequest,
  PublicBrochureResponse,
  PublicConfiguration,
  PublicEnquiryInput,
  PublicEnquiryResponse,
  PublicGalleryItem,
  PublicGalleryResponse,
  PublicImage,
  PublicPage,
  PublicPerson,
  PublicPostCard,
  PublicPostDetail,
  PublicProgressBlock,
  PublicProjectCard,
  PublicProjectDetail,
  PublicProjectsQuery,
  PublicSiteResponse,
  PublicSitemapEntry,
  PublicStagePhoto,
  PublicStageProgress,
  PublicTestimonial,
  PublicVisitBookingRequest,
  PublicVisitBookingResponse,
  PublicVisitDay,
  PublicVisitManageResponse,
  PublicVisitRescheduleInput,
  PublicVisitRescheduleResponse,
  PublicVisitSlot,
  Utm,
} from "@kkt/contracts";

export type {
  ProjectStatus,
  ProjectType,
  StageStatus,
  VisitStatus,
  PublicAvailability as AvailabilityCellStatus,
} from "@kkt/contracts";
export type { PublicImage };

// ---------------------------------------------------------------------------
// GET /public/site
// ---------------------------------------------------------------------------

export type SiteSettings = PublicSiteResponse;
export type SiteBrand = SiteSettings["brand"];
export type SiteContacts = SiteSettings["contacts"];
export type SiteOffice = SiteSettings["offices"][number];
export type SiteSocial = SiteSettings["social"];
export type TrustStat = SiteSettings["trust_stats"][number];
export type ValueProp = SiteSettings["value_props"][number];
export type SeoDefaults = SiteSettings["seo_defaults"];
export type SiteAnalytics = SiteSettings["analytics"];
export type Banner = PublicBanner;
export type HomeSection = SiteSettings["home_sections"][number];
export type Testimonial = PublicTestimonial;
export type ProjectCard = PublicProjectCard;
export type PostCard = PublicPostCard;

// ---------------------------------------------------------------------------
// GET /public/projects/:slug
// ---------------------------------------------------------------------------

export type ProjectDetail = PublicProjectDetail;
export type ProjectAddress = ProjectDetail["address"];
export type KeyFacts = NonNullable<ProjectDetail["key_facts"]>;
export type Approval = ProjectDetail["approvals"][number];
export type Amenity = ProjectDetail["amenities"][number];
export type Landmark = ProjectDetail["landmarks"][number];
export type Faq = ProjectDetail["faqs"][number];
export type ProjectSeo = ProjectDetail["seo"];
export type Configuration = PublicConfiguration;
export type RoomSize = Configuration["rooms"][number];
export type AreaSize = Configuration["areas"][number];
export type SpecGroup = Configuration["specifications"][number];
export type AvailabilityGrid = PublicAvailabilityGrid;
export type AvailabilityBlock = AvailabilityGrid["blocks"][number];
export type AvailabilityFloor = AvailabilityBlock["floors"][number];
export type AvailabilityCell = PublicAvailabilityCell;
export type ConstructionProgress = NonNullable<ProjectDetail["construction_progress"]>;
export type ProgressBlock = PublicProgressBlock;
export type ProgressStage = PublicStageProgress;
export type StagePhoto = PublicStagePhoto;

// ---------------------------------------------------------------------------
// Visit availability / booking / manage
// ---------------------------------------------------------------------------

export type VisitSlot = PublicVisitSlot;
export type VisitDay = PublicVisitDay;
export type SiteVisitRequest = PublicVisitBookingRequest;
export type SiteVisitResult = PublicVisitBookingResponse;
export type SiteVisitManage = PublicVisitManageResponse;
export type SiteVisitRescheduleRequest = PublicVisitRescheduleInput;
/** The moved visit's manage view plus its NEW manage link / token (the old link answers 410 LINK_EXPIRED from now on). */
export type SiteVisitRescheduleResult = PublicVisitRescheduleResponse;

// ---------------------------------------------------------------------------
// Enquiries & brochure gate
// ---------------------------------------------------------------------------

export type UtmParams = Utm;
export type EnquiryRequest = PublicEnquiryInput;
export type EnquiryResult = PublicEnquiryResponse;
export type BrochureRequest = PublicBrochureRequest;
/** One public URL of GET /public/sitemap (path + lastmod). */
export type SitemapEntry = PublicSitemapEntry;
/** Returning device: only the remembered opaque visitor token (the API looks the visitor up). */
export type BrochureRepeatRequest = PublicBrochureRepeatRequest;
export type BrochureResult = PublicBrochureResponse;

// ---------------------------------------------------------------------------
// Blog, pages, gallery, people
// ---------------------------------------------------------------------------

/** Paged list envelope (API-CONVENTIONS "List endpoints"). */
export interface ListEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  next_cursor: string | null;
}

export type PostDetail = PublicPostDetail;
export type PostSeo = PostDetail["seo"];
export type PageDetail = PublicPage;
export type GalleryItem = PublicGalleryItem;
export type GalleryResponse = PublicGalleryResponse;
export type Person = PublicPerson;

// ---------------------------------------------------------------------------
// Empty values for a missing payload (API unreachable → the shell still renders)
// ---------------------------------------------------------------------------

export const NO_CONTACTS: SiteContacts = { phone: null, whatsapp: null, email: null };
export const NO_SEO_DEFAULTS: SeoDefaults = { title: null, description: null, og_image_url: null };
export const NO_ADDRESS: KeyFacts["address"] = {
  line1: null,
  line2: null,
  locality: null,
  city: null,
  state: null,
  pincode: null,
};

// ---------------------------------------------------------------------------
// Error envelope + list filters
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

/** `GET /public/projects` filters as the website passes them through from the URL (strings; the API coerces `bhk`). */
export type ProjectListFilters = { [K in keyof PublicProjectsQuery]?: string };
