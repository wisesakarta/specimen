import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { TypeTypeScraper } from "@/lib/scrapers/typetype";

type CatalogItem = {
  slug: string;
  link: string;
  title?: string;
};

type CaseResult = {
  slug: string;
  url: string;
  status: "pass" | "warn" | "fail";
  scrapedFontCount: number;
  expectedCount?: number;
  missingStyleCount?: number;
  specimenUrlCount?: number;
  duplicateUrlCount?: number;
  reasons: string[];
  durationMs: number;
};

type SuiteReport = {
  suite: "typetype-catalog-healthcheck";
  startedAt: string;
  finishedAt: string;
  summary: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  };
  results: CaseResult[];
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const toReportTimestamp = (input = new Date()): string => input.toISOString().replace(/[:.]/g, "-");

const fetchCatalog = async (): Promise<CatalogItem[]> => {
  const url = "https://typetype.org/wp-json/wp/v2/product?per_page=100&page=1&_fields=slug,link,title";
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json,text/plain,*/*",
      "Cache-Control": "no-cache",
    },
  });
  if (!res.ok) {
    throw new Error(`TypeType catalog fetch failed (${res.status})`);
  }
  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error("TypeType catalog response is not an array.");
  }

  const out: CatalogItem[] = [];
  for (const item of json) {
    const slug = typeof item?.slug === "string" ? item.slug.trim().toLowerCase() : "";
    const link = typeof item?.link === "string" ? item.link.trim() : "";
    const title = typeof item?.title?.rendered === "string" ? String(item.title.rendered).trim() : undefined;
    if (!slug || !link) continue;
    if (!/^https:\/\/typetype\.org\/fonts\/[a-z0-9-]+\/?$/i.test(link)) continue;
    out.push({ slug, link, title });
  }
  return out;
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, limit) }).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

const runCase = async (item: CatalogItem): Promise<CaseResult> => {
  const started = Date.now();
  const reasons: string[] = [];

  try {
    const scraped = await TypeTypeScraper.scrape(item.link);
    const fonts = Array.isArray(scraped.fonts) ? scraped.fonts : [];
    const expectedCount = typeof scraped.expectedCount === "number" ? scraped.expectedCount : undefined;
    const targetProfile = (scraped.metadata as any)?.targetProfile || {};
    const missingStyleIds = Array.isArray(targetProfile.missingStyleIds) ? targetProfile.missingStyleIds : [];
    const specimenPdfUrls = Array.isArray(targetProfile.specimenPdfUrls) ? targetProfile.specimenPdfUrls : [];

    const uniqueUrls = new Set(fonts.map((font) => String(font?.url || "").trim()).filter(Boolean));
    const duplicateUrlCount = Math.max(0, fonts.length - uniqueUrls.size);

    if (fonts.length === 0) {
      reasons.push("Scraper returned 0 fonts.");
    }
    if (typeof expectedCount === "number" && expectedCount > 0 && fonts.length !== expectedCount) {
      reasons.push(`Font count mismatch: fonts=${fonts.length}, expectedCount=${expectedCount}.`);
    }
    if (missingStyleIds.length > 0) {
      reasons.push(`Missing styleIds: ${missingStyleIds.slice(0, 12).join(", ")}${missingStyleIds.length > 12 ? " ..." : ""}`);
    }
    if (specimenPdfUrls.length === 0) {
      reasons.push("No specimenPdfUrls detected on page.");
    }
    if (duplicateUrlCount > 0) {
      reasons.push(`Duplicate font URLs detected (${duplicateUrlCount}).`);
    }

    const status: CaseResult["status"] = reasons.length === 0 ? "pass" : reasons.some((r) => /missing|mismatch|0 fonts/i.test(r)) ? "fail" : "warn";

    return {
      slug: item.slug,
      url: item.link,
      status,
      scrapedFontCount: fonts.length,
      expectedCount,
      missingStyleCount: missingStyleIds.length,
      specimenUrlCount: specimenPdfUrls.length,
      duplicateUrlCount,
      reasons,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      slug: item.slug,
      url: item.link,
      status: "fail",
      scrapedFontCount: 0,
      reasons: [error instanceof Error ? error.message : String(error)],
      durationMs: Date.now() - started,
    };
  }
};

async function run() {
  const startedAt = new Date();
  const catalog = await fetchCatalog();
  if (catalog.length === 0) {
    throw new Error("TypeType catalog returned 0 families.");
  }

  const results = await runWithConcurrency(catalog, 3, async (item) => runCase(item));

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    warned: results.filter((r) => r.status === "warn").length,
    failed: results.filter((r) => r.status === "fail").length,
  };

  const report: SuiteReport = {
    suite: "typetype-catalog-healthcheck",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    summary,
    results,
  };

  const reportsDir = path.join(process.cwd(), "tasks", "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `typetype-catalog-healthcheck-${toReportTimestamp(startedAt)}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`TypeType catalog report: ${path.relative(process.cwd(), reportPath)}`);
  console.log(`Summary: pass=${summary.passed}/${summary.total}, warn=${summary.warned}, fail=${summary.failed}`);

  for (const result of results.filter((r) => r.status !== "pass")) {
    const head = result.status.toUpperCase();
    const reason = result.reasons.length > 0 ? ` | ${result.reasons.join(" ; ")}` : "";
    console.log(`[${head}] ${result.slug} -> fonts=${result.scrapedFontCount}${reason}`);
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("TypeType catalog healthcheck failed:", error);
  process.exitCode = 1;
});

