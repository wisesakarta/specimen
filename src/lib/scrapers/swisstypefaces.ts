import { Scraper, ScrapeResult, FontMetadata } from "./types";
import { fetchTextWithTimeout } from "../server/browser-downloader";

export const SwissTypefacesScraper: Scraper = {
  id: "swisstypefaces",
  name: "Swiss Typefaces Scraper",

  canHandle(url: string): boolean {
    return url.includes("swisstypefaces.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const browserLikeHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    };

    try {
      // 1. Fetch Homepage to find the dynamic CSS URL
      const homeHtml = await fetchTextWithTimeout("https://www.swisstypefaces.com/", 30000, browserLikeHeaders);
      
      const cssMatch = homeHtml.match(/href="(\/css\/fonts\/[^"]*)"/);
      
      let cssUrl = "https://www.swisstypefaces.com/css/fonts/";
      if (cssMatch && cssMatch[1]) {
        cssUrl = "https://www.swisstypefaces.com" + cssMatch[1];
        console.log(`[SwissTypefaces] Found dynamic CSS URL: ${cssUrl}`);
      } else {
        console.warn("[SwissTypefaces] Dynamic CSS URL not found, falling back to static path.");
      }

      // 2. Fetch the Font CSS
      const cssContent = await fetchTextWithTimeout(cssUrl, 30000, browserLikeHeaders);

      // 3. Parse @font-face rules
      const fonts: FontMetadata[] = [];
      const blocks = cssContent.split("}");
      const seenUrls = new Set<string>();

      // Extract target family from input URL if specific (e.g. /fonts/sangbleu/)
      let targetFamilySlug = "";
      const urlMatch = url.match(/\/fonts\/([^/]+)/);
      if (urlMatch && urlMatch[1]) {
        targetFamilySlug = urlMatch[1].toLowerCase().replace(/-/g, ""); // "sangbleu"
      }

      for (const block of blocks) {
        if (!block.includes("@font-face")) continue;

        const fontFamilyMatch = block.match(/font-family:\s*'([^']+)'/);
        const srcMatch = block.match(/src:\s*url\('?([^')]+)'?\)/);
        const weightMatch = block.match(/font-weight:\s*(\d+|normal|bold)/);
        const styleMatch = block.match(/font-style:\s*(normal|italic)/);

        if (fontFamilyMatch && srcMatch) {
          const fontFamily = fontFamilyMatch[1];
          const relativeUrl = srcMatch[1];
          const weight = weightMatch ? weightMatch[1] : "400";
          const style = styleMatch ? styleMatch[1] : "normal";
          
          const fullUrl = `https://www.swisstypefaces.com${relativeUrl}`;

          // Filtering Logic
          const familyLower = fontFamily.toLowerCase().replace(/[^a-z0-9]/g, "");
          const isVariable = fullUrl.includes("variable") || fontFamily.includes("Variable");
          
          if (targetFamilySlug) {
            // Robust check: sangbleu should match sangbleu, sangbleusunrise, etc.
            if (!familyLower.includes(targetFamilySlug) && !targetFamilySlug.includes(familyLower)) {
              continue; // Skip unrelated families
            }
          }

          if (seenUrls.has(fullUrl)) continue;
          seenUrls.add(fullUrl);

          // Convert weight to number or string as required by FontMetadata
          let numericWeight: string | number = weight;
          if (weight === "normal") numericWeight = 400;
          if (weight === "bold") numericWeight = 700;
          
          fonts.push({
            url: fullUrl,
            family: fontFamily,
            style: style,
            weight: numericWeight,
            format: isVariable ? "ttf" : "woff2",
            downloadable: true,
            note: isVariable ? "Variable Font" : "WebXL Quality",
            metadata: {
              pageUrl: url,
              foundry: "Swiss Typefaces",
              family: fontFamily
            }
          });
        }
      }

      if (fonts.length === 0) {
        console.warn("[SwissTypefaces] No fonts found. Check CSS structure.");
      } else {
        console.log(`[SwissTypefaces] Found ${fonts.length} fonts.`);
      }

      return {
        scraperName: "SwissTypefacesScraper",
        foundryName: "Swiss Typefaces",
        fonts: fonts,
        originalUrl: url,
        targetUrl: url
      };

    } catch (error) {
      console.error("Swiss Typefaces scraping failed:", error);
      return {
        scraperName: "SwissTypefacesScraper",
        foundryName: "Swiss Typefaces",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
