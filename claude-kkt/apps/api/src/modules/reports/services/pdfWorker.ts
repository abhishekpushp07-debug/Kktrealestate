/**
 * PDF worker-thread entry (piscina). Renders one recorded document per task with pdfkit (services/pdfRender.ts). With a `port` the bytes
 * are streamed back chunk by chunk as pdfkit produces them (then `{ end: true }`); without one the whole document is returned.
 */
import { threadId, type MessagePort } from "node:worker_threads";
import { renderPdf, type PdfRenderTask } from "./pdfRender.js";

/** Task sent to a worker. */
export interface PdfWorkerTask extends PdfRenderTask {
  /** Streaming mode: chunks are posted here as `Uint8Array`, followed by `{ end: true }`. */
  port?: MessagePort;
}

/** Result of a task. */
export interface PdfWorkerResult {
  /** Whole document (buffer mode) or null (streaming mode). */
  bytes: Uint8Array | null;
  size: number;
  /** Worker thread id that rendered the document (never the main thread's 0). */
  threadId: number;
}

/** Messages on the streaming port. */
export type PdfPortMessage = { chunk: Uint8Array } | { end: true };

export default async function pdfWorkerTask(task: PdfWorkerTask): Promise<PdfWorkerResult> {
  const { port } = task;
  let size = 0;
  if (port) {
    try {
      await renderPdf(task, (chunk) => {
        size += chunk.length;
        port.postMessage({ chunk: new Uint8Array(chunk) } satisfies PdfPortMessage);
      });
      port.postMessage({ end: true } satisfies PdfPortMessage);
    } finally {
      port.close();
    }
    return { bytes: null, size, threadId };
  }
  const chunks: Buffer[] = [];
  await renderPdf(task, (chunk) => {
    size += chunk.length;
    chunks.push(chunk);
  });
  return { bytes: new Uint8Array(Buffer.concat(chunks, size)), size, threadId };
}
