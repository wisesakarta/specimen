import type { Browser } from "puppeteer";

type BrowserSessionEntry = {
  browser: Browser;
  key: string;
  createdAt: number;
  lastUsedAt: number;
  uses: number;
  inUse: boolean;
  maxUses: number;
  ttlMs: number;
};

export type BrowserSessionHandle = {
  browser: Browser;
  key: string;
  reused: boolean;
  pooled: boolean;
  release: (options?: { discard?: boolean }) => Promise<void>;
};

type AcquireBrowserSessionParams = {
  key: string;
  createBrowser: () => Promise<Browser>;
  enabled: boolean;
  maxUses?: number;
  ttlMs?: number;
};

const pool = new Map<string, BrowserSessionEntry>();
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_USES = 12;

const normalizeMaxUses = (value: number | undefined): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_USES;
  return Math.max(1, Math.floor(parsed));
};

const normalizeTtlMs = (value: number | undefined): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_MS;
  return Math.max(30_000, Math.floor(parsed));
};

const isExpired = (entry: BrowserSessionEntry, now: number): boolean => {
  if (entry.uses >= entry.maxUses) return true;
  return now - entry.lastUsedAt > entry.ttlMs;
};

const closeEntry = async (entry: BrowserSessionEntry): Promise<void> => {
  try {
    await entry.browser.close();
  } catch {
    // best effort
  }
};

const cleanupExpired = async (): Promise<void> => {
  const now = Date.now();
  for (const [key, entry] of pool.entries()) {
    if (entry.inUse) continue;
    if (!isExpired(entry, now)) continue;
    pool.delete(key);
    await closeEntry(entry);
  }
};

const buildHandle = (
  entry: BrowserSessionEntry,
  params: {
    pooled: boolean;
    reused: boolean;
  }
): BrowserSessionHandle => {
  const release = async (options?: { discard?: boolean }) => {
    const discard = options?.discard === true;
    if (!params.pooled) {
      try {
        await entry.browser.close();
      } catch {
        // best effort
      }
      return;
    }

    const current = pool.get(entry.key);
    if (!current) {
      try {
        await entry.browser.close();
      } catch {
        // best effort
      }
      return;
    }

    current.inUse = false;
    current.lastUsedAt = Date.now();
    current.uses += 1;

    if (discard || isExpired(current, current.lastUsedAt)) {
      pool.delete(current.key);
      await closeEntry(current);
    }
  };

  return {
    browser: entry.browser,
    key: entry.key,
    reused: params.reused,
    pooled: params.pooled,
    release
  };
};

export const acquireBrowserSession = async (
  params: AcquireBrowserSessionParams
): Promise<BrowserSessionHandle> => {
  await cleanupExpired();

  const enabled = params.enabled;
  const maxUses = normalizeMaxUses(params.maxUses);
  const ttlMs = normalizeTtlMs(params.ttlMs);

  if (!enabled) {
    const browser = await params.createBrowser();
    const entry: BrowserSessionEntry = {
      browser,
      key: params.key,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      uses: 0,
      inUse: true,
      maxUses,
      ttlMs
    };
    return buildHandle(entry, { pooled: false, reused: false });
  }

  const existing = pool.get(params.key);
  if (existing && !existing.inUse && !isExpired(existing, Date.now())) {
    existing.inUse = true;
    existing.lastUsedAt = Date.now();
    return buildHandle(existing, { pooled: true, reused: true });
  }

  if (existing && !existing.inUse) {
    pool.delete(existing.key);
    await closeEntry(existing);
  }

  // If the keyed entry is in-use, do not block. We spawn a one-off browser and avoid pooling it.
  if (existing?.inUse) {
    const browser = await params.createBrowser();
    const entry: BrowserSessionEntry = {
      browser,
      key: `${params.key}#oneshot-${Date.now()}`,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      uses: 0,
      inUse: true,
      maxUses,
      ttlMs
    };
    return buildHandle(entry, { pooled: false, reused: false });
  }

  const browser = await params.createBrowser();
  const entry: BrowserSessionEntry = {
    browser,
    key: params.key,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    uses: 0,
    inUse: true,
    maxUses,
    ttlMs
  };
  pool.set(params.key, entry);
  return buildHandle(entry, { pooled: true, reused: false });
};

export const closeAllBrowserSessions = async (): Promise<void> => {
  const entries = Array.from(pool.values());
  pool.clear();
  for (const entry of entries) {
    await closeEntry(entry);
  }
};
