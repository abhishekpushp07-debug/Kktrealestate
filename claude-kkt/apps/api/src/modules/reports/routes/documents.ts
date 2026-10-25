/** Routes: branded PDFs for receipts, demand letters, allotment letters and customer statements (SPEC §11, §14). All scope-checked (404). */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdSchema } from "@kkt/contracts";
import { route } from "../../../lib/routes.js";
import { sendPdf } from "../common.js";
import { allotmentLetterPdf, customerStatementPdf, demandLetterPdf, receiptPdf } from "../services/documents.js";

const idParams = z.object({ id: IdSchema });
const demandParams = z.object({ id: IdSchema, demandId: IdSchema });
/** PDF routes stream bytes; the 200 schema documents the media type only. */
const PdfResponseSchema = z.any().describe("application/pdf attachment");

export function registerDocumentRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/payments/:id/receipt.pdf", permission: "receipt.print",
    schema: { params: idParams, response: { 200: PdfResponseSchema }, summary: "Receipt PDF (letterhead, amount in words, subject to realisation while pending, CANCELLED watermark when reversed)" },
    handler: async (req, reply) => {
      const pdf = await receiptPdf(app.dbReplica, req.user!, req.params.id);
      return sendPdf(reply, pdf.filename, pdf.bytes);
    },
  });

  route(app, {
    method: "GET", url: "/bookings/:id/demands/:demandId/letter.pdf", permission: "receipt.print",
    schema: { params: demandParams, response: { 200: PdfResponseSchema }, summary: "Demand letter PDF (both buckets, due date, bank details for the Account bucket)" },
    handler: async (req, reply) => {
      const pdf = await demandLetterPdf(app.dbReplica, req.user!, req.params.id, req.params.demandId);
      return sendPdf(reply, pdf.filename, pdf.bytes);
    },
  });

  route(app, {
    method: "GET", url: "/bookings/:id/allotment-letter.pdf", permission: "booking.read",
    schema: { params: idParams, response: { 200: PdfResponseSchema }, summary: "Allotment letter PDF (booking, flat snapshot, parking, plan schedule)" },
    handler: async (req, reply) => {
      const pdf = await allotmentLetterPdf(app.dbReplica, req.user!, req.params.id);
      return sendPdf(reply, pdf.filename, pdf.bytes);
    },
  });

  route(app, {
    method: "GET", url: "/bookings/:id/statement.pdf", permission: "booking.read",
    schema: { params: idParams, response: { 200: PdfResponseSchema }, summary: "Customer statement of account PDF (agreement, revisions, schedule, full ledger, other charges, pending cheques)" },
    handler: async (req, reply) => {
      const pdf = await customerStatementPdf(app.dbReplica, req.user!, req.params.id);
      return sendPdf(reply, pdf.filename, pdf.bytes);
    },
  });
}
