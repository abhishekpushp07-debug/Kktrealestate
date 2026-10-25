import type { FastifyInstance, FastifyRequest } from "fastify";
import { sha256 } from "./crypto.js";
import { ApiError } from "./errors.js";
import { setIdempotencyFingerprint } from "../plugins/idempotency.js";

/** A parsed single-file multipart upload: the file bytes, its client filename and the text fields. */
export interface ParsedUpload {
  buffer: Buffer;
  filename: string;
  fields: Record<string, unknown>;
}

/** Reads the single `file` part and the text fields of a multipart request (413 when the 15 MB file limit is hit). */
export async function readUpload(req: FastifyRequest): Promise<ParsedUpload> {
  if (!req.isMultipart()) throw ApiError.badRequest("Expected a multipart/form-data upload with a `file` part");
  const fields: Record<string, unknown> = {};
  let file: { buffer: Buffer; filename: string } | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (file) { part.file.resume(); throw ApiError.badRequest("Upload exactly one file per request"); }
        const buffer = await part.toBuffer();
        file = { buffer, filename: part.filename || "file" };
      } else {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw new ApiError(413, "PAYLOAD_TOO_LARGE", "File exceeds the 15 MB limit");
    if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT") throw ApiError.badRequest("Too many parts in the upload");
    throw err;
  }
  if (!file) throw ApiError.badRequest("Missing `file` part");
  return { ...file, fields };
}

/** Uploads parsed by the preValidation hook, keyed by request (a WeakMap so no request decoration leaks to other modules). */
const parsedUploads = new WeakMap<FastifyRequest, ParsedUpload>();

/**
 * Installs a preValidation hook that parses the multipart body of matching POST requests before the idempotency preHandler runs and
 * registers `{fields, file: {name, size, sha256}}` as the Idempotency-Key fingerprint (docs/TODO-integration.md item 2).
 * Handlers read the parsed upload with `uploadOf(req)`.
 */
export function installMultipartIdempotency(app: FastifyInstance, matches: (routeUrl: string) => boolean): void {
  app.addHook("preValidation", async (req) => {
    if (req.method !== "POST" || !req.routeOptions.url || !matches(req.routeOptions.url) || !req.isMultipart()) return;
    const parsed = await readUpload(req);
    parsedUploads.set(req, parsed);
    setIdempotencyFingerprint(req, { fields: parsed.fields, file: { name: parsed.filename, size: parsed.buffer.length, sha256: sha256(parsed.buffer) } });
  });
}

/** The upload parsed for this request by installMultipartIdempotency (400 when the request was not multipart). */
export function uploadOf(req: FastifyRequest): ParsedUpload {
  const parsed = parsedUploads.get(req);
  if (!parsed) throw ApiError.badRequest("Expected a multipart/form-data upload with a `file` part");
  return parsed;
}
