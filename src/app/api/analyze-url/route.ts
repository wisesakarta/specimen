import { NextRequest, NextResponse } from "next/server";
import { scrapers } from "@/lib/scrapers";
import { ScrapeResult } from "@/lib/scrapers/scraper-protocol";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * SSRF protection: reject URLs targeting private/internal networks.
 * Only public internet URLs are permitted for server-side fetching.
 */
function isPrivateUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") return true;

    // Block private IP ranges (RFC 1918 + link-local + cloud metadata)
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      if (a === 10) return true;                          // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
      if (a === 192 && b === 168) return true;            // 192.168.0.0/16
      if (a === 169 && b === 254) return true;            // 169.254.0.0/16 (link-local / cloud metadata)
      if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64.0.0/10 (CGNAT / Tailscale)
    }

    // Block non-http(s) schemes
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;

    return false;
  } catch {
    return true;
  }
}

const normalizeInputUrl = (rawUrl: unknown): string => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("URL is required");
  }

  const trimmed = rawUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProtocol).href;
};

// Rate limiting: max 10 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(clientIp)) {
      return NextResponse.json({ error: "Rate limit exceeded. Please wait before trying again." }, { status: 429 });
    }

    const body = await req.json();
    const url = normalizeInputUrl(body?.url);

    // SSRF protection: reject private/internal network targets
    if (isPrivateUrl(url)) {
      return NextResponse.json({ error: "Access to internal addresses is not permitted" }, { status: 403 });
    }

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

