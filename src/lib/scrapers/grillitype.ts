import { Scraper, ScrapeResult } from "./types";
import { generateProvocationScript } from "../provocation-dictionary";

export const GrilliTypeScraper: Scraper = {
  id: "grillitype",
  name: "Grilli Type Extractor",

  canHandle(url: string): boolean {
    return url.includes("grillitype.com") || url.includes("gt-type.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const urlObj = new URL(url);
      
      let familyName = "Grilli Type Font";
      const pathParts = urlObj.pathname.split('/').filter(p => p !== '');
      
      if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1];
          familyName = lastPart
              .split('-')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
      }

      return {
        scraperName: this.name,
        foundryName: "Grilli Type",
        fonts: [
          {
            url: "browser-intercept",
            family: familyName,
            format: "woff2",
            weight: "Regular",
            style: "Normal",
            downloadable: true,
            note: "Grilli Type uses self-hosted fonts. Universal Interceptor will capture WOFF2 streams."
          }
        ],
        originalUrl: url,
        targetUrl: url,
        masterFoundry: true,
        injectScript: generateProvocationScript('CHAOS'), // Superpower: Activated
        metadata: {
          bypassWhitelist: true
        }
      };
    } catch (e) {
      console.error("Grilli Type Scraper Error:", e);
      return { 
        scraperName: this.name, 
        foundryName: "Grilli Type", 
        fonts: [], 
        originalUrl: url 
      };
    }
  }
};
