// G (part). Documents — defined before inventory because stage_photos reference it.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    /** Indexed by documents_storage_key_idx (src/sql/online/0005_indexes.sql §7; built CONCURRENTLY outside the drizzle journal). */
    storageKey: text("storage_key").notNull(),
    variants: jsonb("variants").$type<DocumentVariants>(),
    isSensitive: boolean("is_sensitive").notNull().default(false),
    sharedWithCustomer: boolean("shared_with_customer").notNull().default(false),
    uploadedByType: actorTypeEnum("uploaded_by_type").notNull(),
    uploadedBy: uuid("uploaded_by"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    index("documents_entity_idx").on(t.entityType, t.entityId, t.isDeleted),
    index("documents_company_id_idx").on(t.companyId),
    index("documents_document_type_id_idx").on(t.documentTypeId),
  ],
);

/**
 * Objects written to storage whose owning row is not committed yet (migration 0005): an upload registers its key here before the
 * bytes are written and removes it in the same transaction that commits the document row. A key still listed after a grace period
 * belongs to a failed request, and the orphan sweep deletes the object.
 */
export const storagePendingObjects = pgTable(
  "storage_pending_objects",
  {
    key: text("key").primaryKey(),
    companyId: uuid("company_id").references(() => companies.id),
    /** What the object was for (e.g. `document`, `rendition`, `export`), for logs and the sweep. */
    purpose: text("purpose").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("storage_pending_objects_created_idx").on(t.createdAt),
    index("storage_pending_objects_company_id_idx").on(t.companyId),
  ],
);

/**
 * Durable storage-deletion queue (migration 0005): erasure, document removal and the orphan sweep enqueue keys here inside their
 * transaction; a job deletes the objects with retries (`attempts`, `last_error`, backoff via `next_attempt_at`) and sets `done_at`.
 */
export const storageDeletions = pgTable(
  "storage_deletions",
  {
    id: idColumn(),
    key: text("key").notNull(),
    companyId: uuid("company_id").references(() => companies.id),
    reason: text("reason").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [
    index("storage_deletions_due_idx").on(t.doneAt, t.nextAttemptAt),
    index("storage_deletions_company_id_idx").on(t.companyId),
    check("storage_deletions_attempts_chk", sql`${t.attempts} >= 0`),
  ],
);
