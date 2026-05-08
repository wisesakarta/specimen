import path from "node:path";
import crypto from "node:crypto";
import { mkdir, readFile, rename as renameFile, unlink, writeFile } from "node:fs/promises";
import * as fs from "node:fs";

import type {
  ApiJsonRequest,
  BrowserRequest,
  CssUrlRequest,
  DirectUrlRequest,
  BatchDirectRequest,
  DownloadRequest,
  DownloadResult,
  DownloadedFile,
  SkippedItem
} from "@/lib/downloader-protocol";
import { assertLicenseAllowed } from "@/lib/server/license-policy";
import { downloadBinary, fetchJson, fetchText, parseCssFontUrls, pickByPath } from "@/lib/server/fetchers";
import { runBrowserIntercept } from "@/lib/server/browser-downloader";
import { runValidationLog } from "@/lib/server/services/validation";
import { runPureSuccessProtocol } from "@/lib/server/services/pure-success-protocol";
import { runTechnicalQa } from "@/lib/server/services/technical-qa";
import { collectSpecimenPdfAudit } from "@/lib/server/specimen-audit";
import { getInlineFontAsset } from "@/lib/server/inline-font-cache";
import {
  shouldFallbackAfterBatchDirectError,
  shouldFallbackToBrowserIntercept
} from "@/lib/server/services/protocol-escalation";
import { joinOpaquePath, getBaseDownloadRoot, getStagingRoot } from "./opaque-path";
// @ts-ignore -- adm-zip uses export=; tsc handles it via esModuleInterop for this project.
import AdmZip from "adm-zip";

const supportedFontExtensions = new Set([".woff2", ".woff", ".ttf", ".otf", ".eot", ".zip"]);
const generatedOutputLogNames = new Set([
  "download-log.json",
  "validation-log.json",
  "analysis-log.json",
  "quality-log.json",
  "monolisa-quality-log.json",
  "specimen-log.json",
  "pure-success-log.json",
  "technical-qa-log.json",
  "master-restoration-report.json",
  "master-restoration-log.json"
]);
const baseDownloadRoot = getBaseDownloadRoot();
const stagingRoot = getStagingRoot();
const apiUrlFallbackPaths = [
  "url",
  "woff2",
  "woff",
  "font_file.url",
  "font.url",
  "files.woff2",
  "file.url",
  "src"
];
const apiNameFallbackPaths = [
  "name",
  "family",
  "family_name",
  "full_name",
  "style_name",
  "font_name"
];
const apiLicenseFallbackPaths = ["license", "license_id", "licenseId", "license_type"];
const interceptPlaceholderUrls = new Set(["browser-intercept", "interception-mode"]);
const monolisaExpectedStaticStyles = [
  "Thin",
  "ExtraLight",
  "Light",
  "Regular",
  "Medium",
  "SemiBold",
  "Bold",
  "ExtraBold",
  "Black",
  "Thin Italic",
  "ExtraLight Italic",
  "Light Italic",
  "Regular Italic",
  "Medium Italic",
  "SemiBold Italic",
  "Bold Italic",
  "ExtraBold Italic",
  "Black Italic"
];
const monolisaRequiredFeatureTags = ["liga", "calt", "zero", "ss01", "ss03", "ss04", "ss15", "ss16", "ss17", "ss18"];
const monolisaStyleTokenMap = new Map<string, string>([
  ["thin", "Thin"],
  ["extralight", "ExtraLight"],
  ["light", "Light"],
  ["regular", "Regular"],
  ["medium", "Medium"],
  ["semibold", "SemiBold"],
  ["bold", "Bold"],
  ["extrabold", "ExtraBold"],
  ["black", "Black"],
  ["thinitalic", "Thin Italic"],
  ["extralightitalic", "ExtraLight Italic"],
  ["lightitalic", "Light Italic"],
  ["regularitalic", "Regular Italic"],
  ["mediumitalic", "Medium Italic"],
  ["semibolditalic", "SemiBold Italic"],
  ["bolditalic", "Bold Italic"],
  ["extrabolditalic", "ExtraBold Italic"],
  ["blackitalic", "Black Italic"]
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isInterceptPlaceholderUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  return interceptPlaceholderUrls.has(value.trim().toLowerCase());
};

const tryExtractHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    // Ignore invalid candidate.
  }
  return undefined;
};

const tryExtractInlineAssetUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^inline-font:\/\/[a-z0-9]+$/i.test(trimmed) ? trimmed : undefined;
};

const resolveBatchInterceptTargetUrl = (request: BatchDirectRequest): string | undefined => {
  const candidates: unknown[] = [request.source];
  if (isRecord(request.metadata)) {
    candidates.push(request.metadata.targetUrl, request.metadata.originalUrl, request.metadata.pageUrl);
  }

  for (const font of request.fonts) {
    if (!font || !isRecord(font.metadata)) continue;
    candidates.push(font.metadata.pageUrl, font.metadata.targetUrl, font.metadata.originalUrl);
  }

  for (const candidate of candidates) {
    const parsed = tryExtractHttpUrl(candidate);
    if (parsed) return parsed;
  }

  return undefined;
};

type BrowserInterceptLikeRequest = Extract<DownloadRequest, { mode: "browser-intercept" }>;

const extractDirectFontsFromBrowserRequest = (
  request: BrowserInterceptLikeRequest
): BatchDirectRequest["fonts"] => {
  if (!isRecord(request.metadata)) return [];
  const rawFonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
  const deduped = new Map<string, BatchDirectRequest["fonts"][number]>();

  for (let i = 0; i < rawFonts.length; i += 1) {
    const raw = rawFonts[i];
    if (!isRecord(raw)) continue;

    const sourceUrl = tryExtractHttpUrl(raw.url) || tryExtractInlineAssetUrl(raw.url);
    if (!sourceUrl || isInterceptPlaceholderUrl(sourceUrl)) continue;

    const family = asNonEmptyString(raw.family) || inferNameFromUrl(sourceUrl, i);
    const style = asNonEmptyString(raw.style) || "Normal";
    const weight =
      typeof raw.weight === "number" && Number.isFinite(raw.weight)
        ? String(raw.weight)
        : asNonEmptyString(raw.weight) || "Regular";
    const category = asNonEmptyString((raw as any).category);
    const metadata = isRecord(raw.metadata) ? { ...raw.metadata } : {};

    if (!metadata.pageUrl) metadata.pageUrl = request.targetUrl;
    if (category && !metadata.category) metadata.category = category;
    if (raw.format && !metadata.format) metadata.format = raw.format;

    if (!deduped.has(sourceUrl)) {
      deduped.set(sourceUrl, {
        url: sourceUrl,
        family,
        style,
        weight,
        metadata
      });
    }
  }

  return [...deduped.values()];
};

const toSafeSegment = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "job";
};

const toSafeOutputFolderPath = (value: string): string => {
  const sanitizePart = (part: string): string => {
    const normalized = part
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || "job";
  };
  const parts = value
    .split(/[\\/]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => sanitizePart(part));
  if (parts.length === 0) return "job";
  return path.join(...parts);
};

const toSafeFileName = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const clamped = cleaned.slice(0, 140).replace(/-+$/g, "");
  return clamped || "font-file";
};

const toTitleWords = (value: string): string =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const validationTokenStopWords = new Set([
  "family",
  "font",
  "fonts",
  "type",
  "typeface",
  "foundry",
  "studio",
  "universal",
  "superfamily",
  "variable",
  "trial"
]);

const deriveValidationTokens = (values: unknown[]): string[] => {
  const out = new Set<string>();
  const add = (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (cleaned.length >= 4) out.add(cleaned);
  };

  const consumePhrase = (raw: string) => {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return;
    add(trimmed);

    const parts = trimmed.split(/[^a-z0-9]+/g).filter(Boolean);
    if (parts.length === 0) return;
    add(parts.join(""));
    if (parts.length > 1) add(parts[0]);

    const filtered = parts.filter((part) => !validationTokenStopWords.has(part));
    if (filtered.length > 0) {
      add(filtered.join(""));
      add(filtered[0]);
    }
  };

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;

    const parsedUrl = tryExtractHttpUrl(value);
    if (parsedUrl) {
      try {
        const parsed = new URL(parsedUrl);
        consumePhrase(parsed.hostname.replace(/\.(com|net|org|xyz|co|uk|dev|io|ai)$/gi, ""));
        const segments = parsed.pathname.split("/").filter(Boolean);
        for (const segment of segments) {
          consumePhrase(segment.replace(/\.[a-z0-9]+$/i, ""));
        }
      } catch {
        // ignore URL parsing edge-cases
      }
      continue;
    }

    consumePhrase(value);
  }

  return Array.from(out);
};

const normalizeStyleLabel = (style: unknown): "Normal" | "Italic" => {
  if (typeof style !== "string") return "Normal";
  // Treat slanted/oblique as italic-style for naming + dedupe consistency.
  return /italic|kursiv|slanted|oblique/i.test(style) ? "Italic" : "Normal";
};

const normalizeWeightLabel = (weight: unknown): string => {
  const value = typeof weight === "number" ? String(weight) : String(weight || "").trim();
  if (!value) return "Regular";

  // CSS variable font axis range syntax (e.g. "100 900")
  if (/^\d{2,4}\s+\d{2,4}$/.test(value)) {
    return "Variable";
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric <= 100) return "Thin";
    if (numeric <= 200) return "ExtraLight";
    if (numeric <= 300) return "Light";
    if (numeric <= 400) return "Regular";
    if (numeric <= 500) return "Medium";
    if (numeric <= 600) return "SemiBold";
    if (numeric <= 700) return "Bold";
    if (numeric <= 800) return "ExtraBold";
    return "Black";
  }

  const lower = value.toLowerCase();
  if (/hairline/.test(lower)) return "Hairline";
  if (/thin/.test(lower)) return "Thin";
  if (/extra-?light|ultra-?light/.test(lower)) return "ExtraLight";
  if (/light/.test(lower)) return "Light";
  if (/book/.test(lower)) return "Book";
  if (/regular|normal|roman/.test(lower)) return "Regular";
  if (/medium/.test(lower)) return "Medium";
  if (/semi-?bold|demi-?bold/.test(lower)) return "SemiBold";
  if (/extra-?bold|ultra-?bold/.test(lower)) return "ExtraBold";
  if (/heavy/.test(lower)) return "Heavy";
  if (/black/.test(lower)) return "Black";
  if (/bold/.test(lower)) return "Bold";

  return toTitleWords(value) || "Regular";
};

const composeSubFamily = (weight: unknown, style: unknown): string => {
  const weightLabel = normalizeWeightLabel(weight);
  const styleLabel = normalizeStyleLabel(style);
  if (styleLabel === "Italic") {
    return weightLabel === "Regular" ? "Italic" : `${weightLabel} Italic`;
  }
  return weightLabel;
};

const composeSubFamilyLabel = (
  weight: unknown,
  style: unknown,
  styleNameOverride?: unknown
): string => {
  if (typeof styleNameOverride === "string") {
    const normalized = styleNameOverride.replace(/\s+/g, " ").trim();
    if (normalized) return normalized;
  }
  return composeSubFamily(weight, style);
};

const composeFamilyDisplay = (family: unknown, category?: unknown): string => {
  const familyLabel = toTitleWords(String(family || "").trim()) || "Unknown";
  if (typeof category !== "string" || !category.trim()) {
    return familyLabel;
  }
  const categoryLabel = toTitleWords(category);
  if (!categoryLabel) return familyLabel;
  const familyToken = familyLabel.toLowerCase().replace(/\s+/g, "");
  const categoryToken = categoryLabel.toLowerCase().replace(/\s+/g, "");
  if (!categoryToken || familyToken.includes(categoryToken)) {
    return familyLabel;
  }
  return `${familyLabel} ${categoryLabel}`;
};

const composeDisplayName = (
  family: unknown,
  weight: unknown,
  style: unknown,
  category?: unknown,
  suffix?: string,
  styleNameOverride?: unknown,
  fullNameOverride?: unknown
): string => {
  if (typeof fullNameOverride === "string") {
    const normalized = fullNameOverride.replace(/\s+/g, " ").trim();
    if (normalized) {
      return suffix ? `${normalized} (${suffix})` : normalized;
    }
  }

  const familyDisplay = composeFamilyDisplay(family, category);
  const subFamily = composeSubFamilyLabel(weight, style, styleNameOverride);
  const base = `${familyDisplay} ${subFamily}`.trim();
  return suffix ? `${base} (${suffix})` : base;
};

const shouldApplyMetadataRepair = (fileName: string): boolean => {
  const base = path.basename(fileName, path.extname(fileName));
  const lower = base.toLowerCase();
  if (!lower) return false;

  if (
    lower === "font" ||
    lower === "unknown" ||
    lower.startsWith("lineto-font") ||
    lower.startsWith("pangram-font") ||
    lower.startsWith("abcdinamo-font") ||
    lower.startsWith("klim-font")
  ) {
    return true;
  }

  if (/[a-f0-9]{16,}/i.test(lower)) return true;
  if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(lower)) return true;

  // Detect short numeric-only filenames (A2-Type obfuscation style, e.g., "57803")
  if (/^\d{3,}$/.test(lower)) return true;

  return false;
};

const isSafeNameComponent = (value: unknown, requireLetter = false): value is string => {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/^[a-f0-9]{12,}$/i.test(normalized)) return false;
  if (/^[^a-z0-9]+$/i.test(normalized)) return false;
  if (requireLetter && !/[a-z]/i.test(normalized)) return false;
  return true;
};

const canApplyMetadataRepair = (family: unknown, subFamily: unknown): family is string => {
  if (!isSafeNameComponent(family, true)) return false;
  if (!isSafeNameComponent(subFamily, true)) return false;

  const familyToken = family.trim().toLowerCase();
  if (familyToken === "unknown" || familyToken === "font" || familyToken === "raw") return false;
  if (familyToken === "regular" || familyToken === "normal") return false;

  const subFamilyToken = subFamily.trim().toLowerCase();
  if (subFamilyToken === "unknown" || subFamilyToken === "font" || subFamilyToken === "raw") return false;

  return true;
};

const isTruthyFlag = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    return token === "true" || token === "1" || token === "yes" || token === "on";
  }
  return false;
};

const shouldForceMetadataRepair = (metadata: unknown): boolean => {
  if (!isRecord(metadata)) return false;
  return isTruthyFlag(metadata.forceMetadataRepair);
};

const shouldSkipConversion = (metadata: unknown): boolean => {
  if (!isRecord(metadata)) return false;
  return isTruthyFlag(metadata.skipConversion);
};

const shouldDisableInstanceExplosion = (metadata: unknown): boolean => {
  if (!isRecord(metadata)) return false;
  return isTruthyFlag(metadata.disableInstanceExplosion);
};

const resolveExpectedInstanceCount = (metadata: unknown): number | undefined => {
  if (!isRecord(metadata)) return undefined;

  const explicitCount = Number((metadata as any).expectedInstanceCount);
  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return Math.max(1, Math.floor(explicitCount));
  }

  const expectedStyles = normalizeStringList((metadata as any).expectedStyles);
  if (expectedStyles && expectedStyles.length > 0) {
    return expectedStyles.length;
  }

  return undefined;
};

const shouldPruneRawZipAfterExtract = (metadata: unknown): boolean => {
  if (!isRecord(metadata)) return false;
  return isTruthyFlag(metadata.pruneRawZipAfterExtract) || isTruthyFlag(metadata.deleteRawZipAfterExtract);
};

const normalizeFormatTokens = (value: unknown): string[] => {
  const allowed = new Set(["woff", "woff2", "otf", "ttf"]);
  const out = new Set<string>();

  if (Array.isArray(value)) {
    for (const item of value) {
      const token = String(item || "").trim().toLowerCase();
      if (!allowed.has(token)) continue;
      out.add(token);
    }
    return Array.from(out.values());
  }

  if (typeof value === "string") {
    for (const part of value.split(",")) {
      const token = part.trim().toLowerCase();
      if (!allowed.has(token)) continue;
      out.add(token);
    }
  }

  return Array.from(out.values());
};

const resolvePureSuccessRequiredFormats = (...sources: unknown[]): string[] | undefined => {
  const values = new Set<string>();

  const pull = (source: unknown) => {
    if (!isRecord(source)) return;

    for (const item of normalizeFormatTokens((source as any).requiredFormats)) {
      values.add(item);
    }

    if (isRecord((source as any).targetProfile)) {
      for (const item of normalizeFormatTokens((source as any).targetProfile.requiredFormats)) {
        values.add(item);
      }
    }

    if (isRecord((source as any).metadata)) {
      pull((source as any).metadata);
    }
  };

  for (const source of sources) pull(source);

  if (values.size === 0) return undefined;
  return Array.from(values.values());
};

const resolvePureSuccessSourceLimitedFormats = (...sources: unknown[]): string[] | undefined => {
  const values = new Set<string>();

  const pull = (source: unknown) => {
    if (!isRecord(source)) return;

    for (const item of normalizeFormatTokens((source as any).sourceLimitedFormats)) {
      values.add(item);
    }

    if (isRecord((source as any).targetProfile)) {
      for (const item of normalizeFormatTokens((source as any).targetProfile.sourceLimitedFormats)) {
        values.add(item);
      }
    }

    if (isRecord((source as any).metadata)) {
      pull((source as any).metadata);
    }
  };

  for (const source of sources) pull(source);
  if (values.size === 0) return undefined;
  return Array.from(values.values());
};

const clampDownloadRetryBudget = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  if (rounded < 1) return undefined;
  return Math.min(12, rounded);
};

const resolveDownloadRetryBudget = (...sources: unknown[]): number | undefined => {
  let best: number | undefined;

  const pull = (source: unknown) => {
    if (!isRecord(source)) return;

    const candidates: unknown[] = [
      (source as any).downloadRetries,
      (source as any).maxRetries,
      (source as any).retryBudget
    ];

    for (const candidate of candidates) {
      const parsed = clampDownloadRetryBudget(candidate);
      if (typeof parsed !== "number") continue;
      if (typeof best !== "number" || parsed > best) best = parsed;
    }

    if (isRecord((source as any).metadata)) {
      pull((source as any).metadata);
    }
  };

  for (const source of sources) pull(source);
  return best;
};

const detectExtension = (url: string, metadata?: any): string => {
  try {
    const parsed = new URL(url);
    const extFromPath = path.extname(parsed.pathname).toLowerCase();

    // 1. Explicit metadata format is the strongest signal for opaque endpoints
    //    such as /api/woff?payload=... that may still deliver WOFF2 binaries.
    if (metadata?.format) {
      const fmt = String(metadata.format).toLowerCase();
      if (supportedFontExtensions.has(`.${fmt}`)) return `.${fmt}`;
      if (supportedFontExtensions.has(fmt)) return fmt;
    }

    // 2. Trust explicit pathname extension when available.
    if (supportedFontExtensions.has(extFromPath)) return extFromPath;

    // 3. Try query string or full URL keywords.
    const fullSearch = (parsed.pathname + parsed.search).toLowerCase();
    const keywordMatches = [...fullSearch.matchAll(/(woff2|woff|ttf|otf|eot|zip)/gi)]
      .map((match) => String(match[1] || "").toLowerCase())
      .filter(Boolean);
    if (keywordMatches.length > 0) {
      const priority: Record<string, number> = {
        woff2: 6,
        woff: 5,
        otf: 4,
        ttf: 3,
        eot: 2,
        zip: 1
      };
      const best = keywordMatches
        .sort((a, b) => (priority[b] || 0) - (priority[a] || 0))[0];
      if (best) return `.${best}`;
    }
  } catch {
    // Ignore and fallback.
  }
  return ".bin";
};

const extractInlineFontToken = (url: string): string | undefined => {
  if (typeof url !== "string") return undefined;
  const match = url.trim().match(/^inline-font:\/\/([a-z0-9]+)/i);
  return match?.[1] || undefined;
};

const resolveInlineFontAsset = (url: string) => {
  const token = extractInlineFontToken(url);
  if (!token) return undefined;
  return getInlineFontAsset(token);
};



const buildHeaders = (request: {
  apiToken?: string;
  userAgent?: string;
  fileUrl?: string;
  cssUrl?: string;
  metadata?: Record<string, unknown>;
}): HeadersInit => {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  if (typeof request.apiToken === "string" && request.apiToken.trim()) {
    headers.Authorization = `Bearer ${request.apiToken.trim()}`;
  }

  if (typeof request.userAgent === "string" && request.userAgent.trim()) {
    headers["User-Agent"] = request.userAgent.trim();
  }

  // Lineto Protection Bypass
  const urlStr = request.fileUrl || request.cssUrl || "";
  if (urlStr.includes("lineto.com")) {
    headers["Origin"] = "https://lineto.com";
    headers["Referer"] = "https://lineto.com/";
    headers["Accept"] = "*/*";
  }

  // ABC Dinamo Protection Bypass
  if (urlStr.includes("abcdinamo.com")) {
    headers["Origin"] = "https://abcdinamo.com";
    headers["Referer"] = "https://abcdinamo.com/";
    headers["Accept"] = "*/*";
  }

  if (urlStr.includes("wtypefoundry.com")) {
    headers["Origin"] = "https://wtypefoundry.com";
    headers["Referer"] = "https://wtypefoundry.com/";
    headers["Accept"] = "*/*";
  }

  if (urlStr.includes("superiortype.com")) {
    headers["Origin"] = "https://superiortype.com";
    headers["Referer"] = "https://superiortype.com/";
    headers["Accept"] = "*/*";
  }

  if (urlStr.includes("swisstypefaces.com")) {
    headers["Origin"] = "https://www.swisstypefaces.com";
    headers["Referer"] = "https://www.swisstypefaces.com/";
    headers["Accept"] = "*/*";
  }

  if (urlStr.includes("ohnotype.co") || urlStr.includes("ohno.sfo3.cdn.digitaloceanspaces.com")) {
    headers["Origin"] = "https://ohnotype.co";
    headers["Referer"] = "https://ohnotype.co/";
    headers["Accept"] = "*/*";
  }

  if (urlStr.includes("a2-type.co.uk")) {
    const pageUrl = typeof request.metadata?.pageUrl === "string" ? request.metadata.pageUrl : "";
    headers["Origin"] = "https://a2-type.co.uk";
    headers["Referer"] = pageUrl || "https://a2-type.co.uk/";
    headers["Accept"] = "*/*";
  }

  if (urlStr.includes("brandingwithtype.com")) {
    const pageUrl = typeof request.metadata?.pageUrl === "string" ? request.metadata.pageUrl : "";
    headers["Origin"] = "https://brandingwithtype.com";
    headers["Referer"] = pageUrl || "https://brandingwithtype.com/typefaces";
    headers["Accept"] = "*/*";
  }
  if (urlStr.includes("nuformtype.com")) {
    const pageUrl = typeof request.metadata?.pageUrl === "string" ? request.metadata.pageUrl : "";
    headers["Origin"] = "https://nuformtype.com";
    headers["Referer"] = pageUrl || "https://nuformtype.com/";
    headers["Accept"] = "*/*";
  }

  const metadata = request.metadata || {};
  const fallbackReferer = [metadata.pageUrl, metadata.targetUrl, metadata.originalUrl].find(
    (value) => typeof value === "string" && /^https?:\/\//i.test(value)
  ) as string | undefined;
  if (!headers["Referer"] && fallbackReferer) {
    headers["Referer"] = fallbackReferer;
    headers["Accept"] = headers["Accept"] || "*/*";
    try {
      headers["Origin"] = headers["Origin"] || new URL(fallbackReferer).origin;
    } catch {
      // ignore malformed referer candidates
    }
  }

  // Custom headers from scrapers metadata if available
  if (metadata.headers && typeof metadata.headers === "object") {
    Object.assign(headers, metadata.headers as Record<string, string>);
  }

  return headers;
};

const ensureUniqueDirPath = (candidate: string): string => {
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 2; i <= 999; i += 1) {
    const nextCandidate = `${candidate}-${i}`;
    if (!fs.existsSync(nextCandidate)) return nextCandidate;
  }
  return `${candidate}-${Date.now()}`;
};

const hostTokenFromUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const host = new URL(value.trim()).hostname.replace(/^www\./, "").replace(/\./g, "-");
    const token = toSafeSegment(host);
    return token && token !== "job" ? token : undefined;
  } catch {
    return undefined;
  }
};

const deriveFoundryToken = (metadata?: any): string | undefined => {
  if (!metadata || typeof metadata !== "object") return undefined;
  const foundryCandidates = [
    metadata?.foundry,
    metadata?.metadata?.foundry,
    metadata?.source,
    metadata?.site,
    metadata?.host
  ];

  for (const candidate of foundryCandidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const parsed = hostTokenFromUrl(candidate);
    if (parsed) return parsed;
    const token = toSafeSegment(candidate);
    if (token && token !== "job") return token;
  }

  const urlCandidates = [
    metadata?.targetUrl,
    metadata?.pageUrl,
    metadata?.originalUrl,
    metadata?.sourceUrl,
    metadata?.metadata?.targetUrl,
    metadata?.metadata?.pageUrl,
    metadata?.metadata?.originalUrl
  ];
  for (const candidate of urlCandidates) {
    const parsed = hostTokenFromUrl(candidate);
    if (parsed) return parsed;
  }

  return undefined;
};

const makeJobFolder = (outputFolder?: string, metadata?: any): string => {
  // Use downloads root for explicit output folders, otherwise keep transient staging flow.
  const root = outputFolder ? path.join(baseDownloadRoot, toSafeOutputFolderPath(outputFolder)) : stagingRoot;
  const finalize = (candidate: string): string => (outputFolder ? candidate : ensureUniqueDirPath(candidate));

  const deriveFromFonts = (): { foundry?: string; family?: string; category?: string } => {
    const fonts = Array.isArray(metadata?.fonts) ? metadata.fonts : [];
    for (const font of fonts) {
      if (!font || typeof font !== "object") continue;
      const meta = (font as any).metadata || {};
      const foundry = (font as any).foundry || meta.foundry;
      const family = (font as any).family || meta.family;
      const category = meta.category;
      if (family || foundry) return { foundry, family, category };
    }
    return {};
  };

  const derived = deriveFromFonts();
  const foundry = metadata?.foundry || metadata?.metadata?.foundry || derived.foundry;
  const family = metadata?.family || metadata?.metadata?.family || derived.family;
  const category = metadata?.category || metadata?.metadata?.category || derived.category;

  if (foundry && family) {
    const foundrySegment = toSafeSegment(foundry);
    const familySegment = toSafeSegment(family);
    const segments = [root, foundrySegment];
    if (familySegment !== foundrySegment) {
      segments.push(familySegment);
    }
    // Add category sub-folder when category differs from family.
    if (category && toSafeSegment(category) !== familySegment) {
      segments.push(toSafeSegment(category));
    }
    return finalize(path.join(...segments));
  }

  const foundryToken = foundry ? toSafeSegment(foundry) : deriveFoundryToken(metadata);
  if (foundryToken) {
    return finalize(path.join(root, `${foundryToken}-fonts`));
  }

  if (family) {
    return finalize(path.join(root, `${toSafeSegment(family)}-fonts`));
  }

  return finalize(path.join(root, "unknown-fonts"));
};

const toRelative = (absolutePath: string): string => path.relative(process.cwd(), absolutePath);

// Berkeley Mono standard: organise downloaded font files into format subfolders.
// .woff2 → Webfonts/Woff2/  .woff → Webfonts/Woff/  .ttf → TTF/  .otf → OTF/
// JSON logs and other non-font files remain in the root of outputDir.
const FORMAT_SUBFOLDERS: ReadonlyMap<string, string> = new Map([
  [".woff2", path.join("Webfonts", "Woff2")],
  [".woff",  path.join("Webfonts", "Woff")],
  [".ttf",   "TTF"],
  [".otf",   "OTF"],
]);

const organizeOutputByFormat = async (outputDir: string): Promise<void> => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(outputDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const subfolder = FORMAT_SUBFOLDERS.get(ext);
    if (!subfolder) continue;

    const src = path.join(outputDir, entry.name);
    const destDir = path.join(outputDir, subfolder);
    const dest = path.join(destDir, entry.name);
    try {
      await mkdir(destDir, { recursive: true });
      await renameFile(src, dest);
    } catch {
      // best-effort: skip files that cannot be moved (locked, already moved, etc.)
    }
  }
};

const isGeneratedOutputArtifact = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  if (generatedOutputLogNames.has(lower)) return true;
  if (/-log\.json$/.test(lower)) return true;
  const ext = path.extname(lower);
  if (supportedFontExtensions.has(ext)) return true;
  if (ext === ".pdf") return true;
  return false;
};

const shouldResetDeterministicOutputDir = (dirPath: string): boolean => {
  if (!fs.existsSync(dirPath)) return false;

  // Safety boundary: only prune managed output under downloads root.
  const resolvedDir = path.resolve(dirPath);
  const resolvedRoot = path.resolve(baseDownloadRoot);
  const normalizedDir = process.platform === "win32" ? resolvedDir.toLowerCase() : resolvedDir;
  const normalizedRoot = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  if (!normalizedDir.startsWith(normalizedRoot)) return false;

  const stack = [dirPath];
  let scannedEntries = 0;
  const maxEntries = 4000;

  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries > maxEntries) {
        // Large pre-existing trees are treated as managed output to avoid stale contamination.
        return true;
      }

      const fullPath = joinOpaquePath(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && isGeneratedOutputArtifact(entry.name)) {
        return true;
      }
    }
  }

  return false;
};

const prepareOutputDir = async (
  outputDir: string,
  resetDeterministicArtifacts: boolean,
  cleanupRootDir?: string
): Promise<void> => {
  const cleanupTarget =
    resetDeterministicArtifacts && typeof cleanupRootDir === "string" && cleanupRootDir.trim()
      ? cleanupRootDir
      : outputDir;
  if (resetDeterministicArtifacts && shouldResetDeterministicOutputDir(cleanupTarget)) {
    fs.rmSync(cleanupTarget, { recursive: true, force: true });
  }
  await mkdir(outputDir, { recursive: true });
};

type FoundryQualityProfile = {
  profileId?: string;
  foundry?: string;
  familyDisplay?: string;
  source?: string;
  styleScope: "style" | "family-style";
  strictMissingStyles: boolean;
  failOnTrialAssets: boolean;
  expectedStyles: string[];
  optionalExcludedStyles: string[];
  sourceLimitedStyles: string[];
  requiredFeatureTags: string[];
  minCmapEntries: number;
  minFeatureCount: number;
};

type FoundryStyleMetrics = {
  fileName: string;
  glyphCount: number;
  cmapEntries: number;
  featureCount: number;
  featureTags: string[];
};

const defaultFoundryQualityProfile: FoundryQualityProfile = {
  styleScope: "style",
  strictMissingStyles: false,
  failOnTrialAssets: false,
  expectedStyles: [],
  optionalExcludedStyles: [],
  sourceLimitedStyles: [],  requiredFeatureTags: [],
  minCmapEntries: 0,
  minFeatureCount: 0
};

const defaultMonoLisaQualityProfile: Partial<FoundryQualityProfile> = {
  profileId: "monolisa-default-v1",
  foundry: "MonoLisa",
  source: "monolisa-default",
  strictMissingStyles: true,
  expectedStyles: monolisaExpectedStaticStyles,
  requiredFeatureTags: monolisaRequiredFeatureTags,
  minCmapEntries: 1200,
  minFeatureCount: 30
};

const containsMonoLisaToken = (value: unknown): boolean =>
  typeof value === "string" && /monolisa(?:\.dev)?/i.test(value);

const extractMonoLisaStyleFromFilename = (fileName: string): string | undefined => {
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== ".ttf" && ext !== ".otf") return undefined;

  const stem = path.basename(fileName, ext);
  if (!/^monolisa-/i.test(stem)) return undefined;
  const stylePart = stem.replace(/^monolisa-/i, "");
  if (!stylePart) return undefined;

  const compact = stylePart.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!compact || compact.startsWith("variable") || compact.startsWith("wght")) return undefined;
  return monolisaStyleTokenMap.get(compact);
};

const normalizeQualityStyleToken = (value: string): string => {
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
  if (token === "italic" || token === "oblique" || token === "regularoblique") {
    return "regularitalic";
  }
  if (token === "variable") {
    return "regular";
  }
  if (token === "variableitalic" || token === "variableoblique") {
    return "regularitalic";
  }
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
  if (token.endsWith("oblique")) {
    token = `${token.slice(0, -7)}italic`;
  }
  // Family-style labels often alternate between "Foo Italic" and "Foo Regular Italic".
  // Collapse both to one token unless a concrete weight is already present.
  if (
    token.endsWith("italic") &&
    !/(thin|extralight|light|book|regular|medium|semibold|demibold|bold|extrabold|black|heavy)italic$/.test(token)
  ) {
    token = token.replace(/italic$/, "regularitalic");
  }
  return token;
};

const buildFileStyleTokenCandidates = (fileName: string): string[] => {
  const stem = path.basename(fileName || "", path.extname(fileName || ""));
  if (!stem) return [];

  const spaced = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const parts = spaced.split(" ").filter(Boolean);
  const candidates = new Set<string>();

  const add = (value: string) => {
    const token = normalizeQualityStyleToken(value);
    if (token) candidates.add(token);
  };

  add(spaced);
  add(spaced.replace(/\bweb\b/gi, " "));

  for (let i = 0; i < parts.length; i += 1) {
    add(parts.slice(i).join(" "));
  }

  return Array.from(candidates.values());
};

const resolveExpectedStyleFromFileName = (
  fileName: string,
  expectedStyleMap: Map<string, string>
): { token: string; label: string } | undefined => {
  if (!fileName || expectedStyleMap.size === 0) return undefined;

  const candidates = buildFileStyleTokenCandidates(fileName);
  let best: { token: string; label: string; score: number } | undefined;

  for (const candidate of candidates) {
    for (const [expectedToken, expectedLabel] of expectedStyleMap.entries()) {
      const isExact = candidate === expectedToken;
      const isContains = candidate.includes(expectedToken) || expectedToken.includes(candidate);
      if (!isExact && !isContains) continue;

      const score = (isExact ? 100000 : 0) + expectedToken.length;
      if (!best || score > best.score) {
        best = { token: expectedToken, label: expectedLabel, score };
      }
    }
  }

  if (!best) return undefined;
  return { token: best.token, label: best.label };
};

const dedupeStyleLabels = (styles: string[]): string[] => {
  const map = new Map<string, string>();
  for (const raw of styles) {
    if (typeof raw !== "string") continue;
    const label = raw.trim();
    if (!label) continue;
    const token = normalizeQualityStyleToken(label);
    if (!token) continue;
    if (!map.has(token)) map.set(token, label);
  }
  return Array.from(map.values());
};

const extractExpectedStylesFromStyleMap = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const styleName = asNonEmptyString(entry.styleName) || asNonEmptyString(entry.style) || asNonEmptyString(entry.name);
    if (styleName) out.push(styleName);
  }
  return dedupeStyleLabels(out);
};

const normalizeStringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
};

const extractQualityProfileFromTargetProfile = (targetProfile: Record<string, unknown>): Partial<FoundryQualityProfile> => {
  const expectedStyles =
    normalizeStringList(targetProfile.expectedStaticStyles) ||
    normalizeStringList(targetProfile.expectedStyles) ||
    extractExpectedStylesFromStyleMap(targetProfile.styleMap);
  const optionalExcludedStyles = normalizeStringList(targetProfile.optionalExcludedStyles);
  const sourceLimitedStyles = normalizeStringList(targetProfile.sourceLimitedStyles);
  const requiredFeatureTags = normalizeStringList(targetProfile.requiredFeatureTags);
  const minCmapEntries = Number(targetProfile.minCmapEntries);
  const minFeatureCount = Number(targetProfile.minFeatureCount);

  const out: Partial<FoundryQualityProfile> = {};
  const styleScope = asNonEmptyString(targetProfile.styleScope);
  if (styleScope === "family-style") {
    out.styleScope = "family-style";
  }
  if (typeof targetProfile.strictMissingStyles === "boolean") {
    out.strictMissingStyles = targetProfile.strictMissingStyles;
  }
  if (typeof targetProfile.failOnTrialAssets === "boolean") {
    out.failOnTrialAssets = targetProfile.failOnTrialAssets;
  }
  if (expectedStyles && expectedStyles.length > 0) {
    out.expectedStyles = dedupeStyleLabels(expectedStyles);
  }
  if (optionalExcludedStyles && optionalExcludedStyles.length > 0) {
    out.optionalExcludedStyles = dedupeStyleLabels(optionalExcludedStyles);
  }
  if (sourceLimitedStyles && sourceLimitedStyles.length > 0) {
    out.sourceLimitedStyles = dedupeStyleLabels(sourceLimitedStyles);
  }
  if (requiredFeatureTags && requiredFeatureTags.length > 0) {
    out.requiredFeatureTags = requiredFeatureTags.map((tag) => tag.toLowerCase());
  }
  if (Number.isFinite(minCmapEntries) && minCmapEntries > 0) {
    out.minCmapEntries = Math.floor(minCmapEntries);
  }
  if (Number.isFinite(minFeatureCount) && minFeatureCount > 0) {
    out.minFeatureCount = Math.floor(minFeatureCount);
  }

  const profileId = asNonEmptyString(targetProfile.profileId);
  if (profileId) out.profileId = profileId;
  const foundry = asNonEmptyString(targetProfile.foundry);
  if (foundry) out.foundry = foundry;
  const familyDisplay =
    asNonEmptyString(targetProfile.familyDisplay) ||
    asNonEmptyString(targetProfile.family) ||
    asNonEmptyString(targetProfile.typefaceName);
  if (familyDisplay) out.familyDisplay = familyDisplay;
  const source = asNonEmptyString(targetProfile.source);
  if (source) out.source = source;

  return out;
};

const extractQualityProfileFromMetadata = (metadata: unknown): Partial<FoundryQualityProfile> => {
  if (!isRecord(metadata)) return {};
  const profile = isRecord(metadata.targetProfile) ? metadata.targetProfile : undefined;
  const fromTargetProfile = profile ? extractQualityProfileFromTargetProfile(profile) : {};
  const out: Partial<FoundryQualityProfile> = { ...fromTargetProfile };

  const foundry = asNonEmptyString(metadata.foundry);
  if (foundry && !out.foundry) out.foundry = foundry;
  const familyDisplay = asNonEmptyString(metadata.family);
  if (familyDisplay && !out.familyDisplay) out.familyDisplay = familyDisplay;
  const source = asNonEmptyString(metadata.source);
  if (source && !out.source) out.source = source;

  return out;
};

const mergeFoundryQualityProfile = (...partials: Partial<FoundryQualityProfile>[]): FoundryQualityProfile => {
  const merged: FoundryQualityProfile = {
    ...defaultFoundryQualityProfile,
    styleScope: defaultFoundryQualityProfile.styleScope,
    strictMissingStyles: defaultFoundryQualityProfile.strictMissingStyles,
    failOnTrialAssets: defaultFoundryQualityProfile.failOnTrialAssets,
    expectedStyles: [...defaultFoundryQualityProfile.expectedStyles],
    optionalExcludedStyles: [...defaultFoundryQualityProfile.optionalExcludedStyles],
    sourceLimitedStyles: [...defaultFoundryQualityProfile.sourceLimitedStyles],
    requiredFeatureTags: [...defaultFoundryQualityProfile.requiredFeatureTags]
  };

  for (const part of partials) {
    if (!part) continue;
    if (part.styleScope === "family-style") {
      merged.styleScope = "family-style";
    }
    if (typeof part.strictMissingStyles === "boolean") {
      merged.strictMissingStyles = part.strictMissingStyles;
    }
    if (typeof part.failOnTrialAssets === "boolean") {
      merged.failOnTrialAssets = part.failOnTrialAssets;
    }
    if (Array.isArray(part.expectedStyles) && part.expectedStyles.length > 0) {
      merged.expectedStyles = dedupeStyleLabels(part.expectedStyles.map((style) => String(style)));
    }
    if (Array.isArray(part.optionalExcludedStyles) && part.optionalExcludedStyles.length > 0) {
      merged.optionalExcludedStyles = dedupeStyleLabels(part.optionalExcludedStyles.map((style) => String(style)));
    }
    if (Array.isArray(part.sourceLimitedStyles) && part.sourceLimitedStyles.length > 0) {
      merged.sourceLimitedStyles = dedupeStyleLabels(part.sourceLimitedStyles.map((style) => String(style)));
    }
    if (Array.isArray(part.requiredFeatureTags) && part.requiredFeatureTags.length > 0) {
      merged.requiredFeatureTags = part.requiredFeatureTags.map((tag) => String(tag).toLowerCase());
    }
    if (typeof part.minCmapEntries === "number" && Number.isFinite(part.minCmapEntries) && part.minCmapEntries > 0) {
      merged.minCmapEntries = Math.floor(part.minCmapEntries);
    }
    if (typeof part.minFeatureCount === "number" && Number.isFinite(part.minFeatureCount) && part.minFeatureCount > 0) {
      merged.minFeatureCount = Math.floor(part.minFeatureCount);
    }
    if (typeof part.profileId === "string" && part.profileId.trim()) {
      merged.profileId = part.profileId.trim();
    }
    if (typeof part.foundry === "string" && part.foundry.trim()) {
      merged.foundry = part.foundry.trim();
    }
    if (typeof part.familyDisplay === "string" && part.familyDisplay.trim()) {
      merged.familyDisplay = part.familyDisplay.trim();
    }
    if (typeof part.source === "string" && part.source.trim()) {
      merged.source = part.source.trim();
    }
  }

  return merged;
};

const isMonoLisaBatch = (params: {
  foundryHint?: string;
  source?: string;
  requestMeta?: Record<string, unknown>;
  fontMeta?: Record<string, unknown>;
  fonts: BatchDirectRequest["fonts"];
}): boolean => {
  if (containsMonoLisaToken(params.foundryHint) || containsMonoLisaToken(params.source)) return true;
  if (containsMonoLisaToken(params.requestMeta?.foundry) || containsMonoLisaToken(params.fontMeta?.foundry)) return true;
  if (containsMonoLisaToken(params.requestMeta?.targetUrl) || containsMonoLisaToken(params.requestMeta?.pageUrl)) return true;

  for (const font of params.fonts) {
    if (containsMonoLisaToken(font.family) || containsMonoLisaToken(font.url)) return true;
    if (isRecord(font.metadata)) {
      if (
        containsMonoLisaToken(font.metadata.foundry) ||
        containsMonoLisaToken(font.metadata.pageUrl) ||
        containsMonoLisaToken(font.metadata.targetUrl)
      ) {
        return true;
      }
    }
  }
  return false;
};

const resolveFoundryQualityProfile = (params: {
  foundryHint?: string;
  source?: string;
  requestMeta?: Record<string, unknown>;
  fontMeta?: Record<string, unknown>;
  fonts: BatchDirectRequest["fonts"];
}): { profile: FoundryQualityProfile; isMonoLisa: boolean } | undefined => {
  const isMonoLisa = isMonoLisaBatch(params);
  const profileParts: Partial<FoundryQualityProfile>[] = [];

  if (isMonoLisa) {
    profileParts.push(defaultMonoLisaQualityProfile);
  }

  profileParts.push(
    extractQualityProfileFromMetadata(params.requestMeta),
    extractQualityProfileFromMetadata(params.fontMeta)
  );
  for (const font of params.fonts) {
    if (isRecord(font.metadata)) {
      profileParts.push(extractQualityProfileFromMetadata(font.metadata));
    }
  }

  const profile = mergeFoundryQualityProfile(...profileParts);
  let hasSignals =
    profile.expectedStyles.length > 0 ||
    profile.requiredFeatureTags.length > 0 ||
    profile.minCmapEntries > 0 ||
    profile.minFeatureCount > 0;
  if (!hasSignals) {
    const fallbackExpectedStyles = dedupeStyleLabels(
      params.fonts
        .map((font) =>
          composeSubFamilyLabel(
            font.weight || "Regular",
            font.style || "Normal",
            isRecord(font.metadata) ? font.metadata.styleName : undefined
          )
        )
        .filter((style): style is string => typeof style === "string" && style.trim().length > 0)
    );
    if (fallbackExpectedStyles.length > 0) {
      profile.expectedStyles = fallbackExpectedStyles;
      hasSignals = true;
    }
  }
  if (!hasSignals) return undefined;

  if (!profile.foundry) {
    const fallbackFoundry =
      asNonEmptyString(params.requestMeta?.foundry) ||
      asNonEmptyString(params.fontMeta?.foundry) ||
      asNonEmptyString(params.foundryHint);
    if (fallbackFoundry) profile.foundry = fallbackFoundry;
  }

  if (!profile.familyDisplay) {
    const fallbackFamily =
      asNonEmptyString(params.requestMeta?.family) ||
      asNonEmptyString(params.fontMeta?.family) ||
      asNonEmptyString(params.fonts[0]?.family);
    if (fallbackFamily) profile.familyDisplay = fallbackFamily;
  }

  if (!profile.source && typeof params.source === "string" && params.source.trim()) {
    profile.source = params.source.trim();
  }

  return { profile, isMonoLisa };
};

const readJsonRecord = async (filePath: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) return parsed;
  } catch {
    // best-effort
  }
  return undefined;
};

const extractGenericStyleFromFileName = (fileName: string): string | undefined => {
  const ext = path.extname(fileName).toLowerCase();
  if (!ext) return undefined;
  const stem = path.basename(fileName, ext);
  if (!stem) return undefined;

  const dashIndex = stem.indexOf("-");
  if (dashIndex >= 0 && dashIndex < stem.length - 1) {
    return stem.slice(dashIndex + 1).replace(/[_-]+/g, " ").trim();
  }

  const parts = stem.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(1).join(" ").trim();
  }

  return undefined;
};

const applyItalicSuffixFromValidation = (styleLabel: string, entry: Record<string, unknown>): string => {
  const style = styleLabel.trim();
  if (!style) return styleLabel;
  if (/^(italic|oblique|regular[\s_-]?oblique)$/i.test(style)) {
    return "Regular Italic";
  }
  const isItalicLike =
    isTruthyFlag(entry.effective_italic) ||
    isTruthyFlag(entry.is_italic) ||
    isTruthyFlag(entry.italic) ||
    isTruthyFlag(entry.filename_is_italic);
  if (!isItalicLike) return style;
  if (/\bitalic\b|\boblique\b/i.test(style)) return style;
  return `${style} Italic`;
};

const extractStyleFromValidationEntry = (
  entry: Record<string, unknown>,
  isMonoLisa: boolean,
  styleScope: "style" | "family-style"
): string | undefined => {
  const fileName =
    asNonEmptyString(entry.filename) ||
    (typeof entry.path === "string" ? path.basename(entry.path) : undefined) ||
    "";
  if (isMonoLisa) {
    const monoStyle = extractMonoLisaStyleFromFilename(fileName);
    if (monoStyle) return monoStyle;
  }

  const direct =
    asNonEmptyString(entry.subfamily_name) ||
    asNonEmptyString(entry.style_name) ||
    asNonEmptyString(entry.style) ||
    asNonEmptyString(entry.weight);
  if (direct) {
    const normalizedStyle = applyItalicSuffixFromValidation(direct, entry);
    if (styleScope === "family-style") {
      const familyName = asNonEmptyString(entry.family_name) || asNonEmptyString(entry.family);
      if (familyName) return `${familyName} ${normalizedStyle}`.replace(/\s+/g, " ").trim();
    }
    return normalizedStyle;
  }

  const family = asNonEmptyString(entry.family_name) || "";
  const fullName = asNonEmptyString(entry.full_name) || "";
  if (family && fullName && fullName.toLowerCase().startsWith(family.toLowerCase())) {
    const remainder = fullName.slice(family.length).trim();
    if (remainder) {
      const normalizedRemainder = applyItalicSuffixFromValidation(remainder, entry);
      if (styleScope === "family-style") {
        return `${family} ${normalizedRemainder}`.replace(/\s+/g, " ").trim();
      }
      return normalizedRemainder;
    }
  }

  const fromFileName = extractGenericStyleFromFileName(fileName);
  if (!fromFileName) return undefined;
  const normalizedFromFile = applyItalicSuffixFromValidation(fromFileName, entry);
  if (styleScope === "family-style") {
    const base = path.basename(fileName, path.extname(fileName));
    const familyToken =
      base.includes("-")
        ? base.slice(0, base.indexOf("-"))
        : "";
    const familyLabel = familyToken ? toTitleWords(familyToken) : "";
    if (familyLabel) return `${familyLabel} ${normalizedFromFile}`.replace(/\s+/g, " ").trim();
  }
  return normalizedFromFile;
};

const buildBatchAnalysisAuditFromQuality = (params: {
  request: BatchDirectRequest;
  qualityAudit: Record<string, unknown>;
  foundryHint?: string;
  requestMeta: Record<string, unknown>;
  fontMeta: Record<string, unknown>;
}): Record<string, unknown> => {
  const { request, qualityAudit, foundryHint, requestMeta, fontMeta } = params;
  const coverage = isRecord(qualityAudit.coverage) ? qualityAudit.coverage : {};
  const summary = isRecord(qualityAudit.summary) ? qualityAudit.summary : {};
  const profile = isRecord(qualityAudit.profile) ? qualityAudit.profile : {};
  const validationSnapshot = isRecord(qualityAudit.validationSnapshot) ? qualityAudit.validationSnapshot : {};
  const qualitySignals = isRecord(qualityAudit.qualitySignals) ? qualityAudit.qualitySignals : {};

  const expectedStyles = Array.isArray((coverage as any).expectedStyles)
    ? (coverage as any).expectedStyles.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const optionalExcludedStyles = Array.isArray((coverage as any).optionalExcludedStyles)
    ? (coverage as any).optionalExcludedStyles.filter(
        (item: unknown): item is string => typeof item === "string" && item.trim().length > 0
      )
    : [];
  const observedStyles = Array.isArray((coverage as any).observedStyles)
    ? (coverage as any).observedStyles.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const optionalObservedStyles = Array.isArray((coverage as any).optionalObservedStyles)
    ? (coverage as any).optionalObservedStyles.filter(
        (item: unknown): item is string => typeof item === "string" && item.trim().length > 0
      )
    : [];
  const missingStyles = Array.isArray((coverage as any).missingStyles)
    ? (coverage as any).missingStyles.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  const expectedStyleCountRaw = Number((summary as any).expectedStyleCount);
  const observedStyleCountRaw = Number((summary as any).observedStyleCount);
  const styleCoveragePercentRaw = Number((summary as any).styleCoveragePercent);
  const status = asNonEmptyString((qualityAudit as any).status) || "unknown";

  const targetUrl =
    tryExtractHttpUrl((requestMeta as any).targetUrl) ||
    tryExtractHttpUrl((requestMeta as any).pageUrl) ||
    tryExtractHttpUrl((fontMeta as any).targetUrl) ||
    tryExtractHttpUrl((fontMeta as any).pageUrl) ||
    tryExtractHttpUrl(request.source);
  let host: string | undefined;
  try {
    if (targetUrl) host = new URL(targetUrl).host;
  } catch {
    host = undefined;
  }

  const targetTokens = deriveValidationTokens([
    foundryHint,
    asNonEmptyString((profile as any).familyDisplay),
    asNonEmptyString((profile as any).familyPostscript),
    targetUrl,
    request.source,
    ...(request.fonts || []).map((font) => font.family),
    ...(request.fonts || []).map((font) => (isRecord(font.metadata) ? font.metadata.family : undefined))
  ]);

  const expectedStyleCount = Number.isFinite(expectedStyleCountRaw) ? expectedStyleCountRaw : expectedStyles.length;
  const observedStyleCount = Number.isFinite(observedStyleCountRaw) ? observedStyleCountRaw : observedStyles.length;
  const matchedStyleCount = Math.max(0, expectedStyleCount - missingStyles.length);
  const styleAccuracyPct =
    Number.isFinite(styleCoveragePercentRaw)
      ? styleCoveragePercentRaw
      : expectedStyleCount > 0
        ? Number(((matchedStyleCount / expectedStyleCount) * 100).toFixed(2))
        : undefined;

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: "analysis-audit-v2",
    mode: "batch-direct",
    targetUrl,
    host,
    targetTokens,
    profile: {
      profileId: asNonEmptyString((profile as any).profileId),
      source: asNonEmptyString((profile as any).source),
      foundry: asNonEmptyString((qualityAudit as any).foundry) || foundryHint,
      familyDisplay: asNonEmptyString((profile as any).familyDisplay),
      familyPostscript: asNonEmptyString((profile as any).familyPostscript),
      targetSlug: asNonEmptyString((profile as any).targetSlug),
      catalogExpectedStyleCount: expectedStyleCount
    },
    expected: {
      styles: expectedStyles,
      optionalExcludedStyles,
      postscriptNames: [],
      sessionPostscriptNames: []
    },
    observed: {
      styles: observedStyles,
      optionalObservedStyles,
      postscriptNames: [],
      observedStyleCount,
      observedPostscriptCount: 0
    },
    coverage: {
      expectedStyleCount,
      matchedStyleCount,
      missingStyleCount: missingStyles.length,
      styleAccuracyPct
    },
    missingStyles,
    unexpectedStyles: [],
    missingPostscriptNames: [],
    unexpectedPostscriptNames: [],
    validationSnapshot,
    qualitySignals,
    status
  };
};

const runFoundryQualityAudit = async (params: {
  outputDir: string;
  downloaded: DownloadedFile[];
  validationPath?: string;
  fonts: BatchDirectRequest["fonts"];
  foundryHint?: string;
  source?: string;
  requestMeta: Record<string, unknown>;
  fontMeta: Record<string, unknown>;
}): Promise<{ qualityLogPath?: string; qualityAudit?: Record<string, unknown> }> => {
  const { outputDir, downloaded, validationPath, fonts, foundryHint, source, requestMeta, fontMeta } = params;
  const resolvedProfile = resolveFoundryQualityProfile({ foundryHint, source, requestMeta, fontMeta, fonts });
  if (!resolvedProfile) {
    return {};
  }
  const { profile, isMonoLisa } = resolvedProfile;

  const validationFilePath = validationPath || path.join(outputDir, "validation-log.json");
  const validationData = await readJsonRecord(validationFilePath);
  const validationSummary = isRecord(validationData?.summary) ? validationData.summary : {};
  const validationFullFonts = Array.isArray(validationData?.full_fonts)
    ? (validationData.full_fonts.filter((entry) => isRecord(entry)) as Record<string, unknown>[])
    : [];

  // Some foundries (notably Typotheque icon families) ship a single VF URL that contains many named instances,
  // but their catalog only reports a single "default" style. When this happens, expand expectedStyles from
  // the VF's fvar instances so coverage reflects the actual family variant space.
  if (
    profile.styleScope === "family-style" &&
    profile.profileId === "typotheque-target-profile-v1" &&
    profile.expectedStyles.length > 0 &&
    profile.expectedStyles.length <= 4
  ) {
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const fontkit = require("fontkit");

      const candidates = downloaded
        .map((item) => (typeof item.filePath === "string" ? path.resolve(process.cwd(), item.filePath) : ""))
        .filter((filePath) => filePath && filePath.toLowerCase().endsWith(".woff2") && fs.existsSync(filePath));

      let bestExpected: string[] | undefined;
      let bestCount = 0;

      for (const filePath of candidates) {
        let font: any;
        try {
          font = fontkit.openSync(filePath);
        } catch {
          continue;
        }

        const instanceCount = Number(font?.fvar?.instanceCount || 0);
        if (!Number.isFinite(instanceCount) || instanceCount <= profile.expectedStyles.length) {
          try {
            font?.close?.();
          } catch {
            // ignore
          }
          continue;
        }

        const familyName = typeof font?.familyName === "string" ? font.familyName.trim() : "";
        const fallbackSubfamily =
          typeof font?.subfamilyName === "string" && font.subfamilyName.trim() ? font.subfamilyName.trim() : "Regular";
        const instances = Array.isArray(font?.fvar?.instance) ? font.fvar.instance : [];
        const derived: string[] = [];

        for (const inst of instances) {
          const raw = typeof inst?.name?.en === "string" ? inst.name.en : typeof inst?.name === "string" ? inst.name : "";
          const styleName = (raw || "").trim() || fallbackSubfamily;
          const fullLabel =
            familyName && !styleName.toLowerCase().startsWith(familyName.toLowerCase())
              ? `${familyName} ${styleName}`.trim()
              : styleName;
          if (fullLabel) derived.push(fullLabel);
        }

        // Some default instances can point at the font's typographic subfamily name ID and lack a per-instance name.
        // In that case, ensure at least one expected style exists for the fallback subfamily.
        if (derived.length < instanceCount && familyName) {
          derived.push(`${familyName} ${fallbackSubfamily}`.trim());
        }

        const expected = dedupeStyleLabels(derived);
        if (expected.length > bestCount) {
          bestCount = expected.length;
          bestExpected = expected;
        }

        try {
          font?.close?.();
        } catch {
          // ignore
        }
      }

      if (bestExpected && bestExpected.length > profile.expectedStyles.length) {
        profile.expectedStyles = bestExpected;
      }
    } catch {
      // best-effort: keep original expectedStyles if VF inspection fails
    }
  }

  const expectedStyleMap = new Map<string, string>();
  for (const style of profile.expectedStyles) {
    const token = normalizeQualityStyleToken(style);
    if (!token || expectedStyleMap.has(token)) continue;
    expectedStyleMap.set(token, style);
  }
  const optionalExcludedStyleMap = new Map<string, string>();
  for (const style of profile.optionalExcludedStyles || []) {
    const token = normalizeQualityStyleToken(style);
    if (!token || optionalExcludedStyleMap.has(token)) continue;
    optionalExcludedStyleMap.set(token, style);
  }

  const styleMetrics = new Map<string, FoundryStyleMetrics>();
  const observedStyleLabels = new Map<string, string>();
  const optionalObservedStyleLabels = new Map<string, string>();
  for (const entry of validationFullFonts) {
    const fileName =
      asNonEmptyString(entry.filename) ||
      (typeof entry.path === "string" ? path.basename(entry.path) : undefined) ||
      "";

    let style = extractStyleFromValidationEntry(entry, isMonoLisa, profile.styleScope);
    let styleToken = style ? normalizeQualityStyleToken(style) : "";

    // Fallback for protected webfonts whose name table is intentionally obfuscated.
    const expectedFromFileName = resolveExpectedStyleFromFileName(fileName, expectedStyleMap);
    if (expectedFromFileName) {
      const styleLooksUnexpected = !styleToken || !expectedStyleMap.has(styleToken);
      if (styleLooksUnexpected) {
        styleToken = expectedFromFileName.token;
        style = expectedFromFileName.label;
      }
    }

    if (!styleToken) continue;
    if (optionalExcludedStyleMap.has(styleToken)) {
      if (!optionalObservedStyleLabels.has(styleToken) && style) {
        optionalObservedStyleLabels.set(styleToken, style);
      }
      continue;
    }
    if (!observedStyleLabels.has(styleToken) && style) {
      observedStyleLabels.set(styleToken, style);
    }

    const metric: FoundryStyleMetrics = {
      fileName,
      glyphCount: Number(entry.glyph_count) || 0,
      cmapEntries: Number(entry.cmap_entries) || 0,
      featureCount: Number(entry.feature_count) || 0,
      featureTags: Array.isArray(entry.opentype_features)
        ? entry.opentype_features.filter((tag): tag is string => typeof tag === "string")
        : []
    };
    const prev = styleMetrics.get(styleToken);
    if (!prev || metric.cmapEntries > prev.cmapEntries || metric.glyphCount > prev.glyphCount) {
      styleMetrics.set(styleToken, metric);
    }
  }

  const downloadedStyleSet = new Set<string>();
  if (profile.styleScope !== "family-style") {
    for (const item of downloaded) {
      const style = isMonoLisa ? extractMonoLisaStyleFromFilename(item.fileName) : extractGenericStyleFromFileName(item.fileName);
      const styleToken = style ? normalizeQualityStyleToken(style) : "";
      if (!styleToken) continue;
      if (optionalExcludedStyleMap.has(styleToken)) {
        if (!optionalObservedStyleLabels.has(styleToken) && style) {
          optionalObservedStyleLabels.set(styleToken, style);
        }
        continue;
      }
      downloadedStyleSet.add(styleToken);
      if (!observedStyleLabels.has(styleToken) && style) {
        observedStyleLabels.set(styleToken, style);
      }
    }
  }
  const observedStyleSet = new Set<string>([...downloadedStyleSet, ...styleMetrics.keys()]);

  const expectedTokens = Array.from(expectedStyleMap.keys());

  const resolveObservedTokenForExpected = (expectedToken: string): string | undefined => {
    if (observedStyleSet.has(expectedToken)) return expectedToken;
    if (profile.styleScope !== "family-style") return undefined;

    for (const observedToken of observedStyleSet) {
      if (
        observedToken.startsWith(expectedToken) ||
        observedToken.includes(expectedToken) ||
        expectedToken.startsWith(observedToken)
      ) {
        return observedToken;
      }
    }

    return undefined;
  };

  const matchedExpectedToObserved = new Map<string, string>();
  for (const expectedToken of expectedTokens) {
    const matched = resolveObservedTokenForExpected(expectedToken);
    if (matched) matchedExpectedToObserved.set(expectedToken, matched);
  }

  const missingStyleTokens = expectedTokens.filter((token) => !matchedExpectedToObserved.has(token));
  const stylesBelowCmapTokens = expectedTokens.filter((token) => {
    const resolvedToken = matchedExpectedToObserved.get(token) || token;
    const metric = styleMetrics.get(resolvedToken);
    if (!metric) return false;
    return metric.cmapEntries < profile.minCmapEntries;
  });
  const stylesBelowFeatureCountTokens = expectedTokens.filter((token) => {
    const resolvedToken = matchedExpectedToObserved.get(token) || token;
    const metric = styleMetrics.get(resolvedToken);
    if (!metric) return false;
    return metric.featureCount < profile.minFeatureCount;
  });

  const globalFeatureTags = new Set<string>();
  const featureSourceTokens =
    expectedTokens.length > 0
      ? dedupeStyleLabels(expectedTokens.map((token) => matchedExpectedToObserved.get(token) || token))
      : Array.from(styleMetrics.keys());
  for (const token of featureSourceTokens) {
    const metric = styleMetrics.get(token);
    if (!metric) continue;
    for (const tag of metric.featureTags) {
      globalFeatureTags.add(tag.toLowerCase());
    }
  }
  const missingRequiredFeatureTags = profile.requiredFeatureTags.filter((tag) => !globalFeatureTags.has(tag.toLowerCase()));

  const invalidFonts = Number(validationSummary.invalid_fonts) || 0;
  const italicMismatches = Number(validationSummary.italic_mismatches) || 0;
  const validationStatus = typeof validationSummary.status === "string" ? validationSummary.status : "unknown";

  const trialSourceRe = /\btrial\b/i;
  const trialAssetEntries = downloaded.filter((item) => {
    const source = typeof item.sourceUrl === "string" ? item.sourceUrl : "";
    const fileName = typeof item.fileName === "string" ? item.fileName : "";
    const name = typeof item.name === "string" ? item.name : "";
    return trialSourceRe.test(source) || trialSourceRe.test(fileName) || trialSourceRe.test(name);
  });

  const failReasons: string[] = [];
  const warnReasons: string[] = [];
  if (missingStyleTokens.length > 0) {
    const missingStyles = missingStyleTokens.map((token) => expectedStyleMap.get(token) || token);
    if (isMonoLisa || profile.strictMissingStyles) {
      failReasons.push(`missing styles: ${missingStyles.join(", ")}`);
    } else {
      warnReasons.push(`missing styles: ${missingStyles.join(", ")}`);
    }
  }
  if (stylesBelowCmapTokens.length > 0) failReasons.push(`styles below cmap threshold (${profile.minCmapEntries})`);
  if (invalidFonts > 0) failReasons.push(`invalid fonts detected: ${invalidFonts}`);
  if (italicMismatches > 0) failReasons.push(`italic mismatches detected: ${italicMismatches}`);
  if (profile.failOnTrialAssets && trialAssetEntries.length > 0) {
    failReasons.push(`trial assets detected: ${trialAssetEntries.length}`);
  }

  if (stylesBelowFeatureCountTokens.length > 0) warnReasons.push(`styles below feature threshold (${profile.minFeatureCount})`);
  if (missingRequiredFeatureTags.length > 0) warnReasons.push(`required feature tags missing: ${missingRequiredFeatureTags.join(", ")}`);
  if (validationStatus === "warn" && failReasons.length === 0) warnReasons.push("validation status is warn");

  const status: "pass" | "warn" | "fail" =
    failReasons.length > 0 ? "fail" : warnReasons.length > 0 ? "warn" : "pass";
  const styleCoveragePercent =
    expectedTokens.length > 0
      ? Number(((expectedTokens.length - missingStyleTokens.length) / Math.max(1, expectedTokens.length) * 100).toFixed(2))
      : undefined;
  const matchedStyleCount = Math.max(0, expectedTokens.length - missingStyleTokens.length);
  const missingStyleCount = missingStyleTokens.length;
  const printReadiness: "likely-safe" | "warn" = invalidFonts > 0 || italicMismatches > 0 ? "warn" : "likely-safe";

  const audit: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    schemaVersion: "quality-audit-v2",
    mode: "batch-direct",
    foundry: profile.foundry || foundryHint || "Unknown Foundry",
    status,
    qualityStatus: status,
    profile,
    summary: {
      expectedStyleCount: expectedTokens.length,
      observedStyleCount: observedStyleSet.size,
      styleCoveragePercent,
      failReasonCount: failReasons.length,
      warnReasonCount: warnReasons.length
    },
    failReasons,
    warnReasons,
    coverage: {
      expectedStyleCount: expectedTokens.length,
      matchedStyleCount,
      missingStyleCount,
      styleCoveragePercent,
      expectedStyles: Array.from(expectedStyleMap.values()),
      observedStyles: Array.from(observedStyleLabels.values()).sort(),
      optionalExcludedStyles: Array.from(optionalExcludedStyleMap.values()),
      optionalObservedStyles: Array.from(optionalObservedStyleLabels.values()).sort(),
      missingStyles: missingStyleTokens.map((token) => expectedStyleMap.get(token) || token),
      stylesBelowCmap: stylesBelowCmapTokens.map((token) => expectedStyleMap.get(token) || token),
      stylesBelowFeatureCount: stylesBelowFeatureCountTokens.map((token) => expectedStyleMap.get(token) || token)
    },
    validationSnapshot: {
      status: validationStatus,
      invalidFonts,
      italicMismatches
    },
    trialSnapshot: {
      failOnTrialAssets: profile.failOnTrialAssets,
      trialAssetCount: trialAssetEntries.length,
      trialAssetFiles: trialAssetEntries.map((item) => item.fileName).slice(0, 50)
    },
    featureSnapshot: {
      requiredFeatureTags: profile.requiredFeatureTags,
      missingRequiredFeatureTags,
      detectedFeatureTags: Array.from(globalFeatureTags).sort()
    },
    qualitySignals: {
      styleCoveragePercent,
      expectedStyleCount: expectedTokens.length,
      matchedStyleCount,
      missingStyleCount,
      invalidFonts,
      italicMismatches,
      printReadiness
    },
    styleMetrics: Object.fromEntries(
      Array.from(expectedStyleMap.entries()).map(([token, label]) => [label, styleMetrics.get(matchedExpectedToObserved.get(token) || token) || null])
    )
  };

  const qualityFileName = isMonoLisa ? "monolisa-quality-log.json" : "quality-log.json";
  const qualityPath = path.join(outputDir, qualityFileName);
  await writeFile(qualityPath, JSON.stringify(audit, null, 2), "utf8");

  return {
    qualityLogPath: toRelative(qualityPath),
    qualityAudit: audit
  };
};

const stripLeadingNumericPrefix = (value: string): string => value.replace(/^\d{8,}-/, "");

const resolveFileNameHint = (hint: unknown, fallbackExt: string): string | undefined => {
  if (typeof hint !== "string") return undefined;
  const raw = hint.trim();
  if (!raw) return undefined;

  const normalized = raw.replace(/[\\/]+/g, "/");
  const base = path.basename(normalized);
  if (!base) return undefined;

  const hintedExt = path.extname(base).toLowerCase();
  const ext = supportedFontExtensions.has(hintedExt) ? hintedExt : fallbackExt;
  const stemRaw = path.basename(base, path.extname(base));
  const stemClean = toSafeFileName(stripLeadingNumericPrefix(stemRaw) || stemRaw);
  if (!stemClean) return undefined;

  return `${stemClean}${ext}`;
};

const ensureUniqueFilePath = (dirPath: string, baseName: string): string => {
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);

  let candidate = joinOpaquePath(dirPath, baseName);
  if (!fs.existsSync(candidate)) return candidate;

  for (let i = 1; i <= 999; i += 1) {
    candidate = joinOpaquePath(dirPath, `${stem}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }

  return candidate;
};

const normalizeNonWebVariantBaseName = (baseName: string): string => {
  const trimmed = baseName.trim();
  if (!trimmed) return baseName;
  const normalized = trimmed.replace(/(?:[-_\s]+)web$/i, "").trim();
  return normalized || baseName;
};

const maybeRenameConvertedNonWebVariant = async (
  variantPath: string | null | undefined
): Promise<string | null | undefined> => {
  if (!variantPath) return variantPath;
  const ext = path.extname(variantPath).toLowerCase();
  if (ext !== ".ttf" && ext !== ".otf") return variantPath;

  const dirPath = path.dirname(variantPath);
  const originalBaseName = path.basename(variantPath, ext);
  const normalizedBaseName = normalizeNonWebVariantBaseName(originalBaseName);
  if (normalizedBaseName === originalBaseName) return variantPath;

  const targetPath = ensureUniqueFilePath(dirPath, `${normalizedBaseName}${ext}`);
  if (path.resolve(targetPath) === path.resolve(variantPath)) return variantPath;

  try {
    await renameFile(variantPath, targetPath);
    return targetPath;
  } catch {
    return variantPath;
  }
};
const isSafeZipEntryPath = (entryName: string): boolean => {
  const normalized = entryName.replace(/\\/g, "/");
  if (!normalized) return false;
  if (normalized.startsWith("/") || normalized.startsWith("\\")) return false;
  if (normalized.includes("\u0000")) return false;
  // ZipSlip guard: reject any path segments that traverse upward.
  if (normalized.split("/").some((segment) => segment === "..")) return false;
  return true;
};

const shouldExtractSpecimenPdfFromZipEntry = (entryPath: string): boolean => {
  const token = entryPath.toLowerCase();
  const legalDocMarkers = [
    "eula",
    "license",
    "licence",
    "terms",
    "agreement",
    "readme",
    "copyright"
  ];
  return !legalDocMarkers.some((marker) => token.includes(marker));
};

const extractZipFonts = async (params: {
  zipPath: string;
  outputDir: string;
  sourceUrl: string;
  downloaded: DownloadedFile[];
  groupFolderHint?: string;
  extractFonts?: boolean;
  extractPdfs?: boolean;
  extractToRoot?: boolean;
}): Promise<number> => {
  const {
    zipPath,
    outputDir,
    sourceUrl,
    downloaded,
    groupFolderHint,
    extractFonts = true,
    extractPdfs = false,
    extractToRoot = false
  } = params;

  const zipBase = path.basename(zipPath, path.extname(zipPath));
  const folderBase =
    (typeof groupFolderHint === "string" && groupFolderHint.trim()
      ? stripLeadingNumericPrefix(groupFolderHint.trim())
      : "") ||
    stripLeadingNumericPrefix(zipBase) ||
    zipBase ||
    "zip-fonts";

  const extractionDir = extractToRoot ? outputDir : joinOpaquePath(outputDir, toSafeSegment(folderBase));
  const specimenDir = joinOpaquePath(outputDir, "specimens");
  if (extractFonts) {
    await mkdir(extractionDir, { recursive: true });
  }
  if (extractPdfs) {
    await mkdir(specimenDir, { recursive: true });
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  let extractedCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!isSafeZipEntryPath(entry.entryName)) continue;

    const normalized = entry.entryName.replace(/\\/g, "/");
    if (normalized.includes("__MACOSX")) continue;

    const entryExt = path.extname(normalized).toLowerCase();
    if (!entryExt) continue;

    const baseName = path.basename(normalized);
    if (!baseName) continue;

    if (entryExt === ".pdf") {
      if (!extractPdfs) continue;
      if (!shouldExtractSpecimenPdfFromZipEntry(normalized)) continue;
      const uniqueTarget = ensureUniqueFilePath(specimenDir, baseName);
      const resolvedTarget = path.resolve(uniqueTarget);
      const resolvedRoot = path.resolve(specimenDir) + path.sep;
      if (!resolvedTarget.startsWith(resolvedRoot)) continue;
      await writeFile(uniqueTarget, entry.getData());
      extractedCount += 1;
      continue;
    }

    if (!extractFonts) continue;
    if (entryExt === ".zip") continue;
    if (!supportedFontExtensions.has(entryExt)) continue;

    const uniqueTarget = ensureUniqueFilePath(extractionDir, baseName);
    const resolvedTarget = path.resolve(uniqueTarget);
    const resolvedRoot = path.resolve(extractionDir) + path.sep;
    if (!resolvedTarget.startsWith(resolvedRoot)) continue;

    await writeFile(uniqueTarget, entry.getData());

    extractedCount += 1;
    downloaded.push({
      fileName: path.basename(uniqueTarget),
      filePath: toRelative(uniqueTarget),
      sourceUrl
    });
  }

  return extractedCount;
};

const writeLog = async (outputDir: string, payload: Omit<DownloadResult, "logPath">): Promise<string> => {
  const logPath = path.join(outputDir, "download-log.json");
  await writeFile(logPath, JSON.stringify(payload, null, 2), "utf8");
  return logPath;
};

const validateUrl = (urlString: string, fieldName: string): string => {
  try {
    return new URL(urlString).href;
  } catch {
    throw new Error(`Field \`${fieldName}\` must be a valid URL.`);
  }
};

const validateUrlWithBase = (urlString: string, fieldName: string, baseUrl?: string): string => {
  const candidate = urlString.trim();
  if (!candidate) {
    throw new Error(`Field \`${fieldName}\` must be a valid URL.`);
  }

  try {
    const resolved = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return resolved.href;
  } catch {
    throw new Error(`Field \`${fieldName}\` must be a valid URL.`);
  }
};

const normalizeItems = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value)) {
    return Object.values(value);
  }
  return undefined;
};

const buildFieldCandidates = (primaryField: string, fallbackFields: string[]): string[] => {
  const unique = new Set<string>();
  const addField = (value: string): void => {
    const normalized = value.trim();
    if (normalized) {
      unique.add(normalized);
    }
  };

  addField(primaryField);
  for (const field of fallbackFields) {
    addField(field);
  }

  return [...unique.values()];
};

const pickRecordField = (record: Record<string, unknown>, pathOrKey: string): unknown => {
  const byPath = pickByPath<unknown>(record, pathOrKey);
  if (byPath !== undefined) {
    return byPath;
  }
  return record[pathOrKey];
};

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
};

const extractUrlCandidate = (value: unknown): string | undefined => {
  const direct = asNonEmptyString(value);
  if (direct) {
    return direct;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const nestedKeys = [
    "woff2",
    "woff",
    "url",
    "href",
    "src",
    "fileUrl",
    "file_url",
    "fontUrl",
    "font_url"
  ];

  for (const key of nestedKeys) {
    const nested = asNonEmptyString(value[key]);
    if (nested) {
      return nested;
    }
  }

  return undefined;
};

const pickFirstMatchingField = (
  record: Record<string, unknown>,
  candidatePaths: string[],
  mapValue: (value: unknown) => string | undefined
): string | undefined => {
  for (const candidatePath of candidatePaths) {
    const rawValue = pickRecordField(record, candidatePath);
    const parsedValue = mapValue(rawValue);
    if (parsedValue) {
      return parsedValue;
    }
  }

  return undefined;
};

const inferNameFromUrl = (sourceUrl: string, index: number): string => {
  try {
    const parsed = new URL(sourceUrl);
    const rawName = path.basename(parsed.pathname, path.extname(parsed.pathname));
    const normalized = rawName.replace(/[-_]+/g, " ").trim();
    if (normalized) {
      return normalized;
    }
  } catch {
    // fallback below
  }

  return `font-${index + 1}`;
};

const runCssUrlDownload = async (request: CssUrlRequest): Promise<DownloadResult> => {
  const cssUrl = validateUrl(request.cssUrl, "cssUrl");
  const license = assertLicenseAllowed(request.licenseId, request.licenseProof);
  const source = request.source?.trim() || new URL(cssUrl).host;
  const family = request.family?.trim() || "unknown-family";
  const outputDir = makeJobFolder(request.outputFolder, request.metadata);
  const headers = buildHeaders(request);
  const downloadRetryBudget = resolveDownloadRetryBudget(request, request.metadata);

  await prepareOutputDir(outputDir, Boolean(request.outputFolder && request.outputFolder.trim()));

  const cssText = await fetchText(cssUrl, headers);
  const fontUrls = parseCssFontUrls(cssText, cssUrl);
  if (!fontUrls.length) {
    throw new Error("Tidak ada URL font ditemukan pada CSS.");
  }

  const downloaded: DownloadedFile[] = [];
  for (let i = 0; i < fontUrls.length; i += 1) {
    const sourceUrl = fontUrls[i];
    const ext = detectExtension(sourceUrl, request);
    const fileName = `${toSafeFileName(family)}-${String(i + 1).padStart(2, "0")}${ext}`;
    const filePath = path.join(outputDir, fileName);
    await downloadBinary(sourceUrl, filePath, headers, downloadRetryBudget);
    downloaded.push({
      fileName,
      filePath: toRelative(filePath),
      sourceUrl,
      license
    });
  }

  const resultCore = {
    command: "css-url" as const,
    source,
    outputDir: toRelative(outputDir),
    downloadedAt: new Date().toISOString(),
    downloaded,
    skipped: [] as SkippedItem[]
  };

  const logPath = await writeLog(outputDir, resultCore);
  return {
    ...resultCore,
    logPath: toRelative(logPath)
  };
};

const runApiJsonDownload = async (request: ApiJsonRequest): Promise<DownloadResult> => {
  const apiUrl = validateUrl(request.apiUrl, "apiUrl");
  const outputDir = makeJobFolder(request.outputFolder, request.metadata);
  const headers = buildHeaders(request);
  const source = request.source?.trim() || new URL(apiUrl).host;

  const itemsPath = request.itemsPath?.trim() || "fonts";
  const urlField = request.urlField?.trim() || "url";
  const nameField = request.nameField?.trim() || "name";
  const licenseField = request.licenseField?.trim() || "license";

  await prepareOutputDir(outputDir, Boolean(request.outputFolder && request.outputFolder.trim()));

  const payload = await fetchJson<unknown>(apiUrl, headers);
  const rawItems = pickByPath<unknown>(payload, itemsPath);
  const items = normalizeItems(rawItems);
  if (!items) {
    throw new Error(`Path \`${itemsPath}\` must resolve to an array or object.`);
  }

  const urlCandidates = buildFieldCandidates(urlField, apiUrlFallbackPaths);
  const nameCandidates = buildFieldCandidates(nameField, apiNameFallbackPaths);
  const licenseCandidates = buildFieldCandidates(licenseField, apiLicenseFallbackPaths);

  const downloaded: DownloadedFile[] = [];
  const skipped: SkippedItem[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const record = isRecord(item) ? item : {};

    const sourceUrlValue =
      asNonEmptyString(item) ??
      pickFirstMatchingField(record, urlCandidates, extractUrlCandidate);
    const licenseIdValue =
      pickFirstMatchingField(record, licenseCandidates, asNonEmptyString) ?? request.licenseId;

    if (typeof sourceUrlValue !== "string" || !sourceUrlValue.trim()) {
      skipped.push({
        index: i,
        reason: `Font URL not found (check \`${urlCandidates.join(", ")}\`).`
      });
      continue;
    }

    const sourceUrl = validateUrlWithBase(sourceUrlValue, urlField, apiUrl);
    const nameValue = pickFirstMatchingField(record, nameCandidates, asNonEmptyString);
    const fontName = nameValue || inferNameFromUrl(sourceUrl, i);

    let license;
    try {
      license = assertLicenseAllowed(licenseIdValue, request.licenseProof);
    } catch (error) {
      skipped.push({
        index: i,
        name: fontName,
        reason: `Lisensi ditolak: ${(error as Error).message}`
      });
      continue;
    }

    const ext = detectExtension(sourceUrl, record);
    const fileName = `${toSafeFileName(fontName)}-${String(i + 1).padStart(2, "0")}${ext}`;
    
    // [HEIST-MODE] Organisasi sub-folder sekarang ditangani oleh makeJobFolder secara global
    // Namun kita tetap izinkan overrides per-item jika ada kategori spesifik yang berbeda dari familyutama
    let finalOutputDir = outputDir;
    const category = (record as any).category;
    if (category && typeof category === "string" && toSafeSegment(category) !== path.basename(outputDir)) {
      const subFolder = toSafeSegment(category);
      finalOutputDir = path.join(outputDir, subFolder);
      if (!fs.existsSync(finalOutputDir)) {
        await mkdir(finalOutputDir, { recursive: true });
      }
    }

    const filePath = joinOpaquePath(finalOutputDir, fileName);
    const downloadRetryBudget = resolveDownloadRetryBudget(request, request.metadata, record);
    await downloadBinary(sourceUrl, filePath, headers, downloadRetryBudget);

    downloaded.push({
      name: fontName,
      fileName,
      filePath: toRelative(filePath),
      sourceUrl,
      license
    });
  }

  const resultCore = {
    command: "api-json" as const,
    source,
    outputDir: toRelative(outputDir),
    downloadedAt: new Date().toISOString(),
    downloaded,
    skipped
  };

  const logPath = await writeLog(outputDir, resultCore);
  return {
    ...resultCore,
    logPath: toRelative(logPath)
  };
};

export const runDirectUrlDownload = async (request: DirectUrlRequest): Promise<DownloadResult> => {
  // Interception placeholder fallback.
  if (request.fileUrl === "interception-mode") {
    const metadata = (request as any).metadata || {};
    // pageUrl may live at metadata.pageUrl or metadata.metadata.pageUrl.
    const pageUrl = metadata.pageUrl || (metadata.metadata && metadata.metadata.pageUrl) || request.source || ""; 
    
    if (!pageUrl) {
      throw new Error("Interception mode requires a valid pageUrl in metadata.");
    }

    console.log(`[Protocol Switch] Rerouting interception-mode to Browser Intercept for: ${pageUrl}`);
    
    return await runBrowserIntercept({
      targetUrl: pageUrl,
      outputFolder: request.outputFolder,
      mode: "browser-intercept",
      metadata
    });
  }

  const fileUrl = validateUrl(request.fileUrl, "fileUrl");
  const license = assertLicenseAllowed(request.licenseId, request.licenseProof);
  const source = request.source?.trim() || new URL(fileUrl).host;
  
  let outputDir = makeJobFolder(request.outputFolder, request.metadata);
  
  const headers = buildHeaders(request);

  await prepareOutputDir(outputDir, Boolean(request.outputFolder && request.outputFolder.trim()));

  const metadata = (request as any).metadata || {};
  const family = request.family?.trim() || metadata.family?.trim() || "unknown-font";
  const style = request.style?.trim() || metadata.style?.trim() || "Normal";
  const weight = request.weight ? String(request.weight).trim() : (metadata.weight ? String(metadata.weight).trim() : "Regular");
  const category = typeof metadata.category === "string" ? metadata.category : undefined;
  
  // Prefer CDN basename to preserve recognizable naming.
  const ext = detectExtension(fileUrl, request);
  const hintedFileName = resolveFileNameHint(metadata.fileNameHint, ext);
  let fileName: string;
  if (hintedFileName) {
    fileName = hintedFileName;
  } else {
    try {
      const urlBasename = new URL(fileUrl).pathname.split('/').pop() || '';
      if (urlBasename && urlBasename.includes('.')) {
        fileName = urlBasename;
      } else {
        throw new Error('fallback');
      }
    } catch {
      // Fallback to metadata-based naming.
      const safeFamily = toSafeFileName(family);
      const safeWeight = toSafeFileName(normalizeWeightLabel(weight));
      const safeStyle = toSafeFileName(normalizeStyleLabel(style));
      fileName = `${safeFamily}-${safeWeight}${safeStyle !== "normal" ? `-${safeStyle}` : ""}${ext}`;
    }
  }
  const filePath = path.join(outputDir, fileName);

  try {
    const downloadRetryBudget = resolveDownloadRetryBudget(request, metadata);
    await downloadBinary(fileUrl, filePath, headers, downloadRetryBudget);
  } catch (error) {
    // Best-effort cleanup if download fails.
    try {
      const fs = await import("node:fs/promises");
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    throw error;
  }

  const downloaded: DownloadedFile[] = [{
    fileName,
    filePath: toRelative(filePath),
    sourceUrl: fileUrl,
    name: composeDisplayName(
      family,
      weight,
      style,
      category,
      undefined,
      metadata.styleName,
      metadata.fullName
    ),
    license
  }];

  const fileExt = path.extname(fileName).toLowerCase();
  if (ext === ".zip" || fileExt === ".zip") {
    try {
      const zipGroupHint =
        (typeof metadata.family === "string" && metadata.family.trim()
          ? metadata.family
          : undefined) ||
        (typeof request.family === "string" && request.family.trim()
          ? request.family
          : undefined);
      const extractSpecimenOnlyZip = isTruthyFlag((metadata as any).extractSpecimenOnlyZip);
      const extractSpecimenPdfFromZip =
        extractSpecimenOnlyZip || isTruthyFlag((metadata as any).extractSpecimenPdfFromZip);
      const zipExtractToRoot = isTruthyFlag((metadata as any).zipExtractToRoot);
      const extractedCount = await extractZipFonts({
        zipPath: filePath,
        outputDir,
        sourceUrl: fileUrl,
        downloaded,
        groupFolderHint: zipGroupHint,
        extractFonts: !extractSpecimenOnlyZip,
        extractPdfs: extractSpecimenPdfFromZip,
        extractToRoot: zipExtractToRoot
      });
      if (extractedCount <= 0) {
        console.warn(`[DIRECT-ZIP] No extractable font files found in ${fileName}`);
      } else if (shouldPruneRawZipAfterExtract(metadata)) {
        const rawRelativePath = toRelative(filePath);
        const rawIndex = downloaded.findIndex((entry) => entry.filePath === rawRelativePath);
        if (rawIndex >= 0) downloaded.splice(rawIndex, 1);
        await unlink(filePath).catch(() => undefined);
      }
    } catch (e: any) {
      console.error(`[DIRECT-ZIP] FAILED for ${fileName}:`, e.message);
    }
  }

  // Auto-convert variable/web fonts to desktop/web variants (best-effort).
  if ((ext === ".woff2" || ext === ".woff" || ext === ".ttf" || ext === ".otf") && !shouldSkipConversion(metadata)) {
    try {
        const { convertToMultipleFormats } = await import("./font-converter");
        const subFamily = composeSubFamilyLabel(weight, style, metadata.styleName);
        const forceMetadataRepair = shouldForceMetadataRepair(metadata);
             
        const conversionMetadata =
          (forceMetadataRepair || shouldApplyMetadataRepair(path.basename(filePath))) &&
          canApplyMetadataRepair(family, subFamily)
            ? { family, subFamily }
            : undefined;
        const conversionOptions = {
          disableInstanceExplosion: shouldDisableInstanceExplosion(metadata),
          expectedInstanceCount: resolveExpectedInstanceCount(metadata)
        };
        const conversions = await convertToMultipleFormats(
          filePath,
          conversionMetadata,
          conversionOptions
        );

        const maybePushVariant = async (variantPath: string | null | undefined, suffix: string) => {
          const normalizedVariantPath = await maybeRenameConvertedNonWebVariant(variantPath);
          if (!normalizedVariantPath) return;
          const variantFileName = path.basename(normalizedVariantPath);
          if (downloaded.some((d) => d.fileName === variantFileName)) return;
          downloaded.push({
            fileName: variantFileName,
            filePath: toRelative(normalizedVariantPath),
            sourceUrl: fileUrl,
            name: composeDisplayName(
              family,
              weight,
              style,
              category,
              suffix,
              metadata.styleName,
              metadata.fullName
            ),
            license
          });
        };

        await maybePushVariant(conversions.ttf, "TTF");
        await maybePushVariant(conversions.otf, "OTF");
        await maybePushVariant(conversions.woff, "WOFF");
        await maybePushVariant(conversions.woff2, "WOFF2");

        if (Array.isArray(conversions.instances)) {
          for (const instancePath of conversions.instances) {
            const normalizedInstancePath = await maybeRenameConvertedNonWebVariant(instancePath);
            if (!normalizedInstancePath) continue;
            const instanceFileName = path.basename(normalizedInstancePath);
            if (downloaded.some((d) => d.fileName === instanceFileName)) continue;
            const instanceStyle = extractGenericStyleFromFileName(instanceFileName) || "Regular";
            downloaded.push({
              fileName: instanceFileName,
              filePath: toRelative(normalizedInstancePath),
              sourceUrl: fileUrl,
              name: composeDisplayName(
                family,
                weight,
                style,
                category,
                "TTF",
                instanceStyle,
                `${family} ${instanceStyle}`
              ),
              license
            });
          }
        }
    } catch {
      // keep raw output even if conversion fails
    }
  }

  let pureSuccessLogPath: string | undefined;
  let pureSuccessAudit: Record<string, unknown> | undefined;
  try {
    const requiredFormats = resolvePureSuccessRequiredFormats(metadata);
    const sourceLimitedFormats = resolvePureSuccessSourceLimitedFormats(metadata);
    const pureSuccess = await runPureSuccessProtocol({
      outputDir,
      downloaded,
      foundry: source,
      family,
      requiredFormats,
      sourceLimitedFormats
    });
    pureSuccessAudit = pureSuccess as unknown as Record<string, unknown>;
    const pureSuccessPath = path.join(outputDir, "pure-success-log.json");
    await writeFile(pureSuccessPath, JSON.stringify(pureSuccess, null, 2), "utf8");
    pureSuccessLogPath = toRelative(pureSuccessPath);
  } catch {
    // best-effort
  }

  let validationLogPath: string | undefined;
  try {
    const metadataFonts = Array.isArray((metadata as any).fonts) ? (metadata as any).fonts : [];
    const validationTokenInputs: unknown[] = [
      family,
      source,
      metadata.targetUrl,
      metadata.pageUrl,
      ...(metadataFonts || []).map((font: any) => (isRecord(font) ? font.family : undefined)),
      ...(metadataFonts || []).map((font: any) =>
        isRecord(font) && isRecord((font as any).metadata) ? (font as any).metadata.family : undefined
      ),
      ...(metadataFonts || []).map((font: any) =>
        isRecord(font) && isRecord((font as any).metadata) ? (font as any).metadata.styleName : undefined
      ),
      ...(metadataFonts || []).map((font: any) =>
        isRecord(font) && isRecord((font as any).metadata) ? (font as any).metadata.fullName : undefined
      ),
      ...(metadataFonts || []).map((font: any) =>
        isRecord(font) && isRecord((font as any).metadata) ? (font as any).metadata.postscriptName : undefined
      )
    ];
    const validationTokens = deriveValidationTokens(validationTokenInputs);
    const validation = await runValidationLog({ outputDir, tokens: validationTokens });
    validationLogPath = toRelative(validation.outputPath);
  } catch {
    // best-effort
  }

  let technicalQaLogPath: string | undefined;
  let technicalQaAudit: Record<string, unknown> | undefined;
  try {
    const requiredFormats = resolvePureSuccessRequiredFormats(metadata);
    const sourceLimitedFormats = resolvePureSuccessSourceLimitedFormats(metadata);
    const technicalQa = await runTechnicalQa({
      outputDir,
      requiredFormats,
      sourceLimitedFormats
    });
    technicalQaLogPath = toRelative(technicalQa.outputPath);
    technicalQaAudit = technicalQa.audit;
  } catch {
    // best-effort
  }

  const logName = "download-log.json";
  const logPath = path.join(outputDir, logName);
  
  let resultCore: Omit<DownloadResult, "logPath">;

  try {
      const fs = await import("node:fs/promises");
      const logContent = await fs.readFile(logPath, "utf-8");
      const existing = JSON.parse(logContent);
      
      resultCore = {
          ...existing,
          downloaded: [...(existing.downloaded || []), ...downloaded]
      };
  } catch {
      resultCore = {
        command: "direct-url" as const,
        source,
        outputDir: toRelative(outputDir),
        downloadedAt: new Date().toISOString(),
        downloaded,
        skipped: [] as SkippedItem[],
        validationLogPath,
        pureSuccessLogPath,
        pureSuccessAudit,
        technicalQaLogPath,
        technicalQaAudit
      };
  }

  resultCore.validationLogPath = resultCore.validationLogPath || validationLogPath;
  resultCore.pureSuccessLogPath = resultCore.pureSuccessLogPath || pureSuccessLogPath;
  resultCore.pureSuccessAudit = resultCore.pureSuccessAudit || pureSuccessAudit;
  resultCore.technicalQaLogPath = resultCore.technicalQaLogPath || technicalQaLogPath;
  resultCore.technicalQaAudit = resultCore.technicalQaAudit || technicalQaAudit;

  await writeFile(logPath, JSON.stringify(resultCore, null, 2));

  return {
    ...resultCore,
    logPath: toRelative(logPath)
  };
};

export const runBatchDirectDownload = async (request: BatchDirectRequest): Promise<DownloadResult> => {
  // Use first font to derive deterministic folder naming hints.
  const primaryFont = request.fonts[0];
  const requestMeta = isRecord(request.metadata) ? request.metadata : {};
  const fontMeta = isRecord(primaryFont?.metadata) ? primaryFont.metadata : {};

  let foundryHint: string | undefined = (requestMeta as any).foundry || (fontMeta as any).foundry;
  if (!foundryHint) {
    try {
      const host = new URL(primaryFont?.url || "").host.toLowerCase();
      if (host.includes("cotypefoundry.com")) foundryHint = "CoType";
      else if (host === "205.tf" || host.endsWith(".205.tf")) foundryHint = "205TF";
      else if (host.includes("superiortype.com")) foundryHint = "Superior Type";
      else if (host.includes("pangrampangram.com")) foundryHint = "Pangram Pangram";
      else if (host.includes("klim.co.nz")) foundryHint = "Klim";
      else if (host.includes("lineto.com")) foundryHint = "Lineto";
      else if (host.includes("abcdinamo.com")) foundryHint = "ABC Dinamo";
      else if (host.includes("ohnotype.co")) foundryHint = "Ohno Type Co";
      else if (host.includes("wtypefoundry.com")) foundryHint = "W Type";
      else if (host.includes("swisstypefaces.com")) foundryHint = "Swiss Typefaces";
      else if (host.includes("brandingwithtype.com")) foundryHint = "Branding With Type";
    } catch {
      // best-effort
    }
  }

  const familyHint: string | undefined =
    (requestMeta as any).family ||
    (fontMeta as any).family ||
    primaryFont?.family;

  const emit = (event: { type: "progress" | "log"; current?: number; total?: number; message?: string }) => {
    if (!request.onProgress) return;
    request.onProgress(event);
  };
  const emitLog = (message: string) => emit({ type: "log", message });
  const emitProgress = (current: number, total: number) => emit({ type: "progress", current, total });

  emitLog(
    `[Batch Direct] start (foundry=${foundryHint || request.source || "unknown"}, family=${familyHint || "unknown"}, urls=${request.fonts.length})`
  );
  emitProgress(0, request.fonts.length);

  const primaryMetadata = {
    ...requestMeta,
    ...fontMeta,
    ...(foundryHint ? { foundry: foundryHint } : {}),
    ...(familyHint ? { family: familyHint } : {}),
    fonts: request.fonts
  };
  const outputDir = makeJobFolder(request.outputFolder, primaryMetadata);
  
  const deterministicRoot = request.outputFolder?.trim()
    ? path.join(baseDownloadRoot, toSafeOutputFolderPath(request.outputFolder))
    : undefined;
  await prepareOutputDir(
    outputDir,
    Boolean(request.outputFolder && request.outputFolder.trim()),
    deterministicRoot
  );
  
  const downloaded: DownloadedFile[] = [];
  const skipped: SkippedItem[] = [];
  const seenContentHashes = new Set<string>();
  
  for (let i = 0; i < request.fonts.length; i++) {
    const font = request.fonts[i];
    const fileUrl = font.url;
    
    try {
      if (isInterceptPlaceholderUrl(fileUrl)) {
        throw new Error(`Intercept placeholder "${fileUrl}" requires browser-intercept mode.`);
      }

      const inlineAsset = resolveInlineFontAsset(fileUrl);
      if (!inlineAsset && typeof fileUrl === "string" && /^inline-font:\/\/[a-z0-9]+$/i.test(fileUrl.trim())) {
        throw new Error(`Inline asset token missing/expired: ${fileUrl}`);
      }

      // Build headers per font so CDN-specific referer/origin rules apply.
      const perFontHeaders = inlineAsset
        ? {}
        : buildHeaders({
            fileUrl: fileUrl,
            userAgent: request.userAgent,
            metadata: isRecord(font.metadata) ? font.metadata : undefined
          });

      const metadataRecord = isRecord(font.metadata) ? font.metadata : {};
      const formatHint =
        (typeof (font as any).format === "string" && (font as any).format.trim()) ||
        (typeof metadataRecord.format === "string" && metadataRecord.format.trim()) ||
        undefined;
      const ext = inlineAsset
        ? `.${inlineAsset.format}`
        : detectExtension(fileUrl, {
            ...metadataRecord,
            ...(formatHint ? { format: formatHint } : {})
          });
      const metadataFileNameHint = resolveFileNameHint(metadataRecord.fileNameHint, ext);
      let fileName: string;
      if (inlineAsset?.fileNameHint) {
        fileName = inlineAsset.fileNameHint;
      } else if (metadataFileNameHint) {
        fileName = metadataFileNameHint;
      } else {
        try {
          const urlBasename = new URL(fileUrl).pathname.split('/').pop() || '';
          // If the URL basename is a hash or otherwise obfuscated, fallback to metadata-based naming
          if (urlBasename && urlBasename.includes('.') && !shouldApplyMetadataRepair(urlBasename)) {
            const cleaned = stripLeadingNumericPrefix(urlBasename) || urlBasename;
            fileName = cleaned;
          } else {
            throw new Error('obfuscated-or-missing');
          }
        } catch {
          const safeFamily = toSafeFileName(font.family || "unknown");
          const resolvedSubFamily = composeSubFamilyLabel(
            font.weight || "Regular",
            font.style || "Normal",
            isRecord(font.metadata) ? font.metadata.styleName : undefined
          );
          const safeSubFamily = toSafeFileName(resolvedSubFamily || "Regular");
          fileName = `${safeFamily}-${safeSubFamily}${ext}`;
        }
      }

       const filePath = ensureUniqueFilePath(outputDir, fileName);
       fileName = path.basename(filePath);
       emitLog(`[Batch Direct] downloading ${fileName}`);
       if (inlineAsset) {
         await writeFile(filePath, inlineAsset.buffer);
       } else {
         const downloadRetryBudget = resolveDownloadRetryBudget(request, request.metadata, font.metadata);
         await downloadBinary(fileUrl, filePath, perFontHeaders, downloadRetryBudget);
       }
      const fileBuffer = await readFile(filePath);
      const contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      if (seenContentHashes.has(contentHash)) {
        await unlink(filePath).catch(() => undefined);
        skipped.push({ index: i, reason: "Duplicate payload hash", name: fileName });
        continue;
      }
      seenContentHashes.add(contentHash);
      
      const item: DownloadedFile = {
        fileName,
        filePath: toRelative(filePath),
        sourceUrl: fileUrl,
        name: composeDisplayName(
          font.family,
          font.weight,
          font.style,
          font.metadata?.category,
          undefined,
          isRecord(font.metadata) ? font.metadata.styleName : undefined,
          isRecord(font.metadata) ? font.metadata.fullName : undefined
        )
      };
      downloaded.push(item);

      const fileExt = path.extname(fileName).toLowerCase();
      if (ext === ".zip" || fileExt === ".zip") {
        try {
          const zipGroupHint =
            (typeof font.family === "string" && font.family.trim()
              ? font.family
              : undefined) ||
            (isRecord(font.metadata) && typeof font.metadata.family === "string" && font.metadata.family.trim()
              ? font.metadata.family
              : undefined);
          const extractSpecimenOnlyZip = isTruthyFlag(
            isRecord(font.metadata) ? (font.metadata as any).extractSpecimenOnlyZip : undefined
          );
          const extractSpecimenPdfFromZip =
            extractSpecimenOnlyZip ||
            isTruthyFlag(isRecord(font.metadata) ? (font.metadata as any).extractSpecimenPdfFromZip : undefined);
          const zipExtractToRoot = isTruthyFlag(
            isRecord(font.metadata) ? (font.metadata as any).zipExtractToRoot : undefined
          );
          const extractedCount = await extractZipFonts({
            zipPath: filePath,
            outputDir,
            sourceUrl: fileUrl,
            downloaded,
            groupFolderHint: zipGroupHint,
            extractFonts: !extractSpecimenOnlyZip,
            extractPdfs: extractSpecimenPdfFromZip,
            extractToRoot: zipExtractToRoot
          });
          if (extractedCount <= 0) {
            console.warn(`[BATCH-ZIP] No extractable font files found in ${fileName}`);
          } else if (shouldPruneRawZipAfterExtract(font.metadata)) {
            const rawRelativePath = toRelative(filePath);
            const rawIndex = downloaded.findIndex((entry) => entry.filePath === rawRelativePath);
            if (rawIndex >= 0) downloaded.splice(rawIndex, 1);
            await unlink(filePath).catch(() => undefined);
          }
        } catch (e: any) {
          console.error(`[BATCH-ZIP] FAILED for ${fileName}:`, e.message);
        }
      }
      
      // Auto-convert web fonts to multi-format variants for parity with intercept pipeline.
      if (
        (ext === '.woff2' || ext === ".woff" || ext === ".ttf" || ext === ".otf") &&
        !shouldSkipConversion(font.metadata)
      ) {
        try {
          const { convertToMultipleFormats } = await import("./font-converter");
          const subFamily = composeSubFamilyLabel(
            font.weight || "Regular",
            font.style || "Normal",
            isRecord(font.metadata) ? font.metadata.styleName : undefined
          );
          const forceMetadataRepair = shouldForceMetadataRepair(font.metadata);
             
          const conversionMetadata =
            (forceMetadataRepair || shouldApplyMetadataRepair(path.basename(filePath))) &&
            canApplyMetadataRepair(font.family, subFamily)
              ? { family: font.family, subFamily }
              : undefined;
          const conversionOptions = {
            disableInstanceExplosion: shouldDisableInstanceExplosion(font.metadata),
            expectedInstanceCount: resolveExpectedInstanceCount(font.metadata)
          };
          const conversions = await convertToMultipleFormats(
            filePath,
            conversionMetadata,
            conversionOptions
          );
          
          const maybePushVariant = async (variantPath: string | null | undefined, suffix: string) => {
            const normalizedVariantPath = await maybeRenameConvertedNonWebVariant(variantPath);
            if (!normalizedVariantPath) return;
            const variantFileName = path.basename(normalizedVariantPath);
            if (downloaded.some((d) => d.fileName === variantFileName)) return;
            downloaded.push({
              fileName: variantFileName,
              filePath: toRelative(normalizedVariantPath),
              sourceUrl: fileUrl,
              name: composeDisplayName(
                font.family,
                font.weight,
                font.style,
                font.metadata?.category,
                suffix,
                isRecord(font.metadata) ? font.metadata.styleName : undefined,
                isRecord(font.metadata) ? font.metadata.fullName : undefined
              )
            });
          };

          await maybePushVariant(conversions.ttf, "TTF");
          await maybePushVariant(conversions.otf, "OTF");
          await maybePushVariant(conversions.woff, "WOFF");
          await maybePushVariant(conversions.woff2, "WOFF2");
          if (Array.isArray(conversions.instances)) {
            for (const instancePath of conversions.instances) {
              const normalizedInstancePath = await maybeRenameConvertedNonWebVariant(instancePath);
              if (!normalizedInstancePath) continue;
              const instanceFileName = path.basename(normalizedInstancePath);
              if (downloaded.some((d) => d.fileName === instanceFileName)) continue;
              const instanceStyle = extractGenericStyleFromFileName(instanceFileName) || "Regular";
              downloaded.push({
                fileName: instanceFileName,
                filePath: toRelative(normalizedInstancePath),
                sourceUrl: fileUrl,
                name: composeDisplayName(
                  font.family,
                  font.weight,
                  font.style,
                  font.metadata?.category,
                  "TTF",
                  instanceStyle,
                  `${font.family} ${instanceStyle}`
                )
              });
            }
          }

          const resolvedRawPath = path.resolve(filePath);
          const resolvedConvertedWoff2Path =
            typeof conversions.woff2 === "string" ? path.resolve(conversions.woff2) : "";
          const sameWoff2Path =
            Boolean(resolvedConvertedWoff2Path) &&
            (process.platform === "win32"
              ? resolvedConvertedWoff2Path.toLowerCase() === resolvedRawPath.toLowerCase()
              : resolvedConvertedWoff2Path === resolvedRawPath);
          const rawExt = path.extname(filePath).toLowerCase();
          const repairedWoff2ReplacedRaw =
            rawExt === ".woff2" &&
            Boolean(conversionMetadata) &&
            Boolean(resolvedConvertedWoff2Path) &&
            !sameWoff2Path &&
            fs.existsSync(resolvedConvertedWoff2Path);
          if (repairedWoff2ReplacedRaw) {
            const rawRelativePath = toRelative(filePath);
            const rawIndex = downloaded.findIndex((entry) => entry.filePath === rawRelativePath);
            if (rawIndex >= 0) downloaded.splice(rawIndex, 1);
            await unlink(filePath).catch(() => undefined);
          }
        } catch (e: any) {
          console.error(`[BATCH-CONVERT] FAILED for ${fileName}:`, e.message, e.stack);
        }
      }
    } catch (error: any) {
      console.error(`[BATCH] Failed item ${i}:`, error.message);
      skipped.push({ index: i, reason: error.message, name: font.family });
    } finally {
      emitProgress(i + 1, request.fonts.length);
    }
  }

  let pureSuccessLogPath: string | undefined;
  let pureSuccessAudit: Record<string, unknown> | undefined;
  try {
    emitLog("[Pure Success] running self-heal protocol...");
    const requiredFormats = resolvePureSuccessRequiredFormats(
      requestMeta,
      fontMeta,
      ...(request.fonts || []).map((font) => (isRecord(font.metadata) ? font.metadata : undefined))
    );
    const sourceLimitedFormats = resolvePureSuccessSourceLimitedFormats(
      requestMeta,
      fontMeta,
      ...(request.fonts || []).map((font) => (isRecord(font.metadata) ? font.metadata : undefined))
    );
    const pureSuccess = await runPureSuccessProtocol({
      outputDir,
      downloaded,
      foundry: foundryHint || request.source,
      family: familyHint,
      requiredFormats,
      sourceLimitedFormats
    });
    pureSuccessAudit = pureSuccess as unknown as Record<string, unknown>;
    const pureSuccessPath = path.join(outputDir, "pure-success-log.json");
    await writeFile(pureSuccessPath, JSON.stringify(pureSuccess, null, 2), "utf8");
    pureSuccessLogPath = toRelative(pureSuccessPath);
    emitLog(
      `[Pure Success] status=${pureSuccess.status} missing_before=${pureSuccess.missingFormatsBefore.length} missing_after=${pureSuccess.missingFormatsAfter.length}`
    );
  } catch {
    // best-effort
  }
  
  let validationLogPath: string | undefined;
  let analysisLogPath: string | undefined;
  let targetAudit: Record<string, unknown> | undefined;
  let qualityLogPath: string | undefined;
  let qualityAudit: Record<string, unknown> | undefined;
  let technicalQaLogPath: string | undefined;
  let technicalQaAudit: Record<string, unknown> | undefined;
  try {
    const validationTokenInputs: unknown[] = [
      familyHint,
      request.source,
      (requestMeta as any).targetUrl,
      (requestMeta as any).pageUrl,
      (fontMeta as any).targetUrl,
      (fontMeta as any).pageUrl,
      ...(request.fonts || []).map((f) => f.family),
      ...(request.fonts || []).map((f) =>
        isRecord(f.metadata) ? f.metadata.family : undefined
      ),
      ...(request.fonts || []).map((f) =>
        isRecord(f.metadata) ? (f.metadata as any).styleName : undefined
      ),
      ...(request.fonts || []).map((f) =>
        isRecord(f.metadata) ? (f.metadata as any).fullName : undefined
      ),
      ...(request.fonts || []).map((f) =>
        isRecord(f.metadata) ? (f.metadata as any).postscriptName : undefined
      )
    ];
    const validationTokens = deriveValidationTokens(validationTokenInputs);
    const validation = await runValidationLog({ outputDir, tokens: validationTokens });
    validationLogPath = toRelative(validation.outputPath);
  } catch {
    // best-effort
  }

  try {
    emitLog("[Audit] Running technical QA...");
    const requiredFormats = resolvePureSuccessRequiredFormats(
      requestMeta,
      fontMeta,
      ...(request.fonts || []).map((font) => (isRecord(font.metadata) ? font.metadata : undefined))
    );
    const sourceLimitedFormats = resolvePureSuccessSourceLimitedFormats(
      requestMeta,
      fontMeta,
      ...(request.fonts || []).map((font) => (isRecord(font.metadata) ? font.metadata : undefined))
    );
    const technicalQa = await runTechnicalQa({
      outputDir,
      requiredFormats,
      sourceLimitedFormats
    });
    technicalQaLogPath = toRelative(technicalQa.outputPath);
    technicalQaAudit = technicalQa.audit;
  } catch {
    // best-effort
  }

  try {
    const validationPathAbsolute = validationLogPath
      ? path.resolve(process.cwd(), validationLogPath)
      : path.join(outputDir, "validation-log.json");
    const quality = await runFoundryQualityAudit({
      outputDir,
      downloaded,
      validationPath: validationPathAbsolute,
      fonts: request.fonts,
      foundryHint,
      source: request.source,
      requestMeta,
      fontMeta
    });
    qualityLogPath = quality.qualityLogPath;
    qualityAudit = quality.qualityAudit;
  } catch {
    // best-effort
  }

  try {
    if (qualityAudit) {
      targetAudit = buildBatchAnalysisAuditFromQuality({
        request,
        qualityAudit,
        foundryHint,
        requestMeta,
        fontMeta
      });
      const analysisPath = path.join(outputDir, "analysis-log.json");
      await writeFile(analysisPath, JSON.stringify(targetAudit, null, 2), "utf8");
      analysisLogPath = toRelative(analysisPath);
    }
  } catch {
    // best-effort
  }

  let specimenLogPath: string | undefined;
  let specimenAudit: Record<string, unknown> | undefined;
  try {
    const includeSpecimenPdf = (() => {
      const explicit = (requestMeta as any).includeSpecimenPdf;
      if (typeof explicit === "boolean") return explicit;
      const nested = (requestMeta as any).options?.includeSpecimenPdf;
      if (typeof nested === "boolean") return nested;
      return true;
    })();

    if (includeSpecimenPdf) {
      const firstPageUrl =
        (requestMeta as any).targetUrl ||
        (requestMeta as any).pageUrl ||
        (fontMeta as any).targetUrl ||
        (fontMeta as any).pageUrl ||
        resolveBatchInterceptTargetUrl(request);

      const targetUrl = tryExtractHttpUrl(firstPageUrl) || tryExtractHttpUrl(request.source);
      if (targetUrl) {
        let host = "";
        try {
          host = new URL(targetUrl).host.toLowerCase();
        } catch {
          host = "";
        }
        const profileExpectedStyles = (() => {
          const styles = new Set<string>();
          const addMany = (value: unknown) => {
            if (!Array.isArray(value)) return;
            for (const item of value) {
              if (typeof item !== "string") continue;
              const trimmed = item.trim();
              if (trimmed) styles.add(trimmed);
            }
          };

          if (isRecord(requestMeta?.targetProfile)) addMany((requestMeta as any).targetProfile.expectedStyles);
          if (isRecord(fontMeta?.targetProfile)) addMany((fontMeta as any).targetProfile.expectedStyles);
          for (const font of request.fonts || []) {
            if (isRecord(font.metadata?.targetProfile)) addMany(font.metadata.targetProfile.expectedStyles);
          }
          return Array.from(styles);
        })();

        const expectedStyles =
          profileExpectedStyles.length > 0
            ? profileExpectedStyles
            : Array.from(
                new Set(
                  (request.fonts || [])
                    .map((font) =>
                      composeSubFamilyLabel(
                        font.weight || "Regular",
                        font.style || "Normal",
                        isRecord(font.metadata) ? font.metadata.styleName : undefined
                      )
                    )
                    .filter((style) => typeof style === "string" && style.trim().length > 0)
                )
              );
        const auditRequest = {
          mode: "browser-intercept",
          targetUrl,
          metadata: {
            ...primaryMetadata,
            targetUrl,
            pageUrl: targetUrl,
            fonts: request.fonts
          }
        } as BrowserRequest;

        specimenAudit = await collectSpecimenPdfAudit({
          request: auditRequest,
          outputDir,
          expectedStyles,
          observedStyles: expectedStyles,
          options: {
            maxPageUrls: host.includes("lineto.com") ? 8 : 24,
            maxPdfCandidates: host.includes("lineto.com") ? 10 : 24,
            pageFetchTimeoutMs: host.includes("lineto.com") ? 20000 : 45000,
            pdfFetchTimeoutMs: host.includes("lineto.com") ? 20000 : 45000,
            maxTotalMs: host.includes("lineto.com") ? 90000 : 180000
          }
        });

        if (specimenAudit) {
          const specimenPath = path.join(outputDir, "specimen-log.json");
          await writeFile(specimenPath, JSON.stringify(specimenAudit, null, 2), "utf8");
          specimenLogPath = toRelative(specimenPath);
        }
      }
    }
  } catch {
    // best-effort
  }

  // Organise font files into Berkeley-Mono-style format subfolders before ZIP packaging.
  try {
    await organizeOutputByFormat(outputDir);
  } catch {
    // best-effort — never fail a download because of organisation
  }

  // Keep absolute outputDir for ZIP packaging.
  const result: DownloadResult = {
    command: "batch-direct",
    source: request.source || "Batch Mode",
    outputDir: outputDir,
    downloadedAt: new Date().toISOString(),
    downloaded,
    skipped,
    logPath: toRelative(path.join(outputDir, "download-log.json")),
    validationLogPath,
    analysisLogPath,
    targetAudit,
    qualityLogPath,
    qualityAudit,
    specimenLogPath,
    specimenAudit,
    pureSuccessLogPath,
    pureSuccessAudit,
    technicalQaLogPath,
    technicalQaAudit
  };
  
  await writeFile(path.join(outputDir, "download-log.json"), JSON.stringify(result, null, 2));
  emitLog(`[Batch Direct] complete (downloaded=${downloaded.length}, skipped=${skipped.length})`);
  return result;
};

const getHostFromUrl = (value: string): string => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
};

export const runDownload = async (request: DownloadRequest): Promise<DownloadResult> => {
  if (request.mode === "css-url") {
    return runCssUrlDownload(request);
  }

  if (request.mode === "api-json") {
    return runApiJsonDownload(request);
  }

  if (request.mode === "direct-url") {
    return runDirectUrlDownload(request);
  }

  if (request.mode === "browser-intercept") {
    const emitLog = (message: string) => {
      if (typeof request.onProgress !== "function") return;
      request.onProgress({ type: "log", message });
    };
    const directFonts = extractDirectFontsFromBrowserRequest(request);
    const hasInterceptPlaceholder = (() => {
      if (!isRecord(request.metadata)) return false;
      const rawFonts = Array.isArray((request.metadata as any).fonts) ? (request.metadata as any).fonts : [];
      return rawFonts.some((raw: unknown) => isRecord(raw) && isInterceptPlaceholderUrl((raw as any).url));
    })();
    const host = getHostFromUrl(request.targetUrl);
    const shouldPreferDirect = /(^|\.)abcdinamo\.com$/i.test(host);
    const allowBatchDirect = directFonts.length > 0 && (!hasInterceptPlaceholder || shouldPreferDirect);
    const runIntercept = async (): Promise<DownloadResult> =>
      runBrowserIntercept({
        targetUrl: request.targetUrl,
        outputFolder: request.outputFolder,
        expectedCount: request.expectedCount,
        injectScript: request.injectScript,
        masterFoundry: (request as any).masterFoundry, // Forward the flag
        metadata: request.metadata,
        mode: "browser-intercept",
        onProgress: request.onProgress
      });

    const runFreshBatchRetry = async (): Promise<DownloadResult | undefined> => {
      const host = getHostFromUrl(request.targetUrl);
      if (!host.includes("typefaces.pizza")) return undefined;

      try {
        const { scrapers } = await import("@/lib/scrapers");
        const scraper = scrapers.find((item) => item.canHandle(request.targetUrl));
        if (!scraper) return undefined;

        const refreshed = await scraper.scrape(request.targetUrl);
        const refreshedTargetUrl = refreshed.targetUrl || request.targetUrl;
        const refreshedMetadata = {
          ...(isRecord(request.metadata) ? request.metadata : {}),
          ...(isRecord(refreshed.metadata) ? refreshed.metadata : {}),
          targetUrl: refreshedTargetUrl,
          fonts: refreshed.fonts
        };
        const refreshedDirectFonts = extractDirectFontsFromBrowserRequest({
          ...request,
          mode: "browser-intercept",
          targetUrl: refreshedTargetUrl,
          metadata: refreshedMetadata
        } as BrowserInterceptLikeRequest);

        if (refreshedDirectFonts.length === 0) return undefined;

        console.warn(
          `[Protocol Switch] retrying batch-direct with fresh scraper payload (target=${refreshedTargetUrl}, direct=${refreshedDirectFonts.length}).`
        );
        return runBatchDirectDownload({
          mode: "batch-direct",
          fonts: refreshedDirectFonts,
          source: request.source?.trim() || new URL(refreshedTargetUrl).host,
          outputFolder: request.outputFolder,
          metadata: refreshedMetadata,
          licenseId: request.licenseId,
          licenseProof: request.licenseProof,
          onProgress: request.onProgress
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn("[Protocol Switch] fresh-scrape batch retry failed (" + reason + ").");
        return undefined;
      }
    };

    if (directFonts.length > 0 && allowBatchDirect) {
      const source = request.source?.trim() || new URL(request.targetUrl).host;
      emitLog(`[Protocol] direct URLs detected (${directFonts.length}). attempting batch-direct.`);
      console.log(
        `[Protocol Switch] browser-intercept -> batch-direct (${directFonts.length} direct URLs detected, target=${request.targetUrl})`
      );
      const batchRequest: BatchDirectRequest = {
        mode: "batch-direct",
        fonts: directFonts,
        source,
        outputFolder: request.outputFolder,
        metadata: {
          ...(isRecord(request.metadata) ? request.metadata : {}),
          targetUrl: request.targetUrl
        },
        licenseId: request.licenseId,
        licenseProof: request.licenseProof,
        onProgress: request.onProgress
      };

      try {
        const batchResult = await runBatchDirectDownload(batchRequest);
        if (
          shouldFallbackToBrowserIntercept({
            targetUrl: request.targetUrl,
            directFonts,
            batchResult
          })
        ) {
          const refreshed = await runFreshBatchRetry();
          if (refreshed) return refreshed;

          console.warn(
            `[Protocol Switch] batch-direct had fetch-like skips, falling back to browser-intercept (target=${request.targetUrl}).`
          );
          emitLog(`[Protocol] batch-direct had fetch-like skips. falling back to browser-intercept.`);
          return runIntercept();
        }
        return batchResult;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const shouldFallback = shouldFallbackAfterBatchDirectError({
          targetUrl: request.targetUrl,
          directFonts,
          errorReason: reason
        });

        if (!shouldFallback) throw error;

        const refreshed = await runFreshBatchRetry();
        if (refreshed) return refreshed;

        console.warn(
          `[Protocol Switch] batch-direct failed (${reason}). Falling back to browser-intercept (target=${request.targetUrl}).`
        );
        emitLog(`[Protocol] batch-direct failed (${reason}). falling back to browser-intercept.`);
        return runIntercept();
      }
    }

    if (directFonts.length > 0 && hasInterceptPlaceholder && !shouldPreferDirect) {
      emitLog(
        `[Protocol] direct URLs present (${directFonts.length}) but placeholders detected. staying in browser-intercept for completeness.`
      );
    }

    return await runIntercept();
  }

  if (request.mode === "batch-direct") {
    const hasInterceptPlaceholder = request.fonts.some((font) => isInterceptPlaceholderUrl(font.url));
    if (hasInterceptPlaceholder) {
      const targetUrl = resolveBatchInterceptTargetUrl(request);
      if (!targetUrl) {
        throw new Error(
          "Batch payload contains intercept placeholders but missing a valid target URL (`source` or `metadata.pageUrl`)."
        );
      }

      console.log(`[Protocol Switch] Rerouting batch-direct placeholders to Browser Intercept for: ${targetUrl}`);

      const metadata = isRecord(request.metadata) ? request.metadata : {};
      const masterFoundryEnabled = (request as any).masterFoundry === true || (metadata as any).masterFoundry === true;
      return runBrowserIntercept({
        mode: "browser-intercept",
        targetUrl,
        outputFolder: request.outputFolder,
        expectedCount: Math.max(1, request.fonts.length),
        masterFoundry: masterFoundryEnabled,
        injectScript: typeof (request as any).injectScript === "string" ? (request as any).injectScript : undefined,
        metadata: {
          ...metadata,
          masterFoundry: masterFoundryEnabled,
          fonts: request.fonts
        }
      });
    }

    return runBatchDirectDownload(request);
  }

  throw new Error("Unsupported download mode.");
};







