import { ApiError } from "./errors.js";

interface PgLikeError {
  code?: string;
  constraint_name?: string;
  constraint?: string;
  detail?: string;
  message?: string;
  cause?: unknown;
}

function pg(err: unknown): PgLikeError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as PgLikeError;
  if (typeof e.code === "string" && /^\d{5}$/.test(e.code)) return e;
  if (e.cause && typeof e.cause === "object") return pg(e.cause);
  return null;
}

/** True for a Postgres unique-violation error (23505), including when wrapped by Drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  return pg(err)?.code === "23505";
}

/** True for a Postgres foreign-key violation (23503). */
export function isForeignKeyViolation(err: unknown): boolean {
  return pg(err)?.code === "23503";
}

/** Converts unique/FK violations into 409 DUPLICATE / 400 VALIDATION_ERROR; rethrows anything else. */
export function translatePgError(err: unknown, what: string): never {
  const e = pg(err);
  if (e?.code === "23505")
    throw ApiError.conflict("DUPLICATE", `${what} already exists`, {
      constraint: e.constraint_name ?? e.constraint ?? null,
    });
  if (e?.code === "23503")
    throw ApiError.badRequest(`${what} references a record that does not exist`, {
      constraint: e.constraint_name ?? e.constraint ?? null,
    });
  throw err;
}
