import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { runDownload } from "@/lib/server/font-downloader";
import { scrapers } from "@/lib/scrapers";

type InterceptCase = {
  id: string;
  name: string;
  url: string;
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
  reasons: string[];
  durationMs: number;
};

const CASES: InterceptCase[] = [
  { id: "205tf", name: "205TF", url: "https://www.205.tf/pinokio-sans", minDownloaded: 4 },
  { id: "a2-type", name: "A2 Type", url: "https://a2-type.co.uk/ny-sans", minDownloaded: 1 },
  { id: "abc-dinamo", name: "ABC Dinamo", url: "https://abcdinamo.com/typefaces/gravity", minDownloaded: 1 },
  { id: "cotype", name: "CoType", url: "https://cotypefoundry.com/font-family/aeonik", minDownloaded: 6 },
  { id: "lineto", name: "Lineto", url: "https://lineto.com/typefaces/akkurat-mono", minDownloaded: 1 }
];

const toReportTimestamp = (input = new Date()): string =>
  input.toISOString().replace(/[:.]/g, "-");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const strict = !args.includes("--no-strict");
  const foundry = args.find((arg) => arg.startsWith("--foundry="))?.split("=")[1]?.trim().toLowerCase();
  const limitRaw = args.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
  const limit = limitRaw ? Math.max(1, Number(limitRaw)) : undefined;
  return { strict, foundry, limit: Number.isFinite(limit) ? limit : undefined };
};

const loadValidationStatus = async (outputDir: string): Promise<string | undefined> => {
  const candidates = [
    path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir),
    path.join(process.cwd(), outputDir)
  ];

  for (const root of candidates) {
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

async function runCase(testCase: InterceptCase): Promise<CaseResult> {
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

    const scraped = await scraper.scrape(testCase.url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    const familyHint =
      scraped.fonts?.[0]?.metadata?.family ||
      scraped.fonts?.[0]?.family ||
      testCase.id;

    const outputFolder = `smoke-${testCase.id}-${Date.now()}`;
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

    if (downloadedCount < testCase.minDownloaded) {
      reasons.push(`Downloaded only ${downloadedCount} files (< ${testCase.minDownloaded}).`);
    }
    if (validationStatus && validationStatus.toLowerCase() === "fail") {
      reasons.push("validation-log status=fail.");
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
}

async function run() {
  const startedAt = new Date();
  const { strict, foundry, limit } = parseArgs();

  let selectedCases = CASES;
  if (foundry) {
    selectedCases = selectedCases.filter((item) => item.id.toLowerCase().includes(foundry));
  }
  if (typeof limit === "number") {
    selectedCases = selectedCases.slice(0, limit);
  }

  if (selectedCases.length === 0) {
    console.error("No smoke cases selected. Use --foundry=<id> with a valid id.");
    process.exitCode = 1;
    return;
  }

  const results: CaseResult[] = [];
  for (const testCase of selectedCases) {
    console.log(`Running intercept smoke: ${testCase.name} -> ${testCase.url}`);
    const result = await runCase(testCase);
    results.push(result);

    const prefix = result.status === "pass" ? "PASS" : "FAIL";
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(`[${prefix}] ${result.name} downloaded=${result.downloadedCount} skipped=${result.skippedCount}${reason}`);
  }

  const summary = {
    strict,
    total: results.length,
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length
  };

  const report = {
    suite: "intercept",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `smoke-browser-intercept-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Intercept report: ${path.relative(process.cwd(), reportPath)}`);

  if (strict && summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Smoke intercept failed:", error);
  process.exitCode = 1;
});
