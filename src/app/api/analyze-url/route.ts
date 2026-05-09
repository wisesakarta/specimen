import { NextRequest, NextResponse } from "next/server";
import { scrapers } from "@/lib/scrapers";
import { ScrapeResult } from "@/lib/scrapers/scraper-protocol";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const normalizeInputUrl = (rawUrl: unknown): string => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("URL is required");
  }

  const trimmed = rawUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProtocol).href;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = normalizeInputUrl(body?.url);

    console.log(`[Analyze] Analyzing URL: ${url}`);

    // 1. Find a compatible scraper
    const scraper = scrapers.find(s => s.canHandle(url));

    if (!scraper) {
      // Should not happen as GenericScraper handles everything, but just in case
      return NextResponse.json({ error: "No compatible scraper found" }, { status: 400 });
    }

    console.log(`[Analyze] Selected scraper: ${scraper.name}`);

    // 2. Execute scraping
    const result: ScrapeResult = await scraper.scrape(url);

    // 3. Return result
    return NextResponse.json(result);

  } catch (error: any) {
    console.error("[Analyze] Error:", error);
    const message = error?.message || "Failed to analyze URL";
    const status = message.includes("URL") || message.includes("Invalid URL") ? 400 : 500;

    return NextResponse.json({ 
      error: message,
      details: error.toString()
    }, { status });
  }
}

