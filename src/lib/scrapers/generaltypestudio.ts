import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const GTS_HOST = "www.generaltypestudio.com";
const GTS_ORIGIN = "https://www.generaltypestudio.com";
const GTS_GRAPHQL = `${GTS_ORIGIN}/graphql`;
const GTS_FETCH_TIMEOUT_MS = 30000;
const GTS_FETCH_MAX_RETRIES = 3;
const GTS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const GTS_FEATURE_TAG_RE =
  /\b(ss\d{2}|cv\d{2}|liga|dlig|calt|salt|onum|lnum|pnum|tnum|frac|afrc|sups|subs|smcp|c2sc|case|ordn|kern|zero)\b/gi;

type TypejiStyleMode = "Normal" | "Italic";

type TypejiStyleRow = {
  id?: string;
  collectionId?: string;
  collectionName?: string;
  familyName: string;
  styleName: string;
  fullName: string;
  style: TypejiStyleMode;
  weight?: number;
  cssFamily?: string;
  skuId?: string;
  supportedLanguages?: string[];
  source: "store-modal" | "html-options" | "css-font-face";
};

type TypejiLicenseOption = {
  id?: string;
  name?: string;
  amount?: string;
};

type TypejiLicenseVariable = {
  id?: string;
  name?: string;
  variableType?: string;
  options: TypejiLicenseOption[];
};

type TypejiLicense = {
  id?: string;
  name?: string;
  defaultSelected?: boolean;
  variables: TypejiLicenseVariable[];
};

type TypejiStoreProfile = {
  collectionId: string;
  collectionName?: string;
  cssUrl?: string;
  cssUrls: string[];
  styles: TypejiStyleRow[];
  licenses: TypejiLicense[];
  languages: string[];
  featureCssFamily?: string;
};

type TypejiCharacterProfile = {
  cssUrl?: string;
  cssUrls: string[];
  glyphCount?: number;
  featureTags: string[];
  languages: string[];
  featureCssFamily?: string;
  fontStyleNames: string[];
};

type TypejiCssFace = {
  fontFamily: string;
  styleName: string;
  sourceUrl: string;
  format: "woff2" | "woff" | "otf" | "ttf" | "eot";
  style: TypejiStyleMode;
};

type GraphQlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

const STORE_MODAL_PRODUCT_QUERY = `query StoreModalProductRefetchQuery($id:ID!){node(id:$id){__typename ... on FontCollection {id name cssUrl featureStyle {cssFamily name supportedLanguages} fontStyles {id name cssFamily cssWeight supportedLanguages sku {id}} children(collectionTypes:[FAMILY]) {id name cssUrl featureStyle {cssFamily name supportedLanguages} fontStyles {id name cssFamily cssWeight supportedLanguages sku {id}}} licenses {id name defaultSelected variables:licenseVariables {id name variableType options:licenseOptions {id name amount}}}}}}`;

const CHARACTER_VIEWER_QUERY = `query CharacterViewerIDQuery($collectionId: ID!){node(id:$collectionId){__typename ... on FontCollection {id name cssUrl collectionType glyphGroups {name characterSets {features}} featureStyle {cssFamily name glyphNames {features name} verticalMetrics {unitsPerEm ascender descender xHeight capHeight lineGap}} fontStyles {id cssFamily name} children(collectionTypes:[FAMILY]) {id name cssUrl fontStyles {id cssFamily name}}}}}`;

const SPECIMEN_LINK_QUERY = `query SpecimenLinkQuery($collectionId: ID!){node(id:$collectionId){__typename ... on FontCollection {id pdfs {name url thumbnailUrl}}}}`;

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

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const next = asString(item);
    if (next) out.push(next);
  }
  return out;
};

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const dedupeStringList = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const cleaned = item.trim();
    if (!cleaned) continue;
    const token = normalizeToken(cleaned);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(cleaned);
  }
  return out;
};

const decodeMojibakeLatin1Utf8 = (value: string): string => {
  if (!/[\u00C2\u00C3][\x80-\xBF]/.test(value)) return value;
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
};

const decodeHtml = (value: string): string =>
  decodeMojibakeLatin1Utf8(
    value
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
  );

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripFamilyPrefix = (value: string, familyName: string): string => {
  const label = value.replace(/\s+/g, " ").trim();
  const family = familyName.replace(/\s+/g, " ").trim();
  if (!label || !family) return label;
  const matcher = new RegExp(`^${escapeRegExp(family)}\\s+`, "i");
  const stripped = label.replace(matcher, "").trim();
  if (stripped) return stripped;
  return normalizeToken(label) === normalizeToken(family) ? "Regular" : label;
};

const normalizeStyleLabel = (value: string): string => {
  const cleaned = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/semi[\s-]*bold/gi, "Semibold")
    .replace(/extra[\s-]*light/gi, "Extralight")
    .replace(/extra[\s-]*bold/gi, "Extrabold");
  if (!cleaned) return "Regular";
  return cleaned
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const inferStyleMode = (styleName: string): TypejiStyleMode => (/italic|oblique/i.test(styleName) ? "Italic" : "Normal");

const inferWeightFromStyleName = (styleName: string): number => {
  const token = normalizeToken(styleName);
  if (token.includes("thin")) return 200;
  if (token.includes("light")) return 300;
  if (token.includes("book")) return 400;
  if (token.includes("regular")) return 500;
  if (token.includes("medium")) return 600;
  if (token.includes("bold")) return 700;
  if (token.includes("black")) return 800;
  return 400;
};

const normalizeTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === "generaltypestudio.com") {
    parsed.hostname = GTS_HOST;
  }
  return parsed.href;
};

const toTitleFromSlug = (slug: string): string =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const extractFamilySlug = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0].toLowerCase() === "fonts") {
      return parts[1];
    }
  } catch {
    // ignore invalid URL
  }
  return undefined;
};

const fetchTextWithRetry = async (
  url: string,
  headers: Record<string, string>,
  timeoutMs = GTS_FETCH_TIMEOUT_MS
): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GTS_FETCH_MAX_RETRIES; attempt += 1) {
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
      if (attempt < GTS_FETCH_MAX_RETRIES) {
        await sleep(500 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("General Type Studio fetch failed");
};

const fetchGraphQlWithRetry = async <T>(params: {
  queryName: string;
  query: string;
  variables: Record<string, unknown>;
  referer: string;
}): Promise<T | undefined> => {
  const { queryName, query, variables, referer } = params;
  const endpoint = `${GTS_GRAPHQL}?queryName=${encodeURIComponent(queryName)}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= GTS_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GTS_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": GTS_UA,
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: GTS_ORIGIN,
          Referer: referer
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const envelope = (await response.json()) as GraphQlEnvelope<T>;
      if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
        const message = envelope.errors.map((item) => item?.message || "graphql-error").join(" | ");
        throw new Error(message);
      }

      if (envelope.data) return envelope.data;
      throw new Error("General Type Studio GraphQL empty data payload");
    } catch (error) {
      lastError = error;
      if (attempt < GTS_FETCH_MAX_RETRIES) {
        await sleep(500 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn(`[GeneralTypeStudioScraper] GraphQL ${queryName} failed:`, lastError);
  return undefined;
};

const extractFamilyNameFromHtml = (html: string, fallbackFamily: string): string => {
  const bannerMatch = html.match(/<div[^>]+id=["']font-banner["'][\s\S]*?<p[^>]*>([^<]+)<\/p>/i);
  const bannerName = decodeHtml((bannerMatch?.[1] || "").trim());
  if (bannerName) return bannerName;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = decodeHtml((titleMatch?.[1] || "").trim());
  if (title) {
    const head = title.split("|")[0]?.split("Ã¢â‚¬â€œ")[0]?.split("-")[0]?.trim();
    if (head) {
      const normalizedHead = head
        .replace(/^\s*General\s+Type\s+Studio\s*:\s*/i, "")
        .trim();
      if (normalizedHead) return normalizedHead;
      return head;
    }
  }

  return fallbackFamily;
};

const extractCollectionIdFromHtml = (html: string): string | undefined => {
  const patterns = [
    /fontdue-store-route=["'][^"']*product\/([^"']+)["']/i,
    /collection-id=["']([^"']+)["']/i,
    /fontdue-character-viewer[^>]+collection-id=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = asString(match?.[1]);
    if (value) return decodeHtml(value);
  }
  return undefined;
};

const extractSpecimenPdfUrls = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+?(?:\.pdf(?:\?[^"']*)?|\/pdfs\/[a-z0-9-]+(?:\?[^"']*)?))["']/gi)) {
    const raw = asString(match[1]);
    if (!raw) continue;
    try {
      out.add(new URL(decodeHtml(raw), baseUrl).href);
    } catch {
      // skip malformed URL
    }
  }
  return Array.from(out);
};

const extractHtmlStyleNames = (html: string, familyName: string): string[] => {
  const out = new Set<string>();
  const styleHint = /(thin|light|book|regular|medium|bold|black|italic|oblique)/i;
  for (const match of html.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/gi)) {
    const raw = decodeHtml(String(match[1] || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!raw || !styleHint.test(raw)) continue;
    const stripped = normalizeStyleLabel(stripFamilyPrefix(raw, familyName));
    if (stripped) out.add(stripped);
  }
  return Array.from(out);
};

const extractFeatureTagsFromHtml = (html: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/<span[^>]*class=["'][^"']*ot-name[^"']*["'][^>]*>([^<]+)<\/span>/gi)) {
    const raw = decodeHtml(String(match[1] || "")).trim().toLowerCase();
    if (!raw) continue;
    if (/^(ss\d{2}|cv\d{2}|liga|dlig|calt|salt|onum|lnum|pnum|tnum|frac|afrc|sups|subs|smcp|c2sc|case|ordn|kern|zero)$/.test(raw)) {
      out.add(raw);
    }
  }
  return Array.from(out).sort();
};

const extractGlyphCountFromHtml = (html: string): number | undefined => {
  const match = html.match(/Glyphs#<\/span>\s*<span[^>]*>\s*([0-9]{2,6})\s*<\/span>/i);
  const parsed = match?.[1] ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const extractCollectionCssUrlsFromHtml = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/<link[^>]+href=["']([^"']*fonts\.fontdue\.com\/generaltype\/css\/[^"']+?\.css[^"']*)["'][^>]*>/gi)) {
    const raw = asString(match[1]);
    if (!raw) continue;
    try {
      out.add(new URL(raw, baseUrl).href);
    } catch {
      // ignore malformed URL
    }
  }
  return Array.from(out);
};

const matchCssUrlByCollectionId = (cssUrls: string[], collectionId: string): string | undefined => {
  const encoded = encodeURIComponent(collectionId);
  const decodedId = decodeURIComponent(collectionId);
  for (const cssUrl of cssUrls) {
    if (cssUrl.includes(encoded) || decodeURIComponent(cssUrl).includes(decodedId)) return cssUrl;

    try {
      const parsed = new URL(cssUrl);
      const fileName = parsed.pathname.split("/").pop() || "";
      const stem = decodeURIComponent(fileName.replace(/\.css$/i, ""));
      if (stem === collectionId) return cssUrl;
    } catch {
      // continue
    }
  }
  return undefined;
};

const collectFeatureTagsFromUnknown = (value: unknown, out: Set<string>): void => {
  if (typeof value === "string") {
    for (const match of value.matchAll(GTS_FEATURE_TAG_RE)) {
      const tag = String(match[1] || "").toLowerCase();
      if (tag) out.add(tag);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFeatureTagsFromUnknown(item, out);
    }
    return;
  }

  if (!isRecord(value)) return;
  for (const entry of Object.values(value)) {
    collectFeatureTagsFromUnknown(entry, out);
  }
};

const buildStoreStyles = (params: {
  parent: Record<string, unknown>;
  collectionId: string;
  collectionName?: string;
  fallbackFamily: string;
}): TypejiStyleRow[] => {
  const { parent, collectionId, collectionName, fallbackFamily } = params;
  const parentFamilyRaw =
    asString(parent.name) ||
    (isRecord(parent.featureStyle) ? asString(parent.featureStyle.cssFamily) : undefined) ||
    collectionName ||
    fallbackFamily;
  const parentFamily = parentFamilyRaw || fallbackFamily;
  const rows: TypejiStyleRow[] = [];
  const fontStyles = Array.isArray(parent.fontStyles) ? parent.fontStyles.filter(isRecord) : [];

  for (const style of fontStyles) {
    const nameRaw = asString(style.name) || "Regular";
    const styleName = normalizeStyleLabel(stripFamilyPrefix(nameRaw, parentFamily));
    const fullName = `${parentFamily} ${styleName}`.trim();
    const weight = asNumber(style.cssWeight) ?? inferWeightFromStyleName(styleName);
    const sku = isRecord(style.sku) ? style.sku : undefined;
    rows.push({
      id: asString(style.id),
      collectionId,
      collectionName,
      familyName: parentFamily,
      styleName,
      fullName,
      style: inferStyleMode(styleName),
      weight,
      cssFamily: asString(style.cssFamily),
      skuId: asString(sku?.id),
      supportedLanguages: asStringArray(style.supportedLanguages),
      source: "store-modal"
    });
  }

  return rows;
};

const parseStoreProfile = (
  payload: unknown,
  collectionId: string,
  fallbackFamily: string
): TypejiStoreProfile | undefined => {
  if (!isRecord(payload) || !isRecord(payload.node)) return undefined;
  const node = payload.node;
  const typeName = asString(node.__typename);
  if (!typeName || typeName.toLowerCase() !== "fontcollection") return undefined;

  const collectionName = asString(node.name) || fallbackFamily;
  const cssUrlCandidates = new Set<string>();
  const parentCssUrl = asString(node.cssUrl);
  if (parentCssUrl) cssUrlCandidates.add(parentCssUrl);
  const styles = buildStoreStyles({
    parent: node,
    collectionId,
    collectionName,
    fallbackFamily
  });

  const children = Array.isArray(node.children) ? node.children.filter(isRecord) : [];
  for (const child of children) {
    const childCssUrl = asString(child.cssUrl);
    if (childCssUrl) cssUrlCandidates.add(childCssUrl);
    styles.push(
      ...buildStoreStyles({
        parent: child,
        collectionId: asString(child.id) || collectionId,
        collectionName: asString(child.name) || collectionName,
        fallbackFamily
      })
    );
  }

  const licenses: TypejiLicense[] = [];
  const licenseRows = Array.isArray(node.licenses) ? node.licenses.filter(isRecord) : [];
  for (const license of licenseRows) {
    const variables: TypejiLicenseVariable[] = [];
    const varRows = Array.isArray(license.variables) ? license.variables.filter(isRecord) : [];
    for (const variable of varRows) {
      const options: TypejiLicenseOption[] = [];
      const optionRows = Array.isArray(variable.options) ? variable.options.filter(isRecord) : [];
      for (const option of optionRows) {
        options.push({
          id: asString(option.id),
          name: asString(option.name),
          amount: asString(option.amount)
        });
      }
      variables.push({
        id: asString(variable.id),
        name: asString(variable.name),
        variableType: asString(variable.variableType),
        options
      });
    }

    licenses.push({
      id: asString(license.id),
      name: asString(license.name),
      defaultSelected: typeof license.defaultSelected === "boolean" ? license.defaultSelected : undefined,
      variables
    });
  }

  const languages = new Set<string>();
  if (isRecord(node.featureStyle)) {
    for (const language of asStringArray(node.featureStyle.supportedLanguages)) {
      languages.add(language);
    }
  }
  for (const row of styles) {
    for (const language of row.supportedLanguages || []) {
      languages.add(language);
    }
  }

  return {
    collectionId,
    collectionName,
    cssUrl: parentCssUrl,
    cssUrls: Array.from(cssUrlCandidates),
    styles,
    licenses,
    languages: Array.from(languages),
    featureCssFamily: isRecord(node.featureStyle) ? asString(node.featureStyle.cssFamily) : undefined
  };
};

const parseCharacterProfile = (
  payload: unknown,
  collectionId: string,
  fallbackFamily: string
): TypejiCharacterProfile | undefined => {
  if (!isRecord(payload) || !isRecord(payload.node)) return undefined;
  const node = payload.node;
  const typeName = asString(node.__typename);
  if (!typeName || typeName.toLowerCase() !== "fontcollection") return undefined;
  if (asString(node.id) !== collectionId) {
    // Continue anyway if API responds with aliased ID.
  }

  const featureTags = new Set<string>();
  const cssUrlCandidates = new Set<string>();
  const parentCssUrl = asString(node.cssUrl);
  if (parentCssUrl) cssUrlCandidates.add(parentCssUrl);
  if (isRecord(node.featureStyle)) {
    const glyphNames = Array.isArray(node.featureStyle.glyphNames) ? node.featureStyle.glyphNames : [];
    for (const glyph of glyphNames) {
      if (!isRecord(glyph)) continue;
      collectFeatureTagsFromUnknown(glyph.features, featureTags);
    }
  }

  const glyphGroups = Array.isArray(node.glyphGroups) ? node.glyphGroups : [];
  for (const group of glyphGroups) {
    if (!isRecord(group)) continue;
    const sets = Array.isArray(group.characterSets) ? group.characterSets : [];
    for (const characterSet of sets) {
      if (!isRecord(characterSet)) continue;
      collectFeatureTagsFromUnknown(characterSet.features, featureTags);
    }
  }

  const languages = new Set<string>();
  if (isRecord(node.featureStyle)) {
    for (const language of asStringArray(node.featureStyle.supportedLanguages)) {
      languages.add(language);
    }
  }

  const fontStyleNames: string[] = [];
  const styleRows = Array.isArray(node.fontStyles) ? node.fontStyles.filter(isRecord) : [];
  for (const style of styleRows) {
    const styleName = asString(style.name);
    if (styleName) fontStyleNames.push(styleName);
  }

  const children = Array.isArray(node.children) ? node.children.filter(isRecord) : [];
  for (const child of children) {
    const childCssUrl = asString(child.cssUrl);
    if (childCssUrl) cssUrlCandidates.add(childCssUrl);
    const childStyles = Array.isArray(child.fontStyles) ? child.fontStyles.filter(isRecord) : [];
    for (const style of childStyles) {
      const styleName = asString(style.name);
      if (styleName) fontStyleNames.push(styleName);
    }
  }

  const glyphCount = (() => {
    if (!isRecord(node.featureStyle)) return undefined;
    const glyphNames = Array.isArray(node.featureStyle.glyphNames) ? node.featureStyle.glyphNames : [];
    return glyphNames.length > 0 ? glyphNames.length : undefined;
  })();

  const collectionName =
    asString(node.name) ||
    (isRecord(node.featureStyle) ? asString(node.featureStyle.name) : undefined) ||
    fallbackFamily;

  return {
    cssUrl: parentCssUrl,
    cssUrls: Array.from(cssUrlCandidates),
    glyphCount,
    featureTags: Array.from(featureTags).sort(),
    languages: Array.from(languages).sort(),
    featureCssFamily: isRecord(node.featureStyle) ? asString(node.featureStyle.cssFamily) : collectionName,
    fontStyleNames: dedupeStringList(fontStyleNames)
  };
};

const parseSpecimenPdfUrlsFromGraphQl = (payload: unknown, baseUrl: string): string[] => {
  if (!isRecord(payload) || !isRecord(payload.node)) return [];
  const node = payload.node;
  const typeName = asString(node.__typename);
  if (!typeName || typeName.toLowerCase() !== "fontcollection") return [];
  const out = new Set<string>();
  const pdfRows = Array.isArray(node.pdfs) ? node.pdfs : [];
  for (const row of pdfRows) {
    if (!isRecord(row)) continue;
    const raw = asString(row.url);
    if (!raw) continue;
    try {
      out.add(new URL(raw, baseUrl).href);
    } catch {
      // ignore malformed URL
    }
  }
  return Array.from(out);
};

const parseCssFaces = (cssText: string, cssUrl: string, familyName: string): TypejiCssFace[] => {
  const out: TypejiCssFace[] = [];
  const seen = new Set<string>();
  const blocks = cssText.match(/@font-face\s*{[^}]*}/gi) || [];

  for (const block of blocks) {
    const familyRaw = asString(block.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?\s*;/i)?.[1]);
    if (!familyRaw) continue;
    const fontFamily = decodeHtml(familyRaw).replace(/\s+/g, " ").trim();
    if (!fontFamily) continue;

    const srcCandidates: Array<{ url: string; format: string }> = [];
    for (const match of block.matchAll(/url\(([^)]+)\)\s*format\(([^)]+)\)/gi)) {
      const rawUrl = asString(String(match[1] || "").replace(/^['"]|['"]$/g, ""));
      const rawFormat = asString(String(match[2] || "").replace(/^['"]|['"]$/g, ""));
      if (!rawUrl || !rawFormat) continue;
      srcCandidates.push({ url: rawUrl, format: rawFormat.toLowerCase() });
    }

    if (srcCandidates.length === 0) {
      for (const match of block.matchAll(/url\(([^)]+)\)/gi)) {
        const rawUrl = asString(String(match[1] || "").replace(/^['"]|['"]$/g, ""));
        if (!rawUrl) continue;
        srcCandidates.push({ url: rawUrl, format: "" });
      }
    }

    if (srcCandidates.length === 0) continue;

    const priority = ["woff2", "woff", "otf", "ttf", "eot"];
    srcCandidates.sort((a, b) => {
      const ai = priority.indexOf(a.format);
      const bi = priority.indexOf(b.format);
      const av = ai === -1 ? 999 : ai;
      const bv = bi === -1 ? 999 : bi;
      return av - bv;
    });

    const picked = srcCandidates[0];
    if (!picked) continue;

    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(picked.url, cssUrl).href;
    } catch {
      continue;
    }
    if (seen.has(resolvedUrl)) continue;
    seen.add(resolvedUrl);

    const formatToken = picked.format || (() => {
      if (/\.woff2(?:$|\?)/i.test(resolvedUrl)) return "woff2";
      if (/\.woff(?:$|\?)/i.test(resolvedUrl)) return "woff";
      if (/\.otf(?:$|\?)/i.test(resolvedUrl)) return "otf";
      if (/\.ttf(?:$|\?)/i.test(resolvedUrl)) return "ttf";
      if (/\.eot(?:$|\?)/i.test(resolvedUrl)) return "eot";
      return "woff2";
    })();

    if (!["woff2", "woff", "otf", "ttf", "eot"].includes(formatToken)) continue;

    const strippedStyle = normalizeStyleLabel(stripFamilyPrefix(fontFamily, familyName));
    const styleName = strippedStyle || "Regular";

    out.push({
      fontFamily,
      styleName,
      sourceUrl: resolvedUrl,
      format: formatToken as TypejiCssFace["format"],
      style: inferStyleMode(styleName)
    });
  }

  return out;
};

const buildStyleLookup = (styles: TypejiStyleRow[]): Map<string, TypejiStyleRow> => {
  const map = new Map<string, TypejiStyleRow>();
  const add = (key: string, row: TypejiStyleRow) => {
    const token = normalizeToken(key);
    if (!token || map.has(token)) return;
    map.set(token, row);
  };

  for (const row of styles) {
    add(row.styleName, row);
    add(row.fullName, row);
    add(`${row.familyName} ${row.styleName}`, row);
    if (row.cssFamily) {
      add(`${row.cssFamily} ${row.styleName}`, row);
      add(row.cssFamily, row);
    }
  }

  return map;
};

const resolveFamilyFromFace = (fontFamily: string, styleName: string, fallbackFamily: string): string => {
  const compactFamily = fontFamily.replace(/\s+/g, " ").trim();
  const compactStyle = styleName.replace(/\s+/g, " ").trim();
  if (!compactFamily || !compactStyle) return fallbackFamily;
  const matcher = new RegExp(`\\s+${escapeRegExp(compactStyle)}$`, "i");
  const stripped = compactFamily.replace(matcher, "").trim();
  if (stripped) return stripped;
  return fallbackFamily;
};

const buildTypejiTargetProfile = (params: {
  targetUrl: string;
  collectionId: string;
  familyName: string;
  cssUrl?: string;
  styleRows: TypejiStyleRow[];
  htmlStyleNames: string[];
  cssFaces: TypejiCssFace[];
  specimenPdfUrls: string[];
  featureTags: string[];
  glyphCount?: number;
  licenses: TypejiLicense[];
  languages: string[];
}): Record<string, unknown> => {
  const expectedFromStore = dedupeStringList(params.styleRows.map((row) => row.fullName));
  const expectedFromHtml = dedupeStringList(params.htmlStyleNames.map((style) => `${params.familyName} ${style}`.trim()));
  const expectedFromCss = dedupeStringList(
    params.cssFaces.map((face) => `${resolveFamilyFromFace(face.fontFamily, face.styleName, params.familyName)} ${face.styleName}`.trim())
  );
  const expectedStyles = expectedFromStore.length > 0 ? expectedFromStore : expectedFromHtml.length > 0 ? expectedFromHtml : expectedFromCss;

  const styleMapSource = params.styleRows.length > 0
    ? params.styleRows
    : expectedStyles.map((fullName) => {
        const styleName = normalizeStyleLabel(stripFamilyPrefix(fullName, params.familyName));
        return {
          familyName: params.familyName,
          styleName,
          fullName,
          style: inferStyleMode(styleName),
          weight: inferWeightFromStyleName(styleName),
          source: "html-options"
        } as TypejiStyleRow;
      });

  return {
    profileId: "generaltypestudio-target-profile-v1",
    source: "generaltypestudio-html+fontdue-graphql+fontdue-css",
    foundry: "General Type Studio",
    styleScope: "family-style",
    strictMissingStyles: true,
    targetUrl: params.targetUrl,
    collectionId: params.collectionId,
    familyDisplay: params.familyName,
    cssUrl: params.cssUrl,
    expectedStyles,
    expectedStyleCount: expectedStyles.length,
    styleMap: styleMapSource.map((row) => ({
      id: row.id,
      collectionId: row.collectionId,
      collectionName: row.collectionName,
      familyName: row.familyName,
      styleName: row.styleName,
      expectedStyle: row.fullName,
      style: row.style,
      weight: row.weight,
      cssFamily: row.cssFamily,
      skuId: row.skuId,
      supportedLanguages: row.supportedLanguages,
      source: row.source
    })),
    requiredFeatureTags: params.featureTags,
    glyphCount: params.glyphCount,
    specimenPdfUrls: params.specimenPdfUrls,
    licenses: params.licenses,
    languages: params.languages,
    collectedAt: new Date().toISOString()
  };
};

const buildFontsFromCssFaces = (params: {
  targetUrl: string;
  familyName: string;
  collectionId: string;
  cssFaces: TypejiCssFace[];
  styleRows: TypejiStyleRow[];
  targetProfile: Record<string, unknown>;
}): FontMetadata[] => {
  const styleLookup = buildStyleLookup(params.styleRows);
  const out: FontMetadata[] = [];
  const seen = new Set<string>();

  const resolveStyleRow = (face: TypejiCssFace): TypejiStyleRow | undefined => {
    const tokens = [
      face.styleName,
      face.fontFamily,
      `${params.familyName} ${face.styleName}`,
      stripFamilyPrefix(face.fontFamily, params.familyName)
    ];
    for (const token of tokens) {
      const next = styleLookup.get(normalizeToken(token));
      if (next) return next;
    }
    return undefined;
  };

  for (const face of params.cssFaces) {
    if (seen.has(face.sourceUrl)) continue;
    seen.add(face.sourceUrl);

    const matched = resolveStyleRow(face);
    const styleName = matched?.styleName || face.styleName;
    const familyForFont = matched?.familyName || resolveFamilyFromFace(face.fontFamily, styleName, params.familyName);
    const fullName = matched?.fullName || `${familyForFont} ${styleName}`.trim();
    const style = matched?.style || face.style;
    const weight = matched?.weight ?? inferWeightFromStyleName(styleName);

    out.push({
      url: face.sourceUrl,
      family: familyForFont,
      format: face.format,
      style,
      weight,
      downloadable: true,
      note: "General Type Studio CSS asset (Fontdue).",
      metadata: {
        foundry: "General Type Studio",
        family: familyForFont,
        styleName,
        fullName,
        cssFontFamily: face.fontFamily,
        collectionId: params.collectionId,
        pageUrl: params.targetUrl,
        targetUrl: params.targetUrl,
        format: face.format,
        forceMetadataRepair: true,
        targetProfile: params.targetProfile,
        headers: {
          Origin: GTS_ORIGIN,
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
    const controls = Array.from(document.querySelectorAll("select, option, [data-font], button, [role='button']"));
    for (const node of controls.slice(0, 200)) {
      try {
        if (node instanceof HTMLSelectElement) {
          for (let i = 0; i < node.options.length; i += 1) {
            node.selectedIndex = i;
            node.dispatchEvent(new Event("change", { bubbles: true }));
            await sleep(90);
          }
          continue;
        }
        (node as HTMLElement).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      } catch {}
      await sleep(45);
    }
    await sleep(1200);
    window.__specimen_generaltypestudio_probe_done = true;
    window.__specimen_generaltypestudio_probe_done = true;
  })();
`;

export const GeneralTypeStudioScraper: Scraper = {
  id: "generaltypestudio",
  name: "General Type Studio Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?generaltypestudio\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const targetUrl = normalizeTargetUrl(url);
      const slug = extractFamilySlug(targetUrl);
      const fallbackFamily = slug ? toTitleFromSlug(slug) : "General Type Studio";

      const html = await fetchTextWithRetry(targetUrl, {
        "User-Agent": GTS_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: GTS_ORIGIN
      });

      const familyName = extractFamilyNameFromHtml(html, fallbackFamily);
      const collectionId = extractCollectionIdFromHtml(html);
      const htmlSpecimenPdfUrls = extractSpecimenPdfUrls(html, targetUrl);
      const htmlStyleNames = extractHtmlStyleNames(html, familyName);
      const htmlFeatureTags = extractFeatureTagsFromHtml(html);
      const htmlGlyphCount = extractGlyphCountFromHtml(html);

      if (!collectionId) {
        return {
          scraperName: this.name,
          foundryName: "General Type Studio",
          fonts: [],
          originalUrl: url,
          targetUrl,
          metadata: {
            foundry: "General Type Studio",
            family: familyName,
            reason: "collection-id-not-found"
          }
        };
      }

      const [storeData, characterData, specimenData] = await Promise.all([
        fetchGraphQlWithRetry<{ node?: unknown }>({
          queryName: "StoreModalProductRefetchQuery",
          query: STORE_MODAL_PRODUCT_QUERY,
          variables: { id: collectionId },
          referer: GTS_ORIGIN
        }),
        fetchGraphQlWithRetry<{ node?: unknown }>({
          queryName: "CharacterViewerIDQuery",
          query: CHARACTER_VIEWER_QUERY,
          variables: { collectionId },
          referer: GTS_ORIGIN
        }),
        fetchGraphQlWithRetry<{ node?: unknown }>({
          queryName: "SpecimenLinkQuery",
          query: SPECIMEN_LINK_QUERY,
          variables: { collectionId },
          referer: GTS_ORIGIN
        })
      ]);

      const storeProfile = parseStoreProfile(storeData, collectionId, familyName);
      const characterProfile = parseCharacterProfile(characterData, collectionId, familyName);
      const specimenPdfUrls = dedupeStringList([
        ...htmlSpecimenPdfUrls,
        ...parseSpecimenPdfUrlsFromGraphQl(specimenData, targetUrl)
      ]);
      const cssLinks = extractCollectionCssUrlsFromHtml(html, targetUrl);
      const matchedCssUrl = matchCssUrlByCollectionId(cssLinks, collectionId);
      const cssUrls = dedupeStringList([
        ...(storeProfile?.cssUrls || []),
        ...(characterProfile?.cssUrls || []),
        ...(storeProfile?.cssUrl ? [storeProfile.cssUrl] : []),
        ...(characterProfile?.cssUrl ? [characterProfile.cssUrl] : []),
        ...(matchedCssUrl ? [matchedCssUrl] : []),
        ...cssLinks
      ]);
      const cssUrl = cssUrls[0];

      let cssFaces: TypejiCssFace[] = [];
      for (const cssCandidate of cssUrls) {
        try {
          const cssText = await fetchTextWithRetry(cssCandidate, {
            "User-Agent": GTS_UA,
            Accept: "text/css,*/*;q=0.1",
            Referer: GTS_ORIGIN,
            Origin: GTS_ORIGIN
          });
          if (!cssText.includes("@font-face")) continue;
          cssFaces = [...cssFaces, ...parseCssFaces(cssText, cssCandidate, familyName)];
        } catch (error) {
          console.warn("[GeneralTypeStudioScraper] CSS fetch failed:", error);
        }
      }

      const styleRows: TypejiStyleRow[] = [
        ...(storeProfile?.styles || []),
        ...htmlStyleNames.map((styleName) => ({
          collectionId,
          familyName,
          styleName,
          fullName: `${familyName} ${styleName}`.trim(),
          style: inferStyleMode(styleName),
          weight: inferWeightFromStyleName(styleName),
          source: "html-options" as const
        }))
      ];

      if (styleRows.length === 0) {
        for (const face of cssFaces) {
          const familyForFace = resolveFamilyFromFace(face.fontFamily, face.styleName, familyName);
          styleRows.push({
            collectionId,
            familyName: familyForFace,
            styleName: face.styleName,
            fullName: `${familyForFace} ${face.styleName}`.trim(),
            style: face.style,
            weight: inferWeightFromStyleName(face.styleName),
            cssFamily: face.fontFamily,
            source: "css-font-face"
          });
        }
      }

      const allFeatureTags = dedupeStringList([
        ...htmlFeatureTags,
        ...(characterProfile?.featureTags || [])
      ]).map((tag) => tag.toLowerCase());

      const languages = dedupeStringList([
        ...(storeProfile?.languages || []),
        ...(characterProfile?.languages || [])
      ]);

      const targetProfile = buildTypejiTargetProfile({
        targetUrl,
        collectionId,
        familyName,
        cssUrl,
        styleRows,
        htmlStyleNames,
        cssFaces,
        specimenPdfUrls,
        featureTags: allFeatureTags,
        glyphCount: characterProfile?.glyphCount || htmlGlyphCount,
        licenses: storeProfile?.licenses || [],
        languages
      });

      const fonts = buildFontsFromCssFaces({
        targetUrl,
        familyName,
        collectionId,
        cssFaces,
        styleRows,
        targetProfile
      });

      if (fonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "General Type Studio",
          fonts: [
            {
              url: "browser-intercept",
              family: familyName,
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "General Type Studio",
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
          expectedCount: Array.isArray((targetProfile as any).expectedStyles)
            ? (targetProfile as any).expectedStyles.length
            : undefined,
          metadata: {
            foundry: "General Type Studio",
            family: familyName,
            targetProfile,
            specimenPdfUrls,
            fallbackMode: "browser-intercept"
          }
        };
      }

      const expectedCount = Array.isArray((targetProfile as any).expectedStyles)
        ? Number((targetProfile as any).expectedStyles.length)
        : fonts.length;

      return {
        scraperName: this.name,
        foundryName: "General Type Studio",
        fonts,
        originalUrl: url,
        targetUrl,
        expectedCount,
        metadata: {
          foundry: "General Type Studio",
          family: familyName,
          targetProfile,
          specimenPdfUrls
        }
      };
    } catch (error) {
      console.error("[GeneralTypeStudioScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "General Type Studio",
        fonts: [],
        originalUrl: url
      };
    }
  }
};








