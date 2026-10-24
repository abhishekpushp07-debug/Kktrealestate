/**
 * Public website API types — mirror of docs/API-CONVENTIONS.md Appendix B.
 *
 * These are intentionally local for now and will be replaced by `@kkt/contracts` once the
 * public module's Zod schemas land. Fields the API may omit are optional/nullable so the UI
 * degrades gracefully rather than crashing on partial payloads.
 */

export type ProjectStatus = "PLANNING" | "UNDER_CONSTRUCTION" | "READY" | "COMPLETED";
export type ProjectType = "RESIDENTIAL" | "COMMERCIAL" | "MIXED";
export type StageStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";
export type AvailabilityCellStatus = "AVAILABLE" | "NOT_AVAILABLE";
export type VisitStatus = "CONFIRMED" | "RESCHEDULED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";

export interface PublicImage {
  /** Absolute or API-relative URL (e.g. /api/v1/public/media/:id). */
  url: string;
  alt?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
}

// ---------------------------------------------------------------------------
// GET /public/site
// ---------------------------------------------------------------------------

export interface SiteBrand {
  name: string;
  tagline?: string | null;
  logo_url?: string | null;
  favicon_url?: string | null;
}

export interface SiteContacts {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
}

export interface SiteOffice {
  name: string;
  address: string;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  maps_link?: string | null;
  hours?: string | null;
}

export interface SiteSocial {
  facebook?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  youtube?: string | null;
  x?: string | null;
  twitter?: string | null;
}

export interface TrustStat {
  label: string;
  value: string;
}

export interface ValueProp {
  title: string;
  body?: string | null;
  icon?: string | null;
}

export interface SeoDefaults {
  title?: string | null;
  description?: string | null;
  og_image_url?: string | null;
  keywords?: string[] | null;
}

export interface SiteAnalytics {
  ga_id?: string | null;
}

export interface Banner {
  title: string;
  subtitle?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  image_url: string;
}

export interface HomeSection {
  key: string;
  title?: string | null;
  body?: Record<string, unknown> | string | null;
}

export interface Testimonial {
  name: string;
  quote: string;
  rating?: number | null;
  project_name?: string | null;
  photo_url?: string | null;
}

export interface ProjectCard {
  slug: string;
  name: string;
  city: string;
  status: ProjectStatus;
  type: ProjectType;
  starting_price_paise: number | null;
  hero_image_url: string | null;
  bhk_options: number[];
  possession_date: string | null;
  rera_number: string | null;
  locality?: string | null;
  tagline?: string | null;
}

export interface PostCard {
  slug: string;
  title: string;
  excerpt?: string | null;
  cover_image_url?: string | null;
  published_at: string | null;
  tags?: string[] | null;
  author_name?: string | null;
  reading_minutes?: number | null;
}

export interface SiteSettings {
  brand: SiteBrand;
  contacts: SiteContacts;
  offices: SiteOffice[];
  social: SiteSocial;
  trust_stats: TrustStat[];
  value_props: ValueProp[];
  disclaimer: string | null;
  seo_defaults: SeoDefaults;
  analytics: SiteAnalytics;
  site_live: boolean;
  coming_soon_message: string | null;
  portal_url: string | null;
  featured_projects: ProjectCard[];
  walkthrough_video_url: string | null;
  banners: Banner[];
  home_sections: HomeSection[];
  testimonials: Testimonial[];
  latest_posts: PostCard[];
}

// ---------------------------------------------------------------------------
// GET /public/projects/:slug
// ---------------------------------------------------------------------------

export interface ProjectAddress {
  line1?: string | null;
  line2?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export interface KeyFacts {
  project_type: ProjectType;
  status: ProjectStatus;
  rera_number: string | null;
  launch_date: string | null;
  possession_date: string | null;
  land_area_sqft: number | null;
  total_units: number | null;
  block_count: number | null;
  floors?: string | null;
  address: ProjectAddress;
}

export interface Approval {
  name: string;
  number?: string | null;
  issued_on?: string | null;
  status?: string | null;
}

export interface Amenity {
  name: string;
  category?: string | null;
  icon?: string | null;
}

export interface RoomSize {
  label: string;
  room_type_name?: string | null;
  length_ft: number | null;
  width_ft: number | null;
  sqft: number | null;
}

export interface AreaSize {
  area_type_code: string;
  area_type_name: string;
  sqft: number;
}

export interface SpecGroup {
  category: string;
  items: string[];
}

export interface Configuration {
  code: string;
  name: string;
  bhk: number | null;
  facing?: string | null;
  description?: string | null;
  rooms: RoomSize[];
  areas: AreaSize[];
  carpet_sqft: number | null;
  builtup_sqft: number | null;
  super_builtup_sqft: number | null;
  specifications: SpecGroup[];
  floor_plan_image_url?: string | null;
  /** Present only when the project has show_prices enabled. */
  price_paise?: number | null;
  available_count?: number | null;
}

export interface AvailabilityCell {
  flat_number: string;
  status: AvailabilityCellStatus;
  flat_type_code?: string | null;
}

export interface AvailabilityFloor {
  label: string;
  cells: AvailabilityCell[];
}

export interface AvailabilityBlock {
  name: string;
  floors: AvailabilityFloor[];
}

export interface AvailabilityGrid {
  blocks: AvailabilityBlock[];
  available_count?: number | null;
  total_count?: number | null;
}

export interface StagePhoto extends PublicImage {
  taken_on?: string | null;
}

export interface ProgressStage {
  name: string;
  status: StageStatus;
  started_on?: string | null;
  completed_on?: string | null;
  photos: StagePhoto[];
}

export interface ProgressBlock {
  name: string;
  percent: number;
  status?: ProjectStatus | null;
  stages: ProgressStage[];
}

export interface ConstructionProgress {
  blocks: ProgressBlock[];
}

export interface Landmark {
  name: string;
  distance_km: number | null;
  category?: string | null;
}

export interface Faq {
  q: string;
  a: string;
}

export interface ProjectSeo {
  title?: string | null;
  description?: string | null;
  og_image_url?: string | null;
}

export interface ProjectDetail {
  slug: string;
  name: string;
  tagline?: string | null;
  city: string;
  status: ProjectStatus;
  type: ProjectType;
  starting_price_paise: number | null;
  show_prices: boolean;
  hero_images: PublicImage[];
  gallery?: PublicImage[] | null;
  overview: string;
  highlights: string[];
  key_facts: KeyFacts;
  approvals: Approval[];
  amenities: Amenity[];
  configurations: Configuration[];
  availability: AvailabilityGrid | null;
  construction_progress: ConstructionProgress | null;
  videos: string[];
  tours: string[];
  map_embed_url: string | null;
  latitude?: number | null;
  longitude?: number | null;
  landmarks: Landmark[];
  faqs: Faq[];
  seo: ProjectSeo;
  brochure_available: boolean;
  visit_booking_enabled: boolean;
  bhk_options?: number[] | null;
  possession_date?: string | null;
  rera_number?: string | null;
}

// ---------------------------------------------------------------------------
// Visit availability / booking / manage
// ---------------------------------------------------------------------------

export interface VisitSlot {
  /** HH:MM (IST) */
  start: string;
  end: string;
  available: number;
}

export interface VisitDay {
  /** YYYY-MM-DD */
  date: string;
  slots: VisitSlot[];
}

export interface SiteVisitRequest {
  project_slug: string;
  date: string;
  start: string;
  name: string;
  phone: string;
  email?: string;
  visitors: number;
  message?: string;
  consent: true;
  website: "";
}

export interface SiteVisitResult {
  visit_number: string;
  date: string;
  start: string;
  end: string;
  address: string | null;
  maps_link: string | null;
  instructions: string | null;
  ics_url: string;
  manage_url: string;
  project_name?: string | null;
}

export interface SiteVisitManage {
  visit_number: string;
  status: VisitStatus;
  date: string;
  start: string;
  end: string;
  project_name: string;
  project_slug?: string | null;
  address: string | null;
  maps_link: string | null;
  instructions: string | null;
  visitors?: number | null;
  name?: string | null;
  ics_url?: string | null;
  can_cancel?: boolean | null;
}

// ---------------------------------------------------------------------------
// Enquiries & brochure gate
// ---------------------------------------------------------------------------

export interface UtmParams {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface EnquiryRequest {
  name: string;
  phone: string;
  email?: string;
  project_slug?: string;
  flat_type_code?: string;
  message?: string;
  consent: true;
  website: "";
  utm?: UtmParams;
}

export interface EnquiryResult {
  reference_number: string;
}

export interface BrochureRequest {
  project_slug: string;
  name: string;
  phone: string;
  email?: string;
  consent: true;
  website: "";
  visitor_token?: string;
}

export interface BrochureResult {
  download_url: string;
  expires_at: string;
  visitor_token: string;
}

// ---------------------------------------------------------------------------
// Blog, pages, gallery, people
// ---------------------------------------------------------------------------

export interface ListEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  next_cursor: string | null;
}

export interface PostSeo {
  title?: string | null;
  description?: string | null;
  og_image_url?: string | null;
}

export interface PostDetail extends PostCard {
  body_md: string;
  seo?: PostSeo | null;
  updated_at?: string | null;
}

export interface PageDetail {
  slug: string;
  title: string;
  body_md: string;
  seo?: PostSeo | null;
  updated_at?: string | null;
}

export interface GalleryItem extends PublicImage {
  project_slug?: string | null;
  project_name?: string | null;
  category?: string | null;
}

export interface GalleryResponse {
  items: GalleryItem[];
  projects?: Array<{ slug: string; name: string }> | null;
}

export interface Person {
  name: string;
  title: string;
  bio?: string | null;
  photo_url?: string | null;
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

export type ProjectListFilters = {
  city?: string;
  status?: string;
  bhk?: string;
  q?: string;
};
