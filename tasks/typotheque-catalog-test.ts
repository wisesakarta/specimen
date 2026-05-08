import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { scrapers } from "@/lib/scrapers";
import { runDownload } from "@/lib/server/font-downloader";

type CaseResult = {
  slug: string;
  url: string;
  status: "pass" | "warn" | "fail" | "skip";
  scraper?: string;
  foundry?: string;
  fontCandidates?: number;
  expectedCount?: number;
  expectedStyles?: number;
  families?: string[];
  downloadedCount?: number;
  skippedCount?: number;
  outputDir?: string;
  validationStatus?: string;
  qualityStatus?: string;
  specimenStatus?: string;
  specimenPdfCount?: number;
  styleCoveragePercent?: number;
  reason?: string;
  durationMs: number;
};

type Report = {
  reportId: string;
  startedAt: string;
  finishedAt?: string;
  source: string;
  totalSlugs: number;
  completed: number;
  summary: {
    pass: number;
    warn: number;
    fail: number;
    skip: number;
  };
  results: CaseResult[];
};

const TYPOTHEQUE_SITEMAP_URL = "https://www.typotheque.com/sitemap.xml";
const TYPOTHEQUE_FONT_PREFIX = "https://www.typotheque.com/fonts/";
const RESERVED_SLUGS = new Set(["custom", "in-use", "global"]);

const toStamp = (input = new Date()) => input.toISOString().replace(/[:.]/g, "-");
const reportId = `typotheque-catalog-test-${toStamp()}`;
const reportsDir = path.join(process.cwd(), "tasks", "reports");
const reportPath = path.join(reportsDir, `${reportId}.json`);

const args = new Set(process.argv.slice(2));
const noDownload = args.has("--no-download");
const limitArg = [...args].find((arg) => arg.startsWith("--limit="));
const offsetArg = [...args].find((arg) => arg.startsWith("--offset="));
const chunkSizeArg = [...args].find((arg) => arg.startsWith("--chunk-size="));
const delayMsArg = [...args].find((arg) => arg.startsWith("--delay-ms="));
const slugArg = [...args].find((arg) => arg.startsWith("--slugs="));
const fromReportArg = [...args].find((arg) => arg.startsWith("--from-report="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const offset = offsetArg ? Math.max(0, Number(offsetArg.split("=")[1])) : 0;
const chunkSize = chunkSizeArg ? Math.max(0, Number(chunkSizeArg.split("=")[1])) : undefined;
const delayMs = delayMsArg ? Math.max(0, Number(delayMsArg.split("=")[1])) : 0;
const requestedSlugs = slugArg
  ? slugArg
      .split("=")[1]
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  : [];
const fromReportPath = fromReportArg ? fromReportArg.split("=")[1].trim() : "";

const asFiniteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (filePath: string): Promise<any | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const extractRootSlugs = (xml: string): string[] => {
  const out = new Set<string>();
  for (const match of xml.matchAll(/<loc>(https:\/\/www\.typotheque\.com\/fonts\/[^<]+)<\/loc>/g)) {
    try {
      const url = new URL(match[1]);
      const segments = url.pathname.split("/").filter(Boolean);
      const slug = (segments[1] || "").trim().toLowerCase();
      if (!slug || RESERVED_SLUGS.has(slug)) continue;
      out.add(slug);
    } catch {
      // ignore malformed sitemap entries
    }
  }
  return [...out].sort();
};

const writeReport = async (report: Report) => {
  await mkdir(reportsDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
};

const refreshSummary = (report: Report) => {
  report.completed = report.results.length;
  report.summary = {
    pass: report.results.filter((item) => item.status === "pass").length,
    warn: report.results.filter((item) => item.status === "warn").length,
    fail: report.results.filter((item) => item.status === "fail").length,
    skip: report.results.filter((item) => item.status === "skip").length
  };
};

const loadAudit = async (outputDir: string) => {
  const quality = await readJson(path.join(outputDir, "quality-log.json"));
  const validation = await readJson(path.join(outputDir, "validation-log.json"));
  const specimen = await readJson(path.join(outputDir, "specimen-log.json"));
  return {
    qualityStatus: quality?.qualityStatus || quality?.status,
    styleCoveragePercent:
      asFiniteNumber(quality?.summary?.styleCoveragePercent) ?? asFiniteNumber(quality?.coverage?.styleCoveragePercent),
    validationStatus: validation?.summary?.status,
    specimenStatus: specimen?.status,
    specimenPdfCount: asFiniteNumber(specimen?.specimenPdfCount) ?? 0
  };
};

const main = async () => {
  const report: Report = {
    reportId,
    startedAt: new Date().toISOString(),
    source: TYPOTHEQUE_SITEMAP_URL,
    totalSlugs: 0,
    completed: 0,
    summary: { pass: 0, warn: 0, fail: 0, skip: 0 },
    results: []
  };

  const sitemapRes = await fetch(TYPOTHEQUE_SITEMAP_URL, { headers: { "user-agent": "Mozilla/5.0" }, cache: "no-store" });
  if (!sitemapRes.ok) throw new Error(`Failed to fetch Typotheque sitemap (${sitemapRes.status}).`);
  const sitemapXml = await sitemapRes.text();
  let slugs = extractRootSlugs(sitemapXml);
  if (fromReportPath) {
    const resolvedReportPath = path.isAbsolute(fromReportPath) ? fromReportPath : path.join(process.cwd(), fromReportPath);
    const priorReport = (await readJson(resolvedReportPath)) as Report | undefined;
    if (!priorReport) throw new Error(`Unable to read prior report: ${resolvedReportPath}`);
    const priorSlugs = priorReport.results
      .filter((item) => (item.fontCandidates || 0) > 0 && item.status !== "skip")
      .map((item) => item.slug);
    slugs = slugs.filter((slug) => priorSlugs.includes(slug));
  }
  if (requestedSlugs.length > 0) {
    const requestedSet = new Set(requestedSlugs);
    slugs = slugs.filter((slug) => requestedSet.has(slug));
  }
  if (offset > 0) slugs = slugs.slice(offset);
  if (Number.isFinite(chunkSize) && Number(chunkSize) > 0) {
    slugs = slugs.slice(0, Number(chunkSize));
  } else if (Number.isFinite(limit) && Number(limit) > 0) {
    slugs = slugs.slice(0, Number(limit));
  }
  report.totalSlugs = slugs.length;
  await writeReport(report);

  const scraper = scrapers.find((item) => item.id === "typotheque");
  if (!scraper) throw new Error("Typotheque scraper not registered.");

  for (const slug of slugs) {
    const started = Date.now();
    const url = `${TYPOTHEQUE_FONT_PREFIX}${slug}`;
    try {
      const scraped = await scraper.scrape(url);
      const families = [...new Set((scraped.fonts || []).map((font) => font.metadata?.family || font.family).filter(Boolean))];
      const expectedStyles = Array.isArray((scraped.metadata as any)?.targetProfile?.expectedStyles)
        ? (scraped.metadata as any).targetProfile.expectedStyles.length
        : undefined;

      if (!Array.isArray(scraped.fonts) || scraped.fonts.length === 0) {
        report.results.push({
          slug,
          url,
          status: "skip",
          scraper: scraper.id,
          foundry: scraped.foundryName,
          fontCandidates: 0,
          expectedCount: scraped.expectedCount,
          expectedStyles,
          families,
          reason: "Scraper returned 0 font candidates.",
          durationMs: Date.now() - started
        });
        refreshSummary(report);
        await writeReport(report);
        continue;
      }

      if (noDownload) {
        report.results.push({
          slug,
          url,
          status: "pass",
          scraper: scraper.id,
          foundry: scraped.foundryName,
          fontCandidates: scraped.fonts.length,
          expectedCount: scraped.expectedCount,
          expectedStyles,
          families,
          durationMs: Date.now() - started
        });
        refreshSummary(report);
        await writeReport(report);
        continue;
      }

      const outputFolder = `typotheque-catalog-${reportId}-${slug}`;
      const familyHint = scraped.fonts[0]?.metadata?.family || scraped.fonts[0]?.family || slug;
      const result = await runDownload({
        mode: "browser-intercept",
        targetUrl: scraped.targetUrl || scraped.originalUrl || url,
        outputFolder,
        expectedCount: scraped.expectedCount,
        injectScript: scraped.injectScript,
        masterFoundry: scraped.masterFoundry,
        metadata: {
          foundry: scraped.foundryName,
          family: familyHint,
          fonts: scraped.fonts,
          ...(scraped.metadata || {})
        }
      });

      const audit = await loadAudit(result.outputDir);
      const reasons: string[] = [];
      if ((result.downloaded || []).length === 0) reasons.push("downloaded=0");
      if ((audit.validationStatus || "").toLowerCase() === "fail") reasons.push("validation=fail");
      if ((audit.qualityStatus || "").toLowerCase() === "fail") reasons.push("quality=fail");
      const specimenWarn = (audit.specimenStatus || "").toLowerCase() === "warn";
      const qualityWarn = (audit.qualityStatus || "").toLowerCase() === "warn";

      report.results.push({
        slug,
        url,
        status: reasons.length > 0 ? "fail" : specimenWarn || qualityWarn ? "warn" : "pass",
        scraper: scraper.id,
        foundry: scraped.foundryName,
        fontCandidates: scraped.fonts.length,
        expectedCount: scraped.expectedCount,
        expectedStyles,
        families,
        downloadedCount: (result.downloaded || []).length,
        skippedCount: (result.skipped || []).length,
        outputDir: result.outputDir,
        validationStatus: audit.validationStatus,
        qualityStatus: audit.qualityStatus,
        specimenStatus: audit.specimenStatus,
        specimenPdfCount: audit.specimenPdfCount,
        styleCoveragePercent: audit.styleCoveragePercent,
        reason: reasons.join("; ") || undefined,
        durationMs: Date.now() - started
      });
    } catch (error) {
      report.results.push({
        slug,
        url,
        status: "fail",
        scraper: scraper.id,
        reason: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started
      });
    }

    refreshSummary(report);
    await writeReport(report);
    console.log(JSON.stringify({
      progress: `${report.completed}/${report.totalSlugs}`,
      last: report.results[report.results.length - 1]
    }));

    if (delayMs > 0 && report.completed < report.totalSlugs) {
      await sleep(delayMs);
    }
  }

  report.finishedAt = new Date().toISOString();
  refreshSummary(report);
  await writeReport(report);
  console.log(`Typotheque catalog report: ${path.relative(process.cwd(), reportPath)}`);
};

main().catch((error) => {
  console.error("Typotheque catalog testing failed:", error);
  process.exit(1);
});

