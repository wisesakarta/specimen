import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { GenericScraper } from "@/lib/scrapers/generic";
import { runDownload } from "@/lib/server/font-downloader";

type GenericCase = {
  id: string;
  url: string;
  minDownloaded: number;
};

type CaseResult = {
  id: string;
  url: string;
  families: string[];
  downloadedCount: number;
  skippedCount: number;
  outputDir?: string;
  validationStatus?: string;
  qualityStatus?: string;
  styleCoveragePercent?: number;
  reasons: string[];
  durationMs: number;
};

const CASES: GenericCase[] = [
  { id: "spotify", url: "https://open.spotify.com/intl-id", minDownloaded: 3 },
  { id: "discord", url: "https://discord.com/", minDownloaded: 2 },
  { id: "pinterest", url: "https://www.pinterest.com/", minDownloaded: 1 },
  { id: "vercel", url: "https://vercel.com/", minDownloaded: 2 }
];

const reportStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const loadJson = async (outputDir: string, fileName: string): Promise<any> => {
  const target = path.join(path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir), fileName);
  const raw = await readFile(target, "utf8");
  return JSON.parse(raw);
};

async function runCase(testCase: GenericCase): Promise<CaseResult> {
  const started = Date.now();
  const reasons: string[] = [];

  try {
    const scraped = await GenericScraper.scrape(testCase.url);
    const families = [...new Set((scraped.fonts || []).map((font) => String(font.family || "")).filter(Boolean))];
    const outputFolder = `generic-smoke-${testCase.id}-${Date.now()}`;
    const result = await runDownload({
      mode: "browser-intercept",
      targetUrl: scraped.targetUrl || scraped.originalUrl || testCase.url,
      outputFolder,
      expectedCount: scraped.expectedCount,
      injectScript: scraped.injectScript,
      metadata: {
        foundry: scraped.foundryName,
        family: families[0] || testCase.id,
        fonts: scraped.fonts,
        ...(scraped.metadata || {})
      }
    });

    const downloadedCount = Array.isArray(result.downloaded) ? result.downloaded.length : 0;
    const skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;
    const validation = await loadJson(result.outputDir, "validation-log.json").catch(() => null);
    const quality = await loadJson(result.outputDir, "quality-log.json").catch(() => null);

    const validationStatus = typeof validation?.summary?.status === "string" ? validation.summary.status : undefined;
    const qualityStatus =
      typeof quality?.qualityStatus === "string"
        ? quality.qualityStatus
        : typeof quality?.status === "string"
          ? quality.status
          : undefined;
    const styleCoveragePercent = Number(quality?.summary?.styleCoveragePercent ?? quality?.coverage?.styleCoveragePercent);

    if (downloadedCount < testCase.minDownloaded) reasons.push(`downloaded=${downloadedCount} (< ${testCase.minDownloaded})`);
    if (validationStatus === "fail") reasons.push("validation=fail");
    if (qualityStatus === "fail") reasons.push("quality=fail");

    return {
      id: testCase.id,
      url: testCase.url,
      families,
      downloadedCount,
      skippedCount,
      outputDir: result.outputDir,
      validationStatus,
      qualityStatus,
      styleCoveragePercent: Number.isFinite(styleCoveragePercent) ? styleCoveragePercent : undefined,
      reasons,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      id: testCase.id,
      url: testCase.url,
      families: [],
      downloadedCount: 0,
      skippedCount: 0,
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started
    };
  }
}

async function run() {
  const startedAt = new Date();
  const results: CaseResult[] = [];

  for (const testCase of CASES) {
    console.log(`Running generic smoke: ${testCase.id} -> ${testCase.url}`);
    const result = await runCase(testCase);
    results.push(result);
    console.log(
      JSON.stringify({
        id: result.id,
        downloaded: result.downloadedCount,
        skipped: result.skippedCount,
        families: result.families,
        validation: result.validationStatus,
        quality: result.qualityStatus,
        coverage: result.styleCoveragePercent,
        reasons: result.reasons
      })
    );
  }

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `smoke-generic-websites-${reportStamp()}.json`);
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        suite: "generic-websites",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        summary: {
          total: results.length,
          failed: results.filter((item) => item.reasons.length > 0).length,
          passed: results.filter((item) => item.reasons.length === 0).length
        },
        results
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
