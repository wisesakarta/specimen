import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const PRODUCTIONTYPE_HOST = "productiontype.com";
const PRODUCTIONTYPE_ORIGIN = "https://productiontype.com";
const PRODUCTIONTYPE_FONTS_ENDPOINT = `${PRODUCTIONTYPE_ORIGIN}/fonts`;
const PRODUCTIONTYPE_FETCH_TIMEOUT_MS = 30000;
const PRODUCTIONTYPE_FETCH_MAX_RETRIES = 3;
const PRODUCTIONTYPE_MAX_PAGES = 20;
const PRODUCTIONTYPE_EMPTY_PAGE_STOP = 2;
const PRODUCTIONTYPE_NEXT_ACTION_HEADER = "f7c9e2c4583f08976916fd8068127f56ecead0e4";
const PRODUCTIONTYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const PRODUCTIONTYPE_LEGAL_PDF_RE = /(?:eula|license|licen[cs]e|terms|agreement|privacy|cookie)/i;
const PRODUCTIONTYPE_FEATURE_TAG_RE =
  /\b(ss\d{2}|cv\d{2}|liga|dlig|calt|salt|onum|lnum|pnum|tnum|frac|afrc|sups|subs|smcp|c2sc|case|ordn|kern|zero)\b/gi;

const PRODUCTIONTYPE_REQUIRED_FEATURE_TAGS = ["liga", "ss01", "case"];
const PRODUCTIONTYPE_MIN_CMAP_ENTRIES = 400;
const PRODUCTIONTYPE_MIN_FEATURE_COUNT = 10;

type ProductionTypeScope = {
  familySlug?: string;
  subfamilySlug?: string;
};

type ProductionTypeStyleRecord = {
  styleId: string;
  familySlug: string;
  familyName: string;
  subfamilySlug: string;
  subfamilyName: string;
  styleName: string;
  fullName: string;
  styleSlug: string;
  handle?: string;
  fontFilePath: string;
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

const toSafeSlug = (value: string): string =>
  value
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
  if (host === `www.${PRODUCTIONTYPE_HOST}`) parsed.hostname = PRODUCTIONTYPE_HOST;
  parsed.hash = "";
  return parsed.href;
};

const extractScopeFromUrl = (targetUrl: string): ProductionTypeScope => {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
    if (parts.length === 0) return {};

    const fontIndex = parts.indexOf("font");
    if (fontIndex >= 0) {
      const familySlug = parts[fontIndex + 1];
      const subfamilySlug = parts[fontIndex + 2];
      return {
        familySlug: familySlug || undefined,
        subfamilySlug: subfamilySlug || undefined
      };
    }

    const buyIndex = parts.indexOf("buy");
    if (buyIndex >= 0) {
      const familySlug = parts[buyIndex + 1];
      return { familySlug: familySlug || undefined };
    }

    if (parts.length === 1) {
      return { familySlug: parts[0] };
    }
  } catch {
    // ignore malformed URL
  }
  return {};
};

const fetchTextWithRetry = async (
  url: string,
  init: RequestInit,
  timeoutMs: number = PRODUCTIONTYPE_FETCH_TIMEOUT_MS
): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PRODUCTIONTYPE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      if (attempt < PRODUCTIONTYPE_FETCH_MAX_RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Production Type fetch failed");
};

const parseActionEnvelopePayload = (raw: string): Record<string, unknown> | undefined => {
  const lines = raw.split(/\r?\n/g);
  let candidate: string | undefined;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("1:")) {
      candidate = line.slice(2).trim();
      break;
    }
  }

  const fallback = candidate || raw.trim();
  if (!fallback) return undefined;

  try {
    const parsed = JSON.parse(fallback);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const fetchCatalogPage = async (page: number, referer: string): Promise<Record<string, unknown> | undefined> => {
  const body = JSON.stringify([`query.page%3D${page}`]);
  const raw = await fetchTextWithRetry(PRODUCTIONTYPE_FONTS_ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": PRODUCTIONTYPE_UA,
      Accept: "text/x-component,*/*",
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: PRODUCTIONTYPE_ORIGIN,
      Referer: referer,
      "next-action": PRODUCTIONTYPE_NEXT_ACTION_HEADER
    },
    body
  });

  return parseActionEnvelopePayload(raw);
};

const inferWeightValue = (styleName: string): number | undefined => {
  const token = normalizeToken(styleName);
  if (!token) return undefined;

  const numeric = token.match(/(?:^|[^0-9])(1000|950|900|800|700|600|500|450|400|350|300|250|200|100)(?:[^0-9]|$)/);
  if (numeric?.[1]) return Number(numeric[1]);

  if (token.includes("hairline") || token.includes("thin")) return 100;
  if (token.includes("extralight") || token.includes("ultralight")) return 200;
  if (token.includes("light")) return 300;
  if (token.includes("book")) return 350;
  if (token.includes("regular") || token.includes("roman")) return 400;
  if (token.includes("medium")) return 500;
  if (token.includes("semibold") || token.includes("demibold") || token.includes("semilight")) return 600;
  if (token.includes("bold")) return 700;
  if (token.includes("extrabold") || token.includes("ultrabold")) return 800;
  if (token.includes("black") || token.includes("heavy")) return 900;
  return undefined;
};

const inferStyleLabel = (styleName: string): "Normal" | "Italic" =>
  /italic|oblique|kursiv|slanted/i.test(styleName) ? "Italic" : "Normal";

const extractStyleRecordsFromPayload = (payload: Record<string, unknown>): ProductionTypeStyleRecord[] => {
  const out: ProductionTypeStyleRecord[] = [];
  const typefacesProps = isRecord(payload.typefacesProps) ? payload.typefacesProps : undefined;
  const list = typefacesProps && Array.isArray(typefacesProps.list) ? typefacesProps.list : [];

  for (const listRow of list) {
    if (!isRecord(listRow)) continue;
    const familyNode = isRecord(listRow.family) ? listRow.family : undefined;
    if (!familyNode) continue;

    const familySlug = asString(familyNode.slug) || asString(familyNode.handle) || "";
    const familyName =
      asString(familyNode.title) ||
      asString(familyNode.name) ||
      (familySlug ? titleCaseLoose(familySlug.replace(/-/g, " ")) : "Production Type");
    const subfamilies = Array.isArray(familyNode.subfamilies) ? familyNode.subfamilies : [];

    for (const subfamilyRow of subfamilies) {
      if (!isRecord(subfamilyRow)) continue;
      const subfamilySlug = asString(subfamilyRow.slug) || asString(subfamilyRow.handle) || "";
      const subfamilyName =
        asString(subfamilyRow.title) ||
        asString(subfamilyRow.name) ||
        (subfamilySlug ? titleCaseLoose(subfamilySlug.replace(/-/g, " ")) : familyName);
      const styles = Array.isArray(subfamilyRow.styles) ? subfamilyRow.styles : [];

      for (const styleRow of styles) {
        if (!isRecord(styleRow)) continue;

        const fontFilePath = asString(styleRow.fontFilePath);
        if (!fontFilePath) continue;

        const styleName = asString(styleRow.styleName) || asString(styleRow.name) || "Regular";
        const fullName =
          asString(styleRow.title) ||
          `${subfamilyName} ${styleName}`.replace(/\s+/g, " ").trim();
        const styleSlug = toSafeSlug(styleName) || "regular";
        const styleId = asString(styleRow._id) || `${subfamilySlug || familySlug}-${styleSlug}-${normalizeToken(fontFilePath)}`;

        out.push({
          styleId,
          familySlug: familySlug || toSafeSlug(familyName),
          familyName,
          subfamilySlug: subfamilySlug || toSafeSlug(subfamilyName),
          subfamilyName,
          styleName,
          fullName,
          styleSlug,
          handle: asString(styleRow.handle),
          fontFilePath
        });
      }
    }
  }

  return out;
};

const dedupeStyleRecords = (rows: ProductionTypeStyleRecord[]): ProductionTypeStyleRecord[] => {
  const map = new Map<string, ProductionTypeStyleRecord>();
  for (const row of rows) {
    const key = row.styleId || `${row.subfamilySlug}|${row.styleSlug}|${row.fontFilePath}`;
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
};

const collectCatalogStyles = async (referer: string): Promise<{
  rows: ProductionTypeStyleRecord[];
  pagesFetched: number;
  resultsCount?: number;
}> => {
  const all: ProductionTypeStyleRecord[] = [];
  let pagesFetched = 0;
  let emptyStreak = 0;
  let resultsCount: number | undefined;

  for (let page = 1; page <= PRODUCTIONTYPE_MAX_PAGES; page += 1) {
    const payload = await fetchCatalogPage(page, referer);
    pagesFetched += 1;
    if (!payload) {
      emptyStreak += 1;
      if (emptyStreak >= PRODUCTIONTYPE_EMPTY_PAGE_STOP) break;
      continue;
    }

    const typefacesProps = isRecord(payload.typefacesProps) ? payload.typefacesProps : undefined;
    const count = asNumber(typefacesProps?.resultsCount);
    if (count !== undefined) resultsCount = count;

    const rows = dedupeStyleRecords(extractStyleRecordsFromPayload(payload));
    if (rows.length === 0) {
      emptyStreak += 1;
      if (emptyStreak >= PRODUCTIONTYPE_EMPTY_PAGE_STOP) break;
      continue;
    }

    emptyStreak = 0;
    all.push(...rows);
  }

  return {
    rows: dedupeStyleRecords(all),
    pagesFetched,
    resultsCount
  };
};

const filterStylesByScope = (
  rows: ProductionTypeStyleRecord[],
  scope: ProductionTypeScope
): { rows: ProductionTypeStyleRecord[]; reason: string } => {
  if (!scope.familySlug) {
    return {
      rows,
      reason: "catalog-unscoped"
    };
  }

  const familyToken = normalizeToken(scope.familySlug);
  const familyExact = rows.filter((row) => normalizeToken(row.familySlug) === familyToken);
  const familyFuzzy =
    familyExact.length > 0
      ? familyExact
      : rows.filter((row) => {
          const rowFamily = normalizeToken(row.familySlug);
          return rowFamily.includes(familyToken) || familyToken.includes(rowFamily);
        });

  if (!scope.subfamilySlug) {
    return {
      rows: familyFuzzy,
      reason: familyExact.length > 0 ? "family-exact" : "family-fuzzy"
    };
  }

  const subfamilyToken = normalizeToken(scope.subfamilySlug);
  const subfamilyExact = familyFuzzy.filter(
    (row) =>
      normalizeToken(row.subfamilySlug) === subfamilyToken ||
      normalizeToken(row.subfamilyName) === subfamilyToken
  );

  const subfamilyFuzzy =
    subfamilyExact.length > 0
      ? subfamilyExact
      : familyFuzzy.filter((row) => {
          const rowSubSlug = normalizeToken(row.subfamilySlug);
          const rowSubName = normalizeToken(row.subfamilyName);
          return (
            rowSubSlug.includes(subfamilyToken) ||
            subfamilyToken.includes(rowSubSlug) ||
            rowSubName.includes(subfamilyToken) ||
            subfamilyToken.includes(rowSubName)
          );
        });

  return {
    rows: subfamilyFuzzy,
    reason: subfamilyExact.length > 0 ? "subfamily-exact" : "subfamily-fuzzy"
  };
};

const toTesterAssetUrl = (fontFilePath: string): string => {
  const cleaned = fontFilePath.replace(/^\/+/, "").replace(/^cdn\/fonts\//i, "");
  let testerPath = cleaned;

  if (/\.name\.woff2(?:\?.*)?$/i.test(testerPath)) {
    testerPath = testerPath.replace(/\.name\.woff2/i, ".tester.woff2");
  } else if (/\.display\.woff2(?:\?.*)?$/i.test(testerPath)) {
    testerPath = testerPath.replace(/\.display\.woff2/i, ".tester.woff2");
  } else if (!/\.tester\.woff2(?:\?.*)?$/i.test(testerPath) && /\.woff2(?:\?.*)?$/i.test(testerPath)) {
    testerPath = testerPath.replace(/\.woff2/i, ".tester.woff2");
  } else if (/\.woff(?:\?.*)?$/i.test(testerPath)) {
    testerPath = testerPath.replace(/\.woff/i, ".tester.woff2");
  } else if (!/\.woff2$/i.test(testerPath)) {
    testerPath = `${testerPath}.tester.woff2`;
  }

  return `${PRODUCTIONTYPE_ORIGIN}/cdn/fonts/${testerPath}`;
};

const extractSpecimenPdfUrls = (html: string, baseUrl: string): string[] => {
  const urls = new Set<string>();

  const add = (raw: string | undefined): void => {
    const candidate = asString(raw);
    if (!candidate) return;
    try {
      const resolved = new URL(candidate, baseUrl).href;
      if (!/\.pdf(?:$|\?)/i.test(resolved)) return;
      if (PRODUCTIONTYPE_LEGAL_PDF_RE.test(resolved)) return;
      urls.add(resolved);
    } catch {
      // ignore
    }
  };

  for (const match of html.matchAll(/href=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) {
    add(match[1]);
  }
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi)) {
    add(match[0]);
  }

  return Array.from(urls);
};

const extractFeatureTagsFromHtml = (html: string): string[] => {
  const tags = new Set<string>();
  for (const match of html.matchAll(PRODUCTIONTYPE_FEATURE_TAG_RE)) {
    const tag = asString(match[1]);
    if (tag) tags.add(tag.toLowerCase());
  }
  return Array.from(tags).sort();
};

const buildTargetProfile = (params: {
  targetUrl: string;
  scope: ProductionTypeScope;
  rows: ProductionTypeStyleRecord[];
  specimenPdfUrls: string[];
  requiredFeatureTags: string[];
  pagesFetched: number;
  resultsCount?: number;
  scopeReason: string;
}): Record<string, unknown> => {
  const {
    targetUrl,
    scope,
    rows,
    specimenPdfUrls,
    requiredFeatureTags,
    pagesFetched,
    resultsCount,
    scopeReason
  } = params;

  const expectedStyles = dedupeStringList(rows.map((row) => row.fullName));

  return {
    profileId: "productiontype-target-profile-v1",
    source: "productiontype-next-action-fonts-endpoint",
    foundry: "Production Type",
    styleScope: "family-style",
    strictMissingStyles: true,
    failOnTrialAssets: true,
    targetUrl,
    family: rows[0]?.familyName || (scope.familySlug ? titleCaseLoose(scope.familySlug.replace(/-/g, " ")) : "Production Type"),
    familyDisplay:
      rows[0]?.familyName || (scope.familySlug ? titleCaseLoose(scope.familySlug.replace(/-/g, " ")) : "Production Type"),
    familySlug: scope.familySlug,
    subfamilySlug: scope.subfamilySlug,
    scopeReason,
    expectedStyles,
    expectedStyleCount: expectedStyles.length,
    styleMap: rows.map((row) => ({
      styleSlug: row.styleSlug,
      styleName: row.styleName,
      expectedStyle: row.fullName,
      familyName: row.familyName,
      familySlug: row.familySlug,
      subfamilyName: row.subfamilyName,
      subfamilySlug: row.subfamilySlug,
      fontFilePath: row.fontFilePath,
      handle: row.handle
    })),
    requiredFeatureTags,
    minCmapEntries: PRODUCTIONTYPE_MIN_CMAP_ENTRIES,
    minFeatureCount: PRODUCTIONTYPE_MIN_FEATURE_COUNT,
    specimenPdfUrls,
    outputNaming: {
      prefix: "production-type",
      pattern: "production-type-{family-slug}-{subfamily-slug}-{style-slug}.{ext}",
      styleTokenCase: "lowercase",
      separator: "-",
      stableSort: "lexical"
    },
    formatPolicy: "tester-tier-woff2 plus desktop conversion in downloader",
    outputFormats: ["woff2", "ttf", "otf"],
    pagesFetched,
    catalogResultsCount: resultsCount,
    collectedAt: new Date().toISOString()
  };
};

const buildFallbackTargetProfile = (params: {
  targetUrl: string;
  scope: ProductionTypeScope;
  specimenPdfUrls: string[];
  requiredFeatureTags: string[];
  pagesFetched: number;
  resultsCount?: number;
  scopeReason: string;
}): Record<string, unknown> => {
  const {
    targetUrl,
    scope,
    specimenPdfUrls,
    requiredFeatureTags,
    pagesFetched,
    resultsCount,
    scopeReason
  } = params;

  const familyFallback = scope.familySlug
    ? titleCaseLoose(scope.familySlug.replace(/-/g, " "))
    : "Production Type";

  return {
    profileId: "productiontype-target-profile-v1",
    source: "productiontype-next-action-fonts-endpoint-fallback",
    foundry: "Production Type",
    styleScope: "family-style",
    strictMissingStyles: true,
    failOnTrialAssets: true,
    targetUrl,
    family: familyFallback,
    familyDisplay: familyFallback,
    familySlug: scope.familySlug,
    subfamilySlug: scope.subfamilySlug,
    scopeReason,
    expectedStyles: [],
    expectedStyleCount: 0,
    styleMap: [],
    requiredFeatureTags,
    minCmapEntries: PRODUCTIONTYPE_MIN_CMAP_ENTRIES,
    minFeatureCount: PRODUCTIONTYPE_MIN_FEATURE_COUNT,
    specimenPdfUrls,
    outputNaming: {
      prefix: "production-type",
      pattern: "production-type-{family-slug}-{subfamily-slug}-{style-slug}.{ext}",
      styleTokenCase: "lowercase",
      separator: "-",
      stableSort: "lexical"
    },
    formatPolicy: "tester-tier-woff2 plus desktop conversion in downloader",
    outputFormats: ["woff2", "ttf", "otf"],
    pagesFetched,
    catalogResultsCount: resultsCount,
    collectedAt: new Date().toISOString()
  };
};

const buildFonts = (params: {
  rows: ProductionTypeStyleRecord[];
  targetUrl: string;
  targetProfile: Record<string, unknown>;
}): FontMetadata[] => {
  const { rows, targetUrl, targetProfile } = params;
  const out: FontMetadata[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const url = toTesterAssetUrl(row.fontFilePath);
    if (seen.has(url)) continue;
    seen.add(url);

    const safeFamilySlug = toSafeSlug(row.familySlug) || "family";
    const safeSubfamilySlug = toSafeSlug(row.subfamilySlug) || "subfamily";
    const safeStyleSlug = toSafeSlug(row.styleSlug) || "style";

    out.push({
      url,
      family: row.subfamilyName,
      format: "woff2",
      style: inferStyleLabel(row.styleName),
      weight: inferWeightValue(row.styleName) ?? "Regular",
      downloadable: true,
      note: "Production Type tester-tier webfont from fonts action catalog.",
      metadata: {
        foundry: "Production Type",
        family: row.subfamilyName,
        parentFamily: row.familyName,
        familySlug: row.familySlug,
        subfamilySlug: row.subfamilySlug,
        styleName: row.styleName,
        fullName: row.fullName,
        styleId: row.styleId,
        styleHandle: row.handle,
        sourceFontFilePath: row.fontFilePath,
        sourceType: "next-action-fonts",
        pageUrl: targetUrl,
        targetUrl,
        fileNameHint: `production-type-${safeFamilySlug}-${safeSubfamilySlug}-${safeStyleSlug}.woff2`,
        forceMetadataRepair: true,
        targetProfile,
        headers: {
          Origin: PRODUCTIONTYPE_ORIGIN,
          Referer: targetUrl,
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
    const nodes = Array.from(document.querySelectorAll("button,a,[role='button'],[data-font],[data-style],[data-subfamily]"));
    for (const node of nodes.slice(0, 260)) {
      try {
        if (node instanceof HTMLElement) {
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } catch {}
      await sleep(50);
    }
    await sleep(1200);
  })();
`;

export const ProductionTypeScraper: Scraper = {
  id: "productiontype",
  name: "Production Type Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?productiontype\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const normalizedInput = normalizeTargetUrl(url);
      const scope = extractScopeFromUrl(normalizedInput);

      const catalog = await collectCatalogStyles(normalizedInput);
      const filtered = filterStylesByScope(catalog.rows, scope);
      const scopedRows = dedupeStyleRecords(filtered.rows).sort((a, b) =>
        `${a.familySlug}|${a.subfamilySlug}|${a.styleSlug}|${a.styleId}`.localeCompare(
          `${b.familySlug}|${b.subfamilySlug}|${b.styleSlug}|${b.styleId}`
        )
      );

      const scopeTargetUrl =
        scope.familySlug && scope.subfamilySlug
          ? `${PRODUCTIONTYPE_ORIGIN}/font/${scope.familySlug}/${scope.subfamilySlug}`
          : scope.familySlug
            ? `${PRODUCTIONTYPE_ORIGIN}/font/${scope.familySlug}`
            : normalizedInput;

      const pageHtml = await fetchTextWithRetry(scopeTargetUrl, {
        method: "GET",
        headers: {
          "User-Agent": PRODUCTIONTYPE_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: PRODUCTIONTYPE_ORIGIN
        }
      }).catch(() => "");

      const specimenPdfUrls = pageHtml ? extractSpecimenPdfUrls(pageHtml, scopeTargetUrl) : [];
      const pageFeatureTags = pageHtml ? extractFeatureTagsFromHtml(pageHtml) : [];
      const requiredFeatureTags = dedupeStringList([
        ...PRODUCTIONTYPE_REQUIRED_FEATURE_TAGS,
        ...pageFeatureTags
      ]).map((tag) => tag.toLowerCase());

      if (scopedRows.length === 0) {
        const targetProfile = buildFallbackTargetProfile({
          targetUrl: scopeTargetUrl,
          scope,
          specimenPdfUrls,
          requiredFeatureTags,
          pagesFetched: catalog.pagesFetched,
          resultsCount: catalog.resultsCount,
          scopeReason: filtered.reason
        });

        return {
          scraperName: this.name,
          foundryName: "Production Type",
          fonts: [
            {
              url: "browser-intercept",
              family: scope.familySlug ? titleCaseLoose(scope.familySlug.replace(/-/g, " ")) : "Production Type",
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "Production Type",
                pageUrl: scopeTargetUrl,
                targetUrl: scopeTargetUrl,
                reason: "scoped-catalog-empty",
                targetProfile
              }
            }
          ],
          originalUrl: url,
          targetUrl: scopeTargetUrl,
          injectScript: buildFallbackInjectScript(),
          metadata: {
            foundry: "Production Type",
            family: scope.familySlug ? titleCaseLoose(scope.familySlug.replace(/-/g, " ")) : "Production Type",
            subfamily: scope.subfamilySlug ? titleCaseLoose(scope.subfamilySlug.replace(/-/g, " ")) : undefined,
            scope,
            scopeReason: filtered.reason,
            pagesFetched: catalog.pagesFetched,
            catalogResultsCount: catalog.resultsCount,
            specimenPdfUrls,
            targetProfile
          }
        };
      }

      const targetProfile = buildTargetProfile({
        targetUrl: scopeTargetUrl,
        scope,
        rows: scopedRows,
        specimenPdfUrls,
        requiredFeatureTags,
        pagesFetched: catalog.pagesFetched,
        resultsCount: catalog.resultsCount,
        scopeReason: filtered.reason
      });

      const fonts = buildFonts({
        rows: scopedRows,
        targetUrl: scopeTargetUrl,
        targetProfile
      });

      return {
        scraperName: this.name,
        foundryName: "Production Type",
        fonts,
        originalUrl: url,
        targetUrl: scopeTargetUrl,
        expectedCount: scopedRows.length,
        metadata: {
          foundry: "Production Type",
          family: scopedRows[0]?.familyName || "Production Type",
          subfamily: scope.subfamilySlug ? titleCaseLoose(scope.subfamilySlug.replace(/-/g, " ")) : undefined,
          scope,
          scopeReason: filtered.reason,
          pagesFetched: catalog.pagesFetched,
          catalogResultsCount: catalog.resultsCount,
          styleCount: scopedRows.length,
          specimenPdfUrls,
          targetProfile
        }
      };
    } catch (error) {
      console.error("[ProductionTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Production Type",
        fonts: [],
        originalUrl: url
      };
    }
  }
};

