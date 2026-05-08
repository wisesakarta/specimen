import { Scraper, ScrapeResult, FontMetadata } from "./scraper-protocol";
import * as cheerio from "cheerio";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const GENERIC_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FONT_EXT_RE = /\.(?:woff2|woff|otf|ttf)(?:\?[^"'()\s<>]+)?$/i;
const TEXT_RESOURCE_EXT_RE = /\.(?:css|js|mjs|cjs|json|webmanifest|txt|xml)(?:\?[^"'()\s<>]+)?$/i;
const CSS_URL_RE = /url\(\s*(['"]?)([^"')]+?\.(?:woff2|woff|otf|ttf)(?:\?[^"')\s]+)?)\1\s*\)/gi;
const HTML_ATTR_FONT_RE = /\b(?:href|src)=['"]([^'"]+?\.(?:woff2|woff|otf|ttf)(?:\?[^"'\s]+)?)['"]/gi;
const RAW_FONT_URL_RE = /(?<![A-Za-z0-9._-])(?:https?:\/\/|\/|\.\.\/|\.\/)[^\s"'()<>]+?\.(?:woff2|woff|otf|ttf)(?:\?[^\s"'()<>]+)?/gi;
const FONT_FACE_BLOCK_RE = /@font-face\s*\{([\s\S]*?)\}/gi;
const FONT_FAMILY_DECL_RE = /font-family\s*:\s*([^;]+);/i;
const FONT_WEIGHT_DECL_RE = /font-weight\s*:\s*([^;]+);/i;
const FONT_STYLE_DECL_RE = /font-style\s*:\s*([^;]+);/i;
const FONT_HINT_RE = /@font-face|font-family|fontFamily|font\s*:\s*|\.woff2?|\.otf|\.ttf|typeface|glyph|variable/i;
const RESOURCE_NOISE_HOST_RE =
  /(?:googletagmanager|google-analytics|doubleclick|googleoptimize|recaptcha|gstatic|google\.com|hotjar|clarity\.ms|segment|sentry|newrelic|nr-data|intercom|crisp\.chat|cookiebot|trustarc|optimizely|fullstory)/i;
const COMMON_FAMILY_STOPWORDS = new Set([
  "sansserif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "systemui",
  "uimonospace",
  "emoji",
  "math",
  "fangsong"
]);
const MAX_RESOURCE_CANDIDATES = 18;
const MAX_RESOURCE_TEXT_BYTES = 500_000;
const MAX_INLINE_SCRIPT_CHARS = 250_000;
const GENERIC_PRIMARY_FETCH_TIMEOUT_MS = 15_000;
const GENERIC_RESOURCE_FETCH_TIMEOUT_MS = 12_000;
const GENERIC_FETCH_ATTEMPTS = 3;
const GENERIC_SELECTOR_MEMORY_PATH = path.join(process.cwd(), "tmp", "generic-selector-memory.json");
const GENERIC_SELECTOR_MEMORY_MAX_HOSTS = 120;
const GENERIC_SELECTOR_MEMORY_MAX_CANDIDATES_PER_HOST = 48;

type FontFaceSource = {
  url: string;
  format: "woff2" | "woff" | "otf" | "ttf";
  preload: boolean;
  variableSource: boolean;
};

type FontFaceEntry = {
  family: string;
  styleLabel: string;
  weight: string;
  style: "Normal" | "Italic";
  discovery: "font-face" | "inferred-url";
  source: FontFaceSource;
};

type ResearchDocumentKind = "html" | "css" | "js" | "json" | "manifest" | "inline-json" | "inline-script";

type ResearchDocument = {
  url: string;
  kind: ResearchDocumentKind;
  text: string;
  inline: boolean;
};

type ResourceCandidate = {
  url: string;
  kind: Exclude<ResearchDocumentKind, "html" | "inline-json" | "inline-script">;
  rel: string;
  score: number;
  memoryKey: string;
};

type PassiveResearchResult = {
  documents: ResearchDocument[];
  candidates: ResourceCandidate[];
  blockedUrls: string[];
  selectorMemoryHost: string;
  selectorMemoryBoostedCandidates: number;
  selectorMemoryUpdates: number;
};

type GenericSelectorMemoryRecord = {
  key: string;
  kind: ResourceCandidate["kind"];
  rel: string;
  signature: string;
  successCount: number;
  failCount: number;
  score: number;
  updatedAt: number;
};

type GenericSelectorMemoryStore = {
  version: 1;
  updatedAt: string;
  hosts: Record<string, GenericSelectorMemoryRecord[]>;
};

type GenericSelectorMemorySnapshot = {
  host: string;
  boosts: Map<string, number>;
  boostedCount: number;
};

type StyleSuffixPattern = {
  pattern: RegExp;
  styleLabel: string;
  weight: string;
  style: "Normal" | "Italic";
};

type StyleSignal = {
  family: string;
  styleLabel: string;
  weight: string;
  style: "Normal" | "Italic";
};

const STYLE_SUFFIX_PATTERNS: StyleSuffixPattern[] = [
  { pattern: /\b(?:extra\s*bold|ultra\s*bold)\s+italic$/i, styleLabel: "ExtraBold Italic", weight: "800", style: "Italic" },
  { pattern: /\bsemi\s*bold\s+italic$/i, styleLabel: "SemiBold Italic", weight: "600", style: "Italic" },
  { pattern: /\b(?:extra\s*light|ultra\s*light)\s+italic$/i, styleLabel: "ExtraLight Italic", weight: "200", style: "Italic" },
  { pattern: /\bthin\s+italic$/i, styleLabel: "Thin Italic", weight: "100", style: "Italic" },
  { pattern: /\blight\s+italic$/i, styleLabel: "Light Italic", weight: "300", style: "Italic" },
  { pattern: /\bnormal\s+italic$/i, styleLabel: "Italic", weight: "400", style: "Italic" },
  { pattern: /\bregular\s+italic$/i, styleLabel: "Regular Italic", weight: "400", style: "Italic" },
  { pattern: /\bmedium\s+italic$/i, styleLabel: "Medium Italic", weight: "500", style: "Italic" },
  { pattern: /\bbold\s+italic$/i, styleLabel: "Bold Italic", weight: "700", style: "Italic" },
  { pattern: /\bblack\s+italic$/i, styleLabel: "Black Italic", weight: "900", style: "Italic" },
  { pattern: /\bheavy\s+italic$/i, styleLabel: "Heavy Italic", weight: "850", style: "Italic" },
  { pattern: /\bitalic$/i, styleLabel: "Italic", weight: "400", style: "Italic" },
  { pattern: /\b(?:extra\s*bold|ultra\s*bold)$/i, styleLabel: "ExtraBold", weight: "800", style: "Normal" },
  { pattern: /\bsemi\s*bold$/i, styleLabel: "SemiBold", weight: "600", style: "Normal" },
  { pattern: /\b(?:extra\s*light|ultra\s*light)$/i, styleLabel: "ExtraLight", weight: "200", style: "Normal" },
  { pattern: /\bthin$/i, styleLabel: "Thin", weight: "100", style: "Normal" },
  { pattern: /\blight$/i, styleLabel: "Light", weight: "300", style: "Normal" },
  { pattern: /\bbook$/i, styleLabel: "Book", weight: "400", style: "Normal" },
  { pattern: /\bnormal$/i, styleLabel: "Regular", weight: "400", style: "Normal" },
  { pattern: /\bregular$/i, styleLabel: "Regular", weight: "400", style: "Normal" },
  { pattern: /\bmedium$/i, styleLabel: "Medium", weight: "500", style: "Normal" },
  { pattern: /\bbold$/i, styleLabel: "Bold", weight: "700", style: "Normal" },
  { pattern: /\bblack$/i, styleLabel: "Black", weight: "900", style: "Normal" },
  { pattern: /\bheavy$/i, styleLabel: "Heavy", weight: "850", style: "Normal" }
];

const inferStyleSuffixFromLabel = (label: string): StyleSignal | undefined => {
  const normalized = normalizeSpace(label);
  if (!normalized) return undefined;

  for (const suffix of STYLE_SUFFIX_PATTERNS) {
    if (!suffix.pattern.test(normalized)) continue;
    const family = normalizeSpace(normalized.replace(suffix.pattern, ""));
    if (!family || normalizeToken(family).length < 3) continue;
    return {
      family,
      styleLabel: suffix.styleLabel,
      weight: suffix.weight,
      style: suffix.style
    };
  }

  return undefined;
};

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();
const stripQuotes = (value: string): string => value.trim().replace(/^['"]+|['"]+$/g, "").trim();
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getHostFromUrl = (value: string): string => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
};

const createEmptySelectorMemoryStore = (): GenericSelectorMemoryStore => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  hosts: {}
});

const readSelectorMemoryStore = async (): Promise<GenericSelectorMemoryStore> => {
  try {
    const raw = await readFile(GENERIC_SELECTOR_MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<GenericSelectorMemoryStore>;
    if (parsed?.version !== 1 || !parsed.hosts || typeof parsed.hosts !== "object") return createEmptySelectorMemoryStore();

    const hosts: Record<string, GenericSelectorMemoryRecord[]> = {};
    for (const [host, rows] of Object.entries(parsed.hosts)) {
      if (!Array.isArray(rows)) continue;
      hosts[host] = rows
        .map((row) => ({
          key: normalizeSpace(String((row as any)?.key || "")),
          kind: ((row as any)?.kind || "js") as ResourceCandidate["kind"],
          rel: normalizeSpace(String((row as any)?.rel || "")),
          signature: normalizeSpace(String((row as any)?.signature || "")),
          successCount: Math.max(0, Number((row as any)?.successCount) || 0),
          failCount: Math.max(0, Number((row as any)?.failCount) || 0),
          score: Number((row as any)?.score) || 0,
          updatedAt: Number((row as any)?.updatedAt) || Date.now()
        }))
        .filter((row) => row.key.length > 0);
    }

    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      hosts
    };
  } catch {
    return createEmptySelectorMemoryStore();
  }
};

const writeSelectorMemoryStore = async (store: GenericSelectorMemoryStore): Promise<void> => {
  try {
    await mkdir(path.dirname(GENERIC_SELECTOR_MEMORY_PATH), { recursive: true });
    await writeFile(
      GENERIC_SELECTOR_MEMORY_PATH,
      JSON.stringify(
        {
          ...store,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    // best-effort cache persistence
  }
};

const buildResourceSignature = (resourceUrl: string): string => {
  try {
    const parsed = new URL(resourceUrl);
    const pathname = parsed.pathname.toLowerCase();
    const coarse = pathname
      .replace(/[0-9a-f]{8,}/g, ":hash")
      .replace(/\d+/g, ":num")
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, "");
    const query = parsed.search
      .replace(/[0-9a-f]{8,}/g, ":hash")
      .replace(/\d+/g, ":num")
      .slice(0, 48);
    return `${coarse}${query}`;
  } catch {
    return normalizeSpace(resourceUrl.toLowerCase());
  }
};

const buildResourceMemoryKey = (
  resourceUrl: string,
  kind: ResourceCandidate["kind"],
  rel: string
): string => {
  const relToken = normalizeToken(rel).slice(0, 24) || "none";
  const signature = buildResourceSignature(resourceUrl);
  return `${kind}|${relToken}|${signature}`;
};

const getSelectorMemorySnapshot = async (pageUrl: string): Promise<GenericSelectorMemorySnapshot> => {
  const host = getHostFromUrl(pageUrl);
  if (!host) {
    return {
      host: "",
      boosts: new Map(),
      boostedCount: 0
    };
  }

  const store = await readSelectorMemoryStore();
  const entries = Array.isArray(store.hosts[host]) ? store.hosts[host] : [];
  const boosts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.score < 3) continue;
    const bounded = clampNumber(Math.round(entry.score), 1, 40);
    boosts.set(entry.key, bounded);
  }
  return {
    host,
    boosts,
    boostedCount: boosts.size
  };
};

const commitSelectorMemoryOutcomes = async (params: {
  snapshot: GenericSelectorMemorySnapshot;
  outcomes: Array<{
    candidate: ResourceCandidate;
    success: boolean;
    signalScore: number;
  }>;
}): Promise<number> => {
  const host = params.snapshot.host;
  if (!host || params.outcomes.length === 0) return 0;

  const store = await readSelectorMemoryStore();
  const existingRows = Array.isArray(store.hosts[host]) ? store.hosts[host] : [];
  const byKey = new Map<string, GenericSelectorMemoryRecord>();

  for (const row of existingRows) {
    if (!row?.key) continue;
    byKey.set(row.key, {
      ...row,
      score: Number.isFinite(row.score) ? row.score : 0
    });
  }

  const now = Date.now();
  for (const outcome of params.outcomes) {
    const row = byKey.get(outcome.candidate.memoryKey) || {
      key: outcome.candidate.memoryKey,
      kind: outcome.candidate.kind,
      rel: outcome.candidate.rel,
      signature: buildResourceSignature(outcome.candidate.url),
      successCount: 0,
      failCount: 0,
      score: 0,
      updatedAt: now
    };

    if (outcome.success) {
      row.successCount += 1;
      if (outcome.signalScore >= 2) row.successCount += 1;
    } else {
      row.failCount += 1;
    }

    const weightedScore =
      row.successCount * 6 +
      clampNumber(outcome.signalScore, 0, 4) * 2 -
      row.failCount * 4 +
      (row.kind === "css" ? 2 : 0);
    row.score = clampNumber(weightedScore, -30, 60);
    row.updatedAt = now;
    byKey.set(row.key, row);
  }

  const prunedRows = Array.from(byKey.values())
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
    .slice(0, GENERIC_SELECTOR_MEMORY_MAX_CANDIDATES_PER_HOST);
  store.hosts[host] = prunedRows;

  const hostOrder = Object.entries(store.hosts)
    .map(([name, rows]) => ({
      name,
      updatedAt: Math.max(...(rows || []).map((row) => Number(row.updatedAt) || 0), 0)
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));

  if (hostOrder.length > GENERIC_SELECTOR_MEMORY_MAX_HOSTS) {
    for (const stale of hostOrder.slice(GENERIC_SELECTOR_MEMORY_MAX_HOSTS)) {
      delete store.hosts[stale.name];
    }
  }

  await writeSelectorMemoryStore(store);
  return params.outcomes.length;
};

const buildBrowserLikeHeaders = (referer?: string): HeadersInit => {
  const headers: Record<string, string> = {
    "User-Agent": GENERIC_BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/css,*/*;q=0.8"
  };
  if (!referer) return headers;
  headers.Referer = referer;
  try {
    headers.Origin = new URL(referer).origin;
  } catch {
    // ignore invalid referer
  }
  return headers;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryFetchResponse = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500;

const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  options?: {
    attempts?: number;
    timeoutMs?: number;
  }
): Promise<Response> => {
  const attempts = Math.max(1, options?.attempts ?? GENERIC_FETCH_ATTEMPTS);
  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? GENERIC_PRIMARY_FETCH_TIMEOUT_MS);

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.ok || !shouldRetryFetchResponse(response.status) || attempt === attempts - 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }

    await delay(250 * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
};

const deriveTargetTokens = (url: string, html: string): string[] => {
  const out = new Set<string>();
  try {
    const parsed = new URL(url);
    for (const segment of parsed.pathname.split("/").filter(Boolean)) {
      const token = normalizeToken(segment);
      if (token.length >= 3 && !COMMON_FAMILY_STOPWORDS.has(token)) out.add(token);
    }
  } catch {
    // ignore parse errors
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] || "").replace(/<[^>]+>/g, " ");
  for (const part of title.split(/[^A-Za-z0-9]+/g)) {
    const token = normalizeToken(part);
    if (token.length >= 3 && !COMMON_FAMILY_STOPWORDS.has(token) && token !== "font" && token !== "family") {
      out.add(token);
    }
  }

  return Array.from(out);
};

const pushResolvedFontUrl = (hits: Set<string>, rawValue: string, baseUrl: string): void => {
  const raw = String(rawValue || "").replace(/\\\//g, "/").trim();
  if (!raw || !FONT_EXT_RE.test(raw)) return;
  try {
    hits.add(new URL(raw, baseUrl).toString());
  } catch {
    // ignore malformed URLs
  }
};

const resolveFontUrls = (text: string, baseUrl: string): string[] => {
  const hits = new Set<string>();

  for (const match of text.matchAll(CSS_URL_RE)) pushResolvedFontUrl(hits, match[2] || "", baseUrl);
  for (const match of text.matchAll(HTML_ATTR_FONT_RE)) pushResolvedFontUrl(hits, match[1] || "", baseUrl);
  for (const match of text.matchAll(RAW_FONT_URL_RE)) pushResolvedFontUrl(hits, match[0] || "", baseUrl);

  return Array.from(hits);
};

const deriveFontUrlStem = (fontUrl: string): string | undefined => {
  try {
    const pathname = new URL(fontUrl).pathname;
    const basename = decodeURIComponent(pathname.split("/").pop() || "");
    if (!basename) return undefined;

    let stem = basename.replace(/\.[^.]+$/, "");
    stem = stem.replace(/\.p$/i, "");
    stem = stem.replace(/^[0-9a-f]{8,}[-_]+/i, "");
    stem = stem.replace(/[-_]+[0-9a-f]{8,}$/i, "");
    stem = stem.replace(/(?:[-_][0-9]+)+$/, "");
    return stem || undefined;
  } catch {
    return undefined;
  }
};

const inferFormatFromUrl = (url: string): "woff2" | "woff" | "otf" | "ttf" => {
  const token = url.toLowerCase();
  if (token.includes(".woff2")) return "woff2";
  if (token.includes(".woff")) return "woff";
  if (token.includes(".otf")) return "otf";
  return "ttf";
};

const parseWeightValue = (rawWeight: string): number | undefined => {
  const normalized = normalizeSpace(rawWeight).toLowerCase();
  if (!normalized) return undefined;
  if (/^\d+\s+\d+$/.test(normalized)) {
    const [start] = normalized.split(/\s+/);
    const numeric = Number(start);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric;
  if (normalized === "normal") return 400;
  if (normalized === "bold") return 700;
  return undefined;
};

const weightToLabel = (weight: number | undefined): string => {
  if (weight === undefined) return "Regular";
  if (weight <= 150) return "Thin";
  if (weight <= 250) return "ExtraLight";
  if (weight <= 350) return "Light";
  if (weight <= 450) return "Regular";
  if (weight <= 550) return "Medium";
  if (weight <= 650) return "SemiBold";
  if (weight <= 750) return "Bold";
  if (weight <= 850) return "ExtraBold";
  return "Black";
};

const isVariableFace = (family: string, rawWeight: string, sources: FontFaceSource[]): boolean => {
  const familyToken = normalizeToken(family);
  const normalizedWeight = normalizeSpace(rawWeight).toLowerCase();
  if (familyToken.includes("variable") || /^\d+\s+\d+$/.test(normalizedWeight)) return true;
  return sources.every((source) => source.variableSource);
};

const buildStyleLabel = (family: string, rawWeight: string, rawStyle: string, variableFace: boolean): string => {
  const normalizedStyle = normalizeSpace(rawStyle).toLowerCase();
  const italic = /(italic|oblique)/i.test(normalizedStyle);

  if (variableFace) {
    return italic ? "Italic" : "Regular";
  }

  const base = weightToLabel(parseWeightValue(rawWeight));
  if (italic && base === "Regular") return "Italic";
  return italic ? `${base} Italic` : base;
};

const scoreStyleSignal = (styleLabel: string, weight: string, style: "Normal" | "Italic"): number => {
  let score = 0;
  if (!/^(Regular|Italic)$/i.test(styleLabel)) score += 4;
  if (style === "Italic" || /italic/i.test(styleLabel)) score += 2;
  const numericWeight = Number(weight);
  if (Number.isFinite(numericWeight)) score += Math.min(5, Math.round(Math.abs(numericWeight - 400) / 100));
  return score;
};

const pickFontFaceSource = (family: string, rawWeight: string, sources: FontFaceSource[]): FontFaceSource | undefined => {
  if (sources.length === 0) return undefined;
  const variableFace = isVariableFace(family, rawWeight, sources);
  const rank = { woff2: 0, woff: 1, otf: 2, ttf: 3 };
  const pool = variableFace ? sources : sources.filter((source) => !source.variableSource);
  const candidates = pool.length > 0 ? pool : sources;
  return [...candidates].sort((a, b) => {
    if (variableFace) {
      const preloadDelta = Number(b.preload) - Number(a.preload);
      if (preloadDelta !== 0) return preloadDelta;
    }
    return rank[a.format] - rank[b.format];
  })[0];
};

const countMatches = (text: string, family: string): number => {
  const direct = text.match(new RegExp(escapeRegExp(family), "gi"))?.length || 0;
  if (direct > 0) return direct;
  const token = normalizeToken(family);
  if (token.length < 3) return 0;
  return text.match(new RegExp(escapeRegExp(token), "gi"))?.length || 0;
};

const parseFontFaceEntries = (cssText: string, baseUrl: string, preloadUrls: Set<string>): FontFaceEntry[] => {
  const out: FontFaceEntry[] = [];

  for (const blockMatch of cssText.matchAll(FONT_FACE_BLOCK_RE)) {
    const block = blockMatch[1] || "";
    const familyRaw = block.match(FONT_FAMILY_DECL_RE)?.[1] || "";
    const family = stripQuotes(normalizeSpace(familyRaw));
    if (!family) continue;

    const rawWeight = normalizeSpace(block.match(FONT_WEIGHT_DECL_RE)?.[1] || "400") || "400";
    const rawStyle = normalizeSpace(block.match(FONT_STYLE_DECL_RE)?.[1] || "normal") || "normal";
    const sources: FontFaceSource[] = [];
    for (const srcMatch of block.matchAll(CSS_URL_RE)) {
      const rawUrl = srcMatch[2] || "";
      try {
        const resolved = new URL(rawUrl, baseUrl).toString();
        sources.push({
          url: resolved,
          format: inferFormatFromUrl(resolved),
          preload: preloadUrls.has(resolved),
          variableSource: /variable|\bvf\b/i.test(resolved)
        });
      } catch {
        // ignore malformed URLs
      }
    }
    if (sources.length === 0) continue;

    const variableFace = isVariableFace(family, rawWeight, sources);
    const selectedSource = pickFontFaceSource(family, rawWeight, sources);
    if (!selectedSource) continue;

    let resolvedFamily = family;
    let resolvedStyleLabel = buildStyleLabel(family, rawWeight, rawStyle, variableFace);
    let resolvedWeight = String(parseWeightValue(rawWeight) || rawWeight || "400");
    let resolvedStyle: "Normal" | "Italic" = /(italic|oblique)/i.test(rawStyle) ? "Italic" : "Normal";

    const familySignal = inferStyleSuffixFromLabel(humanizeFamilyLabel(family));
    if (familySignal) {
      resolvedFamily = familySignal.family;
      const currentScore = scoreStyleSignal(resolvedStyleLabel, resolvedWeight, resolvedStyle);
      const familyScore = scoreStyleSignal(familySignal.styleLabel, familySignal.weight, familySignal.style);
      if (familyScore >= currentScore || familySignal.styleLabel !== "Regular") {
        resolvedStyleLabel = familySignal.styleLabel;
        resolvedWeight = familySignal.weight;
        resolvedStyle = familySignal.style;
      }
    }

    const sourceStem = deriveFontUrlStem(selectedSource.url);
    const sourceLabel = normalizeSpace(
      humanizeFamilyLabel(sourceStem || "")
        .replace(/\b(?:vf|var|variable)\b$/i, "")
        .replace(/\bweb\b$/i, "")
    );
    const sourceSignal = inferStyleSuffixFromLabel(sourceLabel);
    if (sourceSignal) {
      const cssFamilyToken = normalizeToken(humanizeFamilyLabel(family));
      const sourceFamilyToken = normalizeToken(sourceSignal.family);
      const sameFamilyGroup =
        Boolean(cssFamilyToken && sourceFamilyToken) &&
        (cssFamilyToken === sourceFamilyToken ||
          cssFamilyToken.includes(sourceFamilyToken) ||
          sourceFamilyToken.includes(cssFamilyToken));
      const currentScore = scoreStyleSignal(resolvedStyleLabel, resolvedWeight, resolvedStyle);
      const sourceScore = scoreStyleSignal(sourceSignal.styleLabel, sourceSignal.weight, sourceSignal.style);
      if (sameFamilyGroup && sourceScore >= currentScore) {
        resolvedFamily = sourceSignal.family;
        resolvedStyleLabel = sourceSignal.styleLabel;
        resolvedWeight = sourceSignal.weight;
        resolvedStyle = sourceSignal.style;
      }
    }

    out.push({
      family: normalizeFamilyAlias(resolvedFamily, resolvedStyleLabel),
      styleLabel: resolvedStyleLabel,
      weight: resolvedWeight,
      style: resolvedStyle,
      discovery: "font-face",
      source: selectedSource
    });
  }

  return out;
};

const selectPrimaryFamilies = (
  entries: FontFaceEntry[],
  usageCorpus: string,
  targetTokens: string[]
): Set<string> => {
  const familyStats = new Map<
    string,
    {
      faceCount: number;
      fontFaceCount: number;
      inferredCount: number;
      usageCount: number;
      preloadCount: number;
      targetBoost: number;
      score: number;
    }
  >();

  for (const entry of entries) {
    const stat =
      familyStats.get(entry.family) ||
      { faceCount: 0, fontFaceCount: 0, inferredCount: 0, usageCount: 0, preloadCount: 0, targetBoost: 0, score: 0 };
    stat.faceCount += 1;
    stat.preloadCount += entry.source.preload ? 1 : 0;
    if (entry.discovery === "font-face") stat.fontFaceCount += 1;
    else stat.inferredCount += 1;
    familyStats.set(entry.family, stat);
  }

  for (const [family, stat] of familyStats) {
    const usageCount = Math.max(0, countMatches(usageCorpus, family) - stat.faceCount);
    const familyToken = normalizeToken(family);
    const targetBoost = targetTokens.some((token) => familyToken.includes(token) || token.includes(familyToken)) ? 6 : 0;
    stat.usageCount = usageCount;
    stat.targetBoost = targetBoost;
    stat.score = stat.fontFaceCount * 6 + stat.inferredCount * 2 + stat.usageCount * 3 + stat.preloadCount * 2 + stat.targetBoost;
  }

  const ranked = Array.from(familyStats.entries())
    .filter(([family]) => !COMMON_FAMILY_STOPWORDS.has(normalizeToken(family)))
    .sort((a, b) => b[1].score - a[1].score || b[1].faceCount - a[1].faceCount || a[0].localeCompare(b[0]));

  if (ranked.length === 0) return new Set<string>();

  const topFamily = ranked[0]?.[0] || "";
  const topScore = ranked[0]?.[1].score || 0;
  const topToken = normalizeToken(topFamily);
  const selected = new Set<string>();

  for (const [family, stat] of ranked) {
    const familyToken = normalizeToken(family);
    const related =
      familyToken === topToken ||
      familyToken.startsWith(topToken) ||
      topToken.startsWith(familyToken) ||
      (familyToken.includes(topToken) && topToken.length >= 4);
    if (stat.score >= Math.max(4, topScore * 0.6) || related) {
      selected.add(family);
    }
  }

  return selected;
};

const collapseFamilyAliases = (entries: FontFaceEntry[], usageCorpus: string): FontFaceEntry[] => {
  const grouped = new Map<string, FontFaceEntry[]>();
  for (const entry of entries) {
    const key = `${entry.source.url}::${entry.styleLabel}::${entry.weight}::${entry.style}`;
    const bucket = grouped.get(key) || [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  const out: FontFaceEntry[] = [];
  for (const bucket of grouped.values()) {
    const canonical = [...bucket].sort((a, b) => {
      const usageDelta = countMatches(usageCorpus, b.family) - countMatches(usageCorpus, a.family);
      if (usageDelta !== 0) return usageDelta;
      const discoveryDelta = Number(b.discovery === "font-face") - Number(a.discovery === "font-face");
      if (discoveryDelta !== 0) return discoveryDelta;
      return b.family.length - a.family.length;
    })[0];
    out.push({ ...canonical });
  }
  return out;
};

const dedupeFontEntries = (entries: FontFaceEntry[]): FontFaceEntry[] => {
  const seen = new Set<string>();
  const out: FontFaceEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.family}::${entry.styleLabel}::${entry.source.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
};

const sourceFormatRank: Record<FontFaceSource["format"], number> = {
  woff2: 4,
  woff: 3,
  otf: 2,
  ttf: 1
};

const dedupeStyleSources = (entries: FontFaceEntry[]): FontFaceEntry[] => {
  const grouped = new Map<string, FontFaceEntry[]>();
  for (const entry of entries) {
    const key = `${normalizeToken(entry.family)}::${normalizeToken(entry.styleLabel)}::${entry.style}`;
    const bucket = grouped.get(key) || [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  const out: FontFaceEntry[] = [];
  for (const bucket of grouped.values()) {
    const preferred = [...bucket].sort((a, b) => {
      const formatDelta = sourceFormatRank[b.source.format] - sourceFormatRank[a.source.format];
      if (formatDelta !== 0) return formatDelta;
      const preloadDelta = Number(b.source.preload) - Number(a.source.preload);
      if (preloadDelta !== 0) return preloadDelta;
      const discoveryDelta = Number(b.discovery === "font-face") - Number(a.discovery === "font-face");
      if (discoveryDelta !== 0) return discoveryDelta;
      const variableDelta = Number(a.source.variableSource) - Number(b.source.variableSource);
      if (variableDelta !== 0) return variableDelta;
      return a.source.url.localeCompare(b.source.url);
    })[0];
    out.push(preferred);
  }

  return out;
};

const deriveSourceFamilyStem = (entry: FontFaceEntry): string | undefined => {
  try {
    let stem = deriveFontUrlStem(entry.source.url);
    if (!stem) return undefined;

    const parts = stem.split(/[-_]+/).filter(Boolean);
    while (parts.length > 1 && /^[0-9a-f]{8,}$/i.test(parts[parts.length - 1] || "")) {
      parts.pop();
    }
    stem = parts.join("-");

    const compactStyle = entry.styleLabel.replace(/\s+/g, "");
    const styleToken = normalizeToken(compactStyle);
    const stemToken = normalizeToken(stem);
    if (styleToken && stemToken.endsWith(styleToken) && stem.length > compactStyle.length) {
      stem = stem.slice(0, stem.length - compactStyle.length).replace(/[-_]+$/, "");
    }

    return stem || undefined;
  } catch {
    return undefined;
  }
};

const humanizeFamilyLabel = (value: string): string =>
  normalizeSpace(
    value
      .replace(/[?#].*$/, "")
      .replace(/\.[^.]+$/, "")
      .replace(/\.p\b/gi, " ")
      .replace(/[_-]+/g, " ")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\b[0-9a-f]{8,}\b/gi, " ")
  );

const normalizeFamilyAlias = (family: string, styleLabel: string): string => {
  let normalized = normalizeSpace(family);
  const familySignal = inferStyleSuffixFromLabel(normalized);
  if (familySignal && normalizeToken(familySignal.styleLabel) === normalizeToken(styleLabel)) {
    normalized = familySignal.family;
  }
  if (/\s+Normal$/i.test(normalized) && /^(Regular|Italic|Regular Italic)$/i.test(styleLabel)) {
    normalized = normalized.replace(/\s+Normal$/i, "");
  }
  if (/\s+Extra$/i.test(normalized) && /(Bold|Black|Heavy|Extra)/i.test(styleLabel)) {
    normalized = normalized.replace(/\s+Extra$/i, "");
  }
  return normalizeSpace(normalized);
};

const scoreDisplayCandidate = (value: string): number => {
  const normalized = normalizeSpace(value);
  if (!normalized) return -1_000;
  const words = normalized.split(" ").filter(Boolean);
  let score = words.length * 6;
  if (words.length === 1) score -= 5;
  if (/[A-Z]{2,}/.test(normalized)) score += 4;
  if (/[A-Z][a-z]+\s+[A-Z][a-z]+/.test(normalized)) score += 2;
  if (/^[a-z0-9 ]+$/.test(normalized)) score -= 3;
  return score;
};

const toDisplayFamilyLabel = (entry: FontFaceEntry): string => {
  const rawCandidate = normalizeFamilyAlias(humanizeFamilyLabel(normalizeSpace(entry.family)), entry.styleLabel);
  const stemCandidate = normalizeFamilyAlias(humanizeFamilyLabel(deriveSourceFamilyStem(entry) || ""), entry.styleLabel);
  if (normalizeToken(rawCandidate) && normalizeToken(rawCandidate) === normalizeToken(stemCandidate)) {
    const rawIsLower = /^[a-z0-9 ]+$/.test(rawCandidate);
    const stemIsLower = /^[a-z0-9 ]+$/.test(stemCandidate);
    if (rawIsLower !== stemIsLower) return rawIsLower ? rawCandidate : stemCandidate;
    return rawCandidate;
  }

  const candidates = [
    { source: "family", value: rawCandidate },
    { source: "stem", value: stemCandidate }
  ].filter((candidate) => candidate.value);

  const best = [...candidates].sort((a, b) => {
    const scoreDelta = scoreDisplayCandidate(b.value) - scoreDisplayCandidate(a.value);
    if (scoreDelta !== 0) return scoreDelta;
    return Number(b.source === "stem") - Number(a.source === "stem");
  })[0];

  return best?.value || normalizeSpace(entry.family);
};

const normalizeDisplayEntries = (entries: FontFaceEntry[]): FontFaceEntry[] =>
  dedupeFontEntries(entries.map((entry) => ({ ...entry, family: toDisplayFamilyLabel(entry) })));

const buildExpectedStyles = (entries: FontFaceEntry[]): string[] => {
  const out = new Set<string>();
  for (const entry of entries) {
    out.add(normalizeSpace(`${entry.family} ${entry.styleLabel}`));
  }
  return Array.from(out);
};

const toFileStem = (value: string): string =>
  normalizeSpace(value)
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();

const buildFileNameHint = (family: string, styleLabel: string): string | undefined => {
  const familyStem = toFileStem(family);
  const styleStem = toFileStem(styleLabel);
  if (!familyStem || !styleStem) return undefined;
  return `${familyStem}-${styleStem}`;
};

const buildFontMetadataFromFaces = (
  entries: FontFaceEntry[],
  targetUrl: string,
  pageUrl: string,
  targetProfileSource: string
): FontMetadata[] => {
  const expectedStyles = buildExpectedStyles(entries);
  const targetProfile = {
    profileId: "generic-passive-research-target-profile-v1",
    source: targetProfileSource,
    foundry: "Detected via Generic Scan",
    styleScope: "family-style",
    expectedStyles,
    expectedStyleCount: expectedStyles.length,
    familyDisplay: entries[0]?.family || "generic-font"
  };

  return entries.map((entry) => ({
    url: entry.source.url,
    format: entry.source.format,
    family: entry.family,
    weight: entry.weight,
    style: entry.style,
    downloadable: true,
    metadata: {
      foundry: "Detected via Generic Scan",
      family: entry.family,
      styleName: entry.styleLabel,
      fullName: normalizeSpace(`${entry.family} ${entry.styleLabel}`),
      fileNameHint: buildFileNameHint(entry.family, entry.styleLabel),
      sourceType: entry.discovery === "font-face" ? "generic-font-face" : "generic-passive-research",
      targetUrl,
      pageUrl,
      preload: entry.source.preload,
      targetProfile
    }
  }));
};

const preferTargetFonts = (fonts: FontMetadata[], targetTokens: string[]): FontMetadata[] => {
  if (targetTokens.length === 0) return fonts;
  const matched = fonts.filter((font) => {
    const fileName = (() => {
      try {
        return new URL(font.url).pathname.split("/").pop() || "";
      } catch {
        return font.url.split("/").pop() || "";
      }
    })();
    const haystack = normalizeToken(`${fileName} ${font.family || ""}`);
    return targetTokens.some((token) => haystack.includes(token));
  });
  return matched.length > 0 ? matched : fonts;
};

function createGenericMetadata(url: string): FontMetadata {
  const cleanUrl = url.split("?")[0] || url;
  const filename = cleanUrl.split("/").pop() || "Unknown";
  const ext = filename.split(".").pop() as "woff2" | "woff" | "otf" | "ttf";
  const inferred = inferEntryFromFontUrl(url, new Set<string>());
  const family = inferred?.family || filename.replace(/\.(woff2|woff|otf|ttf)$/i, "").replace(/[-_]/g, " ");
  const styleLabel = inferred?.styleLabel || "Regular";

  return {
    url,
    format: ["woff2", "woff", "otf", "ttf"].includes(ext) ? ext : "woff2",
    family,
    weight: inferred?.weight || "Regular",
    style: inferred?.style || "Normal",
    downloadable: true,
    metadata: {
      foundry: "Detected via Generic Scan",
      family,
      styleName: styleLabel,
      fullName: normalizeSpace(`${family} ${styleLabel}`),
      fileNameHint: buildFileNameHint(family, styleLabel),
      sourceType: "generic-url-scan"
    }
  };
}

const shouldIgnorePassiveResource = (resourceUrl: string): boolean => {
  try {
    const parsed = new URL(resourceUrl);
    if (RESOURCE_NOISE_HOST_RE.test(parsed.host)) return true;
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(?:png|jpe?g|gif|svg|webp|avif|mp4|webm|mp3|woff2?|ttf|otf)$/i.test(pathname)) return true;
    return false;
  } catch {
    return true;
  }
};

const inferResourceKind = (
  resourceUrl: string,
  rel: string,
  asAttr: string,
  typeAttr: string
): ResourceCandidate["kind"] | undefined => {
  const lowerUrl = resourceUrl.toLowerCase();
  const lowerRel = rel.toLowerCase();
  const lowerAs = asAttr.toLowerCase();
  const lowerType = typeAttr.toLowerCase();

  if (lowerRel.includes("stylesheet") || lowerAs === "style" || lowerUrl.includes(".css")) return "css";
  if (lowerRel.includes("manifest") || lowerUrl.includes("manifest") || lowerUrl.includes(".webmanifest")) return "manifest";
  if (lowerType.includes("json") || lowerUrl.includes(".json") || lowerAs === "fetch") return "json";
  if (lowerAs === "script" || lowerUrl.includes(".js") || lowerUrl.includes(".mjs") || lowerRel.includes("modulepreload")) {
    return "js";
  }
  return undefined;
};

const rankResourceCandidate = (candidate: {
  url: string;
  kind: ResourceCandidate["kind"];
  rel: string;
  pageUrl: string;
  targetTokens: string[];
  memoryKey: string;
  selectorMemoryBoosts: Map<string, number>;
}): number => {
  let score = 0;
  if (candidate.kind === "css") score += 120;
  if (candidate.kind === "manifest") score += 100;
  if (candidate.kind === "json") score += 90;
  if (candidate.kind === "js") score += 70;
  if (candidate.rel.includes("preload") || candidate.rel.includes("modulepreload") || candidate.rel.includes("prefetch")) score += 12;

  try {
    const page = new URL(candidate.pageUrl);
    const resource = new URL(candidate.url);
    if (resource.origin === page.origin) score += 20;
    const hostPath = `${resource.host}${resource.pathname}`.toLowerCase();
    if (candidate.targetTokens.some((token) => hostPath.includes(token))) score += 18;
    if (/font|type|glyph|manifest|webpack|_next|assets|build|runtime|app|page-data/i.test(hostPath)) score += 10;
    if (/\.map(?:$|\?)/i.test(resource.pathname)) score -= 40;
  } catch {
    score -= 10;
  }

  const memoryBoost = candidate.selectorMemoryBoosts.get(candidate.memoryKey) || 0;
  if (memoryBoost > 0) score += clampNumber(memoryBoost, 0, 40);

  return score;
};

const upsertResourceCandidate = (
  bucket: Map<string, ResourceCandidate>,
  resourceUrl: string,
  kind: ResourceCandidate["kind"],
  rel: string,
  pageUrl: string,
  targetTokens: string[],
  selectorMemoryBoosts: Map<string, number>
): void => {
  if (!TEXT_RESOURCE_EXT_RE.test(resourceUrl) && kind !== "manifest") return;
  if (shouldIgnorePassiveResource(resourceUrl)) return;
  const memoryKey = buildResourceMemoryKey(resourceUrl, kind, rel);
  const score = rankResourceCandidate({
    url: resourceUrl,
    kind,
    rel,
    pageUrl,
    targetTokens,
    memoryKey,
    selectorMemoryBoosts
  });
  const existing = bucket.get(resourceUrl);
  if (!existing || score > existing.score) {
    bucket.set(resourceUrl, { url: resourceUrl, kind, rel, score, memoryKey });
  }
};

const collectResourceCandidates = (
  $: cheerio.CheerioAPI,
  pageUrl: string,
  targetTokens: string[],
  selectorMemoryBoosts: Map<string, number>
): ResourceCandidate[] => {
  const bucket = new Map<string, ResourceCandidate>();

  $("link[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const rel = normalizeSpace($(el).attr("rel") || "").toLowerCase();
      const asAttr = normalizeSpace($(el).attr("as") || "");
      const typeAttr = normalizeSpace($(el).attr("type") || "");
      const kind = inferResourceKind(absoluteUrl, rel, asAttr, typeAttr);
      if (!kind) return;
      upsertResourceCandidate(bucket, absoluteUrl, kind, rel, pageUrl, targetTokens, selectorMemoryBoosts);
    } catch {
      // ignore malformed href
    }
  });

  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    try {
      const absoluteUrl = new URL(src, pageUrl).toString();
      upsertResourceCandidate(bucket, absoluteUrl, "js", "script", pageUrl, targetTokens, selectorMemoryBoosts);
    } catch {
      // ignore malformed src
    }
  });

  return Array.from(bucket.values())
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, MAX_RESOURCE_CANDIDATES);
};

const readResponseTextWithCap = async (response: Response, maxBytes: number): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let out = "";

  while (bytesRead < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;

    const remaining = maxBytes - bytesRead;
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    bytesRead += chunk.byteLength;
    out += decoder.decode(chunk, { stream: true });

    if (bytesRead >= maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore cancellation issues
      }
      break;
    }
  }

  out += decoder.decode();
  return out;
};

const fetchPassiveDocument = async (candidate: ResourceCandidate, pageUrl: string): Promise<ResearchDocument | null> => {
  const response = await fetchWithRetry(candidate.url, {
    headers: buildBrowserLikeHeaders(pageUrl),
    redirect: "follow",
    cache: "no-store"
  }, {
    timeoutMs: GENERIC_RESOURCE_FETCH_TIMEOUT_MS
  });
  if (!response.ok) return null;

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const looksTextual =
    contentType.startsWith("text/") ||
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    contentType.includes("css") ||
    TEXT_RESOURCE_EXT_RE.test(candidate.url);
  if (!looksTextual) return null;

  const text = await readResponseTextWithCap(response, MAX_RESOURCE_TEXT_BYTES);
  if (!text.trim()) return null;

  return {
    url: candidate.url,
    kind: candidate.kind,
    text,
    inline: false
  };
};

const collectPassiveResearchDocuments = async (
  pageUrl: string,
  html: string,
  $: cheerio.CheerioAPI,
  targetTokens: string[],
  selectorMemorySnapshot: GenericSelectorMemorySnapshot
): Promise<PassiveResearchResult> => {
  const documents: ResearchDocument[] = [];
  const blockedUrls: string[] = [];
  const selectorOutcomes: Array<{
    candidate: ResourceCandidate;
    success: boolean;
    signalScore: number;
  }> = [];

  $("style").each((_, el) => {
    const text = $(el).html() || "";
    const normalized = text.trim();
    if (!normalized) return;
    documents.push({ url: pageUrl, kind: "css", text: normalized, inline: true });
  });

  $("script:not([src])").each((_, el) => {
    const typeAttr = normalizeSpace($(el).attr("type") || "").toLowerCase();
    const scriptId = normalizeSpace($(el).attr("id") || "");
    const text = ($(el).html() || "").trim();
    if (!text) return;

    if (typeAttr.includes("json") || scriptId === "__NEXT_DATA__") {
      documents.push({ url: `${pageUrl}#${scriptId || "inline-json"}`, kind: "inline-json", text, inline: true });
      return;
    }

    if (text.length <= MAX_INLINE_SCRIPT_CHARS && FONT_HINT_RE.test(text)) {
      documents.push({ url: `${pageUrl}#inline-script`, kind: "inline-script", text, inline: true });
    }
  });

  const candidates = collectResourceCandidates($, pageUrl, targetTokens, selectorMemorySnapshot.boosts);
  for (const candidate of candidates) {
    try {
      const document = await fetchPassiveDocument(candidate, pageUrl);
      if (!document) {
        selectorOutcomes.push({ candidate, success: false, signalScore: 0 });
        continue;
      }
      documents.push(document);

      const hintedFonts = resolveFontUrls(document.text, document.url).length;
      const hasFontHint = FONT_HINT_RE.test(document.text);
      const signalScore = clampNumber(
        (hintedFonts > 0 ? 2 : 0) + (hasFontHint ? 1 : 0) + (candidate.kind === "css" ? 1 : 0),
        0,
        4
      );
      selectorOutcomes.push({
        candidate,
        success: hintedFonts > 0 || hasFontHint,
        signalScore
      });
    } catch {
      blockedUrls.push(candidate.url);
      selectorOutcomes.push({ candidate, success: false, signalScore: 0 });
    }
  }

  const selectorMemoryUpdates = await commitSelectorMemoryOutcomes({
    snapshot: selectorMemorySnapshot,
    outcomes: selectorOutcomes
  });

  return {
    documents,
    candidates,
    blockedUrls,
    selectorMemoryHost: selectorMemorySnapshot.host,
    selectorMemoryBoostedCandidates: selectorMemorySnapshot.boostedCount,
    selectorMemoryUpdates
  };
};

const inferEntryFromFontUrl = (fontUrl: string, preloadUrls: Set<string>): FontFaceEntry | undefined => {
  try {
    const stem = deriveFontUrlStem(fontUrl);
    if (!stem) return undefined;
    let family = humanizeFamilyLabel(stem)
      .replace(/\b(?:vf|var|variable)\b$/i, "")
      .replace(/\bweb\b$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!family) return undefined;

    const styleSignal = inferStyleSuffixFromLabel(family);
    let styleLabel = "Regular";
    let weight = "400";
    let style: "Normal" | "Italic" = "Normal";

    if (styleSignal) {
      family = styleSignal.family;
      styleLabel = styleSignal.styleLabel;
      weight = styleSignal.weight;
      style = styleSignal.style;
    }

    if (!family) family = humanizeFamilyLabel(stem).replace(/\b[0-9a-f]{8,}\b/gi, "").trim();
    if (!family || normalizeToken(family).length < 3) return undefined;

    return {
      family,
      styleLabel,
      weight,
      style,
      discovery: "inferred-url",
      source: {
        url: fontUrl,
        format: inferFormatFromUrl(fontUrl),
        preload: preloadUrls.has(fontUrl),
        variableSource: /variable|\bvf\b/i.test(stem)
      }
    };
  } catch {
    return undefined;
  }
};

const buildGenericResult = (params: {
  entries: FontFaceEntry[];
  url: string;
  source: string;
  discoveredFamilyCount: number;
  selectedFamiliesRaw: string[];
  passiveResearch: PassiveResearchResult;
}): ScrapeResult => ({
  scraperName: GenericScraper.name,
  foundryName: "Detected via Generic Scan",
  fonts: buildFontMetadataFromFaces(params.entries, params.url, params.url, params.source),
  originalUrl: params.url,
  targetUrl: params.url,
  expectedCount: params.entries.length,
  metadata: {
    foundry: "Detected via Generic Scan",
    source: params.source,
    researchMode: "html+css+passive-resource-scan",
    selectedFamilies: Array.from(new Set(params.entries.map((entry) => entry.family))),
    selectedFamiliesRaw: params.selectedFamiliesRaw,
    discoveredFamilyCount: params.discoveredFamilyCount,
    resourceProbeCount: params.passiveResearch.candidates.length,
    resourceFetchedCount: params.passiveResearch.documents.filter((document) => !document.inline).length,
    blockedResourceCount: params.passiveResearch.blockedUrls.length,
    selectorMemoryHost: params.passiveResearch.selectorMemoryHost,
    selectorMemoryBoostedCandidates: params.passiveResearch.selectorMemoryBoostedCandidates,
    selectorMemoryUpdates: params.passiveResearch.selectorMemoryUpdates,
    cssLinkCount: params.passiveResearch.candidates.filter((candidate) => candidate.kind === "css").length,
    assetHosts: Array.from(
      new Set(
        params.entries.map((entry) => {
          try {
            return new URL(entry.source.url).host;
          } catch {
            return "";
          }
        })
      )
    ).filter(Boolean),
    researchSources: params.passiveResearch.documents.slice(0, 12).map((document) => ({
      kind: document.kind,
      url: document.url,
      inline: document.inline
    }))
  }
});

export const GenericScraper: Scraper = {
  id: "generic",
  name: "Universal Font Scanner",

  canHandle(url: string): boolean {
    return true;
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const response = await fetchWithRetry(url, {
        headers: buildBrowserLikeHeaders(url),
        cache: "no-store",
        redirect: "follow"
      }, {
        timeoutMs: GENERIC_PRIMARY_FETCH_TIMEOUT_MS
      });
      const html = await response.text();
      const $ = cheerio.load(html);
      const targetTokens = deriveTargetTokens(url, html);
      const preloadUrls = new Set(resolveFontUrls(html, url));
      const selectorMemorySnapshot = await getSelectorMemorySnapshot(url);
      const passiveResearch = await collectPassiveResearchDocuments(url, html, $, targetTokens, selectorMemorySnapshot);
      const researchDocuments: ResearchDocument[] = [{ url, kind: "html", text: html, inline: false }, ...passiveResearch.documents];
      const usageCorpus = researchDocuments.map((document) => document.text).join("\n\n");

      const fontFaceEntries = dedupeFontEntries(
        collapseFamilyAliases(
          researchDocuments.flatMap((document) => parseFontFaceEntries(document.text, document.url, preloadUrls)),
          usageCorpus
        )
      );

      const rawFontUrls = new Set<string>();
      for (const document of researchDocuments) {
        for (const resourceUrl of resolveFontUrls(document.text, document.url)) {
          rawFontUrls.add(resourceUrl);
        }
      }

      const inferredEntries = dedupeFontEntries(
        Array.from(rawFontUrls)
          .map((resourceUrl) => inferEntryFromFontUrl(resourceUrl, preloadUrls))
          .filter((entry): entry is FontFaceEntry => Boolean(entry))
      );

      const combinedEntries = dedupeStyleSources(
        normalizeDisplayEntries(dedupeFontEntries(collapseFamilyAliases([...fontFaceEntries, ...inferredEntries], usageCorpus)))
      ).filter((entry) => normalizeToken(entry.family).length >= 3);

      if (combinedEntries.length > 0) {
        const selectedFamilies = selectPrimaryFamilies(combinedEntries, usageCorpus, targetTokens);
        const selectedEntries = combinedEntries.filter((entry) => selectedFamilies.has(entry.family));
        if (selectedEntries.length > 0) {
          return buildGenericResult({
            entries: selectedEntries,
            url,
            source: fontFaceEntries.length > 0 ? "generic-passive-research" : "generic-inferred-font-url-scan",
            discoveredFamilyCount: Array.from(new Set(combinedEntries.map((entry) => entry.family))).length,
            selectedFamiliesRaw: Array.from(selectedFamilies),
            passiveResearch
          });
        }
      }

      const fonts: FontMetadata[] = [];
      const seenUrls = new Set<string>();
      for (const resourceUrl of rawFontUrls) {
        if (seenUrls.has(resourceUrl)) continue;
        seenUrls.add(resourceUrl);
        fonts.push(createGenericMetadata(resourceUrl));
      }

      const filteredFonts = preferTargetFonts(fonts, targetTokens);
      if (filteredFonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Detected via Generic Scan",
          fonts: [
            {
              url: "browser-intercept",
              format: "woff2",
              family: targetTokens[0] || "generic-font",
              weight: "Regular",
              style: "Normal",
              downloadable: true,
              metadata: {
                foundry: "Detected via Generic Scan",
                targetUrl: url,
                pageUrl: url,
                note: "Fallback browser intercept",
                resourceProbeCount: passiveResearch.candidates.length,
                blockedResourceCount: passiveResearch.blockedUrls.length,
                selectorMemoryHost: passiveResearch.selectorMemoryHost,
                selectorMemoryBoostedCandidates: passiveResearch.selectorMemoryBoostedCandidates,
                selectorMemoryUpdates: passiveResearch.selectorMemoryUpdates
              }
            }
          ],
          originalUrl: url,
          targetUrl: url,
          expectedCount: 1,
          metadata: {
            foundry: "Detected via Generic Scan",
            source: "generic-browser-intercept-fallback",
            resourceProbeCount: passiveResearch.candidates.length,
            blockedResourceCount: passiveResearch.blockedUrls.length,
            selectorMemoryHost: passiveResearch.selectorMemoryHost,
            selectorMemoryBoostedCandidates: passiveResearch.selectorMemoryBoostedCandidates,
            selectorMemoryUpdates: passiveResearch.selectorMemoryUpdates
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Detected via Generic Scan",
        fonts: filteredFonts,
        originalUrl: url,
        targetUrl: url,
        metadata: {
          foundry: "Detected via Generic Scan",
          source: "generic-raw-font-url-scan",
          resourceProbeCount: passiveResearch.candidates.length,
          blockedResourceCount: passiveResearch.blockedUrls.length,
          selectorMemoryHost: passiveResearch.selectorMemoryHost,
          selectorMemoryBoostedCandidates: passiveResearch.selectorMemoryBoostedCandidates,
          selectorMemoryUpdates: passiveResearch.selectorMemoryUpdates
        }
      };
    } catch (error: any) {
      console.error("Generic Scraper Error:", error);
      throw error;
    }
  }
};








