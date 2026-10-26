/**
 * Branded PDFs (SPEC §11 receipts, §14 branded A4 PDFs, audit H5): DejaVu Sans is embedded so amounts print with the rupee sign and
 * Indian grouping (never "Rs."), and every document is rendered by the piscina worker pool — never by pdfkit on the event loop.
 */
import { readFileSync } from "node:fs";
import { threadId } from "node:worker_threads";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { BrandedPdf, PDF_CURRENCY_PREFIX, findRupeeFont, pdfMoney, reportPdf, reportPdfStream } from "../../src/modules/reports/services/pdf.js";
import { closePdfPool, renderPdfWithInfo } from "../../src/modules/reports/services/pdfPool.js";
import { pdfFonts, pdfText } from "../integration/pdfText.js";

const L = 10_000_000; // ₹1,00,000 in paise
const letterhead = { name: "Shree Ganesh Builders", legalName: "Shree Ganesh Builders Pvt Ltd", addressLine: "Bailey Road, Patna", gstin: "10AABCS1234A1Z5" };

function receipt(): BrandedPdf {
  const pdf = new BrandedPdf({ letterhead, title: "Payment Receipt", reference: "Receipt SGB/2526/0001" });
  pdf.kv([{ title: "Received from", rows: [["Customer", "Anil Kumar"], ["Amount", pdfMoney(4 * L)]] }]);
  pdf.amountBox("Amount received", 4 * L);
  pdf.amountInWords(4 * L);
  pdf.table([{ key: "label", header: "Bucket", width: 2 }, { key: "amount", header: "Amount", money: true }], [{ label: "Cash", amount: 60 * L }, { label: "Account", amount: 40 * L }], { totals: { amount: 100 * L } });
  pdf.signature("Shree Ganesh Builders", null, null);
  return pdf;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(typeof c === "string" ? Buffer.from(c) : Buffer.from(c));
  return Buffer.concat(chunks);
}

afterEach(() => {
  delete process.env.PDF_WORKER_QUEUE;
  delete process.env.PDF_WORKER_THREADS;
});

afterAll(async () => {
  await closePdfPool();
});

describe("PDF fonts: DejaVu Sans embedded, ₹ with Indian grouping", () => {
  it("finds the DejaVu Sans TTF and uses the rupee sign as the currency prefix", () => {
    expect(findRupeeFont()).toMatch(/DejaVuSans\.ttf$/);
    expect(PDF_CURRENCY_PREFIX).toBe("₹");
    expect(pdfMoney(100 * L)).toBe("₹1,00,00,000");
    expect(pdfMoney(-125_000_00)).toBe("-₹1,25,000");
  });

  it("embeds subset DejaVuSans (regular + bold) with a ToUnicode map that contains the rupee glyph; amounts read ₹4,00,000, never Rs.", async () => {
    const bytes = await receipt().finish();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const fonts = pdfFonts(bytes);
    expect(fonts.embedded).toBe(true);
    expect(fonts.baseFonts.some((f) => /^[A-Z]{6}\+DejaVuSans$/.test(f))).toBe(true);
    expect(fonts.baseFonts.some((f) => /^[A-Z]{6}\+DejaVuSans-Bold$/.test(f))).toBe(true);
    expect(fonts.baseFonts.some((f) => /Helvetica/.test(f))).toBe(false);
    expect(fonts.unicode.has("₹")).toBe(true);
    const text = pdfText(bytes);
    expect(text).toContain("₹4,00,000");
    expect(text).toContain("₹1,00,00,000");
    expect(text).toContain("Rupees Four Lakh Only");
    expect(text).toContain("PAYMENT RECEIPT");
    expect(text).toContain("Page 1 of 1");
    expect(text).not.toContain("Rs.");
  });
});

describe("PDF rendering runs in worker threads (piscina), never on the event loop", () => {
  it("documents are rendered by a worker thread, not the main thread", async () => {
    const r = await renderPdfWithInfo(receipt().toTask());
    expect(threadId).toBe(0);
    expect(r.threadId).toBeGreaterThan(0);
    expect(pdfText(r.bytes)).toContain("₹4,00,000");
  });

  it("report PDFs stream from the worker in several chunks while the event loop keeps ticking", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ n: `Customer ${i + 1}`, amount: (i + 1) * L }));
    const spec = { title: "Large report", columns: [{ key: "n", header: "Name", width: 3 }, { key: "amount", header: "Amount", money: true }], rows };
    // warm the pool so thread start-up is not measured
    await reportPdf(letterhead, { ...spec, rows: rows.slice(0, 2) });
    let last = performance.now();
    let maxGap = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 5);
    const started = performance.now();
    const stream = await reportPdfStream(letterhead, spec);
    let chunks = 0;
    const parts: Buffer[] = [];
    for await (const c of stream) {
      chunks += 1;
      parts.push(c as Buffer);
    }
    const elapsed = performance.now() - started;
    clearInterval(timer);
    const bytes = Buffer.concat(parts);
    expect(chunks).toBeGreaterThan(1);
    expect(pdfText(bytes)).toContain("₹15,00,00,000");
    // the render takes a while in the worker, but the main thread never stalls for anything close to it
    expect(maxGap).toBeLessThan(Math.max(100, elapsed / 3));
  });

  it("a full render queue answers 503 SERVICE_UNAVAILABLE instead of piling up work", async () => {
    await closePdfPool();
    process.env.PDF_WORKER_THREADS = "1";
    process.env.PDF_WORKER_QUEUE = "1";
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => receipt().finish()));
    await closePdfPool();
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0]!.reason).toMatchObject({ statusCode: 503, code: "SERVICE_UNAVAILABLE" });
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("stream mode: a failure before the first byte rejects (normal error response), the stream is never half-sent", async () => {
    await closePdfPool();
    process.env.PDF_WORKER_THREADS = "1";
    process.env.PDF_WORKER_QUEUE = "1";
    const spec = { title: "Q", columns: [{ key: "n", header: "Name" }], rows: [{ n: "x" }] };
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => reportPdfStream(letterhead, spec).then(readAll)));
    await closePdfPool();
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0]!.reason).toMatchObject({ statusCode: 503 });
    for (const r of results) if (r.status === "fulfilled") expect(r.value.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("PDF worker pool under concurrency and in the production bundle", () => {
  it("concurrent streamed reports never mix bytes: each stream is one complete PDF with its own title and rows", async () => {
    await closePdfPool();
    process.env.PDF_WORKER_THREADS = "2";
    const specs = Array.from({ length: 6 }, (_, k) => ({
      title: `Isolation report ${k}`,
      columns: [{ key: "n", header: "Name", width: 3 }, { key: "amount", header: "Amount", money: true }],
      rows: Array.from({ length: 200 + k * 50 }, (_, i) => ({ n: `Row ${k}-${i}`, amount: (k + 1) * L })),
    }));
    const docs = await Promise.all(specs.map((spec) => reportPdfStream(letterhead, spec).then(readAll)));
    await closePdfPool();
    docs.forEach((bytes, k) => {
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(bytes.subarray(-6).toString("latin1")).toMatch(/%%EOF\s*$/);
      const text = pdfText(bytes);
      expect(text).toContain(`ISOLATION REPORT ${k}`);
      expect(text).toContain(`Row ${k}-0`);
      for (const other of [0, 1, 2, 3, 4, 5].filter((o) => o !== k)) expect(text).not.toContain(`Row ${other}-0`);
    });
  });

  it("the tsup bundle ships the worker as its own entry (dist/modules/reports/services/pdfWorker.js), so a worker thread never loads the app", () => {
    const config = readFileSync(new URL("../../tsup.config.ts", import.meta.url), "utf8");
    expect(config).toContain('"src/modules/reports/services/pdfWorker.ts"');
  });
});
