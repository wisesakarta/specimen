import { CoTypeScraper } from "@/lib/scrapers/cotype";
import { runDownload } from "@/lib/server/font-downloader";

const isHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

async function smokeTestCoType() {
  const url = "https://cotypefoundry.com/font-family/aeonik";
  console.log(`[SMOKE-TEST] Starting CoType test for: ${url}`);

  const scrapeResult = await CoTypeScraper.scrape(url);
  const fonts = Array.isArray(scrapeResult.fonts) ? scrapeResult.fonts : [];
  console.log(`[SMOKE-TEST] Scraper result: ${scrapeResult.foundryName} | ${fonts.length} assets identified.`);

  const hasPlaceholder = fonts.some((font) => {
    const candidate = String(font?.url || "").toLowerCase();
    return candidate === "browser-intercept" || candidate === "interception-mode";
  });
  const directFonts = fonts.filter((font) => isHttpUrl(font?.url));
  const outputFolder = `smoke-test-cotype-${Date.now()}`;

  const result = await runDownload(
    hasPlaceholder || directFonts.length === 0
      ? {
          mode: "browser-intercept",
          targetUrl: scrapeResult.targetUrl || scrapeResult.originalUrl,
          outputFolder,
          expectedCount: scrapeResult.expectedCount,
          injectScript: scrapeResult.injectScript,
          masterFoundry: scrapeResult.masterFoundry,
          metadata: {
            foundry: scrapeResult.foundryName,
            family:
              scrapeResult?.fonts?.[0]?.metadata?.family ||
              scrapeResult?.fonts?.[0]?.family ||
              "cotype",
            fonts
          }
        }
      : {
          mode: "batch-direct",
          fonts: [
            {
              url: String(directFonts[0].url),
              family: String(directFonts[0].family || "cotype"),
              style: typeof directFonts[0].style === "string" ? directFonts[0].style : undefined,
              weight:
                typeof directFonts[0].weight === "string" || typeof directFonts[0].weight === "number"
                  ? String(directFonts[0].weight)
                  : undefined,
              metadata: directFonts[0].metadata || {}
            }
          ],
          source: "smoke-cotype",
          outputFolder,
          metadata: {
            foundry: scrapeResult.foundryName,
            family: directFonts[0]?.metadata?.family || directFonts[0]?.family || "cotype"
          }
        }
  );

  console.log(`[SMOKE-TEST] Output directory: ${result.outputDir}`);
  console.log(`[SMOKE-TEST] Downloaded assets: ${result.downloaded.length}`);
}

smokeTestCoType().catch((error) => {
  console.error("[SMOKE-TEST] FAILED!");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
