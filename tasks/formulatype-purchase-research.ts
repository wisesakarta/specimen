import fs from "node:fs/promises";
import path from "node:path";
import puppeteer, { type Browser, type HTTPRequest, type HTTPResponse } from "puppeteer";

const DATE_TAG = "2026-02-28";
const ORIGIN = "https://formulatype.com";
const PURCHASE_PATHS = [
  "/ft-habit/purchase",
  "/ft-aktual/purchase",
  "/ft-supplement/purchase",
  "/ft-kunst/purchase",
  "/ft-regola/purchase",
  "/ft-speaker/purchase",
  "/ft-athletic/purchase"
];

const HEAVY_ASSET_RE = /\.(?:png|jpe?g|webp|gif|avif|svg|mp4|mov|webm|woff2?|ttf|otf)(?:\?|$)/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Extracted = {
  targetPath: string;
  targetUrl: string;
  ok: boolean;
  title?: string;
  decodedLength?: number;
  familyName?: string | null;
  familySku?: string | null;
  trialZipUrls?: string[];
  styles?: Array<{ sku: string; name: string; weight: number; isItalic: boolean }>;
  licenseTypes?: Array<{
    sku: string;
    name: string;
    fileTypes: string;
    singleFontPrice: number | null;
    bundleDiscountAmount: number | null;
    bundleDiscountType: string | null;
    fullFamilyDiscountAmount: number | null;
    fullFamilyDiscountType: string | null;
  }>;
  licenseSizes?: Array<{ name: string; multiplier: number }>;
  discounts?: Array<{ name: string; amount: number; type: string }>;
  purchaseFlowProbe?: {
    actions: string[];
    selectedStyles: string[];
    totalTextBefore: string | null;
    totalTextAfter: string | null;
    cartText: string | null;
    serverActionForms: number;
    finalPathAfterProbe?: string;
  };
  networkProbe?: {
    postRequests: Array<{ method: string; url: string; status: number | null }>;
    rscRequestCount: number;
    stripeRequestCount: number;
  };
  parseDiagnostics?: {
    hasLicenseConfig: boolean;
    hasLicenseSizes: boolean;
    hasPriceReductions: boolean;
    hasStyles: boolean;
  };
  error?: string;
};

function extractStyles(decoded: string) {
  const out: Array<{ sku: string; name: string; weight: number; isItalic: boolean }> = [];
  const seen = new Set<string>();
  const re = /"SKU":"(FT-[A-Z0-9-]+)","weight":([0-9]+),"name":"([^"]+)","isStyleOf":(?:null|"[^"]*")/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded)) !== null) {
    const sku = m[1];
    if (seen.has(sku)) continue;
    seen.add(sku);
    const name = m[3];
    out.push({
      sku,
      name,
      weight: Number(m[2] || 0),
      isItalic: /italic/i.test(name)
    });
  }
  return out;
}

function extractLicenseTypes(decoded: string) {
  const out: Array<{
    sku: string;
    name: string;
    fileTypes: string;
    singleFontPrice: number | null;
    bundleDiscountAmount: number | null;
    bundleDiscountType: string | null;
    fullFamilyDiscountAmount: number | null;
    fullFamilyDiscountType: string | null;
  }> = [];

  const re =
    /"SKU":"(LICENSE-[A-Z0-9-]+)","name":"([^"]+)","fileTypes":"([^"]+)"[\s\S]*?"singleFontPrice":([0-9.]+)[\s\S]*?"bundleDiscount":\{"amount":([0-9.]+),"type":"([^"]+)"\}[\s\S]*?"fullFamilyDiscount":\{"amount":([0-9.]+),"type":"([^"]+)"\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded)) !== null) {
    out.push({
      sku: m[1],
      name: m[2],
      fileTypes: m[3],
      singleFontPrice: Number(m[4]),
      bundleDiscountAmount: Number(m[5]),
      bundleDiscountType: m[6] || null,
      fullFamilyDiscountAmount: Number(m[7]),
      fullFamilyDiscountType: m[8] || null
    });
  }
  return Array.from(new Map(out.map((x) => [x.sku, x])).values());
}

function extractLicenseSizes(decoded: string) {
  const out: Array<{ name: string; multiplier: number }> = [];
  const block = decoded.match(/"licenseSizes":\[(.*?)\],"priceReductions":/s)?.[1] || "";
  const re = /"name":"([^"]+)","value":([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out.push({ name: m[1], multiplier: Number(m[2]) });
  }
  return out;
}

function extractDiscounts(decoded: string) {
  const out: Array<{ name: string; amount: number; type: string }> = [];
  const block = decoded.match(/"priceReductions":\[(.*?)\]\}\}/s)?.[1] || "";
  const re = /"name":"([^"]+)","discount":\{"amount":([0-9.]+),"type":"([^"]+)"\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out.push({ name: m[1], amount: Number(m[2]), type: m[3] });
  }
  return out;
}

function normalizeDecoded(raw: string) {
  return raw
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\\//g, "/");
}

async function collectPath(browser: Browser, targetPath: string): Promise<Extracted> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
  );
  await page.setRequestInterception(true);
  const postRequests: Array<{ method: string; url: string; status: number | null }> = [];
  let rscRequestCount = 0;
  let stripeRequestCount = 0;

  page.on("request", (req: HTTPRequest) => {
    const u = req.url();
    const type = req.resourceType();
    if (/_rsc=/.test(u)) rscRequestCount += 1;
    if (/stripe\.com|stripe\.network/i.test(u)) stripeRequestCount += 1;
    if (type === "image" || type === "media" || type === "font" || HEAVY_ASSET_RE.test(u)) {
      req.abort().catch(() => void 0);
      return;
    }
    req.continue().catch(() => void 0);
  });
  page.on("response", (res: HTTPResponse) => {
    const req = res.request();
    if (req.method().toUpperCase() !== "POST") return;
    const url = req.url();
    if (!/formulatype\.com/i.test(url)) return;
    postRequests.push({
      method: req.method().toUpperCase(),
      url,
      status: res.status()
    });
  });

  const targetUrl = `${ORIGIN}${targetPath}`;
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await sleep(900);

    const rawChunks = (await page.evaluate(`
      (() => {
        const q = self.__next_f || [];
        return (Array.isArray(q) ? q : [])
          .map((item) => (Array.isArray(item) && typeof item[1] === "string" ? item[1] : ""))
          .filter(Boolean)
          .join("\\n");
      })()
    `)) as string;
    const decoded = normalizeDecoded(rawChunks);

    const familyName = decoded.match(/"license":\{[^{}]*"name":"([^"]+)"/)?.[1] || null;
    const familySku = decoded.match(/"license":\{[^{}]*"SKU":"([^"]+)"/)?.[1] || null;
    const trialZipUrls = Array.from(
      new Set(decoded.match(/\/uploads\/FT_[A-Za-z0-9_\-.]*Unlicensed_Trial[A-Za-z0-9_\-.]*\.zip/g) || [])
    ).sort();

    const styles = extractStyles(decoded);
    const licenseTypes = extractLicenseTypes(decoded);
    const licenseSizes = extractLicenseSizes(decoded);
    const discounts = extractDiscounts(decoded);

    const probe = (await page.evaluate(`
      (() => {
        const actions = [];
        const selectedStyles = [];
        const normalize = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const clickByLabel = (re) => {
          const labels = Array.from(document.querySelectorAll("label, button, [role='button'], div, span, p"));
          const matched = labels
            .map((node) => ({ node, text: (node.textContent || "").replace(/\\s+/g, " ").trim() }))
            .filter((x) => x.text && re.test(x.text))
            .sort((a, b) => a.text.length - b.text.length);
          for (const item of matched) {
            const node = item.node;
            const text = item.text;
            if (text.length > 120) continue;
            if (!(node instanceof HTMLElement)) continue;
            node.click();
            actions.push(text);
            return true;
          }
          return false;
        };
        const clickStyleOptions = () => {
          const candidates = Array.from(document.querySelectorAll("input[type='checkbox'], [role='checkbox']"));
          for (const node of candidates) {
            if (selectedStyles.length >= 2) break;
            if (!(node instanceof HTMLElement)) continue;
            node.click();
            let labelText = "";
            if (node instanceof HTMLInputElement) {
              const label = node.closest("label");
              labelText = (label?.textContent || "").replace(/\\s+/g, " ").trim();
            } else {
              labelText = (node.textContent || "").replace(/\\s+/g, " ").trim();
            }
            selectedStyles.push(labelText || ("style_" + (selectedStyles.length + 1)));
          }
        };

        const getTotalText = () => {
          const fullText = (document.body?.innerText || "").replace(/\\s+/g, " ");
          const match = fullText.match(/Total:\\s*([0-9.,]+\\s*€)/i);
          return match ? match[1] : null;
        };

        const totalTextBefore = getTotalText();

        clickByLabel(/^○?\\s*You$/i);
        clickByLabel(/up to 3 employees/i);

        clickStyleOptions();

        const addBtn = Array.from(document.querySelectorAll("button")).find((b) =>
          /add to cart/i.test(b.textContent || "")
        );
        if (addBtn && addBtn instanceof HTMLElement) {
          addBtn.click();
          actions.push("Add to Cart");
        }

        const totalTextAfter = getTotalText();
        const cartLink = Array.from(document.querySelectorAll("a")).find((a) => /cart/i.test(a.textContent || ""));
        const cartText = cartLink ? (cartLink.textContent || "").replace(/\\s+/g, " ").trim() : null;
        const serverActionForms = document.querySelectorAll("form[action^='javascript:throw']").length;

        return {
          actions,
          selectedStyles,
          totalTextBefore,
          totalTextAfter,
          cartText,
          serverActionForms
        };
      })()
    `)) as NonNullable<Extracted["purchaseFlowProbe"]>;
    await sleep(1400);
    probe.finalPathAfterProbe = new URL(page.url()).pathname;

    const title = await page.title().catch(() => "Formula Type");
    await page.close();
    await context.close();
    return {
      targetPath,
      targetUrl,
      ok: true,
      title,
      decodedLength: decoded.length,
      familyName,
      familySku,
      trialZipUrls,
      styles,
      licenseTypes,
      licenseSizes,
      discounts,
      purchaseFlowProbe: probe,
      networkProbe: {
        postRequests,
        rscRequestCount,
        stripeRequestCount
      },
      parseDiagnostics: {
        hasLicenseConfig: /"licenseConfigurationOptions":\{/.test(decoded),
        hasLicenseSizes: /"licenseSizes":\[/.test(decoded),
        hasPriceReductions: /"priceReductions":\[/.test(decoded),
        hasStyles: styles.length > 0
      }
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
  const startedAt = new Date().toISOString();
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300000,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"]
  });
  try {
    const results: Extracted[] = [];
    for (const p of PURCHASE_PATHS) {
      const row = await collectPath(browser, p);
      results.push(row);
    }

    const out = {
      reportId: `formulatype-purchase-research-${DATE_TAG}`,
      generatedAt: new Date().toISOString(),
      startedAt,
      targetOrigin: ORIGIN,
      okCount: results.filter((r) => r.ok).length,
      failCount: results.filter((r) => !r.ok).length,
      paths: PURCHASE_PATHS,
      results
    };

    const outPath = path.join(process.cwd(), "tasks", "reports", `formulatype-purchase-research-${DATE_TAG}.json`);
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
