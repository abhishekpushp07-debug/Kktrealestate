import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { config } from "../config.js";

/** Object storage abstraction: local disk now, S3-compatible later (same interface). Keys are uuid-based, never user supplied. */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9/_-]+(\.[a-z0-9]+)?$/i;

function assertKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${key}`);
}

class LocalStorage implements Storage {
  constructor(private readonly root: string) {}
  private path(key: string): string { assertKey(key); return resolve(join(this.root, key)); }
  async put(key: string, data: Buffer): Promise<void> { const p = this.path(key); await mkdir(dirname(p), { recursive: true }); await writeFile(p, data); }
  async get(key: string): Promise<Buffer> { return readFile(this.path(key)); }
  async stream(key: string): Promise<Readable> { return createReadStream(this.path(key)); }
  async exists(key: string): Promise<boolean> { try { await stat(this.path(key)); return true; } catch { return false; } }
  async remove(key: string): Promise<void> { await rm(this.path(key), { force: true }); }
}

/** Build the configured storage driver. S3 driver can be added here without touching callers. */
export function createStorage(): Storage {
  if (config.STORAGE_DRIVER === "s3") throw new Error("S3 storage driver not bundled in this build; set STORAGE_DRIVER=local or add the S3 adapter (see docs/DEPLOY.md)");
  return new LocalStorage(resolve(config.STORAGE_LOCAL_DIR));
}
