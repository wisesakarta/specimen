import path from "node:path";

import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const JULYTYPE_HOST = "www.julytype.com";
const JULYTYPE_ORIGIN = "https://www.julytype.com";
const JULYTYPE_STRAPI_ORIGIN = "https://strapi-julytype-1zhv.onrender.com";
const JULYTYPE_FETCH_TIMEOUT_MS = 30000;
const JULYTYPE_FETCH_MAX_RETRIES = 3;
const JULYTYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const JULYTYPE_FEATURE_TAG_RE =
  /\b(ss\d{2}|cv\d{2}|liga|dlig|calt|salt|onum|lnum|pnum|tnum|frac|afrc|sups|subs|smcp|c2sc|case|ordn|kern|zero|locl|rlig)\b/gi;
const JULYTYPE_FILE_OBJECT_RE =
  /\{"name":"([^"]+)","alternativeText":[^{}]*?"formats":null,"hash":"([^"]+)","ext":"(\.[a-z0-9]+)","mime":"([^"]+)","size":([0-9.]+),"url":"([^"]+)"[^{}]*\}/gi;
const JULYTYPE_GLYPH_ENTRY_RE = /\{"id":\d+,"title":"[^"]+","content":"([^"]*)","opentypeFeature":[^}]*\}/g;

type JulyTypeAsset = {
  name: string;
  hash: string;
  ext: string;
  mime: string;
  sizeKb: number;
  sourceUrl: string;
  isFont: boolean;
  isPdf: boolean;
};

type JulyTypeFontCandidate = {
  sourceUrl: string;
  format: FontMetadata["format"];
  familyName: string;
  styleName: string;
  fullName: string;
  style: "Normal" | "Italic";
  weight: string | number;
  isVariable: boolean;
  hash: string;
  sizeKb: number;
  mime: string;
};

const JULYTYPE_GENERIC_SLUG_PARTS = new Set(["jt", "typeface", "typefaces", "family", "collection", "font", "fonts"]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const dedupeStringList = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = item.trim();
    if (!text) continue;
    const key = normalizeToken(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const decodeEscapedText = (value: string): string =>
  value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ");

const normalizeTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === "julytype.com") {
    parsed.hostname = JULYTYPE_HOST;
  }
  return parsed.href;
};

const extractSlugFromUrl = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && segments[0].toLowerCase() === "typefaces") {
      return segments[1].toLowerCase();
    }
  } catch {
    // ignore invalid URL
  }
  return undefined;
};

const toReadableWords = (value: string): string => {
  if (!value.trim()) return "";
  const withSpaces = value
    .replace(/[_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return withSpaces
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "jt") return "JT";
      if (lower === "vf") return "VF";
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      if (/^\d+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
};

const normalizeFamilyLabel = (value: string): string => {
  const readable = toReadableWords(value);
  return readable || "July Type";
};

const normalizeStyleLabel = (value: string): string => {
  const base = toReadableWords(value)
    .replace(/\bSemi Bold\b/gi, "Semibold")
    .replace(/\bExtra Light\b/gi, "Extralight")
    .replace(/\bExtra Bold\b/gi, "Extrabold")
    .replace(/\bUltra Light\b/gi, "Ultralight")
    .replace(/\bUltra Bold\b/gi, "Ultrabold")
    .replace(/\bRegular Upright\b/gi, "Regular")
    .replace(/\bUpright\b/gi, "Regular")
    .replace(/\s+/g, " ")
    .trim();

  return base || "Regular";
};

const inferWeight = (styleName: string, isVariable: boolean): string | number => {
  if (isVariable) return "Variable";
  const token = normalizeToken(styleName);
  if (token.includes("hairline")) return "Hairline";
  if (token.includes("thin")) return "Thin";
  if (token.includes("extralight") || token.includes("ultralight")) return "ExtraLight";
  if (token.includes("light")) return "Light";
  if (token.includes("book")) return "Book";
  if (token.includes("regular") || token.includes("upright") || token.includes("roman")) return "Regular";
  if (token.includes("medium")) return "Medium";
  if (token.includes("semibold") || token.includes("demibold")) return "SemiBold";
  if (token.includes("extrabold") || token.includes("ultrabold")) return "ExtraBold";
  if (token.includes("black")) return "Black";
  if (token.includes("bold")) return "Bold";
  return "Regular";
};

const buildSlugTokens = (slug?: string, familyName?: string): string[] => {
  const slugTokens = (slug || "")
    .split(/[-_]+/g)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !JULYTYPE_GENERIC_SLUG_PARTS.has(token));

  if (slugTokens.length > 0) return slugTokens;

  const familyTokens = (familyName || "")
    .split(/\s+/g)
    .map(normalizeToken)
    .filter((token) => token.length >= 4 && !JULYTYPE_GENERIC_SLUG_PARTS.has(token));

  return familyTokens;
};

const matchesTargetTokens = (asset: JulyTypeAsset, tokens: string[]): boolean => {
  if (tokens.length === 0) return true;
  const haystack = normalizeToken(`${asset.name} ${asset.hash} ${asset.sourceUrl}`);
  if (!haystack) return false;
  return tokens.every((token) => haystack.includes(token));
};

const buildRscUrl = (targetUrl: string): string => {
  const parsed = new URL(targetUrl);
  parsed.searchParams.set("_rsc", `specimen${Date.now().toString(36)}`);
  return parsed.href;
};

const fetchTextWithRetry = async (
  url: string,
  headers: Record<string, string>,
  timeoutMs = JULYTYPE_FETCH_TIMEOUT_MS
): Promise<string> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= JULYTYPE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < JULYTYPE_FETCH_MAX_RETRIES) {
        await sleep(450 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("JulyType fetch failed");
};

const extractFamilyNameFromHtml = (html: string, fallback: string): string => {
  const buyMatch = html.match(/<h2[^>]*>\s*Buy\s+([^<]+)\s*<\/h2>/i);
  const buyFamily = asNonEmptyString(buyMatch?.[1]);
  if (buyFamily) return buyFamily;

  const aboutMatch = html.match(/<h4[^>]*>\s*About\s+([^<]+)\s*<\/h4>/i);
  const aboutFamily = asNonEmptyString(aboutMatch?.[1]);
  if (aboutFamily) return aboutFamily;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = asNonEmptyString(titleMatch?.[1]);
  if (title && !/^july type$/i.test(title)) {
    const head = title.split("|")[0]?.trim() || title;
    const normalized = head.replace(/\s+/g, " ").trim();
    if (normalized && !/^july type$/i.test(normalized)) return normalized;
  }

  return fallback;
};

const toSourceUrl = (urlValue: string): string => {
  const trimmed = urlValue.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return new URL(trimmed, JULYTYPE_STRAPI_ORIGIN).href;
};

const parseRscAssets = (rscText: string): JulyTypeAsset[] => {
  const out: JulyTypeAsset[] = [];
  const seen = new Set<string>();

  for (const match of rscText.matchAll(JULYTYPE_FILE_OBJECT_RE)) {
    const name = asNonEmptyString(match[1]);
    const hash = asNonEmptyString(match[2]);
    const ext = asNonEmptyString(match[3])?.toLowerCase();
    const mime = asNonEmptyString(match[4]) || "application/octet-stream";
    const sizeRaw = Number(match[5]);
    const urlValue = asNonEmptyString(match[6]);

    if (!name || !hash || !ext || !urlValue) continue;
    const isFont = ext === ".woff2" || ext === ".woff" || ext === ".ttf" || ext === ".otf";
    const isPdf = ext === ".pdf";
    if (!isFont && !isPdf) continue;

    const sourceUrl = toSourceUrl(urlValue);
    const key = `${sourceUrl}::${ext}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      hash,
      ext,
      mime,
      sizeKb: Number.isFinite(sizeRaw) ? sizeRaw : 0,
      sourceUrl,
      isFont,
      isPdf
    });
  }

  return out;
};

const parseStyleFromHash = (hash: string, familyRaw: string): string | undefined => {
  const cleaned = hash.replace(/_[a-f0-9]{6,}$/i, "");
  const hashParts = cleaned.split(/[_\s-]+/g).filter(Boolean);
  if (hashParts.length === 0) return undefined;

  const familyParts = toReadableWords(familyRaw)
    .split(/\s+/g)
    .map(normalizeToken)
    .filter(Boolean);

  const styleParts = hashParts.filter((part) => {
    const token = normalizeToken(part);
    if (!token) return false;
    if (token === "jt") return false;
    return !familyParts.includes(token);
  });

  if (styleParts.length === 0) return undefined;
  return styleParts.join(" ");
};

const toFormatFromExt = (ext: string): FontMetadata["format"] => {
  if (ext === ".woff2") return "woff2";
  if (ext === ".woff") return "woff";
  if (ext === ".ttf") return "ttf";
  if (ext === ".otf") return "otf";
  return "woff2";
};

const parseFontCandidate = (asset: JulyTypeAsset, fallbackFamily: string): JulyTypeFontCandidate => {
  const stem = path.basename(asset.name, path.extname(asset.name)).trim();
  const chunks = stem.split("-").filter(Boolean);
  const rawFamilyChunk = chunks[0] || fallbackFamily;
  const styleChunkFromName = chunks.length > 1 ? chunks.slice(1).join(" ") : "";
  const variableFlag = /(^|[^a-z])vf([^a-z]|$)|variable/i.test(`${stem} ${asset.hash}`);

  let familyChunk = rawFamilyChunk;
  let styleChunk = styleChunkFromName || parseStyleFromHash(asset.hash, rawFamilyChunk) || "Regular";

  if (variableFlag) {
    familyChunk = familyChunk.replace(/(?:[_\-\s]?vf|[_\-\s]?variable)$/i, "").trim() || familyChunk;
    if (!styleChunk || /^(regular|upright|roman)$/i.test(styleChunk)) {
      styleChunk = "Variable";
    } else if (/italic/i.test(styleChunk)) {
      styleChunk = "Variable Italic";
    } else {
      styleChunk = `Variable ${styleChunk}`;
    }
  }

  const familyName = normalizeFamilyLabel(familyChunk || fallbackFamily);
  const styleName = normalizeStyleLabel(styleChunk);
  const isItalic = /italic|oblique/i.test(styleName);
  const fullName = `${familyName} ${styleName}`.replace(/\s+/g, " ").trim();
  const format = toFormatFromExt(asset.ext);

  return {
    sourceUrl: asset.sourceUrl,
    format,
    familyName,
    styleName,
    fullName,
    style: isItalic ? "Italic" : "Normal",
    weight: inferWeight(styleName, variableFlag),
    isVariable: variableFlag,
    hash: asset.hash,
    sizeKb: asset.sizeKb,
    mime: asset.mime
  };
};

const pickDownloadSet = (candidates: JulyTypeFontCandidate[]): JulyTypeFontCandidate[] => {
  const groups = new Map<string, JulyTypeFontCandidate[]>();
  for (const candidate of candidates) {
    const key = `${normalizeToken(candidate.familyName)}::${normalizeToken(candidate.styleName)}::${candidate.isVariable ? "var" : "static"}`;
    const list = groups.get(key) || [];
    list.push(candidate);
    groups.set(key, list);
  }

  const score = (candidate: JulyTypeFontCandidate): number => {
    if (candidate.isVariable) {
      if (candidate.format === "ttf") return 100;
      if (candidate.format === "woff2") return 90;
      if (candidate.format === "woff") return 80;
      if (candidate.format === "otf") return 70;
      return 10;
    }
    if (candidate.format === "woff2") return 100;
    if (candidate.format === "woff") return 90;
    if (candidate.format === "otf") return 80;
    if (candidate.format === "ttf") return 70;
    return 10;
  };

  const picked: JulyTypeFontCandidate[] = [];
  for (const [, list] of groups) {
    const best = list
      .slice()
      .sort((a, b) => score(b) - score(a))[0];
    if (best) picked.push(best);
  }

  picked.sort((a, b) => {
    const familyCmp = a.familyName.localeCompare(b.familyName);
    if (familyCmp !== 0) return familyCmp;
    return a.fullName.localeCompare(b.fullName);
  });

  return picked;
};

const extractFeatureTags = (rscText: string): string[] => {
  const tags = new Set<string>();
  for (const match of rscText.matchAll(JULYTYPE_FEATURE_TAG_RE)) {
    const tag = asNonEmptyString(match[1]);
    if (tag) tags.add(tag.toLowerCase());
  }
  return Array.from(tags).sort();
};

const extractSupportedLanguages = (rscText: string): string[] => {
  const out: string[] = [];

  for (const match of rscText.matchAll(/"language":"([^"]+)"/g)) {
    const language = asNonEmptyString(match[1]);
    if (language) out.push(decodeEscapedText(language));
  }

  for (const match of rscText.matchAll(/"languages":"([^"]+)"/g)) {
    const block = decodeEscapedText(match[1]);
    for (const segment of block.split(",")) {
      const language = segment.replace(/\s+/g, " ").trim();
      if (language) out.push(language);
    }
  }

  return dedupeStringList(out);
};

const extractGlyphCountEstimate = (rscText: string): number | undefined => {
  const glyphTokens = new Set<string>();

  for (const match of rscText.matchAll(JULYTYPE_GLYPH_ENTRY_RE)) {
    const content = decodeEscapedText(match[1] || "");
    if (!content) continue;

    for (const tokenRaw of content.split(/\s+/g)) {
      const token = tokenRaw.trim();
      if (!token) continue;
      if (token.length > 20) continue;
      if (/^[a-z]{4,}$/i.test(token)) continue;
      glyphTokens.add(token);
    }
  }

  return glyphTokens.size > 0 ? glyphTokens.size : undefined;
};

const buildFallbackInjectScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const controls = Array.from(document.querySelectorAll("button, [role='button'], [class*='style'], [class*='weight'], [class*='variant']"));
    for (const node of controls.slice(0, 240)) {
      try {
        if (node instanceof HTMLElement) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } catch {}
      await sleep(65);
    }
    await sleep(1400);
    window.__specimen_julytype_probe_done = true;
    window.__specimen_julytype_probe_done = true;
  })();
`;

const buildTargetProfile = (params: {
  targetUrl: string;
  targetSlug?: string;
  familyName: string;
  fonts: JulyTypeFontCandidate[];
  featureTags: string[];
  specimenPdfUrls: string[];
  supportedLanguages: string[];
  glyphCount?: number;
}): Record<string, unknown> => {
  const expectedStyles = dedupeStringList(params.fonts.map((font) => font.fullName));
  const expectedStaticStyles = dedupeStringList(params.fonts.filter((font) => !font.isVariable).map((font) => font.fullName));
  const catalogFeatureTags = dedupeStringList(params.featureTags.map((tag) => tag.toLowerCase()));

  return {
    profileId: "julytype-target-profile-v1",
    source: "julytype-next-rsc+strapi-assets",
    foundry: "July Type",
    styleScope: "family-style",
    strictMissingStyles: true,
    targetUrl: params.targetUrl,
    targetSlug: params.targetSlug,
    familyDisplay: params.familyName,
    expectedStyles,
    expectedStaticStyles,
    expectedStyleCount: expectedStyles.length,
    styleMap: params.fonts.map((font) => ({
      familyName: font.familyName,
      styleName: font.styleName,
      expectedStyle: font.fullName,
      style: font.style,
      weight: font.weight,
      format: font.format,
      sourceUrl: font.sourceUrl,
      sourceType: font.isVariable ? "variable" : "static",
      hash: font.hash,
      sizeKb: font.sizeKb
    })),
    // JulyType RSC exposes feature catalog from specimen UI.
    // Treat tags as informational for analysis; do not hard-gate pass/fail with them.
    requiredFeatureTags: [],
    catalogFeatureTags,
    glyphCount: params.glyphCount,
    specimenPdfUrls: params.specimenPdfUrls,
    supportedLanguages: params.supportedLanguages,
    collectedAt: new Date().toISOString()
  };
};

const toFontMetadata = (
  font: JulyTypeFontCandidate,
  targetUrl: string,
  targetProfile: Record<string, unknown>
): FontMetadata => ({
  url: font.sourceUrl,
  family: font.familyName,
  format: font.format,
  style: font.style,
  weight: font.weight,
  downloadable: true,
  note: font.isVariable ? "JulyType variable asset (RSC)." : "JulyType static asset (RSC).",
  metadata: {
    foundry: "July Type",
    family: font.familyName,
    styleName: font.styleName,
    fullName: font.fullName,
    pageUrl: targetUrl,
    targetUrl,
    sourceType: font.isVariable ? "variable" : "static",
    hash: font.hash,
    sizeKb: font.sizeKb,
    forceMetadataRepair: true,
    targetProfile,
    headers: {
      Origin: JULYTYPE_ORIGIN,
      Referer: targetUrl,
      Accept: "*/*"
    }
  }
});

export const JulyTypeScraper: Scraper = {
  id: "julytype",
  name: "JulyType RSC Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?julytype\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const targetUrl = normalizeTargetUrl(url);
      const targetSlug = extractSlugFromUrl(targetUrl);
      const fallbackFamily = targetSlug
        ? toReadableWords(targetSlug.replace(/^jt[-_\s]*/i, "JT-"))
        : "July Type";

      const html = await fetchTextWithRetry(targetUrl, {
        "User-Agent": JULYTYPE_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: JULYTYPE_ORIGIN
      });
      const familyName = extractFamilyNameFromHtml(html, fallbackFamily);

      const rscText = await fetchTextWithRetry(buildRscUrl(targetUrl), {
        "User-Agent": JULYTYPE_UA,
        Accept: "text/x-component,*/*;q=0.9",
        rsc: "1",
        Referer: targetUrl
      });

      const assets = parseRscAssets(rscText);
      const targetTokens = buildSlugTokens(targetSlug, familyName);

      const matchedAssets = assets.filter((asset) => matchesTargetTokens(asset, targetTokens));
      const candidateAssets =
        matchedAssets.some((asset) => asset.isFont) || matchedAssets.some((asset) => asset.isPdf) ? matchedAssets : assets;

      const specimenPdfUrls = dedupeStringList(candidateAssets.filter((asset) => asset.isPdf).map((asset) => asset.sourceUrl));
      const fontCandidates = candidateAssets
        .filter((asset) => asset.isFont)
        .map((asset) => parseFontCandidate(asset, familyName));

      const pickedFonts = pickDownloadSet(fontCandidates);
      const featureTags = extractFeatureTags(rscText);
      const supportedLanguages = extractSupportedLanguages(rscText);
      const glyphCount = extractGlyphCountEstimate(rscText);

      const targetProfile = buildTargetProfile({
        targetUrl,
        targetSlug,
        familyName,
        fonts: pickedFonts,
        featureTags,
        specimenPdfUrls,
        supportedLanguages,
        glyphCount
      });

      if (pickedFonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "July Type",
          fonts: [
            {
              url: "browser-intercept",
              family: familyName,
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "July Type",
                family: familyName,
                pageUrl: targetUrl,
                targetUrl,
                targetProfile
              }
            }
          ],
          originalUrl: url,
          targetUrl,
          injectScript: buildFallbackInjectScript(),
          metadata: {
            foundry: "July Type",
            family: familyName,
            targetProfile,
            specimenPdfUrls,
            fallbackMode: "browser-intercept"
          }
        };
      }

      const fonts = pickedFonts.map((font) => toFontMetadata(font, targetUrl, targetProfile));
      const expectedCount = Array.isArray(targetProfile.expectedStyles)
        ? Number((targetProfile.expectedStyles as unknown[]).length)
        : fonts.length;

      return {
        scraperName: this.name,
        foundryName: "July Type",
        fonts,
        originalUrl: url,
        targetUrl,
        expectedCount,
        metadata: {
          foundry: "July Type",
          family: familyName,
          targetProfile,
          specimenPdfUrls
        }
      };
    } catch (error) {
      console.error("[JulyTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "July Type",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
