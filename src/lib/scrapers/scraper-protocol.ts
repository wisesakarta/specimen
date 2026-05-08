export interface FontMetadata {
  url: string;
  format: "woff2" | "woff" | "otf" | "ttf" | "eot" | "zip";
  family: string;
  style?: string;
  weight?: string | number;
  downloadable?: boolean;
  note?: string;
  category?: string; // Optional: used for folder organization (e.g. "Condensed", "Nord")
  targetUrl?: string; // Optional: Override navigation target for interception mode
  metadata?: any;     // Optional: Extra context (e.g. pageUrl for interception routing)
}

export interface ScrapeResult {
  scraperName: string;
  foundryName: string; // Display name
  fonts: FontMetadata[];
  originalUrl: string;
  targetUrl?: string; // Optional: URL to use for browser-intercept mode
  injectScript?: string; // Optional: Custom JS to execute in the browser context (e.g. to force unicode font loading)
  expectedCount?: number; // Optional: Expected number of variants for smart exit/quality gate
  masterFoundry?: boolean; // Optional: Activate high-fidelity Master Forge engine (OTF + Skeleton)
  metadata?: any; // Optional: Extra context (e.g. bypassWhitelist)
}

export interface Scraper {
  /**
   * Unique identifier for the scraper (e.g., "lineto", "generic").
   */
  id: string;

  /**
   * Name of the scraper for display/logging.
   */
  name: string;

  /**
   * Determines if this scraper should handle the given URL.
   * Specific scrapers should return true only for their target domains.
   * Generic scraper should return true as a fallback.
   */
  canHandle(url: string): boolean;

  /**
   * Performs the scraping logic.
   * Should return a list of found font metadata.
   */
  scrape(url: string): Promise<ScrapeResult>;
}
