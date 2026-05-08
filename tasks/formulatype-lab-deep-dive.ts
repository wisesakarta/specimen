import fs from "node:fs/promises";
import path from "node:path";
import puppeteer, { type Browser, type HTTPRequest, type HTTPResponse } from "puppeteer";

const DATE_TAG = "2026-02-28";
const ORIGIN = "https://formulatype.com";
const LAB_PATHS = [
  "/lab",
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

const HEAVY_ASSET_RE = /\.(?:png|jpe?g|webp|gif|avif|svg|mp4|mov|webm|woff2?|ttf|otf)(?:\?|$)/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const classifyExt = (assets: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const a of assets) {
    const ext = a.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "unknown";
    out[ext] = (out[ext] || 0) + 1;
  }
  return out;
};

async function collect(browser: Browser, targetPath: string) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
  );
  await page.setRequestInterception(true);
  page.on("request", (req: HTTPRequest) => {
    const u = req.url();
    const t = req.resourceType();
    if (t === "image" || t === "media" || t === "font" || HEAVY_ASSET_RE.test(u)) {
      req.abort().catch(() => void 0);
      return;
    }
    req.continue().catch(() => void 0);
  });

  const targetUrl = `${ORIGIN}${targetPath}`;
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await sleep(800);
    const data = (await page.evaluate(`
      (() => {
        const text = (s) => (s || "").replace(/\\s+/g, " ").trim();
        const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((n) => text(n.textContent)).filter(Boolean);
        const paragraphs = Array.from(document.querySelectorAll("p")).map((n) => text(n.textContent)).filter(Boolean);
        const links = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => a.getAttribute("href") || "")
          .filter(Boolean);
        const internalLinks = Array.from(new Set(links.filter((href) => /^\\//.test(href)))).sort();
        const externalLinks = Array.from(new Set(links.filter((href) => /^https?:\\/\\//i.test(href)))).sort();

        const html = document.documentElement.outerHTML;
        const uploadAssets = Array.from(new Set(html.match(/\\/uploads\\/[A-Za-z0-9_\\-.]+/g) || [])).sort();
        return {
          finalPath: location.pathname,
          title: document.title,
          status404Detected: /404|page could not be found/i.test(document.body.innerText || ""),
          headings,
          paragraphs: paragraphs.slice(0, 30),
          internalLinks,
          externalLinks,
          uploadAssets
        };
      })()
    `)) as {
      finalPath: string;
      title: string;
      status404Detected: boolean;
      headings: string[];
      paragraphs: string[];
      internalLinks: string[];
      externalLinks: string[];
      uploadAssets: string[];
    };
    await page.close();
    await context.close();
    return {
      targetPath,
      targetUrl,
      ok: true,
      ...data,
      uploadAssetCount: data.uploadAssets.length,
      uploadExtCount: classifyExt(data.uploadAssets),
      internalLinkCount: data.internalLinks.length,
      externalLinkCount: data.externalLinks.length
    };
  } catch (error) {
    await page.close().catch(() => void 0);
    await context.close().catch(() => void 0);
    return {
      targetPath,
      targetUrl,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300000,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"]
  });
  try {
    const results = [];
    for (const p of LAB_PATHS) {
      const row = await collect(browser, p);
      results.push(row);
    }
    const out = {
      reportId: `formulatype-lab-deep-dive-${DATE_TAG}`,
      generatedAt: new Date().toISOString(),
      targetOrigin: ORIGIN,
      paths: LAB_PATHS,
      okCount: results.filter((r) => r.ok).length,
      failCount: results.filter((r) => !r.ok).length,
      results
    };
    const outPath = path.join(process.cwd(), "tasks", "reports", `formulatype-lab-deep-dive-${DATE_TAG}.json`);
    await fs.writeFile(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log(
      JSON.stringify(
        {
          outPath,
          okCount: out.okCount,
          failCount: out.failCount
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
