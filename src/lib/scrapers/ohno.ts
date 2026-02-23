import { FontMetadata, ScrapeResult, Scraper } from "./types";

const FONT_URL_REGEX =
  /(https:\/\/ohno\.sfo3\.cdn\.digitaloceanspaces\.com\/fonts\/[^\s"'()]+?\.(?:woff2|woff|ttf|otf)(?:\?[^\s"'()]*)?)/gi;
const formatPriority: Record<FontMetadata["format"], number> = {
  woff2: 4,
  woff: 3,
  ttf: 2,
  otf: 1,
  eot: 0,
  zip: 0
};

const toToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const toWords = (value: string): string =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

const toTitle = (value: string): string =>
  toWords(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const normalizeOhnoTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const typefacesIndex = parts.indexOf("typefaces");
  if (typefacesIndex !== -1 && parts[typefacesIndex + 1]) {
    parts[typefacesIndex] = "fonts";
    parsed.pathname = `/${parts.join("/")}`;
  }
  return parsed.href;
};

const getTargetSlug = (targetUrl: string): string | null => {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const fontsIndex = parts.indexOf("fonts");
    if (fontsIndex !== -1 && parts[fontsIndex + 1]) {
      return parts[fontsIndex + 1].toLowerCase();
    }
  } catch {
    // no-op
  }
  return null;
};

const detectWeight = (baseName: string): number => {
  const lower = baseName.toLowerCase();
  if (/hairline|thin/.test(lower)) return 100;
  if (/extra-?light|ultra-?light/.test(lower)) return 200;
  if (/light|book/.test(lower)) return 300;
  if (/regular|normal|roman/.test(lower)) return 400;
  if (/medium/.test(lower)) return 500;
  if (/semi-?bold|demi-?bold/.test(lower)) return 600;
  if (/extra-?bold|ultra-?bold/.test(lower)) return 800;
  if (/black|heavy|super/.test(lower)) return 900;
  if (/bold/.test(lower)) return 700;
  return 400;
};

const detectStyle = (baseName: string): "normal" | "italic" => {
  return /italic|kursiv/i.test(baseName) ? "italic" : "normal";
};

const parseOhnoFontUrl = (fontUrl: string, targetUrl: string): FontMetadata | null => {
  const parsed = new URL(fontUrl);
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const fontsIndex = pathParts.indexOf("fonts");
  if (fontsIndex === -1 || !pathParts[fontsIndex + 1]) return null;

  const familySlug = pathParts[fontsIndex + 1];
  const family = toTitle(familySlug);
  const fileName = decodeURIComponent(pathParts[pathParts.length - 1] || "");
  const baseName = fileName.replace(/\.(woff2|woff|ttf|otf)$/i, "");
  const prefix = baseName.split("-")[0] || "";

  const normalizedPrefix = toToken(prefix.replace(/^ohno[_-]?/i, ""));
  const normalizedFamily = toToken(familySlug);
  let category: string | undefined;
  if (
    normalizedPrefix &&
    normalizedPrefix.startsWith(normalizedFamily) &&
    normalizedPrefix.length > normalizedFamily.length
  ) {
    const suffix = normalizedPrefix.slice(normalizedFamily.length);
    category = toTitle(suffix);
  }

  const format = (/\.(woff2|woff|ttf|otf)(?:$|\?)/i.exec(fileName)?.[1]?.toLowerCase() || "woff2") as
    | "woff2"
    | "woff"
    | "ttf"
    | "otf";

  const isVariable = /variable|(?:^|[-_])vf(?:[-_]|$)/i.test(baseName);
  const style = detectStyle(baseName);
  const weight = detectWeight(baseName);

  return {
    url: parsed.href,
    format,
    family,
    category,
    style,
    weight,
    downloadable: true,
    note: isVariable ? "Variable Font" : "Web Font",
    metadata: {
      foundry: "Ohno Type Co",
      family,
      category,
      pageUrl: targetUrl
    }
  };
};

const getStemKey = (fontUrl: string): string => {
  try {
    const fileName = decodeURIComponent(new URL(fontUrl).pathname.split("/").pop() || "");
    const stem = fileName.replace(/\.(woff2|woff|ttf|otf)$/i, "");
    return toToken(stem);
  } catch {
    return toToken(fontUrl);
  }
};

const matchesTargetSlug = (font: FontMetadata, targetSlug: string): boolean => {
  const targetToken = toToken(targetSlug);
  if (!targetToken) return true;

  const candidates = [
    font.family || "",
    font.category || "",
    font.url || "",
    typeof font.note === "string" ? font.note : ""
  ];

  return candidates.some((candidate) => {
    const token = toToken(candidate);
    if (!token) return false;
    return token.includes(targetToken) || targetToken.includes(token);
  });
};

export const OhnoScraper: Scraper = {
  id: "ohno",
  name: "Ohno Type Co Scraper",

  canHandle(url: string): boolean {
    return url.includes("ohnotype.co");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const targetUrl = normalizeOhnoTargetUrl(url);
    const targetSlug = getTargetSlug(targetUrl);

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml"
        }
      });
      const html = await response.text();
      const normalizedHtml = html.replace(/\\\//g, "/");

      const matches = [...normalizedHtml.matchAll(FONT_URL_REGEX)].map((match) => match[1]);
      const seen = new Set<string>();
      const fonts: FontMetadata[] = [];

      for (const matchedUrl of matches) {
        const canonical = matchedUrl.split("?")[0].toLowerCase();
        if (seen.has(canonical)) continue;
        seen.add(canonical);

        const parsed = parseOhnoFontUrl(matchedUrl, targetUrl);
        if (!parsed) continue;
        fonts.push(parsed);
      }

      const filteredFonts =
        targetSlug && fonts.length > 0
          ? (() => {
              const filtered = fonts.filter((font) => matchesTargetSlug(font, targetSlug));
              return filtered.length > 0 ? filtered : fonts;
            })()
          : fonts;

      const dedupedMap = new Map<string, FontMetadata>();
      for (const font of filteredFonts) {
        const key = `${toToken(font.family || "unknown")}:${getStemKey(font.url)}`;
        const existing = dedupedMap.get(key);
        if (!existing || formatPriority[font.format] > formatPriority[existing.format]) {
          dedupedMap.set(key, font);
        }
      }
      const dedupedFonts = [...dedupedMap.values()].sort((a, b) => {
        const aHasCategory = a.category ? 1 : 0;
        const bHasCategory = b.category ? 1 : 0;
        if (aHasCategory !== bHasCategory) return aHasCategory - bHasCategory;

        const familyCompare = (a.family || "").localeCompare(b.family || "");
        if (familyCompare !== 0) return familyCompare;

        const weightA = typeof a.weight === "number" ? a.weight : Number(a.weight || 400);
        const weightB = typeof b.weight === "number" ? b.weight : Number(b.weight || 400);
        if (weightA !== weightB) return weightA - weightB;

        const styleA = a.style || "normal";
        const styleB = b.style || "normal";
        return styleA.localeCompare(styleB);
      });

      console.log(
        `[OhnoScraper] URL=${targetUrl} target=${targetSlug || "all"} raw=${fonts.length} filtered=${filteredFonts.length} deduped=${dedupedFonts.length}`
      );

      return {
        scraperName: "OhnoScraper",
        foundryName: "Ohno Type Co",
        fonts: dedupedFonts,
        originalUrl: url,
        targetUrl
      };
    } catch (error) {
      console.error("[OhnoScraper] failed:", error);
      return {
        scraperName: "OhnoScraper",
        foundryName: "Ohno Type Co",
        fonts: [],
        originalUrl: url,
        targetUrl
      };
    }
  }
};
