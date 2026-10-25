import { z } from "zod";
import { PostStatusSchema } from "../enums.js";
import {
  AuditedRowSchema,
  BoolQuerySchema,
  EmailSchema,
  IdSchema,
  ListQuerySchema,
  MarkdownSchema,
  NameSchema,
  PaiseSchema,
  PhoneSchema,
  SlugSchema,
  TextSchema,
  TimestampSchema,
  UrlSchema,
  VersionSchema,
  VersionedSchema,
  listEnvelope,
  updateOf,
} from "../common.js";

/** SEO fields for a page/post/project. */
export const SeoSchema = z.strictObject({
  title: z.string().trim().max(70).optional().nullable(),
  description: z.string().trim().max(160).optional().nullable(),
  og_image_document_id: IdSchema.optional().nullable(),
  noindex: z.boolean().default(false),
});
export type Seo = z.infer<typeof SeoSchema>;

/** One FAQ. */
export const FaqSchema = z.strictObject({ q: z.string().trim().min(3).max(200), a: z.string().trim().min(1).max(2000) });
export type Faq = z.infer<typeof FaqSchema>;

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------

const OfficeSchema = z.strictObject({
  name: NameSchema,
  address: z.string().trim().min(1).max(300),
  phone: PhoneSchema.optional().nullable(),
  maps_link: UrlSchema.optional().nullable(),
});

const SiteSettingsBase = z.strictObject({
  brand: z.strictObject({
    name: NameSchema,
    tagline: z.string().trim().max(160).optional().nullable(),
    logo_document_id: IdSchema.optional().nullable(),
    favicon_document_id: IdSchema.optional().nullable(),
  }),
  contacts: z.strictObject({
    phone: PhoneSchema.optional().nullable(),
    whatsapp: PhoneSchema.optional().nullable(),
    email: EmailSchema.optional().nullable(),
  }),
  offices: z.array(OfficeSchema).max(20).default([]),
  social: z.partialRecord(z.enum(["facebook", "instagram", "youtube", "linkedin", "x", "whatsapp"]), UrlSchema).default({}),
  trust_stats: z.array(z.strictObject({ label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(30) })).max(8).default([]),
  value_props: z
    .array(z.strictObject({ title: z.string().trim().min(1).max(80), body: z.string().trim().max(300), icon: z.string().trim().max(40).optional().nullable() }))
    .max(8)
    .default([]),
  disclaimer: TextSchema.optional().nullable(),
  seo_defaults: SeoSchema.optional().nullable(),
  analytics: z.strictObject({ ga_id: z.string().trim().max(40).optional().nullable() }).default({}),
  site_live: z.boolean().default(true),
  coming_soon_message: z.string().trim().max(300).optional().nullable(),
  portal_url: UrlSchema.optional().nullable(),
  erp_url: UrlSchema.optional().nullable(),
  featured_project_ids: z.array(IdSchema).max(12).default([]),
  walkthrough_video_url: UrlSchema.optional().nullable(),
});

/** Update site settings (partial + version). `round_robin_enabled` is mirrored to the company settings. */
export const SiteSettingsUpdateSchema = updateOf(SiteSettingsBase).extend({ round_robin_enabled: z.boolean().optional() });
export type SiteSettingsUpdate = z.infer<typeof SiteSettingsUpdateSchema>;

/** Site settings row. */
export const SiteSettingsRowSchema = SiteSettingsBase.extend({
  company_id: IdSchema,
  round_robin_enabled: z.boolean(),
  updated_at: TimestampSchema,
  version: VersionSchema,
});
export type SiteSettingsRow = z.infer<typeof SiteSettingsRowSchema>;

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

const BannerBase = z.strictObject({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(200).optional().nullable(),
  cta_label: z.string().trim().max(40).optional().nullable(),
  cta_url: z.string().trim().max(500).optional().nullable(),
  document_id: IdSchema,
  sort_order: z.int().min(0).max(1000).default(0),
  starts_at: TimestampSchema.optional().nullable(),
  ends_at: TimestampSchema.optional().nullable(),
  is_active: z.boolean().default(true),
});
export const CmsBannerCreateSchema = BannerBase.refine((b) => !b.starts_at || !b.ends_at || b.starts_at <= b.ends_at, {
  message: "ends_at must be after starts_at",
  path: ["ends_at"],
});
export type CmsBannerCreate = z.infer<typeof CmsBannerCreateSchema>;
export const CmsBannerUpdateSchema = updateOf(BannerBase);
export type CmsBannerUpdate = z.infer<typeof CmsBannerUpdateSchema>;
export const CmsBannerRowSchema = AuditedRowSchema.extend({
  title: z.string(),
  subtitle: z.string().nullable(),
  cta_label: z.string().nullable(),
  cta_url: z.string().nullable(),
  document_id: IdSchema,
  image_url: z.string().nullable(),
  sort_order: z.int(),
  starts_at: TimestampSchema.nullable(),
  ends_at: TimestampSchema.nullable(),
  is_active: z.boolean(),
});
export type CmsBannerRow = z.infer<typeof CmsBannerRowSchema>;

// ---------------------------------------------------------------------------
// Home sections
// ---------------------------------------------------------------------------

const HomeSectionBase = z.strictObject({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/),
  title: z.string().trim().max(120).optional().nullable(),
  body: z.record(z.string(), z.unknown()).default({}),
  sort_order: z.int().min(0).max(1000).default(0),
  is_active: z.boolean().default(true),
});
export const CmsHomeSectionCreateSchema = HomeSectionBase;
export type CmsHomeSectionCreate = z.infer<typeof CmsHomeSectionCreateSchema>;
export const CmsHomeSectionUpdateSchema = updateOf(HomeSectionBase);
export type CmsHomeSectionUpdate = z.infer<typeof CmsHomeSectionUpdateSchema>;
export const CmsHomeSectionRowSchema = AuditedRowSchema.extend({
  key: z.string(),
  title: z.string().nullable(),
  body: z.record(z.string(), z.unknown()),
  sort_order: z.int(),
  is_active: z.boolean(),
});
export type CmsHomeSectionRow = z.infer<typeof CmsHomeSectionRowSchema>;

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

const TestimonialBase = z.strictObject({
  customer_id: IdSchema.optional().nullable(),
  name: NameSchema,
  project_id: IdSchema.optional().nullable(),
  quote: z.string().trim().min(10).max(1000),
  rating: z.int().min(1).max(5).optional().nullable(),
  photo_document_id: IdSchema.optional().nullable(),
  is_published: z.boolean().default(false),
  sort_order: z.int().min(0).max(1000).default(0),
});
export const CmsTestimonialCreateSchema = TestimonialBase;
export type CmsTestimonialCreate = z.infer<typeof CmsTestimonialCreateSchema>;
export const CmsTestimonialUpdateSchema = updateOf(TestimonialBase);
export type CmsTestimonialUpdate = z.infer<typeof CmsTestimonialUpdateSchema>;
export const CmsTestimonialRowSchema = AuditedRowSchema.extend({
  customer_id: IdSchema.nullable(),
  name: z.string(),
  project_id: IdSchema.nullable(),
  project_name: z.string().nullable(),
  quote: z.string(),
  rating: z.int().nullable(),
  photo_document_id: IdSchema.nullable(),
  photo_url: z.string().nullable(),
  is_published: z.boolean(),
  sort_order: z.int(),
});
export type CmsTestimonialRow = z.infer<typeof CmsTestimonialRowSchema>;

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

const GalleryBase = z.strictObject({
  project_id: IdSchema.optional().nullable(),
  document_id: IdSchema,
  caption: z.string().trim().max(200).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  sort_order: z.int().min(0).max(10_000).default(0),
  is_published: z.boolean().default(true),
});
export const CmsGalleryCreateSchema = GalleryBase;
export type CmsGalleryCreate = z.infer<typeof CmsGalleryCreateSchema>;
export const CmsGalleryUpdateSchema = updateOf(GalleryBase.omit({ document_id: true }));
export type CmsGalleryUpdate = z.infer<typeof CmsGalleryUpdateSchema>;
export const CmsGalleryRowSchema = AuditedRowSchema.extend({
  project_id: IdSchema.nullable(),
  project_name: z.string().nullable(),
  document_id: IdSchema,
  thumb_url: z.string().nullable(),
  medium_url: z.string().nullable(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  caption: z.string().nullable(),
  category: z.string().nullable(),
  sort_order: z.int(),
  is_published: z.boolean(),
});
export type CmsGalleryRow = z.infer<typeof CmsGalleryRowSchema>;
export const CmsGalleryFilterSchema = ListQuerySchema.extend({ project_id: IdSchema.optional(), category: z.string().max(60).optional(), is_published: BoolQuerySchema.optional() });
export type CmsGalleryFilter = z.infer<typeof CmsGalleryFilterSchema>;

// ---------------------------------------------------------------------------
// Blog posts
// ---------------------------------------------------------------------------

const PostBase = z.strictObject({
  title: z.string().trim().min(3).max(160),
  slug: SlugSchema,
  excerpt: z.string().trim().max(300).optional().nullable(),
  body_md: MarkdownSchema,
  cover_document_id: IdSchema.optional().nullable(),
  status: PostStatusSchema.default("DRAFT"),
  published_at: TimestampSchema.optional().nullable(),
  seo: SeoSchema.optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
export const CmsPostCreateSchema = PostBase;
export type CmsPostCreate = z.infer<typeof CmsPostCreateSchema>;
export const CmsPostUpdateSchema = updateOf(PostBase);
export type CmsPostUpdate = z.infer<typeof CmsPostUpdateSchema>;
export const CmsPostRowSchema = AuditedRowSchema.extend({
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  body_md: z.string(),
  cover_document_id: IdSchema.nullable(),
  cover_url: z.string().nullable(),
  status: PostStatusSchema,
  published_at: TimestampSchema.nullable(),
  seo: SeoSchema.nullable(),
  author_user_id: IdSchema.nullable(),
  author_name: z.string().nullable(),
  tags: z.array(z.string()),
});
export type CmsPostRow = z.infer<typeof CmsPostRowSchema>;
export const CmsPostFilterSchema = ListQuerySchema.extend({ status: PostStatusSchema.optional(), tag: z.string().max(30).optional() });
export type CmsPostFilter = z.infer<typeof CmsPostFilterSchema>;
export const CmsPostListResponseSchema = listEnvelope(CmsPostRowSchema);
export type CmsPostListResponse = z.infer<typeof CmsPostListResponseSchema>;

// ---------------------------------------------------------------------------
// Legal / static pages
// ---------------------------------------------------------------------------

const PageBase = z.strictObject({
  slug: SlugSchema,
  title: z.string().trim().min(1).max(160),
  body_md: MarkdownSchema,
  is_published: z.boolean().default(false),
  seo: SeoSchema.optional().nullable(),
});
export const CmsPageCreateSchema = PageBase;
export type CmsPageCreate = z.infer<typeof CmsPageCreateSchema>;
export const CmsPageUpdateSchema = updateOf(PageBase);
export type CmsPageUpdate = z.infer<typeof CmsPageUpdateSchema>;
export const CmsPageRowSchema = AuditedRowSchema.extend({
  slug: z.string(),
  title: z.string(),
  body_md: z.string(),
  is_published: z.boolean(),
  seo: SeoSchema.nullable(),
});
export type CmsPageRow = z.infer<typeof CmsPageRowSchema>;

// ---------------------------------------------------------------------------
// People (leadership)
// ---------------------------------------------------------------------------

const PersonBase = z.strictObject({
  name: NameSchema,
  title: z.string().trim().min(1).max(120),
  bio: TextSchema.optional().nullable(),
  photo_document_id: IdSchema.optional().nullable(),
  sort_order: z.int().min(0).max(1000).default(0),
  is_published: z.boolean().default(true),
});
export const CmsPersonCreateSchema = PersonBase;
export type CmsPersonCreate = z.infer<typeof CmsPersonCreateSchema>;
export const CmsPersonUpdateSchema = updateOf(PersonBase);
export type CmsPersonUpdate = z.infer<typeof CmsPersonUpdateSchema>;
export const CmsPersonRowSchema = AuditedRowSchema.extend({
  name: z.string(),
  title: z.string(),
  bio: z.string().nullable(),
  photo_document_id: IdSchema.nullable(),
  photo_url: z.string().nullable(),
  sort_order: z.int(),
  is_published: z.boolean(),
});
export type CmsPersonRow = z.infer<typeof CmsPersonRowSchema>;

// ---------------------------------------------------------------------------
// Notices (for buyers)
// ---------------------------------------------------------------------------

const NoticeBase = z.strictObject({
  project_id: IdSchema.optional().nullable(),
  title: z.string().trim().min(3).max(160),
  body_md: MarkdownSchema,
  publish_at: TimestampSchema.optional().nullable(),
  expires_at: TimestampSchema.optional().nullable(),
  is_published: z.boolean().default(false),
});
export const NoticeCreateSchema = NoticeBase.refine((n) => !n.publish_at || !n.expires_at || n.publish_at <= n.expires_at, {
  message: "expires_at must be after publish_at",
  path: ["expires_at"],
});
export type NoticeCreate = z.infer<typeof NoticeCreateSchema>;
/** Partial update: `is_published` is only applied when sent (the create default of `false` must not unpublish on every PATCH). */
export const NoticeUpdateSchema = updateOf(NoticeBase).extend({ is_published: z.boolean().optional() });
export type NoticeUpdate = z.infer<typeof NoticeUpdateSchema>;
export const NoticeRowSchema = AuditedRowSchema.extend({
  project_id: IdSchema.nullable(),
  project_name: z.string().nullable(),
  title: z.string(),
  body_md: z.string(),
  publish_at: TimestampSchema.nullable(),
  expires_at: TimestampSchema.nullable(),
  is_published: z.boolean(),
  created_by_name: z.string().nullable(),
});
export type NoticeRow = z.infer<typeof NoticeRowSchema>;
export const NoticeFilterSchema = ListQuerySchema.extend({ project_id: IdSchema.optional(), is_published: BoolQuerySchema.optional() });
export type NoticeFilter = z.infer<typeof NoticeFilterSchema>;
export const NoticeListResponseSchema = listEnvelope(NoticeRowSchema);
export type NoticeListResponse = z.infer<typeof NoticeListResponseSchema>;

// ---------------------------------------------------------------------------
// Project website settings
// ---------------------------------------------------------------------------

const ProjectWebsiteSettingsBase = z.strictObject({
  slug: SlugSchema,
  is_published: z.boolean().default(false),
  show_prices: z.boolean().default(false),
  show_availability: z.boolean().default(true),
  show_progress: z.boolean().default(true),
  starting_price_override_paise: PaiseSchema.optional().nullable(),
  hero_document_ids: z.array(IdSchema).max(12).default([]),
  highlights: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  video_urls: z.array(UrlSchema).max(6).default([]),
  tour_urls: z.array(UrlSchema).max(6).default([]),
  map_embed_url: UrlSchema.optional().nullable(),
  brochure_document_id: IdSchema.optional().nullable(),
  faqs: z.array(FaqSchema).max(30).default([]),
  seo: SeoSchema.optional().nullable(),
});

/** Update a project's website settings (partial + version). Publishing requires hero, description and location (BUSINESS_RULE otherwise). */
export const ProjectWebsiteSettingsUpdateSchema = updateOf(ProjectWebsiteSettingsBase);
export type ProjectWebsiteSettingsUpdate = z.infer<typeof ProjectWebsiteSettingsUpdateSchema>;

/** Publish / unpublish toggle. */
export const ProjectWebsitePublishSchema = z.strictObject({ ...VersionedSchema.shape, is_published: z.boolean() });
export type ProjectWebsitePublish = z.infer<typeof ProjectWebsitePublishSchema>;

export const ProjectWebsiteSettingsRowSchema = ProjectWebsiteSettingsBase.extend({
  project_id: IdSchema,
  project_name: z.string(),
  hero_urls: z.array(z.string()),
  brochure_file_name: z.string().nullable(),
  brochure_download_count: z.int().min(0),
  brochure_downloads_30d: z.array(z.object({ date: z.string(), count: z.int().min(0) })),
  published_at: TimestampSchema.nullable(),
  can_publish: z.boolean(),
  publish_blockers: z.array(z.string()),
  updated_at: TimestampSchema,
  version: VersionSchema,
});
export type ProjectWebsiteSettingsRow = z.infer<typeof ProjectWebsiteSettingsRowSchema>;

/** `GET /projects/:id/brochure-stats`: counts plus a 30-day daily sparkline (IST dates, zero-filled). */
export const BrochureStatsResponseSchema = z.object({
  project_id: IdSchema,
  download_count: z.int().min(0),
  requests_count: z.int().min(0),
  downloads_30d: z.int().min(0),
  last_download_at: TimestampSchema.nullable(),
  sparkline: z.array(z.object({ date: z.string(), count: z.int().min(0) })),
});
export type BrochureStatsResponse = z.infer<typeof BrochureStatsResponseSchema>;

/** Generic CMS list filter with a published flag. */
export const CmsListFilterSchema = ListQuerySchema.extend({ is_published: BoolQuerySchema.optional() });
export type CmsListFilter = z.infer<typeof CmsListFilterSchema>;
