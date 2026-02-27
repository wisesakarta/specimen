import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { scrapers } from "@/lib/scrapers";
import type { FontMetadata, ScrapeResult } from "@/lib/scrapers/types";
import { runDownload } from "@/lib/server/font-downloader";
import type { DownloadResult } from "@/lib/types";

type SmokeCase = {
  id: string;
  url: string;
};

type SmokeResult = {
  id: string;
  url: string;
  scraperId?: string;
  scraperName?: string;
  foundryName?: string;
  outputDir?: string;
  downloadedCount: number;
  expectedCount?: number;
  qualityStatus: "pass" | "fail" | "unknown";
  styleCoveragePercent?: number;
  missingStyleCount?: number;
  invalidFonts?: number;
  italicMismatches?: number;
  specimenPdfCount?: number;
  status: "pass" | "fail";
  reasons: string[];
  durationMs: number;
};

const CASES: SmokeCase[] = [
  { id: "jt-javel", url: "https://www.julytype.com/typefaces/jt-javel" },
  { id: "jt-cyrax-sans", url: "https://www.julytype.com/typefaces/jt-cyrax-sans" },
  { id: "jt-cyrax-slab", url: "https://www.julytype.com/typefaces/jt-cyrax-slab" },
  { id: "jt-percy", url: "https://www.julytype.com/typefaces/jt-percy" },
  { id: "jt-peleton", url: "https://www.julytype.com/typefaces/jt-peleton" },
  { id: "jt-picolo", url: "https://www.julytype.com/typefaces/jt-picolo" },
  { id: "jt-multona", url: "https://www.julytype.com/typefaces/jt-multona" }
];

const isHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

const isPlaceholder = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const token = value.trim().toLowerCase();
  return token === "browser-intercept" || token === "interception-mode";
};

const toReportTimestamp = (input = new Date()): string =>
  input.toISOString().replace(/[:.]/g, "-");

const toBatchFont = (font: FontMetadata) => ({
  url: String(font.url),
  family: String(font.family || "julytype"),
  format: font.format,
  style: typeof font.style === "string" ? font.style : undefined,
  weight:
    typeof font.weight === "string" || typeof font.weight === "number"
      ? String(font.weight)
      : undefined,
  metadata: font.metadata || {}
});

const extractQuality = (result: DownloadResult) => {
  const quality = (result.qualityAudit || {}) as Record<string, any>;
  const coverage = (quality.coverage || {}) as Record<string, any>;
  const validation = (quality.validationSnapshot || {}) as Record<string, any>;
  const specimen = (result.specimenAudit || {}) as Record<string, any>;

  return {
    qualityStatus:
      quality.status === "pass" || quality.status === "fail" ? quality.status : "unknown",
    styleCoveragePercent:
      typeof coverage.styleCoveragePercent === "number" ? coverage.styleCoveragePercent : undefined,
    missingStyleCount:
      typeof coverage.missingStyleCount === "number" ? coverage.missingStyleCount : undefined,
    invalidFonts: typeof validation.invalidFonts === "number" ? validation.invalidFonts : undefined,
    italicMismatches:
      typeof validation.italicMismatches === "number" ? validation.italicMismatches : undefined,
    specimenPdfCount:
      typeof specimen.specimenPdfCount === "number" ? specimen.specimenPdfCount : undefined
  };
};

const decidePassFail = (params: {
  downloadedCount: number;
  qualityStatus: "pass" | "fail" | "unknown";
  styleCoveragePercent?: number;
  missingStyleCount?: number;
  invalidFonts?: number;
  italicMismatches?: number;
  expectedCount?: number;
}): { status: "pass" | "fail"; reasons: string[] } => {
  const reasons: string[] = [];

  if (params.downloadedCount <= 0) {
    reasons.push("Tidak ada file yang terdownload.");
  }

  if (params.qualityStatus !== "pass") {
    reasons.push(`Quality audit status = ${params.qualityStatus}.`);
  }

  if (typeof params.styleCoveragePercent === "number" && params.styleCoveragePercent < 99) {
    reasons.push(`Style coverage ${params.styleCoveragePercent}% (<99%).`);
  }

  if (typeof params.missingStyleCount === "number" && params.missingStyleCount > 0) {
    reasons.push(`Masih ada missing styles (${params.missingStyleCount}).`);
  }

  if (typeof params.invalidFonts === "number" && params.invalidFonts > 0) {
    reasons.push(`Ada invalid font files (${params.invalidFonts}).`);
  }

  if (typeof params.italicMismatches === "number" && params.italicMismatches > 0) {
    reasons.push(`Ada italic mismatches (${params.italicMismatches}).`);
  }

  if (
    typeof params.expectedCount === "number" &&
    params.expectedCount > 0 &&
    params.downloadedCount < params.expectedCount
  ) {
    reasons.push(
      `Downloaded files (${params.downloadedCount}) di bawah expected styles (${params.expectedCount}).`
    );
  }

  return {
    status: reasons.length === 0 ? "pass" : "fail",
    reasons
  };
};

async function runCase(testCase: SmokeCase): Promise<SmokeResult> {
  const started = Date.now();

  try {
    const scraper = scrapers.find((item) => item.canHandle(testCase.url));
    if (!scraper) {
      return {
        id: testCase.id,
        url: testCase.url,
        downloadedCount: 0,
        qualityStatus: "unknown",
        status: "fail",
        reasons: ["Tidak ada scraper yang match."],
        durationMs: Date.now() - started
      };
    }

    const scraped: ScrapeResult = await scraper.scrape(testCase.url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    const hasPlaceholder = fonts.some((font) => isPlaceholder(font.url));
    const directFonts = fonts.filter((font) => isHttpUrl(font.url));
    const targetUrl = scraped.targetUrl || scraped.originalUrl;

    const outputFolder = `23.02.2026-julytype-testing/${testCase.id}`;

    const downloadResult = await runDownload(
      hasPlaceholder || directFonts.length === 0
        ? {
            mode: "browser-intercept",
            targetUrl,
            outputFolder,
            expectedCount: scraped.expectedCount,
            injectScript: scraped.injectScript,
            masterFoundry: scraped.masterFoundry,
            metadata: {
              foundry: scraped.foundryName,
              family: fonts[0]?.metadata?.family || fonts[0]?.family || testCase.id,
              fonts,
              targetProfile: scraped.metadata?.targetProfile,
              specimenPdfUrls: scraped.metadata?.specimenPdfUrls
            }
          }
        : {
            mode: "browser-intercept",
            targetUrl,
            outputFolder,
            expectedCount: scraped.expectedCount,
            injectScript: scraped.injectScript,
            masterFoundry: scraped.masterFoundry,
            metadata: {
              foundry: scraped.foundryName,
              family: fonts[0]?.metadata?.family || fonts[0]?.family || testCase.id,
              fonts: directFonts.map(toBatchFont),
              targetProfile: scraped.metadata?.targetProfile,
              specimenPdfUrls: scraped.metadata?.specimenPdfUrls
            }
          }
    );

    const downloadedCount = Array.isArray(downloadResult.downloaded)
      ? downloadResult.downloaded.length
      : 0;
    const quality = extractQuality(downloadResult);
    const qualityDecision = decidePassFail({
      downloadedCount,
      qualityStatus: quality.qualityStatus,
      styleCoveragePercent: quality.styleCoveragePercent,
      missingStyleCount: quality.missingStyleCount,
      invalidFonts: quality.invalidFonts,
      italicMismatches: quality.italicMismatches,
      expectedCount: scraped.expectedCount
    });

    return {
      id: testCase.id,
      url: testCase.url,
      scraperId: scraper.id,
      scraperName: scraper.name,
      foundryName: scraped.foundryName,
      outputDir: downloadResult.outputDir,
      downloadedCount,
      expectedCount: scraped.expectedCount,
      qualityStatus: quality.qualityStatus,
      styleCoveragePercent: quality.styleCoveragePercent,
      missingStyleCount: quality.missingStyleCount,
      invalidFonts: quality.invalidFonts,
      italicMismatches: quality.italicMismatches,
      specimenPdfCount: quality.specimenPdfCount,
      status: qualityDecision.status,
      reasons: qualityDecision.reasons,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      id: testCase.id,
      url: testCase.url,
      downloadedCount: 0,
      qualityStatus: "unknown",
      status: "fail",
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started
    };
  }
}

async function run() {
  const startedAt = new Date();
  const results: SmokeResult[] = [];

  console.log(`[SMOKE][JulyType] Start at ${startedAt.toISOString()}`);
  for (const testCase of CASES) {
    console.log(`[SMOKE][JulyType] Running ${testCase.id} -> ${testCase.url}`);
    const result = await runCase(testCase);
    results.push(result);
    const reasonText = result.reasons.length ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(
      `[${result.status.toUpperCase()}] ${testCase.id} | files=${result.downloadedCount} | coverage=${
        result.styleCoveragePercent ?? "n/a"
      } | quality=${result.qualityStatus}${reasonText}`
    );
  }

  const summary = {
    total: results.length,
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length
  };

  const report = {
    suite: "smoke-julytype-download",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `smoke-julytype-download-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`[SMOKE][JulyType] Report: ${path.relative(process.cwd(), reportPath)}`);
  console.log(
    `[SMOKE][JulyType] Summary: passed=${summary.passed} failed=${summary.failed} total=${summary.total}`
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("[SMOKE][JulyType] Fatal:", error);
  process.exitCode = 1;
});

