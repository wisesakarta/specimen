import { BrandingWithTypeScraper } from "@/lib/scrapers/brandingwithtype";
import { runDownload } from "@/lib/server/font-downloader";

const isHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

const isInlineUrl = (value: unknown): value is string =>
  typeof value === "string" && /^inline-font:\/\//i.test(value);

async function smokeTestBWT() {
  const url = "https://brandingwithtype.com/typefaces/bw-gradual/buy";
  console.log(`[SMOKE-TEST] Starting Branding with Type test for: ${url}`);

  const scrapeResult = await BrandingWithTypeScraper.scrape(url);
  const fonts = Array.isArray(scrapeResult.fonts) ? scrapeResult.fonts : [];
  console.log(`[SMOKE-TEST] Scraper result: ${scrapeResult.foundryName} | ${fonts.length} assets identified.`);

  const directFonts = fonts.filter((font) => isHttpUrl(font?.url) || isInlineUrl(font?.url));
  const outputFolder = `smoke-test-bwt-${Date.now()}`;

  if (directFonts.length === 0) {
    console.warn("[SMOKE-TEST] No direct or inline fonts found!");
    return;
  }

  console.log(`[SMOKE-TEST] Running batch-direct download for ${directFonts.length} fonts...`);

  const result = await runDownload({
    mode: "batch-direct",
    fonts: directFonts.map(f => ({
      url: String(f.url),
      family: String(f.family || "Bw Gradual"),
      style: typeof f.style === "string" ? f.style : undefined,
      weight: typeof f.weight === "string" || typeof f.weight === "number" ? String(f.weight) : undefined,
      metadata: f.metadata || {}
    })),
    source: "smoke-bwt",
    outputFolder,
    metadata: {
      foundry: scrapeResult.foundryName,
      family: "Bw Gradual"
    }
  });

  console.log(`[SMOKE-TEST] Output directory: ${result.outputDir}`);
  console.log(`[SMOKE-TEST] Downloaded/Converted assets: ${result.downloaded.length}`);
  
  const conversions = result.downloaded.filter(d => d.fileName.endsWith(".otf") || d.fileName.endsWith(".ttf"));
  if (conversions.length > 0) {
    console.log(`[SMOKE-TEST] SUCCESS: ${conversions.length} retail formats generated automatically.`);
  } else {
    console.warn("[SMOKE-TEST] No retail formats generated. Check conversion logs.");
  }
}

smokeTestBWT().catch((error) => {
  console.error("[SMOKE-TEST] FAILED!");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
