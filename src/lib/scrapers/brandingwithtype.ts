import vm from "node:vm";

import type { FontMetadata, ScrapeResult, Scraper } from "./types";
import { putInlineFontAsset } from "@/lib/server/inline-font-cache";

const BRANDING_WITH_TYPE_HOST = "brandingwithtype.com";
const BRANDING_WITH_TYPE_ORIGIN = "https://brandingwithtype.com";

const BWT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0"
];

const getRandomUA = () => BWT_USER_AGENTS[Math.floor(Math.random() * BWT_USER_AGENTS.length)];

const FETCH_TIMEOUT_MS = 25000;
const FETCH_RETRIES = 3;
const RETAIL_ENDPOINT_ENV_KEYS = ["BWT_RETAIL_PACKAGE_URLS", "BWT_RETAIL_PACKAGE_URL"] as const;

type BwtVariant = {
  id?: number;
  hash: string;
  fullName: string;
  familyName: string;
  styleName: string;
  style: "Normal" | "Italic";
  weight: string;
  subfamilyName?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const toTitleWords = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const stripFamilyMarkers = (value: string): string =>
  value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(sub)?family\b/gi, " ")
    .replace(/\bcollection\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripPrefixInsensitive = (value: string, prefix: string): string => {
  const content = value.trim();
  const base = prefix.trim();
  if (!content || !base) return content;

  const contentToken = normalizeToken(content);
  const baseToken = normalizeToken(base);
  if (!contentToken || !baseToken) return content;

  if (contentToken === baseToken) return "Regular";
  const matcher = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
  const stripped = content.replace(matcher, "").trim();
  if (!stripped) return "Regular";

  if (normalizeToken(stripped) === contentToken) {
    return "Regular";
  }
  return stripped;
};

const STYLE_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "ExtraBold Italic", regex: /extra[\s-]*bold\s+italic$/i },
  { label: "SemiBold Italic", regex: /semi[\s-]*bold\s+italic$/i },
  { label: "Hairline Italic", regex: /hairline\s+italic$/i },
  { label: "Regular Italic", regex: /regular\s+italic$/i },
  { label: "Book Italic", regex: /book\s+italic$/i },
  { label: "Medium Italic", regex: /medium\s+italic$/i },
  { label: "Black Italic", regex: /black\s+italic$/i },
  { label: "Light Italic", regex: /light\s+italic$/i },
  { label: "Bold Italic", regex: /bold\s+italic$/i },
  { label: "Thin Italic", regex: /thin\s+italic$/i },
  { label: "ExtraBold", regex: /extra[\s-]*bold$/i },
  { label: "SemiBold", regex: /semi[\s-]*bold$/i },
  { label: "Hairline", regex: /hairline$/i },
  { label: "Regular", regex: /regular$/i },
  { label: "Medium", regex: /medium$/i },
  { label: "Black", regex: /black$/i },
  { label: "Light", regex: /light$/i },
  { label: "Bold", regex: /bold$/i },
  { label: "Book", regex: /book$/i },
  { label: "Thin", regex: /thin$/i }
];

const parseStyleFromFullName = (fullName: string, familyName: string): string => {
  const candidate = fullName.replace(/\s+/g, " ").trim();
  if (!candidate) return "Regular";

  for (const entry of STYLE_PATTERNS) {
    if (entry.regex.test(candidate)) {
      return entry.label;
    }
  }

  const stripped = stripPrefixInsensitive(candidate, familyName);
  if (!stripped || normalizeToken(stripped) === normalizeToken(familyName)) return "Regular";
  return stripped;
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const normalizeTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  parsed.hostname = BRANDING_WITH_TYPE_HOST;
  return parsed.href;
};

const parseRetailUrls = (raw: string): string[] =>
  raw
    .split(/[\r\n,;]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

const resolveRetailPackageUrls = (slug?: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const key of RETAIL_ENDPOINT_ENV_KEYS) {
    const raw = process.env[key];
    if (!raw) continue;
    const urls = parseRetailUrls(raw);
    for (const url of urls) {
      // Replace placeholders before URL parsing to avoid `%7Bslug%7D` encoding.
      const resolved = slug ? url.replace(/\{slug\}/gi, slug) : url;
      try {
        const href = new URL(resolved).href;
        if (!seen.has(href)) {
          seen.add(href);
          out.push(href);
        }
      } catch {
        // ignore malformed candidate
      }
    }
  }

  return out;
};

const inferFormatFromUrl = (url: string): FontMetadata["format"] => {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".zip")) return "zip";
    if (pathname.endsWith(".woff2")) return "woff2";
    if (pathname.endsWith(".woff")) return "woff";
    if (pathname.endsWith(".otf")) return "otf";
    if (pathname.endsWith(".ttf")) return "ttf";
    if (pathname.endsWith(".eot")) return "eot";
  } catch {
    // ignore parsing fallback
  }
  // Retail package endpoints often omit file extensions.
  return "zip";
};

const buildRetailHeaders = (buyUrl: string): Record<string, string> => {
  const headers: Record<string, string> = {
    Origin: BRANDING_WITH_TYPE_ORIGIN,
    Referer: process.env.BWT_RETAIL_REFERER || buyUrl,
    Accept: "*/*"
  };

  if (process.env.BWT_RETAIL_COOKIE) {
    headers.Cookie = process.env.BWT_RETAIL_COOKIE;
  }
  if (process.env.BWT_RETAIL_AUTHORIZATION) {
    headers.Authorization = process.env.BWT_RETAIL_AUTHORIZATION;
  }

  return headers;
};

const extractTypeSlug = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] !== "typefaces") return undefined;
    return segments[1]?.toLowerCase();
  } catch {
    return undefined;
  }
};

const resolveFamilyUrl = (targetUrl: string): string => {
  const parsed = new URL(targetUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] === "typefaces" && segments[1]) {
    parsed.pathname = `/typefaces/${segments[1]}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  }
  parsed.pathname = "/typefaces";
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
};

const resolveBuyUrlFromFamily = (familyUrl: string, html: string): string => {
  const explicit = html.match(/href=["']([^"']*\/buy)["']/i)?.[1];
  if (explicit) {
    try {
      return new URL(explicit, familyUrl).href;
    } catch {
      // ignore and use fallback
    }
  }

  try {
    const parsed = new URL(familyUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "typefaces" && segments[1]) {
      parsed.pathname = `/typefaces/${segments[1]}/buy`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    }
  } catch {
    // ignore
  }

  return `${BRANDING_WITH_TYPE_ORIGIN}/typefaces`;
};

const extractFamilyName = (html: string, fallback: string): string => {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = decodeHtmlEntities((titleMatch?.[1] || "").trim());
  if (title) {
    const head = title.split("·")[0]?.trim() || title.split("|")[0]?.trim() || title;
    const cleaned = stripFamilyMarkers(head);
    if (cleaned) return cleaned;
  }

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) {
    const h1 = decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    const cleaned = stripFamilyMarkers(h1);
    if (cleaned) return cleaned;
  }

  return fallback;
};

const extractSpecimenPdfUrls = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) {
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

const extractDemoZipUrls = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+?\.zip(?:\?[^"']*)?)["']/gi)) {
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

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": getRandomUA(),
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-CH-UA": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
          "Sec-CH-UA-Mobile": "?0",
          "Sec-CH-UA-Platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          ...(referer ? { Referer: referer } : {})
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        // Random jitter between 1s and 3s
        await sleep(1000 + Math.random() * 2000);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch page");
};

const findBalancedSegment = (source: string, startIndex: number, openChar: string, closeChar: string): number => {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inSingle) {
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === "\"") {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
};

const extractBuyObjectLiteral = (html: string): string | undefined => {
  const attrRegex = /x-data\s*=\s*(['"])buy\(/gi;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(html)) !== null) {
    const matchStart = match.index;
    const fullMatch = match[0];
    const quote = match[1];
    const openParenIndex = matchStart + fullMatch.length - 1;
    const closeParenIndex = findBalancedSegment(html, openParenIndex, "(", ")");
    if (closeParenIndex <= openParenIndex) continue;

    const quoteIndex = html.indexOf(quote, closeParenIndex + 1);
    if (quoteIndex === -1) continue;

    const objectLiteral = html.slice(openParenIndex + 1, closeParenIndex).trim();
    if (objectLiteral) return objectLiteral;
  }

  return undefined;
};

const parseBuyPayload = (objectLiteral: string): Record<string, unknown> | undefined => {
  try {
    const wrapped = `(() => (${objectLiteral}))()`;
    const parsed = vm.runInNewContext(wrapped, Object.create(null), { timeout: 1000 });
    if (isRecord(parsed)) return parsed;
  } catch {
    // ignore parse failure
  }
  return undefined;
};

const inferWeightFromStyle = (styleLabel: string): string => {
  const token = normalizeToken(styleLabel);
  if (/hairline|thin/.test(token)) return "Thin";
  if (/extralight|ultralight/.test(token)) return "ExtraLight";
  if (/light/.test(token)) return "Light";
  if (/book/.test(token)) return "Book";
  if (/medium/.test(token)) return "Medium";
  if (/semibold|demibold/.test(token)) return "SemiBold";
  if (/extrabold|ultrabold/.test(token)) return "ExtraBold";
  if (/bold/.test(token)) return "Bold";
  if (/heavy/.test(token)) return "Heavy";
  if (/black/.test(token)) return "Black";
  return "Regular";
};

const normalizeStyleLabel = (styleLabel: string): string => {
  const value = styleLabel.replace(/\s+/g, " ").trim();
  if (!value) return "Regular";
  if (/^oblique$/i.test(value)) return "Regular Italic";
  if (/^italic$/i.test(value)) return "Regular Italic";
  return value;
};

const deriveFamilyFromFullName = (fullName: string, styleName: string): string | undefined => {
  const candidate = fullName.replace(/\s+/g, " ").trim();
  const styleToken = styleName.replace(/\s+/g, " ").trim();
  if (!candidate || !styleToken) return undefined;

  const fullLower = candidate.toLowerCase();
  const styleLower = styleToken.toLowerCase();
  if (!fullLower.endsWith(styleLower)) return undefined;

  const familyPart = candidate.slice(0, candidate.length - styleToken.length).trim();
  return familyPart || undefined;
};

const buildVariantRecord = (params: {
  rawVariant: Record<string, unknown>;
  familyName: string;
  subfamilyName?: string;
}): BwtVariant | undefined => {
  const hash = asString(params.rawVariant.hash);
  const fullName = asString(params.rawVariant.fullName) || asString(params.rawVariant.name);
  if (!hash || !fullName) return undefined;

  const baseFamilyName = stripFamilyMarkers(params.familyName) || params.familyName;
  const styleRaw = parseStyleFromFullName(fullName, baseFamilyName);
  const styleName = normalizeStyleLabel(styleRaw);
  const familyFromFullName = deriveFamilyFromFullName(fullName, styleName);
  const style: "Normal" | "Italic" = /italic|oblique/i.test(styleName) ? "Italic" : "Normal";
  const weight = inferWeightFromStyle(styleName);
  const idRaw = Number(params.rawVariant.id);
  const id = Number.isFinite(idRaw) ? idRaw : undefined;

  return {
    id,
    hash,
    fullName,
    familyName: familyFromFullName || baseFamilyName,
    styleName,
    style,
    weight,
    subfamilyName: params.subfamilyName
  };
};

const collectVariantsFromPayload = (payload: Record<string, unknown>, fallbackFamily: string): BwtVariant[] => {
  const out: BwtVariant[] = [];
  const seenHash = new Set<string>();

  const product = isRecord(payload.product) ? payload.product : undefined;
  const productFamily = stripFamilyMarkers(asString(product?.fullName) || fallbackFamily) || fallbackFamily;

  const pushVariant = (raw: unknown, familyName: string, subfamilyName?: string): void => {
    if (!isRecord(raw)) return;
    const next = buildVariantRecord({ rawVariant: raw, familyName, subfamilyName });
    if (!next) return;
    if (seenHash.has(next.hash)) return;
    seenHash.add(next.hash);
    out.push(next);
  };

  const variants = Array.isArray(payload.variants) ? payload.variants : [];
  for (const variant of variants) {
    pushVariant(variant, productFamily);
  }

  const subfamilies = Array.isArray(payload.subfamilies) ? payload.subfamilies : [];
  for (const subfamily of subfamilies) {
    if (!isRecord(subfamily)) continue;
    const subfamilyLabel = asString(subfamily.fullName);
    const familyName = stripFamilyMarkers(subfamilyLabel || productFamily) || productFamily;
    const items = Array.isArray(subfamily.variants) ? subfamily.variants : [];
    for (const variant of items) {
      pushVariant(variant, familyName, subfamilyLabel);
    }
  }

  return out;
};

const extractFontFaceMapFromHtml = (html: string): Map<string, string> => {
  const out = new Map<string, string>();
  const regex = /window\.fontFaces\[['"]([^'"]+)['"]\]\s*=\s*`([\s\S]*?)`;/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const hash = asString(match[1]);
    const encoded = asString(match[2]);
    if (!hash || !encoded) continue;
    if (!out.has(hash)) out.set(hash, encoded);
  }

  return out;
};

const mergeFontFaceMaps = (...maps: Map<string, string>[]): Map<string, string> => {
  const out = new Map<string, string>();
  for (const map of maps) {
    for (const [key, value] of map.entries()) {
      if (!out.has(key)) out.set(key, value);
    }
  }
  return out;
};

const extractLayoutAssetUrl = (html: string, baseUrl: string): string | undefined => {
  const patterns = [
    /href=["']([^"']*\/build\/assets\/layout-[^"']+?\.js)["']/gi,
    /src=["']([^"']*\/build\/assets\/layout-[^"']+?\.js)["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = asString(match[1]);
      if (!raw) continue;
      try {
        return new URL(raw, baseUrl).href;
      } catch {
        // ignore malformed candidate
      }
    }
  }

  return undefined;
};

const extractDecoderSegment = (layoutJs: string): string | undefined => {
  const start = layoutJs.indexOf("function kh(");
  if (start === -1) return undefined;

  const jtStart = layoutJs.indexOf("function Jt(", start);
  if (jtStart === -1) return undefined;

  const openBrace = layoutJs.indexOf("{", jtStart);
  if (openBrace === -1) return undefined;

  const end = findBalancedSegment(layoutJs, openBrace, "{", "}");
  if (end === -1) return undefined;

  return layoutJs.slice(start, end + 1);
};

const toBuffer = (value: unknown): Buffer | undefined => {
  if (!value) return undefined;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    return Buffer.from(value, "binary");
  }
  return undefined;
};

const decodeFontFacesViaVm = (
  decoderSegment: string,
  fontFacesMap: Map<string, string>
): Map<string, Buffer> => {
  const decoded = new Map<string, Buffer>();
  const fontFacesObject = Object.fromEntries(fontFacesMap.entries());

  class CapturedFontFace {
    family: string;
    source: unknown;

    constructor(family: string, source: unknown) {
      this.family = String(family);
      this.source = source;

      const buffer = toBuffer(source);
      if (buffer && buffer.length > 0) {
        decoded.set(this.family, buffer);
      }
    }
  }

  const context: Record<string, unknown> = {
    window: { fontFaces: fontFacesObject },
    document: { fonts: { add: () => undefined } },
    FontFace: CapturedFontFace,
    atob: (value: string) => Buffer.from(String(value || ""), "base64").toString("binary"),
    TextDecoder,
    Uint8Array,
    Buffer,
    String,
    Array,
    Object,
    RegExp
  };

  context.globalThis = context;
  context.global = context;

  vm.runInNewContext(decoderSegment, context, { timeout: 5000 });
  return decoded;
};

const toSafeFileToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "font";

const buildTargetProfile = (params: {
  targetUrl: string;
  buyUrl: string;
  slug?: string;
  familyName: string;
  variants: BwtVariant[];
  specimenPdfUrls: string[];
  demoZipUrls: string[];
  missingHashes: string[];
  decodedHashCount: number;
}): Record<string, unknown> => {
  const expectedStyles = params.variants.map((variant) => variant.fullName.trim());
  const styleMap = params.variants.map((variant) => ({
    id: variant.id,
    hash: variant.hash,
    fullName: variant.fullName,
    familyName: variant.familyName,
    styleName: variant.styleName,
    expectedStyle: variant.fullName.trim(),
    style: variant.style,
    weight: variant.weight,
    subfamilyName: variant.subfamilyName
  }));

  return {
    profileId: "brandingwithtype-target-profile-v1",
    source: "buy-payload+window-fontFaces+layout-decoder",
    foundry: "Branding With Type",
    styleScope: "family-style",
    strictMissingStyles: true,
    targetUrl: params.targetUrl,
    buyUrl: params.buyUrl,
    targetSlug: params.slug,
    familyDisplay: params.familyName,
    expectedStyles,
    expectedStyleCount: expectedStyles.length,
    styleMap,
    specimenPdfUrls: params.specimenPdfUrls,
    demoZipUrls: params.demoZipUrls,
    decodedHashCount: params.decodedHashCount,
    missingHashes: params.missingHashes,
    missingHashCount: params.missingHashes.length,
    collectedAt: new Date().toISOString()
  };
};

const buildDirectFonts = (params: {
  variants: BwtVariant[];
  decodedMap: Map<string, Buffer>;
  targetUrl: string;
  buyUrl: string;
  targetProfile: Record<string, unknown>;
}): ScrapeResult["fonts"] => {
  const out: FontMetadata[] = [];
  const seenHashes = new Set<string>();

  for (const variant of params.variants) {
    if (seenHashes.has(variant.hash)) continue;
    seenHashes.add(variant.hash);

    const buffer = params.decodedMap.get(variant.hash);
    if (!buffer || buffer.length === 0) continue;

    const fileToken = toSafeFileToken(variant.fullName);
    const token = putInlineFontAsset({
      buffer,
      format: "woff2",
      fileNameHint: `${fileToken}.woff2`,
      foundry: "Branding With Type",
      family: variant.familyName
    });

    out.push({
      url: `inline-font://${token}`,
      family: variant.familyName,
      format: "woff2",
      style: variant.style,
      weight: variant.weight,
      downloadable: true,
      note: "Decoded Branding With Type retail payload.",
      metadata: {
        foundry: "Branding With Type",
        pageUrl: params.buyUrl,
        targetUrl: params.targetUrl,
        family: variant.familyName,
        styleName: variant.styleName,
        fullName: variant.fullName,
        variantId: variant.id,
        variantHash: variant.hash,
        format: "woff2",
        forceMetadataRepair: true,
        targetProfile: params.targetProfile,
        headers: {
          Origin: BRANDING_WITH_TYPE_ORIGIN,
          Referer: params.buyUrl,
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
    const test = "Sphinx of black quartz, judge my vow 0123456789 !@#$%^&*()";

    const editables = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true'], [contenteditable]"));
    for (const field of editables) {
      try {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          field.value = test;
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          field.textContent = test;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } catch {}
    }

    const clickables = Array.from(document.querySelectorAll("button, a, [role='button'], [data-style], [data-font], [data-weight]"));
    for (const node of clickables.slice(0, 120)) {
      try {
        (node as any).click?.();
      } catch {}
      await sleep(90);
    }
    await sleep(1200);
    window.__specimen_extraction_complete = true;
    window.__saka_extraction_complete = true;
  })();
`;

const buildRetailDirectFonts = (params: {
  urls: string[];
  familyName: string;
  targetUrl: string;
  buyUrl: string;
  targetProfile: Record<string, unknown>;
}): ScrapeResult["fonts"] => {
  const headers = buildRetailHeaders(params.buyUrl);

  return params.urls.map((url, index) => {
    const format = inferFormatFromUrl(url);
    return {
      url,
      family: params.familyName,
      format,
      style: "Normal",
      weight: "Regular",
      downloadable: true,
      note: "Retail package endpoint (authenticated access required).",
      metadata: {
        foundry: "Branding With Type",
        pageUrl: params.buyUrl,
        targetUrl: params.targetUrl,
        family: params.familyName,
        retailPackage: true,
        retailSourceIndex: index,
        targetProfile: params.targetProfile,
        headers
      }
    };
  });
};

export const BrandingWithTypeScraper: Scraper = {
  id: "brandingwithtype",
  name: "Branding With Type Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)brandingwithtype\.com/i.test(url) || url.includes("brandingwithtype.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const normalized = normalizeTargetUrl(url);
      const familyUrl = resolveFamilyUrl(normalized);
      const slug = extractTypeSlug(familyUrl);
      const fallbackFamily = toTitleWords((slug || "branding-with-type").replace(/^bw-/, "bw "));

      const familyHtml = await fetchTextWithRetry(familyUrl, BRANDING_WITH_TYPE_ORIGIN);
      const familyName = extractFamilyName(familyHtml, fallbackFamily);
      const buyUrl = resolveBuyUrlFromFamily(familyUrl, familyHtml);
      const buyHtml = await fetchTextWithRetry(buyUrl, familyUrl);

      const specimenPdfUrls = Array.from(
        new Set([...extractSpecimenPdfUrls(familyHtml, familyUrl), ...extractSpecimenPdfUrls(buyHtml, buyUrl)])
      );
      const demoZipUrls = Array.from(
        new Set([...extractDemoZipUrls(familyHtml, familyUrl), ...extractDemoZipUrls(buyHtml, buyUrl)])
      );

      const buyLiteral = extractBuyObjectLiteral(buyHtml);
      const buyPayload = buyLiteral ? parseBuyPayload(buyLiteral) : undefined;
      const variants = buyPayload ? collectVariantsFromPayload(buyPayload, familyName) : [];
      const retailPackageUrls = resolveRetailPackageUrls(slug);

      const fontFacesMap = mergeFontFaceMaps(
        extractFontFaceMapFromHtml(familyHtml),
        extractFontFaceMapFromHtml(buyHtml)
      );

      const layoutAssetUrl =
        extractLayoutAssetUrl(buyHtml, buyUrl) ||
        extractLayoutAssetUrl(familyHtml, familyUrl);
      const layoutJs = layoutAssetUrl ? await fetchTextWithRetry(layoutAssetUrl, buyUrl) : "";
      const decoderSegment = layoutJs ? extractDecoderSegment(layoutJs) : undefined;
      const decodedMap = decoderSegment ? decodeFontFacesViaVm(decoderSegment, fontFacesMap) : new Map<string, Buffer>();

      const missingHashes = variants
        .map((variant) => variant.hash)
        .filter((hash) => !decodedMap.has(hash));

      const targetProfile = buildTargetProfile({
        targetUrl: familyUrl,
        buyUrl,
        slug,
        familyName,
        variants,
        specimenPdfUrls,
        demoZipUrls,
        missingHashes,
        decodedHashCount: decodedMap.size
      });

      if (retailPackageUrls.length > 0) {
        return {
          scraperName: this.name,
          foundryName: "Branding With Type",
          fonts: buildRetailDirectFonts({
            urls: retailPackageUrls,
            familyName,
            targetUrl: familyUrl,
            buyUrl,
            targetProfile
          }),
          originalUrl: url,
          targetUrl: familyUrl,
          expectedCount: variants.length > 0 ? variants.length : undefined,
          metadata: {
            foundry: "Branding With Type",
            family: familyName,
            targetProfile,
            specimenPdfUrls,
            demoZipUrls,
            retailPackageMode: "env"
          }
        };
      }

      const fonts = buildDirectFonts({
        variants,
        decodedMap,
        targetUrl: familyUrl,
        buyUrl,
        targetProfile
      });

      if (fonts.length > 0) {
        return {
          scraperName: this.name,
          foundryName: "Branding With Type",
          fonts,
          originalUrl: url,
          targetUrl: familyUrl,
          expectedCount: variants.length > 0 ? variants.length : fonts.length,
          metadata: {
            foundry: "Branding With Type",
            family: familyName,
            targetProfile,
            specimenPdfUrls,
            demoZipUrls
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Branding With Type",
        fonts: [
          {
            url: "browser-intercept",
            family: familyName,
            format: "woff2",
            style: "Normal",
            weight: "Regular",
            downloadable: true,
            metadata: {
              pageUrl: buyUrl,
              targetUrl: familyUrl,
              foundry: "Branding With Type",
              family: familyName,
              targetProfile
            }
          }
        ],
        originalUrl: url,
        targetUrl: buyUrl,
        expectedCount: variants.length > 0 ? variants.length : undefined,
        injectScript: buildFallbackInjectScript(),
        metadata: {
          foundry: "Branding With Type",
          family: familyName,
          targetProfile,
          specimenPdfUrls,
          demoZipUrls
        }
      };
    } catch (error) {
      console.error("[BrandingWithTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Branding With Type",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
