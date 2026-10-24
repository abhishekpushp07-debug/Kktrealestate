import type { SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { MasterKind } from "@kkt/contracts";
import type { Executor } from "@kkt/db";
import type { StaffContext } from "../../lib/scope.js";

/** Every master table shares these columns. */
export type MasterTable = PgTable & {
  id: AnyPgColumn;
  companyId: AnyPgColumn;
  isActive: AnyPgColumn;
  deactivatedAt: AnyPgColumn;
  version: AnyPgColumn;
  createdAt: AnyPgColumn;
  updatedAt: AnyPgColumn;
  createdBy: AnyPgColumn;
};

/** A database row of any master table (camelCase keys). */
export type DbRow = Record<string, unknown>;

/** Who is writing and from where. */
export interface WriteContext {
  app: FastifyInstance;
  req: FastifyRequest;
  user: StaffContext;
  companyId: string;
}

/** Usage of a master row by other entities. */
export interface UsageLine {
  entity_type: string;
  count: number;
}

/** Definition of one master kind consumed by the CRUD factory. */
export interface MasterKindDef {
  kind: MasterKind;
  /** URL segment, e.g. `room-types`. */
  path: string;
  /** Audit entity type, e.g. `room_type`. */
  entity: string;
  table: MasterTable;
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  rowSchema: z.ZodType;
  listSchema: z.ZodType;
  /** Defaults to MasterFilterSchema. */
  filterSchema?: z.ZodType;
  searchColumns: AnyPgColumn[];
  sortable: Record<string, AnyPgColumn>;
  defaultSort: string;
  /** Business key used by CSV import to detect updates and in duplicate messages. */
  keyField: string;
  /** Column holding the business key. */
  keyColumn: AnyPgColumn;
  /** Wire fields exported to CSV. */
  csvColumns: string[];
  /** Extra filters from the kind's filter schema. */
  extraWhere?: (query: Record<string, unknown>) => SQL | undefined;
  /**
   * Converts validated wire input into insert/update values (camelCase). Runs inside the write transaction, may validate
   * against the database and perform pre-write side effects (clearing the previous default/possession flag).
   */
  prepare: (tx: Executor, input: Record<string, unknown>, ctx: WriteContext, existing: DbRow | null) => Promise<DbRow>;
  /** Hydrates database rows into wire rows in one batch (lookups via inArray; never per row). */
  toRows: (db: Executor, rows: DbRow[], companyId: string) => Promise<Record<string, unknown>[]>;
  /** Counts references from other tables. */
  usage: (db: Executor, companyId: string, id: string) => Promise<UsageLine[]>;
  /** Post-write hook inside the transaction (child rows such as plan installments). */
  afterWrite?: (tx: Executor, row: DbRow, input: Record<string, unknown>, ctx: WriteContext, mode: "create" | "update") => Promise<void>;
  /** Kind-specific routes (reorder etc.). */
  extraRoutes?: (app: FastifyInstance, def: MasterKindDef) => void;
}
