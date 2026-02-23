import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type InlineFontAssetFormat = "woff2" | "woff" | "ttf" | "otf" | "zip";

export type InlineFontAsset = {
  token: string;
  buffer: Buffer;
  format: InlineFontAssetFormat;
  contentType?: string;
  fileNameHint?: string;
  foundry?: string;
  family?: string;
  createdAt: number;
  expiresAt: number;
};

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_CACHE_ENTRIES = 512;
const cache = new Map<string, InlineFontAsset>();
const DISK_CACHE_DIR = path.join(process.cwd(), ".temp-inline-font-cache");

const ensureDiskCacheDir = (): void => {
  if (!fs.existsSync(DISK_CACHE_DIR)) {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
  }
};

const diskDataPathFor = (token: string): string => path.join(DISK_CACHE_DIR, `${token}.bin`);
const diskMetaPathFor = (token: string): string => path.join(DISK_CACHE_DIR, `${token}.json`);

const safeUnlink = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best-effort cleanup
  }
};

const removeDiskAsset = (token: string): void => {
  safeUnlink(diskDataPathFor(token));
  safeUnlink(diskMetaPathFor(token));
};

const persistDiskAsset = (item: InlineFontAsset): void => {
  try {
    ensureDiskCacheDir();
    fs.writeFileSync(diskDataPathFor(item.token), item.buffer);
    fs.writeFileSync(
      diskMetaPathFor(item.token),
      JSON.stringify(
        {
          token: item.token,
          format: item.format,
          contentType: item.contentType,
          fileNameHint: item.fileNameHint,
          foundry: item.foundry,
          family: item.family,
          createdAt: item.createdAt,
          expiresAt: item.expiresAt
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    // best-effort persistence; in-memory cache still works.
  }
};

const loadDiskAsset = (token: string): InlineFontAsset | undefined => {
  try {
    ensureDiskCacheDir();
    const metaPath = diskMetaPathFor(token);
    const dataPath = diskDataPathFor(token);
    if (!fs.existsSync(metaPath) || !fs.existsSync(dataPath)) return undefined;

    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Partial<InlineFontAsset>;
    const expiresAt = Number(parsed?.expiresAt || 0);
    if (!expiresAt || expiresAt <= Date.now()) {
      removeDiskAsset(token);
      return undefined;
    }

    const format = parsed?.format;
    if (format !== "woff2" && format !== "woff" && format !== "ttf" && format !== "otf" && format !== "zip") {
      return undefined;
    }

    const buffer = fs.readFileSync(dataPath);
    const createdAt = Number(parsed?.createdAt || Date.now());
    const item: InlineFontAsset = {
      token,
      buffer,
      format,
      contentType: typeof parsed?.contentType === "string" ? parsed.contentType : undefined,
      fileNameHint: typeof parsed?.fileNameHint === "string" ? parsed.fileNameHint : undefined,
      foundry: typeof parsed?.foundry === "string" ? parsed.foundry : undefined,
      family: typeof parsed?.family === "string" ? parsed.family : undefined,
      createdAt,
      expiresAt
    };
    return item;
  } catch {
    return undefined;
  }
};

const purgeDiskExpired = (now = Date.now()): void => {
  try {
    ensureDiskCacheDir();
    const metaFiles = fs
      .readdirSync(DISK_CACHE_DIR)
      .filter((fileName) => fileName.toLowerCase().endsWith(".json"));

    for (const metaFile of metaFiles) {
      const token = metaFile.slice(0, -5);
      if (!token) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(DISK_CACHE_DIR, metaFile), "utf8")) as {
          expiresAt?: unknown;
          createdAt?: unknown;
        };
        const expiresAt = Number(parsed?.expiresAt || 0);
        if (!expiresAt || expiresAt <= now) {
          removeDiskAsset(token);
          cache.delete(token);
        }
      } catch {
        removeDiskAsset(token);
        cache.delete(token);
      }
    }
  } catch {
    // best-effort purge
  }
};

const trimDiskOversized = (): void => {
  try {
    ensureDiskCacheDir();
    const entries = fs
      .readdirSync(DISK_CACHE_DIR)
      .filter((fileName) => fileName.toLowerCase().endsWith(".json"))
      .map((metaFile) => {
        const token = metaFile.slice(0, -5);
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(DISK_CACHE_DIR, metaFile), "utf8")) as {
            createdAt?: unknown;
          };
          return { token, createdAt: Number(parsed?.createdAt || 0) };
        } catch {
          return { token, createdAt: 0 };
        }
      })
      .filter((entry) => entry.token);

    if (entries.length <= MAX_CACHE_ENTRIES) return;
    entries.sort((a, b) => a.createdAt - b.createdAt);
    const removeCount = entries.length - MAX_CACHE_ENTRIES;
    for (let i = 0; i < removeCount; i += 1) {
      const token = entries[i]?.token;
      if (!token) continue;
      removeDiskAsset(token);
      cache.delete(token);
    }
  } catch {
    // best-effort trim
  }
};

const purgeExpired = (now = Date.now()): void => {
  for (const [token, item] of cache.entries()) {
    if (item.expiresAt <= now) {
      cache.delete(token);
      removeDiskAsset(token);
    }
  }
};

const trimOversized = (): void => {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const removeCount = cache.size - MAX_CACHE_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    const token = entries[i]?.[0];
    if (token) cache.delete(token);
  }
};

const maintain = (): void => {
  purgeExpired();
  trimOversized();
  purgeDiskExpired();
  trimDiskOversized();
};

export const putInlineFontAsset = (params: {
  buffer: Buffer;
  format: InlineFontAssetFormat;
  contentType?: string;
  fileNameHint?: string;
  foundry?: string;
  family?: string;
  ttlMs?: number;
}): string => {
  maintain();
  const now = Date.now();
  const ttlMs = Number.isFinite(params.ttlMs) && (params.ttlMs as number) > 0
    ? Math.floor(params.ttlMs as number)
    : CACHE_TTL_MS;
  const token = crypto.randomBytes(18).toString("hex");

  cache.set(token, {
    token,
    buffer: params.buffer,
    format: params.format,
    contentType: params.contentType,
    fileNameHint: params.fileNameHint,
    foundry: params.foundry,
    family: params.family,
    createdAt: now,
    expiresAt: now + ttlMs
  });

  const item = cache.get(token);
  if (item) persistDiskAsset(item);

  maintain();
  return token;
};

export const getInlineFontAsset = (token: string): InlineFontAsset | undefined => {
  if (typeof token !== "string" || !token.trim()) return undefined;
  maintain();
  const safeToken = token.trim();
  const inMemory = cache.get(safeToken);
  if (inMemory) return inMemory;

  const fromDisk = loadDiskAsset(safeToken);
  if (fromDisk) {
    cache.set(safeToken, fromDisk);
    trimOversized();
    return fromDisk;
  }

  return undefined;
};
