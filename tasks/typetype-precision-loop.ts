import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { TypeTypeScraper } from "@/lib/scrapers/typetype";
import { runDownload } from "@/lib/server/font-downloader";

type TypeTypeLoopCase = {
  slug: string;
  url: string;
  minFonts: number;
};

type QualitySnapshot = {
  status?: string;
  styleCoveragePercent?: number;
  expectedStyleCount?: number;
  matchedStyleCount?: number;
  missingStyleCount?: number;
  missingStyles?: string[];
};

type SpecimenSnapshot = {
  downloadedPdfCount?: number;
  downloadedPdfFiles?: string[];
};

type TypeTypeLoopResult = {
  slug: string;
  url: string;
  status: "pass" | "fail";
  scrapedFontCount: number;
  expectedCount?: number;
  outputDir?: string;
  downloadedCount?: number;
  quality?: QualitySnapshot;
  specimen?: SpecimenSnapshot;
  contaminationFamilies: string[];
  reasons: string[];
  durationMs: number;
};

const CASES: TypeTypeLoopCase[] = [
  {
    slug: "tt-chocolates",
    url: "https://typetype.org/fonts/tt-chocolates/",
    minFonts: 20,
  },
  {
    slug: "tt-norms-pro",
    url: "https://typetype.org/fonts/tt-norms-pro/",
    minFonts: 40,
  },
];

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const toReportTimestamp = (input = new Date()): string => input.toISOString().replace(/[:.]/g, "-");

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

const loadJson = async (filePath: string): Promise<any | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const loadQualitySnapshot = async (outputDir: string): Promise<QualitySnapshot | undefined> => {
  const root = path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir);
  const parsed = await loadJson(path.join(root, "quality-log.json"));
  if (!parsed) return undefined;
  const coverage = parsed.coverage || {};
  const summary = parsed.summary || {};
  return {
    status: typeof parsed.status === "string" ? parsed.status : typeof parsed.qualityStatus === "string" ? parsed.qualityStatus : undefined,
    styleCoveragePercent:
      typeof coverage.styleCoveragePercent === "number"
        ? coverage.styleCoveragePercent
        : typeof summary.styleCoveragePercent === "number"
          ? summary.styleCoveragePercent
          : undefined,
    expectedStyleCount: typeof coverage.expectedStyleCount === "number" ? coverage.expectedStyleCount : undefined,
    matchedStyleCount: typeof coverage.matchedStyleCount === "number" ? coverage.matchedStyleCount : undefined,
    missingStyleCount: typeof coverage.missingStyleCount === "number" ? coverage.missingStyleCount : undefined,
    missingStyles: Array.isArray(coverage.missingStyles) ? coverage.missingStyles.filter((x: any) => typeof x === "string") : undefined,
  };
};

const loadSpecimenSnapshot = async (outputDir: string): Promise<SpecimenSnapshot | undefined> => {
  const root = path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir);
  const parsed = await loadJson(path.join(root, "specimen-log.json"));
  if (!parsed) return undefined;
  const downloaded = Array.isArray(parsed.downloadedPdfs)
    ? parsed.downloadedPdfs
    : Array.isArray(parsed.downloaded)
      ? parsed.downloaded
      : [];
  const pdfs = downloaded
    .map((item: any) => String(item?.fileName || path.basename(String(item?.filePath || "")) || ""))
    .filter((name: string) => /\.pdf$/i.test(name));
  return {
    downloadedPdfCount: pdfs.length,
    downloadedPdfFiles: pdfs.slice(0, 30),
  };
};

const detectContaminationFamilies = async (outputDir: string, slug: string): Promise<string[]> => {
  const root = path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir);
  const parsed = await loadJson(path.join(root, "validation-log.json"));
  const fullFonts = Array.isArray(parsed?.full_fonts) ? parsed.full_fonts : [];
  const baseToken = normalizeToken(slug);
  const families: string[] = Array.from(
    new Set<string>(
      fullFonts
        .map((entry: any) => String(entry?.family_name || entry?.family || "").trim())
        .filter((name: string) => name.length > 0)
    )
  );

  return families.filter((family) => {
    const token = normalizeToken(family);
    return baseToken.length > 2 && !token.includes(baseToken);
  });
};

async function runCase(testCase: TypeTypeLoopCase, options: { download: boolean }): Promise<TypeTypeLoopResult> {
  const started = Date.now();
  const reasons: string[] = [];

  try {
    const scraped = await TypeTypeScraper.scrape(testCase.url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];

    if (fonts.length < testCase.minFonts) {
      reasons.push(`Scraper returned ${fonts.length} fonts (min ${testCase.minFonts}).`);
    }
    if (typeof scraped.expectedCount === "number" && scraped.expectedCount > 0 && fonts.length !== scraped.expectedCount) {
      reasons.push(`Font count mismatch: fonts=${fonts.length}, expectedCount=${scraped.expectedCount}.`);
    }

    let outputDir: string | undefined;
    let downloadedCount: number | undefined;
    let quality: QualitySnapshot | undefined;
    let specimen: SpecimenSnapshot | undefined;
    let contaminationFamilies: string[] = [];

    if (options.download) {
      const outputFolder = `typetype-loop-${testCase.slug}-${Date.now()}`;
      const downloadFonts = fonts.map((font) => ({
        url: font.url,
        family: font.family,
        format: font.format,
        style: font.style,
        weight: typeof font.weight === "number" ? String(font.weight) : font.weight,
        metadata: font.metadata,
      }));
      const result = await runDownload({
        mode: "batch-direct",
        source: testCase.url,
        outputFolder,
        fonts: downloadFonts,
        metadata: {
          foundry: scraped.foundryName,
          family: fonts?.[0]?.family || testCase.slug,
          targetUrl: scraped.originalUrl || testCase.url,
          fonts: downloadFonts,
          ...(scraped.metadata || {}),
        },
      });

      outputDir = result.outputDir;
      downloadedCount = Array.isArray(result.downloaded) ? result.downloaded.length : 0;

      quality = await loadQualitySnapshot(outputDir);
      specimen = await loadSpecimenSnapshot(outputDir);
      contaminationFamilies = await detectContaminationFamilies(outputDir, testCase.slug);

      if ((downloadedCount || 0) <= 0) {
        reasons.push("Downloader produced 0 files.");
      }
      if (!quality?.status) {
        reasons.push("quality-log missing.");
      } else if (String(quality.status).toLowerCase() !== "pass") {
        const detail = quality.missingStyleCount ? `missing=${quality.missingStyleCount}` : "";
        reasons.push(`quality-log status=${quality.status}${detail ? ` (${detail})` : ""}.`);
      }
      if (typeof quality?.styleCoveragePercent === "number" && quality.styleCoveragePercent < 100) {
        reasons.push(`style coverage < 100% (${quality.styleCoveragePercent}%).`);
      }
      if ((specimen?.downloadedPdfCount || 0) <= 0) {
        reasons.push("No specimen PDFs downloaded.");
      }
      if (contaminationFamilies.length > 0) {
        reasons.push(`Contamination families detected: ${contaminationFamilies.join(", ")}`);
      }
    }

    return {
      slug: testCase.slug,
      url: testCase.url,
      status: reasons.length === 0 ? "pass" : "fail",
      scrapedFontCount: fonts.length,
      expectedCount: scraped.expectedCount,
      outputDir,
      downloadedCount,
      quality,
      specimen,
      contaminationFamilies,
      reasons,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      slug: testCase.slug,
      url: testCase.url,
      status: "fail",
      scrapedFontCount: 0,
      contaminationFamilies: [],
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started,
    };
  }
}

async function run() {
  const startedAt = new Date();
  const { download, onlySlugs } = parseArgs();

  const selectedCases = onlySlugs ? CASES.filter((item) => onlySlugs.has(item.slug.toLowerCase())) : CASES;
  if (selectedCases.length === 0) {
    throw new Error("No TypeType cases selected. Check --slugs option.");
  }

  const results: TypeTypeLoopResult[] = [];
  for (const testCase of selectedCases) {
    const result = await runCase(testCase, { download });
    results.push(result);

    const prefix = result.status === "pass" ? "PASS" : "FAIL";
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(
      `[${prefix}] ${testCase.slug} -> scraped=${result.scrapedFontCount}${
        typeof result.downloadedCount === "number" ? `, downloaded=${result.downloadedCount}` : ""
      }${reason}`
    );
    if (result.outputDir) {
      console.log(`  output: ${result.outputDir}`);
      if (result.quality) {
        console.log(
          `  quality: status=${result.quality.status ?? "-"} coverage=${result.quality.styleCoveragePercent ?? "-"}% expected=${
            result.quality.expectedStyleCount ?? "-"
          } matched=${result.quality.matchedStyleCount ?? "-"} missing=${result.quality.missingStyleCount ?? "-"}`
        );
      }
      if (result.specimen) {
        console.log(`  specimen: pdfs=${result.specimen.downloadedPdfCount ?? 0}`);
      }
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    downloadEnabled: download,
  };

  const report = {
    suite: "typetype-precision-loop",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results,
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `typetype-precision-loop-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`TypeType precision report: ${path.relative(process.cwd(), reportPath)}`);
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("TypeType precision loop failed:", error);
  process.exitCode = 1;
});
