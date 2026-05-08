import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const TYPE_DEPARTMENT_ORIGIN = "https://type-department.com";
const TYPE_DEPARTMENT_PRODUCTS_ENDPOINT = `${TYPE_DEPARTMENT_ORIGIN}/products.json?limit=250`;
const TYPE_DEPARTMENT_FETCH_TIMEOUT_MS = 30000;
const TYPE_DEPARTMENT_FETCH_MAX_RETRIES = 3;
const TYPE_DEPARTMENT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const TYPE_DEPARTMENT_RETAIL_ENDPOINT_ENV_KEYS = [
  "TYPE_DEPARTMENT_RETAIL_PACKAGE_URLS",
  "TYPE_DEPARTMENT_RETAIL_PACKAGE_URL"
] as const;
const TYPE_DEPARTMENT_RETAIL_ENDPOINT_MAP_ENV_KEY = "TYPE_DEPARTMENT_RETAIL_PACKAGE_URL_MAP";

const NOISE_HANDLE_RE = /^option-set-\d+-select-\d+$/i;
const LEGAL_DOC_RE = /(?:eula|license|licen[cs]e|terms|agreement|privacy)/i;
const SPECIMEN_DOC_RE = /(?:specimen|technical|glyph|character\s*set|brochure|catalog(?:ue)?|type\s*specimen)/i;
const TRIAL_ASSET_RE = /(?:trial|demo|test|free)/i;
const FIREBASE_FONT_RE = /firebasestorage\.googleapis\.com/i;

const TYPE_DEPARTMENT_REQUIRED_FEATURE_TAGS = ["aalt", "dlig", "ss01"];
const TYPE_DEPARTMENT_MIN_CMAP_ENTRIES = 220;
const TYPE_DEPARTMENT_MIN_FEATURE_COUNT = 6;

const STYLE_WEIGHT_MAP: Array<{ token: RegExp; style: string; weight?: number }> = [
  { token: /\bhairline\b/i, style: "Hairline", weight: 100 },
  { token: /\bthin\b/i, style: "Thin", weight: 100 },
  { token: /\bextra\s*light\b|\bultra\s*light\b/i, style: "Extralight", weight: 200 },
  { token: /\blight\b/i, style: "Light", weight: 300 },
  { token: /\bbook\b/i, style: "Book", weight: 350 },
  { token: /\bregular\b|\broman\b/i, style: "Regular", weight: 400 },
  { token: /\bmedium\b/i, style: "Medium", weight: 500 },
  { token: /\bsemi\s*bold\b|\bsemibold\b|\bdemi\s*bold\b/i, style: "Semibold", weight: 600 },
  { token: /\bbold\b/i, style: "Bold", weight: 700 },
  { token: /\bextra\s*bold\b|\bultra\s*bold\b/i, style: "Extrabold", weight: 800 },
  { token: /\bblack\b|\bheavy\b/i, style: "Black", weight: 900 }
];

type TypeDepartmentScope =
  | { kind: "product"; handle: string }
  | { kind: "collection"; handle: string }
  | { kind: "unknown"; token?: string };

type TypeDepartmentVariant = {
  id: number;
  title: string;
  option1?: string;
  option2?: string;
  option3?: string;
  available: boolean;
  price?: string;
};

type TypeDepartmentOption = {
  name: string;
  values: string[];
};

type TypeDepartmentProduct = {
  id: number;
  handle: string;
  title: string;
  url: string;
  vendor?: string;
  productType?: string;
  tags: string[];
  bodyHtml?: string;
  variants: TypeDepartmentVariant[];
  options: TypeDepartmentOption[];
};

type TypeDepartmentAssetKind =
  | "trial-zip"
  | "zip"
  | "desktop-file"
  | "retail-package"
  | "preview-firebase-font"
  | "preview-font"
  | "specimen-pdf"
  | "legal-pdf"
  | "pdf"
  | "other";

type TypeDepartmentAsset = {
  url: string;
  text?: string;
  ext?: "zip" | "otf" | "ttf" | "woff2" | "woff" | "pdf";
  kind: TypeDepartmentAssetKind;
};

type FirebaseStorageRef = {
  bucket: string;
  objectPath: string;
  prefix: string;
  token?: string;
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

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");

const decodeEscapedUrlBits = (value: string): string =>
  value
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\x26/gi, "&");

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const toSafeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const dedupeStrings = (items: string[]): string[] => {
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

const firebaseObjectListCache = new Map<string, Promise<string[]>>();

const canonicalizeAssetUrl = (rawUrl: string, baseUrl?: string): string | undefined => {
  const cleaned = decodeEscapedUrlBits(decodeHtml(rawUrl.trim()))
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (!cleaned) return undefined;

  try {
    const resolved = baseUrl ? new URL(cleaned, baseUrl) : new URL(cleaned);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return undefined;
    resolved.hash = "";
    return resolved.href;
  } catch {
    return undefined;
  }
};

const parseFirebaseStorageRef = (assetUrl: string): FirebaseStorageRef | undefined => {
  try {
    const parsed = new URL(assetUrl);
    if (!FIREBASE_FONT_RE.test(parsed.hostname)) return undefined;
    const match = parsed.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/i);
    if (!match) return undefined;
    const bucket = decodeURIComponent(match[1] || "").trim();
    const objectPath = decodeURIComponent(match[2] || "").trim();
    if (!bucket || !objectPath) return undefined;
    const lastSlash = objectPath.lastIndexOf("/");
    const prefix = lastSlash >= 0 ? objectPath.slice(0, lastSlash + 1) : "";
    const token = asString(parsed.searchParams.get("token"));
    return { bucket, objectPath, prefix, token };
  } catch {
    return undefined;
  }
};

const listFirebaseObjectNames = async (bucket: string, prefix: string): Promise<string[]> => {
  const cacheKey = `${bucket}|${prefix}`;
  const cached = firebaseObjectListCache.get(cacheKey);
  if (cached) return cached;

  const loader = (async () => {
    const out: string[] = [];
    const seen = new Set<string>();
    const headers = {
      "User-Agent": TYPE_DEPARTMENT_UA,
      Accept: "application/json,*/*"
    };

    let pageToken: string | undefined;
    do {
      const endpoint = new URL(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o`);
      if (prefix) endpoint.searchParams.set("prefix", prefix);
      if (pageToken) endpoint.searchParams.set("pageToken", pageToken);

      let payload: unknown;
      try {
        payload = await fetchJsonWithRetry(endpoint.href, headers);
      } catch {
        break;
      }

      if (!isRecord(payload)) break;
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        if (!isRecord(item)) continue;
        const objectName = asString(item.name);
        if (!objectName || seen.has(objectName)) continue;
        seen.add(objectName);
        out.push(objectName);
      }

      pageToken = asString(payload.nextPageToken);
    } while (pageToken);

    return out;
  })();

  firebaseObjectListCache.set(cacheKey, loader);
  return loader;
};

const normalizeTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  const host = parsed.hostname.toLowerCase();
  if (host === "www.type-department.com" || host === "staging.type-department.com") {
    parsed.hostname = "type-department.com";
  }
  parsed.hash = "";
  return parsed.href;
};
const parseDelimitedUrls = (raw: string): string[] =>
  raw
    .split(/[\r\n,;]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

const parseRetailEndpointMap = (): Record<string, string[]> => {
  const raw = process.env[TYPE_DEPARTMENT_RETAIL_ENDPOINT_MAP_ENV_KEY];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const token = normalizeToken(key);
      if (!token) continue;
      if (Array.isArray(value)) {
        out[token] = value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
      } else {
        const single = asString(value);
        if (single) out[token] = [single];
      }
    }
    return out;
  } catch {
    return {};
  }
};

const resolveRetailPackageUrlsForProduct = (product: TypeDepartmentProduct): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const map = parseRetailEndpointMap();
  const mapKeys = dedupeStrings([product.handle, product.title]).map((value) => normalizeToken(value));

  const addUrl = (template: string): void => {
    const replaced = template
      .replace(/{handle}/gi, product.handle)
      .replace(/{slug}/gi, product.handle)
      .replace(/{product}/gi, product.handle)
      .replace(/{product_id}/gi, String(product.id))
      .replace(/{productId}/gi, String(product.id));
    try {
      const href = new URL(replaced).href;
      if (!seen.has(href)) {
        seen.add(href);
        out.push(href);
      }
    } catch {
      // ignore malformed endpoint template
    }
  };

  for (const key of mapKeys) {
    const candidates = map[key];
    if (!candidates) continue;
    for (const template of candidates) addUrl(template);
  }

  for (const envKey of TYPE_DEPARTMENT_RETAIL_ENDPOINT_ENV_KEYS) {
    const raw = process.env[envKey];
    if (!raw) continue;
    for (const template of parseDelimitedUrls(raw)) addUrl(template);
  }

  return out;
};

const inferFormatFromUrl = (url: string): FontMetadata["format"] => {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".zip")) return "zip";
    if (pathname.endsWith(".otf")) return "otf";
    if (pathname.endsWith(".ttf")) return "ttf";
    if (pathname.endsWith(".woff2")) return "woff2";
    if (pathname.endsWith(".woff")) return "woff";
  } catch {
    // ignore and fallback
  }
  return "zip";
};

const buildRetailHeaders = (pageUrl: string): Record<string, string> => {
  const headers: Record<string, string> = {
    Origin: TYPE_DEPARTMENT_ORIGIN,
    Referer: process.env.TYPE_DEPARTMENT_RETAIL_REFERER || pageUrl,
    Accept: "*/*"
  };
  if (process.env.TYPE_DEPARTMENT_RETAIL_COOKIE) headers.Cookie = process.env.TYPE_DEPARTMENT_RETAIL_COOKIE;
  if (process.env.TYPE_DEPARTMENT_RETAIL_AUTHORIZATION) {
    headers.Authorization = process.env.TYPE_DEPARTMENT_RETAIL_AUTHORIZATION;
  }
  return headers;
};

const extractScopeFromUrl = (targetUrl: string): TypeDepartmentScope => {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean).map((item) => item.toLowerCase());
    if (parts.length === 0) return { kind: "unknown" };

    const offset = parts[0] === "it" || parts[0] === "fr" ? 1 : 0;
    const head = parts[offset];
    const second = parts[offset + 1];

    if (head === "products" && second) return { kind: "product", handle: second };
    if (head === "collections" && second) return { kind: "collection", handle: second };

    const fallback = parts[parts.length - 1];
    return { kind: "unknown", token: fallback };
  } catch {
    return { kind: "unknown" };
  }
};

const buildProductUrl = (handle: string): string => `${TYPE_DEPARTMENT_ORIGIN}/products/${handle}`;

const fetchTextWithRetry = async (url: string, headers: Record<string, string>): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TYPE_DEPARTMENT_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TYPE_DEPARTMENT_FETCH_TIMEOUT_MS);
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
      if (attempt < TYPE_DEPARTMENT_FETCH_MAX_RETRIES) await sleep(400 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Type Department fetch failed");
};

const fetchJsonWithRetry = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const text = await fetchTextWithRetry(url, headers);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON payload from ${url}: ${String(error)}`);
  }
};

const parseTagList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item))
      .filter((item): item is string => Boolean(item));
  }

  const raw = asString(value);
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseOptions = (rawOptions: unknown, variants: TypeDepartmentVariant[]): TypeDepartmentOption[] => {
  const out: TypeDepartmentOption[] = [];
  if (Array.isArray(rawOptions)) {
    for (const row of rawOptions) {
      if (!isRecord(row)) continue;
      const name = asString(row.name);
      if (!name) continue;
      const values = Array.isArray(row.values)
        ? row.values.map((item) => asString(item)).filter((item): item is string => Boolean(item))
        : [];
      out.push({ name, values: dedupeStrings(values) });
    }
  }

  // Shopify payloads can be inconsistent; backfill option values from variants.
  const byName = new Map<string, Set<string>>();
  for (const option of out) {
    byName.set(option.name, new Set(option.values));
  }

  const ensure = (name: string, value: string | undefined) => {
    const token = normalizeSpace(name);
    if (!token) return;
    if (!byName.has(token)) byName.set(token, new Set<string>());
    if (value) byName.get(token)?.add(normalizeSpace(value));
  };

  for (const variant of variants) {
    ensure("Option1", variant.option1);
    ensure("Option2", variant.option2);
    ensure("Option3", variant.option3);
  }

  if (out.length === 0) {
    const generated: TypeDepartmentOption[] = [];
    const v1 = Array.from(byName.get("Option1") || []).filter(Boolean);
    const v2 = Array.from(byName.get("Option2") || []).filter(Boolean);
    if (v1.length > 0) generated.push({ name: "Option1", values: dedupeStrings(v1) });
    if (v2.length > 0) generated.push({ name: "Option2", values: dedupeStrings(v2) });
    return generated;
  }

  return out.map((option) => ({
    name: option.name,
    values: dedupeStrings(option.values)
  }));
};

const parseVariants = (rawVariants: unknown): TypeDepartmentVariant[] => {
  if (!Array.isArray(rawVariants)) return [];
  const out: TypeDepartmentVariant[] = [];

  for (const row of rawVariants) {
    if (!isRecord(row)) continue;
    const id = asNumber(row.id);
    const title = asString(row.title);
    if (!id || !title) continue;

    out.push({
      id,
      title,
      option1: asString(row.option1),
      option2: asString(row.option2),
      option3: asString(row.option3),
      available: Boolean(row.available),
      price: asString(row.price)
    });
  }

  return out;
};

const toProduct = (row: unknown): TypeDepartmentProduct | undefined => {
  if (!isRecord(row)) return undefined;

  const id = asNumber(row.id);
  const handle = asString(row.handle);
  const title = asString(row.title);
  if (!id || !handle || !title) return undefined;

  const variants = parseVariants(row.variants);
  const options = parseOptions(row.options, variants);
  const tags = parseTagList(row.tags);

  return {
    id,
    handle: handle.toLowerCase(),
    title,
    url: buildProductUrl(handle.toLowerCase()),
    vendor: asString(row.vendor),
    productType: asString(row.product_type) || asString(row.type),
    tags,
    bodyHtml: asString(row.body_html),
    variants,
    options
  };
};

const fetchProductsIndex = async (headers: Record<string, string>): Promise<TypeDepartmentProduct[]> => {
  const payload = await fetchJsonWithRetry(TYPE_DEPARTMENT_PRODUCTS_ENDPOINT, headers);
  const rows = isRecord(payload) && Array.isArray(payload.products) ? payload.products : [];

  const out: TypeDepartmentProduct[] = [];
  for (const row of rows) {
    const product = toProduct(row);
    if (product) out.push(product);
  }

  return out;
};

const fetchCollectionProducts = async (
  collectionHandle: string,
  headers: Record<string, string>
): Promise<TypeDepartmentProduct[]> => {
  const endpoint = `${TYPE_DEPARTMENT_ORIGIN}/collections/${encodeURIComponent(collectionHandle)}/products.json?limit=250`;
  const payload = await fetchJsonWithRetry(endpoint, headers);
  const rows = isRecord(payload) && Array.isArray(payload.products) ? payload.products : [];

  const out: TypeDepartmentProduct[] = [];
  for (const row of rows) {
    const product = toProduct(row);
    if (product) out.push(product);
  }

  return out;
};

const isLikelyFontProduct = (product: TypeDepartmentProduct): boolean => {
  if (NOISE_HANDLE_RE.test(product.handle)) return false;

  const typeToken = normalizeToken(product.productType || "");
  if (typeToken.includes("font")) return true;

  const optionNames = product.options.map((option) => normalizeToken(option.name));
  if (optionNames.some((token) => token.includes("fontlicense") || token.includes("fontweight") || token.includes("fontstyle"))) {
    return true;
  }

  const tagsToken = normalizeToken(product.tags.join(" "));
  return tagsToken.includes("font");
};

const resolveProductsForScope = async (params: {
  scope: TypeDepartmentScope;
  catalog: TypeDepartmentProduct[];
  headers: Record<string, string>;
}): Promise<{ selected: TypeDepartmentProduct[]; reason: string }> => {
  const { scope, catalog, headers } = params;
  const byHandle = new Map(catalog.map((product) => [product.handle, product]));

  if (scope.kind === "product") {
    const exact = byHandle.get(scope.handle);
    if (exact) return { selected: [exact], reason: "product-exact" };

    const token = normalizeToken(scope.handle);
    if (token) {
      const fuzzy = catalog.find((product) => normalizeToken(product.handle) === token);
      if (fuzzy) return { selected: [fuzzy], reason: "product-fuzzy" };
    }

    return { selected: [], reason: "product-not-found" };
  }

  if (scope.kind === "collection") {
    try {
      const collectionRows = await fetchCollectionProducts(scope.handle, headers);
      const filtered = collectionRows.filter(isLikelyFontProduct);
      if (filtered.length > 0) return { selected: filtered, reason: "collection-json" };
    } catch {
      // fallback to catalog heuristics below
    }

    const token = normalizeToken(scope.handle);
    const guessed = catalog.filter((product) =>
      normalizeToken(`${product.handle} ${product.vendor || ""} ${product.tags.join(" ")}`).includes(token)
    );
    return { selected: guessed.filter(isLikelyFontProduct), reason: "collection-heuristic" };
  }

  const token = normalizeToken(scope.token || "");
  if (token) {
    const exactHandle = byHandle.get(scope.token || "");
    if (exactHandle) return { selected: [exactHandle], reason: "unknown-token-handle" };

    const fuzzy = catalog.find((product) => normalizeToken(product.handle) === token);
    if (fuzzy) return { selected: [fuzzy], reason: "unknown-token-fuzzy" };
  }

  return { selected: [], reason: "scope-unsupported" };
};

const extractExt = (assetUrl: string): TypeDepartmentAsset["ext"] | undefined => {
  try {
    const pathname = new URL(assetUrl).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext === "zip" || ext === "otf" || ext === "ttf" || ext === "woff2" || ext === "woff" || ext === "pdf") {
      return ext;
    }
  } catch {
    const fallback = assetUrl.split("?")[0].split(".").pop()?.toLowerCase();
    if (fallback === "zip" || fallback === "otf" || fallback === "ttf" || fallback === "woff2" || fallback === "woff" || fallback === "pdf") {
      return fallback;
    }
  }
  return undefined;
};

const classifyAsset = (url: string, text?: string): TypeDepartmentAssetKind => {
  const lowerUrl = url.toLowerCase();
  const lowerText = (text || "").toLowerCase();
  const ext = extractExt(url);

  if (ext === "pdf") {
    if (LEGAL_DOC_RE.test(lowerUrl) || LEGAL_DOC_RE.test(lowerText)) return "legal-pdf";
    if (SPECIMEN_DOC_RE.test(lowerUrl) || SPECIMEN_DOC_RE.test(lowerText)) return "specimen-pdf";
    return "pdf";
  }

  if (ext === "zip") {
    if (TRIAL_ASSET_RE.test(lowerUrl) || TRIAL_ASSET_RE.test(lowerText)) return "trial-zip";
    return "zip";
  }

  if ((ext === "otf" || ext === "ttf" || ext === "woff" || ext === "woff2") && FIREBASE_FONT_RE.test(lowerUrl)) {
    return "preview-firebase-font";
  }

  if (ext === "otf" || ext === "ttf") return "desktop-file";

  if (ext === "woff" || ext === "woff2") {
    return "preview-font";
  }

  return "other";
};

const extractAnchorAssets = (html: string, pageUrl: string): TypeDepartmentAsset[] => {
  const out: TypeDepartmentAsset[] = [];
  const re = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(re)) {
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const hrefMatch = attrs.match(/href\s*=\s*(["'])(.*?)\1/i) || attrs.match(/href\s*=\s*([^\s"'>]+)/i);
    if (!hrefMatch) continue;

    const hrefRaw = (hrefMatch[2] || hrefMatch[1] || "").trim();
    if (!hrefRaw) continue;

    const href = canonicalizeAssetUrl(hrefRaw, pageUrl);
    if (!href) continue;

    const ext = extractExt(href);
    if (!ext) continue;

    const text = normalizeSpace(decodeHtml(inner.replace(/<[^>]+>/g, " ")));
    out.push({
      url: href,
      text,
      ext,
      kind: classifyAsset(href, text)
    });
  }

  return out;
};

const extractFontPickerAssets = (html: string, pageUrl: string): TypeDepartmentAsset[] => {
  const out: TypeDepartmentAsset[] = [];

  for (const match of html.matchAll(/<option\b([^>]*?)>/gi)) {
    const attrs = match[1] || "";
    const dataUrlMatch =
      attrs.match(/data-url\s*=\s*(["'])(.*?)\1/i) || attrs.match(/data-url\s*=\s*([^\s"'>]+)/i);
    if (!dataUrlMatch) continue;

    const rawUrl = (dataUrlMatch[2] || dataUrlMatch[1] || "").trim();
    if (!rawUrl) continue;

    const resolvedUrl = canonicalizeAssetUrl(rawUrl, pageUrl);
    if (!resolvedUrl) continue;

    const valueMatch = attrs.match(/value\s*=\s*(["'])(.*?)\1/i) || attrs.match(/value\s*=\s*([^\s"'>]+)/i);
    let valueText = normalizeSpace(decodeHtml((valueMatch?.[2] || valueMatch?.[1] || "").trim()));
    if (/\bitalic\b/i.test(valueText) && /slanted/i.test(decodeURIComponent(resolvedUrl))) {
      valueText = valueText.replace(/\bitalic\b/gi, "Slanted");
    }

    const ext = extractExt(resolvedUrl);
    const isFirebaseFont = FIREBASE_FONT_RE.test(resolvedUrl) && /fontsL\//i.test(resolvedUrl);
    if (!ext && !isFirebaseFont) continue;

    const resolvedExt =
      ext ||
      (resolvedUrl.toLowerCase().includes(".woff2")
        ? "woff2"
        : resolvedUrl.toLowerCase().includes(".woff")
          ? "woff"
          : undefined);
    if (!resolvedExt) continue;

    out.push({
      url: resolvedUrl,
      text: valueText,
      ext: resolvedExt,
      kind: classifyAsset(resolvedUrl, valueText)
    });
  }

  return out;
};

const extractInlineAssets = (html: string): TypeDepartmentAsset[] => {
  const out: TypeDepartmentAsset[] = [];
  const normalized = decodeEscapedUrlBits(html);

  for (const match of normalized.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const raw = canonicalizeAssetUrl(match[0]);
    if (!raw) continue;

    const ext = extractExt(raw);
    const isFirebaseFont = FIREBASE_FONT_RE.test(raw) && /fontsL\//i.test(raw);
    if (!ext && !isFirebaseFont) continue;

    const resolvedExt = ext || (raw.toLowerCase().includes(".woff2") ? "woff2" : raw.toLowerCase().includes(".woff") ? "woff" : undefined);
    if (!resolvedExt) continue;

    out.push({
      url: raw,
      ext: resolvedExt,
      kind: classifyAsset(raw)
    });
  }

  return out;
};

const dedupeAssets = (assets: TypeDepartmentAsset[]): TypeDepartmentAsset[] => {
  const out: TypeDepartmentAsset[] = [];
  const seen = new Set<string>();
  for (const asset of assets) {
    const key = `${asset.url}|${asset.ext || ""}|${asset.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(asset);
  }
  return out;
};

const normalizeStyleLabel = (value: string): string => {
  const cleaned = normalizeSpace(value)
    .replace(/semi\s*-?\s*bold/gi, "Semibold")
    .replace(/demi\s*-?\s*bold/gi, "Semibold")
    .replace(/extra\s*-?\s*light/gi, "Extralight")
    .replace(/extra\s*-?\s*bold/gi, "Extrabold")
    .replace(/ultra\s*-?\s*light/gi, "Extralight");

  if (!cleaned) return "Regular";
  if (/^italic$/i.test(cleaned)) return "Regular Italic";

  return cleaned
    .split(" ")
    .map((part) => {
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
};

const BUNDLE_STYLE_LABEL_RE = /\b(?:font\s*family|family\s*\+\s*variable|full\s*font\s*family|complete\s*family|all\s*styles?|family\s*pack)\b/i;
const AXIS_LABEL_RE = /^(?:font\s*style|style|font\s*weight|weight|title)$/i;

const normalizeExpectedStyleToken = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const cleaned = normalizeStyleLabel(value);
  if (!cleaned) return undefined;
  if (AXIS_LABEL_RE.test(cleaned)) return undefined;
  if (BUNDLE_STYLE_LABEL_RE.test(cleaned)) return undefined;
  return cleaned;
};

const isWeightLikeStyleToken = (value: string): boolean => {
  const cleaned = normalizeStyleLabel(value);
  if (!cleaned) return false;
  if (/^regular(?:\s+(?:italic|oblique|slanted))?$/i.test(cleaned)) return true;
  if (/\bitalic\b|\boblique\b|\bslanted\b/i.test(cleaned)) return true;
  return STYLE_WEIGHT_MAP.some((item) => item.token.test(cleaned));
};

const mergeStyleAndWeightTokens = (params: {
  styleTokenRaw?: string;
  weightTokenRaw?: string;
}): string | undefined => {
  let styleToken = normalizeExpectedStyleToken(params.styleTokenRaw);
  let weightToken = normalizeExpectedStyleToken(params.weightTokenRaw);

  if (styleToken && weightToken) {
    if (isWeightLikeStyleToken(styleToken) && !isWeightLikeStyleToken(weightToken)) {
      const swap = styleToken;
      styleToken = weightToken;
      weightToken = swap;
    }

    if (/^regular(?:\s+(?:italic|oblique|slanted))?$/i.test(weightToken)) {
      return normalizeStyleLabel(`${styleToken} Regular`);
    }

    const styleCompact = normalizeToken(styleToken);
    const weightCompact = normalizeToken(weightToken);
    if (styleCompact && weightCompact && styleCompact.includes(weightCompact)) {
      return styleToken;
    }

    return normalizeStyleLabel(`${styleToken} ${weightToken}`);
  }

  return styleToken || weightToken;
};

const inferStyleFromAsset = (params: {
  assetUrl: string;
  expectedStyles: string[];
}): { style: string; weight?: number } => {
  const { assetUrl, expectedStyles } = params;
  const fileName = decodeURIComponent(assetUrl.split("?")[0].split("/").pop() || "");
  const stem = fileName
    .replace(/\.(zip|otf|ttf|woff2?|pdf)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\btrial\b|\bdemo\b|\btest\b|\bfree\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stem) return { style: "Regular" };


  const compactStem = normalizeToken(stem);
  const nonRegularExpected = expectedStyles
    .map((style) => normalizeStyleLabel(style))
    .filter((style) => style && !/^regular(?:\s+italic)?$/i.test(style))
    .sort((a, b) => normalizeToken(b).length - normalizeToken(a).length);

  for (const style of nonRegularExpected) {
    const token = normalizeToken(style);
    if (!token) continue;
    if (compactStem.includes(token)) {
      return { style };
    }
  }

  const italic = /\bitalic\b|\boblique\b|\bslanted\b/i.test(stem);
  for (const item of STYLE_WEIGHT_MAP) {
    if (!item.token.test(stem)) continue;
    return {
      style: italic ? `${item.style} Italic`.replace(/Regular Italic/i, "Regular Italic") : item.style,
      weight: item.weight
    };
  }

  if (italic) return { style: "Regular Italic", weight: 400 };
  return { style: "Regular", weight: 400 };
};

const inferWeightFromStyleLabel = (styleLabel: string): number | undefined => {
  const normalized = normalizeStyleLabel(styleLabel);
  for (const item of STYLE_WEIGHT_MAP) {
    if (item.token.test(normalized) && typeof item.weight === "number") {
      return item.weight;
    }
  }
  if (/^regular(?:\s+(?:italic|slanted|oblique))?$/i.test(normalized)) return 400;
  return undefined;
};

const inferStyleForAsset = (asset: TypeDepartmentAsset, expectedStyles: string[]): { style: string; weight?: number } => {
  const fromUrl = inferStyleFromAsset({ assetUrl: asset.url, expectedStyles });
  const fromText = normalizeExpectedStyleToken(asset.text);
  if (fromText) {
    const normalizedExpected = expectedStyles.map((style) => normalizeStyleLabel(style));
    const expectedPairs = normalizedExpected
      .map((style) => ({ style, token: normalizeToken(style) }))
      .filter((pair) => Boolean(pair.token));
    const textToken = normalizeToken(fromText);
    const urlToken = normalizeToken(decodeURIComponent(asset.url));

    const exact = expectedPairs.find((pair) => pair.token === textToken);
    if (exact) {
      return { style: exact.style, weight: inferWeightFromStyleLabel(exact.style) };
    }

    const suffixCandidates = expectedPairs
      .filter((pair) => textToken.endsWith(pair.token) || pair.token.endsWith(textToken))
      .sort((a, b) => {
        const aUrlHit = urlToken.includes(a.token) ? 1 : 0;
        const bUrlHit = urlToken.includes(b.token) ? 1 : 0;
        if (aUrlHit !== bUrlHit) return bUrlHit - aUrlHit;
        return b.token.length - a.token.length;
      });
    const suffixMatch = suffixCandidates[0];
    if (suffixMatch) {
      return { style: suffixMatch.style, weight: inferWeightFromStyleLabel(suffixMatch.style) };
    }

    if (/\bitalic\b/i.test(fromText)) {
      const stemToken = normalizeToken(fromText.replace(/\bitalic\b/gi, " "));
      const slantedMatch = normalizedExpected.find((expected) => {
        if (!/\b(slanted|italic|oblique)\b/i.test(expected)) return false;
        const expectedStem = normalizeToken(expected.replace(/\b(slanted|italic|oblique)\b/gi, " "));
        return Boolean(stemToken) && Boolean(expectedStem) && (expectedStem === stemToken || stemToken.endsWith(expectedStem) || expectedStem.endsWith(stemToken));
      });
      if (slantedMatch) {
        return { style: slantedMatch, weight: inferWeightFromStyleLabel(slantedMatch) };
      }
    }

    const normalizedHint = normalizeStyleLabel(fromText);
    const normalizedHintToken = normalizeToken(normalizedHint);
    const fromUrlToken = normalizeToken(fromUrl.style);
    if (
      fromUrlToken &&
      fromUrlToken !== normalizedHintToken &&
      expectedPairs.some((pair) => pair.token === fromUrlToken)
    ) {
      return { style: fromUrl.style, weight: fromUrl.weight ?? inferWeightFromStyleLabel(fromUrl.style) };
    }

    return { style: normalizedHint, weight: inferWeightFromStyleLabel(normalizedHint) };
  }

  return fromUrl;
};

const discoverFirebaseCatalogPreviewAssets = async (params: {
  product: TypeDepartmentProduct;
  assets: TypeDepartmentAsset[];
  expectedStyles: string[];
}): Promise<TypeDepartmentAsset[]> => {
  const { product, assets, expectedStyles } = params;

  const baseFirebaseAssets = assets.filter((asset) => asset.kind === "preview-firebase-font");
  if (baseFirebaseAssets.length === 0) return [];

  const refs = new Map<string, FirebaseStorageRef>();
  for (const asset of baseFirebaseAssets) {
    const ref = parseFirebaseStorageRef(asset.url);
    if (!ref) continue;
    const key = `${ref.bucket}|${ref.prefix}`;
    if (!refs.has(key)) refs.set(key, ref);
  }
  if (refs.size === 0) return [];

  const expectedStyleTokens = new Set(expectedStyles.map((style) => normalizeToken(style)).filter(Boolean));
  const familyTokens = Array.from(
    new Set(
      [product.title, product.handle]
        .flatMap((raw) => String(raw || "").split(/[^a-z0-9]+/gi))
        .map((part) => normalizeToken(part))
        .filter((token) => token.length >= 4)
    )
  );

  const out: TypeDepartmentAsset[] = [];
  const seenObjects = new Set<string>();

  for (const ref of refs.values()) {
    const objectNames = await listFirebaseObjectNames(ref.bucket, ref.prefix);
    for (const objectName of objectNames) {
      const ext = extractExt(objectName);
      if (!ext || !["otf", "ttf", "woff2", "woff"].includes(ext)) continue;

      const objectToken = normalizeToken(objectName);
      if (familyTokens.length > 0 && !familyTokens.some((token) => objectToken.includes(token))) continue;

      const objectKey = `${ref.bucket}|${objectName}`;
      if (seenObjects.has(objectKey)) continue;
      seenObjects.add(objectKey);

      const objectUrl = new URL(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(ref.bucket)}/o/${encodeURIComponent(objectName)}`);
      objectUrl.searchParams.set("alt", "media");
      if (ref.token) objectUrl.searchParams.set("token", ref.token);

      const baseName = decodeURIComponent(objectName.split("/").pop() || objectName)
        .replace(/\.(woff2?|otf|ttf)$/i, "")
        .replace(/^\d+[_-]?/, "")
        .replace(/[_-]+/g, " ")
        .trim();

      const candidate: TypeDepartmentAsset = {
        url: objectUrl.href,
        text: baseName,
        ext,
        kind: "preview-firebase-font"
      };
      const inferred = inferStyleForAsset(candidate, expectedStyles);
      const styleToken = normalizeToken(inferred.style);
      if (expectedStyleTokens.size > 0 && !expectedStyleTokens.has(styleToken)) continue;
      out.push(candidate);
    }
  }

  return dedupeAssets(out);
};

const extractExpectedStyles = (product: TypeDepartmentProduct): string[] => {
  const option2NameToken = normalizeToken(product.options[1]?.name || "");
  const option3NameToken = normalizeToken(product.options[2]?.name || "");

  const option2LooksWeight = /fontweight|weight/.test(option2NameToken);
  const option3LooksWeight = /fontweight|weight/.test(option3NameToken);
  const option2LooksStyle = /fontstyle|style/.test(option2NameToken) && !option2LooksWeight;
  const option3LooksStyle = /fontstyle|style/.test(option3NameToken) && !option3LooksWeight;

  let styleAxis: "option2" | "option3" = "option3";
  let weightAxis: "option2" | "option3" = "option2";

  if (option2LooksStyle && option3LooksWeight) {
    styleAxis = "option2";
    weightAxis = "option3";
  } else if (option3LooksStyle && option2LooksWeight) {
    styleAxis = "option3";
    weightAxis = "option2";
  }

  const nonBundleWeights = dedupeStrings(
    product.variants
      .map((variant) => normalizeExpectedStyleToken(weightAxis === "option2" ? variant.option2 : variant.option3))
      .filter((value): value is string => typeof value === "string" && value.length > 0 && !BUNDLE_STYLE_LABEL_RE.test(value))
  );
  const firstWeight = nonBundleWeights[0];
  const onlyRegularWeightAxis =
    nonBundleWeights.length === 1 && typeof firstWeight === "string" && /^regular(?:\s+(?:italic|slanted|oblique))?$/i.test(firstWeight);

  const fromVariantPairs = dedupeStrings(
    product.variants
      .map((variant) =>
        mergeStyleAndWeightTokens({
          styleTokenRaw: styleAxis === "option2" ? variant.option2 : variant.option3,
          weightTokenRaw: weightAxis === "option2" ? variant.option2 : variant.option3
        })
      )
      .filter((value): value is string => Boolean(value))
  ).map((style) => {
    if (!onlyRegularWeightAxis) return style;
    const stripped = normalizeStyleLabel(style.replace(/\s+regular$/i, "")).trim();
    return stripped || style;
  });

  if (fromVariantPairs.length > 0) return dedupeStrings(fromVariantPairs);

  const fromVariantOption3 = dedupeStrings(
    product.variants
      .map((variant) => normalizeExpectedStyleToken(variant.option3))
      .filter((value): value is string => Boolean(value))
  );
  const fromVariantOption2 = dedupeStrings(
    product.variants
      .map((variant) => normalizeExpectedStyleToken(variant.option2))
      .filter((value): value is string => Boolean(value))
  );

  const normalized = dedupeStrings([...fromVariantOption3, ...fromVariantOption2]);
  if (normalized.length > 0) return normalized;

  return ["Regular"];
};

const extractLicenseAxes = (product: TypeDepartmentProduct): string[] => {
  const out: string[] = [];
  for (const option of product.options) {
    const token = normalizeToken(option.name);
    if (!token) continue;
    if (token.includes("fontlicense") || token.includes("license") || token === "option1") {
      out.push(...option.values);
    }
  }

  if (out.length === 0) {
    for (const variant of product.variants) {
      if (variant.option1) out.push(variant.option1);
    }
  }

  return dedupeStrings(out);
};

const buildTargetProfile = (params: {
  product: TypeDepartmentProduct;
  pageUrl: string;
  scope: TypeDepartmentScope;
  expectedStyles: string[];
  catalogExpectedStyles?: string[];
  sourceLimitedStyles?: string[];
  expectedStyleMode?: "catalog" | "resolvable";
  specimenPdfUrls: string[];
  sourceType: string;
}): Record<string, unknown> => {
  const {
    product,
    pageUrl,
    scope,
    expectedStyles,
    catalogExpectedStyles = [],
    sourceLimitedStyles = [],
    expectedStyleMode = "catalog",
    specimenPdfUrls,
    sourceType
  } = params;
  const familyDisplay = normalizeStyleLabel(product.title);
  const familyToken = normalizeToken(familyDisplay);
  const normalizedExpectedStyles = expectedStyles
    .map((style) => normalizeStyleLabel(style))
    .filter((style) => !AXIS_LABEL_RE.test(style));

  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let familyStem = familyDisplay;
  for (const style of normalizedExpectedStyles) {
    const styleToken = normalizeToken(style);
    if (!styleToken || styleToken.length < 4) continue;
    if (!familyToken.endsWith(styleToken)) continue;
    const candidate = familyDisplay.replace(new RegExp(`\\s*${escapeRegExp(style)}\\s*$`, "i"), "").trim();
    if (candidate) {
      familyStem = candidate;
      break;
    }
  }

  const familyStemToken = normalizeToken(familyStem);
  const expectedFamilyStyles = dedupeStrings(
    normalizedExpectedStyles.map((style) => {
      const styleToken = normalizeToken(style);
      if (!styleToken) return familyDisplay;
      if (familyToken && styleToken.includes(familyToken)) return style;
      if (familyStemToken && styleToken.includes(familyStemToken)) return style;
      return `${familyStem} ${style}`.replace(/\s+/g, " ").trim();
    })
  );

  const normalizedCatalogExpectedStyles = dedupeStrings(
    catalogExpectedStyles
      .map((style) => normalizeStyleLabel(style))
      .filter((style) => !AXIS_LABEL_RE.test(style))
      .map((style) => {
        const styleToken = normalizeToken(style);
        if (!styleToken) return familyDisplay;
        if (familyToken && styleToken.includes(familyToken)) return style;
        if (familyStemToken && styleToken.includes(familyStemToken)) return style;
        return `${familyStem} ${style}`.replace(/\s+/g, " ").trim();
      })
  );

  const normalizedSourceLimitedStyles = dedupeStrings(
    sourceLimitedStyles
      .map((style) => normalizeStyleLabel(style))
      .filter((style) => !AXIS_LABEL_RE.test(style))
      .map((style) => {
        const styleToken = normalizeToken(style);
        if (!styleToken) return familyDisplay;
        if (familyToken && styleToken.includes(familyToken)) return style;
        if (familyStemToken && styleToken.includes(familyStemToken)) return style;
        return `${familyStem} ${style}`.replace(/\s+/g, " ").trim();
      })
  );

  const catalogExpectedCount = normalizedCatalogExpectedStyles.length;
  const resolvableExpectedCount = expectedFamilyStyles.length;
  const catalogStyleCoveragePercent =
    catalogExpectedCount > 0
      ? Number(((resolvableExpectedCount / Math.max(1, catalogExpectedCount)) * 100).toFixed(2))
      : 100;

  const strictMissingStyles = sourceType !== "shopify-html-packaged-zip-fallback";

  return {
    source: sourceType,
    foundry: "Type Department",
    family: product.title,
    familyDisplay,
    targetSlug: product.handle,
    pageUrl,
    productHandle: product.handle,
    collectionHandle: scope.kind === "collection" ? scope.handle : undefined,
    expectedStyles: expectedFamilyStyles,
    expectedCount: expectedFamilyStyles.length,
    catalogExpectedStyles: normalizedCatalogExpectedStyles,
    catalogExpectedCount,
    resolvableExpectedCount,
    sourceLimitedStyles: normalizedSourceLimitedStyles,
    expectedStyleMode,
    catalogStyleCoveragePercent,
    specimenPdfUrls,
    licenseAxes: extractLicenseAxes(product),
    styleScope: "family-style",
    strictMissingStyles,
    failOnTrialAssets: true,
    requiredFeatureTags: TYPE_DEPARTMENT_REQUIRED_FEATURE_TAGS,
    minCmapEntries: TYPE_DEPARTMENT_MIN_CMAP_ENTRIES,
    minFeatureCount: TYPE_DEPARTMENT_MIN_FEATURE_COUNT
  };
};

const toFileNameHint = (params: {
  product: TypeDepartmentProduct;
  style: string;
  ext: string;
}): string => {
  const foundry = "type-department";
  const handle = toSafeSlug(params.product.handle) || "font";
  const style = toSafeSlug(params.style) || "regular";
  return `${foundry}-${handle}-${style}.${params.ext}`;
};

type AssetSelectionMode =
  | "packaged-direct-only"
  | "packaged-direct-plus-preview-complement"
  | "packaged-zip-fallback"
  | "trial-zip-fallback"
  | "preview-full-coverage"
  | "preview-fallback";

const fontExtPriority = (ext: TypeDepartmentAsset["ext"]): number => {
  if (ext === "otf" || ext === "ttf") return 4;
  if (ext === "woff2") return 3;
  if (ext === "woff") return 2;
  if (ext === "zip") return 1;
  return 0;
};

const selectBestPreviewAssetsByStyle = (
  previewAssets: TypeDepartmentAsset[],
  expectedStyles: string[]
): TypeDepartmentAsset[] => {
  const expectedTokens = new Set(expectedStyles.map((style) => normalizeToken(style)).filter(Boolean));
  const byStyle = new Map<string, TypeDepartmentAsset>();

  for (const asset of previewAssets) {
    if (!asset.ext || !["otf", "ttf", "woff2", "woff"].includes(asset.ext)) continue;
    const inferred = inferStyleForAsset(asset, expectedStyles);
    const styleToken = normalizeToken(inferred.style);
    if (!styleToken) continue;
    if (expectedTokens.size > 0 && !expectedTokens.has(styleToken)) continue;

    const prev = byStyle.get(styleToken);
    if (!prev || fontExtPriority(asset.ext) > fontExtPriority(prev.ext)) {
      byStyle.set(styleToken, asset);
    }
  }

  return Array.from(byStyle.values());
};

const buildFontEntriesForProduct = (params: {
  product: TypeDepartmentProduct;
  pageUrl: string;
  scope: TypeDepartmentScope;
  assets: TypeDepartmentAsset[];
  catalogExpectedStyles?: string[];
  catalogPreviewAssets?: TypeDepartmentAsset[];
  specimenPdfUrls: string[];
}): FontMetadata[] => {
  const { product, pageUrl, scope, assets, specimenPdfUrls, catalogPreviewAssets = [] } = params;

  const catalogExpectedStyles = params.catalogExpectedStyles || extractExpectedStyles(product);

  const retailPackageUrls = resolveRetailPackageUrlsForProduct(product);
  if (retailPackageUrls.length > 0) {
    const sourceType = "retail-package-endpoint";
    const targetProfile = buildTargetProfile({
      product,
      pageUrl,
      scope,
      expectedStyles: catalogExpectedStyles,
      catalogExpectedStyles,
      sourceLimitedStyles: [],
      expectedStyleMode: "catalog",
      specimenPdfUrls,
      sourceType
    });

    return retailPackageUrls.map((retailUrl) => {
      const format = inferFormatFromUrl(retailUrl);
      const inferred = inferStyleFromAsset({ assetUrl: retailUrl, expectedStyles: catalogExpectedStyles });
      const styleLabel = inferred.style || "Regular";
      const weight = inferred.weight ?? "Regular";
      return {
        url: retailUrl,
        family: product.title,
        format,
        style: styleLabel,
        weight,
        downloadable: true,
        note: "Type Department retail package endpoint (configured).",
        metadata: {
          foundry: "Type Department",
          productHandle: product.handle,
          productTitle: product.title,
          vendor: product.vendor,
          productType: product.productType,
          tags: product.tags,
          sourceType: "retail-package",
          pageUrl,
          targetUrl: pageUrl,
          previewOnly: false,
          lowFidelity: false,
          assetSelectionMode: "retail-package-endpoint",
          family: product.title,
          styleName: styleLabel,
          fileNameHint: toFileNameHint({ product, style: styleLabel, ext: format }),
          skipConversion: format === "zip",
          pruneRawZipAfterExtract: format === "zip",
          extractSpecimenOnlyZip: false,
          extractSpecimenPdfFromZip: false,
          specimenPdfUrls,
          targetProfile,
          headers: buildRetailHeaders(pageUrl)
        }
      } satisfies FontMetadata;
    });
  }

  const packagedAssets = assets.filter((asset) => {
    if (asset.kind === "trial-zip" || asset.kind === "zip") return true;
    if (asset.kind !== "desktop-file") return false;
    // Firebase desktop assets are preview feeds, not packaged deliverables.
    return !FIREBASE_FONT_RE.test(asset.url);
  });

  const packagedDirectAssets = packagedAssets.filter((asset) => asset.ext && asset.ext !== "zip");
  const packagedNonTrialZipAssets = packagedAssets.filter(
    (asset) => asset.ext === "zip" && asset.kind !== "trial-zip"
  );
  const packagedTrialZipAssets = packagedAssets.filter(
    (asset) => asset.ext === "zip" && asset.kind === "trial-zip"
  );

  const fallbackPreviewAssets = dedupeAssets([
    ...assets.filter((asset) => asset.kind === "preview-firebase-font" || asset.kind === "preview-font"),
    ...catalogPreviewAssets
  ]);

  const expectedStyleTokens = new Set(catalogExpectedStyles.map((style) => normalizeToken(style)).filter(Boolean));
  const bestPreviewAssets = selectBestPreviewAssetsByStyle(fallbackPreviewAssets, catalogExpectedStyles);
  const previewStyleTokens = new Set(
    bestPreviewAssets
      .map((asset) =>
        normalizeToken(inferStyleForAsset(asset, catalogExpectedStyles).style)
      )
      .filter(Boolean)
  );
  const packagedDirectStyleTokens = new Set(
    packagedDirectAssets
      .map((asset) =>
        normalizeToken(inferStyleForAsset(asset, catalogExpectedStyles).style)
      )
      .filter(Boolean)
  );

  const previewCoversAllExpected =
    expectedStyleTokens.size > 0 && Array.from(expectedStyleTokens).every((token) => previewStyleTokens.has(token));
  const packagedDirectCoversAllExpected =
    expectedStyleTokens.size > 0 && Array.from(expectedStyleTokens).every((token) => packagedDirectStyleTokens.has(token));

  let selectionMode: AssetSelectionMode = "preview-fallback";
  if (packagedDirectCoversAllExpected && packagedDirectAssets.length > 0) {
    selectionMode = "packaged-direct-only";
  } else if (packagedDirectAssets.length > 0 && bestPreviewAssets.length > 0) {
    selectionMode = "packaged-direct-plus-preview-complement";
  } else if (previewCoversAllExpected) {
    selectionMode = "preview-full-coverage";
  } else if (packagedNonTrialZipAssets.length > 0) {
    selectionMode = "packaged-zip-fallback";
  } else if (bestPreviewAssets.length > 0) {
    // Prefer preview assets over trial package when non-trial package is unavailable.
    selectionMode = "preview-fallback";
  } else if (packagedTrialZipAssets.length > 0) {
    selectionMode = "trial-zip-fallback";
  } else if (packagedDirectAssets.length > 0) {
    selectionMode = "packaged-direct-only";
  } else {
    selectionMode = "preview-fallback";
  }

  const sourceType =
    selectionMode === "packaged-direct-only"
      ? "shopify-html-packaged-direct"
      : selectionMode === "packaged-direct-plus-preview-complement"
      ? "shopify-html-packaged-direct-plus-preview"
      : selectionMode === "packaged-zip-fallback"
      ? "shopify-html-packaged-zip-fallback"
      : selectionMode === "trial-zip-fallback"
      ? "shopify-html-trial-zip-fallback"
      : selectionMode === "preview-full-coverage"
      ? "shopify-html-preview-full-coverage"
      : "shopify-html-preview-fallback";

  const selectedAssets: TypeDepartmentAsset[] =
    selectionMode === "packaged-direct-only"
      ? [...packagedDirectAssets]
      : selectionMode === "packaged-direct-plus-preview-complement"
      ? [...packagedDirectAssets]
      : selectionMode === "packaged-zip-fallback"
      ? [...packagedNonTrialZipAssets]
      : selectionMode === "trial-zip-fallback"
      ? [...packagedTrialZipAssets]
      : [...bestPreviewAssets];

  const selectedNonZipAssets = selectedAssets.filter((asset) => asset.ext && asset.ext !== "zip");
  const selectedStyleTokens = new Set(
    selectedNonZipAssets
      .map((asset) => normalizeToken(inferStyleForAsset(asset, catalogExpectedStyles).style))
      .filter(Boolean)
  );
  const sourceLimitedStyles =
    selectionMode === "preview-fallback" || selectionMode === "preview-full-coverage"
      ? catalogExpectedStyles.filter((style) => {
          const token = normalizeToken(style);
          return Boolean(token) && !selectedStyleTokens.has(token);
        })
      : [];

  const targetProfile = buildTargetProfile({
    product,
    pageUrl,
    scope,
    expectedStyles: catalogExpectedStyles,
    catalogExpectedStyles,
    sourceLimitedStyles,
    expectedStyleMode: "catalog",
    specimenPdfUrls,
    sourceType
  });

  if (selectionMode === "packaged-direct-plus-preview-complement") {
    const coveredStyleTokens = new Set(packagedDirectStyleTokens);
    for (const preview of bestPreviewAssets) {
      const inferredPreviewStyle = inferStyleForAsset(preview, catalogExpectedStyles).style;
      const styleToken = normalizeToken(inferredPreviewStyle);
      if (!styleToken || coveredStyleTokens.has(styleToken)) continue;
      selectedAssets.push(preview);
      coveredStyleTokens.add(styleToken);
    }
  }

  const out: FontMetadata[] = [];
  const seen = new Set<string>();

  for (const asset of selectedAssets) {
    const ext = asset.ext;
    if (!ext) continue;
    if (!["zip", "otf", "ttf", "woff2", "woff"].includes(ext)) continue;

    const dedupeKey = `${asset.url}|${ext}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const inferred = inferStyleForAsset(asset, catalogExpectedStyles);
    const styleLabel = inferred.style;
    const weight = inferred.weight;
    const format = ext as FontMetadata["format"];

    out.push({
      url: asset.url,
      family: product.title,
      format,
      style: styleLabel,
      weight: weight ?? "Regular",
      downloadable: true,
      note: (() => {
        if (selectionMode === "packaged-direct-only") {
          return `Type Department packaged direct asset (${asset.kind}).`;
        }
        if (selectionMode === "packaged-direct-plus-preview-complement") {
          return `Type Department packaged direct asset with preview complement (${asset.kind}).`;
        }
        if (selectionMode === "packaged-zip-fallback") {
          return "Type Department trial/package zip used as analysis fallback; raw zip will be pruned from final output.";
        }
        if (selectionMode === "trial-zip-fallback") {
          return "Type Department trial zip fallback used because no direct or preview assets were resolved.";
        }
        if (selectionMode === "preview-full-coverage") {
          return "Type Department preview assets selected (full style coverage; zip skipped).";
        }
        return "Type Department preview-webfont fallback (no packaged direct assets found).";
      })(),
      metadata: {
        foundry: "Type Department",
        productHandle: product.handle,
        productTitle: product.title,
        vendor: product.vendor,
        productType: product.productType,
        tags: product.tags,
        sourceType: asset.kind,
        sourceText: asset.text,
        pageUrl,
        targetUrl: pageUrl,
        previewOnly: selectionMode === "preview-full-coverage" || selectionMode === "preview-fallback",
        lowFidelity: selectionMode === "preview-fallback",
        assetSelectionMode: selectionMode,
        family: product.title,
        styleName: styleLabel,
        fileNameHint: toFileNameHint({ product, style: styleLabel, ext }),
        skipConversion: format === "zip",
        pruneRawZipAfterExtract: format === "zip",
        extractSpecimenOnlyZip: false,
        extractSpecimenPdfFromZip: false,
        specimenPdfUrls,
        targetProfile,
        headers: {
          Origin: TYPE_DEPARTMENT_ORIGIN,
          Referer: pageUrl,
          Accept: "*/*"
        }
      }
    });
  }

  return out;
};

const extractSpecimenPdfUrls = (assets: TypeDepartmentAsset[]): string[] => {
  const urls = assets
    .filter((asset) => asset.kind === "specimen-pdf")
    .map((asset) => asset.url);
  return dedupeStrings(urls);
};

export const TypeDepartmentScraper: Scraper = {
  id: "type-department",
  name: "Type Department Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.|staging\.)?type-department\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const normalizedInput = normalizeTargetUrl(url);
      const scope = extractScopeFromUrl(normalizedInput);

      const jsonHeaders = {
        "User-Agent": TYPE_DEPARTMENT_UA,
        Accept: "application/json,*/*",
        Referer: normalizedInput
      };

      const catalog = await fetchProductsIndex(jsonHeaders);
      const { selected, reason } = await resolveProductsForScope({ scope, catalog, headers: jsonHeaders });
      const selectedProducts = selected.filter(isLikelyFontProduct);

      if (selectedProducts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Type Department",
          fonts: [],
          originalUrl: url,
          metadata: {
            foundry: "Type Department",
            reason,
            scope,
            catalogCount: catalog.length
          }
        };
      }

      const htmlHeaders = {
        "User-Agent": TYPE_DEPARTMENT_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: TYPE_DEPARTMENT_ORIGIN
      };

      const fonts: FontMetadata[] = [];
      const summaries: Array<Record<string, unknown>> = [];
      let totalSpecimenPdfUrls: string[] = [];

      for (const product of selectedProducts) {
        const pageUrl = buildProductUrl(product.handle);
        const html = await fetchTextWithRetry(pageUrl, htmlHeaders).catch(() => "");
        const catalogExpectedStyles = extractExpectedStyles(product);

        const anchorAssets = html ? extractAnchorAssets(html, pageUrl) : [];
        const pickerAssets = html ? extractFontPickerAssets(html, pageUrl) : [];
        const inlineAssets = html ? extractInlineAssets(html) : [];
        const bodyInlineAssets = product.bodyHtml ? extractInlineAssets(product.bodyHtml) : [];
        const assets = dedupeAssets([...anchorAssets, ...pickerAssets, ...inlineAssets, ...bodyInlineAssets]);
        const catalogPreviewAssets = await discoverFirebaseCatalogPreviewAssets({
          product,
          assets,
          expectedStyles: catalogExpectedStyles
        });

        const specimenPdfUrls = extractSpecimenPdfUrls(assets);
        totalSpecimenPdfUrls = dedupeStrings([...totalSpecimenPdfUrls, ...specimenPdfUrls]);

        const productFonts = buildFontEntriesForProduct({
          product,
          pageUrl,
          scope,
          assets,
          catalogExpectedStyles,
          catalogPreviewAssets,
          specimenPdfUrls
        });

        fonts.push(...productFonts);

        summaries.push({
          handle: product.handle,
          title: product.title,
          vendor: product.vendor,
          variantCount: product.variants.length,
          expectedStyleCount: catalogExpectedStyles.length,
          assetCount: assets.length,
          catalogPreviewAssetCount: catalogPreviewAssets.length,
          packagedAssetCount: assets.filter((asset) =>
            asset.kind === "trial-zip" || asset.kind === "zip" || asset.kind === "desktop-file"
          ).length,
          previewAssetCount: assets.filter((asset) => asset.kind === "preview-font" || asset.kind === "preview-firebase-font").length,
          specimenPdfCount: specimenPdfUrls.length
        });
      }

      const dedupedFonts: FontMetadata[] = [];
      const seen = new Set<string>();
      for (const font of fonts) {
        const key = `${font.url}|${font.format}|${font.family}|${font.style || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedupedFonts.push(font);
      }

      const expectedStyles = dedupeStrings(selectedProducts.flatMap((product) => extractExpectedStyles(product)));
      const expectedCount = selectedProducts.reduce((acc, product) => acc + Math.max(extractExpectedStyles(product).length, 0), 0);
      const primaryTargetUrl = selectedProducts.length === 1 ? buildProductUrl(selectedProducts[0].handle) : normalizedInput;
      const topTargetProfile = {
        source: "shopify-products-json+html-page-crawl",
        foundry: "Type Department",
        collectionHandle: scope.kind === "collection" ? scope.handle : undefined,
        productHandles: selectedProducts.map((product) => product.handle),
        expectedStyles,
        expectedCount,
        specimenPdfUrls: totalSpecimenPdfUrls
      };

      if (dedupedFonts.length === 0) {
        const fallbackFamily = selectedProducts.length === 1 ? selectedProducts[0].title : "Type Department Collection";
        return {
          scraperName: this.name,
          foundryName: "Type Department",
          fonts: [
            {
              url: "browser-intercept",
              family: fallbackFamily,
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              note: "Type Department fallback intercept (no direct assets resolved).",
              metadata: {
                foundry: "Type Department",
                family: fallbackFamily,
                pageUrl: primaryTargetUrl,
                targetUrl: primaryTargetUrl,
                previewOnly: true,
                lowFidelity: true,
                targetProfile: topTargetProfile
              }
            }
          ],
          originalUrl: url,
          targetUrl: primaryTargetUrl,
          expectedCount: expectedCount > 0 ? expectedCount : undefined,
          metadata: {
            foundry: "Type Department",
            scope,
            selectionReason: reason,
            catalogCount: catalog.length,
            selectedCount: selectedProducts.length,
            selectedHandles: selectedProducts.map((product) => product.handle),
            specimenPdfUrls: totalSpecimenPdfUrls,
            fallbackMode: "browser-intercept",
            targetProfile: topTargetProfile,
            products: summaries
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Type Department",
        fonts: dedupedFonts,
        originalUrl: url,
        targetUrl: primaryTargetUrl,
        expectedCount: expectedCount > 0 ? expectedCount : dedupedFonts.length,
        metadata: {
          foundry: "Type Department",
          scope,
          selectionReason: reason,
          catalogCount: catalog.length,
          selectedCount: selectedProducts.length,
          selectedHandles: selectedProducts.map((product) => product.handle),
          specimenPdfUrls: totalSpecimenPdfUrls,
          targetProfile: topTargetProfile,
          products: summaries
        }
      };
    } catch (error) {
      console.error("[TypeDepartmentScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Type Department",
        fonts: [],
        originalUrl: url
      };
    }
  }
};



























