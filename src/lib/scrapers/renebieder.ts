import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const RENEBIEDER_HOST_RE = /(^|\/\/)(www\.|store\.)?renebieder\.com/i;
const RENEBIEDER_MARKETING_ORIGIN = "https://www.renebieder.com";
const RENEBIEDER_GRAPHQL = "https://store.renebieder.com/graphql";
const RENEBIEDER_FETCH_TIMEOUT_MS = 30_000;
const RENEBIEDER_FETCH_MAX_RETRIES = 3;
const RENEBIEDER_FETCH_CONCURRENCY = 4;
const RENEBIEDER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const RENEBIEDER_LIGATURE_TAGS = new Set(["liga", "dlig", "clig", "hlig", "rlig", "calt", "ccmp"]);
const RENEBIEDER_REQUIRED_FEATURE_CANDIDATES = ["liga", "calt", "dlig", "ccmp"];
const RENEBIEDER_MIN_CMAP_ENTRIES = 380;
const RENEBIEDER_MIN_FEATURE_COUNT = 16;

const RENEBIEDER_ROOTS_QUERY = `query ReneBiederRootCollections { viewer { fontCollections(onlyRoots: true, first: 200, excludeTags: []) { edges { node { id name slug { name } collectionType totalStyles isVariableFont children(collectionTypes: [FAMILY]) { id name slug { name } collectionType totalStyles isVariableFont } } } } } }`;
const RENEBIEDER_SLUG_QUERY = `query ReneBiederSlugLookup($name: String!) { viewer { slug(name: $name) { name fontCollection { id name slug { name } collectionType totalStyles isVariableFont children(collectionTypes: [FAMILY]) { id name slug { name } collectionType totalStyles isVariableFont } } } } }`;
const RENEBIEDER_COLLECTION_QUERY = `query ReneBiederCollectionById($id: ID!) { node(id: $id) { __typename ... on FontCollection { id name slug { name } collectionType totalStyles isVariableFont cssUrl updatedAt designYear pdfs { name url thumbnailUrl } featureStyle { name cssFamily verticalMetrics { unitsPerEm ascender descender xHeight capHeight lineGap } glyphNames { name feature features } } glyphGroups { name characterSets { features } } fontStyles { id name cssFamily cssStyle cssWeight cssStretch supportedLanguages variableAxes { axis name minValue maxValue } variableInstances { name coordinates { axis value } } fontFeatures { supportedFeatures stylisticSetNames { featureName humanName } } webfontSources { format url } family { id name cssUrl } } } } }`;

type GraphQlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type ReneSlugCollection = {
  id?: string | null;
  name?: string | null;
  slug?: { name?: string | null } | null;
  collectionType?: string | null;
  totalStyles?: number | null;
  isVariableFont?: boolean | null;
  children?: ReneSlugCollection[] | null;
};

type ReneSlugPayload = {
  viewer?: {
    slug?: {
      name?: string | null;
      fontCollection?: ReneSlugCollection | null;
    } | null;
  } | null;
};

type ReneRootsPayload = {
  viewer?: {
    fontCollections?: {
      edges?: Array<{ node?: ReneSlugCollection | null } | null> | null;
    } | null;
  } | null;
};

type ReneWebfontSource = {
  format?: string | null;
  url?: string | null;
};

type ReneStylisticSetName = {
  featureName?: string | null;
  humanName?: string | null;
};

type ReneFontFeatures = {
  supportedFeatures?: string[] | null;
  stylisticSetNames?: ReneStylisticSetName[] | null;
};

type ReneVariableAxis = {
  axis?: string | null;
  name?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
};

type ReneVariableCoordinate = {
  axis?: string | null;
  value?: number | null;
};

type ReneVariableInstance = {
  name?: string | null;
  coordinates?: ReneVariableCoordinate[] | null;
};

type ReneFontStyle = {
  id?: string | null;
  name?: string | null;
  cssFamily?: string | null;
  cssStyle?: string | null;
  cssWeight?: string | null;
  cssStretch?: string | null;
  supportedLanguages?: string[] | null;
  variableAxes?: ReneVariableAxis[] | null;
  variableInstances?: ReneVariableInstance[] | null;
  fontFeatures?: ReneFontFeatures | null;
  webfontSources?: ReneWebfontSource[] | null;
  family?: {
    id?: string | null;
    name?: string | null;
    cssUrl?: string | null;
  } | null;
};

type ReneGlyphName = {
  name?: string | null;
  feature?: string | null;
  features?: string[] | null;
};

type ReneCharacterSet = {
  features?: string[] | null;
};

type ReneGlyphGroup = {
  name?: string | null;
  characterSets?: ReneCharacterSet[] | null;
};

type ReneVerticalMetrics = {
  unitsPerEm?: number | null;
  ascender?: number | null;
  descender?: number | null;
  xHeight?: number | null;
  capHeight?: number | null;
  lineGap?: number | null;
};

type ReneCollectionNode = {
  __typename?: string | null;
  id?: string | null;
  name?: string | null;
  slug?: { name?: string | null } | null;
  collectionType?: string | null;
  totalStyles?: number | null;
  isVariableFont?: boolean | null;
  cssUrl?: string | null;
  updatedAt?: string | null;
  designYear?: number | null;
  pdfs?: Array<{ name?: string | null; url?: string | null; thumbnailUrl?: string | null } | null> | null;
  featureStyle?: {
    name?: string | null;
    cssFamily?: string | null;
    verticalMetrics?: ReneVerticalMetrics | null;
    glyphNames?: ReneGlyphName[] | null;
  } | null;
  glyphGroups?: ReneGlyphGroup[] | null;
  fontStyles?: ReneFontStyle[] | null;
};

type ReneCollectionPayload = {
  node?: ReneCollectionNode | null;
};

type ReneScope = {
  inputUrl: string;
  targetUrl: string;
  mode: "family" | "catalog";
  slug?: string;
};

type ReneCollectionSummary = {
  id: string;
  name: string;
  slug?: string;
  collectionType: string;
  totalStyles?: number;
  isVariableFont: boolean;
  children: ReneCollectionSummary[];
};

type ReneResolvedCollection = {
  id: string;
  name: string;
  slug?: string;
  collectionType: string;
  totalStyles?: number;
  isVariableFont: boolean;
  cssUrl?: string;
  updatedAt?: string;
  designYear?: number;
  pdfUrls: string[];
  featureTags: string[];
  ligatureTags: string[];
  glyphCount?: number;
  verticalMetrics?: ReneVerticalMetrics;
  fontStyles: ReneFontStyle[];
};

type ReneStyleMapEntry = {
  expectedStyle: string;
  familyName: string;
  styleName: string;
  style: "Normal" | "Italic";
  weight: string | number;
  sourceType: "webfont-static";
  collectionId: string;
  collectionSlug?: string;
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

const normalizeHttpsUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === "renebieder.com") {
    parsed.hostname = "www.renebieder.com";
  }
  return parsed.href;
};

const extractSlugFromUrl = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0]?.toLowerCase() === "fonts") {
      const slug = normalizeSpace(String(parts[1] || ""));
      return slug || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const resolveScope = (rawUrl: string): ReneScope => {
  const normalized = normalizeHttpsUrl(rawUrl);
  const slug = extractSlugFromUrl(normalized);
  if (slug) {
    return {
      inputUrl: rawUrl,
      targetUrl: `${RENEBIEDER_MARKETING_ORIGIN}/fonts/${encodeURIComponent(slug)}`,
      mode: "family",
      slug
    };
  }
  return {
    inputUrl: rawUrl,
    targetUrl: `${RENEBIEDER_MARKETING_ORIGIN}/fonts`,
    mode: "catalog"
  };
};

const asCollectionSummary = (value: ReneSlugCollection | null | undefined): ReneCollectionSummary | undefined => {
  const id = normalizeSpace(String(value?.id || ""));
  const name = normalizeSpace(String(value?.name || ""));
  if (!id || !name) return undefined;

  const slug = normalizeSpace(String(value?.slug?.name || "")) || undefined;
  const collectionType = normalizeSpace(String(value?.collectionType || "family")).toLowerCase();
  const totalStylesRaw = Number(value?.totalStyles);
  const totalStyles = Number.isFinite(totalStylesRaw) ? totalStylesRaw : undefined;
  const children = Array.isArray(value?.children)
    ? value.children.map((item) => asCollectionSummary(item)).filter((item): item is ReneCollectionSummary => Boolean(item))
    : [];

  return {
    id,
    name,
    slug,
    collectionType,
    totalStyles,
    isVariableFont: Boolean(value?.isVariableFont),
    children
  };
};

const toLeafSummaries = (root: ReneCollectionSummary): ReneCollectionSummary[] => {
  if (root.children.length === 0) return [root];
  if (root.collectionType === "family") return [root];
  return root.children;
};

const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
};

const mapLimit = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  if (items.length === 0) return [];
  const output: R[] = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return output;
};

const fetchGraphQlWithRetry = async <T>(params: {
  queryName: string;
  query: string;
  variables: Record<string, unknown>;
  referer: string;
}): Promise<T> => {
  const { queryName, query, variables, referer } = params;
  let lastError: unknown;

  for (let attempt = 1; attempt <= RENEBIEDER_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RENEBIEDER_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(`${RENEBIEDER_GRAPHQL}?queryName=${encodeURIComponent(queryName)}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": RENEBIEDER_UA,
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: RENEBIEDER_MARKETING_ORIGIN,
          Referer: referer
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as GraphQlEnvelope<T>;
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        const message = payload.errors.map((item) => item?.message || "graphql-error").join(" | ");
        throw new Error(message);
      }
      if (!payload.data) {
        throw new Error("GraphQL empty data payload");
      }
      return payload.data;
    } catch (error) {
      lastError = error;
      if (attempt < RENEBIEDER_FETCH_MAX_RETRIES) {
        await sleep(450 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[ReneBieder] GraphQL ${queryName} failed: ${message}`);
};

const resolveCollectionTargetUrl = (scopeTargetUrl: string, slug?: string): string =>
  slug ? `${RENEBIEDER_MARKETING_ORIGIN}/fonts/${encodeURIComponent(slug)}` : scopeTargetUrl;

const collectFeatureTags = (node: ReneCollectionNode): { featureTags: string[]; ligatureTags: string[] } => {
  const tags = new Set<string>();
  const addTag = (value: unknown) => {
    if (typeof value !== "string") return;
    const token = normalizeSpace(value).toLowerCase();
    if (!token) return;
    tags.add(token);
  };

  for (const group of Array.isArray(node.glyphGroups) ? node.glyphGroups : []) {
    for (const set of Array.isArray(group?.characterSets) ? group.characterSets : []) {
      for (const feature of Array.isArray(set?.features) ? set.features : []) {
        addTag(feature);
      }
    }
  }

  for (const glyphName of Array.isArray(node.featureStyle?.glyphNames) ? node.featureStyle?.glyphNames : []) {
    addTag(glyphName?.feature);
    for (const feature of Array.isArray(glyphName?.features) ? glyphName.features : []) {
      addTag(feature);
    }
  }

  for (const style of Array.isArray(node.fontStyles) ? node.fontStyles : []) {
    for (const feature of Array.isArray(style?.fontFeatures?.supportedFeatures) ? style.fontFeatures?.supportedFeatures : []) {
      addTag(feature);
    }
  }

  const featureTags = Array.from(tags).sort();
  const ligatureTags = featureTags.filter((tag) => RENEBIEDER_LIGATURE_TAGS.has(tag));
  return { featureTags, ligatureTags };
};

const guessFormat = (formatToken: string | undefined, sourceUrl: string): "woff2" | "woff" | "ttf" | "otf" | undefined => {
  const token = normalizeSpace(String(formatToken || "")).toLowerCase();
  if (token === "woff2" || token === "woff" || token === "ttf" || token === "otf") {
    return token;
  }
  if (/\.woff2(?:$|[?#])/i.test(sourceUrl)) return "woff2";
  if (/\.woff(?:$|[?#])/i.test(sourceUrl)) return "woff";
  if (/\.ttf(?:$|[?#])/i.test(sourceUrl)) return "ttf";
  if (/\.otf(?:$|[?#])/i.test(sourceUrl)) return "otf";
  return undefined;
};

const sourcePriority = (format: "woff2" | "woff" | "ttf" | "otf"): number =>
  format === "woff2" ? 4 : format === "woff" ? 3 : format === "ttf" ? 2 : 1;

const pickPreferredSource = (
  sources: ReneWebfontSource[] | null | undefined
): { url: string; format: "woff2" | "woff" | "ttf" | "otf" } | undefined => {
  const options = Array.isArray(sources)
    ? sources
        .map((item) => {
          const url = normalizeSpace(String(item?.url || ""));
          if (!url) return undefined;
          const format = guessFormat(typeof item?.format === "string" ? item.format : undefined, url);
          if (!format) return undefined;
          return { url, format };
        })
        .filter((item): item is { url: string; format: "woff2" | "woff" | "ttf" | "otf" } => Boolean(item))
    : [];
  if (options.length === 0) return undefined;
  return options.slice().sort((a, b) => sourcePriority(b.format) - sourcePriority(a.format))[0];
};

const normalizeStyleLabel = (styleName: string, cssStyle?: string | null): "Normal" | "Italic" => {
  const token = normalizeSpace(`${styleName} ${cssStyle || ""}`).toLowerCase();
  return /italic|oblique/.test(token) ? "Italic" : "Normal";
};

const toSafeFileToken = (value: string): string =>
  normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const asResolvedCollection = (
  summary: ReneCollectionSummary,
  node: ReneCollectionNode | null | undefined
): ReneResolvedCollection | undefined => {
  if (!node) return undefined;
  if (String(node.__typename || "") !== "FontCollection") return undefined;

  const id = normalizeSpace(String(node.id || summary.id));
  const name = normalizeSpace(String(node.name || summary.name));
  if (!id || !name) return undefined;

  const slug = normalizeSpace(String(node.slug?.name || summary.slug || "")) || undefined;
  const collectionType = normalizeSpace(String(node.collectionType || summary.collectionType || "family")).toLowerCase();
  const totalStylesRaw = Number(node.totalStyles ?? summary.totalStyles);
  const totalStyles = Number.isFinite(totalStylesRaw) ? totalStylesRaw : undefined;
  const glyphCountRaw = Array.isArray(node.featureStyle?.glyphNames) ? node.featureStyle?.glyphNames.length : undefined;
  const glyphCount = typeof glyphCountRaw === "number" && Number.isFinite(glyphCountRaw) ? glyphCountRaw : undefined;
  const pdfUrls = dedupeStrings(
    (Array.isArray(node.pdfs) ? node.pdfs : []).map((item) => (typeof item?.url === "string" ? item.url : undefined))
  );
  const { featureTags, ligatureTags } = collectFeatureTags(node);

  return {
    id,
    name,
    slug,
    collectionType,
    totalStyles,
    isVariableFont: Boolean(node.isVariableFont ?? summary.isVariableFont),
    cssUrl: normalizeSpace(String(node.cssUrl || "")) || undefined,
    updatedAt: normalizeSpace(String(node.updatedAt || "")) || undefined,
    designYear: Number.isFinite(Number(node.designYear)) ? Number(node.designYear) : undefined,
    pdfUrls,
    featureTags,
    ligatureTags,
    glyphCount,
    verticalMetrics: node.featureStyle?.verticalMetrics ?? undefined,
    fontStyles: Array.isArray(node.fontStyles) ? node.fontStyles.filter((item): item is ReneFontStyle => Boolean(item)) : []
  };
};

export const ReneBiederScraper: Scraper = {
  id: "renebieder",
  name: "Rene Bieder Precision Scraper",

  canHandle(url: string): boolean {
    return RENEBIEDER_HOST_RE.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = resolveScope(url);

    let selectedSummaries: ReneCollectionSummary[] = [];

    if (scope.mode === "family" && scope.slug) {
      const slugData = await fetchGraphQlWithRetry<ReneSlugPayload>({
        queryName: "ReneBiederSlugLookup",
        query: RENEBIEDER_SLUG_QUERY,
        variables: { name: scope.slug },
        referer: scope.targetUrl
      });
      const summary = asCollectionSummary(slugData?.viewer?.slug?.fontCollection);
      if (!summary) {
        return {
          scraperName: this.name,
          foundryName: "Studio Rene Bieder",
          fonts: [],
          originalUrl: url,
          targetUrl: scope.targetUrl,
          metadata: {
            source: "renebieder-graphql-canonical",
            mode: scope.mode,
            slug: scope.slug,
            reason: "font-collection-not-found"
          }
        };
      }
      selectedSummaries = toLeafSummaries(summary);
    } else {
      const rootsData = await fetchGraphQlWithRetry<ReneRootsPayload>({
        queryName: "ReneBiederRootCollections",
        query: RENEBIEDER_ROOTS_QUERY,
        variables: {},
        referer: scope.targetUrl
      });
      const roots =
        (Array.isArray(rootsData?.viewer?.fontCollections?.edges) ? rootsData.viewer?.fontCollections?.edges : [])
          .map((edge) => asCollectionSummary(edge?.node || undefined))
          .filter((item): item is ReneCollectionSummary => Boolean(item));
      selectedSummaries = roots.flatMap((item) => toLeafSummaries(item));
    }

    const leafSummaries = dedupeById(selectedSummaries);
    if (leafSummaries.length === 0) {
      return {
        scraperName: this.name,
        foundryName: "Studio Rene Bieder",
        fonts: [],
        originalUrl: url,
        targetUrl: scope.targetUrl,
        metadata: {
          source: "renebieder-graphql-canonical",
          mode: scope.mode,
          reason: "no-collections-selected"
        }
      };
    }

    const resolvedRows = await mapLimit(leafSummaries, RENEBIEDER_FETCH_CONCURRENCY, async (summary) => {
      const referer = resolveCollectionTargetUrl(scope.targetUrl, summary.slug);
      const data = await fetchGraphQlWithRetry<ReneCollectionPayload>({
        queryName: "ReneBiederCollectionById",
        query: RENEBIEDER_COLLECTION_QUERY,
        variables: { id: summary.id },
        referer
      });
      return { summary, node: data?.node, referer };
    });

    const collections = resolvedRows
      .map((row) => asResolvedCollection(row.summary, row.node || undefined))
      .filter((item): item is ReneResolvedCollection => Boolean(item));

    if (collections.length === 0) {
      return {
        scraperName: this.name,
        foundryName: "Studio Rene Bieder",
        fonts: [],
        originalUrl: url,
        targetUrl: scope.targetUrl,
        metadata: {
          source: "renebieder-graphql-canonical",
          mode: scope.mode,
          reason: "no-resolved-collections"
        }
      };
    }

    const fonts: FontMetadata[] = [];
    const styleMap: ReneStyleMapEntry[] = [];
    const expectedStylesSet = new Set<string>();
    const seenFonts = new Set<string>();
    const allFeatureTags = new Set<string>();
    const allLigatureTags = new Set<string>();
    const allPdfUrls = new Set<string>();
    let maxGlyphCount = 0;

    for (const collection of collections) {
      const collectionTargetUrl = resolveCollectionTargetUrl(scope.targetUrl, collection.slug);
      const familyToken = toSafeFileToken(collection.name);
      for (const tag of collection.featureTags) allFeatureTags.add(tag);
      for (const tag of collection.ligatureTags) allLigatureTags.add(tag);
      for (const pdfUrl of collection.pdfUrls) allPdfUrls.add(pdfUrl);
      if (typeof collection.glyphCount === "number" && collection.glyphCount > maxGlyphCount) {
        maxGlyphCount = collection.glyphCount;
      }

      for (const style of collection.fontStyles) {
        const source = pickPreferredSource(style.webfontSources);
        if (!source) continue;

        const styleName = normalizeSpace(String(style.name || "Regular")) || "Regular";
        const styleLabel = normalizeStyleLabel(styleName, style.cssStyle);
        const weightToken = normalizeSpace(String(style.cssWeight || "")) || "Regular";
        const expectedStyle = normalizeSpace(`${collection.name} ${styleName}`);
        expectedStylesSet.add(expectedStyle);

        const styleToken = toSafeFileToken(styleName);
        const fileNameHint = familyToken && styleToken ? `${familyToken}-${styleToken}.${source.format}` : undefined;

        const styleFeatures = dedupeStrings(
          Array.isArray(style.fontFeatures?.supportedFeatures) ? style.fontFeatures?.supportedFeatures : []
        ).map((item) => item.toLowerCase());
        const styleLigatures = styleFeatures.filter((tag) => RENEBIEDER_LIGATURE_TAGS.has(tag));
        const styleMapEntry: ReneStyleMapEntry = {
          expectedStyle,
          familyName: collection.name,
          styleName,
          style: styleLabel,
          weight: weightToken,
          sourceType: "webfont-static",
          collectionId: collection.id,
          collectionSlug: collection.slug,
          format: source.format,
          url: source.url
        };
        styleMap.push(styleMapEntry);

        const dedupeKey = `${normalizeToken(source.url)}::${normalizeToken(expectedStyle)}`;
        if (seenFonts.has(dedupeKey)) continue;
        seenFonts.add(dedupeKey);

        fonts.push({
          url: source.url,
          family: collection.name,
          format: source.format,
          style: styleLabel,
          weight: weightToken,
          downloadable: true,
          note: "Rene Bieder style webfont source from canonical store GraphQL.",
          metadata: {
            foundry: "Studio Rene Bieder",
            family: collection.name,
            styleName,
            fullName: expectedStyle,
            collectionId: collection.id,
            collectionName: collection.name,
            collectionSlug: collection.slug,
            collectionType: collection.collectionType,
            totalStyles: collection.totalStyles,
            isVariableFont: collection.isVariableFont,
            designYear: collection.designYear,
            updatedAt: collection.updatedAt,
            cssUrl: collection.cssUrl,
            pageUrl: collectionTargetUrl,
            targetUrl: collectionTargetUrl,
            originalUrl: scope.inputUrl,
            format: source.format,
            fileNameHint,
            expectedStyles: [expectedStyle],
            expectedStyleCount: 1,
            featureTags: styleFeatures,
            ligatureFeatures: styleLigatures,
            supportedLanguages: Array.isArray(style.supportedLanguages) ? style.supportedLanguages : [],
            variableAxes: Array.isArray(style.variableAxes) ? style.variableAxes : [],
            variableInstances: Array.isArray(style.variableInstances) ? style.variableInstances : [],
            glyphCount: collection.glyphCount,
            verticalMetrics: collection.verticalMetrics,
            specimenPdfUrls: collection.pdfUrls,
            forceMetadataRepair: true,
            headers: {
              Origin: RENEBIEDER_MARKETING_ORIGIN,
              Referer: collectionTargetUrl,
              Accept: source.format === "woff2" ? "font/woff2,*/*;q=0.8" : "*/*",
              "User-Agent": RENEBIEDER_UA
            }
          }
        });
      }
    }

    const expectedStyles = dedupeStrings(Array.from(expectedStylesSet.values()));
    const requiredFeatureTags = RENEBIEDER_REQUIRED_FEATURE_CANDIDATES.filter((tag) => allFeatureTags.has(tag));

    const targetProfile: Record<string, unknown> = {
      profileId: "renebieder-target-profile-v1",
      source: "renebieder-graphql-canonical",
      foundry: "Studio Rene Bieder",
      styleScope: "family-style",
      strictMissingStyles: true,
      family: scope.mode === "family" && collections.length === 1 ? collections[0].name : "Studio Rene Bieder Catalog",
      familyDisplay: scope.mode === "family" && collections.length === 1 ? collections[0].name : "Studio Rene Bieder",
      mode: scope.mode,
      targetUrl: scope.targetUrl,
      inputUrl: scope.inputUrl,
      expectedStyles,
      expectedStyleCount: expectedStyles.length,
      styleMap,
      requiredFeatureTags,
      catalogFeatureTags: Array.from(allFeatureTags.values()).sort(),
      ligatureFeatureTags: Array.from(allLigatureTags.values()).sort(),
      minCmapEntries: RENEBIEDER_MIN_CMAP_ENTRIES,
      minFeatureCount: RENEBIEDER_MIN_FEATURE_COUNT,
      collectionIds: collections.map((collection) => collection.id),
      collectionSlugs: dedupeStrings(collections.map((collection) => collection.slug)),
      collectionNames: dedupeStrings(collections.map((collection) => collection.name)),
      specimenPdfUrls: Array.from(allPdfUrls.values()).sort(),
      glyphCount: maxGlyphCount > 0 ? maxGlyphCount : undefined,
      collectedAt: new Date().toISOString()
    };

    for (const font of fonts) {
      if (!font.metadata || typeof font.metadata !== "object") font.metadata = {};
      font.metadata.targetProfile = targetProfile;
    }

    return {
      scraperName: this.name,
      foundryName: "Studio Rene Bieder",
      fonts,
      originalUrl: url,
      targetUrl: scope.targetUrl,
      expectedCount: expectedStyles.length > 0 ? expectedStyles.length : fonts.length,
      metadata: {
        source: "renebieder-graphql-canonical",
        mode: scope.mode,
        slug: scope.slug,
        totalCollections: collections.length,
        selectedCollections: collections.map((collection) => collection.name),
        specimenPdfUrls: Array.from(allPdfUrls.values()).sort(),
        targetProfile,
        totalFonts: fonts.length,
        collectedAt: new Date().toISOString()
      }
    };
  }
};
