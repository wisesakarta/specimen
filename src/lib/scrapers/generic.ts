import { Scraper, ScrapeResult, FontMetadata } from "./types";
import * as cheerio from "cheerio";

export const GenericScraper: Scraper = {
  id: "generic",
  name: "Universal Font Scanner",

  canHandle(url: string): boolean {
    return true; // Fallback for everyone
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const html = await response.text();
      const $ = cheerio.load(html);
      const fonts: FontMetadata[] = [];
      const seenUrls = new Set<string>();

      // 1. Regex Scan on HTML (The "Net" approach)
      const fontRegex = /(https?:\/\/[^\s"']+\.(?:woff2|woff|otf|ttf))/gi;
      const htmlMatches = html.match(fontRegex) || [];

      htmlMatches.forEach(match => {
        if (!seenUrls.has(match)) {
          seenUrls.add(match);
          fonts.push(createGenericMetadata(match));
        }
      });

      // 2. Scan linked CSS files (Basic depth-1 scan)
      const cssLinks: string[] = [];
      $('link[rel="stylesheet"]').each((_: number, el: any) => {
        const href = $(el).attr('href');
        if (href) {
            // Resolve relative URLs
            const absoluteUrl = new URL(href, url).toString();
            cssLinks.push(absoluteUrl);
        }
      });

      // Fetch CSS files parallelly
      const cssPromises = cssLinks.map(async (cssUrl) => {
        try {
            const cssRes = await fetch(cssUrl);
            const cssText = await cssRes.text();
            const cssMatches = cssText.match(fontRegex) || [];
            cssMatches.forEach(match => {
                if (!seenUrls.has(match)) {
                    seenUrls.add(match);
                    fonts.push(createGenericMetadata(match));
                }
            });
        } catch (e) {
            console.warn(`Failed to scan CSS: ${cssUrl}`);
        }
      });
      
      await Promise.all(cssPromises);

      return {
        scraperName: this.name,
        foundryName: "Detected via Generic Scan",
        fonts: fonts,
        originalUrl: url
      };

    } catch (error: any) {
      console.error("Generic Scraper Error:", error);
      throw error;
    }
  }
};

function createGenericMetadata(url: string): FontMetadata {
    const filename = url.split('/').pop() || 'Unknown';
    const ext = filename.split('.').pop() as "woff2" | "woff" | "otf" | "ttf";
    const family = filename.replace(/\.(woff2|woff|otf|ttf)$/, '').replace(/[-_]/g, ' ');
    
    return {
        url,
        format: ["woff2", "woff", "otf", "ttf"].includes(ext) ? ext : "woff2",
        family: family,
        weight: "Regular" // Best guess
    };
}
