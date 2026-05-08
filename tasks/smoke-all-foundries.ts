import path from "node:path";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { runDownload } from "@/lib/server/font-downloader";
import { scrapers } from "@/lib/scrapers";

type AllFoundryCase = {
  id: string;
  name: string;
  url: string;
  expectedScraperId: string;
  minDownloaded: number;
  timeoutMs?: number;
  softPassOnNetworkTimeout?: boolean;
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
  validationTotalFiles?: number;
  validationValidFonts?: number;
  validationInvalidFonts?: number;
  validationSubsettedFonts?: number;
  validationNameTableBadFonts?: number;
  validationAverageGlyphs?: number;
  validationAverageFeatureCount?: number;
  qualityStatus?: string;
  styleCoveragePercent?: number;
  contaminationFonts?: number;
  invalidFonts?: number;
  italicMismatches?: number;
  reasons: string[];
  durationMs: number;
};

type AllFoundriesCheckpoint = {
  suite: "all-foundries";
  version: 1;
  startedAt: string;
  updatedAt: string;
  reportPath: string;
  strict: boolean;
  phase13: boolean;
  timeoutMs: number | null;
  selectedCaseIds: string[];
  completedCaseIds: string[];
  results: CaseResult[];
};

type TelemetryEvent = {
  ts: string;
  runId: string;
  event: "suite_start" | "checkpoint_write" | "case_start" | "case_result" | "suite_summary";
  payload: Record<string, unknown>;
};

const CASES: AllFoundryCase[] = [
  { id: "205tf", name: "205TF", url: "https://www.205.tf/pinokio-sans", expectedScraperId: "205tf", minDownloaded: 1 },
  { id: "a2-type", name: "A2 Type", url: "https://a2-type.co.uk/ny-sans", expectedScraperId: "a2-type", minDownloaded: 1 },
  { id: "abcdinamo", name: "ABC Dinamo", url: "https://abcdinamo.com/typefaces/gravity", expectedScraperId: "abcdinamo", minDownloaded: 1 },
  { id: "abjad-type", name: "Abjad Type", url: "https://www.abjadfonts.com/fonts/miknas", expectedScraperId: "abjad-type", minDownloaded: 1 },
  { id: "arillatype", name: "Arilla Type", url: "https://arillatype.studio/font/at-aero", expectedScraperId: "arillatype", minDownloaded: 1 },
  { id: "blazetype", name: "Blaze Type", url: "https://blazetype.eu/typefaces/indecisive-sans/", expectedScraperId: "blazetype", minDownloaded: 1, timeoutMs: 900000 },
  { id: "brandingwithtype", name: "Branding With Type", url: "https://brandingwithtype.com/typefaces/bw-gradual/buy", expectedScraperId: "brandingwithtype", minDownloaded: 1 },
  { id: "commercialtype", name: "Commercial Type", url: "https://commercialtype.com/catalog/focal", expectedScraperId: "commercialtype", minDownloaded: 1 },
  { id: "cotype", name: "CoType", url: "https://cotypefoundry.com/font-family/aeonik", expectedScraperId: "cotype", minDownloaded: 1 },
  { id: "deinwaller", name: "D Einwaller", url: "https://deinwaller.com/gatch-1", expectedScraperId: "deinwaller", minDownloaded: 1 },
  { id: "lineto", name: "Lineto", url: "https://lineto.com/typefaces/akkurat", expectedScraperId: "lineto", minDownloaded: 1 },
  { id: "pangram", name: "Pangram", url: "https://pangrampangram.com/products/frama", expectedScraperId: "pangram", minDownloaded: 1 },
  { id: "grillitype", name: "Grilli Type", url: "https://www.grillitype.com/typeface/gt-standard", expectedScraperId: "grillitype", minDownloaded: 1, timeoutMs: 900000 },
  { id: "w-type", name: "W Type", url: "https://wtypefoundry.com/typefaces/wtf-forma", expectedScraperId: "w-type", minDownloaded: 1 },
  { id: "superiortype", name: "Superior Type", url: "https://superiortype.com/fonts/raptor-v3", expectedScraperId: "superiortype", minDownloaded: 1 },
  { id: "swisstypefaces", name: "Swiss Typefaces", url: "https://www.swisstypefaces.com/fonts/sangbleu/", expectedScraperId: "swisstypefaces", minDownloaded: 1 },
  { id: "ohno", name: "Ohno Type Co", url: "https://ohnotype.co/fonts/degular", expectedScraperId: "ohno", minDownloaded: 1 },
  { id: "klim", name: "Klim", url: "https://klim.co.nz/fonts/founders-grotesk/", expectedScraperId: "klim", minDownloaded: 1 },
  { id: "displaay", name: "Displaay", url: "https://displaay.net/typeface/greed", expectedScraperId: "displaay", minDownloaded: 1 },
  { id: "due-studio", name: "Due Studio", url: "https://www.due-studio.com/typefaces/analo-grotesk", expectedScraperId: "due-studio", minDownloaded: 1 },
  { id: "formulatype", name: "Formula Type", url: "https://formulatype.com/ft-habit", expectedScraperId: "formulatype", minDownloaded: 1 },
  { id: "generaltypestudio", name: "General Type Studio", url: "https://www.generaltypestudio.com/fonts/senes", expectedScraperId: "generaltypestudio", minDownloaded: 1 },
  { id: "groteskly", name: "Groteskly Yours", url: "https://groteskly.xyz/fonts/rothek", expectedScraperId: "groteskly", minDownloaded: 1 },
  { id: "hanli-type", name: "HAL Typefaces", url: "https://type.hanli.eu/gap/", expectedScraperId: "hanli-type", minDownloaded: 1 },
  { id: "intervaltype", name: "Interval Type", url: "https://intervaltype.com/product/algorytm-clear/", expectedScraperId: "intervaltype", minDownloaded: 1 },
  { id: "julytype", name: "JulyType", url: "https://www.julytype.com/typefaces/jt-javel", expectedScraperId: "julytype", minDownloaded: 1 },
  { id: "khtype", name: "KH Type", url: "https://khtype.com/typeface/kh-interference/", expectedScraperId: "khtype", minDownloaded: 1 },
  { id: "massdriver", name: "Mass Driver", url: "https://mass-driver.com/typefaces/md-nichrome", expectedScraperId: "massdriver", minDownloaded: 1 },
  { id: "monolisa", name: "MonoLisa", url: "https://www.monolisa.dev/specimen?scope=full", expectedScraperId: "monolisa", minDownloaded: 1 },
  { id: "thedesignersfoundry", name: "The Designers Foundry", url: "https://www.thedesignersfoundry.com/typeface/tocapu", expectedScraperId: "thedesignersfoundry", minDownloaded: 1 },
  { id: "narrowtype", name: "Narrow Type", url: "https://narrowtype.com/fonts/neolit/", expectedScraperId: "narrowtype", minDownloaded: 1 },
  { id: "nuformtype", name: "Nuform Type", url: "https://nuformtype.com/rotina", expectedScraperId: "nuformtype", minDownloaded: 1 },
  { id: "productiontype", name: "Production Type", url: "https://productiontype.com/font/ciel", expectedScraperId: "productiontype", minDownloaded: 1 },
  { id: "renebieder", name: "Rene Bieder", url: "https://www.renebieder.com/fonts/neue-faktum", expectedScraperId: "renebieder", minDownloaded: 1 },
  { id: "optimo", name: "Optimo", url: "https://optimo.ch/typefaces/basel", expectedScraperId: "optimo", minDownloaded: 1 },
  {
    id: "nodotypefoundry",
    name: "Nodo Type Foundry",
    url: "https://nodotypefoundry.com/typefaces/nt-rappel/",
    expectedScraperId: "nodotypefoundry",
    minDownloaded: 1
  },
  { id: "viktorzumegen", name: "VZWO / Viktor Zumegen", url: "https://www.viktorzumegen.de/choreo-collection.html", expectedScraperId: "viktorzumegen", minDownloaded: 1 },
  { id: "sharptype", name: "Sharp Type", url: "https://www.sharptype.co/typefaces/alpes", expectedScraperId: "sharptype", minDownloaded: 1 },
  {
    id: "sourcetype",
    name: "Source Type",
    url: "https://sourcetype.com/typefaces/15263/un-11",
    expectedScraperId: "sourcetype",
    minDownloaded: 1,
    softPassOnNetworkTimeout: true
  },
  { id: "type-department", name: "Type Department", url: "https://type-department.com/products/non-sans", expectedScraperId: "type-department", minDownloaded: 1 },
  { id: "typefaces-pizza", name: "Typefaces Pizza", url: "https://typefaces.pizza/type/westy", expectedScraperId: "typefaces-pizza", minDownloaded: 1 },
  { id: "typeji", name: "Typeji", url: "https://www.typeji.com/fonts/MinSans", expectedScraperId: "typeji", minDownloaded: 1 },
  { id: "typejockeys", name: "Typejockeys", url: "https://www.typejockeys.com/en/font/marie", expectedScraperId: "typejockeys", minDownloaded: 1 },
  { id: "typetype", name: "TypeType", url: "https://typetype.org/fonts/tt-turns/", expectedScraperId: "typetype", minDownloaded: 1 },
  { id: "typotheque", name: "Typotheque", url: "https://www.typotheque.com/fonts/pristine", expectedScraperId: "typotheque", minDownloaded: 1 },
  { id: "generic", name: "Generic Fallback", url: "https://rsms.me/inter/", expectedScraperId: "generic", minDownloaded: 1 }
];

const toReportTimestamp = (input = new Date()): string =>
  input.toISOString().replace(/[:.]/g, "-");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const strict = !args.includes("--no-strict");
  const phase13 = !args.includes("--no-phase13");
  const resume = args.includes("--resume");
  const rerunFailed = args.includes("--rerun-failed");
  const resetCheckpoint = args.includes("--reset-checkpoint");
  const only = args.find((arg) => arg.startsWith("--foundry="))?.split("=")[1]?.trim().toLowerCase();
  const foundriesArg = args.find((arg) => arg.startsWith("--foundries="))?.split("=")[1]?.trim().toLowerCase();
  const checkpointFile = args.find((arg) => arg.startsWith("--checkpoint-file="))?.split("=")[1]?.trim();
  const foundries = foundriesArg
    ? foundriesArg
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const offset = Number(args.find((arg) => arg.startsWith("--offset="))?.split("=")[1] || 0);
  const limitRaw = args.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
  const limit = typeof limitRaw === "string" && limitRaw.trim() ? Number(limitRaw) : undefined;
  const timeoutRaw = args.find((arg) => arg.startsWith("--timeout-ms="))?.split("=")[1];
  const timeoutMs =
    typeof timeoutRaw === "string" && timeoutRaw.trim() && Number(timeoutRaw) > 0 ? Number(timeoutRaw) : undefined;
  const telemetryFile = args.find((arg) => arg.startsWith("--telemetry-file="))?.split("=")[1]?.trim();

  return {
    strict,
    phase13,
    resume,
    rerunFailed,
    resetCheckpoint,
    only,
    checkpointFile,
    foundries,
    offset: Number.isFinite(offset) ? Math.max(0, offset) : 0,
    limit: typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, limit) : undefined,
    timeoutMs,
    telemetryFile
  };
};

const toAbsolutePath = (value: string): string =>
  path.isAbsolute(value) ? value : path.join(process.cwd(), value);

const defaultCheckpointPath = path.join("tasks", "reports", "smoke-all-foundries-checkpoint.json");

const loadCheckpoint = async (checkpointPath: string): Promise<AllFoundriesCheckpoint | undefined> => {
  try {
    const raw = await readFile(checkpointPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AllFoundriesCheckpoint>;
    if (parsed?.suite !== "all-foundries") return undefined;
    if (!Array.isArray(parsed.results)) return undefined;
    return {
      suite: "all-foundries",
      version: 1,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      reportPath: typeof parsed.reportPath === "string" ? parsed.reportPath : "",
      strict: Boolean(parsed.strict),
      phase13: typeof parsed.phase13 === "boolean" ? parsed.phase13 : true,
      timeoutMs: typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : null,
      selectedCaseIds: Array.isArray(parsed.selectedCaseIds) ? parsed.selectedCaseIds.filter((value) => typeof value === "string") : [],
      completedCaseIds: Array.isArray(parsed.completedCaseIds)
        ? parsed.completedCaseIds.filter((value) => typeof value === "string")
        : [],
      results: parsed.results
    };
  } catch {
    return undefined;
  }
};

const dedupeCaseResults = (items: CaseResult[]): CaseResult[] => {
  const byId = new Map<string, CaseResult>();
  for (const item of items) {
    if (!item?.id) continue;
    byId.set(item.id, item);
  }

  const ordered: CaseResult[] = [];
  const seen = new Set<string>();
  for (const testCase of CASES) {
    const item = byId.get(testCase.id);
    if (!item) continue;
    ordered.push(item);
    seen.add(testCase.id);
  }
  for (const [id, item] of byId.entries()) {
    if (seen.has(id)) continue;
    ordered.push(item);
  }
  return ordered;
};

type QualitySnapshot = {
  qualityStatus?: string;
  styleCoveragePercent?: number;
  contaminationFonts?: number;
  invalidFonts?: number;
  italicMismatches?: number;
};

const isInterceptPlaceholderUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const token = value.trim().toLowerCase();
  return token === "browser-intercept" || token === "interception-mode";
};

const isDirectFontUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) || /^inline-font:\/\/[a-z0-9]+$/i.test(trimmed);
};

const asFiniteNumber = (value: unknown): number | undefined => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

type ValidationSummarySnapshot = {
  status?: string;
  total_files?: number;
  valid_fonts?: number;
  invalid_fonts?: number;
  subsetted_fonts?: number;
  name_table_bad_fonts?: number;
  average_glyphs?: number;
  average_feature_count?: number;
};

const loadValidationSummary = async (outputDir: string): Promise<ValidationSummarySnapshot> => {
  const roots = [
    path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir),
    path.join(process.cwd(), outputDir)
  ];

  for (const root of roots) {
    const validationPath = path.join(root, "validation-log.json");
    try {
      const raw = await readFile(validationPath, "utf8");
      const parsed = JSON.parse(raw);
      const summary = parsed?.summary || {};
      return {
        status: typeof summary?.status === "string" ? summary.status : undefined,
        total_files: asFiniteNumber(summary?.total_files),
        valid_fonts: asFiniteNumber(summary?.valid_fonts),
        invalid_fonts: asFiniteNumber(summary?.invalid_fonts),
        subsetted_fonts: asFiniteNumber(summary?.subsetted_fonts),
        name_table_bad_fonts: asFiniteNumber(summary?.name_table_bad_fonts),
        average_glyphs: asFiniteNumber(summary?.average_glyphs),
        average_feature_count: asFiniteNumber(summary?.average_feature_count)
      };
    } catch {
      // best effort
    }
  }
  return {};
};

const loadQualitySnapshot = async (outputDir: string): Promise<QualitySnapshot> => {
  const roots = [
    path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir),
    path.join(process.cwd(), outputDir)
  ];

  for (const root of roots) {
    for (const fileName of ["quality-log.json", "monolisa-quality-log.json"]) {
      const qualityPath = path.join(root, fileName);
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
  }
  return {};
};

const classifyReasonTaxonomy = (reason: string): string => {
  const normalized = String(reason || "").toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("timed out")) return "timeout";
  if (normalized.includes("quality-log status=fail")) return "quality_fail";
  if (normalized.includes("quality-log status=warn")) return "quality_warn";
  if (normalized.includes("style coverage too low")) return "coverage_low";
  if (normalized.includes("invalid fonts detected")) return "invalid_fonts";
  if (normalized.includes("italic mismatches")) return "italic_mismatch";
  if (normalized.includes("contamination fonts")) return "contamination";
  if (normalized.includes("validation-log status=fail")) return "validation_fail";
  if (normalized.includes("scraper returned 0")) return "no_candidates";
  if (normalized.includes("no scraper matched")) return "no_scraper";
  if (normalized.includes("downloaded only")) return "download_count_low";
  if (normalized.includes("first skip reason")) return "skip_signal";
  if (normalized.includes("expected scraper")) return "scraper_mismatch";
  if (normalized.includes("failed to fetch") || normalized.includes("request gagal")) return "network_fetch";
  return "other";
};

const extractReasonTaxonomy = (reasons: string[]): string[] => {
  const counts = new Map<string, number>();
  for (const reason of reasons) {
    const key = classifyReasonTaxonomy(reason);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
};

const NETWORK_TIMEOUT_SIGNAL_RE =
  /\b(err_connection_timed_out|timed out|timeout|failed to connect|connection attempt failed|econnrefused|enotfound|ehostunreach)\b/i;

const isNetworkTimeoutReason = (value: string): boolean => NETWORK_TIMEOUT_SIGNAL_RE.test(String(value || ""));

const maybeSoftPassNetworkTimeout = (testCase: AllFoundryCase, result: CaseResult): CaseResult => {
  if (!testCase.softPassOnNetworkTimeout) return result;
  if (result.status !== "fail") return result;
  if (result.downloadedCount > 0) return result;
  if (!Array.isArray(result.reasons) || result.reasons.length === 0) return result;
  if (!result.reasons.some((reason) => isNetworkTimeoutReason(reason))) return result;

  return {
    ...result,
    status: "pass",
    reasons: [...result.reasons, "network timeout soft-pass enabled for this foundry."]
  };
};

const createTelemetryEmitter = async (telemetryPath: string, runId: string) => {
  await mkdir(path.dirname(telemetryPath), { recursive: true });

  return async (event: TelemetryEvent["event"], payload: Record<string, unknown>) => {
    const row: TelemetryEvent = {
      ts: new Date().toISOString(),
      runId,
      event,
      payload
    };
    try {
      await appendFile(telemetryPath, JSON.stringify(row) + "\n", "utf8");
    } catch {
      // best effort telemetry
    }
  };
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
    const hasPlaceholder = fonts.some((font) => isInterceptPlaceholderUrl(font?.url));
    const directFonts = fonts.filter((font) => isDirectFontUrl(font?.url));
    const targetUrl = scraped.targetUrl || scraped.originalUrl || testCase.url;

    const result = await runDownload({
      ...(directFonts.length > 0 && !hasPlaceholder
        ? {
            mode: "batch-direct" as const,
            source: new URL(targetUrl).host,
            fonts: directFonts as any,
            outputFolder,
            metadata: {
              foundry: scraped.foundryName,
              family: familyHint,
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
              family: familyHint,
              fonts,
              ...(scraped.metadata || {})
            }
          })
    } as any);

    const downloadedCount = Array.isArray(result.downloaded) ? result.downloaded.length : 0;
    const skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;
    const validation = await loadValidationSummary(result.outputDir);
    const validationStatus = validation.status;
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

    return maybeSoftPassNetworkTimeout(testCase, {
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
      validationTotalFiles: validation.total_files,
      validationValidFonts: validation.valid_fonts,
      validationInvalidFonts: validation.invalid_fonts,
      validationSubsettedFonts: validation.subsetted_fonts,
      validationNameTableBadFonts: validation.name_table_bad_fonts,
      validationAverageGlyphs: validation.average_glyphs,
      validationAverageFeatureCount: validation.average_feature_count,
      qualityStatus: quality.qualityStatus,
      styleCoveragePercent: quality.styleCoveragePercent,
      contaminationFonts: quality.contaminationFonts,
      invalidFonts: quality.invalidFonts,
      italicMismatches: quality.italicMismatches,
      reasons,
      durationMs: Date.now() - started
    });
  } catch (error) {
    return maybeSoftPassNetworkTimeout(testCase, {
      id: testCase.id,
      name: testCase.name,
      url: testCase.url,
      status: "fail",
      downloadedCount: 0,
      skippedCount: 0,
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started
    });
  }
};

async function run() {
  const {
    strict,
    phase13,
    resume,
    rerunFailed,
    resetCheckpoint,
    checkpointFile,
    only,
    foundries,
    offset,
    limit,
    timeoutMs,
    telemetryFile
  } = parseArgs();

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });

  const checkpointPath = toAbsolutePath(checkpointFile && checkpointFile.trim() ? checkpointFile : defaultCheckpointPath);
  await mkdir(path.dirname(checkpointPath), { recursive: true });

  if (resetCheckpoint) {
    await unlink(checkpointPath).catch(() => undefined);
  }

  let selected = CASES;
  if (only) {
    selected = selected.filter((item) => item.id === only || item.id.includes(only));
  }
  if (foundries.length > 0) {
    selected = selected.filter((item) => foundries.some((token) => item.id === token || item.id.includes(token)));
  }
  if (offset > 0) {
    selected = selected.slice(offset);
  }
  if (typeof limit === "number") {
    selected = selected.slice(0, limit);
  }

  if (selected.length === 0) {
    console.error("No cases selected.");
    process.exitCode = 1;
    return;
  }

  let startedAt = new Date();
  let reportPath = path.join(reportsDir, `smoke-all-foundries-${toReportTimestamp(startedAt)}.json`);
  const resultById = new Map<string, CaseResult>();

  if (resume) {
    const checkpoint = await loadCheckpoint(checkpointPath);
    if (checkpoint) {
      startedAt = new Date(checkpoint.startedAt);
      if (Number.isNaN(startedAt.getTime())) startedAt = new Date();
      if (checkpoint.reportPath) {
        reportPath = toAbsolutePath(checkpoint.reportPath);
      }
      for (const result of checkpoint.results) {
        if (result?.id) resultById.set(result.id, result);
      }

      if (checkpoint.strict !== strict || checkpoint.phase13 !== phase13) {
        console.warn(
          `[Resume] checkpoint options differ (checkpoint strict=${checkpoint.strict}, phase13=${checkpoint.phase13}; current strict=${strict}, phase13=${phase13}).`
        );
      }
      console.log(
        `[Resume] loaded checkpoint: completed=${checkpoint.completedCaseIds.length}/${checkpoint.selectedCaseIds.length}.`
      );
    } else {
      console.log("[Resume] checkpoint not found; starting fresh.");
    }
  }

  const selectedIds = new Set(selected.map((item) => item.id));
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const telemetryPath = toAbsolutePath(
    telemetryFile && telemetryFile.trim()
      ? telemetryFile
      : reportPath.replace(/\.json$/i, ".jsonl")
  );
  if (resetCheckpoint && !resume) {
    await unlink(telemetryPath).catch(() => undefined);
  }
  const emitTelemetry = await createTelemetryEmitter(telemetryPath, runId);
  const getResults = (): CaseResult[] => dedupeCaseResults([...resultById.values()]);
  const summarizeSelected = (items: CaseResult[]) => {
    const scoped = items.filter((item) => selectedIds.has(item.id));
    return {
      strict,
      phase13,
      timeoutMs: timeoutMs ?? null,
      total: selected.length,
      completed: scoped.length,
      pending: Math.max(0, selected.length - scoped.length),
      passed: scoped.filter((item) => item.status === "pass").length,
      failed: scoped.filter((item) => item.status === "fail").length
    };
  };

  const writeProgress = async () => {
    const results = getResults();
    const summary = summarizeSelected(results);
    const completedCaseIds = results.filter((item) => selectedIds.has(item.id)).map((item) => item.id);

    const report = {
      suite: "all-foundries",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      options: {
        strict,
        phase13,
        timeoutMs: timeoutMs ?? null,
        resume,
        rerunFailed,
        checkpointFile: path.relative(process.cwd(), checkpointPath)
      },
      summary,
      results
    };

    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    const checkpoint: AllFoundriesCheckpoint = {
      suite: "all-foundries",
      version: 1,
      startedAt: startedAt.toISOString(),
      updatedAt: new Date().toISOString(),
      reportPath,
      strict,
      phase13,
      timeoutMs: timeoutMs ?? null,
      selectedCaseIds: selected.map((item) => item.id),
      completedCaseIds,
      results
    };
    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
    await emitTelemetry("checkpoint_write", {
      summary,
      completedCaseIds,
      checkpointPath: path.relative(process.cwd(), checkpointPath),
      reportPath: path.relative(process.cwd(), reportPath)
    });
  };

  const pendingCases = selected.filter((testCase) => {
    const previous = resultById.get(testCase.id);
    if (!previous) return true;
    if (rerunFailed) return previous.status === "fail";
    return false;
  });

  await writeProgress();
  await emitTelemetry("suite_start", {
    strict,
    phase13,
    timeoutMs: timeoutMs ?? null,
    selectedCaseIds: selected.map((item) => item.id),
    checkpointPath: path.relative(process.cwd(), checkpointPath),
    reportPath: path.relative(process.cwd(), reportPath),
    telemetryPath: path.relative(process.cwd(), telemetryPath)
  });

  if (pendingCases.length === 0) {
    console.log("[Resume] all selected cases are already completed. use --rerun-failed to rerun failed entries only.");
  }

  for (const testCase of pendingCases) {
    console.log(`Running all-foundries smoke: ${testCase.name} -> ${testCase.url}`);
    await emitTelemetry("case_start", {
      id: testCase.id,
      name: testCase.name,
      url: testCase.url,
      expectedScraperId: testCase.expectedScraperId,
      minDownloaded: testCase.minDownloaded,
      timeoutMs: testCase.timeoutMs ?? timeoutMs ?? null
    });

    const runCaseWithOptionalTimeout = async (): Promise<CaseResult> => {
      const effectiveTimeoutMs = testCase.timeoutMs ?? timeoutMs;
      if (!effectiveTimeoutMs) return runCase(testCase, { strict, phase13 });

      return await new Promise<CaseResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(maybeSoftPassNetworkTimeout(testCase, {
            id: testCase.id,
            name: testCase.name,
            url: testCase.url,
            status: "fail",
            downloadedCount: 0,
            skippedCount: 0,
            reasons: [`Case timed out after ${effectiveTimeoutMs}ms.`],
            durationMs: effectiveTimeoutMs
          }));
        }, effectiveTimeoutMs);

        if (typeof timer.unref === "function") {
          timer.unref();
        }

        runCase(testCase, { strict, phase13 }).then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          }
        );
      });
    };

    const result = await runCaseWithOptionalTimeout();
    resultById.set(result.id, result);

    const prefix = result.status === "pass" ? "PASS" : "FAIL";
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(
      `[${prefix}] ${result.name} scraper=${result.scraper || "-"} downloaded=${result.downloadedCount} skipped=${result.skippedCount}${reason}`
    );
    await emitTelemetry("case_result", {
      id: result.id,
      name: result.name,
      status: result.status,
      scraper: result.scraper || null,
      foundry: result.foundry || null,
      downloadedCount: result.downloadedCount,
      skippedCount: result.skippedCount,
      durationMs: result.durationMs,
      qualityStatus: result.qualityStatus || null,
      styleCoveragePercent: result.styleCoveragePercent ?? null,
      invalidFonts: result.invalidFonts ?? null,
      italicMismatches: result.italicMismatches ?? null,
      validationStatus: result.validationStatus || null,
      outputDir: result.outputDir || null,
      reasons: result.reasons,
      reasonTaxonomy: extractReasonTaxonomy(result.reasons)
    });

    await writeProgress().catch(() => undefined);
  }

  await writeProgress();
  console.log(`All foundries report: ${path.relative(process.cwd(), reportPath)}`);

  const summary = summarizeSelected(getResults());
  await emitTelemetry("suite_summary", {
    summary,
    reportPath: path.relative(process.cwd(), reportPath),
    telemetryPath: path.relative(process.cwd(), telemetryPath)
  });
  if (strict && summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("All-foundries smoke failed:", error);
  process.exitCode = 1;
});


