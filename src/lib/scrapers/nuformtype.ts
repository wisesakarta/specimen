import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const NUFORM_HOST = "nuformtype.com";
const NUFORM_ORIGIN = `https://${NUFORM_HOST}`;
const NUFORM_FETCH_TIMEOUT_MS = 30000;
const NUFORM_FETCH_MAX_RETRIES = 3;
const NUFORM_MAX_CSS_FETCH = 14;
const NUFORM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const NUFORM_RESERVED_SLUGS = new Set(["", "info", "www.nuformtype.com"]);
const NUFORM_BLOCKED_LINK_SLUGS = new Set(["wp-content", "wp-includes", "wp-admin", "wp-json", "feed", "tag", "category"]);
const NUFORM_STOP_TOKENS = new Set(["nuform", "type", "fonts", "font", "family", "typeface"]);
const NUFORM_THEME_FONT_RE =
  /\/wp-content\/themes\/semplice7\/assets\/fonts\/|(?:^|[-_/])(inter|satoshi|gambetta|source-code-pro)(?:[-_.]|$)/i;
const NUFORM_LEGAL_PDF_RE = /\b(eula|license|licen[cs]e|terms|agreement|privacy|cookie|policy|refund)\b/i;

const NUFORM_KNOWN_FAMILY_SLUGS = ["rotina", "ozik", "ozik-soft", "roko", "nuform-sans", "brzo", "hermanos", "jaws"];

const NUFORM_FAMILY_ALIAS_MAP: Record<string, string[]> = {
  rotina: ["rotina", "rotinascript", "rotinaswashes"],
  ozik: ["ozik"],
  "ozik-soft": ["oziksoft", "ozik-soft"],
  roko: ["roko"],
  "nuform-sans": ["nuformsans"],
  brzo: ["brzo"],
  hermanos: ["hermanos"],
  jaws: ["jaws", "jawsv02", "jawsv02"]
};

const NUFORM_KNOWN_SPECIMEN_BY_SLUG: Record<string, string[]> = {
  ozik: [`${NUFORM_ORIGIN}/wp-content/uploads/2022/01/OZIK_specimen.pdf`],
  "ozik-soft": [`${NUFORM_ORIGIN}/wp-content/uploads/2023/11/OZIKSoft_specimen.pdf`],
  "nuform-sans": [`${NUFORM_ORIGIN}/wp-content/uploads/2022/02/nuformsans_specimen.pdf`],
  brzo: [`${NUFORM_ORIGIN}/wp-content/uploads/2022/11/BRZO_specimen.pdf`],
  roko: [`${NUFORM_ORIGIN}/wp-content/uploads/2023/03/roko_specimen.pdf`],
  hermanos: [
    `${NUFORM_ORIGIN}/wp-content/uploads/2022/01/Hermanos_specimen_v02.pdf`,
    `${NUFORM_ORIGIN}/wp-content/uploads/2022/01/hermanos_specimen.pdf`
  ],
  jaws: [`${NUFORM_ORIGIN}/wp-content/uploads/2022/01/jaws_specimen.pdf`]
};

type NuformScope = {
  mode: "family" | "catalog";
  familySlug?: string;
  targetUrl: string;
};

type NuformFontCandidate = {
  sourceUrl: string;
  format: FontMetadata["format"];
  familyName: string;
  styleName: string;
  fullName: string;
  style: "Normal" | "Italic";
  weight: string;
  isVariable: boolean;
};

type NuformFamilyResult = {
  familySlug: string;
  familyDisplay: string;
  targetUrl: string;
  fonts: FontMetadata[];
  expectedCount: number;
  specimenPdfUrls: string[];
  targetProfile: Record<string, unknown>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeSpace = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();

const dedupeStringList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = normalizeSpace(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const dedupeUrls = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const url = normalizeSpace(value);
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
};

const toTitleWords = (value: string): string =>
  normalizeSpace(
    value
      .replace(/[_]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/-/g, " ")
  )
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "vf") return "VF";
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");

const inferWeight = (styleName: string, isVariable: boolean): string => {
  if (isVariable) return "Variable";
  const token = normalizeToken(styleName);
  if (token.includes("hairline")) return "Hairline";
  if (token.includes("extrathin")) return "ExtraThin";
  if (token.includes("thin")) return "Thin";
  if (token.includes("extralight") || token.includes("ultralight")) return "ExtraLight";
  if (token.includes("light")) return "Light";
  if (token.includes("regular") || token.includes("roman") || token.includes("normal")) return "Regular";
  if (token.includes("medium")) return "Medium";
  if (token.includes("semibold") || token.includes("demibold")) return "SemiBold";
  if (token.includes("extrabold") || token.includes("ultrabold")) return "ExtraBold";
  if (token.includes("black")) return "Black";
  if (token.includes("bold")) return "Bold";
  return "Regular";
};

const normalizeStyleLabel = (value: string): string => {
  const prepared = normalizeSpace(
    value
      .replace(/VF/gi, "Variable")
      .replace(/ExtraThin/gi, "Extra Thin")
      .replace(/ExtraLight/gi, "Extra Light")
      .replace(/ExtraBold/gi, "Extra Bold")
      .replace(/SemiBold/gi, "Semi Bold")
      .replace(/BoldItalic/gi, "Bold Italic")
      .replace(/LightItalic/gi, "Light Italic")
      .replace(/MediumItalic/gi, "Medium Italic")
      .replace(/ThinItalic/gi, "Thin Italic")
      .replace(/ItalicTight/gi, "Italic Tight")
      .replace(/Roman/gi, "Regular")
  );

  const human = toTitleWords(prepared)
    .replace(/\bSemi Bold\b/g, "SemiBold")
    .replace(/\bExtra Bold\b/g, "ExtraBold")
    .replace(/\bExtra Light\b/g, "ExtraLight")
    .replace(/\bExtra Thin\b/g, "ExtraThin")
    .replace(/\bUltra Bold\b/g, "UltraBold")
    .replace(/\bUltra Light\b/g, "UltraLight")
    .replace(/\s+/g, " ")
    .trim();

  return human || "Regular";
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

const normalizeInputUrl = (url: string): URL => {
  try {
    return new URL(url);
  } catch {
    const prefixed = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(prefixed);
  }
};

const normalizePublicUrl = (rawUrl: string): string => {
  const parsed = normalizeInputUrl(rawUrl);
  parsed.protocol = "https:";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.hostname = host === NUFORM_HOST ? NUFORM_HOST : NUFORM_HOST;
  parsed.hash = "";
  return parsed.href;
};

const resolveScope = (rawUrl: string): NuformScope => {
  const normalized = normalizePublicUrl(rawUrl);
  const parsed = new URL(normalized);
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { mode: "catalog", targetUrl: `${NUFORM_ORIGIN}/` };
  }

  const first = segments[0].toLowerCase();
  const second = segments[1]?.toLowerCase();
  if (first === "www.nuformtype.com" && second === "info") {
    return { mode: "catalog", targetUrl: `${NUFORM_ORIGIN}/` };
  }

  if (!NUFORM_RESERVED_SLUGS.has(first) && !first.includes(".")) {
    return {
      mode: "family",
      familySlug: first,
      targetUrl: `${NUFORM_ORIGIN}/${first}`
    };
  }

  return { mode: "catalog", targetUrl: `${NUFORM_ORIGIN}/` };
};

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= NUFORM_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NUFORM_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": NUFORM_UA,
          Accept: "text/html, text/css, text/plain, application/json, */*;q=0.8",
          Origin: NUFORM_ORIGIN,
          Referer: referer || NUFORM_ORIGIN
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < NUFORM_FETCH_MAX_RETRIES) {
        await sleep(450 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("NuformType fetch failed: " + url);
};

const normalizeAssetUrl = (raw: string, baseUrl: string): string | undefined => {
  const cleaned = normalizeSpace(raw)
    .replace(/\\\//g, "/")
    .replace(/^['"]|['"]$/g, "");
  if (!cleaned) return undefined;

  try {
    const parsed = /^https?:\/\//i.test(cleaned) ? new URL(cleaned) : new URL(cleaned, baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) return undefined;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== NUFORM_HOST) return undefined;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return undefined;
  }
};

const extractAssetUrls = (payload: string, baseUrl: string, kind: "font" | "pdf"): string[] => {
  const out = new Set<string>();
  const extPart = kind === "font" ? "woff2?|otf|ttf" : "pdf";
  const patterns = [
    new RegExp(`https?:\\/\\/[^"'\\s)<>]+?\\.(?:${extPart})(?:\\?[^"'\\s)<>]*)?`, "gi"),
    new RegExp(`https?:\\\\/\\\\/[^"'\\s)<>]+?\\.(?:${extPart})(?:\\\\?[^"'\\s)<>]*)?`, "gi"),
    new RegExp(`\\/wp-content\\/[^"'\\s)<>]+?\\.(?:${extPart})(?:\\?[^"'\\s)<>]*)?`, "gi"),
    new RegExp(`url\\(([^)]+?\\.(?:${extPart})(?:\\?[^)]*)?)\\)`, "gi")
  ];

  for (const pattern of patterns) {
    for (const match of payload.matchAll(pattern)) {
      const candidate = asString(match[1]) || asString(match[0]);
      if (!candidate) continue;
      const normalized = normalizeAssetUrl(candidate, baseUrl);
      if (!normalized) continue;
      out.add(normalized);
    }
  }

  return [...out];
};

const extractStylesheetUrls = (html: string, pageUrl: string): string[] => {
  const out = new Set<string>();
  const relRe = /<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const genericRe = /<link[^>]+href=["']([^"']+\.css[^"']*)["'][^>]*>/gi;

  for (const re of [relRe, genericRe]) {
    for (const match of html.matchAll(re)) {
      const href = asString(match[1]);
      if (!href) continue;
      const absolute = normalizeAssetUrl(href, pageUrl);
      if (!absolute) continue;
      out.add(absolute);
    }
  }

  return [...out];
};

const parseFamilyLinks = (html: string): string[] => {
  const out = new Set<string>();
  const hrefRe = /href=["']([^"']+)["']/gi;
  for (const match of html.matchAll(hrefRe)) {
    const href = asString(match[1]);
    if (!href) continue;
    let absolute: URL;
    try {
      absolute = /^https?:\/\//i.test(href) ? new URL(href) : new URL(href, NUFORM_ORIGIN);
    } catch {
      continue;
    }
    const host = absolute.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== NUFORM_HOST) continue;
    const segments = absolute.pathname.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    const first = segments[0].toLowerCase();
    const second = segments[1]?.toLowerCase();
    if (first === "www.nuformtype.com" && second === "info") continue;
    if (NUFORM_RESERVED_SLUGS.has(first)) continue;
    if (NUFORM_BLOCKED_LINK_SLUGS.has(first)) continue;
    if (first.startsWith("wp-")) continue;
    if (first.includes(".")) continue;
    out.add(first);
  }

  return dedupeStringList([...out, ...NUFORM_KNOWN_FAMILY_SLUGS]).map((slug) => slug.toLowerCase());
};

const extractFamilyDisplayFromHtml = (html: string, familySlug: string): string => {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  const titlePrefix = normalizeSpace(titleMatch.split("–")[0] || titleMatch.split("|")[0] || "");
  if (titlePrefix && !/^nuform\s*type$/i.test(titlePrefix)) return titlePrefix;

  const headingMatch =
    html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ||
    html.match(/<h2[^>]*>([^<]+)<\/h2>/i)?.[1] ||
    "";
  const heading = normalizeSpace(headingMatch);
  if (heading && !/^fonts?$/i.test(heading)) return heading;

  return toTitleWords(familySlug.replace(/-/g, " "));
};

const buildFamilyAliases = (familySlug: string, familyDisplay: string): string[] => {
  const aliases = new Set<string>();
  const fromMap = NUFORM_FAMILY_ALIAS_MAP[familySlug.toLowerCase()] || [];
  for (const alias of fromMap) {
    const token = normalizeToken(alias);
    if (token && token.length >= 3) aliases.add(token);
  }

  const slugParts = familySlug
    .split(/[-_]+/g)
    .map((part) => normalizeToken(part))
    .filter((token) => token.length >= 3 && !NUFORM_STOP_TOKENS.has(token));
  for (const token of slugParts) aliases.add(token);
  if (slugParts.length > 0) aliases.add(slugParts.join(""));

  const nameParts = familyDisplay
    .split(/\s+/g)
    .map((part) => normalizeToken(part))
    .filter((token) => token.length >= 3 && !NUFORM_STOP_TOKENS.has(token));
  for (const token of nameParts) aliases.add(token);
  if (nameParts.length > 0) aliases.add(nameParts.join(""));

  return [...aliases].sort((a, b) => b.length - a.length);
};

const isThemeOrUiFont = (fontUrl: string): boolean => NUFORM_THEME_FONT_RE.test(fontUrl);

const toAssetToken = (assetUrl: string): string => {
  try {
    const parsed = new URL(assetUrl);
    const pathname = `${parsed.pathname} ${parsed.pathname.split("/").pop() || ""}`;
    return normalizeToken(pathname);
  } catch {
    return normalizeToken(assetUrl);
  }
};

const matchesFamilyAliases = (fontUrl: string, aliases: string[]): boolean => {
  if (aliases.length === 0) return true;
  const token = toAssetToken(fontUrl);
  return aliases.some((alias) => alias.length >= 3 && token.includes(alias));
};

const shouldExcludeByFamilySlug = (assetUrl: string, familySlug: string): boolean => {
  const token = toAssetToken(assetUrl);
  const slug = familySlug.toLowerCase();

  if (slug === "ozik" && token.includes("oziksoft")) return true;
  if (slug === "nuform-sans" && (token.includes("nufosans") || token.includes("nusans"))) return true;

  return false;
};

const parseCandidateFromUrl = (fontUrl: string): NuformFontCandidate | undefined => {
  const format = inferFormatFromUrl(fontUrl);
  if (!format) return undefined;

  let fileName = "";
  try {
    fileName = decodeURIComponent(new URL(fontUrl).pathname.split("/").pop() || "");
  } catch {
    return undefined;
  }
  if (!fileName) return undefined;

  const stem = fileName
    .replace(/\.[^.]+$/i, "")
    .replace(/[_-](?:[0-9a-f]{6,}|v?\d+)$/i, "")
    .replace(/_+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stem) return undefined;

  const chunks = stem.split("-").filter(Boolean);
  let familyChunk = chunks[0] || stem;
  let styleChunk = chunks.length > 1 ? chunks.slice(1).join(" ") : "Regular";

  if (chunks.length >= 3 && /^\d+$/.test(chunks[chunks.length - 1])) {
    familyChunk = chunks.slice(0, -2).join(" ");
    styleChunk = chunks[chunks.length - 2];
  }

  const familyName = toTitleWords(familyChunk.replace(/VF$/i, "").trim()) || "Nuform Type";
  const styleName = normalizeStyleLabel(styleChunk);
  const isVariable = /(?:^|[^a-z])vf([^a-z]|$)|variable/i.test(`${familyChunk} ${styleName}`);
  const style = /italic|oblique/i.test(styleName) ? "Italic" : "Normal";
  const fullName = `${familyName} ${styleName}`.replace(/\s+/g, " ").trim();

  return {
    sourceUrl: fontUrl,
    format,
    familyName,
    styleName: isVariable ? (style === "Italic" ? "Variable Italic" : "Variable") : styleName,
    fullName: isVariable ? `${familyName} ${style === "Italic" ? "Variable Italic" : "Variable"}` : fullName,
    style,
    weight: inferWeight(styleName, isVariable),
    isVariable
  };
};

const pickBestCandidates = (candidates: NuformFontCandidate[]): NuformFontCandidate[] => {
  const rank: Record<FontMetadata["format"], number> = {
    woff2: 100,
    otf: 95,
    ttf: 90,
    woff: 80,
    eot: 10,
    zip: 0
  };

  const grouped = new Map<string, NuformFontCandidate[]>();
  for (const candidate of candidates) {
    const key = `${normalizeToken(candidate.familyName)}::${normalizeToken(candidate.styleName)}::${candidate.isVariable ? "var" : "static"}`;
    const list = grouped.get(key) || [];
    list.push(candidate);
    grouped.set(key, list);
  }

  const out: NuformFontCandidate[] = [];
  for (const list of grouped.values()) {
    const best = list
      .slice()
      .sort((a, b) => {
        const scoreA = rank[a.format] || 0;
        const scoreB = rank[b.format] || 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.sourceUrl.localeCompare(b.sourceUrl);
      })[0];
    if (best) out.push(best);
  }

  return out.sort((a, b) => {
    const familyCmp = a.familyName.localeCompare(b.familyName);
    if (familyCmp !== 0) return familyCmp;
    return a.fullName.localeCompare(b.fullName);
  });
};

const buildInjectScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nodes = Array.from(document.querySelectorAll("button,a,[role='button'],[class*='style'],[class*='weight'],[class*='font']"));
    for (const node of nodes.slice(0, 220)) {
      try {
        if (node instanceof HTMLElement) {
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } catch {}
      await sleep(32);
    }
    await sleep(1000);
    window.__specimen_nuform_probe_done = true;
  })();
`;

const toFontMetadata = (
  candidate: NuformFontCandidate,
  targetUrl: string,
  targetProfile: Record<string, unknown>
): FontMetadata => ({
  url: candidate.sourceUrl,
  family: candidate.familyName,
  format: candidate.format,
  style: candidate.style,
  weight: candidate.weight,
  downloadable: true,
  note: "Nuform Type direct asset.",
  metadata: {
    foundry: "Nuform Type",
    family: candidate.familyName,
    styleName: candidate.styleName,
    fullName: candidate.fullName,
    pageUrl: targetUrl,
    targetUrl,
    sourceType: candidate.isVariable ? "variable-static-catalog" : "static-catalog",
    forceMetadataRepair: true,
    targetProfile,
    headers: {
      Origin: NUFORM_ORIGIN,
      Referer: targetUrl,
      Accept: "*/*"
    }
  }
});

const buildTargetProfile = (params: {
  familySlug: string;
  familyDisplay: string;
  targetUrl: string;
  fonts: NuformFontCandidate[];
  aliases: string[];
  specimenPdfUrls: string[];
}): Record<string, unknown> => {
  const expectedStyles = dedupeStringList(params.fonts.map((font) => font.fullName));
  return {
    profileId: "nuformtype-target-profile-v1",
    source: "nuformtype-wordpress-inline-assets",
    foundry: "Nuform Type",
    styleScope: "family-style",
    strictMissingStyles: true,
    targetUrl: params.targetUrl,
    family: params.familyDisplay,
    familyDisplay: params.familyDisplay,
    familySlug: params.familySlug,
    familyAliases: params.aliases,
    expectedStyles,
    expectedStyleCount: expectedStyles.length,
    styleMap: params.fonts.map((font) => ({
      familyName: font.familyName,
      styleName: font.styleName,
      expectedStyle: font.fullName,
      style: font.style,
      weight: font.weight,
      format: font.format,
      sourceUrl: font.sourceUrl,
      sourceType: font.isVariable ? "variable" : "static"
    })),
    requiredFeatureTags: [],
    specimenPdfUrls: params.specimenPdfUrls,
    outputNaming: {
      prefix: "nuform-type",
      pattern: "nuform-type-{family-slug}-{style-slug}.{ext}",
      separator: "-",
      styleTokenCase: "lowercase"
    },
    outputFormats: ["woff2", "woff", "otf", "ttf"],
    collectedAt: new Date().toISOString()
  };
};

const collectFamilyPage = async (familySlug: string, targetUrl: string): Promise<NuformFamilyResult> => {
  const html = await fetchTextWithRetry(targetUrl, targetUrl);
  const familyDisplay = extractFamilyDisplayFromHtml(html, familySlug);
  const aliases = buildFamilyAliases(familySlug, familyDisplay);

  const discoveredFontUrls = new Set<string>();
  const discoveredPdfUrls = new Set<string>();

  for (const url of extractAssetUrls(html, targetUrl, "font")) discoveredFontUrls.add(url);
  for (const url of extractAssetUrls(html, targetUrl, "pdf")) discoveredPdfUrls.add(url);

  const stylesheets = extractStylesheetUrls(html, targetUrl).slice(0, NUFORM_MAX_CSS_FETCH);
  for (const stylesheetUrl of stylesheets) {
    try {
      const cssText = await fetchTextWithRetry(stylesheetUrl, targetUrl);
      for (const url of extractAssetUrls(cssText, stylesheetUrl, "font")) discoveredFontUrls.add(url);
      for (const url of extractAssetUrls(cssText, stylesheetUrl, "pdf")) discoveredPdfUrls.add(url);
    } catch {
      // best-effort: keep scraper resilient against flaky theme assets
    }
  }

  for (const knownPdf of NUFORM_KNOWN_SPECIMEN_BY_SLUG[familySlug] || []) {
    discoveredPdfUrls.add(knownPdf);
  }

  const fontUrls = dedupeUrls(Array.from(discoveredFontUrls))
    .filter((fontUrl) => !isThemeOrUiFont(fontUrl))
    .filter((fontUrl) => matchesFamilyAliases(fontUrl, aliases))
    .filter((fontUrl) => !shouldExcludeByFamilySlug(fontUrl, familySlug));

  const candidates = fontUrls
    .map((fontUrl) => parseCandidateFromUrl(fontUrl))
    .filter((candidate): candidate is NuformFontCandidate => Boolean(candidate));
  const picked = pickBestCandidates(candidates);

  const specimenPdfUrls = dedupeUrls(Array.from(discoveredPdfUrls))
    .filter((pdfUrl) => !NUFORM_LEGAL_PDF_RE.test(pdfUrl))
    .filter((pdfUrl) => matchesFamilyAliases(pdfUrl, aliases) || (NUFORM_KNOWN_SPECIMEN_BY_SLUG[familySlug] || []).includes(pdfUrl));

  const targetProfile = buildTargetProfile({
    familySlug,
    familyDisplay,
    targetUrl,
    fonts: picked,
    aliases,
    specimenPdfUrls
  });

  const fonts = picked.map((candidate) => toFontMetadata(candidate, targetUrl, targetProfile));

  return {
    familySlug,
    familyDisplay,
    targetUrl,
    fonts,
    expectedCount: picked.length,
    specimenPdfUrls,
    targetProfile
  };
};

export const NuformTypeScraper: Scraper = {
  id: "nuformtype",
  name: "Nuform Type Deep Asset Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?nuformtype\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const scope = resolveScope(url);

      if (scope.mode === "family" && scope.familySlug) {
        const family = await collectFamilyPage(scope.familySlug, scope.targetUrl);

        if (family.fonts.length === 0) {
          return {
            scraperName: this.name,
            foundryName: "Nuform Type",
            fonts: [
              {
                url: "browser-intercept",
                family: family.familyDisplay,
                format: "woff2",
                style: "Normal",
                weight: "Regular",
                downloadable: true,
                metadata: {
                  foundry: "Nuform Type",
                  family: family.familyDisplay,
                  targetUrl: family.targetUrl,
                  pageUrl: family.targetUrl,
                  targetProfile: family.targetProfile
                }
              }
            ],
            originalUrl: url,
            targetUrl: family.targetUrl,
            injectScript: buildInjectScript(),
            metadata: {
              foundry: "Nuform Type",
              mode: "family",
              familySlug: family.familySlug,
              familyDisplay: family.familyDisplay,
              targetProfile: family.targetProfile,
              specimenPdfUrls: family.specimenPdfUrls
            }
          };
        }

        return {
          scraperName: this.name,
          foundryName: "Nuform Type",
          fonts: family.fonts,
          originalUrl: url,
          targetUrl: family.targetUrl,
          expectedCount: family.expectedCount,
          metadata: {
            foundry: "Nuform Type",
            mode: "family",
            familySlug: family.familySlug,
            familyDisplay: family.familyDisplay,
            targetProfile: family.targetProfile,
            specimenPdfUrls: family.specimenPdfUrls
          }
        };
      }

      const homeHtml = await fetchTextWithRetry(`${NUFORM_ORIGIN}/`, `${NUFORM_ORIGIN}/`);
      const familySlugs = parseFamilyLinks(homeHtml);
      const familyResults: NuformFamilyResult[] = [];
      const failedFamilies: Array<{ slug: string; error: string }> = [];

      for (const familySlug of familySlugs) {
        const targetUrl = `${NUFORM_ORIGIN}/${familySlug}`;
        try {
          const family = await collectFamilyPage(familySlug, targetUrl);
          familyResults.push(family);
        } catch (error) {
          failedFamilies.push({
            slug: familySlug,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const seen = new Set<string>();
      const fonts: FontMetadata[] = [];
      for (const family of familyResults) {
        for (const font of family.fonts) {
          const key = `${font.url}::${font.family}::${font.style || ""}::${font.weight || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          fonts.push(font);
        }
      }

      const expectedCount = familyResults.reduce((sum, row) => sum + row.expectedCount, 0);

      if (fonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Nuform Type",
          fonts: [],
          originalUrl: url,
          targetUrl: `${NUFORM_ORIGIN}/`,
          injectScript: buildInjectScript(),
          metadata: {
            foundry: "Nuform Type",
            mode: "catalog",
            failedFamilies
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Nuform Type",
        fonts,
        originalUrl: url,
        targetUrl: `${NUFORM_ORIGIN}/`,
        expectedCount: expectedCount || fonts.length,
        metadata: {
          foundry: "Nuform Type",
          mode: "catalog",
          familyCount: familyResults.length,
          families: familyResults.map((family) => ({
            familySlug: family.familySlug,
            familyDisplay: family.familyDisplay,
            capturedCount: family.fonts.length,
            expectedCount: family.expectedCount,
            specimenPdfUrls: family.specimenPdfUrls
          })),
          failedFamilies
        }
      };
    } catch (error) {
      console.error("[NuformTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Nuform Type",
        fonts: [],
        originalUrl: url
      };
    }
  }
};









