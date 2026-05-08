import { load as loadHtml } from "cheerio";

import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const OPTIMO_HOST_RE = /(^|\/\/)(www\.)?optimo\.ch/i;
const OPTIMO_ORIGIN = "https://optimo.ch";
const OPTIMO_TYPEFACES_URL = `${OPTIMO_ORIGIN}/typefaces`;
const OPTIMO_ALL_STYLES_URL = `${OPTIMO_ORIGIN}/all_styles`;
const OPTIMO_FETCH_TIMEOUT_MS = 30_000;
const OPTIMO_FETCH_RETRIES = 3;
const OPTIMO_CATALOG_CONCURRENCY = 3;
const OPTIMO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const OPTIMO_LIGATURE_TAGS = new Set(["liga", "dlig", "clig", "hlig", "rlig", "calt", "ccmp"]);
const OPTIMO_REQUIRED_FEATURE_CANDIDATES = ["liga", "calt", "dlig", "frac", "ordn", "zero"];
const OPTIMO_REQUIRED_FORMATS = ["woff2", "woff", "otf", "ttf"] as const;

const OPTIMO_GENERIC_SLUGS = new Set([
  "",
  "typefaces",
  "type_it",
  "custom",
  "articles",
  "faq",
  "specifications",
  "eula",
  "terms_of_service",
  "privacy_policy",
  "designers",
  "about_optimo",
  "about",
  "contact",
  "sign_in"
]);

type OptimoScope =
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

type OptimoTypeItStyleOption = {
  id?: string | number;
  cached_full_name?: string;
};

type OptimoAxisTuple = [number, number, number, string];

type OptimoStyleRecord = {
  id: string | number;
  idToken: string;
  name: string;
  slug: string;
  weight: number | string;
  fontStyle: string;
  familyName: string;
  collectionId?: number;
  collectionYear?: number;
  collectionPublished?: boolean;
  variable: boolean;
  axes: OptimoAxisTuple[];
};

type OptimoAllStylesPayload = {
  styles?: unknown;
  characters?: unknown;
  otf_features?: unknown;
};

type OptimoAllStylesDataset = {
  records: OptimoStyleRecord[];
  featureTagsById: Map<string, string[]>;
  glyphCountById: Map<string, number>;
};

type OptimoFamilyProfile = {
  slug: string;
  familyDisplay: string;
  targetUrl: string;
  fonts: FontMetadata[];
  expectedStyles: string[];
  styleMap: Array<Record<string, unknown>>;
  featureTags: string[];
  ligatureFeatureTags: string[];
  specimenPdfUrls: string[];
  technicalPdfUrls: string[];
  sourceLimitedStyles: string[];
  collectionId?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeSpace = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();

const normalizeToken = (value: string): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const toTitleFromSlug = (slug: string): string =>
  slug
    .split(/[-_]+/g)
    .map((part) => normalizeSpace(part))
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

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

const safeJsonParse = <T>(raw: unknown): T | undefined => {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
};

const parseScope = (inputUrl: string): OptimoScope => {
  const parsed = /^https?:\/\//i.test(inputUrl) ? new URL(inputUrl) : new URL(`https://${inputUrl}`);
  parsed.protocol = "https:";
  parsed.hostname = "optimo.ch";
  parsed.hash = "";

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0]?.toLowerCase() === "typefaces") {
    const slug = normalizeSpace(segments[1]).toLowerCase();
    if (slug && !OPTIMO_GENERIC_SLUGS.has(slug)) {
      return {
        mode: "family",
        slug,
        inputUrl,
        targetUrl: `${OPTIMO_ORIGIN}/typefaces/${encodeURIComponent(slug)}`
      };
    }
  }

  return {
    mode: "catalog",
    inputUrl,
    targetUrl: OPTIMO_TYPEFACES_URL
  };
};

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OPTIMO_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPTIMO_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": OPTIMO_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Origin: OPTIMO_ORIGIN,
          Referer: referer || OPTIMO_ORIGIN
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < OPTIMO_FETCH_RETRIES) await sleep(350 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[Optimo] fetch failed for ${url}: ${message}`);
};

const fetchAllStylesPayload = async (referer: string): Promise<OptimoAllStylesPayload> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OPTIMO_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPTIMO_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(OPTIMO_ALL_STYLES_URL, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": OPTIMO_UA,
          Accept: "application/json,text/plain,*/*",
          "X-Requested-With": "XMLHttpRequest",
          Origin: OPTIMO_ORIGIN,
          Referer: referer
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as OptimoAllStylesPayload;
    } catch (error) {
      lastError = error;
      if (attempt < OPTIMO_FETCH_RETRIES) await sleep(350 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[Optimo] all_styles failed: ${message}`);
};

const parseCollectionIdFromValue = (value: unknown): number | undefined => {
  const text = normalizeSpace(String(value || ""));
  if (!text) return undefined;
  const fromPrefix = text.match(/(?:collection|family|package)_(\d+)/i);
  if (fromPrefix?.[1]) {
    const num = Number(fromPrefix[1]);
    return Number.isFinite(num) ? num : undefined;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
};

const parseTypeItStyleOptions = (rawDataStyles: string): OptimoTypeItStyleOption[] => {
  const parsed = safeJsonParse<unknown[]>(rawDataStyles);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is OptimoTypeItStyleOption => isRecord(item));
};

const extractFeatureTags = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  const out = new Set<string>();
  for (const match of value.matchAll(/\b(ss\d{2}|cv\d{2}|[a-z0-9]{4})\b/gi)) {
    const token = normalizeSpace(String(match[1] || "")).toLowerCase();
    if (!token) continue;
    out.add(token);
  }
  return Array.from(out.values());
};

const toStyleRecord = (row: unknown): OptimoStyleRecord | undefined => {
  if (!Array.isArray(row) || row.length < 6) return undefined;
  const id = row[0] as string | number;
  const name = normalizeSpace(String(row[1] || ""));
  const slug = normalizeSpace(String(row[2] || ""));
  const weightRaw = row[3];
  const fontStyle = normalizeSpace(String(row[4] || "normal")) || "normal";
  const familyName = normalizeSpace(String(row[5] || ""));
  if (!name || !familyName) return undefined;

  const weight =
    typeof weightRaw === "number" && Number.isFinite(weightRaw)
      ? weightRaw
      : normalizeSpace(String(weightRaw || "")) || "Regular";
  const collectionIdRaw = Number(row[6]);
  const collectionYearRaw = Number(row[7]);
  const variable = Boolean(row[9]);

  const axesRaw = Array.isArray(row[10]) ? row[10] : [];
  const axes = axesRaw
    .map((axis): OptimoAxisTuple | undefined => {
      if (!Array.isArray(axis) || axis.length < 4) return undefined;
      const idNum = Number(axis[0]);
      const minNum = Number(axis[1]);
      const maxNum = Number(axis[2]);
      const tag = normalizeSpace(String(axis[3] || "")).toLowerCase();
      if (!Number.isFinite(idNum) || !Number.isFinite(minNum) || !Number.isFinite(maxNum) || !tag) return undefined;
      return [idNum, minNum, maxNum, tag];
    })
    .filter((axis): axis is OptimoAxisTuple => Boolean(axis));

  return {
    id,
    idToken: normalizeSpace(String(id)),
    name,
    slug,
    weight,
    fontStyle,
    familyName,
    collectionId: Number.isFinite(collectionIdRaw) ? collectionIdRaw : undefined,
    collectionYear: Number.isFinite(collectionYearRaw) ? collectionYearRaw : undefined,
    collectionPublished: typeof row[8] === "boolean" ? row[8] : undefined,
    variable,
    axes
  };
};

const parseAllStylesDataset = (payload: OptimoAllStylesPayload): OptimoAllStylesDataset => {
  const styleRows = Array.isArray(payload.styles)
    ? payload.styles
    : safeJsonParse<unknown[]>(payload.styles) || [];
  const records = styleRows.map((row) => toStyleRecord(row)).filter((row): row is OptimoStyleRecord => Boolean(row));

  const rawCharacters = isRecord(payload.characters)
    ? payload.characters
    : safeJsonParse<Record<string, unknown>>(payload.characters) || {};
  const glyphCountById = new Map<string, number>();
  for (const [key, value] of Object.entries(rawCharacters)) {
    const styleId = normalizeSpace(key);
    if (!styleId) continue;
    if (Array.isArray(value)) {
      glyphCountById.set(styleId, value.length);
      continue;
    }
    if (isRecord(value)) {
      glyphCountById.set(styleId, Object.keys(value).length);
    }
  }

  const rawFeatures = isRecord(payload.otf_features)
    ? payload.otf_features
    : safeJsonParse<Record<string, unknown>>(payload.otf_features) || {};
  const featureTagsById = new Map<string, string[]>();
  for (const [key, value] of Object.entries(rawFeatures)) {
    const styleId = normalizeSpace(key);
    if (!styleId || !isRecord(value)) continue;
    const tags = new Set<string>();
    for (const featureEntry of Object.values(value)) {
      if (isRecord(featureEntry)) {
        const rawValue = normalizeSpace(String(featureEntry.value || ""));
        for (const token of extractFeatureTags(rawValue)) tags.add(token);
      } else if (typeof featureEntry === "string") {
        for (const token of extractFeatureTags(featureEntry)) tags.add(token);
      }
    }
    featureTagsById.set(styleId, Array.from(tags.values()).sort());
  }

  return { records, featureTagsById, glyphCountById };
};

const isStaticStyleRecord = (record: OptimoStyleRecord): boolean => {
  const idText = record.idToken.toLowerCase();
  if (/^(collection|family|package)_/.test(idText)) return false;
  if (record.variable && /variable/i.test(record.name)) return false;
  return true;
};

const inferStyleLabel = (record: OptimoStyleRecord): "Normal" | "Italic" => {
  const token = normalizeSpace(`${record.fontStyle} ${record.name}`).toLowerCase();
  return /italic|oblique|slanted/.test(token) ? "Italic" : "Normal";
};

const inferWeight = (record: OptimoStyleRecord): string | number => {
  const axis = record.axes.find((item) => item[3] === "wght");
  if (axis && Number.isFinite(axis[1]) && Number.isFinite(axis[2]) && axis[2] >= axis[1]) {
    if (axis[1] === axis[2]) return String(axis[1]);
    return `${axis[1]} ${axis[2]}`;
  }
  return record.weight;
};

const resolveStyleName = (record: OptimoStyleRecord): string => {
  const family = normalizeSpace(record.familyName);
  const full = normalizeSpace(record.name);
  if (family && full.toLowerCase().startsWith(family.toLowerCase())) {
    const tail = normalizeSpace(full.slice(family.length));
    if (tail) return tail;
  }
  return full;
};

const buildWebfontUrl = (record: OptimoStyleRecord, format: "woff2"): string => {
  const familySegment = normalizeSpace(record.familyName).replace(/\s+/g, "-");
  const styleSegment = normalizeSpace(record.name).replace(/\s+/g, "-");
  return `${OPTIMO_ORIGIN}/webfonts/${familySegment}/${styleSegment}.${format}`;
};

const extractPdfUrls = (html: string, targetUrl: string): { specimenPdfUrls: string[]; technicalPdfUrls: string[] } => {
  const $ = loadHtml(html);
  const specimen = new Set<string>();
  const technical = new Set<string>();

  $("a[href]").each((_index, element) => {
    const hrefRaw = normalizeSpace(String($(element).attr("href") || ""));
    if (!hrefRaw || !/\.pdf(?:$|[?#])/i.test(hrefRaw)) return;
    let absolute: string;
    try {
      absolute = new URL(hrefRaw, targetUrl).href;
    } catch {
      return;
    }
    const token = `${absolute} ${normalizeSpace($(element).text())}`.toLowerCase();
    if (/\bspecimen\b/.test(token)) {
      specimen.add(absolute);
    } else {
      technical.add(absolute);
    }
  });

  for (const url of Array.from(specimen.values())) {
    technical.delete(url);
  }

  return {
    specimenPdfUrls: Array.from(specimen.values()).sort(),
    technicalPdfUrls: Array.from(technical.values()).sort()
  };
};

const inferFamilyDisplay = (slug: string, headingText: string, selected: OptimoStyleRecord[]): string => {
  const heading = normalizeSpace(headingText).replace(/\s+collection$/i, "").trim();
  if (heading) return heading;
  const familyRoots = dedupeStrings(selected.map((record) => record.familyName.split(/\s+/)[0]));
  if (familyRoots.length === 1) return familyRoots[0];
  return toTitleFromSlug(slug);
};

const selectRowsForFamily = (params: {
  slug: string;
  styleOptions: OptimoTypeItStyleOption[];
  records: OptimoStyleRecord[];
}): { selectedRows: OptimoStyleRecord[]; collectionId?: number } => {
  const { slug, styleOptions, records } = params;
  const idSet = new Set<string>();
  const collectionIds = new Set<number>();

  for (const option of styleOptions) {
    if (option.id === undefined || option.id === null) continue;
    const token = normalizeSpace(String(option.id));
    if (!token) continue;
    idSet.add(token);
    const collectionId = parseCollectionIdFromValue(option.id);
    if (typeof collectionId === "number") collectionIds.add(collectionId);
  }

  if (idSet.size > 0) {
    const selectedRows = records.filter((record) => idSet.has(record.idToken));
    if (selectedRows.length > 0) {
      const firstCollection = collectionIds.values().next().value;
      return { selectedRows, collectionId: typeof firstCollection === "number" ? firstCollection : undefined };
    }
  }

  if (collectionIds.size > 0) {
    const byCollection = records.filter((record) => {
      if (typeof record.collectionId !== "number") return false;
      return collectionIds.has(record.collectionId);
    });
    if (byCollection.length > 0) {
      const firstCollection = collectionIds.values().next().value;
      return { selectedRows: byCollection, collectionId: typeof firstCollection === "number" ? firstCollection : undefined };
    }
  }

  const slugToken = normalizeToken(slug);
  const bySlug = records.filter((record) => {
    const seed = `${record.name} ${record.slug} ${record.familyName}`;
    return normalizeToken(seed).includes(slugToken);
  });
  if (bySlug.length > 0) {
    const collectionId = bySlug.find((record) => typeof record.collectionId === "number")?.collectionId;
    return { selectedRows: bySlug, collectionId };
  }

  return { selectedRows: [], collectionId: undefined };
};

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
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

const collectFamilyProfile = async (params: {
  slug: string;
  allStyles: OptimoAllStylesDataset;
}): Promise<OptimoFamilyProfile> => {
  const { slug, allStyles } = params;
  const targetUrl = `${OPTIMO_ORIGIN}/typefaces/${encodeURIComponent(slug)}`;
  const html = await fetchTextWithRetry(targetUrl, OPTIMO_TYPEFACES_URL);
  const $ = loadHtml(html);

  const headingText =
    normalizeSpace($("h1").first().text()) ||
    normalizeSpace($("h2").first().text()) ||
    normalizeSpace($("title").first().text());
  const typeItNode = $("#type_it_content").first();
  const styleOptions = parseTypeItStyleOptions(normalizeSpace(typeItNode.attr("data-styles") || ""));
  const selection = selectRowsForFamily({ slug, styleOptions, records: allStyles.records });

  if (selection.selectedRows.length === 0) {
    throw new Error(`[Optimo] ${slug} returned 0 style rows from all_styles.`);
  }

  const staticRows = selection.selectedRows.filter((record) => isStaticStyleRecord(record));
  const expectedStyles = dedupeStrings(
    (staticRows.length > 0 ? staticRows : selection.selectedRows).map((record) => record.name)
  );
  const sourceLimitedStyles = dedupeStrings(
    selection.selectedRows
      .filter((record) => !isStaticStyleRecord(record))
      .map((record) => record.name)
  );

  const featureTagSet = new Set<string>();
  const ligatureTagSet = new Set<string>();
  let glyphCount = 0;

  for (const record of selection.selectedRows) {
    const styleId = record.idToken;
    const featureTags = allStyles.featureTagsById.get(styleId) || [];
    for (const tag of featureTags) {
      featureTagSet.add(tag);
      if (OPTIMO_LIGATURE_TAGS.has(tag)) ligatureTagSet.add(tag);
    }
    const count = allStyles.glyphCountById.get(styleId) || 0;
    if (count > glyphCount) glyphCount = count;
  }

  const featureTags = Array.from(featureTagSet.values()).sort();
  const ligatureFeatureTags = Array.from(ligatureTagSet.values()).sort();
  const requiredFeatureTags = OPTIMO_REQUIRED_FEATURE_CANDIDATES.filter((tag) => featureTagSet.has(tag));

  const { specimenPdfUrls, technicalPdfUrls } = extractPdfUrls(html, targetUrl);
  const familyDisplay = inferFamilyDisplay(slug, headingText, selection.selectedRows);

  const styleMap = selection.selectedRows.map((record) => ({
    expectedStyle: record.name,
    familyName: record.familyName,
    styleName: resolveStyleName(record),
    style: inferStyleLabel(record),
    weight: inferWeight(record),
    sourceType: isStaticStyleRecord(record) ? "webfont-static" : "webfont-variable",
    format: "woff2",
    url: buildWebfontUrl(record, "woff2"),
    collectionId: record.collectionId,
    collectionYear: record.collectionYear,
    collectionPublished: record.collectionPublished,
    variable: record.variable,
    axes: record.axes
  }));

  const targetProfile: Record<string, unknown> = {
    profileId: "optimo-target-profile-v1",
    source: "optimo-all_styles+type_it_content",
    foundry: "Optimo",
    family: familyDisplay,
    familyDisplay,
    familySlug: slug,
    targetSlug: slug,
    targetUrl,
    collectionId: selection.collectionId,
    styleScope: "family-style",
    strictMissingStyles: true,
    failOnTrialAssets: false,
    expectedStyleCount: expectedStyles.length,
    expectedStyles,
    sourceLimitedStyles,
    styleMap,
    requiredFeatureTags,
    catalogFeatureTags: featureTags,
    ligatureFeatureTags,
    minCmapEntries: 320,
    minFeatureCount: 16,
    requiredFormats: Array.from(OPTIMO_REQUIRED_FORMATS),
    sourceLimitedFormats: ["otf"],
    glyphCount,
    specimenPdfUrls,
    technicalPdfUrls,
    catalogStylesCount: styleOptions.length,
    collectedAt: new Date().toISOString()
  };

  const dedupeFontSet = new Set<string>();
  const fonts: FontMetadata[] = [];
  for (const record of selection.selectedRows) {
    const sourceUrl = buildWebfontUrl(record, "woff2");
    const style = inferStyleLabel(record);
    const styleName = resolveStyleName(record);
    const weight = inferWeight(record);
    const key = `${sourceUrl.toLowerCase()}::${record.name.toLowerCase()}`;
    if (dedupeFontSet.has(key)) continue;
    dedupeFontSet.add(key);

    const familyToken = normalizeToken(record.familyName);
    const styleToken = normalizeToken(styleName) || normalizeToken(record.name);
    const fileNameHint =
      familyToken && styleToken
        ? `${familyToken}-${styleToken}.woff2`
        : undefined;

    fonts.push({
      url: sourceUrl,
      family: record.familyName,
      format: "woff2",
      style,
      weight,
      downloadable: true,
      note: isStaticStyleRecord(record)
        ? "Optimo static webfont source from canonical all_styles dataset."
        : "Optimo variable/package webfont source from canonical all_styles dataset.",
      metadata: {
        foundry: "Optimo",
        family: record.familyName,
        familyDisplay,
        familySlug: slug,
        pageUrl: targetUrl,
        targetUrl,
        styleName,
        fullName: record.name,
        expectedStyle: record.name,
        format: "woff2",
        fileNameHint,
        collectionId: record.collectionId,
        collectionYear: record.collectionYear,
        collectionPublished: record.collectionPublished,
        variable: record.variable,
        axes: record.axes,
        forceMetadataRepair: true,
        disableInstanceExplosion: !isStaticStyleRecord(record),
        targetProfile,
        specimenPdfUrls,
        technicalPdfUrls,
        headers: {
          Origin: OPTIMO_ORIGIN,
          Referer: targetUrl,
          Accept: "font/woff2,*/*;q=0.8",
          "User-Agent": OPTIMO_UA
        }
      }
    });
  }

  if (fonts.length === 0) {
    throw new Error(`[Optimo] ${slug} produced 0 downloadable fonts.`);
  }

  return {
    slug,
    familyDisplay,
    targetUrl,
    fonts,
    expectedStyles,
    styleMap,
    featureTags,
    ligatureFeatureTags,
    specimenPdfUrls,
    technicalPdfUrls,
    sourceLimitedStyles,
    collectionId: selection.collectionId
  };
};

const extractCatalogSlugs = (html: string): string[] => {
  const $ = loadHtml(html);
  const slugs = new Set<string>();

  $("a[href]").each((_index, element) => {
    const hrefRaw = normalizeSpace(String($(element).attr("href") || ""));
    if (!hrefRaw) return;
    let parsed: URL;
    try {
      parsed = new URL(hrefRaw, OPTIMO_TYPEFACES_URL);
    } catch {
      return;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || parts[0]?.toLowerCase() !== "typefaces") return;
    const slug = normalizeSpace(parts[1]).toLowerCase();
    if (!slug || OPTIMO_GENERIC_SLUGS.has(slug)) return;
    slugs.add(slug);
  });

  return Array.from(slugs.values()).sort();
};

export const OptimoScraper: Scraper = {
  id: "optimo",
  name: "Optimo Precision Scraper",

  canHandle(url: string): boolean {
    return OPTIMO_HOST_RE.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = parseScope(url);
    const allStylesPayload = await fetchAllStylesPayload(scope.targetUrl);
    const allStyles = parseAllStylesDataset(allStylesPayload);

    if (scope.mode === "family") {
      const family = await collectFamilyProfile({ slug: scope.slug, allStyles });
      return {
        scraperName: this.name,
        foundryName: "Optimo",
        fonts: family.fonts,
        originalUrl: url,
        targetUrl: family.targetUrl,
        expectedCount: family.expectedStyles.length,
        metadata: {
          source: "optimo-family-all_styles",
          mode: "family",
          familySlug: family.slug,
          familyDisplay: family.familyDisplay,
          expectedStyles: family.expectedStyles,
          expectedStyleCount: family.expectedStyles.length,
          styleMap: family.styleMap,
          sourceLimitedStyles: family.sourceLimitedStyles,
          featureTags: family.featureTags,
          ligatureFeatureTags: family.ligatureFeatureTags,
          specimenPdfUrls: family.specimenPdfUrls,
          technicalPdfUrls: family.technicalPdfUrls,
          collectionId: family.collectionId,
          totalFonts: family.fonts.length,
          collectedAt: new Date().toISOString(),
          targetProfile: family.fonts[0]?.metadata?.targetProfile
        }
      };
    }

    const catalogHtml = await fetchTextWithRetry(scope.targetUrl, scope.targetUrl);
    const slugs = extractCatalogSlugs(catalogHtml);
    if (slugs.length === 0) {
      throw new Error("[Optimo] catalog mode returned 0 family slugs.");
    }

    const settled = await mapLimit(slugs, OPTIMO_CATALOG_CONCURRENCY, async (slug) => {
      try {
        const family = await collectFamilyProfile({ slug, allStyles });
        return { ok: true as const, slug, family };
      } catch (error) {
        return {
          ok: false as const,
          slug,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const succeeded = settled.filter((row) => row.ok).map((row) => row.family);
    const failed = settled.filter((row) => !row.ok).map((row) => ({ slug: row.slug, error: row.error }));
    if (succeeded.length === 0) {
      throw new Error("[Optimo] catalog mode failed for all families.");
    }

    const fonts = succeeded.flatMap((family) => family.fonts);
    const expectedStyles = dedupeStrings(succeeded.flatMap((family) => family.expectedStyles));
    const specimenPdfUrls = dedupeStrings(succeeded.flatMap((family) => family.specimenPdfUrls));
    const technicalPdfUrls = dedupeStrings(succeeded.flatMap((family) => family.technicalPdfUrls));

    return {
      scraperName: this.name,
      foundryName: "Optimo",
      fonts,
      originalUrl: url,
      targetUrl: OPTIMO_TYPEFACES_URL,
      expectedCount: expectedStyles.length > 0 ? expectedStyles.length : fonts.length,
      metadata: {
        source: "optimo-catalog-all_styles+typefaces",
        mode: "catalog",
        catalogFamilyCount: slugs.length,
        scrapedFamilyCount: succeeded.length,
        failedFamilyCount: failed.length,
        expectedStyleCount: expectedStyles.length,
        expectedStyles,
        specimenPdfUrls,
        technicalPdfUrls,
        families: succeeded.map((family) => ({
          slug: family.slug,
          familyDisplay: family.familyDisplay,
          expectedStyleCount: family.expectedStyles.length,
          downloadableSources: family.fonts.length,
          collectionId: family.collectionId
        })),
        failedFamilies: failed,
        totalFonts: fonts.length,
        collectedAt: new Date().toISOString()
      }
    };
  }
};
