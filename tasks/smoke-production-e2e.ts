import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const PRODUCTION_BASE = "https://specimen.krtalabs.xyz";
const ANALYZE_ENDPOINT = `${PRODUCTION_BASE}/api/analyze-url`;
const DOWNLOAD_ENDPOINT = `${PRODUCTION_BASE}/api/font-download`;
const REQUEST_TIMEOUT_MS = 180_000;
const INTER_REQUEST_DELAY_MS = 2000;

type FoundryTestCase = {
  id: string;
  name: string;
  url: string;
  minFonts: number;
};

type PhaseResult = {
  phase: "analyze" | "download";
  status: "pass" | "fail" | "skip" | "timeout";
  durationMs: number;
  error?: string;
  data?: Record<string, unknown>;
};

type TestResult = {
  id: string;
  name: string;
  url: string;
  status: "pass" | "fail";
  phases: PhaseResult[];
  analyzeResult?: {
    scraperName?: string;
    foundryName?: string;
    fontCount: number;
    mode: "batch-direct" | "browser-intercept" | "unknown";
  };
  downloadResult?: {
    receivedBytes: number;
    contentType?: string;
    zipFile?: string;
    downloadedCount?: number;
  };
  reasons: string[];
  durationMs: number;
};

type Checkpoint = {
  suite: "production-e2e";
  startedAt: string;
  updatedAt: string;
  completedIds: string[];
  results: TestResult[];
};

const FOUNDRY_CASES: FoundryTestCase[] = [
  { id: "205tf", name: "205TF", url: "https://www.205.tf/pinokio-sans", minFonts: 1 },
  { id: "a2-type", name: "A2 Type", url: "https://a2-type.co.uk/ny-sans", minFonts: 1 },
  { id: "abcdinamo", name: "ABC Dinamo", url: "https://abcdinamo.com/typefaces/gravity", minFonts: 1 },
  { id: "abjad-type", name: "Abjad Type", url: "https://www.abjadfonts.com/fonts/miknas", minFonts: 1 },
  { id: "arillatype", name: "Arilla Type", url: "https://arillatype.studio/font/at-aero", minFonts: 1 },
  { id: "blazetype", name: "Blaze Type", url: "https://blazetype.eu/typefaces/indecisive-sans/", minFonts: 1 },
  { id: "brandingwithtype", name: "Branding With Type", url: "https://brandingwithtype.com/typefaces/bw-gradual/buy", minFonts: 1 },
  { id: "commercialtype", name: "Commercial Type", url: "https://commercialtype.com/catalog/focal", minFonts: 1 },
  { id: "cotype", name: "CoType", url: "https://cotypefoundry.com/font-family/aeonik", minFonts: 1 },
  { id: "deinwaller", name: "D Einwaller", url: "https://deinwaller.com/gatch-1", minFonts: 1 },
  { id: "displaay", name: "Displaay", url: "https://displaay.net/typeface/greed", minFonts: 1 },
  { id: "due-studio", name: "Due Studio", url: "https://www.due-studio.com/typefaces/analo-grotesk", minFonts: 1 },
  { id: "fairetype", name: "Faire Type", url: "https://fairetype.com/", minFonts: 1 },
  { id: "formulatype", name: "Formula Type", url: "https://formulatype.com/ft-habit", minFonts: 1 },
  { id: "generaltypestudio", name: "General Type Studio", url: "https://www.generaltypestudio.com/fonts/senes", minFonts: 1 },
  { id: "grillitype", name: "Grilli Type", url: "https://www.grillitype.com/typeface/gt-standard", minFonts: 1 },
  { id: "groteskly", name: "Groteskly Yours", url: "https://groteskly.xyz/fonts/rothek", minFonts: 1 },
  { id: "hanli-type", name: "HAL Typefaces", url: "https://type.hanli.eu/gap/", minFonts: 1 },
  { id: "intervaltype", name: "Interval Type", url: "https://intervaltype.com/product/algorytm-clear/", minFonts: 1 },
  { id: "julytype", name: "JulyType", url: "https://www.julytype.com/typefaces/jt-javel", minFonts: 1 },
  { id: "khtype", name: "KH Type", url: "https://khtype.com/typeface/kh-interference/", minFonts: 1 },
  { id: "klim", name: "Klim", url: "https://klim.co.nz/fonts/founders-grotesk/", minFonts: 1 },
  { id: "lineto", name: "Lineto", url: "https://lineto.com/typefaces/akkurat", minFonts: 1 },
  { id: "massdriver", name: "Mass Driver", url: "https://mass-driver.com/typefaces/md-nichrome", minFonts: 1 },
  { id: "monolisa", name: "MonoLisa", url: "https://www.monolisa.dev/specimen?scope=full", minFonts: 1 },
  { id: "narrowtype", name: "Narrow Type", url: "https://narrowtype.com/fonts/neolit/", minFonts: 1 },
  { id: "nodotypefoundry", name: "Nodo Type Foundry", url: "https://nodotypefoundry.com/typefaces/nt-rappel/", minFonts: 1 },
  { id: "nuformtype", name: "Nuform Type", url: "https://nuformtype.com/rotina", minFonts: 1 },
  { id: "ohno", name: "Ohno Type Co", url: "https://ohnotype.co/fonts/degular", minFonts: 1 },
  { id: "optimo", name: "Optimo", url: "https://optimo.ch/typefaces/basel", minFonts: 1 },
  { id: "pangram", name: "Pangram", url: "https://pangrampangram.com/products/neue-montreal", minFonts: 1 },
  { id: "productiontype", name: "Production Type", url: "https://productiontype.com/font/ciel", minFonts: 1 },
  { id: "renebieder", name: "Rene Bieder", url: "https://www.renebieder.com/fonts/neue-faktum", minFonts: 1 },
  { id: "saschabente", name: "Sascha Bente", url: "https://saschabente.de/", minFonts: 1 },
  { id: "sharptype", name: "Sharp Type", url: "https://www.sharptype.co/typefaces/alpes", minFonts: 1 },
  { id: "sourcetype", name: "Source Type", url: "https://sourcetype.com/typefaces/15263/un-11", minFonts: 1 },
  { id: "superiortype", name: "Superior Type", url: "https://superiortype.com/fonts/raptor-v3", minFonts: 1 },
  { id: "swisstypefaces", name: "Swiss Typefaces", url: "https://www.swisstypefaces.com/fonts/sangbleu/", minFonts: 1 },
  { id: "thedesignersfoundry", name: "The Designers Foundry", url: "https://www.thedesignersfoundry.com/typeface/tocapu", minFonts: 1 },
  { id: "type-department", name: "Type Department", url: "https://type-department.com/products/non-sans", minFonts: 1 },
  { id: "typefaces-pizza", name: "Typefaces Pizza", url: "https://typefaces.pizza/type/westy", minFonts: 1 },
  { id: "typeji", name: "Typeji", url: "https://www.typeji.com/fonts/MinSans", minFonts: 1 },
  { id: "typejockeys", name: "Typejockeys", url: "https://www.typejockeys.com/en/font/marie", minFonts: 1 },
  { id: "typetype", name: "TypeType", url: "https://typetype.org/fonts/tt-turns/", minFonts: 1 },
  { id: "typotheque", name: "Typotheque", url: "https://www.typotheque.com/fonts/pristine", minFonts: 1 },
  { id: "viktorzumegen", name: "Viktor Zumegen", url: "https://www.viktorzumegen.de/choreo-collection.html", minFonts: 1 },
  { id: "w-type", name: "W Type", url: "https://wtypefoundry.com/typefaces/wtf-forma", minFonts: 1 },
  { id: "generic", name: "Generic Fallback", url: "https://rsms.me/inter/", minFonts: 1 },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const isInterceptPlaceholder = (url: unknown): boolean =>
  typeof url === "string" &&
  (url.trim().toLowerCase() === "browser-intercept" ||
    url.trim().toLowerCase() === "interception-mode");

const isDirectUrl = (url: unknown): url is string =>
  typeof url === "string" && /^https?:\/\//i.test(url.trim());

const CHECKPOINT_PATH = path.join("tasks", "reports", "production-e2e-checkpoint.json");

const loadCheckpoint = async (): Promise<Checkpoint | undefined> => {
  try {
    const raw = await readFile(CHECKPOINT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.suite !== "production-e2e") return undefined;
    return parsed as Checkpoint;
  } catch {
    return undefined;
  }
};

const saveCheckpoint = async (checkpoint: Checkpoint): Promise<void> => {
  await mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  await writeFile(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), "utf8");
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  return {
    resume: args.includes("--resume"),
    rerunFailed: args.includes("--rerun-failed"),
    only: args.find((a) => a.startsWith("--foundry="))?.split("=")[1]?.trim(),
    limit: (() => {
      const v = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
      return v ? parseInt(v, 10) : undefined;
    })(),
    offset: (() => {
      const v = args.find((a) => a.startsWith("--offset="))?.split("=")[1];
      return v ? parseInt(v, 10) : 0;
    })(),
  };
};

async function runAnalyzePhase(testCase: FoundryTestCase): Promise<PhaseResult & { body?: any }> {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(
      ANALYZE_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: testCase.url }),
      },
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        phase: "analyze",
        status: "fail",
        durationMs: Date.now() - started,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
      };
    }

    const body = await response.json();
    return {
      phase: "analyze",
      status: "pass",
      durationMs: Date.now() - started,
      data: {
        scraperName: body.scraperName,
        foundryName: body.foundryName,
        fontCount: Array.isArray(body.fonts) ? body.fonts.length : 0,
      },
      body,
    };
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    return {
      phase: "analyze",
      status: isTimeout ? "timeout" : "fail",
      durationMs: Date.now() - started,
      error: error.message,
    };
  }
}

async function runDownloadPhase(
  scrapeResult: any,
  testCase: FoundryTestCase
): Promise<PhaseResult & { downloadData?: any }> {
  const started = Date.now();
  const fonts = Array.isArray(scrapeResult.fonts) ? scrapeResult.fonts : [];
  const hasPlaceholder = fonts.some((f: any) => isInterceptPlaceholder(f?.url));
  const directFonts = fonts.filter((f: any) => isDirectUrl(f?.url));

  if (directFonts.length === 0 && !hasPlaceholder) {
    return {
      phase: "download",
      status: "skip",
      durationMs: Date.now() - started,
      error: "No downloadable font URLs found in scrape result.",
    };
  }

  const familyHint = fonts[0]?.metadata?.family || fonts[0]?.family || testCase.id;
  const targetUrl = scrapeResult.targetUrl || scrapeResult.originalUrl || testCase.url;

  const payload =
    directFonts.length > 0 && !hasPlaceholder
      ? {
          mode: "batch-direct",
          source: new URL(targetUrl).host,
          fonts: directFonts,
          outputFolder: `e2e-prod-${testCase.id}`,
          metadata: {
            foundry: scrapeResult.foundryName,
            family: familyHint,
            targetUrl,
            fonts,
            ...(scrapeResult.metadata || {}),
          },
        }
      : {
          mode: "browser-intercept",
          targetUrl,
          outputFolder: `e2e-prod-${testCase.id}`,
          stream: true,
          expectedCount: scrapeResult.expectedCount,
          injectScript: scrapeResult.injectScript,
          metadata: {
            foundry: scrapeResult.foundryName,
            family: familyHint,
            fonts,
            ...(scrapeResult.metadata || {}),
          },
        };

  try {
    const response = await fetchWithTimeout(
      DOWNLOAD_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      600_000 // 10 minute timeout for downloads
    );

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/zip")) {
      const buffer = await response.arrayBuffer();
      const disposition = response.headers.get("content-disposition") || "";
      const fileMatch = disposition.match(/filename="([^"]+)"/);
      const resultHeader = response.headers.get("x-download-result");
      let downloadedCount: number | undefined;
      try {
        const parsed = JSON.parse(resultHeader || "{}");
        downloadedCount = parsed.downloadedCount;
      } catch {}

      return {
        phase: "download",
        status: "pass",
        durationMs: Date.now() - started,
        data: { receivedBytes: buffer.byteLength, contentType },
        downloadData: {
          receivedBytes: buffer.byteLength,
          contentType,
          zipFile: fileMatch?.[1],
          downloadedCount,
        },
      };
    }

    if (contentType.includes("ndjson")) {
      const text = await response.text();
      const lines = text.split("\n").filter(Boolean);
      let finalResult: any;
      let zipSize = 0;
      let zipFile: string | undefined;

      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "result") {
            finalResult = event.result;
            zipSize = event.zipBase64 ? Math.round((event.zipBase64.length * 3) / 4) : 0;
            zipFile = event.zipFile;
          }
          if (event.type === "error") {
            return {
              phase: "download",
              status: "fail",
              durationMs: Date.now() - started,
              error: event.error,
            };
          }
        } catch {}
      }

      if (finalResult) {
        return {
          phase: "download",
          status: "pass",
          durationMs: Date.now() - started,
          downloadData: {
            receivedBytes: zipSize,
            contentType,
            zipFile,
            downloadedCount: finalResult.downloaded?.length,
          },
        };
      }

      return {
        phase: "download",
        status: "fail",
        durationMs: Date.now() - started,
        error: "Stream completed without result event.",
      };
    }

    const errorBody = await response.text().catch(() => "");
    return {
      phase: "download",
      status: "fail",
      durationMs: Date.now() - started,
      error: `HTTP ${response.status}: ${errorBody.slice(0, 300)}`,
    };
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    return {
      phase: "download",
      status: isTimeout ? "timeout" : "fail",
      durationMs: Date.now() - started,
      error: error.message,
    };
  }
}

async function runTestCase(testCase: FoundryTestCase): Promise<TestResult> {
  const started = Date.now();
  const phases: PhaseResult[] = [];
  const reasons: string[] = [];

  // Phase 1: Analyze
  const analyzePhase = await runAnalyzePhase(testCase);
  phases.push({ phase: analyzePhase.phase, status: analyzePhase.status, durationMs: analyzePhase.durationMs, error: analyzePhase.error });

  if (analyzePhase.status !== "pass" || !analyzePhase.body) {
    reasons.push(`Analyze failed: ${analyzePhase.error || "unknown"}`);
    return {
      id: testCase.id,
      name: testCase.name,
      url: testCase.url,
      status: "fail",
      phases,
      reasons,
      durationMs: Date.now() - started,
    };
  }

  const fontCount = Array.isArray(analyzePhase.body.fonts) ? analyzePhase.body.fonts.length : 0;
  const hasDirectFonts = analyzePhase.body.fonts?.some((f: any) => isDirectUrl(f?.url));
  const mode = hasDirectFonts ? "batch-direct" : "browser-intercept";

  if (fontCount === 0) {
    reasons.push("Scraper returned 0 font candidates.");
  }

  // Phase 2: Download
  const downloadPhase = await runDownloadPhase(analyzePhase.body, testCase);
  phases.push({
    phase: downloadPhase.phase,
    status: downloadPhase.status,
    durationMs: downloadPhase.durationMs,
    error: downloadPhase.error,
  });

  if (downloadPhase.status === "skip") {
    reasons.push(`Download skipped: ${downloadPhase.error}`);
  } else if (downloadPhase.status !== "pass") {
    reasons.push(`Download failed: ${downloadPhase.error || "unknown"}`);
  }

  const downloadedCount = downloadPhase.downloadData?.downloadedCount ?? 0;
  if (downloadPhase.status === "pass" && downloadedCount < testCase.minFonts) {
    reasons.push(`Downloaded ${downloadedCount} < minimum ${testCase.minFonts}.`);
  }

  return {
    id: testCase.id,
    name: testCase.name,
    url: testCase.url,
    status: reasons.length === 0 ? "pass" : "fail",
    phases,
    analyzeResult: {
      scraperName: analyzePhase.body?.scraperName,
      foundryName: analyzePhase.body?.foundryName,
      fontCount,
      mode,
    },
    downloadResult: downloadPhase.downloadData,
    reasons,
    durationMs: Date.now() - started,
  };
}

async function main() {
  const { resume, rerunFailed, only, limit, offset } = parseArgs();
  const reportsDir = path.join("tasks", "reports");
  await mkdir(reportsDir, { recursive: true });

  let cases = FOUNDRY_CASES;
  if (only) cases = cases.filter((c) => c.id === only || c.id.includes(only));
  if (offset > 0) cases = cases.slice(offset);
  if (limit) cases = cases.slice(0, limit);

  const resultById = new Map<string, TestResult>();

  if (resume) {
    const checkpoint = await loadCheckpoint();
    if (checkpoint) {
      for (const r of checkpoint.results) resultById.set(r.id, r);
      console.log(`[Resume] loaded ${checkpoint.completedIds.length} completed results.`);
    }
  }

  const pending = cases.filter((c) => {
    const prev = resultById.get(c.id);
    if (!prev) return true;
    if (rerunFailed) return prev.status === "fail";
    return false;
  });

  console.log(`\n=== Production E2E Smoke Test ===`);
  console.log(`Target: ${PRODUCTION_BASE}`);
  console.log(`Cases: ${cases.length} total, ${pending.length} pending\n`);

  for (let i = 0; i < pending.length; i++) {
    const tc = pending[i];
    console.log(`[${i + 1}/${pending.length}] ${tc.name} -> ${tc.url}`);

    const result = await runTestCase(tc);
    resultById.set(result.id, result);

    const tag = result.status === "pass" ? "PASS" : "FAIL";
    const detail = result.reasons.length > 0 ? ` | ${result.reasons[0]}` : "";
    const dlCount = result.downloadResult?.downloadedCount ?? "-";
    console.log(
      `  [${tag}] scraper=${result.analyzeResult?.scraperName || "-"} fonts=${dlCount} ${(result.durationMs / 1000).toFixed(1)}s${detail}`
    );

    // Save checkpoint after each case
    const allResults = [...resultById.values()];
    await saveCheckpoint({
      suite: "production-e2e",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedIds: allResults.map((r) => r.id),
      results: allResults,
    });

    if (i < pending.length - 1) await sleep(INTER_REQUEST_DELAY_MS);
  }

  // Final report
  const allResults = [...resultById.values()];
  const passed = allResults.filter((r) => r.status === "pass").length;
  const failed = allResults.filter((r) => r.status === "fail").length;

  const reportPath = path.join(reportsDir, `production-e2e-${Date.now()}.json`);
  const report = {
    suite: "production-e2e",
    target: PRODUCTION_BASE,
    timestamp: new Date().toISOString(),
    summary: { total: allResults.length, passed, failed },
    results: allResults,
    failures: allResults
      .filter((r) => r.status === "fail")
      .map((r) => ({ id: r.id, name: r.name, reasons: r.reasons })),
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}/${allResults.length}`);
  console.log(`Failed: ${failed}/${allResults.length}`);
  console.log(`Report: ${reportPath}\n`);

  if (failed > 0) {
    console.log("Failed foundries:");
    for (const r of allResults.filter((r) => r.status === "fail")) {
      console.log(`  - ${r.name}: ${r.reasons.join("; ")}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("E2E smoke failed:", e);
  process.exitCode = 1;
});
