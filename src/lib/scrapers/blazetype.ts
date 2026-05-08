import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const BLAZETYPE_HOST_RE = /(^|\/\/)(www\.)?blazetype\.eu/i;
const BLAZETYPE_ORIGIN = "https://blazetype.eu";
const BLAZETYPE_TRIALS_URL = `${BLAZETYPE_ORIGIN}/trials/`;
const BLAZETYPE_TIMEOUT_MS = 30_000;
const BLAZETYPE_FETCH_RETRIES = 3;
const BLAZETYPE_CONCURRENCY = 6;
const BLAZETYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const BLAZETYPE_BLOCKED_PDF_RE = /\b(eula|license|licen[cs]e|terms|legals?|privacy|cookie|policy|refund)\b/i;

type BlazeScope =
  | {
      mode: "family";
      slug: string;
      targetUrl: string;
    }
  | {
      mode: "catalog";
      targetUrl: string;
    };

type BlazeCatalogItem = {
  slug: string;
  title: string;
  fontfaceCSS: string;
  stylesCount?: number;
  cssFontFamily?: string;
};

type BlazeVariant = {
  id?: string;
  familyName?: string;
  styleName?: string;
  fontFamily?: string;
  cssFontFamily?: string;
  fontWeight?: number | string;
  fontStyle?: string;
  fontVariationSettings?: string;
  metrics?: Record<string, unknown>;
  fileUrl?: string;
};

type BlazeSourceAsset = {
  url: string;
  format: FontMetadata["format"];
  style: "Normal" | "Italic";
  weight: string;
  styleName: string;
  expectedStyles: string[];
  variantCount: number;
  isVariable: boolean;
  from: "glyph-variants";
};

type BlazeFamilyProfile = {
  slug: string;
  familyDisplay: string;
  targetUrl: string;
  fonts: FontMetadata[];
  expectedStyles: string[];
  styleMap: Array<Record<string, unknown>>;
  specimenPdfUrls: string[];
  technicalPdfUrls: string[];
  catalogSize: number;
  catalogItem?: BlazeCatalogItem;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const titleCaseFromSlug = (slug: string): string =>
  slug
    .split(/[-_]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x2f;/gi, "/");

const dedupeStrings = (values: Array<string | undefined | null>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = normalizeSpace(value);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }

  return out;
};

const toAbsoluteUrl = (value: string, baseUrl: string): string | undefined => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;

  try {
    const parsed = raw.startsWith("//")
      ? new URL(`https:${raw}`)
      : /^https?:\/\//i.test(raw)
        ? new URL(raw)
        : new URL(raw, baseUrl);

    if (!/^https?:$/i.test(parsed.protocol)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
};

const inferFormat = (url: string): FontMetadata["format"] => {
  const lower = url.toLowerCase();
  if (/\.woff2(?:$|[?#])/i.test(lower)) return "woff2";
  if (/\.woff(?:$|[?#])/i.test(lower)) return "woff";
  if (/\.otf(?:$|[?#])/i.test(lower)) return "otf";
  if (/\.ttf(?:$|[?#])/i.test(lower)) return "ttf";
  return "woff2";
};

const normalizeInputUrl = (input: string): URL => {
  try {
    return new URL(input);
  } catch {
    const prefixed = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    return new URL(prefixed);
  }
};

const normalizeBlazeTypeUrl = (url: string): string => {
  const parsed = normalizeInputUrl(url);
  parsed.protocol = "https:";
  parsed.hostname = "blazetype.eu";
  parsed.hash = "";
  return parsed.href;
};

const parseScope = (inputUrl: string): BlazeScope => {
  const normalized = normalizeBlazeTypeUrl(inputUrl);
  const parsed = new URL(normalized);
  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());

  if (segments[0] === "typefaces" && segments[1]) {
    const slug = segments[1].replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "-");
    if (slug) {
      return {
        mode: "family",
        slug,
        targetUrl: `${BLAZETYPE_ORIGIN}/typefaces/${slug}/`
      };
    }
  }

  return {
    mode: "catalog",
    targetUrl: BLAZETYPE_TRIALS_URL
  };
};

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= BLAZETYPE_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BLAZETYPE_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": BLAZETYPE_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Origin: BLAZETYPE_ORIGIN,
          Referer: referer || BLAZETYPE_ORIGIN
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < BLAZETYPE_FETCH_RETRIES) {
        await sleep(350 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Blaze Type fetch failed for ${url}`);
};

const extractScriptJsonById = <T>(html: string, scriptId: string): T | undefined => {
  const escapedId = scriptId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<script[^>]*id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const match = html.match(re);
  if (!match || !match[1]) return undefined;

  const raw = match[1].trim();
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const extractCatalogFromTrialsProps = (html: string): BlazeCatalogItem[] => {
  const decoded = decodeHtmlEntities(html);
  const re =
    /"id":\[0,"typefaces\/([^"]+)"\],"title":\[0,"([^"]+)"\][\s\S]*?"fontfaceCSS":\[0,"(\/fonts\/[^"]+\/fontface\.css)"\](?:[\s\S]*?"stylesCount":\[0,(\d+)\])?/gi;
  const out: BlazeCatalogItem[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = re.exec(decoded))) {
    const slug = normalizeSpace(match[1] || "").toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const title = normalizeSpace(decodeHtmlEntities(match[2] || "")) || titleCaseFromSlug(slug);
    const fontfaceCSS = normalizeSpace(match[3] || "") || `/fonts/${slug}/fontface.css`;
    const stylesCountRaw = Number(match[4]);
    const stylesCount = Number.isFinite(stylesCountRaw) && stylesCountRaw > 0 ? Math.floor(stylesCountRaw) : undefined;

    out.push({
      slug,
      title,
      fontfaceCSS,
      stylesCount
    });
  }

  return out;
};

const extractCatalogFromTrialsFallback = (html: string): BlazeCatalogItem[] => {
  const slugOrder = new Set<string>();
  const slugRegex = /\/fonts\/([a-z0-9-]+)\/fontface\.css/gi;
  let slugMatch: RegExpExecArray | null;
  while ((slugMatch = slugRegex.exec(html))) {
    const slug = normalizeSpace(slugMatch[1] || "").toLowerCase();
    if (slug) slugOrder.add(slug);
  }

  const labels = Array.from(
    html.matchAll(/<span\s+class=["'][^"']*trials-selector__row-label[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)
  )
    .map((match) => decodeHtmlEntities((match[1] || "").replace(/<[^>]*>/g, "")).trim())
    .filter(Boolean);

  const slugs = Array.from(slugOrder);
  return slugs.map((slug, index) => ({
    slug,
    title: labels[index] || titleCaseFromSlug(slug),
    fontfaceCSS: `/fonts/${slug}/fontface.css`
  }));
};

const extractCatalogFromTrials = (html: string): BlazeCatalogItem[] => {
  const fromProps = extractCatalogFromTrialsProps(html);
  if (fromProps.length > 0) return fromProps;
  return extractCatalogFromTrialsFallback(html);
};

const extractPdfUrls = (html: string, pageUrl: string): { specimenPdfUrls: string[]; technicalPdfUrls: string[] } => {
  const specimen = new Set<string>();
  const technical = new Set<string>();
  const candidates = html.match(/https?:\/\/[^"'\s<>]+?\.pdf(?:\?[^"'\s<>]*)?|\/[^"'\s<>]+?\.pdf(?:\?[^"'\s<>]*)?/gi) || [];

  for (const candidate of candidates) {
    const absolute = toAbsoluteUrl(candidate, pageUrl);
    if (!absolute) continue;
    if (BLAZETYPE_BLOCKED_PDF_RE.test(absolute)) continue;

    const token = normalizeToken(absolute);
    if (/technical|manual|spec|techdoc|documentation/.test(token)) {
      technical.add(absolute);
    } else {
      specimen.add(absolute);
    }
  }

  return {
    specimenPdfUrls: Array.from(specimen),
    technicalPdfUrls: Array.from(technical)
  };
};

const isItalicVariant = (variant: BlazeVariant): boolean => {
  const styleName = normalizeToken(variant.styleName || "");
  const fontStyle = normalizeToken(variant.fontStyle || "");
  const settings = String(variant.fontVariationSettings || "").toLowerCase();

  if (/(italic|oblique|slant|kursiv)/.test(styleName)) return true;
  if (/(italic|oblique)/.test(fontStyle)) return true;
  if (/["']slnt["']\s*-\d/.test(settings)) return true;
  if (/["']ital["']\s*1/.test(settings)) return true;
  return false;
};

const normalizeStyleLabel = (variant: BlazeVariant): string => {
  const styleName = normalizeSpace(variant.styleName || "");
  if (styleName) return styleName;
  if (isItalicVariant(variant)) return "Regular Italic";
  return "Regular";
};

const resolveVariantFamilyName = (variant: BlazeVariant, fallbackFamily: string): string =>
  normalizeSpace(variant.familyName || variant.fontFamily || variant.cssFontFamily || fallbackFamily);

const resolveExpectedStyleLabel = (variant: BlazeVariant, fallbackFamily: string): string => {
  const familyName = resolveVariantFamilyName(variant, fallbackFamily);
  const styleName = normalizeStyleLabel(variant);
  return normalizeSpace(`${familyName} ${styleName}`);
};

const normalizeWeightRange = (variants: BlazeVariant[]): string => {
  const numericWeights = variants
    .map((variant) => {
      const value = Number(variant.fontWeight);
      return Number.isFinite(value) ? Math.floor(value) : undefined;
    })
    .filter((value): value is number => typeof value === "number");

  if (numericWeights.length === 0) return "Regular";
  const min = Math.min(...numericWeights);
  const max = Math.max(...numericWeights);
  if (min === max) return String(min);
  return `${min} ${max}`;
};

const buildStyleMap = (variants: BlazeVariant[], fallbackFamily: string): Array<Record<string, unknown>> => {
  const byStyle = new Map<string, BlazeVariant[]>();

  for (const variant of variants) {
    const styleName = resolveExpectedStyleLabel(variant, fallbackFamily);
    const token = normalizeToken(styleName);
    const bucket = byStyle.get(token);
    if (bucket) {
      bucket.push(variant);
    } else {
      byStyle.set(token, [variant]);
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const list of byStyle.values()) {
    const styleName = resolveExpectedStyleLabel(list[0], fallbackFamily);
    const familyName = resolveVariantFamilyName(list[0], fallbackFamily);
    rows.push({
      styleName,
      expectedStyle: styleName,
      familyName,
      rawStyleName: normalizeStyleLabel(list[0]),
      style: list.every((variant) => isItalicVariant(variant)) ? "Italic" : "Normal",
      weight: normalizeWeightRange(list),
      fontVariationSettings:
        typeof list[0]?.fontVariationSettings === "string" ? list[0].fontVariationSettings : undefined
    });
  }

  return rows;
};

const collectVariantAssets = (params: {
  slug: string;
  familyDisplay: string;
  targetUrl: string;
  variants: BlazeVariant[];
  styleMap: Array<Record<string, unknown>>;
  expectedStyles: string[];
  catalogItem?: BlazeCatalogItem;
  catalogSize: number;
  specimenPdfUrls: string[];
  technicalPdfUrls: string[];
}): FontMetadata[] => {
  const { slug, familyDisplay, targetUrl, variants, styleMap, expectedStyles, catalogItem, catalogSize, specimenPdfUrls, technicalPdfUrls } = params;
  const byUrl = new Map<string, BlazeVariant[]>();

  for (const variant of variants) {
    const absoluteUrl = toAbsoluteUrl(String(variant.fileUrl || ""), targetUrl);
    if (!absoluteUrl) continue;
    const bucket = byUrl.get(absoluteUrl);
    if (bucket) {
      bucket.push(variant);
    } else {
      byUrl.set(absoluteUrl, [variant]);
    }
  }

  const targetProfile: Record<string, unknown> = {
    profileId: "blazetype-target-profile-family-v1",
    source: "blazetype-family-page-glyph-variants-json",
    foundry: "Blaze Type",
    family: familyDisplay,
    familyDisplay,
    familySlug: slug,
    targetSlug: slug,
    targetUrl,
    styleScope: "family-style",
    strictMissingStyles: true,
    failOnTrialAssets: false,
    expectedStyleCount: expectedStyles.length,
    expectedStyles,
    styleMap,
    requiredFeatureTags: [],
    specimenPdfUrls,
    technicalPdfUrls,
    catalogStylesCount: catalogItem?.stylesCount,
    collectionFamilyCount: catalogSize,
    collectedAt: new Date().toISOString()
  };

  const fonts: FontMetadata[] = [];
  for (const [assetUrl, list] of byUrl.entries()) {
    const format = inferFormat(assetUrl);
    const styleNameList = dedupeStrings(list.map((item) => normalizeStyleLabel(item)));
    const expectedStyleList = dedupeStrings(list.map((item) => resolveExpectedStyleLabel(item, familyDisplay)));
    const styleName = styleNameList.length === 1 ? styleNameList[0] : "Variable";
    const allItalic = list.length > 0 && list.every((item) => isItalicVariant(item));
    const allNormal = list.every((item) => !isItalicVariant(item));
    const style: "Normal" | "Italic" = allItalic && !allNormal ? "Italic" : "Normal";
    const weight = normalizeWeightRange(list);
    const isVariable = expectedStyleList.length > 1 || /\d+\s+\d+/.test(weight);

    fonts.push({
      url: assetUrl,
      family: familyDisplay,
      format,
      style,
      weight,
      downloadable: true,
      note: "Blaze Type direct font source from glyph variants data.",
      metadata: {
        foundry: "Blaze Type",
        family: familyDisplay,
        familySlug: slug,
        pageUrl: targetUrl,
        targetUrl,
        format,
        styleName,
        expectedStyles: expectedStyleList,
        expectedStyleCount: expectedStyleList.length,
        styleMap,
        catalogStylesCount: catalogItem?.stylesCount,
        cssFontFamily: catalogItem?.cssFontFamily,
        variantCount: list.length,
        isVariable,
        forceMetadataRepair: true,
        targetProfile,
        specimenPdfUrls,
        technicalPdfUrls,
        headers: {
          Origin: BLAZETYPE_ORIGIN,
          Referer: targetUrl,
          Accept: "*/*",
          "User-Agent": BLAZETYPE_UA
        }
      }
    });
  }

  return fonts;
};

const collectFamilyProfile = async (params: {
  slug: string;
  catalogHint?: BlazeCatalogItem;
}): Promise<BlazeFamilyProfile> => {
  const { slug, catalogHint } = params;
  const targetUrl = `${BLAZETYPE_ORIGIN}/typefaces/${slug}/`;

  const html = await fetchTextWithRetry(targetUrl, BLAZETYPE_TRIALS_URL);
  const variants =
    extractScriptJsonById<BlazeVariant[]>(html, "glyph-variants-data")?.filter(
      (item) => item && typeof item === "object" && typeof item.fileUrl === "string" && item.fileUrl.trim().length > 0
    ) || [];

  if (variants.length === 0) {
    throw new Error(`Blaze Type family ${slug} has no glyph-variants-data.`);
  }

  const modalCatalog = extractScriptJsonById<BlazeCatalogItem[]>(html, "modal-fonts-data") || [];
  const catalogItem = modalCatalog.find((item) => normalizeToken(item?.slug || "") === normalizeToken(slug)) || catalogHint;
  const familyDisplay = normalizeSpace(
    catalogItem?.title ||
      variants[0]?.familyName ||
      variants[0]?.fontFamily ||
      titleCaseFromSlug(slug)
  );

  const expectedStyles = dedupeStrings(variants.map((variant) => resolveExpectedStyleLabel(variant, familyDisplay)));
  const styleMap = buildStyleMap(variants, familyDisplay);
  const { specimenPdfUrls, technicalPdfUrls } = extractPdfUrls(html, targetUrl);
  const fonts = collectVariantAssets({
    slug,
    familyDisplay,
    targetUrl,
    variants,
    styleMap,
    expectedStyles,
    catalogItem,
    catalogSize: modalCatalog.length || 0,
    specimenPdfUrls,
    technicalPdfUrls
  });

  if (fonts.length === 0) {
    throw new Error(`Blaze Type family ${slug} has 0 downloadable variant assets.`);
  }

  return {
    slug,
    familyDisplay,
    targetUrl,
    fonts,
    expectedStyles,
    styleMap,
    specimenPdfUrls,
    technicalPdfUrls,
    catalogSize: modalCatalog.length || 0,
    catalogItem
  };
};

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];
  const output: R[] = new Array(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => runWorker()));
  return output;
};

export const BlazeTypeScraper: Scraper = {
  id: "blazetype",
  name: "Blaze Type Deep Catalog Scraper",

  canHandle(url: string): boolean {
    return BLAZETYPE_HOST_RE.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = parseScope(url);

    if (scope.mode === "family") {
      const family = await collectFamilyProfile({ slug: scope.slug });
      const targetProfile = family.fonts[0]?.metadata?.targetProfile;

      return {
        scraperName: this.name,
        foundryName: "Blaze Type",
        fonts: family.fonts,
        originalUrl: url,
        targetUrl: family.targetUrl,
        expectedCount: family.expectedStyles.length,
        metadata: {
          source: "blazetype-family-page",
          mode: "family",
          familySlug: family.slug,
          familyDisplay: family.familyDisplay,
          expectedStyleCount: family.expectedStyles.length,
          expectedStyles: family.expectedStyles,
          styleMap: family.styleMap,
          specimenPdfUrls: family.specimenPdfUrls,
          technicalPdfUrls: family.technicalPdfUrls,
          targetProfile
        }
      };
    }

    const trialsHtml = await fetchTextWithRetry(BLAZETYPE_TRIALS_URL, BLAZETYPE_TRIALS_URL);
    const catalog = extractCatalogFromTrials(trialsHtml);
    if (catalog.length === 0) {
      throw new Error("Blaze Type catalog is empty on /trials.");
    }

    const settled = await mapLimit(catalog, BLAZETYPE_CONCURRENCY, async (item) => {
      try {
        const family = await collectFamilyProfile({ slug: item.slug, catalogHint: item });
        return { ok: true as const, item, family };
      } catch (error) {
        return {
          ok: false as const,
          item,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const succeeded = settled.filter((row) => row.ok).map((row) => row.family);
    const failed = settled
      .filter((row) => !row.ok)
      .map((row) => ({
        slug: row.item.slug,
        title: row.item.title,
        error: row.error
      }));

    if (succeeded.length === 0) {
      throw new Error("Blaze Type catalog scrape failed for all families.");
    }

    const fonts = succeeded.flatMap((family) => family.fonts);
    const allExpectedStyles = dedupeStrings(succeeded.flatMap((family) => family.expectedStyles));
    const allSpecimenPdfUrls = dedupeStrings(succeeded.flatMap((family) => family.specimenPdfUrls));
    const allTechnicalPdfUrls = dedupeStrings(succeeded.flatMap((family) => family.technicalPdfUrls));

    return {
      scraperName: this.name,
      foundryName: "Blaze Type",
      fonts,
      originalUrl: url,
      targetUrl: BLAZETYPE_TRIALS_URL,
      expectedCount: fonts.length,
      metadata: {
        source: "blazetype-trials-catalog+family-pages",
        mode: "catalog",
        catalogFamilyCount: catalog.length,
        scrapedFamilyCount: succeeded.length,
        failedFamilyCount: failed.length,
        totalFonts: fonts.length,
        expectedStyles: allExpectedStyles,
        specimenPdfUrls: allSpecimenPdfUrls,
        technicalPdfUrls: allTechnicalPdfUrls,
        families: succeeded.map((family) => ({
          slug: family.slug,
          familyDisplay: family.familyDisplay,
          expectedStyleCount: family.expectedStyles.length,
          downloadableSources: family.fonts.length,
          catalogStylesCount: family.catalogItem?.stylesCount
        })),
        failedFamilies: failed
      }
    };
  }
};
