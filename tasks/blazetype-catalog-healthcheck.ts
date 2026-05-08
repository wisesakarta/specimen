import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { BlazeTypeScraper } from "@/lib/scrapers/blazetype";
import { runDownload } from "@/lib/server/font-downloader";

type CatalogItem = {
  slug: string;
  title: string;
  url: string;
};

type ValidationSnapshot = {
  status?: string;
  totalFiles?: number;
  validFonts?: number;
  invalidFonts?: number;
  averageGlyphs?: number;
  averageFeatureCount?: number;
};

type CaseResult = {
  slug: string;
  title: string;
  url: string;
  status: "pass" | "warn" | "fail";
  scrapedFontCount: number;
  expectedStyleCount?: number;
  expectedStylesFromProfile?: number;
  uniqueUrlCount?: number;
  directTtfCount?: number;
  directWoff2Count?: number;
  downloadedCount?: number;
  skippedCount?: number;
  validationStatus?: string;
  validationAverageGlyphs?: number;
  validationAverageFeatureCount?: number;
  reasons: string[];
  durationMs: number;
};

type SuiteReport = {
  suite: "blazetype-catalog-healthcheck";
  startedAt: string;
  finishedAt: string;
  summary: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
    withDownload: boolean;
  };
  results: CaseResult[];
};

const BLAZETYPE_TRIALS_URL = "https://blazetype.eu/trials/";
const BLAZETYPE_ORIGIN = "https://blazetype.eu";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const CONCURRENCY = 6;

const toReportTimestamp = (input = new Date()): string =>
  input.toISOString().replace(/[:.]/g, "-");

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x2f;/gi, "/");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const withDownload = args.includes("--download");
  const limitRaw = args.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
  const slugRaw = args.find((arg) => arg.startsWith("--slug="))?.split("=")[1];

  const limit = typeof limitRaw === "string" && limitRaw.trim() ? Number(limitRaw) : undefined;
  const slug = typeof slugRaw === "string" && slugRaw.trim() ? slugRaw.trim().toLowerCase() : undefined;

  return {
    withDownload,
    limit: typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, limit) : undefined,
    slug
  };
};

const fetchCatalog = async (): Promise<CatalogItem[]> => {
  const response = await fetch(BLAZETYPE_TRIALS_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) {
    throw new Error(`BlazeType catalog fetch failed (${response.status}).`);
  }

  const html = await response.text();
  const decoded = decodeHtmlEntities(html);
  const re =
    /"id":\[0,"typefaces\/([^"]+)"\],"title":\[0,"([^"]+)"\][\s\S]*?"fontfaceCSS":\[0,"\/fonts\/[^"]+\/fontface\.css"\]/gi;

  const out: CatalogItem[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(decoded))) {
    const slug = normalizeSpace(match[1] || "").toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const title = normalizeSpace(decodeHtmlEntities(match[2] || "")) || slug;
    out.push({
      slug,
      title,
      url: `${BLAZETYPE_ORIGIN}/typefaces/${slug}/`
    });
  }

  if (out.length === 0) {
    throw new Error("BlazeType catalog parser returned 0 families.");
  }
  return out;
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

const loadValidationSnapshot = async (outputDir: string): Promise<ValidationSnapshot> => {
  const trimmed = String(outputDir || "").trim();
  const candidates = Array.from(
    new Set(
      [
        path.join(trimmed, "validation-log.json"),
        path.join(process.cwd(), trimmed, "validation-log.json")
      ].filter((value) => value.length > 0)
    )
  );

  for (const validationPath of candidates) {
    try {
      const raw = await readFile(validationPath, "utf8");
      const parsed = JSON.parse(raw);
      const summary = parsed?.summary || {};
      return {
        status: typeof summary.status === "string" ? summary.status : undefined,
        totalFiles: Number.isFinite(Number(summary.total_files)) ? Number(summary.total_files) : undefined,
        validFonts: Number.isFinite(Number(summary.valid_fonts)) ? Number(summary.valid_fonts) : undefined,
        invalidFonts: Number.isFinite(Number(summary.invalid_fonts)) ? Number(summary.invalid_fonts) : undefined,
        averageGlyphs: Number.isFinite(Number(summary.average_glyphs)) ? Number(summary.average_glyphs) : undefined,
        averageFeatureCount: Number.isFinite(Number(summary.average_feature_count))
          ? Number(summary.average_feature_count)
          : undefined
      };
    } catch {
      continue;
    }
  }

  return {};
};

const runCase = async (item: CatalogItem, withDownload: boolean): Promise<CaseResult> => {
  const started = Date.now();
  const reasons: string[] = [];

  try {
    const scraped = await BlazeTypeScraper.scrape(item.url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    const uniqueUrlCount = new Set(fonts.map((font) => String(font?.url || "").trim()).filter(Boolean)).size;
    const expectedStyleCount = typeof scraped.expectedCount === "number" ? scraped.expectedCount : undefined;

    const targetProfile =
      fonts[0]?.metadata?.targetProfile ||
      (typeof scraped.metadata === "object" && scraped.metadata !== null ? (scraped.metadata as any).targetProfile : undefined);
    const expectedStylesFromProfile = Array.isArray(targetProfile?.expectedStyles)
      ? targetProfile.expectedStyles.length
      : undefined;

    const directTtfCount = fonts.filter((font) => String(font?.url || "").toLowerCase().includes(".ttf")).length;
    const directWoff2Count = fonts.filter((font) => String(font?.url || "").toLowerCase().includes(".woff2")).length;

    if (fonts.length === 0) reasons.push("Scraper returned 0 fonts.");
    if (!expectedStyleCount || expectedStyleCount <= 0) reasons.push("Missing expectedStyleCount.");
    if (typeof expectedStyleCount === "number" && typeof expectedStylesFromProfile === "number") {
      if (expectedStyleCount !== expectedStylesFromProfile) {
        reasons.push(
          `expectedCount mismatch: expectedCount=${expectedStyleCount}, targetProfile.expectedStyles=${expectedStylesFromProfile}.`
        );
      }
    }
    if (uniqueUrlCount === 0) reasons.push("No unique downloadable URLs.");
    if (directTtfCount === 0) reasons.push("No direct TTF source detected.");

    let downloadedCount: number | undefined;
    let skippedCount: number | undefined;
    let validationStatus: string | undefined;
    let validationAverageGlyphs: number | undefined;
    let validationAverageFeatureCount: number | undefined;

    if (withDownload) {
      const outputFolder = `blazetype-health-${item.slug}-${Date.now()}`;
      const result = await runDownload({
        mode: "batch-direct",
        source: "blazetype.eu",
        outputFolder,
        fonts: fonts.map((font) => ({
          url: font.url,
          family: font.family,
          format: font.format,
          style: font.style,
          weight: typeof font.weight === "number" ? String(font.weight) : font.weight,
          metadata: font.metadata
        })),
        metadata: {
          foundry: "Blaze Type",
          family: item.title,
          targetUrl: item.url,
          fonts
        }
      } as any);

      downloadedCount = Array.isArray(result.downloaded) ? result.downloaded.length : 0;
      skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;

      const validation = await loadValidationSnapshot(result.outputDir);
      validationStatus = validation.status;
      validationAverageGlyphs = validation.averageGlyphs;
      validationAverageFeatureCount = validation.averageFeatureCount;

      if ((downloadedCount || 0) === 0) reasons.push("Download produced 0 files.");
      if (validationStatus && validationStatus.toLowerCase() === "fail") reasons.push("validation-log status=fail.");
    }

    const hasHardFailure = reasons.some((reason) => /0 fonts|missing expectedstylecount|mismatch|0 files|status=fail/i.test(reason));
    const status: CaseResult["status"] = reasons.length === 0 ? "pass" : hasHardFailure ? "fail" : "warn";

    return {
      slug: item.slug,
      title: item.title,
      url: item.url,
      status,
      scrapedFontCount: fonts.length,
      expectedStyleCount,
      expectedStylesFromProfile,
      uniqueUrlCount,
      directTtfCount,
      directWoff2Count,
      downloadedCount,
      skippedCount,
      validationStatus,
      validationAverageGlyphs,
      validationAverageFeatureCount,
      reasons,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      slug: item.slug,
      title: item.title,
      url: item.url,
      status: "fail",
      scrapedFontCount: 0,
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started
    };
  }
};

async function run() {
  const startedAt = new Date();
  const { withDownload, limit, slug } = parseArgs();

  let catalog = await fetchCatalog();
  if (slug) {
    catalog = catalog.filter((item) => item.slug === slug);
  }
  if (typeof limit === "number") {
    catalog = catalog.slice(0, limit);
  }
  if (catalog.length === 0) {
    throw new Error("No BlazeType cases selected.");
  }

  const results = await runWithConcurrency(catalog, CONCURRENCY, async (item) => runCase(item, withDownload));
  const summary = {
    total: results.length,
    passed: results.filter((result) => result.status === "pass").length,
    warned: results.filter((result) => result.status === "warn").length,
    failed: results.filter((result) => result.status === "fail").length,
    withDownload
  };

  const report: SuiteReport = {
    suite: "blazetype-catalog-healthcheck",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `blazetype-catalog-healthcheck-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`BlazeType catalog report: ${path.relative(process.cwd(), reportPath)}`);
  console.log(
    `Summary: pass=${summary.passed}/${summary.total}, warn=${summary.warned}, fail=${summary.failed}, download=${withDownload}`
  );

  for (const result of results.filter((item) => item.status !== "pass")) {
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(
      `[${result.status.toUpperCase()}] ${result.slug} -> fonts=${result.scrapedFontCount}, expected=${result.expectedStyleCount ?? "-"}${reason}`
    );
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("BlazeType catalog healthcheck failed:", error);
  process.exitCode = 1;
});
