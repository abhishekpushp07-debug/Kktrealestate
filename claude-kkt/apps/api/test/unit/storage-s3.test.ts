import { Readable } from "node:stream";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3Storage, StorageNotFoundError, s3ClientConfig, type S3ClientLike } from "../../src/lib/storage.js";

/** In-memory S3: a real S3Client (so lib-storage's Upload can read its config) whose `send` never touches the network. */
function fakeS3(opts: { bucketStatus?: number; bucketErrorName?: string } = {}) {
  const objects = new Map<string, { body: Buffer; contentType?: string }>();
  const multipart = new Map<string, Map<number, Buffer>>();
  const calls: string[] = [];
  const client = new S3Client({
    region: "ap-south-1",
    credentials: { accessKeyId: "AKIAFAKE", secretAccessKey: "fake-secret" },
  });
  const notFound = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
  const toBuffer = async (body: unknown): Promise<Buffer> => {
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof body === "string") return Buffer.from(body);
    const chunks: Buffer[] = [];
    for await (const c of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  };
  let uploadSeq = 0;
  (client as unknown as { send: (cmd: unknown) => Promise<unknown> }).send = async (cmd: unknown) => {
    const input = (cmd as { input: Record<string, unknown> }).input;
    calls.push(`${(cmd as object).constructor.name}:${String(input["Key"] ?? input["Bucket"])}`);
    if (cmd instanceof HeadBucketCommand) {
      if (opts.bucketStatus)
        throw Object.assign(new Error("bucket"), {
          name: opts.bucketErrorName ?? "NotFound",
          $metadata: { httpStatusCode: opts.bucketStatus },
        });
      return {};
    }
    const key = `${String(input["Bucket"])}/${String(input["Key"])}`;
    if (cmd instanceof PutObjectCommand) {
      objects.set(key, { body: await toBuffer(input["Body"]), contentType: input["ContentType"] as string });
      return { ETag: '"x"' };
    }
    if (cmd instanceof CreateMultipartUploadCommand) {
      const id = `u${++uploadSeq}`;
      multipart.set(id, new Map());
      return { UploadId: id };
    }
    if (cmd instanceof UploadPartCommand) {
      multipart.get(String(input["UploadId"]))!.set(Number(input["PartNumber"]), await toBuffer(input["Body"]));
      return { ETag: `"p${String(input["PartNumber"])}"` };
    }
    if (cmd instanceof CompleteMultipartUploadCommand) {
      const parts = multipart.get(String(input["UploadId"]))!;
      objects.set(key, { body: Buffer.concat([...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b)) });
      return { Location: key };
    }
    if (cmd instanceof AbortMultipartUploadCommand) return {};
    if (cmd instanceof HeadObjectCommand) {
      if (!objects.has(key)) throw notFound("NotFound");
      return { ContentLength: objects.get(key)!.body.length };
    }
    if (cmd instanceof GetObjectCommand) {
      const o = objects.get(key);
      if (!o) throw notFound("NoSuchKey");
      return { Body: Readable.from([o.body]) };
    }
    if (cmd instanceof DeleteObjectCommand) {
      objects.delete(key);
      return {};
    }
    throw new Error(`unexpected command ${(cmd as object).constructor.name}`);
  };
  return { client: client as S3ClientLike, objects, calls };
}

const settings = { bucket: "kkt-docs", region: "ap-south-1" };

describe("S3 storage driver (fake client, no network)", () => {
  it("puts, reads, streams, checks existence and removes objects", async () => {
    const s3 = fakeS3();
    const store = new S3Storage(settings, { client: s3.client });
    await store.put("c1/2026/10/a.pdf", Buffer.from("%PDF-1.4 hello"), "application/pdf");
    expect(s3.objects.get("kkt-docs/c1/2026/10/a.pdf")?.contentType).toBe("application/pdf");
    expect((await store.get("c1/2026/10/a.pdf")).toString()).toBe("%PDF-1.4 hello");
    const chunks: Buffer[] = [];
    for await (const c of await store.stream("c1/2026/10/a.pdf")) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("%PDF-1.4 hello");
    expect(await store.exists("c1/2026/10/a.pdf")).toBe(true);
    expect(await store.exists("c1/2026/10/missing.pdf")).toBe(false);
    await store.remove("c1/2026/10/a.pdf");
    expect(await store.exists("c1/2026/10/a.pdf")).toBe(false);
    await expect(store.remove("c1/2026/10/a.pdf")).resolves.toBeUndefined();
  });

  it("missing objects raise StorageNotFoundError with code ENOENT (same as the local driver)", async () => {
    const store = new S3Storage(settings, { client: fakeS3().client });
    const err = await store.get("nope/x.png").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageNotFoundError);
    expect((err as { code: string }).code).toBe("ENOENT");
  });

  it("streams large bodies as a multipart upload with bounded parts", async () => {
    const s3 = fakeS3();
    const store = new S3Storage(settings, { client: s3.client, partSize: 5 * 1024 * 1024 });
    const chunk = Buffer.alloc(1024 * 1024, 7);
    const body = Readable.from(
      (function* () {
        for (let i = 0; i < 12; i++) yield chunk;
      })(),
    );
    await store.putStream("exports/big.csv", body, "text/csv");
    expect(s3.calls.some((c) => c.startsWith("CreateMultipartUploadCommand"))).toBe(true);
    expect(s3.calls.filter((c) => c.startsWith("UploadPartCommand")).length).toBe(3);
    expect(s3.objects.get("kkt-docs/exports/big.csv")?.body.length).toBe(12 * 1024 * 1024);
  });

  it("applies the key prefix and rejects unsafe keys before any request", async () => {
    const s3 = fakeS3();
    const store = new S3Storage({ ...settings, prefix: "/kkt/prod/" }, { client: s3.client });
    await store.put("a/b.txt", Buffer.from("x"), "text/plain");
    expect(s3.objects.has("kkt-docs/kkt/prod/a/b.txt")).toBe(true);
    await expect(store.put("../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow(/Unsafe storage key/);
    await expect(store.exists("/abs/key")).rejects.toThrow(/Unsafe storage key/);
    expect(s3.calls.filter((c) => c.includes("passwd"))).toEqual([]);
  });

  it("presigns GET links with disposition and a bounded lifetime", async () => {
    const seen: { key?: string; disposition?: string; expiresIn?: number } = {};
    const store = new S3Storage(settings, {
      client: fakeS3().client,
      presign: async (_c, cmd, o) => {
        seen.key = cmd.input.Key;
        seen.disposition = cmd.input.ResponseContentDisposition;
        seen.expiresIn = o.expiresIn;
        return `https://signed.example/${cmd.input.Key}`;
      },
    });
    expect(await store.signedUrl("c1/x.pdf", { filename: 'Receipt "R-1".pdf', expiresInSeconds: 30 * 24 * 3600 })).toBe(
      "https://signed.example/c1/x.pdf",
    );
    expect(seen.disposition).toBe('attachment; filename="Receipt _R-1_.pdf"');
    expect(seen.expiresIn).toBe(7 * 24 * 3600);
  });

  it("the real presigner produces a SigV4 URL offline", async () => {
    const store = new S3Storage({
      ...settings,
      endpoint: "http://minio:9000",
      accessKeyId: "AKIAFAKE",
      secretAccessKey: "fake-secret",
    });
    const url = new URL(await store.signedUrl("c1/x.pdf", { expiresInSeconds: 60 }));
    expect(url.host).toBe("minio:9000");
    expect(url.pathname).toBe("/kkt-docs/c1/x.pdf"); // path-style for S3-compatible endpoints
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("boot check passes on HeadBucket and fails fast with an actionable message", async () => {
    await expect(new S3Storage(settings, { client: fakeS3().client }).check()).resolves.toBeUndefined();
    await expect(new S3Storage(settings, { client: fakeS3({ bucketStatus: 404 }).client }).check()).rejects.toThrow(
      /kkt-docs.*does not exist.*ap-south-1/,
    );
    await expect(
      new S3Storage(settings, { client: fakeS3({ bucketStatus: 403, bucketErrorName: "Forbidden" }).client }).check(),
    ).rejects.toThrow(/access denied/);
  });

  it("client config: path-style + static keys only when configured", () => {
    expect(s3ClientConfig(settings)).toEqual({ region: "ap-south-1", maxAttempts: 3 });
    expect(
      s3ClientConfig({
        ...settings,
        endpoint: "https://acc.r2.cloudflarestorage.com",
        accessKeyId: "k",
        secretAccessKey: "s",
      }),
    ).toMatchObject({
      endpoint: "https://acc.r2.cloudflarestorage.com",
      forcePathStyle: true,
      credentials: { accessKeyId: "k", secretAccessKey: "s" },
    });
  });
});
