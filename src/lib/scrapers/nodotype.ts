import { load as loadHtml } from "cheerio";

import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const NODOTYPE_HOST_RE = /(^|\/\/)(www\.)?nodotypefoundry\.com/i;
const NODOTYPE_ORIGIN = "https://nodotypefoundry.com";
const NODOTYPE_TYPEFACES_URL = `${NODOTYPE_ORIGIN}/typefaces/`;
const NODOTYPE_FETCH_TIMEOUT_MS = 30_000;
const NODOTYPE_FETCH_RETRIES = 3;
const NODOTYPE_CATALOG_CONCURRENCY = 3;
const NODOTYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const NODOTYPE_REQUIRED_FORMATS = ["woff2", "woff", "otf", "ttf"] as const;

const NODOTYPE_GENERIC_SLUGS = new Set(["", "typefaces", "about", "faqs", "custom", "nodo-market", "fonts-in-use"]);

type NodoScope =
  | {
      mode: "family";
      slug: string;
      inputUrl: string;
      targetUrl: string;
    }
  | {
      mode: "catalog";
      inputUrl: string;
      targetUrl: string;
    };

type NodoFontSource = {
  format: "woff2" | "woff" | "otf" | "ttf";
  url: string;
};

type NodoFontFace = {
  familyToken: string;
  weight: string;
  fontStyle: "normal" | "italic";
  sources: NodoFontSource[];
};

type NodoVariant = {
  id?: string;
  price?: string;
  comparePrice?: string | null;
  available?: boolean;
  options?: {
    type?: string;
    users?: string;
  };
};

type NodoProductWrapper = {
  productId?: string;
  title: string;
  isCompleteFamily: boolean;
  styleName?: string;
  variantCount: number;
  variantsByType: Record<string, number>;
  userTiersByType: Record<string, string[]>;
};

type NodoFamilyProfile = {
  slug: string;
  familyDisplay: string;
  targetUrl: string;
  fonts: FontMetadata[];
  expectedStyles: string[];
  styleMap: Array<Record<string, unknown>>;
  sourceLimitedFormats: string[];
  specimenPdfUrls: string[];
  technicalPdfUrls: string[];
  trialUrls: string[];
  releaseYear?: number;
  declaredStyleCount?: number;
  declaredGlyphCount?: number;
  declaredLanguageCoverage?: number;
  productSummaries: Array<Record<string, unknown>>;
  variantGaps: Array<Record<string, unknown>>;
};

type NodoStyleRecord = {
  family: string;
  styleName: string;
  style: "Normal" | "Italic";
  weight: string | number;
  format: "woff2" | "woff" | "ttf" | "otf";
  url: string;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeSpace = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();

const normalizeToken = (value: string): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const dedupeStrings = (values: Array<string | undefined | null>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = normalizeSpace(value);
    if (!text) continue;
    const key = normalizeToken(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const asUrl = (value: string, base: string): string | undefined => {
  try {
    return new URL(value, base).href;
  } catch {
    return undefined;
  }
};

const parseScope = (inputUrl: string): NodoScope => {
  const parsed = /^https?:\/\//i.test(inputUrl) ? new URL(inputUrl) : new URL(`https://${inputUrl}`);
  parsed.protocol = "https:";
  parsed.hostname = "nodotypefoundry.com";
  parsed.hash = "";

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0]?.toLowerCase() === "typefaces") {
    const slug = normalizeSpace(String(parts[1] || "")).toLowerCase();
    if (slug && !NODOTYPE_GENERIC_SLUGS.has(slug)) {
      return {
        mode: "family",
        slug,
        inputUrl,
        targetUrl: `${NODOTYPE_ORIGIN}/typefaces/${encodeURIComponent(slug)}/`
      };
    }
  }

  return {
    mode: "catalog",
    inputUrl,
    targetUrl: NODOTYPE_TYPEFACES_URL
  };
};

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= NODOTYPE_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NODOTYPE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": NODOTYPE_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Origin: NODOTYPE_ORIGIN,
          Referer: referer || NODOTYPE_ORIGIN
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < NODOTYPE_FETCH_RETRIES) {
        await sleep(350 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[NodoType] fetch failed for ${url}: ${message}`);
};

const checkUrlExists = async (url: string, referer: string): Promise<boolean> => {
  const request = async (method: "HEAD" | "GET"): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          "User-Agent": NODOTYPE_UA,
          Accept: "*/*",
          Origin: NODOTYPE_ORIGIN,
          Referer: referer
        }
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const headOk = await request("HEAD");
  if (headOk) return true;
  return request("GET");
};

const guessFormat = (url: string, explicit?: string): "woff2" | "woff" | "ttf" | "otf" | undefined => {
  const token = normalizeSpace(String(explicit || "")).toLowerCase().replace(/['"]/g, "");
  if (token === "woff2" || token === "woff" || token === "ttf" || token === "otf") {
    return token;
  }
  if (/\.woff2(?:$|[?#])/i.test(url)) return "woff2";
  if (/\.woff(?:$|[?#])/i.test(url)) return "woff";
  if (/\.ttf(?:$|[?#])/i.test(url)) return "ttf";
  if (/\.otf(?:$|[?#])/i.test(url)) return "otf";
  return undefined;
};

const parseFontFaces = (html: string, pageUrl: string): NodoFontFace[] => {
  const entries: NodoFontFace[] = [];
  for (const blockMatch of html.matchAll(/@font-face\s*{([^}]*)}/gi)) {
    const block = String(blockMatch[1] || "");
    const familyRaw = normalizeSpace(String(block.match(/font-family\s*:\s*([^;]+);/i)?.[1] || ""))
      .replace(/['"]/g, "");
    const srcRaw = normalizeSpace(String(block.match(/src\s*:\s*([^;]+);/i)?.[1] || ""));
    const weight = normalizeSpace(String(block.match(/font-weight\s*:\s*([^;]+);/i)?.[1] || "400")) || "400";
    const styleRaw = normalizeSpace(String(block.match(/font-style\s*:\s*([^;]+);/i)?.[1] || "normal")).toLowerCase();
    const fontStyle: "normal" | "italic" = /italic|oblique/.test(styleRaw) ? "italic" : "normal";
    if (!familyRaw || !srcRaw) continue;

    const sources: NodoFontSource[] = [];
    for (const srcMatch of srcRaw.matchAll(/url\(([^)]+)\)\s*(?:format\(([^)]+)\))?/gi)) {
      const rawUrl = normalizeSpace(String(srcMatch[1] || "")).replace(/['"]/g, "");
      const absolute = asUrl(rawUrl, pageUrl);
      if (!absolute) continue;
      const format = guessFormat(absolute, srcMatch[2]);
      if (!format) continue;
      sources.push({ format, url: absolute });
    }

    if (sources.length === 0) continue;
    entries.push({
      familyToken: familyRaw,
      weight,
      fontStyle,
      sources
    });
  }

  return entries;
};

const selectFamilyFaces = (faces: NodoFontFace[], slug: string): NodoFontFace[] => {
  const slugToken = normalizeToken(slug);
  const filtered = faces.filter((face) => {
    if (normalizeToken(face.familyToken).includes(slugToken)) return true;
    return face.sources.some((source) => normalizeToken(source.url).includes(slugToken));
  });
  return filtered.length > 0 ? filtered : faces;
};

const toStyleFromWeight = (weight: string): string => {
  const numeric = Number(normalizeSpace(weight));
  if (Number.isFinite(numeric)) {
    if (numeric <= 100) return "Thin";
    if (numeric <= 200) return "Extra Light";
    if (numeric <= 300) return "Light";
    if (numeric <= 400) return "Regular";
    if (numeric <= 500) return "Medium";
    if (numeric <= 600) return "Semi Bold";
    if (numeric <= 700) return "Bold";
    if (numeric <= 800) return "Extra Bold";
    return "Black";
  }
  const token = normalizeSpace(weight).toLowerCase();
  if (/thin/.test(token)) return "Thin";
  if (/extra\s*light|ultra\s*light/.test(token)) return "Extra Light";
  if (/light/.test(token)) return "Light";
  if (/regular|normal|roman/.test(token)) return "Regular";
  if (/medium/.test(token)) return "Medium";
  if (/semi\s*bold|demi\s*bold/.test(token)) return "Semi Bold";
  if (/extra\s*bold|ultra\s*bold/.test(token)) return "Extra Bold";
  if (/bold/.test(token)) return "Bold";
  if (/black|heavy/.test(token)) return "Black";
  return "Regular";
};

const styleNameFromFace = (face: NodoFontFace): string => {
  const base = toStyleFromWeight(face.weight);
  if (face.fontStyle === "italic") return `${base} Italic`;
  return base;
};

const styleLabelFromName = (styleName: string): "Normal" | "Italic" =>
  /italic|oblique/i.test(styleName) ? "Italic" : "Normal";

const toWeightValue = (face: NodoFontFace): string | number => {
  const numeric = Number(normalizeSpace(face.weight));
  if (Number.isFinite(numeric)) return numeric;
  return normalizeSpace(face.weight) || "Regular";
};

const parseVariant = (value: unknown): NodoVariant | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    price: typeof row.price === "string" ? row.price : undefined,
    comparePrice: typeof row.comparePrice === "string" ? row.comparePrice : row.comparePrice === null ? null : undefined,
    available: typeof row.available === "boolean" ? row.available : undefined,
    options:
      row.options && typeof row.options === "object" && !Array.isArray(row.options)
        ? {
            type: typeof (row.options as Record<string, unknown>).type === "string"
              ? String((row.options as Record<string, unknown>).type)
              : undefined,
            users: typeof (row.options as Record<string, unknown>).users === "string"
              ? String((row.options as Record<string, unknown>).users)
              : undefined
          }
        : undefined
  };
};

const parseProductWrappers = (html: string): NodoProductWrapper[] => {
  const $ = loadHtml(html);
  const wrappers: NodoProductWrapper[] = [];

  $("[data-product]").each((_index, element) => {
    const title =
      normalizeSpace(String($(element).find("[data-output='title']").first().text() || "")) ||
      normalizeSpace(String($(element).find("h2,h3,h4").first().text() || ""));
    const productId = normalizeSpace(String($(element).attr("data-product") || "")) || undefined;
    const rawVariants = normalizeSpace(String($(element).find("[data-hidden='variants']").attr("value") || ""));
    const variants = rawVariants
      ? (() => {
          try {
            const parsed = JSON.parse(rawVariants);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((item) => parseVariant(item)).filter((item): item is NodoVariant => Boolean(item));
          } catch {
            return [];
          }
        })()
      : [];

    const typeCounts = new Map<string, number>();
    const typeTierMap = new Map<string, Set<string>>();
    for (const variant of variants) {
      const type = normalizeSpace(String(variant.options?.type || ""));
      const users = normalizeSpace(String(variant.options?.users || ""));
      if (!type) continue;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      if (!typeTierMap.has(type)) typeTierMap.set(type, new Set<string>());
      if (users) typeTierMap.get(type)?.add(users);
    }

    wrappers.push({
      productId,
      title,
      isCompleteFamily: /complete family/i.test(title),
      variantCount: variants.length,
      variantsByType: Object.fromEntries(typeCounts.entries()),
      userTiersByType: Object.fromEntries(
        Array.from(typeTierMap.entries()).map(([type, set]) => [type, Array.from(set.values())])
      )
    });
  });

  return wrappers;
};

const parseFamilyDisplay = (params: { wrappers: NodoProductWrapper[]; html: string; slug: string }): string => {
  const completeTitle = params.wrappers.find((item) => item.isCompleteFamily)?.title;
  if (completeTitle) {
    const stripped = normalizeSpace(completeTitle.replace(/\bcomplete\s+family\b/i, ""));
    if (stripped) return stripped;
  }

  const $ = loadHtml(params.html);
  const heading =
    normalizeSpace($("h1").first().text()) ||
    normalizeSpace($("h2").first().text()) ||
    normalizeSpace($("h3").first().text()) ||
    normalizeSpace($("h4").first().text());
  if (heading) return heading;

  return params.slug
    .split(/[-_]+/g)
    .map((part) => normalizeSpace(part))
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const parseExpectedStyles = (wrappers: NodoProductWrapper[], familyDisplay: string): string[] => {
  const escapedFamily = familyDisplay.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const familyPrefixRe = new RegExp(`^${escapedFamily}\\s+`, "i");
  const styles = wrappers
    .filter((item) => !item.isCompleteFamily)
    .map((item) => normalizeSpace(item.title.replace(familyPrefixRe, "")))
    .filter(Boolean);

  for (const item of wrappers) {
    if (item.isCompleteFamily) continue;
    const styleName = normalizeSpace(item.title.replace(familyPrefixRe, ""));
    if (styleName) item.styleName = styleName;
  }

  return dedupeStrings(styles);
};

const parsePageLinks = (html: string, pageUrl: string): { specimenPdfUrls: string[]; technicalPdfUrls: string[]; trialUrls: string[] } => {
  const $ = loadHtml(html);
  const specimen = new Set<string>();
  const technical = new Set<string>();
  const trial = new Set<string>();

  $("a[href]").each((_index, element) => {
    const href = normalizeSpace(String($(element).attr("href") || ""));
    const text = normalizeSpace($(element).text());
    if (!href) return;
    const absolute = asUrl(href, pageUrl);
    if (!absolute) return;
    const token = `${text} ${absolute}`.toLowerCase();

    if (/\.pdf(?:$|[?#])/i.test(absolute)) {
      if (/\bspecimen\b/.test(token)) specimen.add(absolute);
      else technical.add(absolute);
    }
    if (/\btrial\b/.test(token) || /testbed/i.test(absolute)) {
      trial.add(absolute);
    }
  });

  for (const item of specimen) technical.delete(item);

  return {
    specimenPdfUrls: Array.from(specimen.values()).sort(),
    technicalPdfUrls: Array.from(technical.values()).sort(),
    trialUrls: Array.from(trial.values()).sort()
  };
};

const parsePageStats = (html: string): {
  releaseYear?: number;
  declaredStyleCount?: number;
  declaredGlyphCount?: number;
  declaredLanguageCoverage?: number;
} => {
  const text = normalizeSpace(loadHtml(html).text());
  const releaseYear = Number(text.match(/\brelease\s*(\d{4})\b/i)?.[1] || "");
  const declaredStyleCount = Number(text.match(/\bstyles\s*(\d+)\b/i)?.[1] || "");
  const declaredGlyphCount = Number(text.match(/\bglyphs\s*(\d+)\b/i)?.[1] || "");
  const declaredLanguageCoverage = Number(text.match(/\blanguage coverage\s*(\d+)\b/i)?.[1] || "");

  return {
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : undefined,
    declaredStyleCount: Number.isFinite(declaredStyleCount) ? declaredStyleCount : undefined,
    declaredGlyphCount: Number.isFinite(declaredGlyphCount) ? declaredGlyphCount : undefined,
    declaredLanguageCoverage: Number.isFinite(declaredLanguageCoverage) ? declaredLanguageCoverage : undefined
  };
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

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => run())
  );
  return output;
};

const parseFamilyUrlsFromCatalog = (html: string, baseUrl: string): string[] => {
  const $ = loadHtml(html);
  const urls = new Set<string>();

  $("a[href]").each((_index, element) => {
    const rawHref = normalizeSpace(String($(element).attr("href") || ""));
    if (!rawHref) return;
    const absolute = asUrl(rawHref, baseUrl);
    if (!absolute) return;

    let parsed: URL;
    try {
      parsed = new URL(absolute);
    } catch {
      return;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || parts[0]?.toLowerCase() !== "typefaces") return;
    const slug = normalizeSpace(String(parts[1] || "")).toLowerCase();
    if (!slug || NODOTYPE_GENERIC_SLUGS.has(slug)) return;
    parsed.hash = "";
    parsed.search = "";
    urls.add(parsed.href.endsWith("/") ? parsed.href : `${parsed.href}/`);
  });

  return Array.from(urls.values()).sort();
};

const collectFamilyProfile = async (familyUrl: string): Promise<NodoFamilyProfile> => {
  const html = await fetchTextWithRetry(familyUrl, NODOTYPE_TYPEFACES_URL);
  const parsedFamilyUrl = new URL(familyUrl);
  const parts = parsedFamilyUrl.pathname.split("/").filter(Boolean);
  const slug = normalizeSpace(String(parts[1] || "")).toLowerCase();
  if (!slug) throw new Error(`[NodoType] invalid family slug from ${familyUrl}`);

  const wrappers = parseProductWrappers(html);
  const familyDisplay = parseFamilyDisplay({ wrappers, html, slug });
  const expectedStylesFromWrappers = parseExpectedStyles(wrappers, familyDisplay);
  const links = parsePageLinks(html, familyUrl);
  const stats = parsePageStats(html);

  const allFaces = parseFontFaces(html, familyUrl);
  const faces = selectFamilyFaces(allFaces, slug);
  if (faces.length === 0) {
    throw new Error(`[NodoType] ${slug} returned 0 @font-face blocks.`);
  }

  const expectedStyleTokenSet = new Set(expectedStylesFromWrappers.map((item) => normalizeToken(item)));
  const styleRecordsMap = new Map<string, NodoStyleRecord>();
  const styleRecordOrder: NodoStyleRecord[] = [];

  for (const face of faces) {
    const styleName = styleNameFromFace(face);
    const expectedStyleToken = normalizeToken(styleName);
    if (expectedStyleTokenSet.size > 0 && !expectedStyleTokenSet.has(expectedStyleToken)) {
      continue;
    }

    for (const source of face.sources) {
      if (source.format !== "woff2" && source.format !== "woff") continue;

      const styleRecord: NodoStyleRecord = {
        family: familyDisplay,
        styleName,
        style: styleLabelFromName(styleName),
        weight: toWeightValue(face),
        format: source.format,
        url: source.url
      };
      const key = `${normalizeToken(styleRecord.styleName)}::${styleRecord.format}::${normalizeToken(styleRecord.url)}`;
      if (styleRecordsMap.has(key)) continue;
      styleRecordsMap.set(key, styleRecord);
      styleRecordOrder.push(styleRecord);
    }
  }

  if (styleRecordOrder.length === 0) {
    throw new Error(`[NodoType] ${slug} returned no matching style records from @font-face.`);
  }

  const woff2Only = styleRecordOrder.filter((item) => item.format === "woff2");
  const enrichedWoffRecords = await mapLimit(woff2Only, 4, async (record) => {
    const woffCandidate = record.url.replace(/\.woff2(?=$|[?#])/i, ".woff");
    if (woffCandidate === record.url) return undefined;
    const exists = await checkUrlExists(woffCandidate, familyUrl);
    if (!exists) return undefined;
    return {
      ...record,
      format: "woff" as const,
      url: woffCandidate
    };
  });

  for (const extra of enrichedWoffRecords) {
    if (!extra) continue;
    const key = `${normalizeToken(extra.styleName)}::${extra.format}::${normalizeToken(extra.url)}`;
    if (styleRecordsMap.has(key)) continue;
    styleRecordsMap.set(key, extra);
    styleRecordOrder.push(extra);
  }

  const stylesFromRecords = dedupeStrings(styleRecordOrder.map((item) => item.styleName));
  const expectedStyles = expectedStylesFromWrappers.length > 0 ? expectedStylesFromWrappers : stylesFromRecords;

  const sourceFormats = new Set(styleRecordOrder.map((item) => item.format));
  const sourceLimitedFormats = [
    !sourceFormats.has("woff") ? "woff" : undefined,
    "otf",
    "ttf"
  ].filter((item): item is string => Boolean(item));

  const styleMap = styleRecordOrder.map((record) => ({
    expectedStyle: record.styleName,
    familyName: familyDisplay,
    styleName: record.styleName,
    style: record.style,
    weight: record.weight,
    sourceType: "webfont-static",
    format: record.format,
    url: record.url
  }));

  const variantBaselineByType = wrappers
    .map((item) => item.userTiersByType)
    .reduce<Record<string, string[]>>((acc, tiersByType) => {
      for (const [type, tiers] of Object.entries(tiersByType)) {
        const current = acc[type] || [];
        if (tiers.length > current.length) acc[type] = [...tiers];
      }
      return acc;
    }, {});

  const variantGaps = wrappers
    .filter((item) => !item.isCompleteFamily && item.styleName)
    .map((item) => {
      const missingByType: Record<string, string[]> = {};
      for (const [type, baseline] of Object.entries(variantBaselineByType)) {
        const current = item.userTiersByType[type] || [];
        const missing = baseline.filter((tier) => !current.includes(tier));
        if (missing.length > 0) missingByType[type] = missing;
      }
      return {
        styleName: item.styleName,
        variantCount: item.variantCount,
        missingByType
      };
    })
    .filter((item) => Object.keys(item.missingByType).length > 0);

  const targetProfile: Record<string, unknown> = {
    profileId: "nodotype-target-profile-v1",
    source: "nodotype-html-inline-fontfaces+shopify-variant-json",
    foundry: "Nodo Type Foundry",
    family: familyDisplay,
    familyDisplay,
    familySlug: slug,
    targetUrl: familyUrl,
    styleScope: "family-style",
    strictMissingStyles: true,
    expectedStyles,
    expectedStyleCount: expectedStyles.length,
    styleMap,
    requiredFormats: Array.from(NODOTYPE_REQUIRED_FORMATS),
    sourceLimitedFormats,
    specimenPdfUrls: links.specimenPdfUrls,
    technicalPdfUrls: links.technicalPdfUrls,
    trialUrls: links.trialUrls,
    releaseYear: stats.releaseYear,
    declaredStyleCount: stats.declaredStyleCount,
    declaredGlyphCount: stats.declaredGlyphCount,
    declaredLanguageCoverage: stats.declaredLanguageCoverage,
    variantBaselineByType,
    variantGaps,
    collectedAt: new Date().toISOString()
  };

  const familyToken = normalizeToken(familyDisplay);
  const fonts: FontMetadata[] = styleRecordOrder.map((record) => {
    const styleToken = normalizeToken(record.styleName);
    return {
      url: record.url,
      family: familyDisplay,
      format: record.format,
      style: record.style,
      weight: record.weight,
      downloadable: true,
      note: "Nodo Type public webfont source from family page @font-face declarations.",
      metadata: {
        foundry: "Nodo Type Foundry",
        family: familyDisplay,
        familySlug: slug,
        styleName: record.styleName,
        expectedStyle: record.styleName,
        fullName: `${familyDisplay} ${record.styleName}`.trim(),
        pageUrl: familyUrl,
        targetUrl: familyUrl,
        format: record.format,
        fileNameHint: familyToken && styleToken ? `${familyToken}-${styleToken}.${record.format}` : undefined,
        specimenPdfUrls: links.specimenPdfUrls,
        technicalPdfUrls: links.technicalPdfUrls,
        trialUrls: links.trialUrls,
        releaseYear: stats.releaseYear,
        declaredStyleCount: stats.declaredStyleCount,
        declaredGlyphCount: stats.declaredGlyphCount,
        declaredLanguageCoverage: stats.declaredLanguageCoverage,
        targetProfile,
        sourceLimitedFormats,
        forceMetadataRepair: true,
        headers: {
          Origin: NODOTYPE_ORIGIN,
          Referer: familyUrl,
          Accept: record.format === "woff2" ? "font/woff2,*/*;q=0.8" : "*/*",
          "User-Agent": NODOTYPE_UA
        }
      }
    };
  });

  return {
    slug,
    familyDisplay,
    targetUrl: familyUrl,
    fonts,
    expectedStyles,
    styleMap,
    sourceLimitedFormats,
    specimenPdfUrls: links.specimenPdfUrls,
    technicalPdfUrls: links.technicalPdfUrls,
    trialUrls: links.trialUrls,
    releaseYear: stats.releaseYear,
    declaredStyleCount: stats.declaredStyleCount,
    declaredGlyphCount: stats.declaredGlyphCount,
    declaredLanguageCoverage: stats.declaredLanguageCoverage,
    productSummaries: wrappers.map((item) => ({
      productId: item.productId,
      title: item.title,
      isCompleteFamily: item.isCompleteFamily,
      styleName: item.styleName,
      variantCount: item.variantCount,
      variantsByType: item.variantsByType
    })),
    variantGaps
  };
};

export const NodoTypeScraper: Scraper = {
  id: "nodotypefoundry",
  name: "Nodo Type Precision Scraper",

  canHandle(url: string): boolean {
    return NODOTYPE_HOST_RE.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = parseScope(url);

    if (scope.mode === "family") {
      const profile = await collectFamilyProfile(scope.targetUrl);
      return {
        scraperName: this.name,
        foundryName: "Nodo Type Foundry",
        fonts: profile.fonts,
        originalUrl: url,
        targetUrl: profile.targetUrl,
        expectedCount: profile.expectedStyles.length > 0 ? profile.expectedStyles.length : profile.fonts.length,
        metadata: {
          source: "nodotype-family-page",
          mode: "family",
          familySlug: profile.slug,
          familyDisplay: profile.familyDisplay,
          expectedStyles: profile.expectedStyles,
          expectedStyleCount: profile.expectedStyles.length,
          styleMap: profile.styleMap,
          sourceLimitedFormats: profile.sourceLimitedFormats,
          specimenPdfUrls: profile.specimenPdfUrls,
          technicalPdfUrls: profile.technicalPdfUrls,
          trialUrls: profile.trialUrls,
          releaseYear: profile.releaseYear,
          declaredStyleCount: profile.declaredStyleCount,
          declaredGlyphCount: profile.declaredGlyphCount,
          declaredLanguageCoverage: profile.declaredLanguageCoverage,
          productSummaries: profile.productSummaries,
          variantGaps: profile.variantGaps,
          totalFonts: profile.fonts.length,
          collectedAt: new Date().toISOString(),
          targetProfile: profile.fonts[0]?.metadata?.targetProfile
        }
      };
    }

    const catalogHtml = await fetchTextWithRetry(scope.targetUrl, scope.targetUrl);
    const familyUrls = parseFamilyUrlsFromCatalog(catalogHtml, scope.targetUrl);
    if (familyUrls.length === 0) {
      throw new Error("[NodoType] catalog returned 0 family URLs.");
    }

    const settled = await mapLimit(familyUrls, NODOTYPE_CATALOG_CONCURRENCY, async (familyUrl) => {
      try {
        const family = await collectFamilyProfile(familyUrl);
        return { ok: true as const, family };
      } catch (error) {
        return {
          ok: false as const,
          familyUrl,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const succeeded = settled.filter((item) => item.ok).map((item) => item.family);
    const failed = settled
      .filter((item) => !item.ok)
      .map((item) => ({ familyUrl: item.familyUrl, error: item.error }));

    if (succeeded.length === 0) {
      throw new Error("[NodoType] catalog failed for all families.");
    }

    const fonts = succeeded.flatMap((item) => item.fonts);
    const expectedStyles = dedupeStrings(succeeded.flatMap((item) => item.expectedStyles));
    const sourceLimitedFormats = dedupeStrings(succeeded.flatMap((item) => item.sourceLimitedFormats));
    const specimenPdfUrls = dedupeStrings(succeeded.flatMap((item) => item.specimenPdfUrls));
    const technicalPdfUrls = dedupeStrings(succeeded.flatMap((item) => item.technicalPdfUrls));
    const trialUrls = dedupeStrings(succeeded.flatMap((item) => item.trialUrls));

    return {
      scraperName: this.name,
      foundryName: "Nodo Type Foundry",
      fonts,
      originalUrl: url,
      targetUrl: NODOTYPE_TYPEFACES_URL,
      expectedCount: expectedStyles.length > 0 ? expectedStyles.length : fonts.length,
      metadata: {
        source: "nodotype-catalog+family-pages",
        mode: "catalog",
        catalogFamilyCount: familyUrls.length,
        scrapedFamilyCount: succeeded.length,
        failedFamilyCount: failed.length,
        expectedStyleCount: expectedStyles.length,
        expectedStyles,
        sourceLimitedFormats,
        specimenPdfUrls,
        technicalPdfUrls,
        trialUrls,
        families: succeeded.map((item) => ({
          slug: item.slug,
          familyDisplay: item.familyDisplay,
          expectedStyleCount: item.expectedStyles.length,
          downloadableSources: item.fonts.length
        })),
        failedFamilies: failed,
        totalFonts: fonts.length,
        collectedAt: new Date().toISOString()
      }
    };
  }
};

