import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { AbjadTypeScraper } from "@/lib/scrapers/abjadfonts";
import { runDownload } from "@/lib/server/font-downloader";

type AbjadLoopCase = {
  slug: string;
  url: string;
  expectedSourceTokens: string[];
  minFonts: number;
};

type AbjadLoopResult = {
  slug: string;
  url: string;
  status: "pass" | "fail";
  fontCount: number;
  expectedCount?: number;
  sourceFamilies: string[];
  contaminationFamilies: string[];
  missingExpectedTokens: string[];
  outputDir?: string;
  downloadedCount?: number;
  downloadedFiles?: string[];
  reasons: string[];
  durationMs: number;
};

const CASES: AbjadLoopCase[] = [
  {
    slug: "daken",
    url: "https://www.abjadfonts.com/fonts/daken",
    expectedSourceTokens: ["daken001", "xddv300000000xtest000vf"],
    minFonts: 1
  },
  {
    slug: "dames",
    url: "https://www.abjadfonts.com/fonts/dames",
    expectedSourceTokens: ["xd2test000000000x0000000vf", "xdtest000000000000x000vf"],
    minFonts: 1
  },
  {
    slug: "miknas",
    url: "https://www.abjadfonts.com/fonts/miknas",
    expectedSourceTokens: ["xmktest00000000xxxxvf"],
    minFonts: 1
  },
  {
    slug: "manchette-modern",
    url: "https://www.abjadfonts.com/fonts/manchette-modern",
    expectedSourceTokens: ["xxtest000000xx000000000vf"],
    minFonts: 1
  }
];

const contaminationTokens = [
  "jawaker",
  "deliveroo",
  "qatarairways",
  "capitalbank",
  "farah",
  "majlis",
  "floward",
  "manchettetext"
];

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const download = args.includes("--download");
  const onlySlugsArg = args.find((arg) => arg.startsWith("--slugs="));
  const onlySlugs = onlySlugsArg
    ? new Set(
        onlySlugsArg
          .slice("--slugs=".length)
          .split(",")
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
      )
    : undefined;
  return { download, onlySlugs };
};

const toReportTimestamp = (input = new Date()): string =>
  input.toISOString().replace(/[:.]/g, "-");

async function runCase(testCase: AbjadLoopCase, options: { download: boolean }): Promise<AbjadLoopResult> {
  const started = Date.now();
  const reasons: string[] = [];

  try {
    const scraped = await AbjadTypeScraper.scrape(testCase.url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    const sourceFamilies = Array.from(
      new Set(fonts.map((font) => String((font.metadata as any)?.sourceFamily || "").trim()).filter(Boolean))
    );
    const sourceTokens = new Set(sourceFamilies.map((family) => normalizeToken(family)).filter(Boolean));

    const contaminationFamilies = sourceFamilies.filter((family) => {
      const token = normalizeToken(family);
      return contaminationTokens.some((contamination) => token.includes(contamination));
    });

    const missingExpectedTokens = testCase.expectedSourceTokens.filter((expected) => {
      const token = normalizeToken(expected);
      if (!token) return false;
      for (const sourceToken of sourceTokens) {
        if (sourceToken.includes(token) || token.includes(sourceToken)) return false;
      }
      return true;
    });

    if (fonts.length < testCase.minFonts) {
      reasons.push(`Scraper returned ${fonts.length} fonts (min ${testCase.minFonts}).`);
    }
    if (contaminationFamilies.length > 0) {
      reasons.push(`Contamination families detected: ${contaminationFamilies.join(", ")}`);
    }
    if (missingExpectedTokens.length === testCase.expectedSourceTokens.length) {
      reasons.push("None of expected source-family tokens matched the scrape output.");
    }

    let outputDir: string | undefined;
    let downloadedCount: number | undefined;
    let downloadedFiles: string[] | undefined;

    if (options.download) {
      const outputFolder = `abjad-loop-${testCase.slug}-${Date.now()}`;
      const result = await runDownload({
        mode: "browser-intercept",
        targetUrl: scraped.targetUrl || scraped.originalUrl || testCase.url,
        outputFolder,
        expectedCount: scraped.expectedCount,
        injectScript: scraped.injectScript,
        metadata: {
          foundry: scraped.foundryName,
          family: scraped.fonts?.[0]?.family || testCase.slug,
          fonts,
          ...(scraped.metadata || {})
        }
      });

      outputDir = result.outputDir;
      downloadedFiles = Array.isArray(result.downloaded) ? result.downloaded.map((item) => item.fileName) : [];
      downloadedCount = downloadedFiles.length;

      if ((downloadedCount || 0) <= 0) {
        reasons.push("Downloader produced 0 files.");
      }
    }

    return {
      slug: testCase.slug,
      url: testCase.url,
      status: reasons.length === 0 ? "pass" : "fail",
      fontCount: fonts.length,
      expectedCount: scraped.expectedCount,
      sourceFamilies,
      contaminationFamilies,
      missingExpectedTokens,
      outputDir,
      downloadedCount,
      downloadedFiles,
      reasons,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      slug: testCase.slug,
      url: testCase.url,
      status: "fail",
      fontCount: 0,
      sourceFamilies: [],
      contaminationFamilies: [],
      missingExpectedTokens: [...testCase.expectedSourceTokens],
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started
    };
  }
}

async function run() {
  const startedAt = new Date();
  const { download, onlySlugs } = parseArgs();

  const selectedCases = onlySlugs
    ? CASES.filter((item) => onlySlugs.has(item.slug.toLowerCase()))
    : CASES;

  if (selectedCases.length === 0) {
    throw new Error("No Abjad cases selected. Check --slugs option.");
  }

  const results: AbjadLoopResult[] = [];
  for (const testCase of selectedCases) {
    const result = await runCase(testCase, { download });
    results.push(result);

    const prefix = result.status === "pass" ? "PASS" : "FAIL";
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(
      `[${prefix}] ${testCase.slug} -> fonts=${result.fontCount}${
        typeof result.downloadedCount === "number" ? `, downloaded=${result.downloadedCount}` : ""
      }${reason}`
    );
  }

  const summary = {
    total: results.length,
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    downloadEnabled: download
  };

  const report = {
    suite: "abjad-precision-loop",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `abjad-precision-loop-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Abjad precision report: ${path.relative(process.cwd(), reportPath)}`);
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Abjad precision loop failed:", error);
  process.exitCode = 1;
});
