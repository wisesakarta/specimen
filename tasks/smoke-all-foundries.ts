import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runDownload } from "@/lib/server/font-downloader";
import { scrapers } from "@/lib/scrapers";

type AllFoundryCase = {
  id: string;
  name: string;
  url: string;
  expectedScraperId: string;
  minDownloaded: number;
};

type CaseResult = {
  id: string;
  name: string;
  url: string;
  status: "pass" | "fail";
  scraper?: string;
  foundry?: string;
  downloadedCount: number;
  skippedCount: number;
  outputDir?: string;
  validationStatus?: string;
  qualityStatus?: string;
  styleCoveragePercent?: number;
  contaminationFonts?: number;
  invalidFonts?: number;
  italicMismatches?: number;
  reasons: string[];
  durationMs: number;
};

const CASES: AllFoundryCase[] = [
  { id: "205tf", name: "205TF", url: "https://www.205.tf/pinokio-sans", expectedScraperId: "205tf", minDownloaded: 1 },
  { id: "a2-type", name: "A2 Type", url: "https://a2-type.co.uk/ny-sans", expectedScraperId: "a2-type", minDownloaded: 1 },
  { id: "abcdinamo", name: "ABC Dinamo", url: "https://abcdinamo.com/typefaces/gravity", expectedScraperId: "abcdinamo", minDownloaded: 1 },
  { id: "cotype", name: "CoType", url: "https://cotypefoundry.com/font-family/aeonik", expectedScraperId: "cotype", minDownloaded: 1 },
  { id: "lineto", name: "Lineto", url: "https://lineto.com/typefaces/akkurat", expectedScraperId: "lineto", minDownloaded: 1 },
  { id: "pangram", name: "Pangram", url: "https://pangrampangram.com/products/frama", expectedScraperId: "pangram", minDownloaded: 1 },
  { id: "grillitype", name: "Grilli Type", url: "https://www.grillitype.com/typeface/gt-standard", expectedScraperId: "grillitype", minDownloaded: 1 },
  { id: "w-type", name: "W Type", url: "https://wtypefoundry.com/typefaces/wtf-forma", expectedScraperId: "w-type", minDownloaded: 1 },
  { id: "superiortype", name: "Superior Type", url: "https://superiortype.com/fonts/raptor-v3", expectedScraperId: "superiortype", minDownloaded: 1 },
  { id: "swisstypefaces", name: "Swiss Typefaces", url: "https://www.swisstypefaces.com/fonts/sangbleu/", expectedScraperId: "swisstypefaces", minDownloaded: 1 },
  { id: "ohno", name: "Ohno Type Co", url: "https://ohnotype.co/fonts/degular", expectedScraperId: "ohno", minDownloaded: 1 },
  { id: "klim", name: "Klim", url: "https://klim.co.nz/fonts/founders-grotesk/", expectedScraperId: "klim", minDownloaded: 1 },
  { id: "displaay", name: "Displaay", url: "https://displaay.net/typeface/greed", expectedScraperId: "displaay", minDownloaded: 1 },
  { id: "generic", name: "Generic Fallback", url: "https://rsms.me/inter/", expectedScraperId: "generic", minDownloaded: 1 }
];

const toReportTimestamp = (input = new Date()): string =>
  input.toISOString().replace(/[:.]/g, "-");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const strict = !args.includes("--no-strict");
  const phase13 = !args.includes("--no-phase13");
  const only = args.find((arg) => arg.startsWith("--foundry="))?.split("=")[1]?.trim().toLowerCase();
  return { strict, phase13, only };
};

type QualitySnapshot = {
  qualityStatus?: string;
  styleCoveragePercent?: number;
  contaminationFonts?: number;
  invalidFonts?: number;
  italicMismatches?: number;
};

const asFiniteNumber = (value: unknown): number | undefined => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const loadValidationStatus = async (outputDir: string): Promise<string | undefined> => {
  const roots = [
    path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir),
    path.join(process.cwd(), outputDir)
  ];

  for (const root of roots) {
    const validationPath = path.join(root, "validation-log.json");
    try {
      const raw = await readFile(validationPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.summary?.status) return String(parsed.summary.status);
    } catch {
      // best effort
    }
  }
  return undefined;
};

const loadQualitySnapshot = async (outputDir: string): Promise<QualitySnapshot> => {
  const roots = [
    path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir),
    path.join(process.cwd(), outputDir)
  ];

  for (const root of roots) {
    const qualityPath = path.join(root, "quality-log.json");
    try {
      const raw = await readFile(qualityPath, "utf8");
      const parsed = JSON.parse(raw);
      const summary = parsed?.summary || {};
      const coverage = parsed?.coverage || {};
      const validation = parsed?.validationSnapshot || {};

      return {
        qualityStatus:
          (typeof parsed?.qualityStatus === "string" && parsed.qualityStatus) ||
          (typeof parsed?.status === "string" && parsed.status) ||
          undefined,
        styleCoveragePercent:
          asFiniteNumber(summary?.styleCoveragePercent) ??
          asFiniteNumber(coverage?.styleCoveragePercent),
        contaminationFonts:
          asFiniteNumber(validation?.contaminationFonts) ??
          asFiniteNumber(validation?.contamination_fonts),
        invalidFonts:
          asFiniteNumber(validation?.invalidFonts) ??
          asFiniteNumber(validation?.invalid_fonts),
        italicMismatches:
          asFiniteNumber(validation?.italicMismatches) ??
          asFiniteNumber(validation?.italic_mismatches)
      };
    } catch {
      // best effort
    }
  }
  return {};
};

const runCase = async (testCase: AllFoundryCase, options: { strict: boolean; phase13: boolean }): Promise<CaseResult> => {
  const started = Date.now();
  const reasons: string[] = [];

  try {
    const scraper = scrapers.find((item) => item.canHandle(testCase.url));
    if (!scraper) {
      return {
        id: testCase.id,
        name: testCase.name,
        url: testCase.url,
        status: "fail",
        downloadedCount: 0,
        skippedCount: 0,
        reasons: ["No scraper matched target URL."],
        durationMs: Date.now() - started
      };
    }

    if (scraper.id !== testCase.expectedScraperId) {
      reasons.push(`Expected scraper=${testCase.expectedScraperId}, got=${scraper.id}.`);
    }

    const scraped = await scraper.scrape(testCase.url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    if (fonts.length === 0) reasons.push("Scraper returned 0 font candidates.");

    const familyHint =
      scraped.fonts?.[0]?.metadata?.family ||
      scraped.fonts?.[0]?.family ||
      testCase.id;

    const outputFolder = `allfoundries-${testCase.id}-${Date.now()}`;
    const result = await runDownload({
      mode: "browser-intercept",
      targetUrl: scraped.targetUrl || scraped.originalUrl || testCase.url,
      outputFolder,
      expectedCount: scraped.expectedCount,
      injectScript: scraped.injectScript,
      masterFoundry: scraped.masterFoundry,
      metadata: {
        foundry: scraped.foundryName,
        family: familyHint,
        fonts,
        ...(scraped.metadata || {})
      }
    });

    const downloadedCount = Array.isArray(result.downloaded) ? result.downloaded.length : 0;
    const skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;
    const validationStatus = await loadValidationStatus(result.outputDir);
    const quality = await loadQualitySnapshot(result.outputDir);

    if (downloadedCount < testCase.minDownloaded) {
      reasons.push(`Downloaded only ${downloadedCount} files (< ${testCase.minDownloaded}).`);
    }
    if (validationStatus && validationStatus.toLowerCase() === "fail") {
      reasons.push("validation-log status=fail.");
    }
    if (options.phase13) {
      if (!quality.qualityStatus && options.strict) {
        reasons.push("quality-log missing (phase 1.3 strict gate).");
      }
      if (quality.qualityStatus?.toLowerCase() === "fail") {
        reasons.push("quality-log status=fail.");
      } else if (quality.qualityStatus?.toLowerCase() === "warn" && options.strict) {
        reasons.push("quality-log status=warn (phase 1.3 strict gate).");
      }

      if (typeof quality.styleCoveragePercent === "number" && quality.styleCoveragePercent < 90) {
        reasons.push(`style coverage too low (${quality.styleCoveragePercent}%).`);
      }
      if ((quality.invalidFonts || 0) > 0) {
        reasons.push(`invalid fonts detected (${quality.invalidFonts}).`);
      }
      if ((quality.italicMismatches || 0) > 0) {
        reasons.push(`italic mismatches detected (${quality.italicMismatches}).`);
      }
      if (options.strict && (quality.contaminationFonts || 0) > 0) {
        reasons.push(`contamination fonts detected (${quality.contaminationFonts}) in strict phase 1.3 gate.`);
      }
    }
    if (downloadedCount === 0 && skippedCount > 0) {
      const firstReason = result.skipped[0]?.reason;
      if (firstReason) reasons.push(`First skip reason: ${firstReason}`);
    }

    return {
      id: testCase.id,
      name: testCase.name,
      url: testCase.url,
      scraper: scraper.id,
      foundry: scraped.foundryName,
      status: reasons.length === 0 ? "pass" : "fail",
      downloadedCount,
      skippedCount,
      outputDir: result.outputDir,
      validationStatus,
      qualityStatus: quality.qualityStatus,
      styleCoveragePercent: quality.styleCoveragePercent,
      contaminationFonts: quality.contaminationFonts,
      invalidFonts: quality.invalidFonts,
      italicMismatches: quality.italicMismatches,
      reasons,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      id: testCase.id,
      name: testCase.name,
      url: testCase.url,
      status: "fail",
      downloadedCount: 0,
      skippedCount: 0,
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started
    };
  }
};

async function run() {
  const startedAt = new Date();
  const { strict, phase13, only } = parseArgs();

  let selected = CASES;
  if (only) {
    selected = selected.filter((item) => item.id === only || item.id.includes(only));
  }

  if (selected.length === 0) {
    console.error("No cases selected.");
    process.exitCode = 1;
    return;
  }

  const results: CaseResult[] = [];
  for (const testCase of selected) {
    console.log(`Running all-foundries smoke: ${testCase.name} -> ${testCase.url}`);
    const result = await runCase(testCase, { strict, phase13 });
    results.push(result);

    const prefix = result.status === "pass" ? "PASS" : "FAIL";
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(`[${prefix}] ${result.name} scraper=${result.scraper || "-"} downloaded=${result.downloadedCount} skipped=${result.skippedCount}${reason}`);
  }

  const summary = {
    strict,
    phase13,
    total: results.length,
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length
  };

  const report = {
    suite: "all-foundries",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `smoke-all-foundries-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`All foundries report: ${path.relative(process.cwd(), reportPath)}`);

  if (strict && summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("All-foundries smoke failed:", error);
  process.exitCode = 1;
});
