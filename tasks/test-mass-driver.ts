import { MassDriverScraper } from "../src/lib/scrapers/massdriver";
import * as fs from 'fs';

async function main() {
  console.log("Starting Mass Driver Scraper Integration Test...");
  try {
    const result = await MassDriverScraper.scrape("https://mass-driver.com/");
    console.log(`\nFound ${result.fonts.length} fonts!`);
    
    // Check missing fields
    const missingUrls = result.fonts.filter(f => !f.url);
    if (missingUrls.length > 0) console.warn(`Found ${missingUrls.length} fonts missing URLs`);
    
    fs.writeFileSync("tasks/massdriver-scrape-results.json", JSON.stringify(result, null, 2));
    console.log("Saved full results to tasks/massdriver-scrape-results.json");
  } catch (err) {
    console.error("Scraper Error:", err);
  }
}

main().catch(console.error);
