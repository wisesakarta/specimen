import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { TheDesignersFoundryScraper } from "@/lib/scrapers/thedesignersfoundry";
import { runDownload } from "@/lib/server/font-downloader";

const TDF_ORIGIN = "https://www.thedesignersfoundry.com";
const TDF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

type CatalogEntry = {
  slug: string;
  beta: boolean;
  title?: string;
};

type RiskFamily = {
  slug: string;
  title: string | undefined;
  route: "typeface" | "beta-fonts";
  staticCount: number;
  variableCount: number;
  overlapPostscript: string[];
};

type ValidationSummary = {
  status?: string;
  total_files?: number;
  valid_fonts?: number;
  invalid_fonts?: number;
  subsetted_fonts?: number;
  name_table_bad_fonts?: number;
};

type QualitySummary = {
  qualityStatus?: string;
  styleCoveragePercent?: number;
  invalidFonts?: number;
  italicMismatches?: number;
  contaminationFonts?: number;
  missingStyles?: string[];
};

type LoopResult = {
  slug: string;
  url: string;
  status: "pass" | "fail";
  scrapedFontCount: number;
  expectedCount?: number;
  outputDir?: string;
  downloadedCount?: number;
  validation?: ValidationSummary;
  quality?: QualitySummary;
  reasons: string[];
  durationMs: number;
};

const toReportTimestamp = (input = new Date()): string => input.toISOString().replace(/[:.]/g, "-");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const download = !args.includes("--no-download");
  const includeAllCatalog = args.includes("--include-all-catalog");
  const includeAllVariable = args.includes("--include-all-variable");
  const maxRaw = args.find((arg) => arg.startsWith("--max="))?.split("=")[1];
  const maxCases = typeof maxRaw === "string" && Number(maxRaw) > 0 ? Math.floor(Number(maxRaw)) : undefined;
  const slugArg = args.find((arg) => arg.startsWith("--slugs="))?.split("=")[1];
  const onlySlugs = slugArg
    ? new Set(
        slugArg
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      )
    : undefined;
  return { download, includeAllCatalog, includeAllVariable, maxCases, onlySlugs };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseNextDataFromHtml = (html: string): Record<string, unknown> | undefined => {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return undefined;
  try {
    const parsed = JSON.parse(match[1]);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: {
      "User-Agent": TDF_UA,
      Accept: "text/html,application/xhtml+xml,application/json,*/*",
      Referer: `${TDF_ORIGIN}/typefaces`,
      Origin: TDF_ORIGIN
    },
    redirect: "follow",
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const raw = await fetchText(url);
  return JSON.parse(raw) as T;
};

const mapLimit = async <T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.floor(limit));
  const out = new Array<R>(items.length);
  let cursor = 0;

  const run = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
  return out;
};

const discoverCatalogEntries = async (): Promise<{ buildId: string; entries: CatalogEntry[] }> => {
  const html = await fetchText(`${TDF_ORIGIN}/typefaces`);
  const nextData = parseNextDataFromHtml(html);
  const buildId = asString(nextData?.buildId);
  if (!buildId) throw new Error("TDF buildId missing from /typefaces.");

  const catalog = await fetchJson<Record<string, unknown>>(`${TDF_ORIGIN}/_next/data/${buildId}/typefaces.json`);
  const showcase = Array.isArray((catalog as any)?.pageProps?.showcaseData) ? (catalog as any).pageProps.showcaseData : [];
  const entries: CatalogEntry[] = [];
  for (const row of showcase) {
    if (!isRecord(row)) continue;
    const slugObj = isRecord(row.slug) ? row.slug : undefined;
    const slug = (asString(slugObj?.current) || asString(row.slug) || "").toLowerCase();
    if (!slug) continue;
    entries.push({
      slug,
      beta: Boolean(row.beta),
      title: asString(row.title)
    });
  }
  return { buildId, entries };
};

const fetchFamilyDetail = async (
  buildId: string,
  slug: string,
  preferred: "typeface" | "beta-fonts"
): Promise<{ route: "typeface" | "beta-fonts"; typefaceData: Record<string, unknown> } | undefined> => {
  const routes: Array<"typeface" | "beta-fonts"> = preferred === "beta-fonts" ? ["beta-fonts", "typeface"] : ["typeface", "beta-fonts"];
  for (const route of routes) {
    const url = `${TDF_ORIGIN}/_next/data/${buildId}/${route}/${slug}.json?slug=${encodeURIComponent(slug)}`;
    try {
      const parsed = await fetchJson<Record<string, unknown>>(url);
      const pageProps = isRecord((parsed as any)?.pageProps) ? (parsed as any).pageProps : undefined;
      const typefaceData = isRecord(pageProps?.typefaceData) ? pageProps.typefaceData : undefined;
      if (typefaceData) return { route, typefaceData };
    } catch {
      // try next route
    }
  }
  return undefined;
};

const discoverRiskFamilies = async (options: {
  includeAllCatalog: boolean;
  includeAllVariable: boolean;
  onlySlugs?: Set<string>;
  maxCases?: number;
}): Promise<{
  buildId: string;
  totalCatalogFamilies: number;
  totalVariableFamilies: number;
  totalOverlapFamilies: number;
  selected: RiskFamily[];
}> => {
  const { buildId, entries } = await discoverCatalogEntries();
  const selectedEntries = options.onlySlugs
    ? entries.filter((entry) => options.onlySlugs?.has(entry.slug))
    : entries;

  const resolved = await mapLimit(selectedEntries, 6, async (entry) => {
    const detail = await fetchFamilyDetail(buildId, entry.slug, entry.beta ? "beta-fonts" : "typeface");
    if (!detail) return undefined;
    const staticFonts = Array.isArray((detail.typefaceData as any).fonts) ? (detail.typefaceData as any).fonts : [];
    const variableRaw = Array.isArray((detail.typefaceData as any).variableFont)
      ? (detail.typefaceData as any).variableFont
      : isRecord((detail.typefaceData as any).variableFont)
        ? [(detail.typefaceData as any).variableFont]
        : [];
    const staticPostscript = new Set(
      staticFonts
        .map((font: any) => asString(font?.metaData?.postscriptName))
        .filter((name: string | undefined): name is string => Boolean(name))
    );
    const variablePostscript: string[] = variableRaw
      .map((font: any) => asString(font?.metaData?.postscriptName))
      .filter((name: string | undefined): name is string => Boolean(name));
    const overlapPostscript = variablePostscript.filter((name) => staticPostscript.has(name));
    return {
      slug: entry.slug,
      title: entry.title || asString((detail.typefaceData as any).title),
      route: detail.route,
      staticCount: staticFonts.length,
      variableCount: variableRaw.length,
      overlapPostscript: Array.from(new Set(overlapPostscript))
    } satisfies RiskFamily;
  });

  const families = resolved.filter(Boolean) as RiskFamily[];
  const variableFamilies = families.filter((item) => item.variableCount > 0);
  const overlapFamilies = variableFamilies.filter((item) => item.overlapPostscript.length > 0);
  const base = options.includeAllCatalog
    ? families
    : options.includeAllVariable
      ? variableFamilies
      : overlapFamilies;
  const selected = typeof options.maxCases === "number" ? base.slice(0, options.maxCases) : base;

  return {
    buildId,
    totalCatalogFamilies: entries.length,
    totalVariableFamilies: variableFamilies.length,
    totalOverlapFamilies: overlapFamilies.length,
    selected
  };
};

const normalizePath = (value: string): string => (path.isAbsolute(value) ? value : path.join(process.cwd(), value));

const loadJson = async (filePath: string): Promise<any | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const loadValidationSummary = async (outputDir: string): Promise<ValidationSummary | undefined> => {
  const root = normalizePath(outputDir);
  const parsed = await loadJson(path.join(root, "validation-log.json"));
  if (!parsed) return undefined;
  const summary = parsed.summary || {};
  return {
    status: typeof summary.status === "string" ? summary.status : undefined,
    total_files: Number(summary.total_files) || 0,
    valid_fonts: Number(summary.valid_fonts) || 0,
    invalid_fonts: Number(summary.invalid_fonts) || 0,
    subsetted_fonts: Number(summary.subsetted_fonts) || 0,
    name_table_bad_fonts: Number(summary.name_table_bad_fonts) || 0
  };
};

const loadQualitySummary = async (outputDir: string): Promise<QualitySummary | undefined> => {
  const root = normalizePath(outputDir);
  const parsed = await loadJson(path.join(root, "quality-log.json"));
  if (!parsed) return undefined;
  const coverage = parsed.coverage || {};
  const summary = parsed.summary || {};
  const validation = parsed.validationSnapshot || {};
  return {
    qualityStatus:
      (typeof parsed.qualityStatus === "string" && parsed.qualityStatus) ||
      (typeof parsed.status === "string" && parsed.status) ||
      undefined,
    styleCoveragePercent:
      typeof summary.styleCoveragePercent === "number"
        ? summary.styleCoveragePercent
        : typeof coverage.styleCoveragePercent === "number"
          ? coverage.styleCoveragePercent
          : undefined,
    invalidFonts:
      typeof validation.invalidFonts === "number"
        ? validation.invalidFonts
        : typeof validation.invalid_fonts === "number"
          ? validation.invalid_fonts
          : undefined,
    italicMismatches:
      typeof validation.italicMismatches === "number"
        ? validation.italicMismatches
        : typeof validation.italic_mismatches === "number"
          ? validation.italic_mismatches
          : undefined,
    contaminationFonts:
      typeof validation.contaminationFonts === "number"
        ? validation.contaminationFonts
        : typeof validation.contamination_fonts === "number"
          ? validation.contamination_fonts
          : undefined,
    missingStyles: Array.isArray(coverage.missingStyles) ? coverage.missingStyles.filter((x: any) => typeof x === "string") : undefined
  };
};

const isInterceptPlaceholderUrl = (url: unknown): boolean => {
  if (typeof url !== "string") return false;
  const token = url.trim().toLowerCase();
  return token === "browser-intercept" || token === "interception-mode";
};

const isDirectFontUrl = (url: unknown): boolean => {
  if (typeof url !== "string") return false;
  return /^https?:\/\//i.test(url) || /^inline-font:\/\//i.test(url);
};

const runCase = async (family: RiskFamily, options: { download: boolean }): Promise<LoopResult> => {
  const started = Date.now();
  const reasons: string[] = [];
  const url = `${TDF_ORIGIN}/${family.route}/${family.slug}`;

  try {
    const scraped = await TheDesignersFoundryScraper.scrape(url);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    if (fonts.length === 0) reasons.push("Scraper returned 0 font candidates.");

    let outputDir: string | undefined;
    let downloadedCount: number | undefined;
    let validation: ValidationSummary | undefined;
    let quality: QualitySummary | undefined;

    if (options.download) {
      const hasPlaceholder = fonts.some((font) => isInterceptPlaceholderUrl(font?.url));
      const directFonts = fonts.filter((font) => isDirectFontUrl(font?.url));
      const targetUrl = scraped.targetUrl || scraped.originalUrl || url;
      const outputFolder = `tdf-precision-${family.slug}-${Date.now()}`;
      const result = await runDownload({
        ...(directFonts.length > 0 && !hasPlaceholder
          ? {
              mode: "batch-direct" as const,
              source: new URL(targetUrl).host,
              fonts: directFonts as any,
              outputFolder,
              metadata: {
                foundry: scraped.foundryName,
                family: scraped.fonts?.[0]?.family || family.title || family.slug,
                targetUrl,
                fonts,
                ...(scraped.metadata || {})
              }
            }
          : {
              mode: "browser-intercept" as const,
              targetUrl,
              outputFolder,
              expectedCount: scraped.expectedCount,
              injectScript: scraped.injectScript,
              masterFoundry: scraped.masterFoundry,
              metadata: {
                foundry: scraped.foundryName,
                family: scraped.fonts?.[0]?.family || family.title || family.slug,
                fonts,
                ...(scraped.metadata || {})
              }
            })
      } as any);

      outputDir = result.outputDir;
      downloadedCount = Array.isArray(result.downloaded) ? result.downloaded.length : 0;
      validation = await loadValidationSummary(outputDir);
      quality = await loadQualitySummary(outputDir);

      if ((downloadedCount || 0) <= 0) reasons.push("Downloader produced 0 files.");
      if (validation?.status?.toLowerCase() === "fail") reasons.push("validation-log status=fail.");
      if (!quality?.qualityStatus) reasons.push("quality-log missing.");
      if (quality?.qualityStatus?.toLowerCase() === "fail") reasons.push("quality-log status=fail.");
      if (quality?.qualityStatus?.toLowerCase() === "warn") reasons.push("quality-log status=warn.");
      if (typeof quality?.styleCoveragePercent === "number" && quality.styleCoveragePercent < 100) {
        reasons.push(`style coverage below 100% (${quality.styleCoveragePercent}%).`);
      }
      if ((quality?.invalidFonts || 0) > 0) reasons.push(`invalid fonts detected (${quality?.invalidFonts}).`);
      if ((quality?.italicMismatches || 0) > 0) reasons.push(`italic mismatches detected (${quality?.italicMismatches}).`);
      if ((quality?.contaminationFonts || 0) > 0) reasons.push(`contamination fonts detected (${quality?.contaminationFonts}).`);
    }

    return {
      slug: family.slug,
      url,
      status: reasons.length === 0 ? "pass" : "fail",
      scrapedFontCount: fonts.length,
      expectedCount: scraped.expectedCount,
      outputDir,
      downloadedCount,
      validation,
      quality,
      reasons,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      slug: family.slug,
      url,
      status: "fail",
      scrapedFontCount: 0,
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started
    };
  }
};

async function run() {
  const startedAt = new Date();
  const { download, includeAllCatalog, includeAllVariable, maxCases, onlySlugs } = parseArgs();
  const discovery = await discoverRiskFamilies({ includeAllCatalog, includeAllVariable, onlySlugs, maxCases });
  if (discovery.selected.length === 0) {
    throw new Error("No TDF risk families selected. Try --include-all-variable or remove --slugs filter.");
  }

  const results: LoopResult[] = [];
  for (const family of discovery.selected) {
    const result = await runCase(family, { download });
    results.push(result);
    const prefix = result.status === "pass" ? "PASS" : "FAIL";
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(
      `[${prefix}] ${family.slug} route=${family.route} overlap=${family.overlapPostscript.length} scraped=${result.scrapedFontCount}${
        typeof result.downloadedCount === "number" ? ` downloaded=${result.downloadedCount}` : ""
      }${reason}`
    );
  }

  const summary = {
    total: results.length,
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length,
    downloadEnabled: download,
    includeAllCatalog,
    includeAllVariable,
    buildId: discovery.buildId,
    totalCatalogFamilies: discovery.totalCatalogFamilies,
    totalVariableFamilies: discovery.totalVariableFamilies,
    totalOverlapFamilies: discovery.totalOverlapFamilies
  };

  const report = {
    suite: "thedesignersfoundry-precision-loop",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    discovery: {
      buildId: discovery.buildId,
      totalCatalogFamilies: discovery.totalCatalogFamilies,
      totalVariableFamilies: discovery.totalVariableFamilies,
      totalOverlapFamilies: discovery.totalOverlapFamilies,
      selectedFamilies: discovery.selected
    },
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `thedesignersfoundry-precision-loop-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`TDF precision loop report: ${path.relative(process.cwd(), reportPath)}`);
  if (summary.failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("TDF precision loop failed:", error);
  process.exitCode = 1;
});
