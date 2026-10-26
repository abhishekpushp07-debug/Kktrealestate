import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { DocumentEntityType, Permission } from "@kkt/contracts";
import {
  blockStages,
  blocks,
  bookings,
  customers,
  documents,
  flats,
  payments,
  projects,
  serviceRequests,
  type Executor,
} from "@kkt/db";
import { ApiError } from "../../lib/errors.js";
import { assertPermission, ensureProjectAccess, type StaffContext } from "../../lib/scope.js";

/** Where a document hangs: the owning entity and, when it has one, its project (for scope checks). */
export interface EntityRef {
  entityType: DocumentEntityType;
  entityId: string;
  /** Project the entity belongs to; null for company-wide entities (customers, company, CMS media). */
  projectId: string | null;
  /** Customer who owns the entity (customer itself, booking's primary applicant) — used for sharing. */
  customerId: string | null;
}

/** Entity types that carry no project (visible to every scoped user). */
export const UNSCOPED_ENTITY_TYPES: readonly DocumentEntityType[] = ["CUSTOMER", "CMS", "COMPANY"];

/** Extra permission (besides document.write) needed to attach or edit documents of an entity kind. */
export const ENTITY_WRITE_PERMISSION: Readonly<Record<DocumentEntityType, Permission>> = {
  CUSTOMER: "customer.write",
  BOOKING: "booking.read",
  PROJECT: "project.read",
  BLOCK: "project.read",
  FLAT: "project.read",
  PAYMENT: "payment.read",
  STAGE: "project.read",
  CMS: "cms.write",
  SERVICE_REQUEST: "service.write",
  COMPANY: "settings.manage",
};

const ENTITY_LABEL: Readonly<Record<DocumentEntityType, string>> = {
  CUSTOMER: "Customer",
  BOOKING: "Booking",
  PROJECT: "Project",
  BLOCK: "Block",
  FLAT: "Flat",
  PAYMENT: "Payment",
  STAGE: "Construction stage",
  CMS: "Media",
  SERVICE_REQUEST: "Service request",
  COMPANY: "Company",
};

/**
 * Loads the entity a document is attached to (within the company) and resolves its project; null when it does not exist.
 * CMS media carries no owning row (the media library is created before banners/gallery rows reference it) and is accepted as is.
 */
export async function resolveEntity(
  executor: Executor,
  companyId: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<EntityRef | null> {
  const ref = (projectId: string | null, customerId: string | null = null): EntityRef => ({
    entityType,
    entityId,
    projectId,
    customerId,
  });
  switch (entityType) {
    case "CUSTOMER": {
      const [r] = await executor
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, entityId), eq(customers.companyId, companyId)))
        .limit(1);
      return r ? ref(null, r.id) : null;
    }
    case "BOOKING": {
      const [r] = await executor
        .select({ projectId: bookings.projectId, customerId: bookings.customerId })
        .from(bookings)
        .where(and(eq(bookings.id, entityId), eq(bookings.companyId, companyId)))
        .limit(1);
      return r ? ref(r.projectId, r.customerId) : null;
    }
    case "PROJECT": {
      const [r] = await executor
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, entityId), eq(projects.companyId, companyId)))
        .limit(1);
      return r ? ref(r.id) : null;
    }
    case "BLOCK": {
      const [r] = await executor
        .select({ projectId: blocks.projectId })
        .from(blocks)
        .where(and(eq(blocks.id, entityId), eq(blocks.companyId, companyId)))
        .limit(1);
      return r ? ref(r.projectId) : null;
    }
    case "FLAT": {
      const [r] = await executor
        .select({ projectId: flats.projectId })
        .from(flats)
        .where(and(eq(flats.id, entityId), eq(flats.companyId, companyId)))
        .limit(1);
      return r ? ref(r.projectId) : null;
    }
    case "PAYMENT": {
      const [r] = await executor
        .select({ projectId: payments.projectId, customerId: payments.customerId })
        .from(payments)
        .where(and(eq(payments.id, entityId), eq(payments.companyId, companyId)))
        .limit(1);
      return r ? ref(r.projectId, r.customerId) : null;
    }
    case "STAGE": {
      const [r] = await executor
        .select({ projectId: blocks.projectId })
        .from(blockStages)
        .innerJoin(blocks, eq(blocks.id, blockStages.blockId))
        .where(and(eq(blockStages.id, entityId), eq(blockStages.companyId, companyId)))
        .limit(1);
      return r ? ref(r.projectId) : null;
    }
    case "SERVICE_REQUEST": {
      const [r] = await executor
        .select({ projectId: bookings.projectId, customerId: serviceRequests.customerId })
        .from(serviceRequests)
        .leftJoin(bookings, eq(bookings.id, serviceRequests.bookingId))
        .where(and(eq(serviceRequests.id, entityId), eq(serviceRequests.companyId, companyId)))
        .limit(1);
      return r ? ref(r.projectId ?? null, r.customerId) : null;
    }
    case "COMPANY":
      return entityId === companyId ? ref(null) : null;
    case "CMS":
      return ref(null);
    default:
      return null;
  }
}

/** Resolves the entity or throws 404 (also for a project outside the user's scope, so foreign projects stay undiscoverable). */
export async function requireEntity(
  executor: Executor,
  user: Pick<StaffContext, "companyId" | "allProjects" | "projectIds">,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<EntityRef> {
  const ref = await resolveEntity(executor, user.companyId, entityType, entityId);
  if (!ref) throw ApiError.notFound(ENTITY_LABEL[entityType]);
  if (ref.projectId) ensureProjectAccess(user, ref.projectId, ENTITY_LABEL[entityType]);
  return ref;
}

/** 403 unless the user may write documents of this entity kind (document.write plus the entity-specific permission). */
export function assertEntityWrite(user: Pick<StaffContext, "permissions">, entityType: DocumentEntityType): void {
  assertPermission(user, "document.write");
  assertPermission(user, ENTITY_WRITE_PERMISSION[entityType]);
}

/**
 * Drizzle condition limiting a documents query to entities inside the user's project scope (undefined = everything).
 * Company-wide entity kinds are always visible; project-bound kinds are matched through `entity_id IN (select … where project_id in scope)`.
 */
export function documentScopeCondition(
  executor: Executor,
  user: Pick<StaffContext, "allProjects" | "projectIds">,
): SQL | undefined {
  if (user.allProjects) return undefined;
  const unscoped = inArray(documents.entityType, [...UNSCOPED_ENTITY_TYPES]);
  const pids = user.projectIds;
  if (pids.length === 0) return unscoped;
  return or(
    unscoped,
    and(eq(documents.entityType, "PROJECT"), inArray(documents.entityId, pids)),
    and(
      eq(documents.entityType, "BOOKING"),
      inArray(
        documents.entityId,
        executor.select({ id: bookings.id }).from(bookings).where(inArray(bookings.projectId, pids)),
      ),
    ),
    and(
      eq(documents.entityType, "BLOCK"),
      inArray(
        documents.entityId,
        executor.select({ id: blocks.id }).from(blocks).where(inArray(blocks.projectId, pids)),
      ),
    ),
    and(
      eq(documents.entityType, "FLAT"),
      inArray(documents.entityId, executor.select({ id: flats.id }).from(flats).where(inArray(flats.projectId, pids))),
    ),
    and(
      eq(documents.entityType, "PAYMENT"),
      inArray(
        documents.entityId,
        executor.select({ id: payments.id }).from(payments).where(inArray(payments.projectId, pids)),
      ),
    ),
    and(
      eq(documents.entityType, "STAGE"),
      inArray(
        documents.entityId,
        executor
          .select({ id: blockStages.id })
          .from(blockStages)
          .innerJoin(blocks, eq(blocks.id, blockStages.blockId))
          .where(inArray(blocks.projectId, pids)),
      ),
    ),
    and(
      eq(documents.entityType, "SERVICE_REQUEST"),
      inArray(
        documents.entityId,
        executor
          .select({ id: serviceRequests.id })
          .from(serviceRequests)
          .leftJoin(bookings, eq(bookings.id, serviceRequests.bookingId))
          .where(or(isNull(serviceRequests.bookingId), inArray(bookings.projectId, pids))),
      ),
    ),
  );
}
