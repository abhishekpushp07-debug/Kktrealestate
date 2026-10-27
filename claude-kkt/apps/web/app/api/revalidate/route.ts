import { revalidatePath, revalidateTag } from "next/cache";

import { PUBLIC_TAG } from "@/lib/api";
import { revalidateToken } from "@/lib/env";

/**
 * On-demand ISR revalidation, called by the API after CMS and project-website writes (API env WEB_REVALIDATE_URL pointing here and
 * WEB_REVALIDATE_TOKEN = this server's WEB_REVALIDATE_TOKEN).
 *
 *   POST /api/revalidate   x-kkt-revalidate-token: <secret>   { "tags"?: string[], "paths"?: string[] }
 *
 * Purges the Data Cache entries carrying the tags (default `kkt-public`: every API read) and re-renders the whole site on its next
 * request (`revalidatePath("/", "layout")`), so a publish, unpublish or edit shows at once instead of after the 60–300 s ISR window.
 * 401 without the right secret (compared in constant time); 404 when no secret is configured (the route is off).
 */
export const dynamic = "force-dynamic";

const TAG = /^[a-z0-9:_-]{1,100}$/i;
const PATH = /^\/[A-Za-z0-9/_-]{0,200}$/;

/** Constant-time comparison of two secrets via their SHA-256 digests (no length or content leak through timing). */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export async function POST(request: Request): Promise<Response> {
  const secret = revalidateToken();
  if (!secret) return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const given = request.headers.get("x-kkt-revalidate-token") ?? "";
  if (!given || !(await sameSecret(given, secret)))
    return Response.json(
      { error: { code: "UNAUTHENTICATED", message: "Invalid revalidation token" } },
      { status: 401 },
    );
  let body: { tags?: unknown; paths?: unknown } = {};
  try {
    const text = await request.text();
    if (text.length > 8192)
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "Body too large" } }, { status: 400 });
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Body must be JSON" } }, { status: 400 });
  }
  const tags = (Array.isArray(body.tags) ? body.tags : [PUBLIC_TAG])
    .filter((t): t is string => typeof t === "string" && TAG.test(t))
    .slice(0, 50);
  const paths = (Array.isArray(body.paths) ? body.paths : [])
    .filter((p): p is string => typeof p === "string" && PATH.test(p))
    .slice(0, 50);
  for (const tag of tags) revalidateTag(tag);
  for (const path of paths) revalidatePath(path);
  // every page reads site settings and shared lists: re-render them all on their next request
  revalidatePath("/", "layout");
  return Response.json({ revalidated: true, tags, paths, now: new Date().toISOString() });
}
