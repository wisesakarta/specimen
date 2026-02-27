import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

type SmokeReport = {
  suite?: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: {
    strict?: boolean;
    total?: number;
    passed?: number;
    failed?: number;
  };
  results?: Array<{
    id?: string;
    name?: string;
    status?: string;
    downloadedCount?: number;
    skippedCount?: number;
    validationStatus?: string;
    reasons?: string[];
  }>;
};

const SUITE_PREFIX: Record<string, string> = {
  intercept: "smoke-browser-intercept-",
  healthcheck: "smoke-foundry-healthcheck-"
};

const parseSuite = (): string => {
  const raw = (process.argv[2] || "intercept").trim().toLowerCase();
  return SUITE_PREFIX[raw] ? raw : "intercept";
};

const getLatestReport = async (suite: string): Promise<string | undefined> => {
  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  const prefix = SUITE_PREFIX[suite];
  const files = await readdir(reportsDir, { withFileTypes: true }).catch(() => []);
  const candidates = files
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const latest = candidates[candidates.length - 1];
  if (!latest) return undefined;
  return path.join(reportsDir, latest);
};

async function run() {
  const suite = parseSuite();
  const reportPath = await getLatestReport(suite);

  if (!reportPath) {
    console.log(`No ${suite} report found in tasks/reports.`);
    return;
  }

  const raw = await readFile(reportPath, "utf8");
  const report = JSON.parse(raw) as SmokeReport;

  const relPath = path.relative(process.cwd(), reportPath);
  const summary = report.summary || {};
  const total = Number(summary.total || 0);
  const passed = Number(summary.passed || 0);
  const failed = Number(summary.failed || 0);

  console.log(`Report: ${relPath}`);
  console.log(`Suite: ${report.suite || suite}`);
  console.log(`Summary: passed=${passed}/${total} failed=${failed}`);

  const results = Array.isArray(report.results) ? report.results : [];
  for (const item of results) {
    const status = String(item.status || "unknown").toUpperCase();
    const name = item.name || item.id || "-";
    const downloaded = typeof item.downloadedCount === "number" ? item.downloadedCount : 0;
    const skipped = typeof item.skippedCount === "number" ? item.skippedCount : 0;
    const validation = item.validationStatus ? ` validation=${item.validationStatus}` : "";
    const reason = item.reasons && item.reasons.length > 0 ? ` | ${item.reasons.join(" ; ")}` : "";
    console.log(`[${status}] ${name} downloaded=${downloaded} skipped=${skipped}${validation}${reason}`);
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Failed to read smoke report summary:", error);
  process.exitCode = 1;
});
