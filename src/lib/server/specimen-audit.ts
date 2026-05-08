import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import type { BrowserRequest } from "@/lib/downloader-protocol";
import { joinOpaquePath } from "@/lib/server/opaque-path";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const NODE_REQUIRE = createRequire(import.meta.url);

type PdfCandidate = {
  url: string;
  suggestedFileName?: string;
};

const STYLE_WORDS =
  "(?:air|thin|extralight|extra light|ultralight|ultra light|light|regular|book|retina|medium|semibold|semi bold|demibold|demi bold|bold|extrabold|extra bold|black|heavy|super)";
const WIDTH_WORDS = "(?:condensed|narrow|normal|text|display|mono|soft|extended)";
const FEATURE_TAG_RE =
  /\b(ss\d{2}|cv\d{2}|liga|dlig|calt|salt|onum|lnum|pnum|tnum|frac|afrc|sups|subs|smcp|c2sc|case|ordn|kern|zero)\b/gi;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");

const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const normalizeStyleCoverageToken = (value: string): string => {
  let token = normalizeToken(value);
  if (!token) return token;

  // Treat generic italic/oblique as regular italic in coverage comparisons.
  if (token === "italic" || token === "oblique" || token === "regularoblique") {
    return "regularitalic";
  }
  if (token.endsWith("oblique")) {
    token = `${token.slice(0, -7)}italic`;
  }
  return token;
};

const toPascalCase = (value: string): string =>
  value
    .split(/[^a-z0-9]+/gi)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

const isLikelyPdfBuffer = (buffer: Buffer): boolean => buffer.subarray(0, 5).toString("ascii") === "%PDF-";

const normalizeStyleLabel = (value: string): string => {
  const compact = value
    .replace(/semi\s*-?\s*bold/gi, "Semibold")
    .replace(/demi\s*-?\s*bold/gi, "Semibold")
    .replace(/extra\s*-?\s*light/gi, "Extralight")
    .replace(/extra\s*-?\s*bold/gi, "Extrabold")
    .replace(/ultra\s*-?\s*light/gi, "Extralight")
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) return compact;
  return compact
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const toSafeFileName = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "specimen";
};

const decodeMojibakeLatin1Utf8 = (value: string): string => {
  if (!/[\u00C2\u00C3][\x80-\xBF]/.test(value)) return value;
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
};

const parseContentDispositionFileName = (headerValue: string | null | undefined): string | undefined => {
  if (!headerValue || typeof headerValue !== "string") return undefined;

  const pick = (raw: string): string | undefined => {
    const trimmed = raw.trim().replace(/^UTF-8''/i, "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!trimmed) return undefined;
    let decoded = trimmed;
    try {
      decoded = decodeURIComponent(trimmed);
    } catch {
      // best-effort
    }
    decoded = decodeHtmlEntities(decoded);
    decoded = decodeMojibakeLatin1Utf8(decoded);
    return decoded.trim() || undefined;
  };

  const filenameStar = headerValue.match(/filename\*\s*=\s*([^;]+)/i);
  if (filenameStar?.[1]) {
    const resolved = pick(filenameStar[1]);
    if (resolved) return resolved;
  }

  const filename = headerValue.match(/filename\s*=\s*([^;]+)/i);
  if (filename?.[1]) {
    const resolved = pick(filename[1]);
    if (resolved) return resolved;
  }

  return undefined;
};

const isLikelyOpaquePdfStem = (stem: string): boolean => {
  const token = stem.trim().toLowerCase();
  if (!token) return true;
  if (/^pdf-[a-f0-9]{16,}$/.test(token)) return true;
  if (/^[a-f0-9]{16,}$/.test(token)) return true;
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) return true;
  if (/^(download|file|document|specimen)$/i.test(token)) return true;
  return false;
};

const deriveRequestFamilyLabel = (request: BrowserRequest): string | undefined => {
  const candidates: unknown[] = [];
  if (isRecord(request.metadata)) {
    candidates.push(request.metadata.family);
    if (isRecord(request.metadata.targetProfile)) {
      candidates.push(request.metadata.targetProfile.familyDisplay, request.metadata.targetProfile.family);
    }
    const fonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
    for (const font of fonts) {
      if (!isRecord(font)) continue;
      candidates.push(font.family);
      if (isRecord(font.metadata)) {
        candidates.push(font.metadata.family);
      }
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (/^(unknown|font|family)$/i.test(trimmed)) continue;
    return trimmed;
  }

  return undefined;
};

const SPECIMEN_GENERIC_WORDS = new Set([
  "font",
  "fonts",
  "type",
  "typeface",
  "typefaces",
  "family",
  "families",
  "product",
  "products",
  "shop",
  "buy",
  "trial",
  "download",
  "specimen",
  "pdf"
]);

const SPECIMEN_DESCRIPTOR_WORDS = new Set([
  "font",
  "fonts",
  "guide",
  "fontguide",
  "specimen",
  "brochure",
  "catalog",
  "catalogue",
  "trial",
  "manual",
  "technical",
  "tech",
  "doc",
  "techdoc",
  "documentation",
  "character",
  "characters",
  "charset",
  "set",
  "glyph",
  "glyphs",
  "preview",
  "booklet",
  "sheet",
  "pdf",
  "download",
  "file"
]);

const asTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const safeDecodeUriComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const splitNormalizedWords = (value: string): string[] => {
  const cleaned = decodeHtmlEntities(safeDecodeUriComponent(value))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_/]+/g, " ");

  return cleaned
    .split(/[^A-Za-z0-9]+/)
    .map((part) => normalizeToken(part))
    .filter(Boolean);
};

const familyWordsToToken = (words: string[]): string => words.join("");

const isMeaningfulFamilyWords = (words: string[]): boolean => {
  if (words.length === 0) return false;
  const filtered = words.filter((word) => !SPECIMEN_GENERIC_WORDS.has(word));
  if (filtered.length === 0) return false;
  return familyWordsToToken(filtered).length >= 4;
};

type PdfStemInfo = {
  stemToken: string;
  stemWords: string[];
  familyWords: string[];
  familyToken: string;
};

const derivePdfStemInfo = (rawName: string): PdfStemInfo | undefined => {
  const decodedName = safeDecodeUriComponent(rawName);
  const baseName = path.basename(decodedName);
  const stem = baseName.replace(/\.pdf$/i, "");
  if (!stem) return undefined;

  const stemWords = splitNormalizedWords(stem);
  const stemToken = normalizeToken(stem);
  if (!stemToken) return undefined;

  let splitIndex = stemWords.length;
  for (let index = 0; index < stemWords.length; index += 1) {
    const word = stemWords[index];
    if (SPECIMEN_DESCRIPTOR_WORDS.has(word) || /^v(?:er(?:sion)?)?\d+$/i.test(word) || /^\d+$/.test(word)) {
      splitIndex = index;
      break;
    }
  }

  const familyWords = (splitIndex > 0 ? stemWords.slice(0, splitIndex) : stemWords).slice();
  while (familyWords.length > 0) {
    const last = familyWords[familyWords.length - 1];
    if (/^v(?:er(?:sion)?)?\d+$/i.test(last) || /^\d+$/.test(last)) {
      familyWords.pop();
      continue;
    }
    break;
  }

  return {
    stemToken,
    stemWords,
    familyWords,
    familyToken: familyWordsToToken(familyWords)
  };
};

const derivePdfStemInfoFromUrl = (url: string): PdfStemInfo | undefined => {
  try {
    const parsed = new URL(url);
    const baseName = path.basename(parsed.pathname || "");
    if (!baseName) return undefined;
    return derivePdfStemInfo(baseName);
  } catch {
    return undefined;
  }
};

const extractLikelySlugWordsFromUrl = (rawUrl: string): string[][] => {
  const sequences: string[][] = [];
  try {
    const parsed = new URL(rawUrl);
    const pathSegments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => safeDecodeUriComponent(segment));

    if (pathSegments.length > 0) {
      sequences.push(splitNormalizedWords(pathSegments[pathSegments.length - 1]));
    }

    const markerTokens = new Set(["font", "fonts", "typeface", "typefaces", "family", "families", "product", "products"]);
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
      const marker = normalizeToken(pathSegments[index]);
      if (!markerTokens.has(marker)) continue;
      sequences.push(splitNormalizedWords(pathSegments[index + 1]));
    }
  } catch {
    // ignore malformed URL
  }
  return sequences;
};

const collectTargetFamilyHintValues = (request: BrowserRequest): string[] => {
  const out: string[] = [];
  const add = (value: unknown) => {
    const text = asTrimmedString(value);
    if (text) out.push(text);
  };
  const addMany = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) add(item);
  };

  add(request.targetUrl);

  if (!isRecord(request.metadata)) return out;

  add(request.metadata.family);
  add(request.metadata.familyPostscript);
  add(request.metadata.postscriptName);
  add(request.metadata.slug);
  add(request.metadata.pageUrl);
  add(request.metadata.targetUrl);
  add(request.metadata.originalUrl);

  if (isRecord(request.metadata.targetProfile)) {
    add(request.metadata.targetProfile.family);
    add(request.metadata.targetProfile.familyDisplay);
    add(request.metadata.targetProfile.familyPostscript);
    add(request.metadata.targetProfile.postscriptName);
    add(request.metadata.targetProfile.familySlug);
    add(request.metadata.targetProfile.slug);
    add(request.metadata.targetProfile.pageUrl);
    add(request.metadata.targetProfile.targetUrl);
    addMany(request.metadata.targetProfile.expectedPostscriptNames);
    addMany(request.metadata.targetProfile.sessionPostscriptNames);
  }

  const fonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
  for (const font of fonts) {
    if (!isRecord(font)) continue;
    add(font.family);
    if (!isRecord(font.metadata)) continue;

    add(font.metadata.family);
    add(font.metadata.familyPostscript);
    add(font.metadata.postscriptName);
    add(font.metadata.familySlug);
    add(font.metadata.slug);
    add(font.metadata.pageUrl);
    add(font.metadata.targetUrl);
    add(font.metadata.originalUrl);

    if (isRecord(font.metadata.targetProfile)) {
      add(font.metadata.targetProfile.family);
      add(font.metadata.targetProfile.familyDisplay);
      add(font.metadata.targetProfile.familyPostscript);
      add(font.metadata.targetProfile.postscriptName);
      add(font.metadata.targetProfile.familySlug);
      add(font.metadata.targetProfile.slug);
      add(font.metadata.targetProfile.pageUrl);
      add(font.metadata.targetProfile.targetUrl);
      addMany(font.metadata.targetProfile.expectedPostscriptNames);
      addMany(font.metadata.targetProfile.sessionPostscriptNames);
    }
  }

  return out;
};

type TargetFamilyMatchers = {
  familyTokens: string[];
  familyWordSequences: string[][];
};

const deriveTargetFamilyMatchers = (request: BrowserRequest, metadataSeedUrls: string[]): TargetFamilyMatchers => {
  const sequenceMap = new Map<string, string[]>();
  const tokenSet = new Set<string>();

  const addSequence = (words: string[]) => {
    const filtered = words.filter((word) => !SPECIMEN_GENERIC_WORDS.has(word));
    if (!isMeaningfulFamilyWords(filtered)) return;
    const sequenceKey = filtered.join("-");
    if (!sequenceMap.has(sequenceKey)) {
      sequenceMap.set(sequenceKey, filtered);
    }
    tokenSet.add(familyWordsToToken(filtered));
  };

  for (const hint of collectTargetFamilyHintValues(request)) {
    if (/^https?:\/\//i.test(hint)) {
      for (const words of extractLikelySlugWordsFromUrl(hint)) addSequence(words);
      continue;
    }
    addSequence(splitNormalizedWords(hint));
  }

  for (const seedUrl of metadataSeedUrls) {
    const seedInfo = derivePdfStemInfoFromUrl(seedUrl);
    if (!seedInfo) continue;
    if (seedInfo.familyWords.length > 0) {
      addSequence(seedInfo.familyWords);
      continue;
    }
    addSequence(seedInfo.stemWords);
  }

  const familyWordSequences = Array.from(sequenceMap.values()).sort(
    (left, right) => familyWordsToToken(right).length - familyWordsToToken(left).length
  );
  const familyTokens = Array.from(tokenSet).sort((left, right) => right.length - left.length);

  return {
    familyTokens,
    familyWordSequences
  };
};

const matchesFamilyTokenWithAllowedSuffix = (candidateToken: string, targetToken: string): boolean => {
  if (!candidateToken || !targetToken) return false;
  if (candidateToken === targetToken) return true;
  if (!candidateToken.startsWith(targetToken)) return false;
  const suffix = candidateToken.slice(targetToken.length);
  if (!suffix) return true;
  return /^(?:font|guide|fontguide|specimen|brochure|catalog|catalogue|trial|manual|technical|tech|doc|techdoc|documentation|character|characters|charset|set|glyph|glyphs|preview|booklet|sheet|pdf|download|file|v(?:er(?:sion)?)?\d+|\d)/i.test(
    suffix
  );
};

const isPdfCandidateRelevant = (candidate: PdfCandidate, matchers: TargetFamilyMatchers): boolean => {
  if (matchers.familyTokens.length === 0 && matchers.familyWordSequences.length === 0) return true;

  const stemInfos = [
    derivePdfStemInfoFromUrl(candidate.url),
    candidate.suggestedFileName ? derivePdfStemInfo(candidate.suggestedFileName) : undefined
  ].filter((value): value is PdfStemInfo => Boolean(value));

  if (stemInfos.length === 0) return false;

  for (const info of stemInfos) {
    for (const targetWords of matchers.familyWordSequences) {
      if (targetWords.length === 0 || info.familyWords.length !== targetWords.length) continue;
      let allMatch = true;
      for (let index = 0; index < targetWords.length; index += 1) {
        if (info.familyWords[index] !== targetWords[index]) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return true;
    }

    const candidateTokens = [info.familyToken, info.stemToken].filter(Boolean);
    for (const targetToken of matchers.familyTokens) {
      for (const candidateToken of candidateTokens) {
        if (matchesFamilyTokenWithAllowedSuffix(candidateToken, targetToken)) {
          return true;
        }
      }
    }
  }

  return false;
};

const isTrustedOpaquePdfCandidate = (candidate: PdfCandidate, targetUrl: string): boolean => {
  try {
    const parsed = new URL(candidate.url);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (/^(?:.+\.)?205\.tf$/.test(host) && /^\/data\/pdf-[a-f0-9]{16,}\.pdf$/i.test(pathname)) {
      return true;
    }

    if (host === "store.mass-driver.com" && /^\/pdfs\/[a-z0-9-]+$/i.test(pathname)) {
      return true;
    }

    if (
      host.endsWith("cloudfront.net") &&
      /^\/media\/documents\/.+\.pdf$/i.test(pathname)
    ) {
      return true;
    }

    const targetHost = new URL(targetUrl).hostname.toLowerCase();
    if (host === targetHost && /\/pdfs\/[a-z0-9-]+(?:$|\/)/i.test(pathname)) {
      return true;
    }
  } catch {
    // ignore malformed URL candidates
  }

  return false;
};

const fetchTextWithTimeout = async (
  url: string,
  timeoutMs = 30000,
  headers?: Record<string, string>
): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

const fetchPdfWithTimeout = async (
  url: string,
  timeoutMs = 30000,
  headers?: Record<string, string>
): Promise<{ buffer: Buffer; contentDisposition?: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: "follow"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentDisposition: res.headers.get("content-disposition") || undefined
    };
  } finally {
    clearTimeout(timer);
  }
};

const extractFallbackTextFromPdfBytes = (buffer: Buffer): string => {
  // Best-effort fallback when a full PDF parser is unavailable on this runtime.
  const raw = buffer.toString("latin1");
  const snippets: string[] = [];
  const add = (value: string) => {
    const clean = value.replace(/\\[nrtbf()\\]/g, " ").replace(/\s+/g, " ").trim();
    if (clean.length >= 2 && clean.length <= 120) snippets.push(clean);
  };

  for (const match of raw.matchAll(/\(([^()]{2,120})\)/g)) {
    add(String(match[1] || ""));
    if (snippets.length >= 5000) break;
  }
  for (const match of raw.matchAll(/\/([A-Za-z][A-Za-z0-9._-]{1,80})/g)) {
    add(String(match[1] || ""));
    if (snippets.length >= 6000) break;
  }

  return snippets.join(" ");
};

const parsePdfText = async (
  buffer: Buffer
): Promise<{ text: string; pageCount?: number; parserError?: string; parserMode: "pdf-parse" | "fallback-byte-scan" }> => {
  const tryParse = async (
    mod: Record<string, unknown>
  ): Promise<{ text: string; pageCount?: number; parserMode: "pdf-parse" } | undefined> => {
    const PDFParseCtor = mod.PDFParse as (new (params: { data: Uint8Array }) => any) | undefined;

    if (typeof PDFParseCtor === "function") {
      const parser = new PDFParseCtor({ data: new Uint8Array(buffer) });
      try {
        const parsed = await parser.getText();
        const text = typeof parsed?.text === "string" ? parsed.text : "";
        const total = typeof parsed?.total === "number" && Number.isFinite(parsed.total) ? parsed.total : undefined;
        return { text, pageCount: total, parserMode: "pdf-parse" };
      } finally {
        await parser.destroy?.();
      }
    }

    const legacyDefault = mod.default as ((input: Buffer) => Promise<any>) | undefined;
    if (typeof legacyDefault === "function") {
      const parsed = await legacyDefault(buffer);
      const text = typeof parsed?.text === "string" ? parsed.text : "";
      const pageCount =
        typeof parsed?.numpages === "number" && Number.isFinite(parsed.numpages)
          ? parsed.numpages
          : typeof parsed?.numrender === "number" && Number.isFinite(parsed.numrender)
            ? parsed.numrender
            : undefined;
      return { text, pageCount, parserMode: "pdf-parse" };
    }

    return undefined;
  };

  try {
    // Use native runtime import first so bundlers do not rewrite this to browser entrypoints.
    const runtimeImport = Function("s", "return import(s);") as (specifier: string) => Promise<Record<string, unknown>>;
    const runtimeModule = await runtimeImport("pdf-parse");
    const parsedFromRuntime = await tryParse(runtimeModule);
    if (parsedFromRuntime) return parsedFromRuntime;

    // Fallback to official Node export for environments where dynamic import interop is unstable.
    const cjsModule = NODE_REQUIRE("pdf-parse/node") as Record<string, unknown>;
    const parsedFromCjs = await tryParse(cjsModule);
    if (parsedFromCjs) return parsedFromCjs;

    const fallbackText = extractFallbackTextFromPdfBytes(buffer);
    return {
      text: fallbackText,
      parserMode: "fallback-byte-scan",
      parserError: "Unsupported pdf-parse module shape."
    };
  } catch (error) {
    // Last attempt with official Node export in case runtime import failed before module resolution.
    try {
      const cjsModule = NODE_REQUIRE("pdf-parse/node") as Record<string, unknown>;
      const parsedFromCjs = await tryParse(cjsModule);
      if (parsedFromCjs) return parsedFromCjs;
    } catch {
      // ignore and fallback below
    }
    const fallbackText = extractFallbackTextFromPdfBytes(buffer);
    return {
      text: fallbackText,
      parserMode: "fallback-byte-scan",
      parserError: error instanceof Error ? error.message : String(error)
    };
  }
};

const deriveLinetoTechnicalUrls = (seedUrls: string[]): string[] => {
  const out = new Set<string>();
  for (const rawUrl of seedUrls) {
    try {
      const parsed = new URL(rawUrl);
      if (!parsed.hostname.toLowerCase().includes("lineto.com")) continue;

      const parts = parsed.pathname.split("/").filter(Boolean);
      const typefacesIndex = parts.findIndex((segment) => segment.toLowerCase() === "typefaces");
      if (typefacesIndex < 0) continue;

      const slug = parts[typefacesIndex + 1];
      if (!slug) continue;

      const isTechnical = parts.some((segment) => segment.toLowerCase() === "technical");
      if (isTechnical) continue;

      const localePrefix = parts.slice(0, typefacesIndex);
      const technicalPath = `/${[...localePrefix, "typefaces", slug, "technical"].join("/")}`;
      out.add(`${parsed.origin}${technicalPath}`);
    } catch {
      // ignore malformed URL
    }
  }
  return Array.from(out);
};

const collectCandidatePages = (request: BrowserRequest): string[] => {
  const urls = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const parsed = new URL(trimmed);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !isLikelySpecimenPdfUrl(parsed.href)) {
        urls.add(parsed.href);
      }
    } catch {
      // ignore malformed URL
    }
  };
  const addMany = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) add(item);
  };

  add(request.targetUrl);
  if (isRecord(request.metadata)) {
    add(request.metadata.pageUrl);
    add(request.metadata.targetUrl);
    add(request.metadata.originalUrl);
    addMany(request.metadata.collectionUrls);
    addMany(request.metadata.collectionFamilyUrls);

    addMany(request.metadata.specimenPdfUrls);
    if (isRecord(request.metadata.targetProfile)) {
      addMany(request.metadata.targetProfile.specimenPdfUrls);
    }

    const fonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
    for (const font of fonts) {
      if (!isRecord(font) || !isRecord(font.metadata)) continue;
      add(font.metadata.pageUrl);
      add(font.metadata.targetUrl);
      add(font.metadata.originalUrl);
      addMany(font.metadata.collectionUrls);
      addMany(font.metadata.collectionFamilyUrls);
      addMany(font.metadata.specimenPdfUrls);
      if (isRecord(font.metadata.targetProfile)) {
        addMany(font.metadata.targetProfile.specimenPdfUrls);
      }
    }
  }

  for (const technicalUrl of deriveLinetoTechnicalUrls(Array.from(urls))) {
    urls.add(technicalUrl);
  }

  return Array.from(urls).slice(0, 24);
};

const isLikelySpecimenPdfUrl = (href: string): boolean => {
  if (/\.pdf(?:$|\?)/i.test(href)) return true;
  if (/\/pdfs\/[a-z0-9-]+(?:$|[/?#])/i.test(href)) return true;
  return false;
};

const extractPdfUrlsFromHtml = (html: string, pageUrl: string): string[] => {
  const out = new Set<string>();
  const add = (raw: string) => {
    if (!raw) return;
    const decoded = decodeHtmlEntities(raw.trim().replace(/\\\//g, "/"));
    try {
      const resolved = /^https?:\/\//i.test(decoded)
        ? new URL(decoded)
        : decoded.startsWith("//")
          ? new URL(`https:${decoded}`)
          : new URL(decoded, pageUrl);
      if (!isLikelySpecimenPdfUrl(resolved.href)) return;
      out.add(resolved.href);
    } catch {
      // ignore malformed candidates
    }
  };

  const patterns = [
    /https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi,
    /["'](\/\/[^"'<>]+?\.pdf(?:\?[^"'<>]*)?)["']/gi,
    /["'](\/[^"'<>]+?\.pdf(?:\?[^"'<>]*)?)["']/gi,
    /\\"(https?:\/\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi,
    /\\"(\/\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi,
    /\\"(\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi,
    /https?:\/\/[^\s"'<>]+?\/pdfs\/[a-z0-9-]+(?:\?[^\s"'<>]*)?/gi,
    /["'](\/\/[^"'<>]+?\/pdfs\/[a-z0-9-]+(?:\?[^"'<>]*)?)["']/gi,
    /["'](\/[^"'<>]+?\/pdfs\/[a-z0-9-]+(?:\?[^"'<>]*)?)["']/gi,
    /\"(https?:\/\/[^\"]+?\/pdfs\/[a-z0-9-]+(?:\?[^\"]*)?)\"/gi,
    /\"(\/\/[^\"]+?\/pdfs\/[a-z0-9-]+(?:\?[^\"]*)?)\"/gi,
    /\"(\/[^\"]+?\/pdfs\/[a-z0-9-]+(?:\?[^\"]*)?)\"/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      add(String(match[1] || match[0] || ""));
    }
  }

  return Array.from(out);
};

const extractLinetoTechnicalPdfCandidates = (html: string, pageUrl: string): PdfCandidate[] => {
  let parsedPage: URL;
  try {
    parsedPage = new URL(pageUrl);
  } catch {
    return [];
  }

  const host = parsedPage.hostname.toLowerCase();
  if (!host.includes("lineto.com")) return [];
  if (!/\/technical(?:[/?#]|$)/i.test(parsedPage.pathname)) return [];

  const slugMatch = parsedPage.pathname.match(/\/typefaces\/([^/?#]+)/i);
  const slug = slugMatch?.[1] || "";
  const familyPrefixToken = normalizeToken(`${toPascalCase(slug)}LL`);

  const allEntries: Array<{ id: number; postscriptName: string }> = [];
  const entryPattern = /"postscriptName":\d+,[^{}]*?\},(\d+),"[^"]+","([^"]+)"/g;
  for (const match of html.matchAll(entryPattern)) {
    const id = Number(match[1] || "");
    const postscriptName = String(match[2] || "").trim();
    if (!Number.isFinite(id) || id <= 0 || !postscriptName) continue;
    allEntries.push({ id, postscriptName });
  }
  if (allEntries.length === 0) return [];

  const prefixMatched = familyPrefixToken
    ? allEntries.filter((entry) => normalizeToken(entry.postscriptName).startsWith(familyPrefixToken))
    : [];
  const selected = prefixMatched.length > 0 ? prefixMatched : allEntries;

  const deduped = new Map<number, string>();
  for (const entry of selected) {
    if (!deduped.has(entry.id)) deduped.set(entry.id, entry.postscriptName);
  }

  const out: PdfCandidate[] = [];
  for (const [id, postscriptName] of deduped.entries()) {
    out.push({
      url: `${parsedPage.origin}/api/front/font-cuts/${id}/tech-doc-pdf`,
      suggestedFileName: `${postscriptName}.pdf`
    });
  }
  return out;
};

const extractStyleCandidates = (text: string): string[] => {
  const normalized = text.replace(/[\/|]+/g, " ").replace(/\s+/g, " ");
  const out = new Set<string>();

  const spacedPattern = new RegExp(
    `\\b(?:(${WIDTH_WORDS})\\s+)?(${STYLE_WORDS})(?:\\s+(italic|oblique))?\\b`,
    "gi"
  );
  for (const match of normalized.matchAll(spacedPattern)) {
    const width = (match[1] || "").trim();
    const weight = (match[2] || "").trim();
    const italic = (match[3] || "").trim();
    const label = [width, weight, italic].filter(Boolean).join(" ");
    if (!label) continue;
    out.add(normalizeStyleLabel(label));
  }

  // Handle concatenated style names (e.g. "CondensedSemiboldItalic").
  const compactPattern = /\b(?:Condensed|Narrow|Normal|Text|Display|Mono|Soft|Extended)?(?:Thin|Extralight|Light|Regular|Book|Medium|Semibold|Bold|Extrabold|Black|Heavy)(?:Italic|Oblique)?\b/g;
  for (const raw of normalized.match(compactPattern) || []) {
    const split = raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    if (!split) continue;
    out.add(normalizeStyleLabel(split));
  }

  // Some specimens list the regular italic as just "Italic" (without "Regular").
  // If we already saw "Regular" and the PDF text mentions italic/oblique, ensure
  // we emit a generic Italic candidate so coverage tokens include regularitalic.
  if (out.has("Regular")) {
    const mentionsItalic = /\b(?:italic|oblique)\b/i.test(normalized);
    const hasRegularItalic = out.has("Italic") || out.has("Regular Italic") || out.has("Regular Oblique");
    if (mentionsItalic && !hasRegularItalic) {
      out.add("Italic");
    }
  }

  return Array.from(out).sort();
};

const extractFeatureTags = (text: string): string[] => {
  const out = new Set<string>();
  for (const match of text.matchAll(FEATURE_TAG_RE)) {
    const tag = String(match[1] || "").toLowerCase();
    if (tag) out.add(tag);
  }
  return Array.from(out).sort();
};

const extractLanguageHints = (text: string): string[] => {
  const candidates = [
    "latin",
    "cyrillic",
    "greek",
    "arabic",
    "hebrew",
    "thai",
    "hangul",
    "korean",
    "vietnamese",
    "japanese",
    "chinese",
    "devanagari"
  ];
  const tokenized = normalizeToken(text);
  const out: string[] = [];
  for (const candidate of candidates) {
    if (tokenized.includes(normalizeToken(candidate))) out.push(candidate);
  }
  return out;
};

const collectCoverageTokens = (value: string): string[] => {
  const out = new Set<string>();
  const add = (candidate: string) => {
    const token = normalizeStyleCoverageToken(candidate);
    if (token) out.add(token);
  };

  const normalized = normalizeStyleLabel(value);
  if (normalized) add(normalized);
  add(value);

  for (const candidate of extractStyleCandidates(normalized || value)) {
    add(candidate);
  }

  return Array.from(out);
};

const SPECIMEN_VARIANT_NUMBER_WORDS = new Set([
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen"
]);

const specimenMentionsTargetFamily = (text: string, matchers: TargetFamilyMatchers): boolean => {
  const normalizedWords = splitNormalizedWords(text);
  if (normalizedWords.length === 0) return false;
  const joined = normalizedWords.join(" ");
  const collapsed = familyWordsToToken(normalizedWords);

  for (const sequence of matchers.familyWordSequences) {
    const phrase = sequence.join(" ");
    if (phrase && joined.includes(phrase)) return true;
  }

  return matchers.familyTokens.some((token) => token && collapsed.includes(token));
};

const extractExpectedStyleTailWords = (styleLabel: string, matchers: TargetFamilyMatchers): string[] => {
  const words = splitNormalizedWords(styleLabel);
  for (const familyWords of matchers.familyWordSequences) {
    if (familyWords.length === 0 || words.length <= familyWords.length) continue;
    let allMatch = true;
    for (let index = 0; index < familyWords.length; index += 1) {
      if (words[index] !== familyWords[index]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return words.slice(familyWords.length);
  }
  return words;
};

const isStructuredVariantTail = (words: string[]): boolean => {
  if (words.length === 0) return false;
  return words.every(
    (word) => /^\d+$/.test(word) || word.length === 1 || SPECIMEN_VARIANT_NUMBER_WORDS.has(word)
  );
};

const shouldRelaxSpecimenCoverageWarning = (params: {
  expectedStyles: string[];
  matchers: TargetFamilyMatchers;
  downloadedPdfCount: number;
  styleCandidateCount: number;
  familyMentionedInSpecimen: boolean;
}): boolean => {
  const { expectedStyles, matchers, downloadedPdfCount, styleCandidateCount, familyMentionedInSpecimen } = params;
  if (downloadedPdfCount === 0 || styleCandidateCount > 0 || !familyMentionedInSpecimen) return false;
  if (matchers.familyTokens.some((token) => token.includes("icons"))) return true;
  if (expectedStyles.length >= 16) return true;
  return expectedStyles.length > 0 && expectedStyles.every((style) => isStructuredVariantTail(extractExpectedStyleTailWords(style, matchers)));
};

const buildCoverage = (params: {
  expectedStyles: string[];
  observedStyles: string[];
  specimenStyles: string[];
}): Record<string, unknown> => {
  const { expectedStyles, observedStyles, specimenStyles } = params;
  const buildEntries = (items: string[]) => {
    const seen = new Set<string>();
    const entries: Array<{ label: string; tokens: string[] }> = [];
    for (const item of items) {
      const label = item.replace(/\s+/g, " ").trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ label, tokens: collectCoverageTokens(label) });
    }
    return entries;
  };

  const expectedEntries = buildEntries(expectedStyles);
  const observedEntries = buildEntries(observedStyles);
  const specimenEntries = buildEntries(specimenStyles);
  const specimenTokens = new Set(specimenEntries.flatMap((entry) => entry.tokens));

  const specimenVsExpectedMatched = expectedEntries.filter((entry) => entry.tokens.some((token) => specimenTokens.has(token)));
  const specimenVsObservedMatched = observedEntries.filter((entry) => entry.tokens.some((token) => specimenTokens.has(token)));

  const missingFromSpecimenExpected = expectedEntries
    .filter((entry) => !entry.tokens.some((token) => specimenTokens.has(token)))
    .map((entry) => entry.label);
  const missingFromSpecimenObserved = observedEntries
    .filter((entry) => !entry.tokens.some((token) => specimenTokens.has(token)))
    .map((entry) => entry.label);

  return {
    expectedStyleCount: expectedEntries.length,
    observedStyleCount: observedEntries.length,
    specimenStyleCount: specimenEntries.length,
    specimenVsExpectedMatchedCount: specimenVsExpectedMatched.length,
    specimenVsObservedMatchedCount: specimenVsObservedMatched.length,
    specimenVsExpectedAccuracyPct:
      expectedEntries.length > 0
        ? Number(((specimenVsExpectedMatched.length / expectedEntries.length) * 100).toFixed(2))
        : undefined,
    specimenVsObservedAccuracyPct:
      observedEntries.length > 0
        ? Number(((specimenVsObservedMatched.length / observedEntries.length) * 100).toFixed(2))
        : undefined,
    missingFromSpecimenExpected,
    missingFromSpecimenObserved
  };
};

export const collectSpecimenPdfAudit = async (params: {
  request: BrowserRequest;
  outputDir: string;
  expectedStyles?: string[];
  observedStyles?: string[];
  options?: {
    maxPageUrls?: number;
    maxPdfCandidates?: number;
    pageFetchTimeoutMs?: number;
    pdfFetchTimeoutMs?: number;
    maxTotalMs?: number;
    onProgress?: (message: string) => void | Promise<void>;
  };
}): Promise<Record<string, unknown> | undefined> => {
  const { request, outputDir } = params;
  const expectedStyles = Array.isArray(params.expectedStyles) ? params.expectedStyles : [];
  const observedStyles = Array.isArray(params.observedStyles) ? params.observedStyles : [];
  const options = params.options || {};
  const maxPageUrls = Number.isFinite(options.maxPageUrls) ? Math.max(1, Number(options.maxPageUrls)) : 24;
  const maxPdfCandidates = Number.isFinite(options.maxPdfCandidates) ? Math.max(1, Number(options.maxPdfCandidates)) : 24;
  const pageFetchTimeoutMs = Number.isFinite(options.pageFetchTimeoutMs)
    ? Math.max(5000, Number(options.pageFetchTimeoutMs))
    : 45000;
  const pdfFetchTimeoutMs = Number.isFinite(options.pdfFetchTimeoutMs)
    ? Math.max(5000, Number(options.pdfFetchTimeoutMs))
    : 45000;
  const maxTotalMs = Number.isFinite(options.maxTotalMs) ? Math.max(10000, Number(options.maxTotalMs)) : 180000;
  const startedAt = Date.now();

  const isOverBudget = (): boolean => Date.now() - startedAt > maxTotalMs;
  const onProgress = async (message: string): Promise<void> => {
    if (!options.onProgress) return;
    await options.onProgress(message);
  };

  const pageUrls = collectCandidatePages(request).slice(0, maxPageUrls);
  if (pageUrls.length === 0) return undefined;

  const metadataSeedCandidates = new Set<string>();
  const addMetadataSeed = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      if (isLikelySpecimenPdfUrl(parsed.href)) metadataSeedCandidates.add(parsed.href);
    } catch {
      // ignore invalid seed URL
    }
  };
  const addMetadataSeedMany = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) addMetadataSeed(item);
  };

  if (isRecord(request.metadata)) {
    addMetadataSeedMany(request.metadata.specimenPdfUrls);
    addMetadataSeedMany(request.metadata.technicalPdfUrls);
    addMetadataSeedMany(request.metadata.pdfUrls);
    if (isRecord(request.metadata.targetProfile)) {
      addMetadataSeedMany(request.metadata.targetProfile.specimenPdfUrls);
      addMetadataSeedMany(request.metadata.targetProfile.technicalPdfUrls);
      addMetadataSeedMany(request.metadata.targetProfile.pdfUrls);
    }
    const fonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
    for (const font of fonts) {
      if (!isRecord(font) || !isRecord(font.metadata)) continue;
      addMetadataSeedMany(font.metadata.specimenPdfUrls);
      addMetadataSeedMany(font.metadata.technicalPdfUrls);
      addMetadataSeedMany(font.metadata.pdfUrls);
      if (isRecord(font.metadata.targetProfile)) {
        addMetadataSeedMany(font.metadata.targetProfile.specimenPdfUrls);
        addMetadataSeedMany(font.metadata.targetProfile.technicalPdfUrls);
        addMetadataSeedMany(font.metadata.targetProfile.pdfUrls);
      }
    }
  }

  const targetFamilyMatchers = deriveTargetFamilyMatchers(request, Array.from(metadataSeedCandidates));
  const pdfCandidates = new Map<string, PdfCandidate>();
  let rejectedPdfCandidateCount = 0;
  const rejectedPdfCandidatesSample: Array<{ url: string; source: "page-scan" | "lineto-derived" }> = [];

  type CandidateAddSource = "metadata-seed" | "page-scan" | "lineto-derived";
  type CandidateAddResult = "accepted" | "duplicate" | "rejected" | "invalid";
  const addPdfCandidate = (candidate: PdfCandidate, source: CandidateAddSource): CandidateAddResult => {
    const url = candidate.url?.trim();
    if (!url) return "invalid";

    const relevantByFamily = isPdfCandidateRelevant(candidate, targetFamilyMatchers);
    const trustedOpaque = isTrustedOpaquePdfCandidate(candidate, request.targetUrl);
    if (source !== "metadata-seed" && !relevantByFamily && !trustedOpaque) {
      rejectedPdfCandidateCount += 1;
      if (
        rejectedPdfCandidatesSample.length < 20 &&
        (source === "page-scan" || source === "lineto-derived")
      ) {
        rejectedPdfCandidatesSample.push({ url, source });
      }
      return "rejected";
    }

    if (!pdfCandidates.has(url)) {
      pdfCandidates.set(url, { url, suggestedFileName: candidate.suggestedFileName });
      return "accepted";
    }
    const existing = pdfCandidates.get(url);
    if (existing && !existing.suggestedFileName && candidate.suggestedFileName) {
      existing.suggestedFileName = candidate.suggestedFileName;
    }
    return "duplicate";
  };

  const pageScans: Array<{
    pageUrl: string;
    discoveredPdfCount: number;
    acceptedPdfCount: number;
    rejectedPdfCount: number;
    error?: string;
  }> = [];

  for (const url of metadataSeedCandidates) addPdfCandidate({ url }, "metadata-seed");

  for (const pageUrl of pageUrls) {
    if (isOverBudget()) {
      pageScans.push({
        pageUrl,
        discoveredPdfCount: 0,
        acceptedPdfCount: 0,
        rejectedPdfCount: 0,
        error: "Specimen audit timed out before page scan."
      });
      break;
    }
    try {
      const html = await fetchTextWithTimeout(pageUrl, pageFetchTimeoutMs, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": BROWSER_UA
      });
      const extracted = extractPdfUrlsFromHtml(html, pageUrl);
      const linetoTechnical = extractLinetoTechnicalPdfCandidates(html, pageUrl);

      let acceptedCount = 0;
      let rejectedCount = 0;
      for (const url of extracted) {
        const result = addPdfCandidate({ url }, "page-scan");
        if (result === "accepted" || result === "duplicate") acceptedCount += 1;
        if (result === "rejected") rejectedCount += 1;
      }
      for (const candidate of linetoTechnical) {
        const result = addPdfCandidate(candidate, "lineto-derived");
        if (result === "accepted" || result === "duplicate") acceptedCount += 1;
        if (result === "rejected") rejectedCount += 1;
      }

      const discoveredPdfCount = extracted.length + linetoTechnical.length;
      pageScans.push({
        pageUrl,
        discoveredPdfCount,
        acceptedPdfCount: acceptedCount,
        rejectedPdfCount: rejectedCount
      });
      await onProgress(
        `[Specimen] scanned ${pageUrl} -> ${acceptedCount}/${discoveredPdfCount} relevant pdf candidates`
      );
    } catch (error) {
      pageScans.push({
        pageUrl,
        discoveredPdfCount: 0,
        acceptedPdfCount: 0,
        rejectedPdfCount: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (pdfCandidates.size === 0) {
    return {
      generatedAt: new Date().toISOString(),
      targetUrl: request.targetUrl,
      pageUrlsScanned: pageUrls,
      pageScans,
      specimenPdfCount: 0,
      filtering: {
        targetFamilyTokens: targetFamilyMatchers.familyTokens,
        targetFamilyWordSequences: targetFamilyMatchers.familyWordSequences.map((words) => words.join(" ")),
        rejectedPdfCandidateCount,
        rejectedPdfCandidatesSample
      },
      status: "warn",
      note: "No specimen PDF links discovered on scanned pages."
    };
  }

  const specimenDir = joinOpaquePath(outputDir, "specimens");
  await mkdir(specimenDir, { recursive: true });

  const downloadedPdfs: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const styleCandidates = new Set<string>();
  const featureTags = new Set<string>();
  const languageHints = new Set<string>();
  const usedFileNames = new Set<string>();
  const seenContentHashes = new Set<string>();
  const familyFallbackStem = deriveRequestFamilyLabel(request);

  let totalTextLength = 0;
  let timedOut = false;
  let familyMentionedInSpecimen = false;

  for (const candidate of Array.from(pdfCandidates.values()).slice(0, maxPdfCandidates)) {
    if (isOverBudget()) {
      timedOut = true;
      skipped.push({ url: candidate.url, reason: "Specimen audit timed out." });
      break;
    }
    const pdfUrl = candidate.url;
    try {
      const fetchedPdf = await fetchPdfWithTimeout(pdfUrl, pdfFetchTimeoutMs, {
        Accept: "application/pdf,*/*",
        Referer: request.targetUrl,
        "User-Agent": BROWSER_UA
      });
      const { buffer, contentDisposition } = fetchedPdf;
      if (buffer.length < 64 || !isLikelyPdfBuffer(buffer)) {
        skipped.push({ url: pdfUrl, reason: "PDF payload too small." });
        continue;
      }

      const contentHash = crypto.createHash("sha1").update(buffer).digest("hex");
      if (seenContentHashes.has(contentHash)) {
        skipped.push({ url: pdfUrl, reason: "Duplicate PDF content." });
        continue;
      }
      seenContentHashes.add(contentHash);

      let base = "specimen.pdf";
      if (typeof candidate.suggestedFileName === "string" && candidate.suggestedFileName.trim()) {
        base = candidate.suggestedFileName.trim();
      } else if (contentDisposition) {
        const fromDisposition = parseContentDispositionFileName(contentDisposition);
        if (fromDisposition) {
          base = fromDisposition;
        }
      } else {
        try {
          const parsed = new URL(pdfUrl);
          const rawName = path.basename(parsed.pathname) || "specimen.pdf";
          base = /\.pdf$/i.test(rawName) ? rawName : `${rawName}.pdf`;
        } catch {
          // fallback filename
        }
      }

      let stem = path.basename(base, path.extname(base));
      if (isLikelyOpaquePdfStem(stem) && familyFallbackStem) {
        stem = `${familyFallbackStem} specimen`;
      }
      const baseName = toSafeFileName(stem);
      let fileName = `${baseName}.pdf`;
      if (usedFileNames.has(fileName)) {
        let suffix = 2;
        while (usedFileNames.has(`${baseName}-${suffix}.pdf`)) suffix++;
        fileName = `${baseName}-${suffix}.pdf`;
      }
      usedFileNames.add(fileName);

      const absPath = joinOpaquePath(specimenDir, fileName);
      await writeFile(absPath, buffer);

      const parsed = await parsePdfText(buffer);
      const parsedText = parsed.text;
      const pageCount = parsed.pageCount;

      const localStyles = extractStyleCandidates(parsedText);
      const localFeatures = extractFeatureTags(parsedText);
      const localLanguages = extractLanguageHints(parsedText);
      if (!familyMentionedInSpecimen && specimenMentionsTargetFamily(parsedText, targetFamilyMatchers)) {
        familyMentionedInSpecimen = true;
      }
      for (const style of localStyles) styleCandidates.add(style);
      for (const feature of localFeatures) featureTags.add(feature);
      for (const lang of localLanguages) languageHints.add(lang);
      totalTextLength += parsedText.length;

      downloadedPdfs.push({
        sourceUrl: pdfUrl,
        filePath: path.relative(process.cwd(), absPath),
        sizeBytes: buffer.length,
        pageCount,
        parserMode: parsed.parserMode,
        parserError: parsed.parserError,
        extractedStyleCount: localStyles.length,
        extractedFeatureCount: localFeatures.length,
        textSample: parsedText.replace(/\s+/g, " ").trim().slice(0, 320)
      });
      await onProgress(`[Specimen] downloaded ${fileName} (${buffer.length} bytes)`);
    } catch (error) {
      skipped.push({
        url: pdfUrl,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const coverage = buildCoverage({
    expectedStyles,
    observedStyles,
    specimenStyles: Array.from(styleCandidates)
  });

  let status: "pass" | "warn" | "fail" = "pass";
  const expectedCount = Number(coverage.expectedStyleCount || 0);
  const expectedMissing = Array.isArray(coverage.missingFromSpecimenExpected)
    ? coverage.missingFromSpecimenExpected.length
    : 0;
  const relaxCoverageWarning = shouldRelaxSpecimenCoverageWarning({
    expectedStyles,
    matchers: targetFamilyMatchers,
    downloadedPdfCount: downloadedPdfs.length,
    styleCandidateCount: styleCandidates.size,
    familyMentionedInSpecimen
  });
  if (downloadedPdfs.length === 0) {
    status = "fail";
  } else if (expectedCount > 0 && expectedMissing > 0 && !relaxCoverageWarning) {
    status = "warn";
  } else if (skipped.length > 0) {
    status = "warn";
  }

  if (timedOut && status === "pass") {
    status = "warn";
  }

  return {
    generatedAt: new Date().toISOString(),
    targetUrl: request.targetUrl,
    pageUrlsScanned: pageUrls,
    pageScans,
    specimenPdfCount: downloadedPdfs.length,
    skippedPdfCount: skipped.length,
    filtering: {
      targetFamilyTokens: targetFamilyMatchers.familyTokens,
      targetFamilyWordSequences: targetFamilyMatchers.familyWordSequences.map((words) => words.join(" ")),
      rejectedPdfCandidateCount,
      rejectedPdfCandidatesSample
    },
    downloadedPdfs,
    skipped,
    extracted: {
      styleCandidates: Array.from(styleCandidates).sort(),
      featureTags: Array.from(featureTags).sort(),
      languageHints: Array.from(languageHints).sort(),
      extractedTextLength: totalTextLength
    },
    timing: {
      elapsedMs: Date.now() - startedAt,
      maxTotalMs,
      timedOut
    },
    heuristics: {
      familyMentionedInSpecimen,
      relaxedCoverageWarning: relaxCoverageWarning
    },
    coverage,
    status
  };
};






