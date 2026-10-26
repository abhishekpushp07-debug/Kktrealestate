import { createReadStream, createWriteStream } from "node:fs";
import { access, constants, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

/** Options of a presigned download link. */
export interface SignedUrlOptions {
  /** Lifetime of the link (default 300 s, max 7 days). */
  expiresInSeconds?: number;
  /** `Content-Disposition: attachment; filename=…` on the response. */
  filename?: string;
  /** `Content-Type` override on the response. */
  contentType?: string;
}

/**
 * Object storage abstraction: local disk (single host, development) or any S3-compatible store (AWS S3, MinIO, Cloudflare R2). Keys are
 * uuid-based and validated, never user supplied.
 */
export interface Storage {
  readonly driver: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Streams `body` into the object (multipart upload on S3, so memory stays bounded for large files). */
  putStream(key: string, body: Readable, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /**
   * A presigned GET URL straight to the object store (S3), or `null` when the driver cannot sign (local disk: callers fall back to their
   * API-signed download link).
   */
  signedUrl(key: string, opts?: SignedUrlOptions): Promise<string | null>;
  /** Boot check: throws a clear, actionable error when the store is unusable (bucket missing, no credentials, directory not writable). */
  check(): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9/_-]+(\.[a-z0-9]+)?$/i;

/** Rejects keys that could escape the storage root or carry odd characters. */
export function assertKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.startsWith("/")) throw new Error(`Unsafe storage key: ${key}`);
}

/** Error thrown for a missing object (same `code` as the local driver's ENOENT so callers handle both drivers alike). */
export class StorageNotFoundError extends Error {
  /** Node's errno code (not an API error code). */
  readonly code: string;
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageNotFoundError";
    this.code = "ENOENT";
  }
}

class LocalStorage implements Storage {
  readonly driver = "local" as const;
  constructor(private readonly root: string) {}
  private path(key: string): string {
    assertKey(key);
    return resolve(join(this.root, key));
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async putStream(key: string, body: Readable): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline(body, createWriteStream(p));
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async stream(key: string): Promise<Readable> {
    return createReadStream(this.path(key));
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async signedUrl(key: string): Promise<string | null> {
    assertKey(key);
    return null;
  }
  async check(): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root, constants.W_OK | constants.R_OK);
    } catch (err) {
      throw new Error(
        `Storage: local directory ${this.root} is not writable (${(err as NodeJS.ErrnoException).code ?? "error"}); set STORAGE_LOCAL_DIR or STORAGE_DRIVER=s3`,
        { cause: err },
      );
    }
  }
}

/** The subset of the AWS SDK client the S3 driver uses (tests inject an S3Client whose `send` is replaced by an in-memory fake). */
export type S3ClientLike = Pick<S3Client, "send" | "config">;

/** Settings of the S3 driver (from STORAGE_DRIVER=s3 + S3_* variables). */
export interface S3StorageSettings {
  bucket: string;
  region: string;
  /** S3-compatible endpoint (MinIO, R2, …); path-style addressing is used whenever it is set. */
  endpoint?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  /** Key prefix inside the bucket (no leading/trailing slash), e.g. `kkt/prod`. */
  prefix?: string | undefined;
}

/** Dependencies of the S3 driver (all replaceable in tests). */
export interface S3StorageDeps {
  client?: S3ClientLike;
  /** Presigner (default: @aws-sdk/s3-request-presigner getSignedUrl). */
  presign?: (client: S3ClientLike, command: GetObjectCommand, opts: { expiresIn: number }) => Promise<string>;
  /** Multipart part size for streamed uploads (default 8 MiB; S3 minimum 5 MiB). */
  partSize?: number;
}

/** Builds the AWS SDK client config for the settings (exported for tests). */
export function s3ClientConfig(s: S3StorageSettings): S3ClientConfig {
  return {
    region: s.region,
    ...(s.endpoint ? { endpoint: s.endpoint, forcePathStyle: true } : {}),
    ...(s.accessKeyId && s.secretAccessKey
      ? { credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey } }
      : {}),
    maxAttempts: 3,
  };
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  return (
    e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404
  );
}

/** Turns the SDK's response body (a Node Readable with SDK mixins in Node, or a web stream/blob elsewhere) into a Readable. */
function toReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body && typeof (body as ReadableStream).getReader === "function")
    return Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  if (body instanceof Uint8Array || typeof body === "string") return Readable.from([body]);
  throw new Error("Storage: unexpected S3 response body");
}

/** S3-compatible driver (AWS SDK v3): streaming multipart uploads, ranged-free GET streams, HEAD for existence, presigned GET links. */
export class S3Storage implements Storage {
  readonly driver = "s3" as const;
  private readonly client: S3ClientLike;
  private readonly presign: NonNullable<S3StorageDeps["presign"]>;
  private readonly partSize: number;

  constructor(
    private readonly settings: S3StorageSettings,
    deps: S3StorageDeps = {},
  ) {
    this.client = deps.client ?? new S3Client(s3ClientConfig(settings));
    this.presign = deps.presign ?? ((client, command, opts) => getSignedUrl(client as S3Client, command, opts));
    this.partSize = Math.max(5 * 1024 * 1024, deps.partSize ?? 8 * 1024 * 1024);
  }

  /** Object key inside the bucket. */
  objectKey(key: string): string {
    assertKey(key);
    const prefix = (this.settings.prefix ?? "").replace(/^\/+|\/+$/g, "");
    return prefix ? `${prefix}/${key}` : key;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.upload(key, data, contentType);
  }

  async putStream(key: string, body: Readable, contentType: string): Promise<void> {
    await this.upload(key, body, contentType);
  }

  private async upload(key: string, body: Buffer | Readable, contentType: string): Promise<void> {
    const upload = new Upload({
      client: this.client as S3Client,
      params: { Bucket: this.settings.bucket, Key: this.objectKey(key), Body: body, ContentType: contentType },
      partSize: this.partSize,
      queueSize: 4,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async get(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.stream(key))
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  async stream(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.settings.bucket, Key: this.objectKey(key) }),
      );
      return toReadable(res.Body);
    } catch (err) {
      if (isNotFound(err)) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: this.objectKey(key) }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    // DeleteObject is idempotent on S3: a missing key is not an error.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: this.objectKey(key) }));
  }

  async signedUrl(key: string, opts: SignedUrlOptions = {}): Promise<string> {
    const expiresIn = Math.min(Math.max(1, Math.floor(opts.expiresInSeconds ?? 300)), 7 * 24 * 3600);
    const command = new GetObjectCommand({
      Bucket: this.settings.bucket,
      Key: this.objectKey(key),
      ...(opts.filename
        ? { ResponseContentDisposition: `attachment; filename="${opts.filename.replace(/[^\w.\- ]+/g, "_")}"` }
        : {}),
      ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
    });
    return this.presign(this.client, command, { expiresIn });
  }

  async check(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
    } catch (err) {
      const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      const status = e.$metadata?.httpStatusCode;
      const hint =
        status === 404 || e.name === "NotFound" || e.name === "NoSuchBucket"
          ? "the bucket does not exist"
          : status === 403 || e.name === "Forbidden" || e.name === "AccessDenied"
            ? "access denied (check S3_ACCESS_KEY/S3_SECRET_KEY or the IAM role's s3:ListBucket on the bucket)"
            : status === 301
              ? "the bucket is in another region (check S3_REGION)"
              : `${e.name ?? "error"}: ${e.message ?? "unknown"}`;
      throw new Error(
        `Storage: S3 bucket "${this.settings.bucket}" is not usable — ${hint} (region ${this.settings.region}${this.settings.endpoint ? `, endpoint ${this.settings.endpoint}` : ""}). Fix S3_* or set STORAGE_DRIVER=local.`,
        { cause: err },
      );
    }
  }
}

/** Settings of the S3 driver from the validated configuration. */
export function s3SettingsFromConfig(c: typeof config = config): S3StorageSettings {
  return {
    bucket: c.S3_BUCKET ?? "",
    region: c.S3_REGION ?? "",
    endpoint: c.S3_ENDPOINT,
    accessKeyId: c.S3_ACCESS_KEY,
    secretAccessKey: c.S3_SECRET_KEY,
    prefix: process.env["S3_PREFIX"],
  };
}

let sharedS3: S3Storage | null = null;

/**
 * Builds the configured storage driver (STORAGE_DRIVER). The S3 driver shares one SDK client (connection pool) per process. Call
 * `check()` once at boot (server.ts does) so a misconfigured store fails fast instead of on the first upload.
 */
export function createStorage(): Storage {
  if (config.STORAGE_DRIVER === "s3") {
    sharedS3 ??= new S3Storage(s3SettingsFromConfig());
    return sharedS3;
  }
  return new LocalStorage(resolve(config.STORAGE_LOCAL_DIR));
}
