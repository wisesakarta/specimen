import fs from "node:fs/promises";
import path from "node:path";
import puppeteer, { type Browser, type HTTPRequest, type HTTPResponse } from "puppeteer";

const ORIGIN = "https://formulatype.com";
const DATE_TAG = "2026-02-28";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const BASE_PATHS = [
  "/",
  "/typefaces",
  "/ft-habit",
  "/ft-aktual",
  "/ft-supplement",
  "/ft-kunst",
  "/ft-regola",
  "/ft-speaker",
  "/ft-athletic",
  "/lab",
  "/information",
  "/about",
  "/cart"
];

const PURCHASE_PATHS = [
  "/ft-habit/purchase",
  "/ft-aktual/purchase",
  "/ft-supplement/purchase",
  "/ft-kunst/purchase",
  "/ft-regola/purchase",
  "/ft-speaker/purchase",
  "/ft-athletic/purchase"
];

const LAB_PATHS = [
  "/agi2022",
  "/agi2024",
  "/limalimo",
  "/madeitaly",
  "/neworder",
  "/nullstate",
  "/together",
  "/unidot",
  "/unidotps",
  "/unity",
  "/wired"
];

const TARGET_PATHS = Array.from(new Set([...BASE_PATHS, ...PURCHASE_PATHS, ...LAB_PATHS]));
const HEAVY_ASSET_RE = /\.(?:png|jpe?g|webp|gif|avif|svg|mp4|mov|webm|woff2?|ttf|otf)(?:\?|$)/i;

const normalizeUrlPattern = (rawUrl: string): string => {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "");
    const pathname = u.pathname
      .replace(/[0-9a-f]{8,}/gi, ":hash")
      .replace(/\d+/g, ":n");
    if (u.searchParams.has("_rsc")) return `${host}${pathname}?_rsc=*`;
    return `${host}${pathname}`;
  } catch {
    return rawUrl;
  }
};

const classifyUploadAssets = (assets: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const asset of assets) {
    const m = asset.match(/\.([a-z0-9]+)$/i);
    const ext = m?.[1]?.toLowerCase() || "unknown";
    out[ext] = (out[ext] || 0) + 1;
  }
  return out;
};

const extractHrefValues = (html: string): string[] => {
  const out = new Set<string>();
  const re = /<a\b[^>]*\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = (match[1] || match[2] || match[3] || "").trim();
    if (href) out.add(href);
  }
  return Array.from(out).sort();
};

async function collectPage(browser: Browser, targetPath: string) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
  );
  await page.setRequestInterception(true);

  const requestPatterns = new Set<string>();
  const requestHostCounts: Record<string, number> = {};
  const responseStatusCounts: Record<string, number> = {};

  page.on("request", (req: HTTPRequest) => {
    const u = req.url();
    const resourceType = req.resourceType();

    if (resourceType === "image" || resourceType === "media" || resourceType === "font" || HEAVY_ASSET_RE.test(u)) {
      req.abort().catch(() => void 0);
      return;
    }

    req.continue().catch(() => void 0);

    if (!/formulatype\.com|admin\.formulatype\.com|stripe\.com|\/uploads\//i.test(u)) return;
    requestPatterns.add(`${req.method()} ${normalizeUrlPattern(u)}`);
    try {
      const host = new URL(u).hostname;
      requestHostCounts[host] = (requestHostCounts[host] || 0) + 1;
    } catch {
      // ignore
    }
  });

  page.on("response", (res: HTTPResponse) => {
    const u = res.url();
    if (!/formulatype\.com|admin\.formulatype\.com|stripe\.com|\/uploads\//i.test(u)) return;
    const status = String(res.status());
    responseStatusCounts[status] = (responseStatusCounts[status] || 0) + 1;
  });

  const targetUrl = `${ORIGIN}${targetPath}`;
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await sleep(1200);

    let pageData: any;
    try {
      pageData = await page.evaluate(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const skipClicks = location.pathname === "/cart";
        const clickNode = (node) => {
          if (skipClicks) return false;
          if (!node || !(node instanceof HTMLElement)) return false;
          if (node.closest("a")) return false;
          node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          return true;
        };

        const textMatchers = ["close", "skip", "skip video"];
        let overlayActions = 0;
        for (const node of Array.from(document.querySelectorAll("button, [role='button'], div, span")).slice(0, 120)) {
          const text = (node.textContent || "").trim().toLowerCase();
          if (!text) continue;
          if (textMatchers.some((m) => text === m || text.includes(m))) {
            if (clickNode(node)) overlayActions += 1;
          }
        }

        const maxScroll = Math.max(0, document.body.scrollHeight - window.innerHeight);
        for (let i = 0; i <= 8; i += 1) {
          const y = Math.round((maxScroll * i) / 8);
          window.scrollTo({ top: y, behavior: "auto" });
          await sleep(50);
        }
        window.scrollTo({ top: 0, behavior: "auto" });

        let controlActions = 0;
        for (const node of Array.from(
          document.querySelectorAll(
            "button, [role='button'], [class*='dropdown'], [class*='toggle'], [class*='tab'], [class*='pill'], [class*='switch']"
          )
        ).slice(0, 60)) {
          if (clickNode(node)) controlActions += 1;
          await sleep(8);
        }

        let textInputCount = 0;
        for (const input of Array.from(
          document.querySelectorAll("input[type='text'], input:not([type]), textarea, [contenteditable='true']")
        ).slice(0, 16)) {
          textInputCount += 1;
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
            input.focus();
            input.value = "FORMULATYPE PROBE ff fi ffi 0123456789 ÄÖÜ æœ ÑŁ";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (input instanceof HTMLElement) {
            input.focus();
            input.textContent = "FORMULATYPE PROBE ff fi ffi 0123456789 ÄÖÜ æœ ÑŁ";
            input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          }
          await sleep(12);
        }

        let rangeCount = 0;
        for (const slider of Array.from(document.querySelectorAll("input[type='range']")).slice(0, 10)) {
          if (!(slider instanceof HTMLInputElement)) continue;
          rangeCount += 1;
          const min = Number(slider.min || 0);
          const max = Number(slider.max || 100);
          const vals = [min, Math.round((min + max) / 2), max];
          for (const val of vals) {
            slider.value = String(val);
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            slider.dispatchEvent(new Event("change", { bubbles: true }));
            await sleep(10);
          }
        }

        const html = document.documentElement.outerHTML;
        const uploads = Array.from(new Set(html.match(/\\/uploads\\/[A-Za-z0-9_\\-.]+/g) || [])).sort();

        const links = Array.from(
          new Set(
            Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") || "").filter(Boolean)
          )
        ).sort();
        const internalLinks = links.filter((href) => /^\\//.test(href));
        const externalLinks = links.filter((href) => /^https?:\\/\\//i.test(href));
        const pdfLinks = links.filter((href) => /\\.pdf(?:$|\\?)/i.test(href));

        return {
          finalPath: location.pathname,
          title: document.title,
          status404Detected: /404|page could not be found/i.test(document.body.innerText || ""),
          overlayActions,
          controlActions,
          textInputCount,
          rangeCount,
          uploadAssetCount: uploads.length,
          uploadAssets: uploads,
          internalLinkCount: internalLinks.length,
          externalLinkCount: externalLinks.length,
          internalLinks,
          pdfLinkCount: pdfLinks.length,
          pdfLinks,
          hasCartLabel: /cart/i.test(document.body.innerText || "")
        };
      })()
    `);
    } catch (evalError) {
      const evalErrorMessage = evalError instanceof Error ? evalError.message : String(evalError);
      try {
        pageData = await page.evaluate(`
        (() => {
          const html = document.documentElement.outerHTML;
          const uploads = Array.from(new Set(html.match(/\\/uploads\\/[A-Za-z0-9_\\-.]+/g) || [])).sort();
          const links = Array.from(
            new Set(
              Array.from(document.querySelectorAll("a[href]"))
                .map((a) => a.getAttribute("href") || "")
                .filter(Boolean)
            )
          ).sort();
          const internalLinks = links.filter((href) => /^\\//.test(href));
          const externalLinks = links.filter((href) => /^https?:\\/\\//i.test(href));
          const pdfLinks = links.filter((href) => /\\.pdf(?:$|\\?)/i.test(href));
          return {
            finalPath: location.pathname,
            title: document.title,
            status404Detected: /404|page could not be found/i.test(document.body.innerText || ""),
            overlayActions: 0,
            controlActions: 0,
            textInputCount: 0,
            rangeCount: 0,
            uploadAssetCount: uploads.length,
            uploadAssets: uploads,
            internalLinkCount: internalLinks.length,
            externalLinkCount: externalLinks.length,
            internalLinks,
            pdfLinkCount: pdfLinks.length,
            pdfLinks,
            hasCartLabel: /cart/i.test(document.body.innerText || ""),
            fallbackProbe: true
          };
        })()
      `);
        pageData.fallbackReason = evalErrorMessage;
      } catch (fallbackError) {
        const html = await page.content();
        const uploads = Array.from(new Set((html.match(/\/uploads\/[A-Za-z0-9_\-.]+/g) || []) as string[])).sort();
        const links = extractHrefValues(html);
        const internalLinks = links.filter((href) => /^\//.test(href));
        const externalLinks = links.filter((href) => /^https?:\/\//i.test(href));
        const pdfLinks = links.filter((href) => /\.pdf(?:$|\?)/i.test(href));
        pageData = {
          finalPath: new URL(page.url()).pathname,
          title: await page.title(),
          status404Detected: /404|page could not be found/i.test(html),
          overlayActions: 0,
          controlActions: 0,
          textInputCount: 0,
          rangeCount: 0,
          uploadAssetCount: uploads.length,
          uploadAssets: uploads,
          internalLinkCount: internalLinks.length,
          externalLinkCount: externalLinks.length,
          internalLinks,
          pdfLinkCount: pdfLinks.length,
          pdfLinks,
          hasCartLabel: /cart/i.test(html),
          fallbackProbe: true,
          fallbackReason: evalErrorMessage,
          fallbackSecondaryReason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        };
      }
    }

    await page.close();

    return {
      targetPath,
      targetUrl,
      ok: true,
      ...pageData,
      uploadExtCount: classifyUploadAssets(pageData.uploadAssets),
      networkPatternCount: requestPatterns.size,
      networkPatterns: Array.from(requestPatterns).sort(),
      requestHostCounts,
      responseStatusCounts
    };
  } catch (error) {
    await page.close();
    return {
      targetPath,
      targetUrl,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      networkPatternCount: requestPatterns.size,
      networkPatterns: Array.from(requestPatterns).sort(),
      requestHostCounts,
      responseStatusCounts
    };
  }
}

async function fetchStaticSeed(browser: Browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
  );
  await page.setRequestInterception(true);
  page.on("request", (req: HTTPRequest) => {
    const u = req.url();
    const resourceType = req.resourceType();
    if (resourceType === "image" || resourceType === "media" || resourceType === "font" || HEAVY_ASSET_RE.test(u)) {
      req.abort().catch(() => void 0);
      return;
    }
    req.continue().catch(() => void 0);
  });

  const response = await page.goto(`${ORIGIN}/`, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });
  await sleep(1200);
  const html = await page.content();
  await page.close();

  const uploads = Array.from(new Set((html.match(/\/uploads\/[A-Za-z0-9_\-.]+/g) || []) as string[])).sort();
  const absoluteUploadUrls = Array.from(
    new Set((html.match(/https:\/\/admin\.formulatype\.com\/uploads\/[A-Za-z0-9_\-.]+/g) || []) as string[])
  ).sort();
  const paths = Array.from(
    new Set(
      (html.match(
        /\/(?:ft-[a-z0-9-]+|typefaces|lab|information|about|cart|agi\d+|limalimo|madeitaly|neworder|nullstate|together|unidot(?:ps)?|unity|wired)/g
      ) || []) as string[]
    )
  ).sort();

  return {
    fetchedAt: new Date().toISOString(),
      status: response?.status() ?? null,
    htmlLength: html.length,
    uploadAssetCount: uploads.length,
    uploadExtCount: classifyUploadAssets(uploads),
    uploadAssetSample: uploads.slice(0, 120),
    absoluteUploadUrlCount: absoluteUploadUrls.length,
    absoluteUploadUrlSample: absoluteUploadUrls.slice(0, 120),
    discoveredPaths: paths
  };
}

async function main() {
  const startedAt = new Date();
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote"
    ]
  });

  try {
    const staticSeed = await fetchStaticSeed(browser);

    const pageResults = [];
    for (const pathItem of TARGET_PATHS) {
      const res = await collectPage(browser, pathItem);
      pageResults.push(res);
    }

    const hiddenLabRoutes = Array.from(
      new Set(
        pageResults
          .filter((r: any) => r.ok && Array.isArray(r.internalLinks))
          .flatMap((r: any) => r.internalLinks)
          .filter((href: string) => /^\/(?:agi\d+|limalimo|madeitaly|neworder|nullstate|together|unidot(?:ps)?|unity|wired)$/i.test(href))
      )
    ).sort();

    const allNetworkPatterns = Array.from(
      new Set(pageResults.flatMap((r: any) => (Array.isArray(r.networkPatterns) ? r.networkPatterns : [])))
    ).sort();

    const requestHostTotals: Record<string, number> = {};
    const responseStatusTotals: Record<string, number> = {};
    for (const result of pageResults) {
      const hostCounts = result.requestHostCounts || {};
      for (const [host, count] of Object.entries(hostCounts)) {
        requestHostTotals[host] = (requestHostTotals[host] || 0) + Number(count || 0);
      }
      const statusCounts = result.responseStatusCounts || {};
      for (const [status, count] of Object.entries(statusCounts)) {
        responseStatusTotals[status] = (responseStatusTotals[status] || 0) + Number(count || 0);
      }
    }

    const report = {
      reportId: `formulatype-research-${DATE_TAG}`,
      generatedAt: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      targetOrigin: ORIGIN,
      method: {
        mandatoryInjectionManipulation: true,
        notes: [
          "DOM injection executed on every target page.",
          "Manipulations: overlay close/skip, button/toggle clicks, scroll sweeps, text tester input, slider axis probing.",
          "Network capture collected during manipulation session."
        ]
      },
      staticSeed,
      crawl: {
        requestedPaths: TARGET_PATHS,
        hiddenLabRoutes,
        okCount: pageResults.filter((r: any) => r.ok).length,
        failCount: pageResults.filter((r: any) => !r.ok).length,
        pageResults
      },
      networkSummary: {
        requestHostTotals,
        responseStatusTotals,
        uniqueNetworkPatternCount: allNetworkPatterns.length,
        networkPatternSample: allNetworkPatterns.slice(0, 500)
      }
    };

    const outPath = path.join(process.cwd(), "tasks", "reports", `formulatype-research-${DATE_TAG}.json`);
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

    console.log(JSON.stringify({
      outPath,
      okCount: report.crawl.okCount,
      failCount: report.crawl.failCount,
      hiddenLabRoutes: report.crawl.hiddenLabRoutes,
      uniqueNetworkPatternCount: report.networkSummary.uniqueNetworkPatternCount,
      requestHostTotals: report.networkSummary.requestHostTotals,
      responseStatusTotals: report.networkSummary.responseStatusTotals
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
