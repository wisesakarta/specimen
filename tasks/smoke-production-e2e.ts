import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const PRODUCTION_BASE = process.env.API_URL || "https://specimen.krtalabs.xyz";
const ANALYZE_ENDPOINT = `${PRODUCTION_BASE}/api/analyze-url`;
const LEGACY_DOWNLOAD_ENDPOINT = `${PRODUCTION_BASE}/api/font-download`;
const JOBS_ENDPOINT = `${PRODUCTION_BASE}/api/jobs`;
const REQUEST_TIMEOUT_MS = 180_000;
const INTER_REQUEST_DELAY_MS = 2000;
const LEGACY_DIRECT_CHUNK_SIZE = Math.max(1, Number.parseInt(process.env.LEGACY_DIRECT_CHUNK_SIZE || "8", 10) || 8);
type DownloadTransport = "jobs" | "legacy";

const toSafeFileToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const CHECKPOINT_FILE =
  process.env.CHECKPOINT_FILE ||
  `production-e2e-checkpoint-${toSafeFileToken(PRODUCTION_BASE)}.json`;
const CHECKPOINT_PATH = path.join("tasks", "reports", CHECKPOINT_FILE);
const DOWNLOAD_TRANSPORT_OVERRIDE =
  process.env.DOWNLOAD_TRANSPORT?.trim().toLowerCase() || "";

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
  { id: "swisstypefaces", name: "Swiss Typefaces", url: "https://www.swisstypefaces.com/fonts/simplon/#font", minFonts: 1 },
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
  typeof url === "string" &&
  (/^https?:\/\//i.test(url.trim()) || /^inline-font:\/\/[a-z0-9]+$/i.test(url.trim()));

const compactError = (value: unknown, maxLength = 220): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
};

let cachedDownloadTransport: DownloadTransport | undefined;

const resolveDownloadTransport = async (): Promise<DownloadTransport> => {
  if (cachedDownloadTransport) return cachedDownloadTransport;

  if (DOWNLOAD_TRANSPORT_OVERRIDE === "jobs" || DOWNLOAD_TRANSPORT_OVERRIDE === "legacy") {
    cachedDownloadTransport = DOWNLOAD_TRANSPORT_OVERRIDE;
    return cachedDownloadTransport;
  }

  try {
    const jobsProbe = await fetchWithTimeout(JOBS_ENDPOINT, { method: "GET" }, 10_000);
    if (jobsProbe.status !== 404) {
      cachedDownloadTransport = "jobs";
      return cachedDownloadTransport;
    }
  } catch {
    // best effort; fallback probe below
  }

  try {
    const legacyProbe = await fetchWithTimeout(LEGACY_DOWNLOAD_ENDPOINT, { method: "GET" }, 10_000);
    if (legacyProbe.status !== 404) {
      cachedDownloadTransport = "legacy";
      return cachedDownloadTransport;
    }
  } catch {
    // handled by hard failure below
  }

  throw new Error(`No supported download endpoint detected at ${PRODUCTION_BASE}.`);
};

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

async function runJobsTransportDownload(payload: Record<string, unknown>, started: number): Promise<PhaseResult & { downloadData?: any }> {
  const dispatchRes = await fetchWithTimeout(
    JOBS_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    30_000
  );

  if (!dispatchRes.ok) {
    const err = await dispatchRes.text().catch(() => "");
    return {
      phase: "download",
      status: "fail",
      durationMs: Date.now() - started,
      error: `Job dispatch failed: ${dispatchRes.status} ${compactError(err)}`,
    };
  }

  const jobInfo = await dispatchRes.json();
  const jobId = jobInfo.jobId;
  if (!jobId) {
    return {
      phase: "download",
      status: "fail",
      durationMs: Date.now() - started,
      error: "No jobId returned from dispatcher.",
    };
  }

  let finalStatus = "";
  let jobResult: any = null;
  let attempts = 0;
  while (attempts < 900) {
    await sleep(2000);
    attempts++;

    let statusRes;
    let pollRetries = 0;
    while (pollRetries < 3) {
      try {
        statusRes = await fetchWithTimeout(`${JOBS_ENDPOINT}/${jobId}`, { method: "GET" }, 10_000);
        if (statusRes.ok) break;
      } catch (e) {
        if (pollRetries === 2) throw e;
      }
      pollRetries++;
      await sleep(1000);
    }

    if (!statusRes || !statusRes.ok) continue;

    const statusData = await statusRes.json();
    finalStatus = statusData.status;

    if (finalStatus === "SUCCESS") {
      jobResult = statusData.result;
      break;
    }
    if (finalStatus === "FAILED") {
      return {
        phase: "download",
        status: "fail",
        durationMs: Date.now() - started,
        error: compactError(statusData.error || "Job failed internally."),
      };
    }
  }

  if (finalStatus !== "SUCCESS") {
    return {
      phase: "download",
      status: "timeout",
      durationMs: Date.now() - started,
      error: "Job polling timed out.",
    };
  }

  let dlRes;
  let dlRetries = 0;
  while (dlRetries < 3) {
    try {
      dlRes = await fetchWithTimeout(`${JOBS_ENDPOINT}/${jobId}/download`, { method: "GET" }, 60_000);
      if (dlRes.ok) break;
    } catch (e) {
      if (dlRetries === 2) throw e;
    }
    dlRetries++;
    await sleep(2000);
  }

  if (!dlRes || !dlRes.ok) {
    return {
      phase: "download",
      status: "fail",
      durationMs: Date.now() - started,
      error: `Materialization failed: ${dlRes?.status || "fetch failed"}`,
    };
  }

  const contentType = dlRes.headers.get("content-type") || "";
  if (!contentType.includes("application/zip")) {
    return {
      phase: "download",
      status: "fail",
      durationMs: Date.now() - started,
      error: `Unexpected content type: ${contentType}`,
    };
  }

  const buffer = await dlRes.arrayBuffer();
  const disposition = dlRes.headers.get("content-disposition") || "";
  const fileMatch = disposition.match(/filename="([^"]+)"/);

  return {
    phase: "download",
    status: "pass",
    durationMs: Date.now() - started,
    data: { receivedBytes: buffer.byteLength, contentType },
    downloadData: {
      receivedBytes: buffer.byteLength,
      contentType,
      zipFile: fileMatch?.[1] || "unknown.zip",
      downloadedCount: jobResult?.downloadedCount || jobResult?.downloaded?.length || 0,
    },
  };
}

async function runLegacyTransportDownload(
  payload: Record<string, unknown>,
  requestedFontCount: number,
  started: number
): Promise<PhaseResult & { downloadData?: any }> {
  const legacyRes = await fetchWithTimeout(
    LEGACY_DOWNLOAD_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS
  );

  if (!legacyRes.ok) {
    const err = await legacyRes.text().catch(() => "");
    return {
      phase: "download",
      status: "fail",
      durationMs: Date.now() - started,
      error: `Legacy download failed: ${legacyRes.status} ${compactError(err)}`,
    };
  }

  const contentType = legacyRes.headers.get("content-type") || "";
  if (!contentType.includes("application/zip")) {
    const bodyText = await legacyRes.text().catch(() => "");
    return {
      phase: "download",
      status: "fail",
      durationMs: Date.now() - started,
      error: `Legacy returned non-zip response: ${compactError(contentType || bodyText)}`,
    };
  }

  const buffer = await legacyRes.arrayBuffer();
  const disposition = legacyRes.headers.get("content-disposition") || "";
  const fileMatch = disposition.match(/filename="([^"]+)"/);

  return {
    phase: "download",
    status: "pass",
    durationMs: Date.now() - started,
    data: { receivedBytes: buffer.byteLength, contentType },
    downloadData: {
      receivedBytes: buffer.byteLength,
      contentType,
      zipFile: fileMatch?.[1] || "unknown.zip",
      downloadedCount: requestedFontCount,
    },
  };
}

async function runDownloadPhase(
  scrapeResult: any,
  testCase: FoundryTestCase,
  transport: DownloadTransport
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

  const payload: Record<string, unknown> =
    directFonts.length > 0 && !hasPlaceholder
      ? {
          mode: "batch-direct",
          source: (() => { try { return new URL(targetUrl).host; } catch { return "unknown"; } })(),
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
          stream: transport === "jobs",
          expectedCount: scrapeResult.expectedCount,
          injectScript: scrapeResult.injectScript,
          metadata: {
            foundry: scrapeResult.foundryName,
            family: familyHint,
            fonts,
            ...(scrapeResult.metadata || {}),
          },
        };

  const requestedFontCount = directFonts.length > 0 ? directFonts.length : fonts.length;

  try {
    if (transport === "jobs") {
      return await runJobsTransportDownload(payload, started);
    }

    if (payload.mode === "batch-direct" && directFonts.length > LEGACY_DIRECT_CHUNK_SIZE) {
      let activeChunkSize = Math.min(LEGACY_DIRECT_CHUNK_SIZE, directFonts.length);

      while (true) {
        const directChunks: any[][] = [];
        for (let i = 0; i < directFonts.length; i += activeChunkSize) {
          directChunks.push(directFonts.slice(i, i + activeChunkSize));
        }

        let totalBytes = 0;
        let downloadedCount = 0;
        let lastZipName = "unknown.zip";
        let shouldRetrySmallerChunks = false;

        for (let index = 0; index < directChunks.length; index++) {
          const chunkFonts = directChunks[index];
          const chunkPayload: Record<string, unknown> = {
            ...payload,
            fonts: chunkFonts,
            outputFolder: `e2e-prod-${testCase.id}-chunk-${index + 1}`,
            metadata: {
              ...(payload.metadata as Record<string, unknown>),
              chunkIndex: index + 1,
              chunkTotal: directChunks.length,
              chunkSize: activeChunkSize,
            },
          };

          const chunkResult = await runLegacyTransportDownload(chunkPayload, chunkFonts.length, started);
          if (chunkResult.status !== "pass") {
            const isCloudflareTimeout = (chunkResult.error || "").includes(" 524 ");
            if (isCloudflareTimeout && activeChunkSize > 1) {
              activeChunkSize = Math.max(1, Math.floor(activeChunkSize / 2));
              shouldRetrySmallerChunks = true;
              break;
            }
            return chunkResult;
          }

          totalBytes += chunkResult.downloadData?.receivedBytes || 0;
          downloadedCount += chunkResult.downloadData?.downloadedCount || 0;
          lastZipName = chunkResult.downloadData?.zipFile || lastZipName;
        }

        if (shouldRetrySmallerChunks) continue;

        return {
          phase: "download",
          status: "pass",
          durationMs: Date.now() - started,
          data: { receivedBytes: totalBytes, contentType: "application/zip" },
          downloadData: {
            receivedBytes: totalBytes,
            contentType: "application/zip",
            zipFile: lastZipName,
            downloadedCount,
          },
        };
      }
    }

    return await runLegacyTransportDownload(payload, requestedFontCount, started);
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    return {
      phase: "download",
      status: isTimeout ? "timeout" : "fail",
      durationMs: Date.now() - started,
      error: compactError(error?.message || "Unknown download failure."),
    };
  }
}

async function runTestCase(testCase: FoundryTestCase, transport: DownloadTransport): Promise<TestResult> {
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
  const downloadPhase = await runDownloadPhase(analyzePhase.body, testCase, transport);
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
  const transport = await resolveDownloadTransport();

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
  console.log(`Transport: ${transport}`);
  console.log(`Checkpoint: ${CHECKPOINT_FILE}`);
  console.log(`Cases: ${cases.length} total, ${pending.length} pending\n`);

  for (let i = 0; i < pending.length; i++) {
    const tc = pending[i];
    console.log(`[${i + 1}/${pending.length}] ${tc.name} -> ${tc.url}`);

    let result: TestResult;
    try {
      result = await runTestCase(tc, transport);
    } catch (fatalError: any) {
      console.error(`  [CRASH] Unhandled exception in ${tc.name}: ${fatalError.message}`);
      result = {
        id: tc.id,
        name: tc.name,
        url: tc.url,
        status: "fail",
        phases: [],
        reasons: [`Fatal crash: ${fatalError.message}`],
        durationMs: 0,
      };
    }
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
