import path from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { runDownload } from "@/lib/server/font-downloader";
import { scrapers } from "@/lib/scrapers";

type GrotesklyCase = {
  id: string;
  url: string;
};

type DirCheck = {
  subdirs: string[];
  rootZipFiles: string[];
  suspiciousStyleHashDirs: string[];
};

type CaseReport = {
  id: string;
  url: string;
  status: "pass" | "fail";
  scraperId?: string;
  foundry?: string;
  downloadedCount: number;
  skippedCount: number;
  outputDir?: string;
  validationStatus?: string;
  dirCheck?: DirCheck;
  reasons: string[];
  durationMs: number;
};

const CASES: GrotesklyCase[] = [
  { id: "resist-family", url: "https://groteskly.xyz/resist-family" },
  { id: "lader-family", url: "https://groteskly.xyz/lader-family" },
  { id: "refrankt", url: "https://groteskly.xyz/fonts/refrankt" },
  { id: "rothek", url: "https://groteskly.xyz/fonts/rothek" }
];

const toReportTimestamp = (input = new Date()): string =>
  input.toISOString().replace(/[:.]/g, "-");

const isLikelyStyleHashDir = (name: string): boolean => {
  const normalized = name.toLowerCase();
  // Examples from old behavior:
  // resist-sans-display-thin-f-z7ip
  // abc-font-bold-q-12ab
  return /-(thin|light|regular|medium|bold|black|italic|oblique)(-|$)/i.test(normalized) &&
    /-[a-z0-9]{3,6}$/.test(normalized);
};

const inspectOutputDir = async (outputDir: string): Promise<DirCheck> => {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const subdirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const rootZipFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"))
    .map((entry) => entry.name)
    .sort();
  const suspiciousStyleHashDirs = subdirs.filter(isLikelyStyleHashDir);

  return { subdirs, rootZipFiles, suspiciousStyleHashDirs };
};

const loadValidationStatus = async (outputDir: string): Promise<string | undefined> => {
  const validationPath = path.join(outputDir, "validation-log.json");
  try {
    const raw = await readFile(validationPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.summary?.status) return String(parsed.summary.status);
  } catch {
    // best-effort
  }
  return undefined;
};

const runCase = async (testCase: GrotesklyCase): Promise<CaseReport> => {
  const started = Date.now();
  const reasons: string[] = [];

  try {
    const scraper = scrapers.find((item) => item.canHandle(testCase.url));
    if (!scraper) {
      return {
        id: testCase.id,
        url: testCase.url,
        status: "fail",
        downloadedCount: 0,
        skippedCount: 0,
        reasons: ["No scraper matched target URL."],
        durationMs: Date.now() - started
      };
    }

    const scraped = await scraper.scrape(testCase.url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    if (fonts.length === 0) reasons.push("Scraper returned 0 candidates.");

    const familyHint =
      scraped.fonts?.[0]?.metadata?.family ||
      scraped.fonts?.[0]?.family ||
      testCase.id;

    const outputFolder = `smoke-groteskly-${testCase.id}-${Date.now()}`;
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

    const outputDir = result.outputDir;
    const absOutputDir = path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir);
    const outputExists = await stat(absOutputDir).then(() => true).catch(() => false);
    if (!outputExists) reasons.push("Output directory does not exist.");

    const downloadedCount = Array.isArray(result.downloaded) ? result.downloaded.length : 0;
    const skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;
    const validationStatus = outputExists ? await loadValidationStatus(absOutputDir) : undefined;
    const dirCheck = outputExists ? await inspectOutputDir(absOutputDir) : undefined;

    if (downloadedCount === 0) {
      reasons.push("Downloaded 0 files.");
    }
    if (validationStatus && validationStatus.toLowerCase() !== "pass") {
      reasons.push(`validation status=${validationStatus}`);
    }

    if (dirCheck) {
      if (dirCheck.rootZipFiles.length > 0) {
        reasons.push(`Raw ZIP left in root (${dirCheck.rootZipFiles.length}).`);
      }
      if (dirCheck.suspiciousStyleHashDirs.length > 0) {
        reasons.push(`Old style/hash extraction dirs detected (${dirCheck.suspiciousStyleHashDirs.length}).`);
      }
    }

    return {
      id: testCase.id,
      url: testCase.url,
      scraperId: scraper.id,
      foundry: scraped.foundryName,
      status: reasons.length === 0 ? "pass" : "fail",
      downloadedCount,
      skippedCount,
      outputDir: result.outputDir,
      validationStatus,
      dirCheck,
      reasons,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      id: testCase.id,
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
  const results: CaseReport[] = [];

  for (const testCase of CASES) {
    console.log(`Running Groteskly smoke: ${testCase.id} -> ${testCase.url}`);
    const result = await runCase(testCase);
    results.push(result);
    const reasons = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(
      `[${result.status.toUpperCase()}] ${testCase.id} downloaded=${result.downloadedCount} skipped=${result.skippedCount}${reasons}`
    );
  }

  const summary = {
    total: results.length,
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length
  };

  const report = {
    suite: "groteskly-multi",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `smoke-groteskly-multi-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Groteskly report: ${path.relative(process.cwd(), reportPath)}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Groteskly smoke failed:", error);
  process.exitCode = 1;
});
