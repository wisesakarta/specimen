import { Scraper, ScrapeResult, FontMetadata } from "./scraper-protocol";
import { fetchTextWithTimeout } from "../server/browser-downloader";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

const SWISS_FORMAT_PRIORITY: Record<FontMetadata["format"], number> = {
  woff2: 4,
  woff: 3,
  ttf: 2,
  otf: 1,
  eot: 0,
  zip: 0
};

const detectSwissFormat = (value: string): FontMetadata["format"] => {
  const lower = value.toLowerCase();
  if (lower.includes("woff2")) return "woff2";
  if (lower.includes("woff")) return "woff";
  if (lower.includes("opentype") || lower.includes(".otf")) return "otf";
  return "ttf";
};

const detectSwissWeight = (value: string): number => {
  const lower = value.toLowerCase();
  if (/hairline/.test(lower)) return 100;
  if (/thin/.test(lower)) return 100;
  if (/extra-?light|ultra-?light/.test(lower)) return 200;
  if (/light/.test(lower)) return 300;
  if (/book|regular|roman/.test(lower)) return 400;
  if (/medium/.test(lower)) return 500;
  if (/semi-?bold|demi-?bold/.test(lower)) return 600;
  if (/bold/.test(lower)) return 700;
  if (/black|heavy/.test(lower)) return 900;
  return 400;
};

const toSwissWords = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeSwissFamilyName = (value: string): string =>
  toSwissWords(value)
    .replace(/\bOg\b/g, "OG")
    .replace(/^Sang Bleu\b/i, "SangBleu")
    .trim();

const formatSwissSlugDisplay = (value: string): string => {
  const lower = value.trim().toLowerCase();
  if (lower === "sangbleu") return "SangBleu";
  return normalizeSwissFamilyName(value.replace(/(^|[-_])([a-z])/g, (_m, prefix, ch) => `${prefix}${ch.toUpperCase()}`));
};

const normalizeSwissStyleName = (value: string): string => {
  const label = toSwissWords(value).replace(/\bWebXl\b/gi, "").replace(/\bWeb\b/gi, "").trim();
  if (!label) return "Regular";
  if (/^regular italic$/i.test(label)) return "Italic";
  return label;
};

const extractSwissPdfLinks = (html: string, pageUrl: string): string[] => {
  const hits = new Set<string>();
  for (const match of html.matchAll(/(?:https?:\/\/|\/\/|\/)[^"'<>\\\s]+?\.pdf(?:\?[^"'<>\\\s]*)?/gi)) {
    const raw = String(match[0] || "").replace(/\\\//g, "/").trim();
    if (!raw) continue;
    try {
      const resolved = /^https?:\/\//i.test(raw)
        ? new URL(raw)
        : raw.startsWith("//")
          ? new URL(`https:${raw}`)
          : new URL(raw, pageUrl);
      hits.add(resolved.href);
    } catch {
      // ignore malformed candidates
    }
  }
  return Array.from(hits);
};

const parseSwissAssetDescriptor = (
  assetUrl: string
): { family: string; styleName: string; fullName: string; style: "normal" | "italic"; weight: number } => {
  const fileName = decodeURIComponent(new URL(assetUrl).pathname.split("/").pop() || "");
  const stem = fileName.replace(/\.(woff2?|woff|ttf|otf)$/i, "").replace(/-WebXL$/i, "").replace(/-Web$/i, "");
  const splitIndex = stem.indexOf("-");
  const rawFamily = splitIndex >= 0 ? stem.slice(0, splitIndex) : stem;
  const rawStyle = splitIndex >= 0 ? stem.slice(splitIndex + 1) : "Regular";
  const family = normalizeSwissFamilyName(rawFamily);
  const styleName = normalizeSwissStyleName(rawStyle);
  return {
    family,
    styleName,
    fullName: `${family} ${styleName}`.replace(/\s+/g, " ").trim(),
    style: /italic/i.test(styleName) ? "italic" : "normal",
    weight: detectSwissWeight(styleName)
  };
};

export const SwissTypefacesScraper: Scraper = {
  id: "swisstypefaces",
  name: "Swiss Typefaces Scraper",

  canHandle(url: string): boolean {
    return url.includes("swisstypefaces.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const pageHtml = await fetchTextWithTimeout(url, 30000, BROWSER_HEADERS);
      const specimenPdfUrls = extractSwissPdfLinks(pageHtml, url);
      const homeHtml = await fetchTextWithTimeout("https://www.swisstypefaces.com/", 30000, BROWSER_HEADERS);
      const cssMatch = homeHtml.match(/href="(\/css\/fonts\/[^"]*)"/);

      let cssUrl = "https://www.swisstypefaces.com/css/fonts/";
      if (cssMatch && cssMatch[1]) {
        cssUrl = "https://www.swisstypefaces.com" + cssMatch[1];
      }

      const cssContent = await fetchTextWithTimeout(cssUrl, 30000, BROWSER_HEADERS);
      const fonts: FontMetadata[] = [];
      const expectedStyles = new Set<string>();
      const blocks = cssContent.split("}");
      const seenUrls = new Set<string>();

      let targetFamilySlug = "";
      const urlMatch = url.match(/\/fonts\/([^/]+)/);
      if (urlMatch && urlMatch[1]) {
        targetFamilySlug = urlMatch[1].toLowerCase().replace(/-/g, "");
      }

      for (const block of blocks) {
        if (!block.includes("@font-face")) continue;

        const fontFamilyMatch = block.match(/font-family:\s*'([^']+)'/);
        const srcMatches = [
          ...block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)\s*format\(\s*['"]?([^'")]+)['"]?\s*\)/gi)
        ];

        if (!fontFamilyMatch || srcMatches.length === 0) continue;

        const fontFamily = fontFamilyMatch[1];
        const familyLower = fontFamily.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (targetFamilySlug) {
          if (!familyLower.includes(targetFamilySlug) && !targetFamilySlug.includes(familyLower)) {
            continue;
          }
        }

        let fullUrl = "";
        let format: FontMetadata["format"] = "woff2";
        let bestScore = -1;
        for (const match of srcMatches) {
          const candidate = `https://www.swisstypefaces.com${match[1]}`;
          const candidateFormat = detectSwissFormat(match[2] || match[1]);
          const candidateScore = SWISS_FORMAT_PRIORITY[candidateFormat];
          if (candidateScore > bestScore) {
            bestScore = candidateScore;
            fullUrl = candidate;
            format = candidateFormat;
          }
        }

        if (!fullUrl || seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);

        const descriptor = parseSwissAssetDescriptor(fullUrl);
        expectedStyles.add(descriptor.fullName);
        fonts.push({
          url: fullUrl,
          family: descriptor.family,
          style: descriptor.style,
          weight: descriptor.weight,
          format,
          downloadable: true,
          note: "WebXL Quality",
          metadata: {
            pageUrl: url,
            foundry: "Swiss Typefaces",
            family: descriptor.family,
            styleName: descriptor.styleName,
            fullName: descriptor.fullName,
            forceMetadataRepair: true,
            specimenPdfUrls
          }
        });
      }

      return {
        scraperName: "SwissTypefacesScraper",
        foundryName: "Swiss Typefaces",
        fonts,
        originalUrl: url,
        targetUrl: url,
        metadata: {
          targetProfile: {
            profileId: "swisstypefaces-target-profile-v2",
            foundry: "Swiss Typefaces",
            familyDisplay: targetFamilySlug ? formatSwissSlugDisplay(targetFamilySlug) : "Swiss Typefaces",
            styleScope: "family-style",
            expectedStyles: Array.from(expectedStyles),
            specimenPdfUrls,
            source: "www.swisstypefaces.com",
            strictMissingStyles: false
          }
        }
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