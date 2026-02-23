import { Scraper, ScrapeResult } from "./types";

export const KlimScraper: Scraper = {
  id: "klim",
  name: "Klim Scraper",

  canHandle(url: string): boolean {
    return url.includes("klim.co.nz");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    return {
      scraperName: this.name,
      foundryName: "Klim Type Foundry",
      fonts: [
        {
          url: "browser-intercept",
          format: "woff2",
          family: "Klim Asset",
          weight: "400",
          style: "Normal",
          downloadable: true,
          note: "Strategy: type-tester-intercept"
        }
      ],
      originalUrl: url,
      targetUrl: url,
      masterFoundry: true,
      injectScript: `
        (async () => {
            console.log("KLIM PROVOCATION INITIATED");
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            window.scrollTo(0, document.body.scrollHeight / 3);
            await sleep(1000);
            const inputs = document.querySelectorAll('input, textarea, [contenteditable]');
            inputs.forEach(input => {
                input.focus();
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            const styles = document.querySelectorAll('[class*="style"], [class*="specimen"]');
            styles.forEach(el => {
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            });
            console.log("KLIM PROVOCATION COMPLETE");
        })();
      `
    };
  }
};
