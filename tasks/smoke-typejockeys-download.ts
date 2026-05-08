import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { scrapers } from "@/lib/scrapers";
import type { FontMetadata, ScrapeResult } from "@/lib/scrapers/types";
import { runDownload } from "@/lib/server/font-downloader";
import type { DownloadResult } from "@/lib/types";

type FixtureRoot = {
  slugs?: string[];
};

type SmokeCase = {
  id: string;
  url: string;
};

type ValidationFontRow = Record<string, unknown> & {
  filename?: string;
  glyph_count?: number;
  cmap_entries?: number;
  feature_count?: number;
  opentype_features?: string[];
  is_subetted?: boolean;
  subset_evidence?: string[];
  name_table_ok?: boolean;
  italic_mismatch?: boolean;
  ext_signature_mismatch?: boolean;
  family_name?: string;
  subfamily_name?: string;
  full_name?: string;
  postscript_name?: string;
};

type ValidationReport = {
  summary?: Record<string, unknown> & {
    status?: string;
    total_files?: number;
    valid_fonts?: number;
    invalid_fonts?: number;
    subsetted_fonts?: number;
    name_table_bad_fonts?: number;
    italic_mismatches?: number;
    ext_signature_mismatches?: number;
    average_glyphs?: number;
    average_feature_count?: number;
  };
  subsetted_fonts?: ValidationFontRow[];
  full_fonts?: ValidationFontRow[];
  name_table_bad?: ValidationFontRow[];
  italic_mismatches?: ValidationFontRow[];
  ext_signature_mismatches?: ValidationFontRow[];
};

type DownloadedAuditRow = {
  fileName: string;
  sourceUrl: string;
  requested?: {
    family?: string;
    styleName?: string;
    fullName?: string;
    style?: string;
    weight?: string;
    skuId?: string | null;
    format?: string;
  };
  validation?: ValidationFontRow;
};

type SmokeResult = {
  id: string;
  url: string;
  scraperId?: string;
  scraperName?: string;
  foundryName?: string;
  outputDir?: string;
  downloadedCount: number;
  skippedCount: number;
  qualityStatus: "pass" | "warn" | "fail" | "unknown";
  validationStatus: "pass" | "warn" | "fail" | "unknown";
  invalidFonts?: number;
  italicMismatches?: number;
  nameTableBadFonts?: number;
  subsettedFonts?: number;
  avgGlyphs?: number;
  avgFeatures?: number;
  validationLogPath?: string;
  analysisLogPath?: string;
  qualityLogPath?: string;
  perFontAudit?: DownloadedAuditRow[];
  status: "pass" | "warn" | "fail";
  reasons: string[];
  durationMs: number;
};

const FIXTURE_PATH = "tmp/typejockeys-fontdue-deep.json";
const OUTPUT_ROOT = "2026-03-17-typejockeys-download-audit";

const toReportTimestamp = (input = new Date()): string => input.toISOString().replace(/[:.]/g, "-");

const isHttpUrl = (value: unknown): value is string => typeof value === "string" && /^https?:\/\//i.test(value);

const toBatchFont = (font: FontMetadata, options: { skipConversion: boolean }) => ({
  url: String(font.url),
  family: String(font.family || "typejockeys"),
  format: font.format,
  style: typeof font.style === "string" ? font.style : undefined,
  weight: typeof font.weight === "string" || typeof font.weight === "number" ? String(font.weight) : undefined,
  metadata: {
    ...(font.metadata || {}),
    skipConversion: options.skipConversion
  }
});

const extractQualityStatus = (result: DownloadResult): SmokeResult["qualityStatus"] => {
  const quality = (result.qualityAudit || {}) as Record<string, any>;
  const status = typeof quality.status === "string" ? quality.status : typeof quality.qualityStatus === "string" ? quality.qualityStatus : "";
  if (status === "pass" || status === "warn" || status === "fail") return status;
  return "unknown";
};

const normalizeValidationStatus = (value: unknown): SmokeResult["validationStatus"] => {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (token === "pass" || token === "warn" || token === "fail") return token;
  return "unknown";
};

const safeReadJson = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const indexValidationRowsByFilename = (report: ValidationReport | undefined): Map<string, ValidationFontRow> => {
  const map = new Map<string, ValidationFontRow>();
  if (!report) return map;
  const addMany = (items: ValidationFontRow[] | undefined) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const name = typeof item?.filename === "string" ? item.filename.trim() : "";
      if (!name) continue;
      map.set(name, item);
    }
  };
  addMany(report.full_fonts);
  addMany(report.subsetted_fonts);
  return map;
};

const buildPerFontAudit = (params: {
  scrapedFonts: FontMetadata[];
  downloadResult: DownloadResult;
  validationReport?: ValidationReport;
}): DownloadedAuditRow[] => {
  const { scrapedFonts, downloadResult, validationReport } = params;
  const byUrl = new Map<string, FontMetadata>();
  for (const font of scrapedFonts) {
    const url = typeof font.url === "string" ? font.url.trim() : "";
    if (url) byUrl.set(url, font);
  }

  const validationByFile = indexValidationRowsByFilename(validationReport);
  const rows: DownloadedAuditRow[] = [];
  for (const item of downloadResult.downloaded || []) {
    const requested = byUrl.get(item.sourceUrl);
    const meta = (requested?.metadata || {}) as Record<string, any>;

    rows.push({
      fileName: item.fileName,
      sourceUrl: item.sourceUrl,
      requested: requested
        ? {
            family: requested.family,
            styleName: typeof meta.styleName === "string" ? meta.styleName : undefined,
            fullName: typeof meta.fullName === "string" ? meta.fullName : undefined,
            style: typeof requested.style === "string" ? requested.style : undefined,
            weight:
              typeof requested.weight === "string" || typeof requested.weight === "number"
                ? String(requested.weight)
                : undefined,
            skuId: typeof meta.skuId === "string" ? meta.skuId : meta.skuId === null ? null : undefined,
            format: requested.format
          }
        : undefined,
      validation: validationByFile.get(item.fileName)
    });
  }

  return rows;
};

const decideStatus = (params: {
  downloadedCount: number;
  qualityStatus: SmokeResult["qualityStatus"];
  validationStatus: SmokeResult["validationStatus"];
  invalidFonts?: number;
  italicMismatches?: number;
  skippedCount: number;
}): { status: SmokeResult["status"]; reasons: string[] } => {
  const reasons: string[] = [];

  if (params.downloadedCount <= 0) reasons.push("Tidak ada file yang terdownload.");
  if (params.validationStatus === "fail") reasons.push("Validation status = fail.");
  if (params.qualityStatus === "fail") reasons.push("Quality audit status = fail.");

  if (typeof params.invalidFonts === "number" && params.invalidFonts > 0) {
    reasons.push(`Ada invalid font files (${params.invalidFonts}).`);
  }
  if (typeof params.italicMismatches === "number" && params.italicMismatches > 0) {
    reasons.push(`Ada italic mismatches (${params.italicMismatches}).`);
  }
  if (params.skippedCount > 0) reasons.push(`Ada skipped items (${params.skippedCount}).`);

  if (reasons.length > 0) return { status: "fail", reasons };

  if (params.validationStatus === "warn" || params.qualityStatus === "warn") {
    return { status: "warn", reasons: ["Ada warning pada validation/quality audit."] };
  }

  return { status: "pass", reasons: [] };
};

async function runCase(testCase: SmokeCase): Promise<SmokeResult> {
  const started = Date.now();
  const skipConversion = process.env.TYPEJOCKEYS_SKIP_CONVERSION !== "0";
  const maxFontsPerFamily = Number(process.env.TYPEJOCKEYS_MAX_FONTS_PER_FAMILY || 0);

  try {
    const scraper = scrapers.find((item) => item.canHandle(testCase.url));
    if (!scraper) {
      return {
        id: testCase.id,
        url: testCase.url,
        downloadedCount: 0,
        skippedCount: 0,
        qualityStatus: "unknown",
        validationStatus: "unknown",
        status: "fail",
        reasons: ["Tidak ada scraper yang match."],
        durationMs: Date.now() - started
      };
    }

    const scraped: ScrapeResult = await scraper.scrape(testCase.url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    const directFonts = fonts.filter((font) => isHttpUrl(font.url));

    const trimmedFonts =
      maxFontsPerFamily > 0 ? directFonts.slice(0, Math.max(1, Math.floor(maxFontsPerFamily))) : directFonts;

    const outputFolder = path.join(OUTPUT_ROOT, testCase.id);

    const downloadResult = await runDownload({
      mode: "batch-direct",
      source: scraped.targetUrl || scraped.originalUrl,
      outputFolder,
      fonts: trimmedFonts.map((font) => toBatchFont(font, { skipConversion })),
      metadata: {
        foundry: scraped.foundryName,
        family: fonts[0]?.metadata?.family || fonts[0]?.family || testCase.id,
        fonts: trimmedFonts,
        includeSpecimenPdf: false
      }
    });

    const downloadedCount = Array.isArray(downloadResult.downloaded) ? downloadResult.downloaded.length : 0;
    const skippedCount = Array.isArray(downloadResult.skipped) ? downloadResult.skipped.length : 0;
    const qualityStatus = extractQualityStatus(downloadResult);

    const validationLogPath = typeof downloadResult.validationLogPath === "string" ? downloadResult.validationLogPath : undefined;
    const validationReport = validationLogPath
      ? await safeReadJson<ValidationReport>(path.resolve(process.cwd(), validationLogPath))
      : undefined;
    const summary = (validationReport?.summary || {}) as Record<string, any>;
    const validationStatus = normalizeValidationStatus(summary.status);

    const invalidFonts = typeof summary.invalid_fonts === "number" ? summary.invalid_fonts : undefined;
    const italicMismatches = typeof summary.italic_mismatches === "number" ? summary.italic_mismatches : undefined;
    const nameTableBadFonts = typeof summary.name_table_bad_fonts === "number" ? summary.name_table_bad_fonts : undefined;
    const subsettedFonts = typeof summary.subsetted_fonts === "number" ? summary.subsetted_fonts : undefined;
    const avgGlyphs = typeof summary.average_glyphs === "number" ? summary.average_glyphs : undefined;
    const avgFeatures = typeof summary.average_feature_count === "number" ? summary.average_feature_count : undefined;

    const perFontAudit = buildPerFontAudit({ scrapedFonts: trimmedFonts, downloadResult, validationReport });
    const decision = decideStatus({
      downloadedCount,
      qualityStatus,
      validationStatus,
      invalidFonts,
      italicMismatches,
      skippedCount
    });

    return {
      id: testCase.id,
      url: testCase.url,
      scraperId: scraper.id,
      scraperName: scraper.name,
      foundryName: scraped.foundryName,
      outputDir: downloadResult.outputDir,
      downloadedCount,
      skippedCount,
      qualityStatus,
      validationStatus,
      invalidFonts,
      italicMismatches,
      nameTableBadFonts,
      subsettedFonts,
      avgGlyphs,
      avgFeatures,
      validationLogPath,
      analysisLogPath: downloadResult.analysisLogPath,
      qualityLogPath: downloadResult.qualityLogPath,
      perFontAudit,
      status: decision.status,
      reasons: decision.reasons,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      id: testCase.id,
      url: testCase.url,
      downloadedCount: 0,
      skippedCount: 0,
      qualityStatus: "unknown",
      validationStatus: "unknown",
      status: "fail",
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started
    };
  }
}

async function run() {
  const startedAt = new Date();
  const fixture = await safeReadJson<FixtureRoot>(FIXTURE_PATH);
  const slugs = Array.isArray(fixture?.slugs) ? fixture?.slugs : [];

  const cases: SmokeCase[] = slugs.map((slug) => ({
    id: String(slug),
    url: `https://www.typejockeys.com/en/font/${slug}`
  }));

  if (cases.length === 0) {
    throw new Error(`No slugs found in ${FIXTURE_PATH}`);
  }

  const results: SmokeResult[] = [];
  console.log(`[SMOKE][Typejockeys] Start at ${startedAt.toISOString()}`);
  console.log(`[SMOKE][Typejockeys] Cases=${cases.length} (skipConversion=${process.env.TYPEJOCKEYS_SKIP_CONVERSION !== "0" ? "yes" : "no"})`);

  for (const testCase of cases) {
    console.log(`[SMOKE][Typejockeys] Running ${testCase.id} -> ${testCase.url}`);
    const result = await runCase(testCase);
    results.push(result);

    const reasonText = result.reasons.length ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(
      `[${result.status.toUpperCase()}] ${testCase.id} | files=${result.downloadedCount} | validation=${result.validationStatus} | quality=${result.qualityStatus} | avgGlyphs=${result.avgGlyphs ?? "n/a"}${reasonText}`
    );
  }

  const summary = {
    total: results.length,
    passed: results.filter((item) => item.status === "pass").length,
    warned: results.filter((item) => item.status === "warn").length,
    failed: results.filter((item) => item.status === "fail").length
  };

  const report = {
    suite: "smoke-typejockeys-download",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `smoke-typejockeys-download-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`[SMOKE][Typejockeys] Report: ${path.relative(process.cwd(), reportPath)}`);
  console.log(
    `[SMOKE][Typejockeys] Summary: passed=${summary.passed} warned=${summary.warned} failed=${summary.failed} total=${summary.total}`
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("[SMOKE][Typejockeys] Fatal:", error);
  process.exitCode = 1;
});

