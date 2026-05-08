import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";
import { putInlineFontAsset, type InlineFontAssetFormat } from "@/lib/server/inline-font-cache";

const TDF_HOST = "thedesignersfoundry.com";
const TDF_ORIGIN = `https://www.${TDF_HOST}`;
const TDF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const TDF_FETCH_ATTEMPTS = 4;
const TDF_FETCH_TIMEOUT_MS = 30_000;

type ScrapeScope =
  | { mode: "catalog"; catalogUrl: string }
  | { mode: "single"; slug: string; preferredRoute?: "typeface" | "beta-fonts"; targetUrl: string };

type CatalogEntry = {
  slug: string;
  beta: boolean;
  title?: string;
  designerName?: string;
  numStyles?: number;
};

type TypefaceFamilyResult = {
  slug: string;
  route: "typeface" | "beta-fonts";
  title: string;
  designerName?: string;
  pageUrl: string;
  expectedStyles: string[];
  features: string[];
  glyphCount?: number;
  languageCount: number;
  fonts: FontMetadata[];
  resolutionWarnings: string[];
};

type ParsedSpecsSummary = {
  glyphCount?: number;
  languages: string[];
};

type ResolvedCssAsset = {
  url: string;
  format: FontMetadata["format"];
  sourceType: "inline-data-uri" | "css-direct-url";
  sourceCssUrl: string;
};

type StyleSource = {
  id?: string;
  fontName: string;
  familyName: string;
  styleName: string;
  style: "Normal" | "Italic";
  weight: string | number;
  isVariable: boolean;
  fontSrc?: string;
  featureTags: string[];
  postscriptName?: string;
  variableAxes?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asFiniteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();
const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const dedupeStringList = (values: Iterable<string | undefined>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = normalizeSpace(value || "");
    if (!cleaned) continue;
    const token = normalizeToken(cleaned);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(cleaned);
  }
  return out;
};

const toTitleWords = (value: string): string =>
  normalizeSpace(value)
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const toFileToken = (value: string): string =>
  normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "font";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripLeadingLabel = (value: string, label: string): string => {
  const source = normalizeSpace(value);
  const base = normalizeSpace(label);
  if (!source || !base) return source;
  const re = new RegExp(`^${escapeRegExp(base)}\\s+`, "i");
  return normalizeSpace(source.replace(re, ""));
};

const inferStyleFromSignals = (...signals: Array<string | undefined>): "Normal" | "Italic" => {
  const combined = signals.filter(Boolean).join(" ");
  return /italic|oblique|slanted|kursiv/i.test(combined) ? "Italic" : "Normal";
};

const inferWeightFromStyleName = (styleName: string): string | number => {
  const token = normalizeToken(styleName);
  const numericMatch = token.match(/(?:^|[^0-9])(1000|950|900|800|700|600|500|450|400|350|300|250|200|100)(?:[^0-9]|$)/);
  if (numericMatch?.[1]) return Number(numericMatch[1]);
  if (token.includes("hairline") || token.includes("thin")) return 100;
  if (token.includes("extralight") || token.includes("ultralight")) return 200;
  if (token.includes("light")) return 300;
  if (token.includes("book")) return 450;
  if (token.includes("regular") || token.includes("roman")) return 400;
  if (token.includes("medium")) return 500;
  if (token.includes("semibold") || token.includes("demibold")) return 600;
  if (token.includes("extrabold") || token.includes("ultrabold")) return 800;
  if (token.includes("bold")) return 700;
  if (token.includes("black") || token.includes("heavy")) return 900;
  return "Regular";
};

// Keep token behavior aligned with quality-audit normalization in font-downloader.
const normalizeQualityStyleTokenCompat = (value: string): string => {
  let token = value
    .toLowerCase()
    .replace(/semi[\s_-]?bold/g, "semibold")
    .replace(/demi[\s_-]?bold/g, "semibold")
    .replace(/extra[\s_-]?light/g, "extralight")
    .replace(/\bex[\s_-]?light\b/g, "extralight")
    .replace(/\bexlgt\b/g, "extralight")
    .replace(/ultra[\s_-]?light/g, "extralight")
    .replace(/extra[\s_-]?bold/g, "extrabold")
    .replace(/\bex[\s_-]?bold\b/g, "extrabold")
    .replace(/\bexbld\b/g, "extrabold")
    .replace(/ultra[\s_-]?bold/g, "extrabold")
    .replace(/\bdemo\b/g, "")
    .replace(/\btrial\b/g, "")
    .replace(/\blcg\b/g, "")
    .replace(/\bweb\b/g, "")
    .replace(/\bvariable\s*font\b/g, " variable ")
    .replace(/\bvf\b/g, " variable ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9]+/g, "");

  if (!token) return "";
  if (token === "italic" || token === "oblique" || token === "regularoblique") return "regularitalic";
  if (token === "variable") return "regular";
  if (token === "variableitalic" || token === "variableoblique") return "regularitalic";
  if (token.endsWith("variableitalic")) {
    token = token.replace(/variableitalic$/, "regularitalic");
  } else if (token.endsWith("variableoblique")) {
    token = token.replace(/variableoblique$/, "regularitalic");
  } else if (token.endsWith("variable")) {
    token = token.replace(/variable$/, "regular");
  }
  if (token.includes("variable")) {
    token = token.replace(/variable/g, "");
    if (!token) token = "regular";
  }
  if (token.endsWith("oblique")) token = `${token.slice(0, -7)}italic`;
  if (
    token.endsWith("italic") &&
    !/(thin|extralight|light|book|regular|medium|semibold|demibold|bold|extrabold|black|heavy)italic$/.test(token)
  ) {
    token = token.replace(/italic$/, "regularitalic");
  }
  return token;
};

const inferFormatFromUrl = (url: string): FontMetadata["format"] | undefined => {
  const lower = url.toLowerCase();
  if (lower.includes(".woff2")) return "woff2";
  if (lower.includes(".woff")) return "woff";
  if (lower.includes(".otf")) return "otf";
  if (lower.includes(".ttf")) return "ttf";
  if (lower.includes(".zip")) return "zip";
  return undefined;
};

const detectInlineFormat = (mime: string | undefined, buffer: Buffer): InlineFontAssetFormat | undefined => {
  const token = String(mime || "").toLowerCase();
  if (token.includes("woff2")) return "woff2";
  if (token.includes("woff")) return "woff";
  if (token.includes("otf")) return "otf";
  if (token.includes("ttf")) return "ttf";
  if (token.includes("zip")) return "zip";

  if (buffer.length >= 4) {
    const sig4 = buffer.subarray(0, 4).toString("ascii");
    if (sig4 === "wOF2") return "woff2";
    if (sig4 === "wOFF") return "woff";
    if (sig4 === "OTTO") return "otf";
    if (buffer.readUInt32BE(0) === 0x00010000) return "ttf";
    if (buffer.readUInt32BE(0) === 0x504b0304) return "zip";
  }

  return undefined;
};

const decodeInlineDataUri = (raw: string): { buffer: Buffer; format: InlineFontAssetFormat; mime?: string } | undefined => {
  const match = raw.match(/^data:([^,]*),(.*)$/i);
  if (!match) return undefined;

  const descriptor = String(match[1] || "");
  const payload = String(match[2] || "");
  const mime = descriptor.split(";")[0]?.trim() || undefined;
  const base64 = /;base64/i.test(descriptor);

  try {
    const buffer = base64
      ? Buffer.from(payload.replace(/\s+/g, ""), "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    const format = detectInlineFormat(mime, buffer);
    if (!format) return undefined;
    return { buffer, format, mime };
  } catch {
    return undefined;
  }
};

const parseJsonSafe = <T>(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const shouldRetryStatus = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchTextWithRetry = async (
  url: string,
  init: RequestInit,
  label: string
): Promise<{ status: number; text: string; contentType: string }> => {
  let lastError: unknown;
  let lastStatus = 0;

  for (let attempt = 0; attempt < TDF_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(TDF_FETCH_TIMEOUT_MS)
      });
      const text = await response.text();
      const status = Number(response.status || 0);
      if (response.ok) {
        return {
          status,
          text,
          contentType: String(response.headers.get("content-type") || "").toLowerCase()
        };
      }
      lastStatus = status;
      if (!shouldRetryStatus(status) || attempt === TDF_FETCH_ATTEMPTS - 1) {
        throw new Error(`TDF ${label} request failed (${status}) for ${url}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt === TDF_FETCH_ATTEMPTS - 1) break;
      await delay(300 * (attempt + 1) * (attempt + 1));
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`TDF ${label} request failed (${lastStatus || "unknown"}) for ${url}`);
};

const mapLimit = async <T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.floor(limit));
  const out = new Array<R>(items.length);
  let cursor = 0;

  const run = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
  return out;
};

const parseNextDataFromHtml = (html: string): Record<string, unknown> | undefined => {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return undefined;
  const parsed = parseJsonSafe<Record<string, unknown>>(match[1]);
  return isRecord(parsed) ? parsed : undefined;
};

const extractCatalogFromPageProps = (nextData: Record<string, unknown>): CatalogEntry[] => {
  const pageProps = isRecord(nextData.props) && isRecord(nextData.props.pageProps) ? nextData.props.pageProps : undefined;
  const showcaseData = Array.isArray(pageProps?.showcaseData) ? pageProps.showcaseData : [];

  const out: CatalogEntry[] = [];
  for (const row of showcaseData) {
    if (!isRecord(row)) continue;
    const slugObj = isRecord(row.slug) ? row.slug : undefined;
    const slug = asString(slugObj?.current) || asString(row.slug);
    if (!slug) continue;
    out.push({
      slug: slug.toLowerCase(),
      beta: Boolean(row.beta),
      title: asString(row.title) || asString(row.fontName),
      designerName: asString(row.designerName),
      numStyles: asFiniteNumber(row.numStyles)
    });
  }
  return out;
};

const normalizeInputUrl = (rawUrl: string): URL => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === TDF_HOST) parsed.hostname = `www.${TDF_HOST}`;
  parsed.hash = "";
  return parsed;
};

const resolveScope = (url: URL): ScrapeScope => {
  const segments = url.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
  if (segments[0] === "typeface" && segments[1]) {
    const slug = segments[1].trim();
    return {
      mode: "single",
      slug,
      preferredRoute: "typeface",
      targetUrl: `${TDF_ORIGIN}/typeface/${slug}`
    };
  }
  if (segments[0] === "beta-fonts" && segments[1]) {
    const slug = segments[1].trim();
    return {
      mode: "single",
      slug,
      preferredRoute: "beta-fonts",
      targetUrl: `${TDF_ORIGIN}/beta-fonts/${slug}`
    };
  }

  return {
    mode: "catalog",
    catalogUrl: `${TDF_ORIGIN}/typefaces`
  };
};

const extractFeatureTagsFromFont = (font: Record<string, unknown>): string[] => {
  const tags = isRecord(font.opentypeFeatures) && Array.isArray(font.opentypeFeatures.chars)
    ? font.opentypeFeatures.chars
    : [];
  return dedupeStringList(
    tags.map((tag) => (typeof tag === "string" ? tag.toLowerCase() : undefined))
  );
};

const parseSpecsSummary = (specsRaw: unknown): ParsedSpecsSummary => {
  const specs = Array.isArray(specsRaw) ? specsRaw : [];
  const texts: string[] = [];
  for (const block of specs) {
    if (!isRecord(block)) continue;
    const children = Array.isArray(block.children) ? block.children : [];
    const text = normalizeSpace(
      children
        .map((child) => (isRecord(child) ? asString(child.text) : undefined))
        .filter(Boolean)
        .join(" ")
    );
    if (text) texts.push(text);
  }

  let glyphCount: number | undefined;
  for (const text of texts) {
    const match = text.match(/glyph\s*count\s*:\s*(\d{2,6})/i);
    if (!match?.[1]) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) {
      glyphCount = parsed;
      break;
    }
  }

  const languageList = (() => {
    for (const text of texts) {
      const marker = "languages supported:";
      const lower = text.toLowerCase();
      const index = lower.indexOf(marker);
      if (index < 0) continue;
      const raw = normalizeSpace(text.slice(index + marker.length).replace(/^[:\s-]+/, ""));
      if (!raw) continue;
      return dedupeStringList(
        raw
          .split(",")
          .map((part) => normalizeSpace(part.replace(/\.+$/g, "")))
      );
    }
    return [];
  })();

  return {
    glyphCount,
    languages: languageList
  };
};

const parseVariableAxes = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = parseJsonSafe<Record<string, unknown>>(value);
  return isRecord(parsed) ? parsed : undefined;
};

const resolveVariableWeightRange = (axes: Record<string, unknown> | undefined, fallbackWeight: unknown): string | number => {
  const wght = isRecord(axes?.wght) ? axes?.wght : undefined;
  const min = asFiniteNumber(wght?.min);
  const max = asFiniteNumber(wght?.max);
  if (typeof min === "number" && typeof max === "number" && min < max) {
    return `${Math.round(min)} ${Math.round(max)}`;
  }

  const fallback = asString(fallbackWeight);
  if (fallback && /^\d+\s+\d+$/.test(fallback)) return fallback;
  const numeric = asFiniteNumber(fallbackWeight);
  if (typeof numeric === "number") return Math.round(numeric);
  return "Variable";
};

const resolveStyleSource = (font: Record<string, unknown>, familyName: string, isVariable: boolean): StyleSource => {
  const fontName = asString(font.fontName) || familyName;
  const typefaceName = asString(font.typefaceName) || familyName;
  const metaData = isRecord(font.metaData) ? font.metaData : undefined;
  const weightName = asString(font.weightName);
  const styleValue = asString(font.style);
  const metaSubFamily = asString(metaData?.subfamilyName);
  const fromFontName =
    stripLeadingLabel(stripLeadingLabel(fontName, familyName), typefaceName) || undefined;

  const styleName = (() => {
    const candidates = [fromFontName, weightName, metaSubFamily, styleValue]
      .map((item) => normalizeSpace(item || ""))
      .filter(Boolean);
    const nonRegular = candidates.find((item) => normalizeToken(item) !== "regular");
    return nonRegular || candidates[0] || (isVariable ? "Variable" : "Regular");
  })();

  const style = inferStyleFromSignals(styleName, styleValue, fontName, weightName, metaSubFamily);
  const variableAxes = parseVariableAxes(font.variableAxes);
  const weight = isVariable
    ? resolveVariableWeightRange(variableAxes, font.weight)
    : asFiniteNumber(font.weight) ?? asString(font.weight) ?? inferWeightFromStyleName(styleName);

  return {
    id: asString(font._id),
    fontName,
    familyName,
    styleName,
    style,
    weight,
    isVariable,
    fontSrc: asString(font.fontSrc),
    featureTags: extractFeatureTagsFromFont(font),
    postscriptName: asString(metaData?.postscriptName),
    variableAxes
  };
};

const formatRank = (format: FontMetadata["format"]): number => {
  switch (format) {
    case "woff2":
      return 0;
    case "woff":
      return 1;
    case "otf":
      return 2;
    case "ttf":
      return 3;
    case "zip":
      return 5;
    default:
      return 9;
  }
};

const extractCssAssets = async (
  cssUrl: string,
  familyName: string,
  styleName: string
): Promise<ResolvedCssAsset[]> => {
  const cssResponse = await fetchTextWithRetry(
    cssUrl,
    {
      headers: {
        "User-Agent": TDF_UA,
        Accept: "text/css,*/*;q=0.8",
        Referer: TDF_ORIGIN,
        Origin: TDF_ORIGIN
      }
    },
    "font-css"
  );

  const cssText = cssResponse.text;
  const matches = [...cssText.matchAll(/url\(([^)]+)\)/gi)];
  const assets: ResolvedCssAsset[] = [];

  for (const match of matches) {
    const raw = normalizeSpace(String(match[1] || "").replace(/^['"]+|['"]+$/g, ""));
    if (!raw) continue;

    if (raw.startsWith("data:")) {
      const decoded = decodeInlineDataUri(raw);
      if (!decoded) continue;
      const token = putInlineFontAsset({
        buffer: decoded.buffer,
        format: decoded.format,
        contentType: decoded.mime,
        fileNameHint: `${toFileToken(familyName)}-${toFileToken(styleName)}.${decoded.format}`,
        foundry: "The Designers Foundry",
        family: familyName
      });
      assets.push({
        url: `inline-font://${token}`,
        format: decoded.format,
        sourceType: "inline-data-uri",
        sourceCssUrl: cssUrl
      });
      continue;
    }

    try {
      const absoluteUrl = new URL(raw, cssUrl).href;
      const format = inferFormatFromUrl(absoluteUrl);
      if (!format) continue;
      assets.push({
        url: absoluteUrl,
        format,
        sourceType: "css-direct-url",
        sourceCssUrl: cssUrl
      });
    } catch {
      // skip malformed url
    }
  }

  return assets.sort((a, b) => formatRank(a.format) - formatRank(b.format));
};

const buildTargetProfile = (params: {
  familyName: string;
  slug: string;
  pageUrl: string;
  expectedStyles: string[];
  optionalExcludedStyles: string[];
  styleSources: StyleSource[];
  glyphCount?: number;
  languageCount: number;
}): Record<string, unknown> => {
  const staticSources = params.styleSources.filter((style) => !style.isVariable);
  const featureSets = staticSources.map((style) => style.featureTags).filter((tags) => tags.length > 0);
  const unionFeatureTags = dedupeStringList(featureSets.flat());
  const intersectionFeatureTags = featureSets.length === 0
    ? []
    : featureSets[0].filter((tag) => featureSets.every((set) => set.includes(tag)));
  const unstableRequiredFeatureTags = new Set(["clig", "calt", "rlig", "locl"]);
  const requiredFeatureTags = intersectionFeatureTags.filter(
    (tag) => !unstableRequiredFeatureTags.has(tag.toLowerCase())
  );
  const ligatureFeatureTags = unionFeatureTags.filter((tag) => /(liga|dlig|hlig|clig|rlig)/i.test(tag));
  const staticPostscriptNames = dedupeStringList(
    staticSources.map((style) => asString(style.postscriptName))
  );
  const familyPostscript =
    staticPostscriptNames.find((postscript) => /\b(regular|normal|roman)\b/i.test(postscript)) ||
    staticPostscriptNames[0];

  return {
    profileId: "thedesignersfoundry-target-profile-v1",
    source: "tdf-next-data+sanity-inline-css",
    foundry: "The Designers Foundry",
    styleScope: "family-style",
    strictMissingStyles: true,
    family: params.familyName,
    familyDisplay: params.familyName,
    familySlug: params.slug,
    targetSlug: params.slug,
    targetUrl: params.pageUrl,
    familyPostscript,
    expectedStyles: params.expectedStyles,
    expectedStyleCount: params.expectedStyles.length,
    expectedPostscriptNames: staticPostscriptNames,
    sessionPostscriptNames: staticPostscriptNames,
    optionalExcludedStyles: params.optionalExcludedStyles,
    optionalExcludedStyleCount: params.optionalExcludedStyles.length,
    styleMap: params.styleSources.map((style) => ({
      sourceId: style.id,
      styleName: style.styleName,
      expectedStyle: `${params.familyName} ${style.styleName}`.trim(),
      style: style.style,
      weight: style.weight,
      variable: style.isVariable,
      postscriptName: style.postscriptName
    })),
    requiredFeatureTags,
    catalogFeatureTags: unionFeatureTags,
    ligatureFeatureTags,
    glyphCount: params.glyphCount,
    languageCount: params.languageCount,
    requiredFormats: ["woff2"],
    sourceLimitedFormats: ["woff2"],
    collectedAt: new Date().toISOString()
  };
};

const fetchFamilyDetail = async (
  buildId: string,
  slug: string,
  preferredRoute?: "typeface" | "beta-fonts"
): Promise<{
  route: "typeface" | "beta-fonts";
  pageUrl: string;
  typefaceData: Record<string, unknown>;
}> => {
  const routes: Array<"typeface" | "beta-fonts"> = [];
  if (preferredRoute) routes.push(preferredRoute);
  if (!routes.includes("typeface")) routes.push("typeface");
  if (!routes.includes("beta-fonts")) routes.push("beta-fonts");

  for (const route of routes) {
    const dataUrl = `${TDF_ORIGIN}/_next/data/${buildId}/${route}/${slug}.json?slug=${encodeURIComponent(slug)}`;
    try {
      const jsonResponse = await fetchTextWithRetry(
        dataUrl,
        {
          headers: {
            "User-Agent": TDF_UA,
            Accept: "application/json,text/plain,*/*",
            Referer: `${TDF_ORIGIN}/${route}/${slug}`,
            Origin: TDF_ORIGIN
          }
        },
        "next-data"
      );
      const parsed = parseJsonSafe<Record<string, unknown>>(jsonResponse.text);
      const pageProps = isRecord(parsed?.pageProps) ? parsed?.pageProps : undefined;
      const typefaceData = isRecord(pageProps?.typefaceData) ? pageProps?.typefaceData : undefined;
      if (typefaceData) {
        return {
          route,
          pageUrl: `${TDF_ORIGIN}/${route}/${slug}`,
          typefaceData
        };
      }
    } catch {
      // try next route
    }
  }

  throw new Error(`Unable to resolve TDF family payload for slug "${slug}".`);
};

const buildCatalogEntries = async (
  buildId: string,
  catalogUrl: string
): Promise<CatalogEntry[]> => {
  const dataUrl = `${TDF_ORIGIN}/_next/data/${buildId}/typefaces.json`;
  try {
    const jsonResponse = await fetchTextWithRetry(
      dataUrl,
      {
        headers: {
          "User-Agent": TDF_UA,
          Accept: "application/json,text/plain,*/*",
          Referer: catalogUrl,
          Origin: TDF_ORIGIN
        }
      },
      "catalog-next-data"
    );
    const parsed = parseJsonSafe<Record<string, unknown>>(jsonResponse.text);
    if (isRecord(parsed) && isRecord(parsed.pageProps)) {
      const pseudoNextData = { props: { pageProps: parsed.pageProps } } as Record<string, unknown>;
      const extracted = extractCatalogFromPageProps(pseudoNextData);
      if (extracted.length > 0) return extracted;
    }
  } catch {
    // fallback to HTML parsing below
  }

  const htmlResponse = await fetchTextWithRetry(
    catalogUrl,
    {
      headers: {
        "User-Agent": TDF_UA,
        Accept: "text/html,application/xhtml+xml"
      }
    },
    "catalog-html"
  );
  const nextData = parseNextDataFromHtml(htmlResponse.text);
  if (!nextData) throw new Error("TDF catalog page missing __NEXT_DATA__ payload.");
  const extracted = extractCatalogFromPageProps(nextData);
  if (extracted.length === 0) throw new Error("TDF catalog payload did not expose showcase entries.");
  return extracted;
};

const resolveBuildId = async (scope: ScrapeScope): Promise<string> => {
  const probeUrl = scope.mode === "single" ? scope.targetUrl : scope.catalogUrl;
  const htmlResponse = await fetchTextWithRetry(
    probeUrl,
    {
      headers: {
        "User-Agent": TDF_UA,
        Accept: "text/html,application/xhtml+xml"
      }
    },
    "probe-html"
  );
  const nextData = parseNextDataFromHtml(htmlResponse.text);
  const buildId = asString(nextData?.buildId);
  if (buildId) return buildId;

  const catalogResponse = await fetchTextWithRetry(
    `${TDF_ORIGIN}/typefaces`,
    {
      headers: {
        "User-Agent": TDF_UA,
        Accept: "text/html,application/xhtml+xml"
      }
    },
    "catalog-probe-html"
  );
  const catalogData = parseNextDataFromHtml(catalogResponse.text);
  const catalogBuildId = asString(catalogData?.buildId);
  if (catalogBuildId) return catalogBuildId;
  throw new Error("TDF buildId not found.");
};

const pickCatalogEntries = (scope: ScrapeScope, catalog: CatalogEntry[]): CatalogEntry[] => {
  const bySlug = new Map<string, CatalogEntry>();
  for (const item of catalog) {
    if (!item.slug) continue;
    if (!bySlug.has(item.slug)) bySlug.set(item.slug, item);
  }

  if (scope.mode === "single") {
    const existing = bySlug.get(scope.slug);
    if (existing) return [existing];
    return [
      {
        slug: scope.slug,
        beta: scope.preferredRoute === "beta-fonts",
        title: toTitleWords(scope.slug)
      }
    ];
  }

  return [...bySlug.values()];
};

const buildFamilyFonts = async (
  buildId: string,
  entry: CatalogEntry,
  cssAssetCache: Map<string, ResolvedCssAsset[]>
): Promise<TypefaceFamilyResult> => {
  const detail = await fetchFamilyDetail(buildId, entry.slug, entry.beta ? "beta-fonts" : "typeface");
  const typefaceData = detail.typefaceData;
  const familyName = asString(typefaceData.title) || entry.title || toTitleWords(entry.slug);
  const designerName = asString(typefaceData.designerName) || entry.designerName;

  const staticFonts = Array.isArray(typefaceData.fonts) ? typefaceData.fonts.filter(isRecord) : [];
  const variableRaw = Array.isArray(typefaceData.variableFont)
    ? typefaceData.variableFont.filter(isRecord)
    : isRecord(typefaceData.variableFont)
      ? [typefaceData.variableFont]
      : [];

  const styleSources = [
    ...staticFonts.map((font) => resolveStyleSource(font, familyName, false)),
    ...variableRaw.map((font) => resolveStyleSource(font, familyName, true))
  ];

  const expectedStyles = dedupeStringList(
    styleSources.filter((style) => !style.isVariable).map((style) => `${familyName} ${style.styleName}`.trim())
  );
  const expectedStyleTokens = new Set(
    expectedStyles.map((style) => normalizeQualityStyleTokenCompat(style)).filter((token) => token.length > 0)
  );
  const optionalExcludedStyles = dedupeStringList(
    styleSources
      .filter((style) => style.isVariable)
      .map((style) => `${familyName} ${style.styleName}`.trim())
      .filter((style) => {
        const token = normalizeQualityStyleTokenCompat(style);
        if (!token) return false;
        return !expectedStyleTokens.has(token);
      })
  );

  const specsSummary = parseSpecsSummary(typefaceData.specs);
  const targetProfile = buildTargetProfile({
    familyName,
    slug: entry.slug,
    pageUrl: detail.pageUrl,
    expectedStyles,
    optionalExcludedStyles,
    styleSources,
    glyphCount: specsSummary.glyphCount,
    languageCount: specsSummary.languages.length
  });

  const fonts: FontMetadata[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const source of styleSources) {
    if (!source.fontSrc) {
      warnings.push(`missing fontSrc for style "${source.styleName}"`);
      continue;
    }

    let assets = cssAssetCache.get(source.fontSrc);
    if (!assets) {
      try {
        assets = await extractCssAssets(source.fontSrc, source.familyName, source.styleName);
      } catch (error) {
        warnings.push(`failed css fetch for "${source.styleName}": ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      cssAssetCache.set(source.fontSrc, assets);
    }

    if (!assets || assets.length === 0) {
      warnings.push(`no downloadable assets resolved for "${source.styleName}"`);
      continue;
    }

    const asset = assets[0];
    const uniqueKey = `${asset.url}::${source.styleName}::${source.weight}::${source.style}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const fullName = `${source.familyName} ${source.styleName}`.trim();
    const familyToken = toFileToken(source.familyName);
    const styleToken = toFileToken(source.styleName);
    const baseMetadata: Record<string, unknown> = {
      foundry: "The Designers Foundry",
      family: source.familyName,
      familySlug: entry.slug,
      styleName: source.styleName,
      fullName,
      pageUrl: detail.pageUrl,
      targetUrl: detail.pageUrl,
      sourceRoute: detail.route,
      sourceFontId: source.id,
      sourceCssUrl: source.fontSrc,
      sourceType: asset.sourceType,
      postscriptName: source.postscriptName,
      featureTags: source.featureTags,
      glyphCount: specsSummary.glyphCount,
      languageCount: specsSummary.languages.length,
      format: asset.format,
      fileNameHint: `${familyToken}-${styleToken}.${asset.format}`,
      forceMetadataRepair: true,
      sourceLimitedFormats: ["woff2"],
      targetProfile
    };

    if (source.isVariable) {
      baseMetadata.skipConversion = true;
      baseMetadata.disableInstanceExplosion = true;
    }

    if (/^https?:\/\//i.test(asset.url)) {
      baseMetadata.headers = {
        Origin: TDF_ORIGIN,
        Referer: detail.pageUrl,
        Accept: "*/*",
        "User-Agent": TDF_UA
      };
    }

    fonts.push({
      url: asset.url,
      format: asset.format,
      family: source.familyName,
      style: source.style,
      weight: source.weight,
      downloadable: true,
      note: asset.sourceType === "inline-data-uri"
        ? "TDF inline WOFF2 extracted from Sanity CSS and cached as inline-font asset."
        : "TDF font asset resolved from Sanity CSS.",
      metadata: baseMetadata
    });
  }

  const features = dedupeStringList(styleSources.flatMap((style) => style.featureTags));

  return {
    slug: entry.slug,
    route: detail.route,
    title: familyName,
    designerName,
    pageUrl: detail.pageUrl,
    expectedStyles,
    features,
    glyphCount: specsSummary.glyphCount,
    languageCount: specsSummary.languages.length,
    fonts,
    resolutionWarnings: warnings
  };
};

const buildFallbackResult = (url: string, targetUrl: string, reason: string): ScrapeResult => ({
  scraperName: "The Designers Foundry Scraper",
  foundryName: "The Designers Foundry",
  fonts: [
    {
      url: "browser-intercept",
      family: "The Designers Foundry",
      format: "woff2",
      style: "Normal",
      weight: "Regular",
      downloadable: true,
      metadata: {
        foundry: "The Designers Foundry",
        pageUrl: targetUrl,
        targetUrl,
        reason
      }
    }
  ],
  originalUrl: url,
  targetUrl,
  expectedCount: 1,
  metadata: {
    foundry: "The Designers Foundry",
    fallback: true,
    reason
  }
});

export const TheDesignersFoundryScraper: Scraper = {
  id: "thedesignersfoundry",
  name: "The Designers Foundry Scraper",

  canHandle(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === TDF_HOST || host === `www.${TDF_HOST}`;
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const normalized = normalizeInputUrl(url);
    const scope = resolveScope(normalized);
    const targetUrl = scope.mode === "single" ? scope.targetUrl : scope.catalogUrl;

    try {
      const buildId = await resolveBuildId(scope);
      const catalogEntries = await buildCatalogEntries(buildId, `${TDF_ORIGIN}/typefaces`);
      const selectedEntries = pickCatalogEntries(scope, catalogEntries);
      const cssAssetCache = new Map<string, ResolvedCssAsset[]>();

      const families = await mapLimit(selectedEntries, scope.mode === "single" ? 1 : 4, async (entry) =>
        buildFamilyFonts(buildId, entry, cssAssetCache)
      );

      const fonts = families.flatMap((family) => family.fonts);
      if (fonts.length === 0) {
        return buildFallbackResult(url, targetUrl, "no-downloadable-font-assets");
      }

      const expectedCount = families.reduce((sum, family) => sum + family.expectedStyles.length, 0);

      return {
        scraperName: this.name,
        foundryName: "The Designers Foundry",
        fonts,
        originalUrl: url,
        targetUrl,
        expectedCount: expectedCount || fonts.length,
        metadata: {
          foundry: "The Designers Foundry",
          source: "tdf-next-data+sanity-inline-css",
          scope: scope.mode === "single" ? "single-family" : "catalog-all-families",
          buildId,
          familyCount: families.length,
          totalExpectedStyles: expectedCount,
          totalResolvedFonts: fonts.length,
          families: families.map((family) => ({
            slug: family.slug,
            route: family.route,
            title: family.title,
            designerName: family.designerName,
            pageUrl: family.pageUrl,
            expectedStyleCount: family.expectedStyles.length,
            resolvedFontCount: family.fonts.length,
            featuresCount: family.features.length,
            glyphCount: family.glyphCount,
            languageCount: family.languageCount,
            warnings: family.resolutionWarnings
          })),
          unresolvedFamilies: families
            .filter((family) => family.fonts.length === 0 || family.resolutionWarnings.length > 0)
            .map((family) => ({
              slug: family.slug,
              resolvedFontCount: family.fonts.length,
              warnings: family.resolutionWarnings
            }))
        }
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return buildFallbackResult(url, targetUrl, reason);
    }
  }
};
