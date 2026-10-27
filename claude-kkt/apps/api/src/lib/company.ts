import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { companies, type Executor } from "@kkt/db";
import { cached, invalidate } from "./cache.js";
import { ApiError } from "./errors.js";

/** A company row as loaded for request handling. */
export type CompanyRecord = typeof companies.$inferSelect;

const KEY = (id: string) => `company:${id}`;

/** Loads a company by id with a 30 s Redis cache (settings, numbering and FY start are read on most writes). */
export async function loadCompany(executor: Executor, redis: Redis, id: string): Promise<CompanyRecord> {
  const row = await cached(redis, KEY(id), 30, async () => {
    const [c] = await executor.select().from(companies).where(eq(companies.id, id)).limit(1);
    return c ?? null;
  });
  if (!row) throw ApiError.notFound("Company");
  // JSON round-trip turns Date into string; normalise the fields callers may touch.
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

/** Drops the cached company (after settings updates). */
export async function invalidateCompany(redis: Redis, id: string): Promise<void> {
  await invalidate(redis, KEY(id));
}
