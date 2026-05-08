import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { scrapers } from "@/lib/scrapers";
import { runDownload } from "@/lib/server/font-downloader";

type CrawlQueueItem = {
  url: string;
  depth: number;
};

type CrawlPageResult = {
  url: string;
  depth: number;
  status: number | null;
  ok: boolean;
  contentType: string;
  durationMs: number;
  discoveredLinks: number;
  enqueuedLinks: number;
  matchedCatalogPattern: boolean;
  scraperId?: string;
  scrapedFonts?: number;
  scrapeError?: string;
  downloadedCount?: number;
  skippedCount?: number;
  error?: string;
};

type CrawlCheckpoint = {
  suite: "catalog-crawler";
  version: 1;
  startedAt: string;
  updatedAt: string;
  options: {
    maxPages: number;
    maxDepth: number;
    concurrency: number;
    throttleMs: number;
    scrape: boolean;
    download: boolean;
    domains: string[];
    includePatterns: string[];
    excludePatterns: string[];
  };
  queue: CrawlQueueItem[];
  visited: string[];
  discoveredCatalogUrls: string[];
  results: CrawlPageResult[];
};

const toTimestamp = (date = new Date()): string => date.toISOString().replace(/[:.]/g, "-");

const asNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const readSingleArg = (name: string): string | undefined => {
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === `--${name}`) {
        const next = args[i + 1];
        if (typeof next === "string" && !next.startsWith("--")) return next.trim();
      }
      if (token.startsWith(`--${name}=`)) {
        return token.slice(name.length + 3).trim();
      }
    }
    return undefined;
  };

  const readMultiArg = (name: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === `--${name}`) {
        const next = args[i + 1];
        if (typeof next === "string" && !next.startsWith("--")) out.push(next.trim());
        continue;
      }
      if (token.startsWith(`--${name}=`)) {
        out.push(token.slice(name.length + 3).trim());
      }
    }
    return out.filter(Boolean);
  };

  const seedList = readMultiArg("seed");
  const seedsCsv = readSingleArg("seeds");
  if (seedsCsv) {
    for (const token of seedsCsv.split(",")) {
      const trimmed = token.trim();
      if (trimmed) seedList.push(trimmed);
    }
  }

  const includeArg = readSingleArg("include");
  const excludeArg = readSingleArg("exclude");
  const domainArg = readSingleArg("domains");
  const checkpointFile = readSingleArg("checkpoint-file");
  const reportFile = readSingleArg("report-file");
  const maxPages = Math.max(1, asNumber(readSingleArg("max-pages"), 120));
  const maxDepth = Math.max(0, asNumber(readSingleArg("max-depth"), 3));
  const concurrency = Math.max(1, Math.min(12, asNumber(readSingleArg("concurrency"), 3)));
  const throttleMs = Math.max(0, asNumber(readSingleArg("throttle-ms"), 500));
  const resume = args.includes("--resume");
  const resetCheckpoint = args.includes("--reset-checkpoint");
  const scrape = !args.includes("--no-scrape");
  const download = args.includes("--download");
  const timeoutMs = Math.max(5_000, asNumber(readSingleArg("timeout-ms"), 25_000));

  const includePatterns = includeArg
    ? includeArg.split(",").map((item) => item.trim()).filter(Boolean)
    : ["/typefaces/", "/fonts/", "/font/", "/family/"];
  const excludePatterns = excludeArg
    ? excludeArg.split(",").map((item) => item.trim()).filter(Boolean)
    : ["/cart", "/checkout", "/login", "/account", "/privacy", "/terms", "/cdn-cgi/"];

  const domains = domainArg
    ? domainArg.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    seeds: seedList,
    includePatterns,
    excludePatterns,
    domains,
    checkpointFile,
    reportFile,
    maxPages,
    maxDepth,
    concurrency,
    throttleMs,
    resume,
    resetCheckpoint,
    scrape,
    download,
    timeoutMs
  };
};

const toAbsolutePath = (value: string): string =>
  path.isAbsolute(value) ? value : path.join(process.cwd(), value);

const normalizeUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return value.trim();
  }
};

const shouldSkipByExtension = (value: string): boolean =>
  /\.(?:png|jpe?g|gif|svg|webp|avif|mp4|webm|mp3|wav|pdf|zip|woff2?|otf|ttf)(?:$|\?)/i.test(value);

const toPatternRegex = (token: string): RegExp => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i");
};

const isInterceptPlaceholderUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const token = value.trim().toLowerCase();
  return token === "browser-intercept" || token === "interception-mode";
};

const isDirectFontUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) || /^inline-font:\/\/[a-z0-9]+$/i.test(trimmed);
};

const loadCheckpoint = async (checkpointPath: string): Promise<CrawlCheckpoint | undefined> => {
  try {
    const raw = await readFile(checkpointPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CrawlCheckpoint>;
    if (parsed?.suite !== "catalog-crawler" || parsed?.version !== 1) return undefined;
    if (!Array.isArray(parsed.queue) || !Array.isArray(parsed.visited) || !Array.isArray(parsed.results)) return undefined;

    return {
      suite: "catalog-crawler",
      version: 1,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      options: parsed.options as CrawlCheckpoint["options"],
      queue: parsed.queue,
      visited: parsed.visited.filter((item) => typeof item === "string"),
      discoveredCatalogUrls: Array.isArray(parsed.discoveredCatalogUrls)
        ? parsed.discoveredCatalogUrls.filter((item) => typeof item === "string")
        : [],
      results: parsed.results
    };
  } catch {
    return undefined;
  }
};

const buildHeaders = (referer?: string): HeadersInit => {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
  if (referer) {
    headers.Referer = referer;
    try {
      headers.Origin = new URL(referer).origin;
    } catch {
      // best-effort
    }
  }
  return headers;
};

const shouldRetryStatus = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500;

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const cause = (error as any).cause;
    if (cause && typeof cause === "object" && typeof (cause as any).message === "string") {
      return `${error.message}: ${(cause as any).message}`;
    }
    return error.message;
  }
  return String(error);
};

const fetchWithRetry = async (params: {
  url: string;
  timeoutMs: number;
  headers: HeadersInit;
  attempts?: number;
}): Promise<Response> => {
  const attempts = Math.max(1, params.attempts ?? 3);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(params.url, {
        method: "GET",
        redirect: "follow",
        headers: params.headers,
        signal: AbortSignal.timeout(params.timeoutMs),
        cache: "no-store"
      });

      if (!shouldRetryStatus(response.status) || attempt === attempts - 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }

  throw lastError instanceof Error ? lastError : new Error(`fetch failed for ${params.url}`);
};

async function run() {
  const options = parseArgs();
  if (options.seeds.length === 0 && options.domains.length > 0) {
    for (const domain of options.domains) {
      const normalized = domain.trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
      if (!normalized) continue;
      options.seeds.push(`https://${normalized}/`);
    }
  }

  if (options.seeds.length === 0) {
    const fallbackSeed = "https://blazetype.eu/typefaces/";
    options.seeds.push(fallbackSeed);
    if (options.domains.length === 0) {
      options.domains.push("blazetype.eu");
    }
    console.warn(`[catalog-crawler] no seed provided, defaulting to ${fallbackSeed}`);
  }

  const startedAt = new Date();
  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });

  const reportPath = toAbsolutePath(
    options.reportFile && options.reportFile.trim()
      ? options.reportFile
      : path.join("tasks", "reports", `catalog-crawler-${toTimestamp(startedAt)}.json`)
  );
  const checkpointPath = toAbsolutePath(
    options.checkpointFile && options.checkpointFile.trim()
      ? options.checkpointFile
      : path.join("tasks", "reports", "catalog-crawler-checkpoint.json")
  );
  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(checkpointPath), { recursive: true });

  if (options.resetCheckpoint) {
    await unlink(checkpointPath).catch(() => undefined);
  }

  const allowedDomains = new Set<string>(
    options.domains.length > 0
      ? options.domains
      : options.seeds
          .map((seed) => {
            try {
              return new URL(seed).host.toLowerCase();
            } catch {
              return "";
            }
          })
          .filter(Boolean)
  );

  const includeRegex = options.includePatterns.map((token) => toPatternRegex(token));
  const excludeRegex = options.excludePatterns.map((token) => toPatternRegex(token));

  let queue: CrawlQueueItem[] = options.seeds.map((seed) => ({ url: normalizeUrl(seed), depth: 0 }));
  const inQueue = new Set(queue.map((item) => item.url));
  const visited = new Set<string>();
  const discoveredCatalogUrls = new Set<string>();
  const results: CrawlPageResult[] = [];

  if (options.resume) {
    const checkpoint = await loadCheckpoint(checkpointPath);
    if (checkpoint) {
      queue = checkpoint.queue.map((item) => ({ url: normalizeUrl(item.url), depth: Math.max(0, item.depth || 0) }));
      inQueue.clear();
      for (const item of queue) inQueue.add(item.url);
      for (const item of checkpoint.visited) visited.add(normalizeUrl(item));
      for (const item of checkpoint.discoveredCatalogUrls) discoveredCatalogUrls.add(normalizeUrl(item));
      for (const item of checkpoint.results) results.push(item);
      console.log(
        `[Resume] checkpoint loaded: visited=${visited.size}, queue=${queue.length}, discoveredCatalog=${discoveredCatalogUrls.size}`
      );
    }
  }

  const shouldCrawlUrl = (candidateUrl: string): boolean => {
    try {
      const parsed = new URL(candidateUrl);
      const host = parsed.host.toLowerCase();
      if (!allowedDomains.has(host)) return false;
      if (!/^https?:$/i.test(parsed.protocol)) return false;
      if (shouldSkipByExtension(parsed.pathname)) return false;
      const href = parsed.toString();
      if (excludeRegex.some((regex) => regex.test(href))) return false;
      return true;
    } catch {
      return false;
    }
  };

  const matchesCatalogPattern = (candidateUrl: string): boolean => {
    if (excludeRegex.some((regex) => regex.test(candidateUrl))) return false;
    return includeRegex.some((regex) => regex.test(candidateUrl));
  };

  const enqueue = (url: string, depth: number) => {
    if (queue.length + visited.size >= options.maxPages) return;
    const normalized = normalizeUrl(url);
    if (!normalized || visited.has(normalized) || inQueue.has(normalized)) return;
    queue.push({ url: normalized, depth });
    inQueue.add(normalized);
  };

  const writeState = async () => {
    const checkpoint: CrawlCheckpoint = {
      suite: "catalog-crawler",
      version: 1,
      startedAt: startedAt.toISOString(),
      updatedAt: new Date().toISOString(),
      options: {
        maxPages: options.maxPages,
        maxDepth: options.maxDepth,
        concurrency: options.concurrency,
        throttleMs: options.throttleMs,
        scrape: options.scrape,
        download: options.download,
        domains: Array.from(allowedDomains),
        includePatterns: options.includePatterns,
        excludePatterns: options.excludePatterns
      },
      queue,
      visited: Array.from(visited),
      discoveredCatalogUrls: Array.from(discoveredCatalogUrls),
      results
    };

    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          suite: "catalog-crawler",
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          summary: {
            visited: visited.size,
            queued: queue.length,
            discoveredCatalogUrls: discoveredCatalogUrls.size,
            resultCount: results.length,
            okCount: results.filter((item) => item.ok).length,
            failCount: results.filter((item) => !item.ok).length
          },
          options: {
            ...options,
            domains: Array.from(allowedDomains),
            checkpointPath: path.relative(process.cwd(), checkpointPath)
          },
          results
        },
        null,
        2
      ),
      "utf8"
    );
  };

  let writeQueue = Promise.resolve();
  const scheduleWriteState = async () => {
    writeQueue = writeQueue.then(writeState).catch(() => undefined);
    await writeQueue;
  };

  let throttleQueue = Promise.resolve();
  const applyThrottle = async () => {
    throttleQueue = throttleQueue.then(async () => {
      if (options.throttleMs <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, options.throttleMs));
    });
    await throttleQueue;
  };

  const scrapeAndMaybeDownload = async (url: string): Promise<Partial<CrawlPageResult>> => {
    const scraper = scrapers.find((item) => item.canHandle(url));
    if (!scraper) return {};

    try {
      const scraped = await scraper.scrape(url);
      const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
      const output: Partial<CrawlPageResult> = {
        scraperId: scraper.id,
        scrapedFonts: fonts.length
      };

      if (!options.download || fonts.length === 0) return output;

      const hasPlaceholder = fonts.some((font) => isInterceptPlaceholderUrl(font?.url));
      const directFonts = fonts.filter((font) => isDirectFontUrl(font?.url));
      const targetUrl = scraped.targetUrl || scraped.originalUrl || url;
      const outputFolder = `catalog-crawler-${toTimestamp()}-${scraper.id}`;

      const downloadResult = await runDownload({
        ...(directFonts.length > 0 && !hasPlaceholder
          ? {
              mode: "batch-direct" as const,
              source: new URL(targetUrl).host,
              fonts: directFonts as any,
              outputFolder,
              metadata: {
                foundry: scraped.foundryName,
                targetUrl,
                fonts,
                ...(scraped.metadata || {})
              }
            }
          : {
              mode: "browser-intercept" as const,
              targetUrl,
              outputFolder,
              expectedCount: scraped.expectedCount,
              injectScript: scraped.injectScript,
              masterFoundry: scraped.masterFoundry,
              metadata: {
                foundry: scraped.foundryName,
                fonts,
                ...(scraped.metadata || {})
              }
            })
      } as any);

      output.downloadedCount = Array.isArray(downloadResult.downloaded) ? downloadResult.downloaded.length : 0;
      output.skippedCount = Array.isArray(downloadResult.skipped) ? downloadResult.skipped.length : 0;
      return output;
    } catch (error) {
      return {
        scraperId: scraper.id,
        scrapeError: error instanceof Error ? error.message : String(error)
      };
    }
  };

  const workers = Array.from({ length: options.concurrency }, (_, index) => index);
  await Promise.all(
    workers.map(async () => {
      while (true) {
        if (visited.size >= options.maxPages) return;
        const item = queue.shift();
        if (!item) return;

        inQueue.delete(item.url);
        if (visited.has(item.url)) continue;
        visited.add(item.url);

        const started = Date.now();
        let status: number | null = null;
        let ok = false;
        let contentType = "";
        let discoveredLinks = 0;
        let enqueuedLinks = 0;
        const matchedCatalogPattern = matchesCatalogPattern(item.url);
        let extra: Partial<CrawlPageResult> = {};
        let errorMessage: string | undefined;

        try {
          await applyThrottle();
          const response = await fetchWithRetry({
            url: item.url,
            timeoutMs: options.timeoutMs,
            headers: buildHeaders(item.url),
            attempts: 3
          });
          status = response.status;
          ok = response.ok;
          contentType = (response.headers.get("content-type") || "").toLowerCase();

          const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
          if (ok && isHtml) {
            const html = await response.text();
            const $ = cheerio.load(html);
            const links = new Set<string>();
            $("a[href]").each((_, el) => {
              const href = $(el).attr("href");
              if (!href) return;
              try {
                const absolute = normalizeUrl(new URL(href, item.url).toString());
                if (shouldCrawlUrl(absolute)) links.add(absolute);
              } catch {
                // ignore malformed href
              }
            });

            discoveredLinks = links.size;
            if (item.depth < options.maxDepth) {
              for (const link of links) {
                if (queue.length + visited.size >= options.maxPages) break;
                if (matchesCatalogPattern(link)) discoveredCatalogUrls.add(link);
                const before = queue.length;
                enqueue(link, item.depth + 1);
                if (queue.length > before) enqueuedLinks += 1;
              }
            }
          }

          if (matchedCatalogPattern) {
            discoveredCatalogUrls.add(item.url);
            if (options.scrape) {
              extra = await scrapeAndMaybeDownload(item.url);
            }
          }
        } catch (error) {
          errorMessage = toErrorMessage(error);
        }

        const result: CrawlPageResult = {
          url: item.url,
          depth: item.depth,
          status,
          ok,
          contentType,
          durationMs: Date.now() - started,
          discoveredLinks,
          enqueuedLinks,
          matchedCatalogPattern,
          ...extra,
          ...(errorMessage ? { error: errorMessage } : {})
        };
        results.push(result);

        const statusLabel = result.ok ? "OK" : "FAIL";
        const scrapeLabel = result.scraperId ? ` scraper=${result.scraperId} fonts=${result.scrapedFonts ?? 0}` : "";
        const downloadLabel =
          typeof result.downloadedCount === "number"
            ? ` downloaded=${result.downloadedCount} skipped=${result.skippedCount ?? 0}`
            : "";
        const errLabel = result.error ? ` error=${result.error}` : result.scrapeError ? ` scrapeError=${result.scrapeError}` : "";
        console.log(
          `[${statusLabel}] depth=${result.depth} url=${result.url} links=${result.discoveredLinks} queued=${queue.length}${scrapeLabel}${downloadLabel}${errLabel}`
        );

        await scheduleWriteState();
      }
    })
  );

  await scheduleWriteState();
  console.log(
    `Catalog crawler report: ${path.relative(process.cwd(), reportPath)} | visited=${visited.size} catalogUrls=${discoveredCatalogUrls.size}`
  );
}

run().catch((error) => {
  console.error("catalog-crawler failed:", error);
  process.exitCode = 1;
});
