import { load as loadHtml } from "cheerio";

import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const DUE_STUDIO_HOST = "due-studio.com";
const DUE_STUDIO_ORIGIN = "https://www.due-studio.com";
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
          ...(referer ? { Referer: referer, Origin: DUE_STUDIO_ORIGIN } : {}),
        },
      });

      if (!res.ok) {
        lastStatus = res.status;
        if (!shouldRetryStatus(res.status) || attempt === FETCH_ATTEMPTS - 1) {
          throw new Error(`Due Studio fetch failed (${res.status}) for ${url}`);
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
  throw new Error(`Due Studio fetch failed (${lastStatus || "unknown"}) for ${url}`);
};

const resolveFamilyScope = (inputUrl: string): { pageUrl: string; slug: string } => {
  const parsed = new URL(inputUrl);
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(DUE_STUDIO_HOST)) {
    throw new Error("Unsupported Due Studio URL.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const typefacesIndex = segments.findIndex((segment) => segment.toLowerCase() === "typefaces");
  const slug = typefacesIndex >= 0 ? segments[typefacesIndex + 1] : undefined;
  if (!slug) {
    throw new Error("Due Studio scraper expects a family page under /typefaces/{slug}.");
  }

  const normalizedSlug = slug.trim().toLowerCase();
  return {
    pageUrl: `${DUE_STUDIO_ORIGIN}/typefaces/${normalizedSlug}`,
    slug: normalizedSlug,
  };
};

const extractTitle = (html: string): string => {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || "";
};

const extractFamilyDisplay = (html: string, slug: string): string => {
  const rawTitle = decodeHtmlEntities(extractTitle(html));
  const trimmed = normalizeSpace(rawTitle)
    .replace(/^Due Studio\s*\|\s*/i, "")
    .replace(/\s*\|\s*Due Studio$/i, "")
    .trim();

  if (trimmed) return trimmed;

  const fallback = slug
    .split(/[-_]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return fallback || "Due Studio Typeface";
};

const extractInfoGrid = (html: string): Record<string, string> => {
  const $ = loadHtml(html);
  const out: Record<string, string> = {};

  const grid = $(".font-info-grid");
  grid.find(".grid-3").each((_idx, el) => {
    const cells = $(el)
      .children()
      .toArray()
      .map((child) => normalizeSpace($(child).text()))
      .filter(Boolean);
    if (cells.length < 2) return;
    const labelKey = toAsciiToken(cells[0]);
    if (!labelKey) return;
    out[labelKey] = normalizeSpace(cells.slice(1).join(" "));
  });

  return out;
};

const parseStyles = (stylesText: string): string[] => {
  const raw = normalizeSpace(stylesText);
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => normalizeSpace(item))
    .filter(Boolean);
};

const extractSpecimenPdfUrls = (html: string): string[] => {
  const urls = new Set<string>();
  const re = /https:\/\/cdn\.prod\.website-files\.com[^"'\s>]+\.pdf[^"'\s>]*/gi;
  for (const match of Array.from(html.matchAll(re))) {
    const value = decodeHtmlEntities(String(match[0] || "").trim());
    if (!value) continue;
    urls.add(value);
  }
  return Array.from(urls.values());
};

const extractTrialLinks = (html: string): string[] => {
  const $ = loadHtml(html);
  const out = new Set<string>();
  $("a[href]").each((_idx, el) => {
    const href = String($(el).attr("href") || "").trim();
    if (!href) return;
    const decoded = decodeHtmlEntities(href);
    try {
      const resolved = new URL(decoded, DUE_STUDIO_ORIGIN);
      const host = resolved.hostname.toLowerCase();
      if (!host.includes("dropbox.com")) return;
      if (host.includes("dropboxusercontent.com")) return; // preview webfonts live here
      out.add(resolved.href);
    } catch {
      // ignore
    }
  });
  return Array.from(out.values());
};

const extractFontFaceBlocks = (css: string): string[] => {
  const blocks: string[] = [];
  const re = /@font-face\s*{[^}]*}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    blocks.push(match[0]);
  }
  return blocks;
};

const extractFontFamilyKey = (block: string): string => {
  const match = block.match(/font-family:\s*([^;]+);/i);
  if (!match?.[1]) return "";
  return normalizeSpace(stripQuotes(match[1]));
};

const hasFontExtension = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return /\.(?:woff2?|otf|ttf|eot)(?:$|\?|\#)/i.test(parsed.pathname);
  } catch {
    return /\.(?:woff2?|otf|ttf|eot)(?:$|\?|\#)/i.test(url);
  }
};

const normalizeSuspiciousQuery = (url: string): string => {
  const first = url.indexOf("?");
  if (first < 0) return url;
  const second = url.indexOf("?", first + 1);
  if (second < 0) return url;
  return `${url.slice(0, second)}&${url.slice(second + 1)}`;
};

const extractFontUrlsFromFontFace = (block: string, pageUrl: string): string[] => {
  const urls: string[] = [];
  const re = /url\(([^)]+)\)/gi;
  for (const match of Array.from(block.matchAll(re))) {
    const raw = stripQuotes(String(match[1] || ""));
    if (!raw) continue;
    const decoded = decodeHtmlEntities(raw);
    if (!decoded) continue;
    if (decoded === "?raw=1" || decoded.startsWith("?raw=")) continue;
    if (decoded.startsWith("data:")) continue;

    let resolved: string;
    try {
      resolved = new URL(decoded, pageUrl).href;
    } catch {
      continue;
    }

    const normalized = normalizeSuspiciousQuery(resolved);
    if (!hasFontExtension(normalized)) continue;
    urls.push(normalized);
  }

  return Array.from(new Set(urls));
};

const inferFormatFromUrl = (url: string): FontMetadata["format"] => {
  const lower = url.toLowerCase();
  if (lower.includes(".woff2")) return "woff2";
  if (lower.includes(".woff")) return "woff";
  if (lower.includes(".otf")) return "otf";
  if (lower.includes(".ttf")) return "ttf";
  if (lower.includes(".eot")) return "eot";
  return "woff";
};

const pickPreferredFontUrl = (urls: string[]): string | undefined => {
  if (urls.length === 0) return undefined;
  const woff2 = urls.find((u) => /\.woff2(?:$|\?|\#)/i.test(u));
  if (woff2) return woff2;
  const woff = urls.find((u) => /\.woff(?:$|\?|\#)/i.test(u));
  if (woff) return woff;
  return urls[0];
};

const toExpectedCssKeyToken = (styleLabel: string): string => {
  const token = toAsciiToken(styleLabel);
  if (!token) return "";
  if (token === "italic" || token === "regularitalic") return "regularitalic";
  return token;
};

const parseStyleLabel = (label: string): { weight: string; fontStyle: "Normal" | "Italic" } => {
  const normalized = normalizeSpace(label);
  const italic = /\bitalic\b/i.test(normalized) || normalized.toLowerCase() === "italic";
  const weight = normalizeSpace(normalized.replace(/\bitalic\b/gi, "")) || (italic ? "Regular" : normalized) || "Regular";
  return { weight, fontStyle: italic ? "Italic" : "Normal" };
};

export const DueStudioScraper: Scraper = {
  id: "due-studio",
  name: "Due Studio Precision Scraper",

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase().includes(DUE_STUDIO_HOST);
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = resolveFamilyScope(url);
    const html = await fetchTextWithRetry(scope.pageUrl, scope.pageUrl);

    const familyDisplay = extractFamilyDisplay(html, scope.slug);
    const infoGrid = extractInfoGrid(html);
    const stylesText = infoGrid.styles || "";
    const expectedStyles = parseStyles(stylesText);
    if (expectedStyles.length === 0) {
      throw new Error(`Due Studio: Styles metadata missing for ${scope.slug}.`);
    }

    const specimenPdfUrls = extractSpecimenPdfUrls(html);
    const trialLinks = extractTrialLinks(html);

    const $ = loadHtml(html);
    const cssText = $("style")
      .toArray()
      .map((el) => String($(el).text() || ""))
      .join("\n");

    const fontFaceBlocks = extractFontFaceBlocks(cssText);
    const fontFaceMap = new Map<string, string[]>();
    const rawFontFaceKeys: string[] = [];

    for (const block of fontFaceBlocks) {
      const familyKey = extractFontFamilyKey(block);
      if (!familyKey) continue;
      rawFontFaceKeys.push(familyKey);
      const urls = extractFontUrlsFromFontFace(block, scope.pageUrl);
      if (urls.length === 0) continue;
      const token = toAsciiToken(familyKey);
      if (!token) continue;
      const existing = fontFaceMap.get(token) || [];
      fontFaceMap.set(token, Array.from(new Set([...existing, ...urls])));
    }

    const targetProfile: Record<string, unknown> = {
      profileId: "due-studio-target-profile-v1",
      foundry: "Due Studio",
      family: familyDisplay,
      familyDisplay,
      targetUrl: scope.pageUrl,
      targetSlug: scope.slug,
      source: "webflow-font-info-grid + inline-font-face",
      strictMissingStyles: true,
      expectedStyleCount: expectedStyles.length,
      expectedStyles,
      specimenPdfUrls,
      trialLinks,
      infoGrid,
      discoveredFontFaceKeys: Array.from(new Set(rawFontFaceKeys)).sort(),
      resolvedFontFaceCount: fontFaceMap.size,
    };

    const fonts: FontMetadata[] = [];
    const missingStyleLabels: string[] = [];

    for (const styleLabel of expectedStyles) {
      const cssKeyToken = toExpectedCssKeyToken(styleLabel);
      const urls = cssKeyToken ? fontFaceMap.get(cssKeyToken) || [] : [];
      const bestUrl = pickPreferredFontUrl(urls);
      if (!bestUrl) {
        missingStyleLabels.push(styleLabel);
        continue;
      }

      const { weight, fontStyle } = parseStyleLabel(styleLabel);
      const format = inferFormatFromUrl(bestUrl);
      const fullName = normalizeSpace(`${familyDisplay} ${styleLabel}`);

      fonts.push({
        url: bestUrl,
        format,
        family: familyDisplay,
        style: fontStyle,
        weight,
        downloadable: true,
        metadata: {
          foundry: "Due Studio",
          family: familyDisplay,
          pageUrl: scope.pageUrl,
          targetProfile,
          format,
          styleName: styleLabel,
          fullName,
          specimenPdfUrls,
          trialLinks,
          headers: {
            Origin: DUE_STUDIO_ORIGIN,
            Referer: scope.pageUrl,
            Accept: "*/*",
            "User-Agent": USER_AGENT,
          },
          forceMetadataRepair: true,
        },
      });
    }

    (targetProfile as any).missingStyleLabels = missingStyleLabels;

    if (fonts.length === 0) {
      throw new Error(`Due Studio found 0 downloadable font assets for ${scope.slug}.`);
    }

    return {
      scraperName: DueStudioScraper.name,
      foundryName: "Due Studio",
      fonts,
      originalUrl: url,
      targetUrl: scope.pageUrl,
      expectedCount: expectedStyles.length,
      metadata: {
        targetProfile,
        specimenPdfUrls,
        trialLinks,
      },
    };
  },
};
