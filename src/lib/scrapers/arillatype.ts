import crypto from "node:crypto";

import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";
import { putInlineFontAsset, type InlineFontAssetFormat } from "@/lib/server/inline-font-cache";

const ARILLATYPE_HOST = "arillatype.studio";
const ARILLATYPE_ORIGIN = "https://arillatype.studio";
const ARILLATYPE_BACKEND_ORIGIN = "https://backend.arillatype.studio";
const ARILLATYPE_REFRESH_ENDPOINT = `${ARILLATYPE_BACKEND_ORIGIN}/api_front/refresh_token`;
const ARILLATYPE_PRODUCTS_ENDPOINT = `${ARILLATYPE_BACKEND_ORIGIN}/api_front/products`;
const ARILLATYPE_VARIANT_ENDPOINT = `${ARILLATYPE_BACKEND_ORIGIN}/api_front/fonts/variant/`;
const ARILLATYPE_FETCH_TIMEOUT_MS = 30000;
const ARILLATYPE_FETCH_MAX_RETRIES = 3;
const ARILLATYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const ARILLATYPE_FEATURE_TAG_RE =
  /\b(ss\d{2}|cv\d{2}|liga|dlig|calt|salt|onum|lnum|pnum|tnum|frac|afrc|sups|subs|smcp|c2sc|case|ordn|kern|zero|sinf|numr|dnom|cpsp)\b/gi;
const ARILLATYPE_REQUIRED_FEATURE_TAGS = ["liga", "calt", "case"];

type ArillaStyleMode = "Normal" | "Italic";

type ArillaFeature = {
  code?: string;
  name?: string;
  example?: string;
};

type ArillaLabelValue = {
  label?: string;
  value?: string;
};

type ArillaVariantRecord = {
  id: number;
  title: string;
  weight?: number | string;
  buyable?: boolean;
  ean?: number;
  price?: number;
};

type ArillaProductRecord = {
  id: number;
  slug: string;
  title: string;
  url: string;
  categories: string[];
  variants: ArillaVariantRecord[];
  downloadTrial?: string;
  freeTrials: string[];
  otAllFeatures: ArillaFeature[];
  otFeatures: ArillaFeature[];
  otText?: string;
  humanInfo: ArillaLabelValue[];
  technicalInfo: ArillaLabelValue[];
};

type ArillaVariantFile = {
  id?: number;
  title?: string;
  type?: string;
  mime?: string;
  base64?: string;
  url?: string;
};

type ArillaScope = {
  slug?: string;
  targetUrl: string;
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

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const toSafeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

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
  const host = parsed.hostname.toLowerCase();
  if (host === `www.${ARILLATYPE_HOST}`) parsed.hostname = ARILLATYPE_HOST;
  parsed.hash = "";
  return parsed.href;
};

const extractScopeFromUrl = (targetUrl: string): ArillaScope => {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
    const fontIndex = parts.indexOf("font");
    if (fontIndex >= 0 && parts[fontIndex + 1]) {
      return {
        slug: parts[fontIndex + 1],
        targetUrl: `${ARILLATYPE_ORIGIN}/font/${parts[fontIndex + 1]}`
      };
    }

    if (parts.length >= 1) {
      const candidate = parts[parts.length - 1];
      if (candidate && candidate !== "buy" && candidate !== "trial-fonts") {
        return {
          slug: candidate,
          targetUrl: `${ARILLATYPE_ORIGIN}/font/${candidate}`
        };
      }
    }
  } catch {
    // ignore malformed URL
  }

  return {
    targetUrl: `${ARILLATYPE_ORIGIN}/font`
  };
};

const fetchTextWithRetry = async (url: string, init: RequestInit): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ARILLATYPE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARILLATYPE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < ARILLATYPE_FETCH_MAX_RETRIES) {
        await sleep(400 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Arilla fetch failed");
};

const fetchJsonWithRetry = async (url: string, init: RequestInit): Promise<unknown> => {
  const text = await fetchTextWithRetry(url, init);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON payload from ${url}: ${String(error)}`);
  }
};

const extractTokenFromRefreshPayload = (payload: unknown): string | undefined => {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  if (!isRecord(payload)) return undefined;

  const direct =
    asString(payload.token) ||
    asString(payload.refreshToken) ||
    asString(payload.refresh_token) ||
    asString(payload.accessToken) ||
    asString(payload.access_token);
  if (direct) return direct;

  for (const value of Object.values(payload)) {
    const candidate = asString(value);
    if (candidate && candidate.length >= 16) return candidate;
  }

  return undefined;
};

const fetchApiToken = async (targetUrl: string): Promise<string> => {
  const payload = await fetchJsonWithRetry(ARILLATYPE_REFRESH_ENDPOINT, {
    method: "GET",
    headers: {
      "User-Agent": ARILLATYPE_UA,
      Accept: "application/json,*/*",
      Origin: ARILLATYPE_ORIGIN,
      Referer: targetUrl
    }
  });
  const token = extractTokenFromRefreshPayload(payload);
  if (!token) throw new Error("Arilla refresh_token missing token");
  return token;
};

const buildApiHeaders = (params: { token: string; referer: string }): HeadersInit => ({
  "User-Agent": ARILLATYPE_UA,
  Accept: "application/json,*/*",
  Origin: ARILLATYPE_ORIGIN,
  Referer: params.referer,
  "x-token": params.token
});

const parseFeatures = (value: unknown): ArillaFeature[] => {
  if (!Array.isArray(value)) return [];
  const out: ArillaFeature[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    out.push({
      code: asString(row.code) || asString(row.tag),
      name: asString(row.name),
      example: asString(row.example)
    });
  }
  return out;
};

const parseLabelValueRows = (value: unknown): ArillaLabelValue[] => {
  if (!Array.isArray(value)) return [];
  const out: ArillaLabelValue[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    out.push({
      label: asString(row.label),
      value: asString(row.value)
    });
  }
  return out;
};

const parseCategoryNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const row of value) {
    if (typeof row === "string") {
      out.push(row);
      continue;
    }
    if (!isRecord(row)) continue;
    const candidate = asString(row.slug) || asString(row.title) || asString(row.name);
    if (candidate) out.push(candidate);
  }
  return dedupeStringList(out);
};

const parseVariants = (value: unknown): ArillaVariantRecord[] => {
  if (!Array.isArray(value)) return [];
  const out: ArillaVariantRecord[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const id = asNumber(row.id);
    const title =
      decodeHtml(
        asString(row.title) ||
          asString(row.name) ||
          asString(row.label) ||
          ""
      );
    if (!id || !title) continue;
    out.push({
      id,
      title: normalizeSpace(title),
      weight: asNumber(row.weight) ?? asString(row.weight),
      buyable: typeof row.buyable === "boolean" ? row.buyable : undefined,
      ean: asNumber(row.ean),
      price: asNumber(row.price)
    });
  }
  return out;
};

const parsePdfUrls = (value: unknown): string[] => {
  const out: string[] = [];
  const add = (raw: string | undefined) => {
    const candidate = asString(raw);
    if (!candidate) return;
    try {
      const resolved = new URL(candidate, ARILLATYPE_BACKEND_ORIGIN).href;
      if (/\.pdf(?:$|\?)/i.test(resolved)) out.push(resolved);
    } catch {
      // ignore malformed URL
    }
  };

  if (typeof value === "string") {
    add(value);
  } else if (Array.isArray(value)) {
    for (const row of value) {
      if (typeof row === "string") add(row);
      else if (isRecord(row)) {
        add(asString(row.url) || asString(row.href));
      }
    }
  } else if (isRecord(value)) {
    add(asString(value.url) || asString(value.href));
  }

  return dedupeStringList(out);
};

const parseProducts = (payload: unknown): ArillaProductRecord[] => {
  const rows = (() => {
    if (Array.isArray(payload)) return payload;
    if (!isRecord(payload)) return [];
    if (Array.isArray(payload.products)) return payload.products;
    if (Array.isArray(payload.data)) return payload.data;
    if (isRecord(payload.data) && Array.isArray(payload.data.products)) return payload.data.products;
    return [];
  })();

  const out: ArillaProductRecord[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const productNode = isRecord(row.Product) ? row.Product : row;
    const id = asNumber(productNode.id);
    const title = decodeHtml(asString(productNode.title) || asString(productNode.name) || "");
    const slug = asString(productNode.slug)?.toLowerCase();
    if (!id || !title || !slug) continue;

    const productUrl = asString(productNode.url) || `${ARILLATYPE_ORIGIN}/font/${slug}`;
    const variants = parseVariants(row.Variant || row.variants || productNode.variants);
    if (variants.length === 0) continue;

    const freeTrials = dedupeStringList([
      ...parsePdfUrls(productNode.free_trials),
      ...parsePdfUrls(productNode.freeTrials),
      ...parsePdfUrls(row.free_trials),
      ...parsePdfUrls(row.freeTrials)
    ]);

    const downloadTrial =
      parsePdfUrls(productNode.download_trial)[0] ||
      parsePdfUrls(productNode.downloadTrial)[0] ||
      parsePdfUrls(row.download_trial)[0] ||
      parsePdfUrls(row.downloadTrial)[0] ||
      undefined;

    out.push({
      id,
      slug,
      title: normalizeSpace(title),
      url: productUrl,
      categories: parseCategoryNames(productNode.categories || row.categories),
      variants,
      downloadTrial,
      freeTrials,
      otAllFeatures: parseFeatures(productNode.ot_all_features || row.ot_all_features),
      otFeatures: parseFeatures(productNode.ot_features || row.ot_features),
      otText: asString(productNode.ot_text) || asString(productNode.otText) || asString(row.ot_text) || asString(row.otText),
      humanInfo: parseLabelValueRows(productNode.human_info || productNode.humanInfo || row.human_info || row.humanInfo),
      technicalInfo: parseLabelValueRows(
        productNode.technical_info || productNode.technicalInfo || row.technical_info || row.technicalInfo
      )
    });
  }

  return out.sort((a, b) => a.slug.localeCompare(b.slug));
};
const resolveProductSet = (products: ArillaProductRecord[], scope: ArillaScope): ArillaProductRecord[] => {
  if (!scope.slug) return [];
  const token = normalizeToken(scope.slug);
  const exact = products.find((product) => normalizeToken(product.slug) === token);
  if (exact) return [exact];

  const fuzzy = products.filter((product) => {
    const slugToken = normalizeToken(product.slug);
    return slugToken.includes(token) || token.includes(slugToken);
  });
  return fuzzy;
};

const normalizeStyleLabel = (value: string): string => {
  const cleaned = normalizeSpace(value)
    .replace(/\bback[\s-]*slant(?:ed)?\b/gi, "Backslant")
    .replace(/\bslant(?:ed)?\b/gi, "Slanted")
    .replace(/semi[\s-]*bold/gi, "Semibold")
    .replace(/extra[\s-]*light/gi, "Extralight")
    .replace(/extra[\s-]*bold/gi, "Extrabold")
    .replace(/\bvar\b/gi, "Variable")
    .replace(/\btff\b/gi, "TTF")
    .trim();

  if (!cleaned) return "Regular";

  return cleaned
    .split(" ")
    .map((part) => {
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
};

const inferStyleMode = (styleLabel: string): ArillaStyleMode =>
  /italic|oblique|slanted|backslant/i.test(styleLabel) ? "Italic" : "Normal";

const inferWeight = (params: {
  styleLabel: string;
  explicitWeight?: string | number;
}): number | undefined => {
  const explicit = params.explicitWeight;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 1 && explicit <= 1000) {
    return explicit;
  }
  if (typeof explicit === "string") {
    const parsed = Number(explicit);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 1000) return parsed;
  }

  const token = normalizeToken(params.styleLabel);
  if (!token) return undefined;
  const numeric = token.match(/(?:^|[^0-9])(1000|950|900|800|700|600|500|450|400|350|300|250|200|150|100)(?:[^0-9]|$)/);
  if (numeric?.[1]) return Number(numeric[1]);

  if (token.includes("air") || token.includes("hairline") || token.includes("thin")) return 100;
  if (token.includes("extralight") || token.includes("ultralight")) return 200;
  if (token.includes("light")) return 300;
  if (token.includes("retina") || token.includes("book")) return 350;
  if (token.includes("regular") || token.includes("roman")) return 400;
  if (token.includes("medium")) return 500;
  if (token.includes("semibold") || token.includes("demibold")) return 600;
  if (token.includes("bold")) return 700;
  if (token.includes("extrabold") || token.includes("ultrabold")) return 800;
  if (token.includes("black") || token.includes("heavy")) return 900;
  if (token.includes("super")) return 950;
  return undefined;
};

const isVariableVariant = (styleLabel: string): boolean => /(?:^|\s)var(?:iable)?\b/i.test(styleLabel);

const normalizeVariants = (variants: ArillaVariantRecord[]): ArillaVariantRecord[] => {
  const withTitle = variants
    .filter((variant) => variant.id > 0 && normalizeSpace(variant.title))
    .map((variant) => ({
      ...variant,
      title: normalizeStyleLabel(variant.title)
    }));

  const buyable = withTitle.filter((variant) => variant.buyable !== false);
  const scoped = buyable.length > 0 ? buyable : withTitle;
  const withoutVar = scoped.filter((variant) => !isVariableVariant(variant.title));
  const selected = withoutVar.length > 0 ? withoutVar : scoped;

  return selected.sort((a, b) => {
    const aWeight = inferWeight({ styleLabel: a.title, explicitWeight: a.weight }) ?? 9999;
    const bWeight = inferWeight({ styleLabel: b.title, explicitWeight: b.weight }) ?? 9999;
    if (aWeight !== bWeight) return aWeight - bWeight;
    return a.title.localeCompare(b.title);
  });
};

const extractVariantFiles = (payload: unknown): ArillaVariantFile[] => {
  const rows = (() => {
    if (Array.isArray(payload)) return payload;
    if (!isRecord(payload)) return [];
    if (Array.isArray(payload.fonts)) return payload.fonts;
    if (isRecord(payload.fonts)) {
      if (Array.isArray(payload.fonts.File)) return payload.fonts.File;
      if (Array.isArray(payload.fonts.files)) return payload.fonts.files;
      if (Array.isArray(payload.fonts.data)) return payload.fonts.data;
    }
    if (Array.isArray(payload.files)) return payload.files;
    if (Array.isArray(payload.data)) return payload.data;
    if (isRecord(payload.data) && Array.isArray(payload.data.files)) return payload.data.files;
    return [];
  })();

  const out: ArillaVariantFile[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const base64 =
      asString(row.base64) ||
      asString(row.file) ||
      asString(row.content) ||
      asString(row.data) ||
      (isRecord(row.file) ? asString(row.file.base64) : undefined) ||
      (isRecord(row.data) ? asString(row.data.base64) : undefined);
    const url =
      asString(row.url) ||
      asString(row.href) ||
      asString(row.src) ||
      (isRecord(row.file) ? asString(row.file.url) : undefined);

    if (!base64 && !url) continue;

    out.push({
      id: asNumber(row.id),
      title: asString(row.title) || asString(row.name),
      type: asString(row.type),
      mime: asString(row.mime) || asString(row.contentType) || asString(row.content_type),
      base64,
      url
    });
  }
  return out;
};

const inferFormatFromUrl = (url: string): FontMetadata["format"] | undefined => {
  try {
    const lower = new URL(url).pathname.toLowerCase();
    if (lower.endsWith(".woff2")) return "woff2";
    if (lower.endsWith(".woff")) return "woff";
    if (lower.endsWith(".otf")) return "otf";
    if (lower.endsWith(".ttf")) return "ttf";
    if (lower.endsWith(".zip")) return "zip";
  } catch {
    // ignore malformed URL
  }
  return undefined;
};

const inferFormatFromBuffer = (
  buffer: Buffer,
  hints: { title?: string; url?: string; mime?: string }
): InlineFontAssetFormat | undefined => {
  const titleHint = hints.title || "";
  const urlHint = hints.url || "";
  const extHint = inferFormatFromUrl(urlHint) || inferFormatFromUrl(`https://local/${titleHint}`);
  if (extHint && (extHint === "woff2" || extHint === "woff" || extHint === "otf" || extHint === "ttf" || extHint === "zip")) {
    return extHint;
  }

  const magic4 = buffer.subarray(0, 4).toString("hex");
  if (magic4 === "774f4632") return "woff2";
  if (magic4 === "774f4646") return "woff";
  if (magic4 === "4f54544f") return "otf";
  if (magic4 === "00010000") return "ttf";
  if (magic4 === "74727565") return "ttf";
  if (magic4 === "504b0304") return "zip";

  const mime = (hints.mime || "").toLowerCase();
  if (mime.includes("woff2")) return "woff2";
  if (mime.includes("woff")) return "woff";
  if (mime.includes("otf") || mime.includes("opentype")) return "otf";
  if (mime.includes("ttf") || mime.includes("truetype")) return "ttf";
  if (mime.includes("zip")) return "zip";
  return undefined;
};

const decodeBase64ToBuffer = (rawBase64: string): Buffer | undefined => {
  const normalized = rawBase64
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .trim();
  if (!normalized) return undefined;

  try {
    const buffer = Buffer.from(normalized, "base64");
    if (!buffer || buffer.length === 0) return undefined;
    return buffer;
  } catch {
    return undefined;
  }
};

const extractFeatureTags = (product: ArillaProductRecord): string[] => {
  const out = new Set<string>();
  const add = (raw: string | undefined) => {
    const token = asString(raw)?.toLowerCase();
    if (!token) return;
    if (/^[a-z0-9]{4}$/.test(token) || /^ss\d{2}$/.test(token) || /^cv\d{2}$/.test(token)) {
      out.add(token);
    }
  };

  for (const feature of product.otAllFeatures) {
    add(feature.code);
    const text = normalizeSpace(`${feature.name || ""} ${feature.example || ""}`);
    for (const match of text.matchAll(ARILLATYPE_FEATURE_TAG_RE)) {
      add(match[1]);
    }
  }

  for (const feature of product.otFeatures) {
    add(feature.code);
    const text = normalizeSpace(`${feature.name || ""} ${feature.example || ""}`);
    for (const match of text.matchAll(ARILLATYPE_FEATURE_TAG_RE)) {
      add(match[1]);
    }
  }

  const otText = asString(product.otText) || "";
  for (const match of otText.matchAll(ARILLATYPE_FEATURE_TAG_RE)) {
    add(match[1]);
  }

  const technicalText = product.technicalInfo
    .map((row) => `${row.label || ""} ${row.value || ""}`)
    .join(" ");
  for (const match of technicalText.matchAll(ARILLATYPE_FEATURE_TAG_RE)) {
    add(match[1]);
  }

  for (const required of ARILLATYPE_REQUIRED_FEATURE_TAGS) {
    out.add(required);
  }

  return Array.from(out);
};

const buildTargetProfile = (params: {
  product: ArillaProductRecord;
  selectedVariants: ArillaVariantRecord[];
  targetUrl: string;
}): Record<string, unknown> => {
  const featureTags = extractFeatureTags(params.product);
  const styleMap = params.selectedVariants.map((variant) => {
    const styleName = normalizeStyleLabel(variant.title);
    return {
      variantId: variant.id,
      styleName,
      fullName: `${params.product.title} ${styleName}`.replace(/\s+/g, " ").trim(),
      style: inferStyleMode(styleName),
      weight: inferWeight({ styleLabel: styleName, explicitWeight: variant.weight }),
      explicitWeight: variant.weight,
      ean: variant.ean,
      buyable: variant.buyable
    };
  });

  const expectedStyles = dedupeStringList(styleMap.map((row) => String(row.fullName)));
  const specimenPdfUrls = dedupeStringList([
    ...(params.product.downloadTrial ? [params.product.downloadTrial] : []),
    ...params.product.freeTrials.filter((url) => /\.pdf(?:$|\?)/i.test(url))
  ]);

  return {
    profileId: "arillatype-target-profile-v1",
    source: "api_front-products+api_front-fonts-variant-inline",
    foundry: "Arilla Type",
    family: params.product.title,
    familyDisplay: params.product.title,
    familySlug: params.product.slug,
    productId: params.product.id,
    targetUrl: params.targetUrl,
    styleScope: "family-style",
    strictMissingStyles: true,
    failOnTrialAssets: false,
    expectedStyles,
    expectedStyleCount: expectedStyles.length,
    styleMap,
    specimenPdfUrls,
    requiredFeatureTags: featureTags,
    minCmapEntries: 350,
    minFeatureCount: 8,
    outputNaming: {
      prefix: "arilla-type",
      pattern: "arilla-type-{family-slug}-{style-slug}.{ext}",
      styleTokenCase: "lowercase",
      separator: "-",
      stableSort: "lexical"
    },
    formatPolicy: "inline-variant-payload (woff2/woff/otf/ttf) + downloader conversion",
    outputFormats: ["woff2", "woff", "otf", "ttf"],
    categories: params.product.categories,
    otAllFeaturesCount: params.product.otAllFeatures.length,
    otFeaturesCount: params.product.otFeatures.length,
    technicalInfo: params.product.technicalInfo,
    humanInfo: params.product.humanInfo,
    collectedAt: new Date().toISOString()
  };
};
const buildFallbackInjectScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const selectors = Array.from(document.querySelectorAll("button,a,[role='button'],[data-style],[data-font],[class*='style'],[class*='variant']"));
    for (const node of selectors.slice(0, 260)) {
      try {
        if (node instanceof HTMLElement) {
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } catch {}
      await sleep(45);
    }
    await sleep(1200);
  })();
`;

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.floor(limit));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const run = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
  return results;
};

export const ArillaTypeScraper: Scraper = {
  id: "arillatype",
  name: "Arilla Type Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?arillatype\.studio/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const normalizedInput = normalizeTargetUrl(url);
      const scope = extractScopeFromUrl(normalizedInput);

      if (!scope.slug) {
        return {
          scraperName: this.name,
          foundryName: "Arilla Type",
          fonts: [],
          originalUrl: url,
          metadata: {
            foundry: "Arilla Type",
            reason: "scope-slug-not-found",
            targetUrl: scope.targetUrl
          }
        };
      }

      const token = await fetchApiToken(scope.targetUrl);
      const productsPayload = await fetchJsonWithRetry(ARILLATYPE_PRODUCTS_ENDPOINT, {
        method: "GET",
        headers: buildApiHeaders({ token, referer: scope.targetUrl })
      });
      const products = parseProducts(productsPayload);
      const scopedProducts = resolveProductSet(products, scope);

      if (scopedProducts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Arilla Type",
          fonts: [],
          originalUrl: url,
          metadata: {
            foundry: "Arilla Type",
            reason: "product-not-found",
            slug: scope.slug,
            catalogCount: products.length
          }
        };
      }

      const product = scopedProducts[0];
      const selectedVariants = normalizeVariants(product.variants);
      const targetUrl = product.url || scope.targetUrl;
      const targetProfile = buildTargetProfile({
        product,
        selectedVariants,
        targetUrl
      });

      if (selectedVariants.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Arilla Type",
          fonts: [
            {
              url: "browser-intercept",
              family: product.title,
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "Arilla Type",
                family: product.title,
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
            foundry: "Arilla Type",
            family: product.title,
            slug: product.slug,
            reason: "no-variants-after-filter",
            targetProfile
          }
        };
      }

      const fonts: FontMetadata[] = [];
      const seenPayloadHash = new Set<string>();
      const variantErrors: Array<{ variantId: number; message: string }> = [];
      const foundryPrefix = "arilla-type";
      const safeFamilySlug = toSafeSlug(product.slug) || "unknown-family";

      await mapLimit(selectedVariants, 5, async (variant) => {
        const styleName = normalizeStyleLabel(variant.title);
        const styleSlug = toSafeSlug(styleName) || "regular";
        const fullName = `${product.title} ${styleName}`.replace(/\s+/g, " ").trim();
        const style = inferStyleMode(styleName);
        const weight = inferWeight({ styleLabel: styleName, explicitWeight: variant.weight }) ?? "Regular";

        try {
          const payload = await fetchJsonWithRetry(`${ARILLATYPE_VARIANT_ENDPOINT}${variant.id}`, {
            method: "GET",
            headers: buildApiHeaders({ token, referer: targetUrl })
          });
          const files = extractVariantFiles(payload);

          let variantFileIndex = 0;
          for (const file of files) {
            const fileTitle = normalizeSpace(file.title || `variant-${variant.id}-${variantFileIndex + 1}`);
            const fallbackName = `${foundryPrefix}-${safeFamilySlug}-${styleSlug}${variantFileIndex > 0 ? `-${variantFileIndex + 1}` : ""}`;

            if (file.base64) {
              const buffer = decodeBase64ToBuffer(file.base64);
              if (!buffer) {
                variantFileIndex += 1;
                continue;
              }
              const format = inferFormatFromBuffer(buffer, { title: fileTitle, url: file.url, mime: file.mime });
              if (!format) {
                variantFileIndex += 1;
                continue;
              }

              const payloadHash = crypto.createHash("sha256").update(buffer).digest("hex");
              if (seenPayloadHash.has(payloadHash)) {
                variantFileIndex += 1;
                continue;
              }
              seenPayloadHash.add(payloadHash);

              const tokenRef = putInlineFontAsset({
                buffer,
                format,
                fileNameHint: `${fallbackName}.${format}`,
                foundry: "Arilla Type",
                family: product.title
              });

              fonts.push({
                url: `inline-font://${tokenRef}`,
                family: product.title,
                format,
                style,
                weight,
                downloadable: true,
                note: "Arilla Type API payload (inline).",
                metadata: {
                  foundry: "Arilla Type",
                  family: product.title,
                  familySlug: product.slug,
                  productId: product.id,
                  variantId: variant.id,
                  variantEan: variant.ean,
                  styleName,
                  fullName,
                  sourceType: "api_front-fonts-variant-inline",
                  fileType: file.type,
                  pageUrl: targetUrl,
                  targetUrl,
                  fileNameHint: `${fallbackName}.${format}`,
                  forceMetadataRepair: true,
                  skipConversion: format !== "woff2",
                  targetProfile
                }
              });
              variantFileIndex += 1;
              continue;
            }

            const directUrl = asString(file.url);
            if (directUrl) {
              const resolved = new URL(directUrl, ARILLATYPE_BACKEND_ORIGIN).href;
              const format = inferFormatFromUrl(resolved) || "woff2";
              fonts.push({
                url: resolved,
                family: product.title,
                format,
                style,
                weight,
                downloadable: true,
                note: "Arilla Type API file URL.",
                metadata: {
                  foundry: "Arilla Type",
                  family: product.title,
                  familySlug: product.slug,
                  productId: product.id,
                  variantId: variant.id,
                  variantEan: variant.ean,
                  styleName,
                  fullName,
                  sourceType: "api_front-fonts-variant-url",
                  fileType: file.type,
                  pageUrl: targetUrl,
                  targetUrl,
                  fileNameHint: `${fallbackName}.${format}`,
                  forceMetadataRepair: true,
                  targetProfile,
                  headers: {
                    Origin: ARILLATYPE_ORIGIN,
                    Referer: targetUrl,
                    Accept: "*/*",
                    "x-token": token
                  }
                }
              });
              variantFileIndex += 1;
            }
          }
        } catch (error) {
          variantErrors.push({
            variantId: variant.id,
            message: error instanceof Error ? error.message : "variant-fetch-failed"
          });
        }
      });

      if (fonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Arilla Type",
          fonts: [
            {
              url: "browser-intercept",
              family: product.title,
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "Arilla Type",
                family: product.title,
                pageUrl: targetUrl,
                targetUrl,
                targetProfile
              }
            }
          ],
          originalUrl: url,
          targetUrl,
          injectScript: buildFallbackInjectScript(),
          expectedCount: selectedVariants.length,
          metadata: {
            foundry: "Arilla Type",
            family: product.title,
            slug: product.slug,
            reason: "variant-files-empty",
            selectedVariantCount: selectedVariants.length,
            variantErrors,
            targetProfile
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Arilla Type",
        fonts,
        originalUrl: url,
        targetUrl,
        expectedCount: selectedVariants.length,
        metadata: {
          foundry: "Arilla Type",
          family: product.title,
          slug: product.slug,
          productId: product.id,
          selectedVariantCount: selectedVariants.length,
          capturedFontCount: fonts.length,
          specimenPdfUrls: targetProfile.specimenPdfUrls,
          variantErrors,
          targetProfile
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Arilla Type scrape failed: ${message}`);
    }
  }
};
