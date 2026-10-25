/**
 * Public forms (SPEC §15): website enquiries and the brochure lead gate. 5/min/IP, honeypot (silently dropped with a believable 200),
 * leads through the CRM service (dedupe rule), signed 15-minute brochure links counted once per link, 180-day visitor tokens.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BROCHURE_LINK_MINUTES, EmailSchema, PhoneSchema, PublicBrochureResponseSchema, PublicEnquiryInputSchema, PublicEnquiryResponseSchema, SlugSchema } from "@kkt/contracts";
import { UtmSchema } from "@kkt/contracts";
import { brochureDownloads, flatTypes, projectWebsiteSettings, type Executor } from "@kkt/db";
import { normalizeIndianPhone, todayIST } from "@kkt/domain";
import { writeAudit } from "../../lib/audit.js";
import { loadCompany } from "../../lib/company.js";
import { keyedHash, randomToken, safeEqual, sha256, signPayload, verifyPayload } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { createEnquiry, createOrTouchLead } from "../crm/leadService.js";
import { streamDocument } from "../documents/service.js";
import { notify, notifyRole } from "../notifications/service.js";
import { livePublishedProject } from "./publicContent.js";
import { RelaxedHoneypotSchema, WEBSITE_ACTOR, apiOrigin, crossOriginFile, fakeNumber, isHoneypotTripped, loadDocuments, noStore, publicCompanyId, publicMeta, relaxHoneypot, userAgent } from "./shared.js";

/** 5 requests per minute per IP on every public form (SPEC §2). */
export const FORM_RATE_LIMIT = { limit: 5, windowSeconds: 60 } as const;
const VISITOR_TOKEN_DAYS = 180;

const EnquiryBody = relaxHoneypot(PublicEnquiryInputSchema);

/** Brochure request: full details (first visit) or a remembered visitor_token (returning device); validated in the handler. */
const BrochureBody = z.strictObject({
  project_slug: SlugSchema,
  name: z.string().trim().min(2).max(120).optional().nullable(),
  phone: PhoneSchema.optional().nullable(),
  email: EmailSchema.optional().nullable(),
  consent: z.boolean().optional().nullable(),
  website: RelaxedHoneypotSchema,
  visitor_token: z.string().max(400).optional().nullable(),
  utm: UtmSchema.optional().nullable(),
  source_page: z.string().trim().max(300).optional().nullable(),
});

interface VisitorPayload extends Record<string, string | number> { v: 1; ph: string; nm: string; em: string }
/**
 * Brochure link token `<nonce>.<exp base36>.<hmac128 hex>`: HMAC-signed and short-lived; the brochure_downloads row (found by the token's
 * sha256) binds it to the project and records the single counted download. Kept compact so the URL parameter stays well under router limits.
 */
export function signBrochureToken(ttlSeconds: number, now = Date.now()): { token: string; expiresAt: Date } {
  const nonce = randomToken(12);
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = keyedHash(`brochure:${nonce}:${exp.toString(36)}`).slice(0, 32);
  return { token: `${nonce}.${exp.toString(36)}.${sig}`, expiresAt: new Date(exp * 1000) };
}

/** Verifies a brochure token's signature and expiry; false when forged or expired. */
export function verifyBrochureToken(token: string, now = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expRaw, sig] = parts as [string, string, string];
  const exp = parseInt(expRaw, 36);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  return safeEqual(sig, keyedHash(`brochure:${nonce}:${expRaw}`).slice(0, 32));
}

/** Signed visitor token (180 days) so a returning device skips the form. */
export function signVisitorToken(phone: string, name: string, email: string | null): string {
  return signPayload({ v: 1, ph: phone, nm: name, em: email ?? "" } satisfies VisitorPayload, VISITOR_TOKEN_DAYS * 86_400);
}

/** Verifies a visitor token; null when forged/expired. */
export function verifyVisitorToken(token: string | null | undefined): { phone: string; name: string; email: string | null } | null {
  if (!token) return null;
  const data = verifyPayload<VisitorPayload>(token);
  if (!data || data.v !== 1 || typeof data.ph !== "string" || typeof data.nm !== "string") return null;
  const phone = normalizeIndianPhone(data.ph);
  if (!phone) return null;
  return { phone, name: data.nm, email: data.em ? String(data.em) : null };
}

async function companyOr404(db: Executor): Promise<string> {
  const id = await publicCompanyId(db);
  if (!id) throw ApiError.notFound("Site");
  return id;
}

function validation(path: string, message: string): ApiError {
  return ApiError.badRequest(`${path}: ${message}`, { issues: [{ path, message }] });
}

export function registerPublicFormRoutes(app: FastifyInstance): void {
  route(app, {
    method: "POST", url: "/public/enquiries", public: true, rateLimit: FORM_RATE_LIMIT, idempotent: true,
    schema: { body: EnquiryBody, response: { 200: PublicEnquiryResponseSchema }, summary: "Website enquiry → lead (source WEBSITE, dedupe rule) + inbox row + notifications" },
    handler: async (req, reply) => {
      noStore(reply);
      const body = req.body;
      const companyId = await companyOr404(app.db);
      let projectId: string | null = null;
      let flatTypeId: string | null = null;
      if (body.project_slug) {
        const p = await livePublishedProject(app.db, companyId, body.project_slug);
        if (!p) throw validation("project_slug", "Unknown project");
        projectId = p.p.id;
      }
      if (body.flat_type_code) {
        const [ft] = await app.db.select({ id: flatTypes.id }).from(flatTypes).where(and(eq(flatTypes.companyId, companyId), sql`upper(${flatTypes.code}) = upper(${body.flat_type_code})`)).limit(1);
        if (!ft) throw validation("flat_type_code", "Unknown flat type");
        flatTypeId = ft.id;
      }
      if (isHoneypotTripped(body)) {
        // Silently dropped: same validation, same reply shape and number format as a real enquiry, nothing written.
        const company = await loadCompany(app.db, app.redis, companyId);
        return { reference_number: fakeNumber(company, "enquiry", todayIST(), "ENQ-"), message: "Thank you. Our team will call you shortly." };
      }
      const result = await app.db.transaction(async (tx) => {
        const r = await createEnquiry(tx, {
          companyId, name: body.name, phone: body.phone, email: body.email ?? null, projectId, flatTypeId, message: body.message ?? null, sourcePage: body.source_page ?? null,
          utm: body.utm ?? null, ip: req.clientIp, consent: true, redis: app.redis, requestId: req.id,
        });
        await notifyRole(tx, companyId, ["Super Admin"], { type: "ENQUIRY_NEW", title: `New website enquiry from ${body.name}`, body: r.lead.leadNumber, entityType: "enquiry", entityId: r.enquiry.id, link: `/website/enquiries?id=${r.enquiry.id}` });
        await writeAudit(tx, { companyId, actor: WEBSITE_ACTOR, action: "enquiry.create", entityType: "enquiry", entityId: r.enquiry.id, after: { reference_number: r.enquiry.referenceNumber, lead_id: r.lead.id, lead_created: r.created, project_id: projectId }, ...publicMeta(req) });
        return r;
      });
      return { reference_number: result.enquiry.referenceNumber, message: "Thank you. Our team will call you shortly." };
    },
  });

  route(app, {
    method: "POST", url: "/public/brochure-requests", public: true, rateLimit: FORM_RATE_LIMIT, idempotent: true,
    schema: { body: BrochureBody, response: { 200: PublicBrochureResponseSchema }, summary: "Brochure lead gate → signed 15-minute download link (lead source BROCHURE, dedupe rule, visitor token for returning devices)" },
    handler: async (req, reply) => {
      noStore(reply);
      const body = req.body;
      const signed = signBrochureToken(BROCHURE_LINK_MINUTES * 60);
      const expiresAt = signed.expiresAt;
      const companyId = await companyOr404(app.db);
      const project = await livePublishedProject(app.db, companyId, body.project_slug);
      if (!project) throw ApiError.notFound("Project");
      const brochureId = project.w.brochureDocumentId;
      const docs = await loadDocuments(app.db, [brochureId]);
      const brochure = brochureId ? docs.get(brochureId) : undefined;
      if (!brochure || brochure.isSensitive || brochure.mime !== "application/pdf") throw ApiError.notFound("Brochure");

      const returning = verifyVisitorToken(body.visitor_token);
      let who: { phone: string; name: string; email: string | null };
      if (returning) who = returning;
      else {
        if (!body.name) throw validation("name", "Name is required");
        if (!body.phone) throw validation("phone", "Phone is required");
        if (body.consent !== true) throw validation("consent", "Consent is required");
        who = { phone: body.phone, name: body.name, email: body.email ?? null };
      }
      if (isHoneypotTripped(body)) {
        // Silently dropped: a validly signed link that was never issued (404 on GET, exactly like an expired one), a real-looking visitor
        // token and the real file name; no lead, no brochure_downloads row, no notification.
        return {
          download_url: `${apiOrigin}/api/v1/public/brochure/${signed.token}`,
          expires_at: expiresAt.toISOString(),
          visitor_token: body.visitor_token && returning ? body.visitor_token : signVisitorToken(who.phone, who.name, who.email),
          file_name: brochure.fileName,
        };
      }

      const result = await app.db.transaction(async (tx) => {
        const { lead, created } = await createOrTouchLead(tx, {
          companyId, phone: who.phone, name: who.name, email: who.email, projectId: project.p.id, source: "BROCHURE", utm: body.utm ?? null, consent: true,
          activityType: "BROCHURE_DOWNLOADED", activityPayload: { project_slug: body.project_slug, source_page: body.source_page ?? null, returning_visitor: Boolean(returning) },
          actor: WEBSITE_ACTOR, redis: app.redis, ip: req.clientIp, requestId: req.id,
        });
        const token = signed.token;
        const [row] = await tx
          .insert(brochureDownloads)
          .values({ companyId, projectId: project.p.id, leadId: lead.id, tokenHash: sha256(token), expiresAt, ip: req.clientIp, userAgent: userAgent(req) })
          .returning({ id: brochureDownloads.id });
        if (created) {
          const note = { type: "BROCHURE_LEAD" as const, title: `Brochure lead: ${who.name} · ${project.p.name}`, body: `${lead.leadNumber} · ${who.phone}`, entityType: "lead", entityId: lead.id, link: `/leads/${lead.id}` };
          if (lead.assignedUserId) await notify(tx, { companyId, recipients: [{ type: "STAFF", id: lead.assignedUserId }], ...note });
          await notifyRole(tx, companyId, ["Sales", "Marketing"], note);
        }
        await writeAudit(tx, { companyId, actor: WEBSITE_ACTOR, action: "brochure_download.request", entityType: "brochure_download", entityId: row?.id ?? null, after: { project_id: project.p.id, lead_id: lead.id, lead_created: created, returning_visitor: Boolean(returning) }, ...publicMeta(req) });
        return token;
      });
      return {
        download_url: `${apiOrigin}/api/v1/public/brochure/${result}`,
        expires_at: expiresAt.toISOString(),
        visitor_token: body.visitor_token && returning ? body.visitor_token : signVisitorToken(who.phone, who.name, who.email),
        file_name: brochure.fileName,
      };
    },
  });

  route(app, {
    method: "GET", url: "/public/brochure/:token", public: true,
    schema: { params: z.object({ token: z.string().min(16).max(2048) }), response: { 200: z.any() }, summary: "Streams the brochure PDF as an attachment (signed 15-minute link; counted once per link)" },
    handler: async (req, reply) => {
      const token = req.params.token;
      if (!verifyBrochureToken(token)) throw ApiError.notFound("Brochure link");
      const [row] = await app.db.select().from(brochureDownloads).where(eq(brochureDownloads.tokenHash, sha256(token))).limit(1);
      if (!row || row.expiresAt.getTime() < Date.now()) throw ApiError.notFound("Brochure link");
      const [w] = await app.db.select({ brochureDocumentId: projectWebsiteSettings.brochureDocumentId, isPublished: projectWebsiteSettings.isPublished }).from(projectWebsiteSettings).where(eq(projectWebsiteSettings.projectId, row.projectId)).limit(1);
      if (!w?.brochureDocumentId || !w.isPublished) throw ApiError.notFound("Brochure");
      const file = await streamDocument(app.db, w.brochureDocumentId, "original");
      if (!file || file.mime !== "application/pdf") throw ApiError.notFound("Brochure");
      // Count exactly once per link: the first GET flips downloaded_at and increments the project counter atomically.
      await app.db.transaction(async (tx) => {
        const first = await tx.update(brochureDownloads).set({ downloadedAt: new Date() }).where(and(eq(brochureDownloads.id, row.id), sql`${brochureDownloads.downloadedAt} is null`)).returning({ id: brochureDownloads.id });
        if (first.length > 0) {
          await tx.update(projectWebsiteSettings).set({ brochureDownloadCount: sql`${projectWebsiteSettings.brochureDownloadCount} + 1` }).where(eq(projectWebsiteSettings.projectId, row.projectId));
          await writeAudit(tx, { companyId: row.companyId, actor: WEBSITE_ACTOR, action: "brochure_download.download", entityType: "brochure_download", entityId: row.id, after: { project_id: row.projectId, lead_id: row.leadId }, ...publicMeta(req) });
        }
      });
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      crossOriginFile(reply);
      if (file.size !== null) reply.header("Content-Length", String(file.size));
      return reply.send(file.stream);
    },
  });
}
