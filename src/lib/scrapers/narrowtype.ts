import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const NARROWTYPE_HOST = "narrowtype.com";
const NARROWTYPE_ORIGIN = "https://narrowtype.com";
const NARROWTYPE_STORE_ENDPOINT = "https://narrowtype.com/wp-json/wc/store/v1/products";
const NARROWTYPE_FETCH_TIMEOUT_MS = 30000;
const NARROWTYPE_FETCH_MAX_RETRIES = 3;
const NARROWTYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const NARROWTYPE_ASSET_RE = /\.(?:zip|woff2?|otf|ttf|eot)(?:$|\?)/i;

const BUNDLE_TOKEN_RE =
  /(?:complete\s*family|full\s*family|super\s*family|upright\s*family|family\s*pack|student\s*pack|completefamily|fullfamily|superfamily|upright|bundle|\(\s*\d+\s*styles?\s*\)|\b\d+\s*styles?\b)/i;
const STYLE_WEIGHT_RE =
  /(?:hairline|thin|extra\s*light|ultra\s*light|light|book|regular|roman|medium|semi\s*bold|semibold|demi\s*bold|bold|extra\s*bold|ultra\s*bold|black|heavy)/i;

const FEATURE_ALIAS_TO_TAG: Array<{ alias: RegExp; tag: string }> = [
  { alias: /standard\s*ligatures?/i, tag: "liga" },
  { alias: /discretionary\s*ligatures?/i, tag: "dlig" },
  { alias: /contextual\s*alternates?/i, tag: "calt" },
  { alias: /stylistic\s*set\s*0*1/i, tag: "ss01" },
  { alias: /stylistic\s*set\s*0*2/i, tag: "ss02" },
  { alias: /stylistic\s*set\s*0*3/i, tag: "ss03" },
  { alias: /stylistic\s*set\s*0*4/i, tag: "ss04" },
  { alias: /stylistic\s*set\s*0*5/i, tag: "ss05" },
  { alias: /stylistic\s*set\s*0*6/i, tag: "ss06" },
  { alias: /stylistic\s*set\s*0*7/i, tag: "ss07" },
  { alias: /stylistic\s*set\s*0*8/i, tag: "ss08" },
  { alias: /stylistic\s*set\s*0*9/i, tag: "ss09" },
  { alias: /stylistic\s*set\s*10/i, tag: "ss10" },
  { alias: /fractions?/i, tag: "frac" },
  { alias: /inferiors?\s*&\s*superiors?|superiors?\s*&\s*inferiors?/i, tag: "sups" },
  { alias: /oldstyle\s*figures?/i, tag: "onum" },
  { alias: /tabular\s*figures?/i, tag: "tnum" },
  { alias: /case\s*sensitive/i, tag: "case" }
];

type NarrowStyleMode = "Normal" | "Italic";

type NarrowProduct = {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  description?: string;
};

type StyleOption = {
  styleLabel: string;
  fullName: string;
  style: NarrowStyleMode;
  weight?: number;
  assetUrl: string;
  assetFormat: FontMetadata["format"];
  source: "tm-epo" | "zip-fallback";
  score: number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/");

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const toSafeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const inferAssetFormat = (assetUrl: string): FontMetadata["format"] => {
  const lower = assetUrl.toLowerCase();
  if (/\.zip(?:$|\?)/.test(lower)) return "zip";
  if (/\.woff2(?:$|\?)/.test(lower)) return "woff2";
  if (/\.woff(?:$|\?)/.test(lower)) return "woff";
  if (/\.otf(?:$|\?)/.test(lower)) return "otf";
  if (/\.ttf(?:$|\?)/.test(lower)) return "ttf";
  if (/\.eot(?:$|\?)/.test(lower)) return "eot";
  return "zip";
};

const dedupeStringList = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const cleaned = normalizeSpace(item);
    if (!cleaned) continue;
    const token = normalizeToken(cleaned);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(cleaned);
  }
  return out;
};

const normalizeTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === `www.${NARROWTYPE_HOST}`) parsed.hostname = NARROWTYPE_HOST;
  return parsed.href;
};

const extractSlugFromUrl = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0].toLowerCase() === "fonts") return parts[1].toLowerCase();
    if (parts.length >= 1) return parts[parts.length - 1].toLowerCase();
  } catch {
    // ignore malformed URL
  }
  return undefined;
};

const buildFontPageUrl = (slug: string): string => `${NARROWTYPE_ORIGIN}/fonts/${slug}/`;

const fetchTextWithRetry = async (url: string, headers: Record<string, string>): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NARROWTYPE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NARROWTYPE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < NARROWTYPE_FETCH_MAX_RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Narrow Type fetch failed");
};

const fetchJsonWithRetry = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const text = await fetchTextWithRetry(url, headers);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON payload from ${url}: ${String(error)}`);
  }
};

const pickStoreProduct = (payload: unknown): NarrowProduct | undefined => {
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const row = payload.find(isRecord) || payload[0];
  if (!isRecord(row)) return undefined;

  const id = asNumber(row.id);
  const name = decodeHtml(asString(row.name) || "");
  const slug = asString(row.slug)?.toLowerCase();
  const permalink = asString(row.permalink);
  if (!id || !name || !slug || !permalink) return undefined;

  return {
    id,
    name,
    slug,
    permalink,
    description: asString(row.description)
  };
};

const parseAttributes = (tag: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z0-9:_-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    const key = (match[1] || "").toLowerCase();
    const raw = match[3] || "";
    attrs[key] = decodeHtml(raw);
  }
  return attrs;
};

const canonicalizeUrl = (rawUrl: string, baseUrl: string): string | undefined => {
  const trimmed = decodeHtml(rawUrl).trim();
  if (!trimmed) return undefined;
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return undefined;
    resolved.hash = "";
    return resolved.href;
  } catch {
    return undefined;
  }
};

const cleanStyleLabel = (rawLabel: string, familyName: string): string => {
  let label = normalizeSpace(rawLabel)
    .replace(/_\d+$/g, "")
    .replace(/\s+/g, " ");
  if (!label) return "Regular";

  const familyToken = normalizeToken(familyName);
  if (familyToken) {
    const compact = normalizeToken(label);
    if (compact === familyToken) return "Regular";

    if (compact.startsWith(familyToken)) {
      const familyWords = familyName
        .split(/\s+/g)
        .filter(Boolean)
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const joinedWordPattern = familyWords.join("\\s*");
      const spacedWordPattern = familyWords.join("\\s+");
      label = normalizeSpace(
        label
          .replace(new RegExp(`^${spacedWordPattern}[-_\\s]*`, "i"), "")
          .replace(new RegExp(`^${joinedWordPattern}[-_\\s]*`, "i"), "")
      );
    }
  }

  if (!label) return "Regular";

  if (/^italic$/i.test(label)) {
    label = "Regular Italic";
  }

  label = label
    .replace(/semi[\s-]*bold/gi, "Semibold")
    .replace(/extra[\s-]*light/gi, "Extralight")
    .replace(/extra[\s-]*bold/gi, "Extrabold")
    .replace(/ultra[\s-]*narrow/gi, "Ultra Narrow")
    .replace(/\bexp\b/gi, "Expanded")
    .replace(/\breg\b/gi, "Regular")
    .replace(/\blt\b/gi, "Light")
    .replace(/\bmed\b/gi, "Medium")
    .replace(/\bbd\b/gi, "Bold")
    .replace(/\bsb\b/gi, "Semibold")
    .replace(/\bxl?t\b/gi, "Extralight")
    .replace(/ExpXLt/gi, "Expanded Extralight")
    .replace(/ExpLt/gi, "Expanded Light")
    .replace(/ExpReg/gi, "Expanded Regular")
    .replace(/ExpMed/gi, "Expanded Medium")
    .replace(/ExpSB/gi, "Expanded Semibold")
    .replace(/ExpBd/gi, "Expanded Bold")
    .replace(/NarrowXLt/gi, "Narrow Extralight")
    .replace(/NarrowLt/gi, "Narrow Light")
    .replace(/NarrowReg/gi, "Narrow Regular")
    .replace(/NarrowMed/gi, "Narrow Medium")
    .replace(/NarrowSB/gi, "Narrow Semibold")
    .replace(/NarrowBd/gi, "Narrow Bold")
    .replace(/UltraNarrowXLt/gi, "Ultra Narrow Extralight")
    .replace(/UltraNarrowLt/gi, "Ultra Narrow Light")
    .replace(/UltraNarrowReg/gi, "Ultra Narrow Regular")
    .replace(/UltraNarrowMed/gi, "Ultra Narrow Medium")
    .replace(/UltraNarrowSB/gi, "Ultra Narrow Semibold")
    .replace(/UltraNarrowBd/gi, "Ultra Narrow Bold");

  return label
    .split(" ")
    .map((part) => {
      if (!part) return part;
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
};

const inferWeight = (styleName: string): number | undefined => {
  const token = normalizeToken(styleName);
  if (!token) return undefined;
  const numeric = token.match(/(1000|950|900|800|700|600|500|450|400|350|300|250|200|100)$/);
  if (numeric?.[1]) return Number(numeric[1]);
  if (token.includes("hairline") || token.includes("thin")) return 100;
  if (token.includes("extralight") || token.includes("ultralight")) return 200;
  if (token.includes("light")) return 300;
  if (token.includes("book")) return 450;
  if (token.includes("regular") || token.includes("roman")) return 400;
  if (token.includes("medium")) return 500;
  if (token.includes("semibold") || token.includes("demibold")) return 600;
  if (token.includes("bold")) return 700;
  if (token.includes("extrabold") || token.includes("ultrabold")) return 800;
  if (token.includes("black") || token.includes("heavy")) return 900;
  return undefined;
};

const inferStyleMode = (styleName: string): NarrowStyleMode =>
  /italic|oblique/i.test(styleName) ? "Italic" : "Normal";

const isBundleStyle = (styleName: string, assetUrl: string): boolean => {
  const label = normalizeSpace(styleName);
  const assetName = (assetUrl.split("/").pop() || "").replace(
    /\.(?:zip|woff2?|otf|ttf|eot)(?:\?.*)?$/i,
    ""
  );
  if (BUNDLE_TOKEN_RE.test(label) || BUNDLE_TOKEN_RE.test(assetName)) return true;

  const hasWeight = STYLE_WEIGHT_RE.test(label);
  const hasItalic = /italic|oblique/i.test(label);
  const tokenCount = label.split(/\s+/g).filter(Boolean).length;
  if (!hasWeight && !hasItalic && tokenCount <= 3) return true;

  return false;
};

const parseStyleOptionsFromHtml = (html: string, pageUrl: string, familyName: string): StyleOption[] => {
  const options: StyleOption[] = [];
  const seen = new Set<string>();

  for (const tagMatch of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = tagMatch[0];
    if (!tag) continue;
    const attrs = parseAttributes(tag);

    const rawAsset = asString(attrs["data-imagep"]);
    if (!rawAsset || !NARROWTYPE_ASSET_RE.test(rawAsset)) continue;

    const assetUrl = canonicalizeUrl(rawAsset, pageUrl);
    if (!assetUrl || !NARROWTYPE_ASSET_RE.test(assetUrl)) continue;
    const assetFormat = inferAssetFormat(assetUrl);

    const rawValue = asString(attrs.value) || "";
    const rawLabel = rawValue.replace(/_\d+$/g, "").trim();
    const styleLabel = cleanStyleLabel(rawLabel || familyName, familyName);
    const fullName = `${familyName} ${styleLabel}`.replace(/\s+/g, " ").trim();

    const bundle = isBundleStyle(styleLabel, assetUrl);
    const score = bundle ? 0 : 3;
    const key = `${normalizeToken(styleLabel)}|${assetUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    options.push({
      styleLabel,
      fullName,
      style: inferStyleMode(styleLabel),
      weight: inferWeight(styleLabel),
      assetUrl,
      assetFormat,
      source: "tm-epo",
      score
    });
  }

  return options;
};

const parseAssetFallbacksFromHtml = (html: string, pageUrl: string, familyName: string): StyleOption[] => {
  const out: StyleOption[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:zip|woff2?|otf|ttf|eot)(?:\?[^\s"'<>]*)?/gi)) {
    const raw = asString(match[0]);
    if (!raw) continue;
    const assetUrl = canonicalizeUrl(raw, pageUrl);
    if (!assetUrl || !NARROWTYPE_ASSET_RE.test(assetUrl) || seen.has(assetUrl)) continue;
    seen.add(assetUrl);
    const assetFormat = inferAssetFormat(assetUrl);

    const base = (assetUrl.split("/").pop() || "")
      .replace(/\.(?:zip|woff2?|otf|ttf|eot)(?:\?.*)?$/i, "")
      .replace(/[-_]+/g, " ");
    const styleLabel = cleanStyleLabel(base || familyName, familyName);
    const fullName = `${familyName} ${styleLabel}`.replace(/\s+/g, " ").trim();
    const bundle = isBundleStyle(styleLabel, assetUrl);

    out.push({
      styleLabel,
      fullName,
      style: inferStyleMode(styleLabel),
      weight: inferWeight(styleLabel),
      assetUrl,
      assetFormat,
      source: "zip-fallback",
      score: bundle ? 0 : 1
    });
  }

  return out;
};

const parseExpectedStylesFromDescription = (description: string, familyName: string): string[] => {
  const expected: string[] = [];
  const seen = new Set<string>();
  for (const match of description.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const raw = normalizeSpace(decodeHtml(String(match[1] || "").replace(/<[^>]+>/g, " ")));
    if (!raw) continue;
    if (!STYLE_WEIGHT_RE.test(raw) && !/italic|oblique/i.test(raw)) continue;
    const style = cleanStyleLabel(raw, familyName);
    const fullName = `${familyName} ${style}`.replace(/\s+/g, " ").trim();
    const token = normalizeToken(fullName);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    expected.push(fullName);
  }
  return expected;
};

const extractSpecimenPdfUrls = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) {
    const raw = asString(match[1]);
    if (!raw) continue;
    const resolved = canonicalizeUrl(raw, baseUrl);
    if (resolved) out.add(resolved);
  }
  return Array.from(out);
};

const extractFeatureTags = (htmlOrDescription: string): string[] => {
  const tags = new Set<string>();
  const source = decodeHtml(htmlOrDescription.replace(/<[^>]+>/g, " "));
  for (const mapping of FEATURE_ALIAS_TO_TAG) {
    if (mapping.alias.test(source)) tags.add(mapping.tag);
  }
  return Array.from(tags).sort();
};

const selectStyleOptions = (options: StyleOption[]): StyleOption[] => {
  const byStyle = new Map<string, StyleOption>();
  for (const row of options) {
    const styleToken = normalizeToken(row.styleLabel);
    if (!styleToken) continue;
    const prev = byStyle.get(styleToken);
    if (!prev || row.score > prev.score) byStyle.set(styleToken, row);
  }

  let selected = Array.from(byStyle.values()).filter((row) => row.score > 0);
  if (selected.length === 0) {
    selected = Array.from(byStyle.values());
  }

  selected.sort((a, b) => `${a.styleLabel}|${a.assetUrl}`.localeCompare(`${b.styleLabel}|${b.assetUrl}`));
  return selected;
};

const buildTargetProfile = (params: {
  targetUrl: string;
  familyName: string;
  slug: string;
  selectedStyles: StyleOption[];
  expectedStyles: string[];
  requiredFeatureTags: string[];
  specimenPdfUrls: string[];
  excludedBundles: string[];
  outputFormats: FontMetadata["format"][];
}): Record<string, unknown> => ({
  profileId: "narrowtype-target-profile-v1",
  source: "woocommerce-store-api+tm-epo-html",
  foundry: "Narrow Type",
  styleScope: "family-style",
  strictMissingStyles: true,
  targetUrl: params.targetUrl,
  family: params.familyName,
  familyDisplay: params.familyName,
  familySlug: params.slug,
  expectedStyles: params.expectedStyles,
  expectedStyleCount: params.expectedStyles.length,
  styleMap: params.selectedStyles.map((row) => ({
    styleSlug: toSafeSlug(row.styleLabel),
    styleName: row.styleLabel,
    expectedStyle: row.fullName,
    source: row.source,
    style: row.style,
    weight: row.weight,
    format: row.assetFormat,
    url: row.assetUrl
  })),
  requiredFeatureTags: params.requiredFeatureTags,
  specimenPdfUrls: params.specimenPdfUrls,
  excludedStyles: params.excludedBundles,
  outputNaming: {
    prefix: "narrow-type",
    pattern: "narrow-type-{typeface-slug}-{style-slug}.{ext}",
    styleTokenCase: "lowercase",
    separator: "-",
    stableSort: "lexical"
  },
  formatPolicy: "style assets from TM EPO (zip package and/or direct font files)",
  outputFormats: params.outputFormats,
  collectedAt: new Date().toISOString()
});

const buildFonts = (params: {
  familyName: string;
  familySlug: string;
  targetUrl: string;
  selectedStyles: StyleOption[];
  targetProfile: Record<string, unknown>;
}): FontMetadata[] => {
  const out: FontMetadata[] = [];
  const seen = new Set<string>();
  const foundryPrefix = "narrow-type";
  const safeFamilySlug = toSafeSlug(params.familySlug) || "unknown-family";

  for (const style of params.selectedStyles) {
    const dedupeKey = style.assetUrl;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const safeStyle = toSafeSlug(style.styleLabel) || "regular";
    const isZipAsset = style.assetFormat === "zip";

    out.push({
      url: style.assetUrl,
      family: params.familyName,
      format: style.assetFormat,
      style: style.style,
      weight: style.weight ?? "Regular",
      downloadable: true,
      note:
        style.source === "tm-epo"
          ? "Narrow Type direct style asset from TM EPO options."
          : "Narrow Type fallback style asset from product page.",
      metadata: {
        foundry: "Narrow Type",
        family: params.familyName,
        familySlug: params.familySlug,
        styleName: style.styleLabel,
        fullName: style.fullName,
        sourceType: style.source,
        pageUrl: params.targetUrl,
        targetUrl: params.targetUrl,
        skipConversion: isZipAsset,
        pruneRawZipAfterExtract: isZipAsset,
        zipExtractToRoot: isZipAsset,
        extractSpecimenOnlyZip: isZipAsset ? false : undefined,
        extractSpecimenPdfFromZip: isZipAsset ? false : undefined,
        forceMetadataRepair: true,
        fileNameHint: `${foundryPrefix}-${safeFamilySlug}-${safeStyle}.${style.assetFormat}`,
        targetProfile: params.targetProfile,
        headers: {
          Origin: NARROWTYPE_ORIGIN,
          Referer: params.targetUrl,
          Accept: "*/*"
        }
      }
    });
  }

  return out;
};

const buildFallbackInjectScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const radios = Array.from(document.querySelectorAll('input[type="radio"], li.tmcp-field-wrap, .tmcp-field-wrap-inner'));
    for (const node of radios.slice(0, 220)) {
      try {
        if (node instanceof HTMLInputElement) {
          node.checked = true;
          node.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }
      } catch {}
      await sleep(45);
    }
    await sleep(1200);
  })();
`;

const buildNarrowTypeFallbackResult = (rawUrl: string, reason: unknown): ScrapeResult => {
  const normalizedInput = normalizeTargetUrl(rawUrl);
  const slug = extractSlugFromUrl(normalizedInput) || "narrow-type";
  const familyName = slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Narrow Type";
  const expectedAssetTokens = Array.from(
    new Set(
      [slug, familyName, `nt${slug}`]
        .map((value) => normalizeToken(String(value || "")))
        .filter((value) => value.length >= 4)
    )
  );
  const targetProfile = {
    profileId: "narrowtype-target-profile-fallback-v1",
    source: "narrowtype-browser-intercept-fallback",
    foundry: "Narrow Type",
    styleScope: "family-style",
    strictMissingStyles: false,
    targetUrl: buildFontPageUrl(slug),
    family: familyName,
    familyDisplay: familyName,
    familySlug: slug,
    expectedStyles: [],
    expectedStyleCount: 0,
    expectedAssetTokens,
    requiredFeatureTags: [],
    outputNaming: {
      prefix: "narrow-type",
      pattern: "narrow-type-{family-slug}-{style-slug}.{ext}",
      separator: "-",
      styleTokenCase: "lowercase"
    }
  };

  return {
    scraperName: NarrowTypeScraper.name,
    foundryName: "Narrow Type",
    fonts: [
      {
        url: "browser-intercept",
        family: familyName,
        format: "woff2",
        style: "Normal",
        weight: "Regular",
        downloadable: true,
        metadata: {
          foundry: "Narrow Type",
          family: familyName,
          pageUrl: buildFontPageUrl(slug),
          targetUrl: buildFontPageUrl(slug),
          targetProfile,
          fallbackReason: reason instanceof Error ? reason.message : String(reason)
        }
      }
    ],
    originalUrl: rawUrl,
    targetUrl: buildFontPageUrl(slug),
    injectScript: buildFallbackInjectScript(),
    expectedCount: 1,
    metadata: {
      foundry: "Narrow Type",
      family: familyName,
      slug,
      fallbackMode: "browser-intercept",
      targetProfile,
      requiredFeatureTags: [],
      fallbackReason: reason instanceof Error ? reason.message : String(reason)
    }
  };
};

export const NarrowTypeScraper: Scraper = {
  id: "narrowtype",
  name: "Narrow Type Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?narrowtype\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const normalizedInput = normalizeTargetUrl(url);
      const slug = extractSlugFromUrl(normalizedInput);
      if (!slug) {
        return {
          scraperName: this.name,
          foundryName: "Narrow Type",
          fonts: [],
          originalUrl: url,
          metadata: {
            foundry: "Narrow Type",
            reason: "slug-not-found"
          }
        };
      }

      const jsonHeaders = {
        "User-Agent": NARROWTYPE_UA,
        Accept: "application/json,*/*",
        Referer: normalizedInput
      };
      const htmlHeaders = {
        "User-Agent": NARROWTYPE_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: NARROWTYPE_ORIGIN
      };

      const storePayload = await fetchJsonWithRetry(
        `${NARROWTYPE_STORE_ENDPOINT}?slug=${encodeURIComponent(slug)}`,
        jsonHeaders
      );
      const storeProduct = pickStoreProduct(storePayload);

      const targetUrl = storeProduct?.permalink || buildFontPageUrl(slug);
      const productPageHtml = await fetchTextWithRetry(targetUrl, htmlHeaders);

      const fallbackFamily = slug
        .split(/[-_]+/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      const familyName = normalizeSpace(storeProduct?.name || fallbackFamily || "Narrow Type Family");

      const tmEpoOptions = parseStyleOptionsFromHtml(productPageHtml, targetUrl, familyName);
      const fallbackOptions =
        tmEpoOptions.length > 0 ? [] : parseAssetFallbacksFromHtml(productPageHtml, targetUrl, familyName);
      const styleOptionsRaw = [...tmEpoOptions, ...fallbackOptions];

      const selectedStyles = selectStyleOptions(styleOptionsRaw);
      const excludedBundles = dedupeStringList(
        styleOptionsRaw
          .filter((row) => row.score === 0)
          .map((row) => row.styleLabel)
      );

      const expectedFromOptions = dedupeStringList(selectedStyles.map((row) => row.fullName));
      const expectedFromDescription = storeProduct?.description
        ? parseExpectedStylesFromDescription(storeProduct.description, familyName)
        : [];
      const expectedStyles = expectedFromOptions.length > 0 ? expectedFromOptions : expectedFromDescription;

      const specimenPdfUrls = dedupeStringList(extractSpecimenPdfUrls(productPageHtml, targetUrl));
      const requiredFeatureTags = dedupeStringList([
        ...extractFeatureTags(storeProduct?.description || ""),
        ...extractFeatureTags(productPageHtml)
      ]);

      const targetProfile = buildTargetProfile({
        targetUrl,
        familyName,
        slug,
        selectedStyles,
        expectedStyles,
        requiredFeatureTags,
        specimenPdfUrls,
        excludedBundles,
        outputFormats: Array.from(new Set(selectedStyles.map((row) => row.assetFormat))).sort()
      });

      const fonts = buildFonts({
        familyName,
        familySlug: slug,
        targetUrl,
        selectedStyles,
        targetProfile
      });

      if (fonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Narrow Type",
          fonts: [
            {
              url: "browser-intercept",
              family: familyName,
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "Narrow Type",
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
          expectedCount: expectedStyles.length > 0 ? expectedStyles.length : undefined,
          metadata: {
            foundry: "Narrow Type",
            family: familyName,
            slug,
            fallbackMode: "browser-intercept",
            targetProfile,
            specimenPdfUrls,
            requiredFeatureTags
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Narrow Type",
        fonts,
        originalUrl: url,
        targetUrl,
        expectedCount: expectedStyles.length > 0 ? expectedStyles.length : fonts.length,
        metadata: {
          foundry: "Narrow Type",
          family: familyName,
          slug,
          styleCount: selectedStyles.length,
          excludedBundles,
          targetProfile,
          specimenPdfUrls,
          requiredFeatureTags
        }
      };
    } catch (error) {
      console.error("[NarrowTypeScraper] Error:", error);
      return buildNarrowTypeFallbackResult(url, error);
    }
  }
};
