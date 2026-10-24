// G (part). Documents — defined before inventory because stage_photos reference it.
import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./_common.js";
import { actorTypeEnum, documentEntityTypeEnum } from "./enums.js";
import { companies } from "./identity.js";
import type { DocumentVariants } from "./json.js";
import { documentTypes } from "./masters.js";

export const documents = pgTable(
  "documents",
  {
    id: idColumn(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    entityType: documentEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    documentTypeId: uuid("document_type_id").references(() => documentTypes.id),
    title: text("title"),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    variants: jsonb("variants").$type<DocumentVariants>(),
    isSensitive: boolean("is_sensitive").notNull().default(false),
    sharedWithCustomer: boolean("shared_with_customer").notNull().default(false),
    uploadedByType: actorTypeEnum("uploaded_by_type").notNull(),
    uploadedBy: uuid("uploaded_by"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("documents_entity_idx").on(t.entityType, t.entityId, t.isDeleted)],
);
