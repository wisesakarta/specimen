import { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const INTERVAL_HOST = "intervaltype.com";
const INTERVAL_ORIGIN = "https://intervaltype.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 25_000;

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

const stripHtml = (value: string): string =>
  decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeIntervalTitleSuffix = (value: string): string => {
  const cleaned = value.replace(/\s*[-–|]\s*Interval Type\s*$/i, "").trim();
  return cleaned || value;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

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
          ...(referer ? { Referer: referer, Origin: INTERVAL_ORIGIN } : {})
        }
      });

      if (!res.ok) {
        lastStatus = res.status;
        if (!shouldRetryStatus(res.status) || attempt === FETCH_ATTEMPTS - 1) {
          throw new Error(`Interval Type fetch failed (${res.status}) for ${url}`);
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
  throw new Error(`Interval Type fetch failed (${lastStatus || "unknown"}) for ${url}`);
};

const resolveProductScope = (inputUrl: string): { pageUrl: string; slug: string } => {
  const parsed = new URL(inputUrl);
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(INTERVAL_HOST)) {
    throw new Error("Unsupported Interval Type URL.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const productIndex = segments.findIndex((segment) => segment.toLowerCase() === "product");
  const slug = productIndex >= 0 ? segments[productIndex + 1] : undefined;
  if (!slug) {
    throw new Error("Interval Type scraper expects a product page under /product/{slug}.");
  }

  const normalizedSlug = slug.trim().toLowerCase();
  return {
    pageUrl: `${parsed.origin}/product/${normalizedSlug}/`,
    slug: normalizedSlug
  };
};

const slugToTitle = (slug: string): string => {
  const parts = slug
    .split(/[-_]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const label = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return label || "Interval Type";
};

const extractProductTitle = (html: string, slug: string): string => {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (og?.[1]) {
    const title = normalizeIntervalTitleSuffix(stripHtml(og[1]));
    if (title) return title;
  }

  const h1 = html.match(/<h1[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) {
    const title = normalizeIntervalTitleSuffix(stripHtml(h1[1]));
    if (title) return title;
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag?.[1]) {
    const raw = stripHtml(titleTag[1]);
    const cleaned = normalizeIntervalTitleSuffix(raw);
    if (cleaned) return cleaned;
  }

  return slugToTitle(slug);
};

const extractFontFaceBlocks = (html: string): string[] => html.match(/@font-face\s*\{[\s\S]*?\}/gi) || [];

const extractCssProperty = (block: string, property: string): string | undefined => {
  const decoded = decodeHtmlEntities(block);
  const match = decoded.match(new RegExp(`${property}\\s*:\\s*([^;]+);`, "i"));
  if (!match) return undefined;
  const raw = normalizeSpace(match[1] || "");
  if (!raw) return undefined;
  return stripQuotes(raw);
};

const extractUrlsFromCss = (block: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  const decoded = decodeHtmlEntities(block);
  const re = /url\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(decoded))) {
    const raw = (match[1] || "").trim();
    if (!raw) continue;
    const cleaned = stripQuotes(raw)
      .replace(/\\\//g, "/")
      // Defensive trim for malformed `url(...zip))` patterns.
      .replace(/[);]+$/g, "")
      .trim();
    if (!cleaned) continue;

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

const isIntervalUploadAsset = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes(INTERVAL_HOST)) return false;
    return parsed.pathname.startsWith("/app/uploads/");
  } catch {
    return false;
  }
};

const pickPreferredFontUrl = (urls: string[]): string | undefined => {
  const ranked = [...urls];
  ranked.sort((a, b) => {
    return rankFontUrl(b) - rankFontUrl(a);
  });
  return ranked[0];
};

const rankFontUrl = (value: string): number => {
  const lower = value.toLowerCase();
  if (/\.otf(?:$|[?#])/i.test(lower)) return 10;
  if (/\.ttf(?:$|[?#])/i.test(lower)) return 9;
  if (/\.woff2(?:$|[?#])/i.test(lower)) return 7;
  if (/\.woff(?:$|[?#])/i.test(lower)) return 6;
  if (/\.eot(?:$|[?#])/i.test(lower)) return 1;
  return 0;
};

const inferFormatFromUrl = (url: string): FontMetadata["format"] => {
  const lower = url.toLowerCase();
  if (/\.zip(?:$|[?#])/i.test(lower)) return "zip";
  if (/\.woff2(?:$|[?#])/i.test(lower)) return "woff2";
  if (/\.woff(?:$|[?#])/i.test(lower)) return "woff";
  if (/\.otf(?:$|[?#])/i.test(lower)) return "otf";
  if (/\.ttf(?:$|[?#])/i.test(lower)) return "ttf";
  return "woff2";
};

const WEIGHT_TOKENS: Array<{ token: string; label: string }> = [
  { token: "ultralight", label: "ExtraLight" },
  { token: "extralight", label: "ExtraLight" },
  { token: "thin", label: "Thin" },
  { token: "light", label: "Light" },
  { token: "book", label: "Book" },
  { token: "regular", label: "Regular" },
  { token: "medium", label: "Medium" },
  { token: "semibold", label: "SemiBold" },
  { token: "demibold", label: "DemiBold" },
  { token: "bold", label: "Bold" },
  { token: "extrabold", label: "ExtraBold" },
  { token: "black", label: "Black" }
];

const parseStyleFromCssFamily = (cssFamily: string): { weightLabel: string; fontStyle: "Normal" | "Italic"; styleName: string } => {
  const cleaned = normalizeSpace(cssFamily).replace(/[_\s]+/g, "-");
  const lastDash = cleaned.lastIndexOf("-");
  let variant = lastDash >= 0 ? cleaned.slice(lastDash + 1) : cleaned;

  // Remove duplicate trailing family token patterns like "Rooftop-Bold_Rooftop".
  if (lastDash >= 0) {
    const base = cleaned.slice(0, lastDash);
    const baseToken = toAsciiToken(base);
    const variantToken = toAsciiToken(variant);
    if (baseToken && variantToken.endsWith(baseToken)) {
      const trimmed = variant.replace(new RegExp(`${base}$`, "i"), "").replace(/[_-]+$/g, "");
      if (trimmed) variant = trimmed;
    }
  }

  let italic = false;
  if (/italic$/i.test(variant)) {
    italic = true;
    variant = variant.replace(/italic$/i, "");
  } else if (/oblique$/i.test(variant)) {
    italic = true;
    variant = variant.replace(/oblique$/i, "");
  }

  const token = toAsciiToken(variant);
  const weightMatch = WEIGHT_TOKENS.find((candidate) => token === candidate.token);
  const weightLabel = weightMatch?.label || (variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : "Regular");
  const styleName = italic ? `${weightLabel} Italic` : weightLabel;

  return {
    weightLabel,
    fontStyle: italic ? "Italic" : "Normal",
    styleName
  };
};

const extractSpecimenPdfUrls = (html: string, pageUrl: string, familyToken: string): string[] => {
  const legalDocMarkers = ["eula", "license", "licence", "terms", "agreement", "readme", "copyright"];

  const specimenMatches = new Set<string>();
  const familyMatches = new Set<string>();

  const matches = html.matchAll(/["']?(\/app\/uploads\/[^"'\s<>]+?\.pdf(?:\?[^"'\s<>]*)?)["']?/gi);

  for (const match of matches) {
    const raw = String(match[1] || match[0] || "");
    const cleaned = decodeHtmlEntities(raw).trim().replace(/[);]+$/g, "");
    if (!cleaned) continue;

    const token = toAsciiToken(cleaned);
    if (legalDocMarkers.some((marker) => token.includes(marker))) continue;

    try {
      const resolved = /^https?:\/\//i.test(cleaned) ? new URL(cleaned) : new URL(cleaned, pageUrl);
      const href = resolved.href;

      if (token.includes("specimen")) {
        specimenMatches.add(href);
      } else if (familyToken && token.includes(familyToken)) {
        // Some products publish a specimen PDF without the "Specimen" substring (e.g. Oceanic-Text-Mono.pdf).
        familyMatches.add(href);
      }
    } catch {
      // ignore malformed
    }
  }

  if (specimenMatches.size > 0) return Array.from(specimenMatches.values());
  return Array.from(familyMatches.values());
};

export const IntervalTypeScraper: Scraper = {
  id: "intervaltype",
  name: "Interval Type Precision Scraper",

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase().includes(INTERVAL_HOST);
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = resolveProductScope(url);
    const html = await fetchTextWithRetry(scope.pageUrl, scope.pageUrl);

    const familyDisplay = extractProductTitle(html, scope.slug);
    const familyToken = toAsciiToken(familyDisplay);
    const specimenPdfUrls = extractSpecimenPdfUrls(html, scope.pageUrl, familyToken);

    const blocks = extractFontFaceBlocks(html);
    if (blocks.length === 0) {
      throw new Error(`Interval Type found 0 @font-face blocks for ${scope.slug}.`);
    }

    const styleEntries = new Map<
      string,
      {
        url: string;
        format: FontMetadata["format"];
        styleName: string;
        fullName: string;
        weight: string;
        style: "Normal" | "Italic";
      }
    >();
    const zipUrls: string[] = [];

    for (const block of blocks) {
      const cssFamilyRaw = extractCssProperty(block, "font-family");
      if (!cssFamilyRaw) continue;

      const urls = extractUrlsFromCss(block, scope.pageUrl).filter((u) => isIntervalUploadAsset(u));
      if (urls.length === 0) continue;

      const fontUrls = urls.filter((u) => /\.(?:woff2?|otf|ttf|eot)(?:$|[?#])/i.test(u));
      const zipCandidates = urls.filter((u) => /\.zip(?:$|[?#])/i.test(u));
      for (const zip of zipCandidates) zipUrls.push(zip);
      if (fontUrls.length === 0) continue;

      const bestUrl = pickPreferredFontUrl(fontUrls);
      if (!bestUrl) continue;

      const parsedStyle = parseStyleFromCssFamily(cssFamilyRaw);
      const fullName = normalizeSpace(`${familyDisplay} ${parsedStyle.styleName}`);
      const styleKey = `${toAsciiToken(familyDisplay)}:${toAsciiToken(parsedStyle.styleName)}`;

      const existing = styleEntries.get(styleKey);
      if (!existing || rankFontUrl(bestUrl) > rankFontUrl(existing.url)) {
        styleEntries.set(styleKey, {
          url: bestUrl,
          format: inferFormatFromUrl(bestUrl),
          styleName: parsedStyle.styleName,
          fullName,
          weight: parsedStyle.weightLabel,
          style: parsedStyle.fontStyle
        });
      }
    }

    const expectedStyles = Array.from(new Set(Array.from(styleEntries.values()).map((entry) => entry.fullName)));
    if (expectedStyles.length === 0) {
      throw new Error(`Interval Type found 0 downloadable font assets for ${scope.slug}.`);
    }

    const targetProfile: Record<string, unknown> = {
      profileId: "intervaltype-target-profile-v1",
      foundry: "Interval Type",
      family: familyDisplay,
      familyDisplay,
      targetUrl: scope.pageUrl,
      targetSlug: scope.slug,
      styleScope: "family-style",
      source: "product-inline-font-face",
      strictMissingStyles: true,
      failOnTrialAssets: false,
      expectedStyleCount: expectedStyles.length,
      expectedStyles,
      specimenPdfUrls,
      zipAssetUrls: Array.from(new Set(zipUrls))
    };

    const fonts: FontMetadata[] = [];
    for (const entry of styleEntries.values()) {
      fonts.push({
        url: entry.url,
        format: entry.format,
        family: familyDisplay,
        weight: entry.weight,
        style: entry.style,
        downloadable: true,
        metadata: {
          foundry: "Interval Type",
          family: familyDisplay,
          pageUrl: scope.pageUrl,
          format: entry.format,
          styleName: entry.styleName,
          fullName: entry.fullName,
          specimenPdfUrls,
          forceMetadataRepair: true,
          targetProfile,
          headers: {
            Origin: INTERVAL_ORIGIN,
            Referer: scope.pageUrl,
            Accept: "*/*",
            "User-Agent": USER_AGENT
          }
        }
      });
    }

    return {
      scraperName: IntervalTypeScraper.name,
      foundryName: "Interval Type",
      fonts,
      originalUrl: url,
      expectedCount: expectedStyles.length,
      metadata: {
        targetProfile,
        specimenPdfUrls,
        zipAssetUrls: Array.from(new Set(zipUrls))
      }
    };
  }
};
