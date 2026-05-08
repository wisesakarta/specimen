import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";
import * as https from "node:https";

const FORMULATYPE_HOST = "formulatype.com";
const FORMULATYPE_ORIGIN = `https://${FORMULATYPE_HOST}`;
const FORMULATYPE_ADMIN_HOST = "admin.formulatype.com";
const FORMULATYPE_ADMIN_ORIGIN = `https://${FORMULATYPE_ADMIN_HOST}`;
const FORMULATYPE_FETCH_TIMEOUT_MS = 45000;
const FORMULATYPE_FETCH_MAX_RETRIES = 5;
const FORMULATYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const FORMULATYPE_FEATURE_TAG_RE =
  /\b(ss\d{2}|cv\d{2}|liga|dlig|hlig|clig|rlig|calt|ccmp|salt|onum|lnum|pnum|tnum|frac|afrc|sups|subs|smcp|c2sc|case|ordn|kern|zero|locl)\b/gi;
const FORMULATYPE_LEGAL_PDF_RE =
  /\b(eula|license|licen[cs]e|terms|agreement|privacy|cookie|service)\b/i;
const FORMULATYPE_KNOWN_FAMILY_SLUGS = [
  "ft-habit",
  "ft-aktual",
  "ft-supplement",
  "ft-kunst",
  "ft-regola",
  "ft-speaker",
  "ft-athletic"
];

type FormulaScope = {
  familySlug?: string;
  targetUrl: string;
  purchaseUrl?: string;
};

type FormulaStyleRecord = {
  sku: string;
  name: string;
  weight: number;
  isItalic: boolean;
  token: string;
  altTokens: string[];
};

type FormulaLicenseType = {
  sku: string;
  name: string;
  fileTypes: string;
  singleFontPrice: number | null;
  bundleDiscountAmount: number | null;
  bundleDiscountType: string | null;
  fullFamilyDiscountAmount: number | null;
  fullFamilyDiscountType: string | null;
};

type FormulaLicenseSize = {
  name: string;
  multiplier: number;
};

type FormulaDiscount = {
  name: string;
  amount: number;
  type: string;
};

type FormulaFamilyPayload = {
  familySlug: string;
  familyName: string;
  familySku?: string;
  targetUrl: string;
  purchaseUrl: string;
  styles: FormulaStyleRecord[];
  licenseTypes: FormulaLicenseType[];
  licenseSizes: FormulaLicenseSize[];
  discounts: FormulaDiscount[];
  trialZipUrls: string[];
  specimenPdfUrls: string[];
  featureTags: string[];
  fontAssetUrls: string[];
};

type FormulaAssetCandidate = {
  url: string;
  format: FontMetadata["format"];
  fileName: string;
  styleLabel: string;
  styleToken: string;
  isTrial: boolean;
  isAppVariant: boolean;
  qualityScore: number;
};

type FormulaFamilySuccess = {
  slug: string;
  ok: true;
  payload: FormulaFamilyPayload;
  fonts: FontMetadata[];
  expectedCount: number;
  targetProfile: Record<string, unknown>;
  unmatchedStyles: FormulaStyleRecord[];
};

type FormulaFamilyFailure = {
  slug: string;
  ok: false;
  error: string;
};

type FormulaFamilyResult = FormulaFamilySuccess | FormulaFamilyFailure;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeSpace = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();

const dedupeStringList = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = normalizeSpace(item);
    if (!text) continue;
    const key = normalizeToken(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const toSafeSlug = (value: string): string =>
  normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const titleCaseLoose = (value: string): string =>
  normalizeSpace(value)
    .split(" ")
    .map((part) => {
      if (!part) return part;
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");

const inferWeight = (styleName: string): number | undefined => {
  const token = normalizeToken(styleName);
  if (!token) return undefined;

  const numeric = token.match(/(?:^|[^0-9])(1000|950|900|800|700|600|500|450|400|350|300|250|200|100)(?:[^0-9]|$)/);
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

const inferStyleKind = (styleName: string): "Normal" | "Italic" =>
  /italic|oblique|slanted/i.test(styleName) ? "Italic" : "Normal";

const normalizeTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === `www.${FORMULATYPE_HOST}`) parsed.hostname = FORMULATYPE_HOST;
  parsed.hash = "";
  return parsed.href;
};

const extractScopeFromUrl = (targetUrl: string): FormulaScope => {
  try {
    const parsed = new URL(targetUrl);
    const segments = parsed.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
    const slug = segments.find((part) => /^ft-[a-z0-9-]+$/.test(part));
    if (slug) {
      return {
        familySlug: slug,
        targetUrl: `${FORMULATYPE_ORIGIN}/${slug}`,
        purchaseUrl: `${FORMULATYPE_ORIGIN}/${slug}/purchase`
      };
    }
  } catch {
    // ignore malformed input
  }

  return { targetUrl: FORMULATYPE_ORIGIN };
};

const fetchTextWithRetry = async (url: string, init: RequestInit): Promise<string> => {
  const headerRecord = (() => {
    const out: Record<string, string> = {};
    const source = init.headers;
    if (!source) return out;
    if (Array.isArray(source)) {
      for (const [key, value] of source) out[String(key)] = String(value);
      return out;
    }
    if (source instanceof Headers) {
      source.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    }
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      out[String(key)] = String(value);
    }
    return out;
  })();

  if (!headerRecord["Accept-Encoding"] && !headerRecord["accept-encoding"]) {
    headerRecord["Accept-Encoding"] = "identity";
  }

  const fetchViaHttps = async (targetUrl: string, redirectCount = 0): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      if (redirectCount > 4) {
        reject(new Error(`Too many redirects for ${targetUrl}`));
        return;
      }

      const request = https.request(
        targetUrl,
        {
          method: "GET",
          headers: headerRecord,
          family: 4
        },
        (response) => {
          const status = response.statusCode || 0;
          const location = asString(response.headers.location);
          if (location && [301, 302, 303, 307, 308].includes(status)) {
            const resolved = new URL(location, targetUrl).href;
            response.resume();
            fetchViaHttps(resolved, redirectCount + 1).then(resolve).catch(reject);
            return;
          }

          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          response.on("end", () => {
            if (status < 200 || status >= 300) {
              reject(new Error(`HTTP ${status} for ${targetUrl}`));
              return;
            }
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        }
      );

      request.on("error", reject);
      request.setTimeout(FORMULATYPE_FETCH_TIMEOUT_MS, () => {
        request.destroy(new Error(`HTTPS timeout for ${targetUrl}`));
      });
      request.end();
    });

  let lastError: unknown;
  for (let attempt = 1; attempt <= FORMULATYPE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FORMULATYPE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        headers: headerRecord,
        signal: controller.signal,
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      try {
        return await fetchViaHttps(url);
      } catch (fallbackError) {
        lastError = fallbackError;
      }
      if (attempt < FORMULATYPE_FETCH_MAX_RETRIES) await sleep(450 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Formula Type fetch failed");
};

const normalizeEscapedPayload = (value: string): string =>
  value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\\//g, "/");

const decodeNextFlightPayload = (html: string): string => {
  const chunks: string[] = [];
  const re = /self\.__next_f\.push\(\[1,\s*("(?:(?:\\.|[^"\\])*)")\s*\]\)/g;
  for (const match of html.matchAll(re)) {
    const rawQuoted = asString(match[1]);
    if (!rawQuoted) continue;
    try {
      const decoded = JSON.parse(rawQuoted) as unknown;
      if (typeof decoded === "string" && decoded.trim()) chunks.push(decoded);
    } catch {
      // ignore malformed chunk
    }
  }

  const joined = chunks.join("\n");
  if (joined.trim()) return normalizeEscapedPayload(joined);
  return normalizeEscapedPayload(html);
};

const discoverFamilySlugs = (html: string): string[] => {
  const found: string[] = [];
  const re = /\/(ft-[a-z0-9-]+)(?:\/purchase)?/gi;
  for (const match of html.matchAll(re)) {
    const slug = asString(match[1])?.toLowerCase();
    if (slug) found.push(slug);
  }
  return dedupeStringList(found).filter((slug) => /^ft-[a-z0-9-]+$/.test(slug));
};

const extractFeatureTags = (value: string): string[] => {
  const tags = new Set<string>();
  for (const match of value.matchAll(FORMULATYPE_FEATURE_TAG_RE)) {
    const tag = asString(match[1])?.toLowerCase();
    if (tag) tags.add(tag);
  }
  return Array.from(tags).sort();
};

const toAdminUploadUrl = (raw: string): string | undefined => {
  const cleaned = normalizeSpace(raw.replace(/\\u002F/gi, "/")).replace(/[<>"')]+$/g, "");
  if (!cleaned) return undefined;

  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      if (!parsed.pathname.toLowerCase().startsWith("/uploads/")) return undefined;
      parsed.protocol = "https:";
      parsed.hostname = FORMULATYPE_ADMIN_HOST;
      return parsed.href;
    } catch {
      return undefined;
    }
  }

  const relMatch = cleaned.match(/\/uploads\/[A-Za-z0-9_./%-]+/i);
  if (!relMatch?.[0]) return undefined;
  return `${FORMULATYPE_ADMIN_ORIGIN}${relMatch[0]}`;
};

const extractUploadUrlsByExt = (value: string, extRe: string): string[] => {
  const out = new Set<string>();
  const re = new RegExp(
    `(?:https?:\\/\\/[^\\s"'\\\\]+)?\\/uploads\\/[A-Za-z0-9_./%-]+?\\.(?:${extRe})(?:\\?[^\\s"'\\\\]*)?`,
    "gi"
  );
  for (const match of value.matchAll(re)) {
    const raw = asString(match[0]);
    if (!raw) continue;
    const normalized = toAdminUploadUrl(raw);
    if (normalized) out.add(normalized);
  }
  return Array.from(out).sort();
};

const extractFamilyName = (decoded: string, familySlug: string): string => {
  const fromLicense = asString(decoded.match(/"license":\{[^{}]*"name":"([^"]+)"/)?.[1]);
  if (fromLicense) return fromLicense;
  return titleCaseLoose(familySlug.replace(/^ft-/, "FT ").replace(/-/g, " "));
};

const extractFamilySku = (decoded: string): string | undefined =>
  asString(decoded.match(/"license":\{[^{}]*"SKU":"([^"]+)"/)?.[1]);

const buildStyleAltTokens = (name: string): string[] => {
  const variants: string[] = [name];
  const noRegular = normalizeSpace(name.replace(/\bregular\b/gi, ""));
  if (noRegular) variants.push(noRegular);
  variants.push(name.replace(/\bitalic\b/gi, "ita"));
  variants.push(name.replace(/\bsemi[\s-]*italic\b/gi, "semi italic"));
  return dedupeStringList(variants.map((row) => normalizeToken(row))).sort((a, b) => b.length - a.length);
};

const extractStyles = (decoded: string): FormulaStyleRecord[] => {
  const out: FormulaStyleRecord[] = [];
  const seen = new Set<string>();
  const re = /"SKU":"(FT-[A-Z0-9-]+)","weight":([0-9.]+),"name":"([^"]+)","isStyleOf":(?:null|"[^"]*")/g;
  for (const match of decoded.matchAll(re)) {
    const sku = asString(match[1]);
    const weightRaw = Number(match[2]);
    const name = normalizeSpace(match[3] || "");
    if (!sku || !name || seen.has(sku)) continue;
    seen.add(sku);
    out.push({
      sku,
      name,
      weight: Number.isFinite(weightRaw) ? weightRaw : inferWeight(name) || 400,
      isItalic: /italic/i.test(name),
      token: normalizeToken(name),
      altTokens: buildStyleAltTokens(name)
    });
  }

  return out.sort((a, b) => {
    if (a.weight !== b.weight) return a.weight - b.weight;
    return a.name.localeCompare(b.name);
  });
};

const extractLicenseTypes = (decoded: string): FormulaLicenseType[] => {
  const out: FormulaLicenseType[] = [];
  const re =
    /"SKU":"(LICENSE-[A-Z0-9-]+)","name":"([^"]+)","fileTypes":"([^"]+)"[\s\S]*?"singleFontPrice":([0-9.]+)[\s\S]*?"bundleDiscount":\{"amount":([0-9.]+),"type":"([^"]+)"\}[\s\S]*?"fullFamilyDiscount":\{"amount":([0-9.]+),"type":"([^"]+)"\}/g;

  for (const match of decoded.matchAll(re)) {
    out.push({
      sku: match[1],
      name: match[2],
      fileTypes: match[3],
      singleFontPrice: Number.isFinite(Number(match[4])) ? Number(match[4]) : null,
      bundleDiscountAmount: Number.isFinite(Number(match[5])) ? Number(match[5]) : null,
      bundleDiscountType: asString(match[6]) || null,
      fullFamilyDiscountAmount: Number.isFinite(Number(match[7])) ? Number(match[7]) : null,
      fullFamilyDiscountType: asString(match[8]) || null
    });
  }

  return Array.from(new Map(out.map((row) => [row.sku, row])).values());
};

const extractLicenseSizes = (decoded: string): FormulaLicenseSize[] => {
  const block = decoded.match(/"licenseSizes":\[(.*?)\],"priceReductions":/s)?.[1] || "";
  const out: FormulaLicenseSize[] = [];
  for (const match of block.matchAll(/"name":"([^"]+)","value":([0-9.]+)/g)) {
    const multiplier = Number(match[2]);
    out.push({
      name: match[1],
      multiplier: Number.isFinite(multiplier) ? multiplier : 1
    });
  }
  return out;
};

const extractDiscounts = (decoded: string): FormulaDiscount[] => {
  const block = decoded.match(/"priceReductions":\[(.*?)\]\}\}/s)?.[1] || "";
  const out: FormulaDiscount[] = [];
  for (const match of block.matchAll(/"name":"([^"]+)","discount":\{"amount":([0-9.]+),"type":"([^"]+)"\}/g)) {
    const amount = Number(match[2]);
    out.push({
      name: match[1],
      amount: Number.isFinite(amount) ? amount : 0,
      type: match[3]
    });
  }
  return out;
};

const extractTrialZipUrls = (value: string): string[] =>
  extractUploadUrlsByExt(value, "zip").filter((url) => /unlicensed[_-]?trial/i.test(url));

const extractSpecimenPdfUrls = (value: string): string[] =>
  extractUploadUrlsByExt(value, "pdf")
    .filter((url) => !FORMULATYPE_LEGAL_PDF_RE.test(url))
    .sort();

const extractFontAssetUrls = (value: string): string[] =>
  extractUploadUrlsByExt(value, "woff2?|otf|ttf").sort();

const buildFamilyWordSets = (params: {
  familySlug: string;
  familyName: string;
  familySku?: string;
}): string[][] => {
  const variants: string[][] = [];

  const fromSlug = params.familySlug
    .replace(/^ft-/, "")
    .split("-")
    .map((token) => normalizeToken(token))
    .filter(Boolean);
  if (fromSlug.length > 0) variants.push(fromSlug);

  const fromName = normalizeSpace(params.familyName)
    .replace(/^FT\s+/i, "")
    .split(/[\s-]+/g)
    .map((token) => normalizeToken(token))
    .filter(Boolean);
  if (fromName.length > 0) variants.push(fromName);

  if (params.familySku) {
    const fromSku = params.familySku
      .replace(/^FT-?/i, "")
      .split("-")
      .map((token) => normalizeToken(token))
      .filter(Boolean);
    if (fromSku.length > 0) variants.push(fromSku);
  }

  const out: string[][] = [];
  const seen = new Set<string>();
  for (const variant of variants) {
    const key = variant.join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(variant);
  }

  return out.sort((a, b) => b.length - a.length);
};

const inferFormatFromUrl = (url: string): FontMetadata["format"] | undefined => {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".woff2")) return "woff2";
    if (pathname.endsWith(".woff")) return "woff";
    if (pathname.endsWith(".otf")) return "otf";
    if (pathname.endsWith(".ttf")) return "ttf";
  } catch {
    // ignore malformed URL
  }
  return undefined;
};

const qualityScoreForCandidate = (candidate: {
  format: FontMetadata["format"];
  isTrial: boolean;
  isAppVariant: boolean;
}): number => {
  let score = 0;
  if (candidate.format === "otf") score += 140;
  else if (candidate.format === "ttf") score += 130;
  else if (candidate.format === "woff2") score += 120;
  else if (candidate.format === "woff") score += 110;

  if (!candidate.isTrial) score += 60;
  if (candidate.isTrial) score -= 120;
  if (candidate.isAppVariant) score -= 25;
  return score;
};

const parseFontCandidate = (url: string, familyWordSets: string[][]): FormulaAssetCandidate | undefined => {
  const format = inferFormatFromUrl(url);
  if (!format) return undefined;

  let fileName = "";
  try {
    fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    return undefined;
  }
  if (!fileName) return undefined;

  const isTrial = /unlicensed[_-]?trial/i.test(fileName);
  const isAppVariant = /_app_app_/i.test(fileName);

  let stem = fileName.replace(/\.[^.]+$/i, "");
  stem = stem.replace(/_App_app_[0-9a-f]{8,}$/i, "");
  stem = stem.replace(/_[0-9a-f]{8,}$/i, "");

  let parts = stem.split(/[_-]+/g).filter(Boolean);
  if (parts.length === 0) return undefined;

  if (normalizeToken(parts[0]) === "ft") parts = parts.slice(1);
  const partsToken = parts.map((part) => normalizeToken(part));

  let prefixRemoved = false;
  for (const familyWords of familyWordSets) {
    if (familyWords.length === 0) continue;
    if (familyWords.length > partsToken.length) continue;
    const isPrefix = familyWords.every((word, index) => partsToken[index] === word);
    if (isPrefix) {
      parts = parts.slice(familyWords.length);
      prefixRemoved = true;
      break;
    }
  }

  if (!prefixRemoved) {
    const haystack = normalizeToken(stem);
    const matchesFamily = familyWordSets.some((words) => words.every((word) => haystack.includes(word)));
    if (!matchesFamily) return undefined;
  }

  if (parts.length >= 2 && normalizeToken(parts[0]) === "unlicensed" && normalizeToken(parts[1]) === "trial") {
    parts = parts.slice(2);
  }
  if (parts.length === 0) parts = ["Regular"];

  const styleLabel = titleCaseLoose(
    normalizeSpace(parts.join(" "))
      .replace(/\bIta\b/gi, "Italic")
      .replace(/\bSemi Bold\b/gi, "Semibold")
      .replace(/\bExtra Bold\b/gi, "Extrabold")
      .replace(/\bExtra Light\b/gi, "Extralight")
  );

  const styleToken = normalizeToken(styleLabel || "Regular");
  const qualityScore = qualityScoreForCandidate({ format, isTrial, isAppVariant });

  return {
    url,
    format,
    fileName,
    styleLabel: styleLabel || "Regular",
    styleToken,
    isTrial,
    isAppVariant,
    qualityScore
  };
};

const scoreStyleCandidate = (style: FormulaStyleRecord, candidate: FormulaAssetCandidate): number => {
  let best = -999;
  for (const token of style.altTokens) {
    if (!token) continue;
    if (candidate.styleToken === token) {
      best = Math.max(best, 140);
      continue;
    }
    if (candidate.styleToken.includes(token)) {
      const distance = Math.max(0, candidate.styleToken.length - token.length);
      best = Math.max(best, 98 - distance);
      continue;
    }
    if (token.includes(candidate.styleToken)) {
      const distance = Math.max(0, token.length - candidate.styleToken.length);
      best = Math.max(best, 88 - distance);
      continue;
    }
  }

  if (style.isItalic) {
    if (/italic|oblique|ita/i.test(candidate.styleLabel)) best += 10;
    else best -= 20;
  } else if (/italic|oblique|ita/i.test(candidate.styleLabel)) {
    best -= 8;
  }

  return best;
};

const matchStyleCandidates = (
  styles: FormulaStyleRecord[],
  candidates: FormulaAssetCandidate[]
): {
  styleToCandidate: Map<string, FormulaAssetCandidate>;
  unmatchedStyles: FormulaStyleRecord[];
} => {
  const styleToCandidate = new Map<string, FormulaAssetCandidate>();
  const usedUrls = new Set<string>();

  const styleOrder = [...styles].sort((a, b) => {
    const aLen = Math.max(...a.altTokens.map((token) => token.length), a.token.length);
    const bLen = Math.max(...b.altTokens.map((token) => token.length), b.token.length);
    if (aLen !== bLen) return bLen - aLen;
    return a.name.localeCompare(b.name);
  });

  for (const style of styleOrder) {
    const ranked = candidates
      .filter((candidate) => !usedUrls.has(candidate.url))
      .map((candidate) => {
        const styleScore = scoreStyleCandidate(style, candidate);
        return {
          candidate,
          score: styleScore + candidate.qualityScore
        };
      })
      .filter((row) => row.score >= 60)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best) continue;
    styleToCandidate.set(style.sku, best.candidate);
    usedUrls.add(best.candidate.url);
  }

  const unmatchedStyles = styles.filter((style) => !styleToCandidate.has(style.sku));
  return {
    styleToCandidate,
    unmatchedStyles
  };
};

const buildTargetProfile = (params: {
  payload: FormulaFamilyPayload;
  unmatchedStyles: FormulaStyleRecord[];
}): Record<string, unknown> => {
  const { payload, unmatchedStyles } = params;
  const expectedStyles = dedupeStringList(payload.styles.map((style) => `${payload.familyName} ${style.name}`));
  const catalogFeatureTags = dedupeStringList(payload.featureTags.map((tag) => tag.toLowerCase()));

  return {
    profileId: "formulatype-target-profile-v1",
    source: "formulatype-next-f-purchase",
    foundry: "Formula Type",
    styleScope: "family-style",
    strictMissingStyles: true,
    failOnTrialAssets: true,
    targetUrl: payload.targetUrl,
    purchaseUrl: payload.purchaseUrl,
    family: payload.familyName,
    familyDisplay: payload.familyName,
    familySlug: payload.familySlug,
    familySku: payload.familySku,
    expectedStyles,
    expectedStyleCount: expectedStyles.length,
    unmatchedStyles: unmatchedStyles.map((row) => row.name),
    styleMap: payload.styles.map((style) => ({
      sku: style.sku,
      styleName: style.name,
      expectedStyle: `${payload.familyName} ${style.name}`,
      style: style.isItalic ? "Italic" : "Normal",
      weight: style.weight
    })),
    requiredFeatureTags: [],
    catalogFeatureTags,
    specimenPdfUrls: payload.specimenPdfUrls,
    trialZipUrls: payload.trialZipUrls,
    licenseTypes: payload.licenseTypes,
    licenseSizes: payload.licenseSizes,
    discounts: payload.discounts,
    outputNaming: {
      prefix: "formula-type",
      pattern: "formula-type-{family-slug}-{style-slug}.{ext}",
      styleTokenCase: "lowercase",
      separator: "-",
      stableSort: "lexical"
    },
    formatPolicy: "prefer non-trial non-app otf, fallback to ttf/woff2/woff",
    outputFormats: ["otf", "ttf", "woff2", "woff"],
    collectedAt: new Date().toISOString()
  };
};

const buildFontsForFamily = (payload: FormulaFamilyPayload): {
  fonts: FontMetadata[];
  expectedCount: number;
  targetProfile: Record<string, unknown>;
  unmatchedStyles: FormulaStyleRecord[];
} => {
  const familyWordSets = buildFamilyWordSets({
    familySlug: payload.familySlug,
    familyName: payload.familyName,
    familySku: payload.familySku
  });

  const candidates = dedupeStringList(payload.fontAssetUrls)
    .map((url) => parseFontCandidate(url, familyWordSets))
    .filter((row): row is FormulaAssetCandidate => Boolean(row))
    .sort((a, b) => b.qualityScore - a.qualityScore);

  const styles = payload.styles;
  const expectedCount = styles.length > 0 ? styles.length : candidates.length;
  const styleBySku = new Map(styles.map((style) => [style.sku, style]));

  const { styleToCandidate, unmatchedStyles } = matchStyleCandidates(styles, candidates);
  const targetProfile = buildTargetProfile({ payload, unmatchedStyles });

  const fonts: FontMetadata[] = [];
  const seen = new Set<string>();

  for (const [sku, candidate] of styleToCandidate.entries()) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);

    const style = styleBySku.get(sku);
    if (!style) continue;
    const styleSlug = toSafeSlug(style.name || candidate.styleLabel || "regular");

    fonts.push({
      url: candidate.url,
      family: payload.familyName,
      format: candidate.format,
      style: style.isItalic ? "Italic" : "Normal",
      weight: style.weight || inferWeight(style.name) || "Regular",
      downloadable: true,
      note: candidate.isTrial ? "Formula Type trial font from purchase payload." : "Formula Type purchase font asset.",
      metadata: {
        foundry: "Formula Type",
        family: payload.familyName,
        familySlug: payload.familySlug,
        familySku: payload.familySku,
        sku: style.sku,
        styleName: style.name,
        fullName: `${payload.familyName} ${style.name}`.replace(/\s+/g, " ").trim(),
        sourceType: "next-f-purchase-upload",
        pageUrl: payload.targetUrl,
        targetUrl: payload.purchaseUrl,
        purchaseUrl: payload.purchaseUrl,
        fileNameHint: `formula-type-${payload.familySlug}-${styleSlug}.${candidate.format}`,
        isTrial: candidate.isTrial,
        isAppVariant: candidate.isAppVariant,
        forceMetadataRepair: true,
        targetProfile,
        headers: {
          Origin: FORMULATYPE_ORIGIN,
          Referer: payload.purchaseUrl,
          Accept: "*/*"
        }
      }
    });
  }

  return {
    fonts,
    expectedCount,
    targetProfile,
    unmatchedStyles
  };
};

const collectFamilyPayload = async (familySlug: string): Promise<FormulaFamilyPayload> => {
  const purchaseUrl = `${FORMULATYPE_ORIGIN}/${familySlug}/purchase`;
  const targetUrl = `${FORMULATYPE_ORIGIN}/${familySlug}`;
  const [purchaseHtml, familyHtml] = await Promise.all([
    fetchTextWithRetry(purchaseUrl, {
      method: "GET",
      headers: {
        "User-Agent": FORMULATYPE_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: targetUrl
      }
    }).catch(() => ""),
    fetchTextWithRetry(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": FORMULATYPE_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: FORMULATYPE_ORIGIN
      }
    }).catch(() => "")
  ]);

  const mergedHtml = [purchaseHtml, familyHtml].filter((value) => value.trim()).join("\n");
  if (!mergedHtml.trim()) {
    throw new Error(`Formula Type payload fetch failed for ${familySlug}`);
  }

  const decoded = [purchaseHtml, familyHtml]
    .filter((value) => value.trim())
    .map((value) => decodeNextFlightPayload(value))
    .filter((value) => value.trim())
    .join("\n");
  const mergedSource = [decoded, mergedHtml].filter((value) => value.trim()).join("\n");
  const extractionSource = decoded || mergedSource;

  const familyName = extractFamilyName(extractionSource, familySlug);
  const familySku = extractFamilySku(extractionSource);

  return {
    familySlug,
    familyName,
    familySku,
    targetUrl,
    purchaseUrl,
    styles: extractStyles(extractionSource),
    licenseTypes: extractLicenseTypes(extractionSource),
    licenseSizes: extractLicenseSizes(extractionSource),
    discounts: extractDiscounts(extractionSource),
    trialZipUrls: extractTrialZipUrls(mergedSource),
    specimenPdfUrls: extractSpecimenPdfUrls(mergedSource),
    featureTags: extractFeatureTags(extractionSource),
    fontAssetUrls: extractFontAssetUrls(mergedSource)
  };
};

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.floor(limit));
  const out: R[] = new Array(items.length);
  let cursor = 0;

  const run = async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      out[current] = await worker(items[current], current);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
  return out;
};

const buildFallbackInjectScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const controls = Array.from(
      document.querySelectorAll("button,a,[role='button'],label,input[type='checkbox'],input[type='radio'],[class*='style']")
    );
    for (const node of controls.slice(0, 260)) {
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

export const FormulaTypeScraper: Scraper = {
  id: "formulatype",
  name: "Formula Type Purchase Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?formulatype\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const normalizedInput = normalizeTargetUrl(url);
      const scope = extractScopeFromUrl(normalizedInput);

      let familySlugs: string[] = [];
      if (scope.familySlug) {
        familySlugs = [scope.familySlug];
      } else {
        const homeHtml = await fetchTextWithRetry(FORMULATYPE_ORIGIN, {
          method: "GET",
          headers: {
            "User-Agent": FORMULATYPE_UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: FORMULATYPE_ORIGIN
          }
        }).catch(() => "");
        familySlugs = discoverFamilySlugs(homeHtml);
        if (familySlugs.length === 0) familySlugs = FORMULATYPE_KNOWN_FAMILY_SLUGS;
      }

      const uniqueSlugs = dedupeStringList(familySlugs).map((slug) => slug.toLowerCase());
      const collectFamilyOnce = async (slug: string): Promise<FormulaFamilyResult> => {
        try {
          const payload = await collectFamilyPayload(slug);
          const resolved = buildFontsForFamily(payload);
          return {
            slug,
            ok: true,
            payload,
            ...resolved
          };
        } catch (error) {
          return {
            slug,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      };

      const resultBySlug = new Map<string, FormulaFamilyResult>();
      let pending = [...uniqueSlugs];

      for (let round = 1; round <= 3 && pending.length > 0; round += 1) {
        const roundResults = await mapLimit(
          pending,
          round === 1 ? 3 : 1,
          async (slug) => collectFamilyOnce(slug)
        );

        const nextPending: string[] = [];
        for (const result of roundResults) {
          if (result.ok) {
            resultBySlug.set(result.slug, result);
          } else {
            const previous = resultBySlug.get(result.slug);
            if (!previous || !previous.ok) resultBySlug.set(result.slug, result);
            nextPending.push(result.slug);
          }
        }

        if (nextPending.length === 0) break;
        pending = dedupeStringList(nextPending);
        if (round < 3) await sleep(250 * round);
      }

      const familyResults: FormulaFamilyResult[] = uniqueSlugs.map((slug) => {
        const found = resultBySlug.get(slug);
        if (found) return found;
        return {
          slug,
          ok: false,
          error: "unknown-family-collection-error"
        };
      });

      const fonts: FontMetadata[] = [];
      const seenUrls = new Set<string>();
      const okFamilies = familyResults.filter((row): row is FormulaFamilySuccess => row.ok);

      for (const family of okFamilies) {
        for (const font of family.fonts) {
          if (seenUrls.has(font.url)) continue;
          seenUrls.add(font.url);
          fonts.push(font);
        }
      }

      const expectedCount = okFamilies.reduce((sum, row) => sum + row.expectedCount, 0);
      const targetUrl = scope.purchaseUrl || scope.targetUrl || normalizedInput;

      if (fonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Formula Type",
          fonts: [
            {
              url: "browser-intercept",
              family: scope.familySlug ? titleCaseLoose(scope.familySlug.replace(/^ft-/, "FT ").replace(/-/g, " ")) : "Formula Type",
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "Formula Type",
                pageUrl: targetUrl,
                targetUrl,
                reason: "no-fonts-from-purchase-payload",
                failedFamilies: familyResults.filter((row) => !row.ok).map((row) => ({
                  slug: row.slug,
                  error: row.error
                }))
              }
            }
          ],
          originalUrl: url,
          targetUrl,
          injectScript: buildFallbackInjectScript(),
          metadata: {
            foundry: "Formula Type",
            scopeSlug: scope.familySlug,
            attemptedFamilies: uniqueSlugs,
            okFamilyCount: okFamilies.length,
            failFamilyCount: familyResults.length - okFamilies.length
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Formula Type",
        fonts,
        originalUrl: url,
        targetUrl,
        expectedCount: expectedCount || fonts.length,
        metadata: {
          foundry: "Formula Type",
          scopeSlug: scope.familySlug,
          familyCount: okFamilies.length,
          families: okFamilies.map((row) => ({
            familySlug: row.payload.familySlug,
            familyName: row.payload.familyName,
            familySku: row.payload.familySku,
            styleCount: row.payload.styles.length,
            capturedCount: row.fonts.length,
            unmatchedStyles: row.unmatchedStyles.map((style) => style.name),
            specimenPdfUrls: row.payload.specimenPdfUrls,
            trialZipUrls: row.payload.trialZipUrls
          })),
          failedFamilies: familyResults
            .filter((row): row is FormulaFamilyFailure => !row.ok)
            .map((row) => ({ familySlug: row.slug, error: row.error }))
        }
      };
    } catch (error) {
      console.error("[FormulaTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Formula Type",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
