import { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const TYPETYPE_HOST = "typetype.org";
const TYPETYPE_ORIGIN = "https://typetype.org";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 25_000;

type StyleParse = {
  styleId: string;
  familyName: string;
  styleName: string;
  fullName: string;
  weightLabel: string;
  fontStyle: "Normal" | "Italic";
};

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripQuotes = (value: string): string => value.trim().replace(/^['"]+|['"]+$/g, "").trim();

const toAsciiToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_match, code) => {
      const num = Number(code);
      return Number.isFinite(num) ? String.fromCodePoint(num) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const num = Number.parseInt(String(code), 16);
      return Number.isFinite(num) ? String.fromCodePoint(num) : "";
    })
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#0*39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const toTitleWord = (token: string): string => {
  if (!token) return "";
  if (token.length <= 2) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
};

const slugToFamilyName = (slug: string): string => {
  const parts = slug
    .split(/[-_]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const label = parts.map((part) => toTitleWord(part)).join(" ");
  return label || "TypeType Font";
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryStatus = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500;

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastStatus: number | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...(referer ? { Referer: referer, Origin: TYPETYPE_ORIGIN } : {}),
        },
      });

      if (!res.ok) {
        lastStatus = res.status;
        if (!shouldRetryStatus(res.status) || attempt === FETCH_ATTEMPTS - 1) {
          throw new Error(`TypeType fetch failed (${res.status}) for ${url}`);
        }
      } else {
        return await res.text();
      }
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_ATTEMPTS - 1) break;
    }

    await delay(400 * (attempt + 1));
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`TypeType fetch failed (${lastStatus || "unknown"}) for ${url}`);
};

const resolveFamilyScope = (inputUrl: string): { pageUrl: string; slug: string } => {
  const parsed = new URL(inputUrl);
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(TYPETYPE_HOST)) {
    throw new Error("Unsupported TypeType URL.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const fontsIndex = segments.findIndex((segment) => segment.toLowerCase() === "fonts");
  const slug = fontsIndex >= 0 ? segments[fontsIndex + 1] : undefined;
  if (!slug) {
    throw new Error("TypeType scraper expects a family page under /fonts/{slug}.");
  }

  const normalizedSlug = slug.trim().toLowerCase();
  return {
    pageUrl: `${parsed.origin}/fonts/${normalizedSlug}/`,
    slug: normalizedSlug,
  };
};

const extractStyleIds = (html: string): string[] => {
  const ids = new Set<string>();
  const re = /order\[styles\]\[[^\]]+\]\[([^\]]+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const id = (match[1] || "").trim();
    if (!id) continue;
    ids.add(id);
  }
  return Array.from(ids.values());
};

const extractFontFaceBlocks = (html: string): string[] => html.match(/@font-face\s*\{[\s\S]*?\}/gi) || [];

const extractFontFamilyKey = (block: string): string | undefined => {
  const decodedBlock = decodeHtmlEntities(block);
  const match = decodedBlock.match(/font-family\s*:\s*([^;]+);/i);
  if (!match) return undefined;
  const raw = normalizeSpace(match[1] || "");
  if (!raw) return undefined;

  // TypeType inlines values like: font-family:"'ttchocolatesregular', sans-serif"
  const firstPart = normalizeSpace(raw.split(",")[0] || "");
  const cleaned = stripQuotes(firstPart).replace(/^'+|'+$/g, "").trim();
  return cleaned || undefined;
};

const extractFontUrlsFromFontFace = (block: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  const decodedBlock = decodeHtmlEntities(block);
  const re = /url\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(decodedBlock))) {
    const raw = (match[1] || "").trim();
    if (!raw) continue;
    const cleaned = decodeHtmlEntities(stripQuotes(raw)).replace(/\\\//g, "/").trim();
    if (!cleaned) continue;
    if (!/\.(?:otf|ttf|woff2?|eot)(?:$|[?#])/i.test(cleaned)) continue;
    try {
      const resolved = cleaned.startsWith("//")
        ? new URL(`https:${cleaned}`)
        : /^https?:\/\//i.test(cleaned)
          ? new URL(cleaned)
          : new URL(cleaned, baseUrl);
      out.add(resolved.href);
    } catch {
      // ignore malformed
    }
  }
  return Array.from(out.values());
};

const pickPreferredFontUrl = (urls: string[]): string | undefined => {
  const ranked = [...urls];
  ranked.sort((a, b) => {
    const rank = (value: string): number => {
      const lower = value.toLowerCase();
      if (/\.otf(?:$|[?#])/i.test(lower)) return 10;
      if (/\.ttf(?:$|[?#])/i.test(lower)) return 9;
      if (/\.woff2(?:$|[?#])/i.test(lower)) return 7;
      if (/\.woff(?:$|[?#])/i.test(lower)) return 6;
      if (/\.eot(?:$|[?#])/i.test(lower)) return 1;
      return 0;
    };
    return rank(b) - rank(a);
  });
  return ranked[0];
};

const inferFormatFromUrl = (url: string): FontMetadata["format"] => {
  const lower = url.toLowerCase();
  if (/\.woff2(?:$|[?#])/i.test(lower)) return "woff2";
  if (/\.woff(?:$|[?#])/i.test(lower)) return "woff";
  if (/\.otf(?:$|[?#])/i.test(lower)) return "otf";
  if (/\.ttf(?:$|[?#])/i.test(lower)) return "ttf";
  return "woff2";
};

const STYLE_VARIANT_TOKENS = ["condensed", "compact", "expanded", "mono"];
const WEIGHT_TOKENS: Array<{ token: string; label: string; weight: string }> = [
  { token: "extrablack", label: "ExtraBlack", weight: "900" },
  { token: "extrabold", label: "ExtraBold", weight: "800" },
  { token: "extralight", label: "ExtraLight", weight: "200" },
  { token: "demibold", label: "DemiBold", weight: "600" },
  { token: "semibold", label: "SemiBold", weight: "600" },
  { token: "black", label: "Black", weight: "900" },
  { token: "bold", label: "Bold", weight: "700" },
  { token: "medium", label: "Medium", weight: "500" },
  { token: "regular", label: "Regular", weight: "400" },
  { token: "normal", label: "Normal", weight: "400" },
  { token: "book", label: "Book", weight: "400" },
  { token: "light", label: "Light", weight: "300" },
  { token: "thin", label: "Thin", weight: "100" },
];

const parseStyleId = (styleId: string, basePrefix: string, baseFamilyName: string): StyleParse => {
  const normalizedId = toAsciiToken(styleId);
  const normalizedPrefix = toAsciiToken(basePrefix);
  let remainder = normalizedId.startsWith(normalizedPrefix) ? normalizedId.slice(normalizedPrefix.length) : normalizedId;

  const variants: string[] = [];
  let variantMatched = true;
  while (variantMatched) {
    variantMatched = false;
    for (const variant of STYLE_VARIANT_TOKENS) {
      if (remainder.startsWith(variant)) {
        variants.push(toTitleWord(variant));
        remainder = remainder.slice(variant.length);
        variantMatched = true;
        break;
      }
    }
  }

  let italic = false;
  if (remainder.endsWith("italic")) {
    italic = true;
    remainder = remainder.slice(0, -6);
  }

  const weightMatch = WEIGHT_TOKENS.find((candidate) => remainder === candidate.token) ||
    WEIGHT_TOKENS.find((candidate) => remainder.startsWith(candidate.token));
  const weightLabel = weightMatch?.label || (remainder ? toTitleWord(remainder) : "Regular");
  const weight = weightMatch?.weight || "400";

  const familyName = normalizeSpace([baseFamilyName, ...variants].filter(Boolean).join(" "));
  const styleName = italic
    ? weightLabel.toLowerCase() === "regular" || !remainder
      ? "Regular Italic"
      : `${weightLabel} Italic`
    : weightLabel;
  const fullName = normalizeSpace(`${familyName} ${styleName}`);

  return {
    styleId,
    familyName,
    styleName,
    fullName,
    weightLabel: weightLabel.toLowerCase() === "italic" ? "Regular" : weightLabel,
    fontStyle: italic ? "Italic" : "Normal",
  };
};

const extractSpecimenPdfUrls = (html: string, pageUrl: string, slugCompact: string): string[] => {
  const strongMatches = new Set<string>();
  const fallbackMatches = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi,
    /["'](\/\/[^"'<>]+?\.pdf(?:\?[^"'<>]*)?)["']/gi,
    /["'](\/[^"'<>]+?\.pdf(?:\?[^"'<>]*)?)["']/gi,
    /\\"(https?:\/\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi,
    /\\"(\/\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi,
    /\\"(\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi,
  ];

  const add = (raw: string) => {
    const decoded = decodeHtmlEntities(String(raw || "")).trim().replace(/\\\//g, "/");
    if (!decoded) return;
    const token = toAsciiToken(decoded);
    if (!token.includes("specimen")) return;
    if (token.includes("license")) return;
    try {
      const resolved = decoded.startsWith("//")
        ? new URL(`https:${decoded}`)
        : /^https?:\/\//i.test(decoded)
          ? new URL(decoded)
          : new URL(decoded, pageUrl);
      const href = resolved.href;
      fallbackMatches.add(href);
      if (slugCompact && token.includes(slugCompact)) {
        strongMatches.add(href);
      }
    } catch {
      // ignore malformed
    }
  };

  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      add(match[1] || match[0]);
    }
  }

  if (strongMatches.size > 0) return Array.from(strongMatches.values());
  return Array.from(fallbackMatches.values());
};

export const TypeTypeScraper: Scraper = {
  id: "typetype",
  name: "TypeType Precision Scraper",

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase().includes(TYPETYPE_HOST);
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = resolveFamilyScope(url);
    const html = await fetchTextWithRetry(scope.pageUrl, scope.pageUrl);

    const styleIds = extractStyleIds(html);
    if (styleIds.length === 0) {
      throw new Error(`TypeType style map not found for ${scope.slug}.`);
    }

    const slugCompact = toAsciiToken(scope.slug);
    const baseFamilyName = slugToFamilyName(scope.slug);
    const specimenPdfUrls = extractSpecimenPdfUrls(html, scope.pageUrl, slugCompact);

    const fontFaceMap = new Map<string, string[]>();
    for (const block of extractFontFaceBlocks(html)) {
      const familyKey = extractFontFamilyKey(block);
      if (!familyKey) continue;
      const urls = extractFontUrlsFromFontFace(block, scope.pageUrl);
      if (urls.length === 0) continue;
      const existing = fontFaceMap.get(familyKey) || [];
      fontFaceMap.set(familyKey, Array.from(new Set([...existing, ...urls])));
    }

    const targetProfile: Record<string, unknown> = {
      profileId: "typetype-target-profile-v1",
      foundry: "TypeType",
      family: baseFamilyName,
      familyDisplay: baseFamilyName,
      targetUrl: scope.pageUrl,
      targetSlug: scope.slug,
      styleScope: "family-style",
      source: "inline-font-face-style-map",
      expectedStyleCount: styleIds.length,
      strictMissingStyles: true,
      specimenPdfUrls,
    };

    const fonts: FontMetadata[] = [];
    const expectedStyles: string[] = [];
    const missingStyles: string[] = [];

    for (const styleId of styleIds) {
      const parsed = parseStyleId(styleId, slugCompact, baseFamilyName);
      expectedStyles.push(parsed.fullName);

      const urls = fontFaceMap.get(styleId) || [];
      const bestUrl = pickPreferredFontUrl(urls);
      if (!bestUrl) {
        missingStyles.push(styleId);
        continue;
      }

      const format = inferFormatFromUrl(bestUrl);
      fonts.push({
        url: bestUrl,
        format,
        family: parsed.familyName,
        weight: parsed.weightLabel,
        style: parsed.fontStyle,
        downloadable: true,
        metadata: {
          foundry: "TypeType",
          family: parsed.familyName,
          pageUrl: scope.pageUrl,
          format,
          styleId: parsed.styleId,
          styleName: parsed.styleName,
          fullName: parsed.fullName,
          specimenPdfUrls,
          targetProfile,
          headers: {
            Origin: TYPETYPE_ORIGIN,
            Referer: scope.pageUrl,
            Accept: "*/*",
            "User-Agent": USER_AGENT,
          },
        },
      });
    }

    (targetProfile as any).expectedStyles = expectedStyles;
    (targetProfile as any).missingStyleIds = missingStyles;
    (targetProfile as any).resolvedFontFaceCount = fontFaceMap.size;

    if (fonts.length === 0) {
      throw new Error(`TypeType found 0 downloadable font assets for ${scope.slug}.`);
    }

    return {
      scraperName: TypeTypeScraper.name,
      foundryName: "TypeType",
      fonts,
      originalUrl: url,
      expectedCount: styleIds.length,
      metadata: {
        targetProfile,
        specimenPdfUrls,
      },
    };
  },
};
