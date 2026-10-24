import { z } from "zod";
import { ProjectStatusSchema, ProjectTypeSchema, PublicAvailabilitySchema, StageStatusSchema, VisitStatusSchema } from "../enums.js";
import {
  DateStringSchema,
  EmailSchema,
  IntQuerySchema,
  PaiseSchema,
  PhoneSchema,
  SlugSchema,
  TimeStringSchema,
  TimestampSchema,
  UrlSchema,
} from "../common.js";
import { UtmSchema } from "./leads.js";

/** Honeypot field: bots fill it, humans never see it. Must be absent or empty. */
export const HoneypotSchema = z.literal("").optional();

/** Explicit consent checkbox: must be true. */
export const ConsentSchema = z.literal(true);

// ---------------------------------------------------------------------------
// Site-wide
// ---------------------------------------------------------------------------

export const PublicSiteSettingsSchema = z.object({
  brand: z.object({ name: z.string(), tagline: z.string().nullable(), logo_url: z.string().nullable(), favicon_url: z.string().nullable() }),
  contacts: z.object({ phone: z.string().nullable(), whatsapp: z.string().nullable(), email: z.string().nullable() }),
  offices: z.array(z.object({ name: z.string(), address: z.string(), phone: z.string().nullable(), maps_link: z.string().nullable() })),
  social: z.record(z.string(), z.string()),
  trust_stats: z.array(z.object({ label: z.string(), value: z.string() })),
  value_props: z.array(z.object({ title: z.string(), body: z.string(), icon: z.string().nullable() })),
  disclaimer: z.string().nullable(),
  seo_defaults: z.object({ title: z.string().nullable(), description: z.string().nullable(), og_image_url: z.string().nullable() }),
  analytics: z.object({ ga_id: z.string().nullable() }),
  site_live: z.boolean(),
  coming_soon_message: z.string().nullable(),
  portal_url: z.string().nullable(),
  walkthrough_video_url: z.string().nullable(),
});
export type PublicSiteSettings = z.infer<typeof PublicSiteSettingsSchema>;

export const PublicBannerSchema = z.object({
  title: z.string(),
  subtitle: z.string().nullable(),
  cta_label: z.string().nullable(),
  cta_url: z.string().nullable(),
  image_url: z.string(),
  image_medium_url: z.string().nullable(),
});
export type PublicBanner = z.infer<typeof PublicBannerSchema>;

export const PublicTestimonialSchema = z.object({
  name: z.string(),
  project_name: z.string().nullable(),
  quote: z.string(),
  rating: z.int().nullable(),
  photo_url: z.string().nullable(),
});
export type PublicTestimonial = z.infer<typeof PublicTestimonialSchema>;

export const PublicGalleryItemSchema = z.object({
  thumb_url: z.string(),
  medium_url: z.string(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  caption: z.string().nullable(),
  category: z.string().nullable(),
  project_slug: z.string().nullable(),
  project_name: z.string().nullable(),
});
export type PublicGalleryItem = z.infer<typeof PublicGalleryItemSchema>;

export const PublicPersonSchema = z.object({ name: z.string(), title: z.string(), bio: z.string().nullable(), photo_url: z.string().nullable() });
export type PublicPerson = z.infer<typeof PublicPersonSchema>;

export const PublicPostCardSchema = z.object({
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  cover_url: z.string().nullable(),
  published_at: TimestampSchema,
  tags: z.array(z.string()),
});
export type PublicPostCard = z.infer<typeof PublicPostCardSchema>;

export const PublicPostDetailSchema = PublicPostCardSchema.extend({
  body_md: z.string(),
  author_name: z.string().nullable(),
  seo: z.object({ title: z.string().nullable(), description: z.string().nullable(), og_image_url: z.string().nullable() }),
});
export type PublicPostDetail = z.infer<typeof PublicPostDetailSchema>;

export const PublicPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  body_md: z.string(),
  seo: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
});
export type PublicPage = z.infer<typeof PublicPageSchema>;

export const PublicListQuerySchema = z.object({ page: IntQuerySchema.min(1).default(1), page_size: IntQuerySchema.min(1).max(50).default(12) });
export type PublicListQuery = z.infer<typeof PublicListQuerySchema>;

// ---------------------------------------------------------------------------
// Projects (allow-listed)
// ---------------------------------------------------------------------------

/** `GET /public/projects?city=&status=&bhk=&q=` filters (API-CONVENTIONS Appendix B). */
export const PublicProjectsQuerySchema = z.object({
  city: z.string().trim().max(80).optional(),
  project_type: ProjectTypeSchema.optional(),
  status: ProjectStatusSchema.optional(),
  bhk: z.coerce.number().min(0).max(20).optional(),
  q: z.string().trim().max(100).optional(),
});
export type PublicProjectsQuery = z.infer<typeof PublicProjectsQuerySchema>;

/** Project card: no internal ids, costs or storage paths. */
export const PublicProjectCardSchema = z.object({
  slug: z.string(),
  name: z.string(),
  city: z.string(),
  locality: z.string().nullable(),
  project_type: ProjectTypeSchema,
  status: ProjectStatusSchema,
  rera_number: z.string().nullable(),
  possession_date: DateStringSchema.nullable(),
  starting_price_paise: PaiseSchema.nullable(),
  hero_image_url: z.string().nullable(),
  highlights: z.array(z.string()),
  bhk_options: z.array(z.number()),
  configurations: z.array(z.string()),
  construction_percent: z.number().nullable(),
  is_featured: z.boolean(),
});
export type PublicProjectCard = z.infer<typeof PublicProjectCardSchema>;

/** Availability grid: AVAILABLE vs NOT_AVAILABLE only; prices only when enabled. */
export const PublicAvailabilityCellSchema = z.object({
  flat_number: z.string(),
  position: z.int(),
  availability: PublicAvailabilitySchema,
  configuration: z.string(),
  facing: z.string().nullable(),
  price_paise: PaiseSchema.nullable(),
});
export type PublicAvailabilityCell = z.infer<typeof PublicAvailabilityCellSchema>;

export const PublicAvailabilityGridSchema = z.object({
  project_slug: z.string(),
  show_prices: z.boolean(),
  blocks: z.array(
    z.object({
      name: z.string(),
      positions: z.int().min(0),
      floors: z.array(z.object({ floor_label: z.string(), has_units: z.boolean(), cells: z.array(PublicAvailabilityCellSchema) })),
      available_count: z.int().min(0),
      total_count: z.int().min(0),
    }),
  ),
  generated_at: TimestampSchema,
});
export type PublicAvailabilityGrid = z.infer<typeof PublicAvailabilityGridSchema>;

export const PublicConfigurationSchema = z.object({
  name: z.string(),
  bhk: z.number(),
  facing: z.string().nullable(),
  description: z.string().nullable(),
  rooms: z.array(z.object({ label: z.string(), length_ft: z.number(), width_ft: z.number(), sqft: z.number() })),
  areas: z.array(z.object({ name: z.string(), code: z.string(), sqft: z.number() })),
  specifications: z.array(z.object({ category: z.string(), items: z.array(z.string()) })),
  floor_plan_url: z.string().nullable(),
  price_from_paise: PaiseSchema.nullable(),
  available_count: z.int().min(0).nullable(),
});
export type PublicConfiguration = z.infer<typeof PublicConfigurationSchema>;

export const PublicStageProgressSchema = z.object({
  name: z.string(),
  status: StageStatusSchema,
  completed_on: DateStringSchema.nullable(),
  photos: z.array(z.object({ thumb_url: z.string(), medium_url: z.string(), caption: z.string().nullable() })),
});
export type PublicStageProgress = z.infer<typeof PublicStageProgressSchema>;

/** Project detail page payload. */
export const PublicProjectDetailSchema = PublicProjectCardSchema.extend({
  description: z.string().nullable(),
  address: z.object({ line1: z.string(), locality: z.string().nullable(), city: z.string(), state: z.string(), pincode: z.string() }),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  landmarks: z.array(z.object({ name: z.string(), distance_km: z.number() })),
  approvals: z.array(z.object({ name: z.string(), number: z.string().nullable(), status: z.string() })),
  launch_date: DateStringSchema.nullable(),
  land_area_sqft: z.number().nullable(),
  amenities: z.array(z.object({ name: z.string(), category: z.string().nullable(), icon: z.string().nullable() })),
  hero_urls: z.array(z.string()),
  gallery: z.array(PublicGalleryItemSchema),
  configurations: z.array(PublicConfigurationSchema),
  show_prices: z.boolean(),
  show_availability: z.boolean(),
  show_progress: z.boolean(),
  /** Present only when show_availability is on. */
  availability: PublicAvailabilityGridSchema.nullable(),
  /** Present only when show_progress is on. */
  construction: z.object({ percent: z.number(), current_stage: z.string().nullable(), stages: z.array(PublicStageProgressSchema) }).nullable(),
  video_urls: z.array(z.string()),
  tour_urls: z.array(z.string()),
  map_embed_url: z.string().nullable(),
  brochure_available: z.boolean(),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })),
  visit_booking_enabled: z.boolean(),
  blocks: z.array(z.object({ name: z.string(), type: z.string(), floors: z.int(), total_units: z.int(), available_units: z.int().nullable() })),
  seo: z.object({ title: z.string().nullable(), description: z.string().nullable(), og_image_url: z.string().nullable() }),
});
export type PublicProjectDetail = z.infer<typeof PublicProjectDetailSchema>;

/** `GET /public/media/:id?variant=` selector. */
export const PublicMediaQuerySchema = z.object({ variant: z.enum(["thumb", "medium"]).optional() });
export type PublicMediaQuery = z.infer<typeof PublicMediaQuerySchema>;

// ---------------------------------------------------------------------------
// Enquiry
// ---------------------------------------------------------------------------

/** Website enquiry; `website` is the honeypot and must be empty. */
export const PublicEnquiryInputSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  phone: PhoneSchema,
  email: EmailSchema.optional().nullable(),
  project_slug: SlugSchema.optional().nullable(),
  flat_type_code: z.string().trim().max(30).optional().nullable(),
  message: z.string().trim().max(1000).optional().nullable(),
  consent: ConsentSchema,
  website: HoneypotSchema,
  source_page: z.string().trim().max(300).optional().nullable(),
  utm: UtmSchema.optional().nullable(),
});
export type PublicEnquiryInput = z.infer<typeof PublicEnquiryInputSchema>;

export const PublicEnquiryResponseSchema = z.object({ reference_number: z.string(), message: z.string() });
export type PublicEnquiryResponse = z.infer<typeof PublicEnquiryResponseSchema>;

// ---------------------------------------------------------------------------
// Brochure lead gate
// ---------------------------------------------------------------------------

export const PublicBrochureRequestSchema = z.strictObject({
  project_slug: SlugSchema,
  name: z.string().trim().min(2).max(120),
  phone: PhoneSchema,
  email: EmailSchema.optional().nullable(),
  consent: ConsentSchema,
  website: HoneypotSchema,
  visitor_token: z.string().max(200).optional().nullable(),
  utm: UtmSchema.optional().nullable(),
  source_page: z.string().trim().max(300).optional().nullable(),
});
export type PublicBrochureRequest = z.infer<typeof PublicBrochureRequestSchema>;

/** Signed, short-lived (15 min) download link plus a visitor token the device remembers. */
export const PublicBrochureResponseSchema = z.object({
  download_url: UrlSchema,
  expires_at: TimestampSchema,
  visitor_token: z.string(),
  file_name: z.string(),
});
export type PublicBrochureResponse = z.infer<typeof PublicBrochureResponseSchema>;

/** Returning visitor: re-issue a link using the remembered token (still logs the activity). */
export const PublicBrochureRepeatRequestSchema = z.strictObject({ project_slug: SlugSchema, visitor_token: z.string().min(16).max(200), website: HoneypotSchema });
export type PublicBrochureRepeatRequest = z.infer<typeof PublicBrochureRepeatRequestSchema>;

/** Brochure link lifetime in minutes. */
export const BROCHURE_LINK_MINUTES = 15;

// ---------------------------------------------------------------------------
// Site visits
// ---------------------------------------------------------------------------

export const PublicVisitAvailabilityQuerySchema = z
  .object({ from: DateStringSchema.optional(), to: DateStringSchema.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be ≤ to", path: ["to"] });
export type PublicVisitAvailabilityQuery = z.infer<typeof PublicVisitAvailabilityQuerySchema>;

export const PublicVisitSlotSchema = z.object({ start: TimeStringSchema, end: TimeStringSchema, available: z.int().min(1) });
export type PublicVisitSlot = z.infer<typeof PublicVisitSlotSchema>;

export const PublicVisitAvailabilityResponseSchema = z.object({
  project_slug: z.string(),
  timezone: z.literal("Asia/Kolkata"),
  slot_minutes: z.int(),
  days: z.array(z.object({ date: DateStringSchema, slots: z.array(PublicVisitSlotSchema) })),
  site_office_address: z.string().nullable(),
  instructions: z.string().nullable(),
});
export type PublicVisitAvailabilityResponse = z.infer<typeof PublicVisitAvailabilityResponseSchema>;

export const PublicVisitBookingInputSchema = z.strictObject({
  project_slug: SlugSchema,
  visit_date: DateStringSchema,
  slot_start: TimeStringSchema,
  name: z.string().trim().min(2).max(120),
  phone: PhoneSchema,
  email: EmailSchema.optional().nullable(),
  visitors: z.int().min(1).max(6).default(1),
  message: z.string().trim().max(500).optional().nullable(),
  consent: ConsentSchema,
  website: HoneypotSchema,
  utm: UtmSchema.optional().nullable(),
});
export type PublicVisitBookingInput = z.infer<typeof PublicVisitBookingInputSchema>;

export const PublicVisitBookingResponseSchema = z.object({
  visit_number: z.string(),
  project_name: z.string(),
  visit_date: DateStringSchema,
  slot_start: TimeStringSchema,
  slot_end: TimeStringSchema,
  visitors: z.int(),
  site_office_address: z.string().nullable(),
  maps_link: z.string().nullable(),
  instructions: z.string().nullable(),
  ics_url: UrlSchema,
  manage_url: UrlSchema,
});
export type PublicVisitBookingResponse = z.infer<typeof PublicVisitBookingResponseSchema>;

/** Signed manage-link view of a visit (no login). */
export const PublicVisitManageResponseSchema = z.object({
  visit_number: z.string(),
  status: VisitStatusSchema,
  project_name: z.string(),
  project_slug: z.string(),
  visit_date: DateStringSchema,
  slot_start: TimeStringSchema,
  slot_end: TimeStringSchema,
  visitors: z.int(),
  name: z.string(),
  site_office_address: z.string().nullable(),
  maps_link: z.string().nullable(),
  instructions: z.string().nullable(),
  can_cancel: z.boolean(),
  ics_url: UrlSchema,
});
export type PublicVisitManageResponse = z.infer<typeof PublicVisitManageResponseSchema>;

export const PublicVisitCancelInputSchema = z.strictObject({ reason: z.string().trim().max(300).optional().nullable(), website: HoneypotSchema });
export type PublicVisitCancelInput = z.infer<typeof PublicVisitCancelInputSchema>;

export const PublicVisitCancelResponseSchema = z.object({ visit_number: z.string(), status: VisitStatusSchema });
export type PublicVisitCancelResponse = z.infer<typeof PublicVisitCancelResponseSchema>;

// ---------------------------------------------------------------------------
// Home / sitemap
// ---------------------------------------------------------------------------

export const PublicHomeResponseSchema = z.object({
  banners: z.array(PublicBannerSchema),
  featured_projects: z.array(PublicProjectCardSchema),
  sections: z.array(z.object({ key: z.string(), title: z.string().nullable(), body: z.record(z.string(), z.unknown()) })),
  testimonials: z.array(PublicTestimonialSchema),
  latest_posts: z.array(PublicPostCardSchema),
  trust_stats: z.array(z.object({ label: z.string(), value: z.string() })),
  walkthrough_video_url: z.string().nullable(),
});
export type PublicHomeResponse = z.infer<typeof PublicHomeResponseSchema>;

/** `GET /public/site`: allow-listed settings plus the home-page content (Appendix B). */
export const PublicSiteResponseSchema = PublicSiteSettingsSchema.extend({
  banners: z.array(PublicBannerSchema),
  featured_projects: z.array(PublicProjectCardSchema),
  home_sections: z.array(z.object({ key: z.string(), title: z.string().nullable(), body: z.record(z.string(), z.unknown()) })),
  testimonials: z.array(PublicTestimonialSchema),
  latest_posts: z.array(PublicPostCardSchema),
});
export type PublicSiteResponse = z.infer<typeof PublicSiteResponseSchema>;

export const PublicSitemapEntrySchema = z.object({ path: z.string(), updated_at: TimestampSchema, priority: z.number().min(0).max(1) });
export type PublicSitemapEntry = z.infer<typeof PublicSitemapEntrySchema>;
export const PublicSitemapResponseSchema = z.object({ entries: z.array(PublicSitemapEntrySchema) });
export type PublicSitemapResponse = z.infer<typeof PublicSitemapResponseSchema>;
