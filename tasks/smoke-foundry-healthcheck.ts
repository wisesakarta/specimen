import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { scrapers } from "@/lib/scrapers";

type HealthcheckCase = {
  id: string;
  name: string;
  url: string;
};

type HealthcheckResult = {
  id: string;
  name: string;
  url: string;
  scraper?: string;
  foundry?: string;
  fontCount: number;
  hasInterceptPlaceholder: boolean;
  status: "pass" | "fail";
  reasons: string[];
  durationMs: number;
};

const CASES: HealthcheckCase[] = [
  { id: "205tf", name: "205TF", url: "https://www.205.tf/pinokio-sans" },
  { id: "a2-type", name: "A2 Type", url: "https://a2-type.co.uk/ny-sans" },
  { id: "abc-dinamo", name: "ABC Dinamo", url: "https://abcdinamo.com/typefaces/gravity" },
  { id: "abjad-type", name: "Abjad Type", url: "https://www.abjadfonts.com/fonts/miknas" },
  { id: "cotype", name: "CoType", url: "https://cotypefoundry.com/font-family/aeonik" },
  { id: "lineto", name: "Lineto", url: "https://lineto.com/typefaces/akkurat" }
];

const isInterceptPlaceholder = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const token = value.trim().toLowerCase();
  return token === "browser-intercept" || token === "interception-mode";
};

const toReportTimestamp = (input = new Date()): string =>
  input.toISOString().replace(/[:.]/g, "-");

async function run() {
  const startedAt = new Date();
  const results: HealthcheckResult[] = [];

  for (const testCase of CASES) {
    const started = Date.now();
    const reasons: string[] = [];

    try {
      const scraper = scrapers.find((item) => item.canHandle(testCase.url));
      if (!scraper) {
        results.push({
          id: testCase.id,
          name: testCase.name,
          url: testCase.url,
          fontCount: 0,
          hasInterceptPlaceholder: false,
          status: "fail",
          reasons: ["No scraper matched the URL."],
          durationMs: Date.now() - started
        });
        continue;
      }

      const scraped = await scraper.scrape(testCase.url);
      const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
      const hasIntercept = fonts.some((font) => isInterceptPlaceholder(font.url));
      const hasTarget = typeof scraped.targetUrl === "string" && scraped.targetUrl.length > 0;

      if (fonts.length === 0) {
        reasons.push("No font candidates returned.");
      }
      if (hasIntercept && !hasTarget) {
        reasons.push("Intercept placeholder returned but targetUrl missing.");
      }

      results.push({
        id: testCase.id,
        name: testCase.name,
        url: testCase.url,
        scraper: scraper.id,
        foundry: scraped.foundryName,
        fontCount: fonts.length,
        hasInterceptPlaceholder: hasIntercept,
        status: reasons.length === 0 ? "pass" : "fail",
        reasons,
        durationMs: Date.now() - started
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        name: testCase.name,
        url: testCase.url,
        fontCount: 0,
        hasInterceptPlaceholder: false,
        status: "fail",
        reasons: [error instanceof Error ? error.message : String(error)],
        durationMs: Date.now() - started
      });
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length
  };

  const report = {
    suite: "healthcheck",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `smoke-foundry-healthcheck-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Healthcheck report: ${path.relative(process.cwd(), reportPath)}`);
  for (const result of results) {
    const prefix = result.status === "pass" ? "PASS" : "FAIL";
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(`[${prefix}] ${result.name} -> scraper=${result.scraper ?? "-"} fonts=${result.fontCount}${reason}`);
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Smoke healthcheck failed:", error);
  process.exitCode = 1;
});

