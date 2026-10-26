/**
 * Worker-thread pool for PDF rendering (piscina). pdfkit layout, font subsetting and compression are CPU-bound, so request handlers only
 * record the document (services/pdf.ts BrandedPdf) and hand it to this pool; the event loop never runs pdfkit.
 *
 * - `renderPdfBuffer(task)` resolves with the whole document (receipts, letters, portal signed links: exact Content-Length).
 * - `renderPdfStream(task)` returns a Readable fed chunk by chunk over a MessagePort as the worker produces bytes (report PDFs).
 *
 * Size: `PDF_WORKER_THREADS` (1–16, default min(2, cores − 1, ≥ 1)) threads per API process, created on demand and stopped after 60 s
 * idle; at most `PDF_WORKER_QUEUE` (default 64) documents wait, beyond that the request answers 503 SERVICE_UNAVAILABLE with Retry-After.
 *
 * Worker entry: the source module services/pdfWorker.ts (loaded through tsx in dev/tests) or, in the tsup bundle,
 * dist/modules/reports/services/pdfWorker.js when the build lists it as an entry; otherwise the reports module entry
 * (dist/modules/reports/index.js, export `pdfWorkerTask`) is used.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { Piscina } from "piscina";
import { ApiError } from "../../../lib/errors.js";
import type { PdfRenderTask } from "./pdfRender.js";
import type { PdfPortMessage, PdfWorkerResult, PdfWorkerTask } from "./pdfWorker.js";

interface WorkerLocation {
  filename: string;
  name: string;
  execArgv: string[];
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  return n;
}

/** Where the worker entry lives for the current runtime (source via tsx, or the bundle). */
export function pdfWorkerLocation(): WorkerLocation {
  const self = fileURLToPath(import.meta.url);
  if (self.endsWith(".ts")) {
    const require = createRequire(import.meta.url);
    return {
      filename: join(dirname(self), "pdfWorker.ts"),
      name: "default",
      execArgv: ["--import", pathToFileURL(require.resolve("tsx")).href],
    };
  }
  // bundle: this code sits in dist/<chunk>.js or dist/modules/reports/index.js — look upwards for the dist root
  const ancestors: string[] = [];
  for (let dir = dirname(self), i = 0; i < 4; i += 1, dir = dirname(dir)) ancestors.push(dir);
  for (const dir of ancestors) {
    const worker = join(dir, "modules/reports/services/pdfWorker.js");
    if (existsSync(worker)) return { filename: worker, name: "default", execArgv: [] };
  }
  for (const dir of ancestors) {
    const entry = join(dir, "modules/reports/index.js");
    if (existsSync(entry)) return { filename: entry, name: "pdfWorkerTask", execArgv: [] };
  }
  throw new Error(`PDF worker entry not found near ${self}`);
}

let pool: Piscina<PdfWorkerTask, PdfWorkerResult> | null = null;

/** The process-wide pool (created on first use). */
export function pdfPool(): Piscina<PdfWorkerTask, PdfWorkerResult> {
  if (!pool) {
    const loc = pdfWorkerLocation();
    const maxThreads = envInt("PDF_WORKER_THREADS", Math.max(1, Math.min(2, availableParallelism() - 1)), 1, 16);
    pool = new Piscina<PdfWorkerTask, PdfWorkerResult>({
      filename: loc.filename,
      name: loc.name,
      // never inherit the parent's --import (the OpenTelemetry preload) or test-runner flags
      execArgv: loc.execArgv,
      minThreads: 0,
      maxThreads,
      idleTimeout: 60_000,
      maxQueue: envInt("PDF_WORKER_QUEUE", 64, 1, 10_000),
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
  }
  return pool;
}

/** Stops the pool (app shutdown, tests); the next render starts a fresh one. */
export async function closePdfPool(): Promise<void> {
  const p = pool;
  pool = null;
  if (p) await p.destroy();
}

function mapPoolError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/queue is at limit/i.test(message))
    return ApiError.unavailable("PDF rendering is busy. Try again in a few seconds.", 5);
  return err instanceof Error ? err : new Error(message);
}

/** Renders a document off the event loop and resolves with its bytes. */
export async function renderPdfBuffer(task: PdfRenderTask): Promise<Buffer> {
  try {
    const r = await pdfPool().run(task);
    if (!r.bytes) throw new Error("PDF worker returned no bytes");
    return Buffer.from(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength);
  } catch (err) {
    throw mapPoolError(err);
  }
}

/** Same as renderPdfBuffer but also reports which thread rendered it (tests). */
export async function renderPdfWithInfo(task: PdfRenderTask): Promise<{ bytes: Buffer; threadId: number }> {
  const r = await pdfPool().run(task);
  return { bytes: Buffer.from(r.bytes ?? new Uint8Array()), threadId: r.threadId };
}

/**
 * Renders a document off the event loop. Resolves with a stream once the worker has produced the first bytes (so a failure before any
 * output — a full queue, a render error — still becomes a normal error response); the stream then emits the bytes as they are produced.
 */
export function renderPdfStream(task: PdfRenderTask): Promise<Readable> {
  return new Promise<Readable>((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    let started = false;
    let ended = false;
    const out = new Readable({ read() {} });
    const fail = (err: unknown): void => {
      port1.close();
      const e = mapPoolError(err);
      if (started) out.destroy(e);
      else reject(e);
    };
    port1.on("message", (msg: PdfPortMessage) => {
      if (!started) {
        started = true;
        resolve(out);
      }
      if ("chunk" in msg) {
        out.push(Buffer.from(msg.chunk.buffer, msg.chunk.byteOffset, msg.chunk.byteLength));
      } else if (msg.end) {
        ended = true;
        out.push(null);
        port1.close();
      }
    });
    let run: Promise<PdfWorkerResult>;
    try {
      run = pdfPool().run({ ...task, port: port2 }, { transferList: [port2] });
    } catch (err) {
      fail(err);
      return;
    }
    run.then(() => {
      // the result travels on piscina's own channel and may overtake the last port message: the stream ends on `{ end: true }` only
      if (!ended) {
        setTimeout(() => {
          if (!ended) fail(new Error("PDF worker finished without ending the stream"));
        }, 5_000).unref();
      }
    }, fail);
  });
}
