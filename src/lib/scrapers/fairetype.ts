import { load as loadHtml } from "cheerio";

import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const FAIRETYPE_HOST_RE = /(^|\/\/)(www\.)?fairetype\.com/i;
const FAIRETYPE_ORIGIN = "https://www.fairetype.com";
const FAIRETYPE_CATALOG_URL = `${FAIRETYPE_ORIGIN}/fonts`;
const FAIRETYPE_TRIAL_URL = `${FAIRETYPE_ORIGIN}/trial-fonts`;
const FAIRETYPE_SITEMAP_URL = `${FAIRETYPE_ORIGIN}/sitemap.xml`;
const FAIRETYPE_FETCH_TIMEOUT_MS = 30_000;
const FAIRETYPE_FETCH_MAX_RETRIES = 3;
const FAIRETYPE_FAMILY_CONCURRENCY = 4;
const FAIRETYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const FAIRETYPE_STYLE_FEATURE_RE =
  /<input[^>]*name=['"][^'"]*(?:alternate|ligature|swashes|fractions|ordinals|case-sensitive|open-type-figure|circle-numbers)[^'"]*['"][^>]*value=['"]([^'"]+)['"]/gi;
const FAIRETYPE_OT_FEATURE_TAG_RE =
  /\b(ss\d{2}|cv\d{2}|liga|dlig|clig|hlig|rlig|calt|ccmp|locl|salt|swsh|frac|ordn|case|zero|tnum|onum|lnum|pnum|sups|subs|sinf|smcp|c2sc|aalt|kern|mark|mkmk)\b/gi;
const FAIRETYPE_RANGE_AXIS_MAP: Record<string, { axisName: string; axisLabelName: string }> = {
  wght: { axisName: "wght", axisLabelName: "Weight" },
  weight: { axisName: "wght", axisLabelName: "Weight" },
  wdth: { axisName: "wdth", axisLabelName: "Width" },
  width: { axisName: "wdth", axisLabelName: "Width" },
  slnt: { axisName: "slnt", axisLabelName: "Slant" },
  slant: { axisName: "slnt", axisLabelName: "Slant" },
  ital: { axisName: "ital", axisLabelName: "Italic" },
  italic: { axisName: "ital", axisLabelName: "Italic" },
  opsz: { axisName: "opsz", axisLabelName: "Optical Size" },
  opticalsize: { axisName: "opsz", axisLabelName: "Optical Size" }
};
const FAIRETYPE_BLOCKED_PDF_RE = /\b(eula|license|licen[cs]e|terms|legals?|privacy|cookie|policy|refund)\b/i;
const FAIRETYPE_LIGATURE_TAGS = new Set(["liga", "dlig", "clig", "hlig", "rlig", "calt", "ccmp"]);
const FAIRETYPE_REQUIRED_FEATURE_CANDIDATES = ["liga", "calt", "frac", "ordn", "case"];

type FaireTypeScope =
  | {
      mode: "family";
      inputUrl: string;
      targetUrl: string;
      slug: string;
    }
  | {
      mode: "catalog";
      inputUrl: string;
      targetUrl: string;
    };

type FaireTypeCatalogEntry = {
  slug: string;
  title?: string;
};

type FaireTypeStyleOption = {
  url: string;
  fullName: string;
  styleName: string;
  style: "Normal" | "Italic";
  weight: string | number;
  expectedStyle: string;
};

type FaireTypeVariableAxis = {
  axisName: string;
  axisLabelName?: string;
};

type FaireTypeVariableSource = {
  url: string;
  style: "Normal" | "Italic";
  styleName: string;
  weight: string | number;
  axisNames: string[];
};

type FaireTypeFontMetadataHints = {
  supportsItalics: boolean;
  supportsSlnt: boolean;
  italicStyleProperty?: string;
  italicStyleValue?: string;
  variableAxes: FaireTypeVariableAxis[];
};

type FaireTypeGlyphStats = {
  glyphSetCount: number;
  glyphTokenCount: number;
};

type FaireTypeFamilyProfile = {
  slug: string;
  familyDisplay: string;
  targetUrl: string;
  fonts: FontMetadata[];
  expectedStyles: string[];
  styleMap: Array<Record<string, unknown>>;
  featureTags: string[];
  ligatureFeatureTags: string[];
  glyphStats: FaireTypeGlyphStats;
  languageCount?: number;
  release?: string;
  version?: string;
  fileTypes?: string;
  specimenPdfUrls: string[];
  technicalPdfUrls: string[];
  variableAxes: FaireTypeVariableAxis[];
  supportsItalics: boolean;
  supportsSlnt: boolean;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeSpace = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();

const normalizeToken = (value: string): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const dedupeStrings = (values: Array<string | undefined | null>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = normalizeSpace(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
};

const parseScope = (inputUrl: string): FaireTypeScope => {
  const parsed = new URL(inputUrl);
  parsed.protocol = "https:";
  parsed.hostname = "www.fairetype.com";
  parsed.hash = "";

  const segments = parsed.pathname.split("/").filter(Boolean);
  const lower = segments.map((segment) => segment.toLowerCase());

  if (lower[0] === "fonts" && segments[1]) {
    const slug = normalizeSpace(segments[1]).toLowerCase();
    if (slug) {
      return {
        mode: "family",
        inputUrl,
        targetUrl: `${FAIRETYPE_ORIGIN}/fonts/${encodeURIComponent(slug)}`,
        slug
      };
    }
  }

  if (lower[0] === "families" && segments[1] && lower[2] === "purchase") {
    const slug = normalizeSpace(segments[1]).toLowerCase();
    if (slug) {
      return {
        mode: "family",
        inputUrl,
        targetUrl: `${FAIRETYPE_ORIGIN}/fonts/${encodeURIComponent(slug)}`,
        slug
      };
    }
  }

  return {
    mode: "catalog",
    inputUrl,
    targetUrl: FAIRETYPE_CATALOG_URL
  };
};

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= FAIRETYPE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FAIRETYPE_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": FAIRETYPE_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Origin: FAIRETYPE_ORIGIN,
          Referer: referer || FAIRETYPE_ORIGIN
        }
      });
      if (!response.ok) {
        lastStatus = response.status;
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FAIRETYPE_FETCH_MAX_RETRIES) {
        await sleep(300 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : `unknown-error${typeof lastStatus === "number" ? ` (status=${lastStatus})` : ""}`;
  throw new Error(`[FaireType] Fetch failed for ${url}: ${message}`);
};

const toAbsoluteUrl = (rawUrl: string, baseUrl: string): string | undefined => {
  const value = normalizeSpace(rawUrl).replace(/^['"]|['"]$/g, "");
  if (!value || value.startsWith("data:")) return undefined;

  try {
    const parsed = value.startsWith("//")
      ? new URL(`https:${value}`)
      : /^https?:\/\//i.test(value)
        ? new URL(value)
        : new URL(value, baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
};

const inferStyle = (seed: string): "Normal" | "Italic" =>
  /italic|oblique|slanted|kursiv/i.test(seed) ? "Italic" : "Normal";

const inferWeight = (seed: string): string | number => {
  const text = normalizeSpace(seed).toLowerCase();
  if (!text) return "Regular";
  if (/variable/.test(text)) return "100 900";

  const numeric = text.match(/\b([1-9]00)\b/);
  if (numeric && numeric[1]) return Number(numeric[1]);
  if (/hairline/.test(text)) return 100;
  if (/thin/.test(text)) return 200;
  if (/extra-?light|ultra-?light/.test(text)) return 200;
  if (/light/.test(text)) return 300;
  if (/regular|book|text|roman/.test(text)) return 400;
  if (/medium/.test(text)) return 500;
  if (/semi-?bold|demi-?bold/.test(text)) return 600;
  if (/extra-?bold|ultra-?bold/.test(text)) return 800;
  if (/bold/.test(text)) return 700;
  if (/black|heavy|super/.test(text)) return 900;

  return "Regular";
};

const splitStyleName = (fullName: string, familyDisplay: string): string => {
  const normalizedFull = normalizeSpace(fullName);
  const normalizedFamily = normalizeSpace(familyDisplay);
  if (!normalizedFull) return "Regular";
  if (!normalizedFamily) return normalizedFull;

  const fullToken = normalizeToken(normalizedFull);
  const familyToken = normalizeToken(normalizedFamily);
  if (fullToken === familyToken) return "Regular";

  const startsWithFamily = normalizeToken(normalizedFull).startsWith(familyToken);
  if (!startsWithFamily) return normalizedFull;

  const escapedFamily = escapeRegExp(normalizedFamily);
  const stripped = normalizeSpace(normalizedFull.replace(new RegExp(`^${escapedFamily}\\s*`, "i"), ""));
  return stripped || "Regular";
};

const extractFamilyDisplay = ($: ReturnType<typeof loadHtml>, html: string, fallbackSlug: string): string => {
  const heading = normalizeSpace($("h1").first().text());
  if (heading) return heading;

  const title = normalizeSpace($("title").first().text());
  if (title) {
    const stripped = title.replace(/\s*-\s*Faire Type Foundry\s*$/i, "").trim();
    if (stripped) return stripped;
  }

  const fallback = fallbackSlug
    .split(/[-_]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
  return fallback || "Faire Type";
};

const extractStyleOptions = (
  $: ReturnType<typeof loadHtml>,
  targetUrl: string,
  familyDisplay: string
): FaireTypeStyleOption[] => {
  const out: FaireTypeStyleOption[] = [];
  const seen = new Set<string>();

  $("#glyph_inspector_type_style option").each((_index, element) => {
    const rawUrl = normalizeSpace(String($(element).attr("value") || ""));
    const absoluteUrl = toAbsoluteUrl(rawUrl, targetUrl);
    if (!absoluteUrl || !/\.otf(?:$|[?#])/i.test(absoluteUrl)) return;

    const fullName = normalizeSpace($(element).text());
    if (!fullName) return;
    const styleName = splitStyleName(fullName, familyDisplay);
    const style = inferStyle(styleName);
    const weight = inferWeight(styleName);
    const expectedStyle = fullName;
    const dedupeKey = `${absoluteUrl.toLowerCase()}::${expectedStyle.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    out.push({
      url: absoluteUrl,
      fullName,
      styleName,
      style,
      weight,
      expectedStyle
    });
  });

  return out;
};

const extractVariableSources = (html: string, slug: string): FaireTypeVariableSource[] => {
  const targetFamilyToken = normalizeToken(`FAIRE-DYNAMIC-${slug}`);
  const faceBlocks = html.match(/@font-face\s*{[^}]*}/gi) || [];
  const out: FaireTypeVariableSource[] = [];
  const seen = new Set<string>();

  const pushSource = (url: string, style: "Normal" | "Italic", styleName: string, weight: string | number) => {
    const dedupeKey = `${url.toLowerCase()}::${style.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({
      url,
      style,
      styleName,
      weight,
      axisNames: []
    });
  };

  for (const block of faceBlocks) {
    const familyRaw = normalizeSpace(block.match(/font-family\s*:\s*['"]?([^;'"}]+)['"]?\s*;?/i)?.[1] || "");
    if (!familyRaw) continue;
    if (normalizeToken(familyRaw) !== targetFamilyToken) continue;

    const styleRaw = normalizeSpace(block.match(/font-style\s*:\s*([^;]+)\s*;?/i)?.[1] || "normal");
    const style: "Normal" | "Italic" = inferStyle(styleRaw) === "Italic" ? "Italic" : "Normal";
    const styleName = style === "Italic" ? "Variable Italic" : "Variable";
    const weight = inferWeight(
      normalizeSpace(block.match(/font-weight\s*:\s*([^;]+)\s*;?/i)?.[1] || "variable")
    );

    for (const match of block.matchAll(/url\(([^)]+)\)/gi)) {
      const absoluteUrl = toAbsoluteUrl(String(match[1] || ""), FAIRETYPE_ORIGIN);
      if (!absoluteUrl || !/\.woff2(?:$|[?#])/i.test(absoluteUrl)) continue;
      pushSource(absoluteUrl, style, styleName, weight);
    }
  }

  return out;
};

const extractFontMetadataHints = (html: string, slug: string): FaireTypeFontMetadataHints => {
  const escapedSlug = escapeRegExp(slug);
  const blockMatch = html.match(
    new RegExp(`window\\.FontMetadata\\['${escapedSlug}'\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`, "i")
  );

  if (!blockMatch || !blockMatch[1]) {
    return {
      supportsItalics: false,
      supportsSlnt: false,
      variableAxes: []
    };
  }

  const body = blockMatch[1];
  const supportsItalics = /supportsItalics\s*:\s*true/i.test(body);
  const supportsSlnt = /supportsSlnt\s*:\s*true/i.test(body);
  const italicStyleProperty = normalizeSpace(body.match(/italicStyleProperty\s*:\s*'([^']+)'/i)?.[1] || "") || undefined;
  const italicStyleValue = normalizeSpace(body.match(/italicStyleValue\s*:\s*'([^']+)'/i)?.[1] || "") || undefined;

  const axisMap = new Map<string, FaireTypeVariableAxis>();
  for (const match of body.matchAll(/axis_name\s*:\s*'([^']+)'\s*,\s*axis_label_name\s*:\s*'([^']+)'/gi)) {
    const axisName = normalizeSpace(String(match[1] || ""));
    if (!axisName) continue;
    const axisLabelName = normalizeSpace(String(match[2] || "")) || undefined;
    axisMap.set(axisName.toLowerCase(), { axisName, axisLabelName });
  }
  for (const match of body.matchAll(/axis_name\s*:\s*'([^']+)'/gi)) {
    const axisName = normalizeSpace(String(match[1] || ""));
    if (!axisName) continue;
    const key = axisName.toLowerCase();
    if (!axisMap.has(key)) axisMap.set(key, { axisName });
  }

  return {
    supportsItalics,
    supportsSlnt,
    italicStyleProperty,
    italicStyleValue,
    variableAxes: Array.from(axisMap.values())
  };
};

const normalizeFeatureTag = (raw: string): string | undefined => {
  const token = normalizeSpace(raw).toLowerCase();
  if (!token) return undefined;
  const match = token.match(/^(ss\d{2}|cv\d{2}|[a-z]{3,5})$/i);
  if (!match || !match[1]) return undefined;
  return match[1].toLowerCase();
};

const extractFeatureTags = ($: ReturnType<typeof loadHtml>, html: string): string[] => {
  const tags = new Set<string>();
  const addFromString = (value: string) => {
    if (!value) return;
    for (const match of value.matchAll(FAIRETYPE_OT_FEATURE_TAG_RE)) {
      const token = normalizeFeatureTag(String(match[1] || ""));
      if (!token) continue;
      tags.add(token);
    }
  };

  $("input, select, option").each((_index, element) => {
    const attrs = [
      String($(element).attr("name") || ""),
      String($(element).attr("id") || ""),
      String($(element).attr("value") || ""),
      String($(element).attr("data-feature") || ""),
      String($(element).attr("data-tag") || ""),
      String($(element).attr("data-opentype-feature") || "")
    ]
      .map((item) => normalizeSpace(item))
      .filter(Boolean)
      .join(" ");
    addFromString(attrs);
  });

  for (const match of html.matchAll(FAIRETYPE_STYLE_FEATURE_RE)) {
    const token = normalizeFeatureTag(String(match[1] || ""));
    if (!token) continue;
    tags.add(token);
  }

  return Array.from(tags.values()).sort();
};

const extractVariableAxesFromRanges = ($: ReturnType<typeof loadHtml>): FaireTypeVariableAxis[] => {
  const axisMap = new Map<string, FaireTypeVariableAxis>();

  $("input[type='range'][data-range], input[type='range'][data-range-variable-feature-id]").each((_index, element) => {
    const rawRange = normalizeSpace(String($(element).attr("data-range") || ""));
    if (!rawRange) return;
    const token = normalizeToken(rawRange.replace(/^--/, ""));
    if (!token) return;

    const mapped = FAIRETYPE_RANGE_AXIS_MAP[token];
    if (!mapped) return;

    const key = mapped.axisName.toLowerCase();
    if (!axisMap.has(key)) {
      axisMap.set(key, { axisName: mapped.axisName, axisLabelName: mapped.axisLabelName });
    }
  });

  return Array.from(axisMap.values());
};

const mergeVariableAxes = (...groups: FaireTypeVariableAxis[][]): FaireTypeVariableAxis[] => {
  const axisMap = new Map<string, FaireTypeVariableAxis>();
  for (const group of groups) {
    for (const axis of group) {
      const axisName = normalizeSpace(axis.axisName || "");
      if (!axisName) continue;
      const key = axisName.toLowerCase();
      const axisLabelName = normalizeSpace(axis.axisLabelName || "") || undefined;
      if (!axisMap.has(key)) {
        axisMap.set(key, { axisName, axisLabelName });
        continue;
      }
      const prev = axisMap.get(key)!;
      if (!prev.axisLabelName && axisLabelName) {
        axisMap.set(key, { ...prev, axisLabelName });
      }
    }
  }
  return Array.from(axisMap.values());
};

const extractGlyphStats = ($: ReturnType<typeof loadHtml>): FaireTypeGlyphStats => {
  let glyphSetCount = 0;
  let glyphTokenCount = 0;

  $(".glyph-inpsector__character-set").each((_index, element) => {
    glyphSetCount += 1;
    const payload = normalizeSpace(String($(element).attr("data-characters") || ""));
    if (!payload) return;
    const tokens = payload.split(/\s+/g).filter(Boolean);
    glyphTokenCount += tokens.length;
  });

  return { glyphSetCount, glyphTokenCount };
};

const extractLanguageCount = ($: ReturnType<typeof loadHtml>): number | undefined => {
  const heading = $("h2, h3, h4")
    .toArray()
    .find((element) => normalizeSpace($(element).text()).toLowerCase() === "supported languages");
  if (!heading) return undefined;

  const wrapper = $(heading).closest(".accordion__expander").parent();
  if (!wrapper || wrapper.length === 0) return undefined;

  const markdownHtml = wrapper.find(".accordion__content .markdown").first().html() || "";
  if (!markdownHtml) return undefined;

  const values = markdownHtml
    .split(/<br\s*\/?>/gi)
    .map((item) => normalizeSpace(item.replace(/<[^>]+>/g, "")))
    .filter(Boolean);

  if (values.length === 0) return undefined;
  return values.length;
};

const extractMetaValue = (html: string, label: string): string | undefined => {
  const escapedLabel = escapeRegExp(label);
  const re = new RegExp(
    `<div[^>]*class=["'][^"']*col-8[^"']*["'][^>]*>\\s*${escapedLabel}\\s*<\\/div>\\s*<div[^>]*class=["'][^"']*col-8[^"']*["'][^>]*>\\s*([^<]+?)\\s*<`,
    "i"
  );
  const match = html.match(re);
  if (!match || !match[1]) return undefined;
  const value = normalizeSpace(match[1]);
  return value || undefined;
};

const extractPdfUrls = (html: string, pageUrl: string): { specimenPdfUrls: string[]; technicalPdfUrls: string[] } => {
  const specimen = new Set<string>();
  const technical = new Set<string>();
  const candidates = html.match(/https?:\/\/[^"'\s<>]+?\.pdf(?:\?[^"'\s<>]*)?|\/[^"'\s<>]+?\.pdf(?:\?[^"'\s<>]*)?/gi) || [];

  for (const candidate of candidates) {
    const absolute = toAbsoluteUrl(candidate, pageUrl);
    if (!absolute) continue;
    if (FAIRETYPE_BLOCKED_PDF_RE.test(absolute)) continue;
    const token = normalizeToken(absolute);
    if (/technical|manual|spec|techdoc|documentation/.test(token)) {
      technical.add(absolute);
    } else {
      specimen.add(absolute);
    }
  }

  return {
    specimenPdfUrls: Array.from(specimen.values()).sort(),
    technicalPdfUrls: Array.from(technical.values()).sort()
  };
};

const inferVariableWeightRange = (axes: FaireTypeVariableAxis[]): string | number => {
  const axisNames = axes.map((axis) => axis.axisName.toLowerCase());
  if (axisNames.includes("wght")) return "100 900";
  return "Variable";
};

const mapLimit = async <T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  if (items.length === 0) return [];
  const output: R[] = new Array(items.length);
  let cursor = 0;

  const run = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, limit)) }, () => run()));
  return output;
};

const dedupeCatalogEntries = (entries: FaireTypeCatalogEntry[]): FaireTypeCatalogEntry[] => {
  const out: FaireTypeCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const slug = normalizeSpace(entry.slug).toLowerCase();
    if (!slug) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      slug,
      title: normalizeSpace(entry.title || "") || undefined
    });
  }
  return out;
};

const extractCatalogFromFontsPage = (html: string): FaireTypeCatalogEntry[] => {
  const $ = loadHtml(html);
  const out: FaireTypeCatalogEntry[] = [];

  $('a[href^="/fonts/"]').each((_index, element) => {
    const href = normalizeSpace(String($(element).attr("href") || ""));
    const slug = normalizeSpace(href.replace(/^\/fonts\//i, "").split(/[?#]/)[0]).toLowerCase();
    if (!slug) return;
    const text = normalizeSpace($(element).text()) || undefined;
    out.push({ slug, title: text });
  });

  for (const match of html.matchAll(/window\.FontMetadata\['([^']+)'\]/gi)) {
    const slug = normalizeSpace(String(match[1] || "")).toLowerCase();
    if (!slug) continue;
    out.push({ slug });
  }

  return dedupeCatalogEntries(out);
};

const extractCatalogFromSitemap = (xml: string): FaireTypeCatalogEntry[] => {
  const out: FaireTypeCatalogEntry[] = [];
  for (const match of xml.matchAll(/<loc>\s*https:\/\/www\.fairetype\.com\/fonts\/([^<\s/]+)\s*<\/loc>/gi)) {
    const slug = normalizeSpace(String(match[1] || "")).toLowerCase();
    if (!slug) continue;
    out.push({ slug });
  }
  return dedupeCatalogEntries(out);
};

const buildFamilyProfile = async (entry: FaireTypeCatalogEntry): Promise<FaireTypeFamilyProfile> => {
  const slug = entry.slug;
  const targetUrl = `${FAIRETYPE_ORIGIN}/fonts/${encodeURIComponent(slug)}`;
  const html = await fetchTextWithRetry(targetUrl, FAIRETYPE_CATALOG_URL);
  const $ = loadHtml(html);

  const familyDisplay = extractFamilyDisplay($, html, slug);
  const styleOptions = extractStyleOptions($, targetUrl, familyDisplay);
  if (styleOptions.length === 0) {
    throw new Error(`[FaireType] ${slug} has no static style options on glyph inspector.`);
  }

  const metadataHints = extractFontMetadataHints(html, slug);
  const sliderAxes = extractVariableAxesFromRanges($);
  const variableAxes = mergeVariableAxes(metadataHints.variableAxes, sliderAxes);
  const variableSources = extractVariableSources(html, slug).map((source) => ({
    ...source,
    axisNames: variableAxes.map((axis) => axis.axisName)
  }));
  const featureTags = extractFeatureTags($, html);
  const ligatureFeatureTags = featureTags.filter((tag) => FAIRETYPE_LIGATURE_TAGS.has(tag));
  const supportsItalics = metadataHints.supportsItalics || styleOptions.some((style) => style.style === "Italic");
  const supportsSlnt = metadataHints.supportsSlnt || variableAxes.some((axis) => axis.axisName.toLowerCase() === "slnt");
  const glyphStats = extractGlyphStats($);
  const languageCount = extractLanguageCount($);
  const release = extractMetaValue(html, "Release");
  const version = extractMetaValue(html, "Version");
  const fileTypes = extractMetaValue(html, "File Types");
  const { specimenPdfUrls, technicalPdfUrls } = extractPdfUrls(html, targetUrl);

  const expectedStyles = dedupeStrings(styleOptions.map((option) => option.expectedStyle));
  const requiredFeatureTags = FAIRETYPE_REQUIRED_FEATURE_CANDIDATES.filter((tag) => featureTags.includes(tag));

  const styleMap = [
    ...styleOptions.map((style) => ({
      expectedStyle: style.expectedStyle,
      familyName: familyDisplay,
      styleName: style.styleName,
      style: style.style,
      weight: style.weight,
      sourceType: "static-otf",
      format: "otf",
      url: style.url
    })),
    ...variableSources.map((source) => ({
      expectedStyle: `${familyDisplay} ${source.styleName}`.trim(),
      familyName: familyDisplay,
      styleName: source.styleName,
      style: source.style,
      weight: source.weight,
      sourceType: "variable-woff2",
      format: "woff2",
      url: source.url,
      axes: source.axisNames
    }))
  ];

  const targetProfile: Record<string, unknown> = {
    profileId: "fairetype-target-profile-v1",
    source: "fairetype-family-html-canonical",
    foundry: "Faire Type",
    family: familyDisplay,
    familyDisplay,
    familySlug: slug,
    targetSlug: slug,
    targetUrl,
    styleScope: "family-style",
    strictMissingStyles: true,
    expectedStyleCount: expectedStyles.length,
    expectedStyles,
    styleMap,
    requiredFeatureTags,
    catalogFeatureTags: featureTags,
    ligatureFeatureTags,
    glyphSetCount: glyphStats.glyphSetCount,
    glyphTokenCount: glyphStats.glyphTokenCount,
    languageCount,
    release,
    version,
    fileTypes,
    specimenPdfUrls,
    technicalPdfUrls,
    variableAxes,
    supportsItalics,
    supportsSlnt,
    italicStyleProperty: metadataHints.italicStyleProperty,
    italicStyleValue: metadataHints.italicStyleValue,
    trialDownload: {
      url: FAIRETYPE_TRIAL_URL,
      gatedByRecaptcha: true
    },
    collectedAt: new Date().toISOString()
  };

  const staticFonts: FontMetadata[] = styleOptions.map((style) => ({
    url: style.url,
    family: familyDisplay,
    format: "otf",
    style: style.style,
    weight: style.weight,
    downloadable: true,
    note: "Faire Type canonical static style source from glyph inspector.",
    metadata: {
      foundry: "Faire Type",
      family: familyDisplay,
      familySlug: slug,
      pageUrl: targetUrl,
      targetUrl,
      styleName: style.styleName,
      fullName: style.fullName,
      expectedStyle: style.expectedStyle,
      format: "otf",
      styleMap,
      forceMetadataRepair: true,
      targetProfile,
      specimenPdfUrls,
      technicalPdfUrls,
      headers: {
        Origin: FAIRETYPE_ORIGIN,
        Referer: targetUrl,
        Accept: "*/*",
        "User-Agent": FAIRETYPE_UA
      }
    }
  }));

  const variableFonts: FontMetadata[] = variableSources.map((source) => ({
    url: source.url,
    family: familyDisplay,
    format: "woff2",
    style: source.style,
    weight: source.weight,
    downloadable: true,
    note: "Faire Type variable webfont source from canonical @font-face.",
    metadata: {
      foundry: "Faire Type",
      family: familyDisplay,
      familySlug: slug,
      pageUrl: targetUrl,
      targetUrl,
      styleName: source.styleName,
      expectedStyle: `${familyDisplay} ${source.styleName}`.trim(),
      format: "woff2",
      axes: source.axisNames,
      skipConversion: false,
      disableInstanceExplosion: true,
      forceMetadataRepair: true,
      styleMap,
      targetProfile,
      specimenPdfUrls,
      technicalPdfUrls,
      headers: {
        Origin: FAIRETYPE_ORIGIN,
        Referer: targetUrl,
        Accept: "font/woff2,*/*;q=0.8",
        "User-Agent": FAIRETYPE_UA
      }
    }
  }));

  if (variableFonts.length > 0) {
    const inferredWeight = inferVariableWeightRange(variableAxes);
    for (const font of variableFonts) {
      font.weight = inferredWeight;
      if (font.metadata && typeof font.metadata === "object") {
        (font.metadata as any).weight = inferredWeight;
      }
    }
  }

  const dedupedFonts = [...staticFonts, ...variableFonts].filter((font, index, list) => {
    const key = `${font.url.toLowerCase()}::${String(font.style || "").toLowerCase()}`;
    return list.findIndex((candidate) => `${candidate.url.toLowerCase()}::${String(candidate.style || "").toLowerCase()}` === key) === index;
  });

  return {
    slug,
    familyDisplay,
    targetUrl,
    fonts: dedupedFonts,
    expectedStyles,
    styleMap,
    featureTags,
    ligatureFeatureTags,
    glyphStats,
    languageCount,
    release,
    version,
    fileTypes,
    specimenPdfUrls,
    technicalPdfUrls,
    variableAxes,
    supportsItalics,
    supportsSlnt
  };
};

export const FaireTypeScraper: Scraper = {
  id: "fairetype",
  name: "Faire Type Precision Scraper",

  canHandle(url: string): boolean {
    return FAIRETYPE_HOST_RE.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = parseScope(url);

    if (scope.mode === "family") {
      const profile = await buildFamilyProfile({ slug: scope.slug });
      const expectedCount = profile.fonts.length;

      return {
        scraperName: this.name,
        foundryName: "Faire Type",
        fonts: profile.fonts,
        originalUrl: url,
        targetUrl: profile.targetUrl,
        expectedCount,
        metadata: {
          source: "fairetype-family-html-canonical",
          mode: "family",
          familySlug: profile.slug,
          familyDisplay: profile.familyDisplay,
          expectedStyles: profile.expectedStyles,
          expectedStyleCount: profile.expectedStyles.length,
          styleMap: profile.styleMap,
          featureTags: profile.featureTags,
          ligatureFeatureTags: profile.ligatureFeatureTags,
          glyphSetCount: profile.glyphStats.glyphSetCount,
          glyphTokenCount: profile.glyphStats.glyphTokenCount,
          languageCount: profile.languageCount,
          release: profile.release,
          version: profile.version,
          fileTypes: profile.fileTypes,
          specimenPdfUrls: profile.specimenPdfUrls,
          technicalPdfUrls: profile.technicalPdfUrls,
          variableAxes: profile.variableAxes,
          supportsItalics: profile.supportsItalics,
          supportsSlnt: profile.supportsSlnt,
          totalFonts: profile.fonts.length,
          collectedAt: new Date().toISOString(),
          targetProfile: profile.fonts[0]?.metadata?.targetProfile
        }
      };
    }

    const catalogHtml = await fetchTextWithRetry(scope.targetUrl, scope.targetUrl);
    const fromCatalog = extractCatalogFromFontsPage(catalogHtml);
    const sitemapXml = await fetchTextWithRetry(FAIRETYPE_SITEMAP_URL, scope.targetUrl).catch(() => "");
    const fromSitemap = sitemapXml ? extractCatalogFromSitemap(sitemapXml) : [];
    const catalogEntries = dedupeCatalogEntries([...fromCatalog, ...fromSitemap]);

    if (catalogEntries.length === 0) {
      throw new Error("[FaireType] Catalog scrape returned 0 family slugs.");
    }

    const settled = await mapLimit(catalogEntries, FAIRETYPE_FAMILY_CONCURRENCY, async (entry) => {
      try {
        const family = await buildFamilyProfile(entry);
        return { ok: true as const, entry, family };
      } catch (error) {
        return {
          ok: false as const,
          entry,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const succeeded = settled.filter((row) => row.ok).map((row) => row.family);
    const failed = settled
      .filter((row) => !row.ok)
      .map((row) => ({
        slug: row.entry.slug,
        title: row.entry.title,
        error: row.error
      }));

    if (succeeded.length === 0) {
      throw new Error("[FaireType] Catalog scrape failed for all families.");
    }

    const fonts = succeeded.flatMap((family) => family.fonts);
    const expectedStyles = dedupeStrings(succeeded.flatMap((family) => family.expectedStyles));
    const specimenPdfUrls = dedupeStrings(succeeded.flatMap((family) => family.specimenPdfUrls));
    const technicalPdfUrls = dedupeStrings(succeeded.flatMap((family) => family.technicalPdfUrls));
    const featureTags = dedupeStrings(succeeded.flatMap((family) => family.featureTags)).map((item) => item.toLowerCase());
    const ligatureFeatureTags = dedupeStrings(succeeded.flatMap((family) => family.ligatureFeatureTags)).map((item) =>
      item.toLowerCase()
    );
    const glyphSetCount = succeeded.reduce((sum, family) => sum + family.glyphStats.glyphSetCount, 0);
    const glyphTokenCount = succeeded.reduce((sum, family) => sum + family.glyphStats.glyphTokenCount, 0);
    const variableAxes = dedupeStrings(
      succeeded.flatMap((family) =>
        family.variableAxes.map((axis) =>
          axis.axisLabelName ? `${axis.axisName}:${axis.axisLabelName}` : axis.axisName
        )
      )
    );
    const languageCountMax = succeeded.reduce((max, family) => {
      const count = typeof family.languageCount === "number" ? family.languageCount : 0;
      return count > max ? count : max;
    }, 0);

    return {
      scraperName: this.name,
      foundryName: "Faire Type",
      fonts,
      originalUrl: url,
      targetUrl: scope.targetUrl,
      expectedCount: fonts.length,
      metadata: {
        source: "fairetype-catalog+family-canonical",
        mode: "catalog",
        catalogFamilyCount: catalogEntries.length,
        scrapedFamilyCount: succeeded.length,
        failedFamilyCount: failed.length,
        expectedStyles,
        expectedStyleCount: expectedStyles.length,
        featureTags,
        ligatureFeatureTags,
        glyphSetCount,
        glyphTokenCount,
        languageCount: languageCountMax > 0 ? languageCountMax : undefined,
        specimenPdfUrls,
        technicalPdfUrls,
        variableAxes,
        families: succeeded.map((family) => ({
          slug: family.slug,
          familyDisplay: family.familyDisplay,
          expectedStyleCount: family.expectedStyles.length,
          downloadableSources: family.fonts.length,
          featureCount: family.featureTags.length,
          glyphTokenCount: family.glyphStats.glyphTokenCount,
          languageCount: family.languageCount
        })),
        failedFamilies: failed,
        totalFonts: fonts.length,
        collectedAt: new Date().toISOString()
      }
    };
  }
};
