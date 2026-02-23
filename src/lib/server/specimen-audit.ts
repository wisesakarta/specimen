import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import type { BrowserRequest } from "@/lib/types";
import { joinOpaquePath } from "@/lib/server/opaque-path";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const NODE_REQUIRE = createRequire(import.meta.url);

type PdfCandidate = {
  url: string;
  suggestedFileName?: string;
};

const STYLE_WORDS =
  "(?:thin|extralight|extra light|ultralight|ultra light|light|regular|book|medium|semibold|semi bold|demibold|demi bold|bold|extrabold|extra bold|black|heavy)";
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
  if (!/[ÃÂ][\x80-\xBF]/.test(value)) return value;
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

    // Fallback to CJS require resolution for environments where dynamic import interop is unstable.
    const cjsPath = NODE_REQUIRE.resolve("pdf-parse/dist/pdf-parse/cjs/index.cjs");
    const cjsModule = NODE_REQUIRE(cjsPath) as Record<string, unknown>;
    const parsedFromCjs = await tryParse(cjsModule);
    if (parsedFromCjs) return parsedFromCjs;

    const fallbackText = extractFallbackTextFromPdfBytes(buffer);
    return {
      text: fallbackText,
      parserMode: "fallback-byte-scan",
      parserError: "Unsupported pdf-parse module shape."
    };
  } catch (error) {
    // Last attempt with CJS require in case runtime import failed before module resolution.
    try {
      const cjsPath = NODE_REQUIRE.resolve("pdf-parse/dist/pdf-parse/cjs/index.cjs");
      const cjsModule = NODE_REQUIRE(cjsPath) as Record<string, unknown>;
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
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
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

    const fonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
    for (const font of fonts) {
      if (!isRecord(font) || !isRecord(font.metadata)) continue;
      add(font.metadata.pageUrl);
      add(font.metadata.targetUrl);
      add(font.metadata.originalUrl);
      addMany(font.metadata.collectionUrls);
      addMany(font.metadata.collectionFamilyUrls);
    }
  }

  for (const technicalUrl of deriveLinetoTechnicalUrls(Array.from(urls))) {
    urls.add(technicalUrl);
  }

  return Array.from(urls).slice(0, 24);
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
      if (!/\.pdf(?:$|\?)/i.test(resolved.href)) return;
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
    /\\"(\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi
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

const buildCoverage = (params: {
  expectedStyles: string[];
  observedStyles: string[];
  specimenStyles: string[];
}): Record<string, unknown> => {
  const { expectedStyles, observedStyles, specimenStyles } = params;
  const toMap = (items: string[]) => {
    const map = new Map<string, string>();
    for (const item of items) {
      const token = normalizeStyleCoverageToken(item);
      if (!token) continue;
      if (!map.has(token)) map.set(token, item);
    }
    return map;
  };

  const expectedMap = toMap(expectedStyles);
  const observedMap = toMap(observedStyles);
  const specimenMap = toMap(specimenStyles);

  const specimenVsExpectedMatched = Array.from(expectedMap.keys()).filter((token) => specimenMap.has(token));
  const specimenVsObservedMatched = Array.from(observedMap.keys()).filter((token) => specimenMap.has(token));

  const missingFromSpecimenExpected = Array.from(expectedMap.entries())
    .filter(([token]) => !specimenMap.has(token))
    .map(([, label]) => label);
  const missingFromSpecimenObserved = Array.from(observedMap.entries())
    .filter(([token]) => !specimenMap.has(token))
    .map(([, label]) => label);

  return {
    expectedStyleCount: expectedMap.size,
    observedStyleCount: observedMap.size,
    specimenStyleCount: specimenMap.size,
    specimenVsExpectedMatchedCount: specimenVsExpectedMatched.length,
    specimenVsObservedMatchedCount: specimenVsObservedMatched.length,
    specimenVsExpectedAccuracyPct:
      expectedMap.size > 0 ? Number(((specimenVsExpectedMatched.length / expectedMap.size) * 100).toFixed(2)) : undefined,
    specimenVsObservedAccuracyPct:
      observedMap.size > 0 ? Number(((specimenVsObservedMatched.length / observedMap.size) * 100).toFixed(2)) : undefined,
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

  const pdfCandidates = new Map<string, PdfCandidate>();
  const addPdfCandidate = (candidate: PdfCandidate) => {
    const url = candidate.url?.trim();
    if (!url) return;
    if (!pdfCandidates.has(url)) {
      pdfCandidates.set(url, { url, suggestedFileName: candidate.suggestedFileName });
      return;
    }
    const existing = pdfCandidates.get(url);
    if (existing && !existing.suggestedFileName && candidate.suggestedFileName) {
      existing.suggestedFileName = candidate.suggestedFileName;
    }
  };
  const pageScans: Array<{ pageUrl: string; pdfCount: number; error?: string }> = [];

  for (const pageUrl of pageUrls) {
    if (isOverBudget()) {
      pageScans.push({
        pageUrl,
        pdfCount: 0,
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
      for (const url of extracted) addPdfCandidate({ url });

      const linetoTechnical = extractLinetoTechnicalPdfCandidates(html, pageUrl);
      for (const candidate of linetoTechnical) addPdfCandidate(candidate);

      pageScans.push({ pageUrl, pdfCount: extracted.length + linetoTechnical.length });
      await onProgress(`[Specimen] scanned ${pageUrl} -> ${extracted.length + linetoTechnical.length} pdf candidates`);
    } catch (error) {
      pageScans.push({
        pageUrl,
        pdfCount: 0,
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
  if (downloadedPdfs.length === 0) {
    status = "fail";
  } else if (expectedCount > 0 && expectedMissing > 0) {
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
    coverage,
    status
  };
};
