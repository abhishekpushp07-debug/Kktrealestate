// G (part). Website CMS
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { idColumn, mutable } from "./_common.js";
import { customers } from "./customers.js";
import { postStatusEnum } from "./enums.js";
import { companies, users } from "./identity.js";
import { projects } from "./inventory.js";
import type { Analytics, Brand, Contacts, JsonObject, Seo, TrustStat } from "./json.js";

const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

export const siteSettings = pgTable("site_settings", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id),
  brand: jsonb("brand").$type<Brand>().notNull().default({ name: "" }),
  contacts: jsonb("contacts").$type<Contacts>().notNull().default({}),
  offices: jsonb("offices").$type<JsonObject[]>().notNull().default([]),
  social: jsonb("social").$type<Record<string, string>>().notNull().default({}),
  trustStats: jsonb("trust_stats").$type<TrustStat[]>().notNull().default([]),
  valueProps: jsonb("value_props").$type<JsonObject[]>().notNull().default([]),
  disclaimer: text("disclaimer"),
  seoDefaults: jsonb("seo_defaults").$type<Seo>().notNull().default({}),
  analytics: jsonb("analytics").$type<Analytics>().notNull().default({}),
  siteLive: boolean("site_live").notNull().default(true),
  comingSoonMessage: text("coming_soon_message"),
  portalUrl: text("portal_url"),
  erpUrl: text("erp_url"),
  featuredProjectIds: uuid("featured_project_ids").array().notNull().default(sql`'{}'::uuid[]`),
  walkthroughVideoUrl: text("walkthrough_video_url"),
  ...mutable(),
});

export const cmsBanners = pgTable(
  "cms_banners",
  {
    id: idColumn(),
    companyId: companyId(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
    documentId: uuid("document_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [index("cms_banners_company_active_idx").on(t.companyId, t.isActive, t.sortOrder)],
);

export const cmsHomeSections = pgTable(
  "cms_home_sections",
  {
    id: idColumn(),
    companyId: companyId(),
    key: text("key").notNull(),
    title: text("title"),
    body: jsonb("body").$type<JsonObject>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [unique("cms_home_sections_company_key_uq").on(t.companyId, t.key)],
);

export const cmsTestimonials = pgTable(
  "cms_testimonials",
  {
    id: idColumn(),
    companyId: companyId(),
    customerId: uuid("customer_id").references(() => customers.id),
    name: text("name").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    quote: text("quote").notNull(),
    rating: integer("rating"),
    photoDocumentId: uuid("photo_document_id"),
    isPublished: boolean("is_published").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...mutable(),
  },
  (t) => [index("cms_testimonials_company_published_idx").on(t.companyId, t.isPublished, t.sortOrder)],
);

export const cmsGallery = pgTable(
  "cms_gallery",
  {
    id: idColumn(),
    companyId: companyId(),
    projectId: uuid("project_id").references(() => projects.id),
    documentId: uuid("document_id").notNull(),
    caption: text("caption"),
    category: text("category"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(false),
    ...mutable(),
  },
  (t) => [index("cms_gallery_company_project_published_idx").on(t.companyId, t.projectId, t.isPublished, t.sortOrder)],
);

export const cmsPosts = pgTable(
  "cms_posts",
  {
    id: idColumn(),
    companyId: companyId(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    excerpt: text("excerpt"),
    bodyMd: text("body_md").notNull().default(""),
    coverDocumentId: uuid("cover_document_id"),
    status: postStatusEnum("status").notNull().default("DRAFT"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    seo: jsonb("seo").$type<Seo>().notNull().default({}),
    authorUserId: uuid("author_user_id").references(() => users.id),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    ...mutable(),
  },
  (t) => [unique("cms_posts_company_slug_uq").on(t.companyId, t.slug), index("cms_posts_company_status_published_idx").on(t.companyId, t.status, t.publishedAt.desc())],
);

export const cmsPages = pgTable(
  "cms_pages",
  {
    id: idColumn(),
    companyId: companyId(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    isPublished: boolean("is_published").notNull().default(false),
    seo: jsonb("seo").$type<Seo>().notNull().default({}),
    ...mutable(),
  },
  (t) => [unique("cms_pages_company_slug_uq").on(t.companyId, t.slug)],
);

export const cmsPeople = pgTable(
  "cms_people",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    title: text("title"),
    bio: text("bio"),
    photoDocumentId: uuid("photo_document_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(false),
    ...mutable(),
  },
  (t) => [index("cms_people_company_published_idx").on(t.companyId, t.isPublished, t.sortOrder)],
);
