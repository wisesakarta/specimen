import { FontMetadata, Scraper, ScrapeResult } from "./scraper-protocol";

const TYPOTHEQUE_HOST = "typotheque.com";
const TYPOTHEQUE_ORIGIN = "https://www.typotheque.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const TYPOTHEQUE_FETCH_ATTEMPTS = 4;
const TYPOTHEQUE_FETCH_TIMEOUT_MS = 20_000;

type NextData = {
  buildId?: string;
  locale?: string;
  defaultLocale?: string;
};

type TryStyle = {
  title?: string;
  fontURL?: string;
  location?: Array<{ tag?: string; value?: number }>;
};

type TryPageProps = {
  family?: {
    title?: string;
    url?: string;
    defaultStyle?: TryStyle;
    encodings?: Array<{ title?: string; url?: string }>;
  };
};

type BuyStyleNode = {
  title?: string;
  fontURL?: string;
  variableFont?: Record<string, unknown> | null;
  location?: Array<{ tag?: string; value?: number }>;
};

type BuyProductNode = {
  title?: string;
  styles?: { nodes?: BuyStyleNode[] };
  childProducts?: { nodes?: BuyProductNode[] };
};

type BuyPageProps = {
  mainFamily?: {
    title?: string;
    url?: string;
  };
  products?: BuyProductNode[];
};

type StyleEntry = {
  productTitle: string;
  familyDisplay: string;
  styleTitle: string;
  fontURL: string;
  isVariable: boolean;
  locationTags: string[];
};

type GroupedAsset = {
  url: string;
  familyName: string;
  styles: string[];
  isVariable: boolean;
  isItalic: boolean;
  fileNameHint: string;
};

type FontUrlTemplate = {
  familyStem: string;
  prefix: string;
  extension: string;
  query: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const dedupeStringList = (values: Iterable<string | undefined>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeSpace(value || "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const toSlug = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/["'.,()[\]{}]+/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toFileToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "font";

const humanizeSlug = (slug: string): string =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const tokenList = (value: string): string[] => normalizeSpace(value).split(/\s+/g).filter(Boolean);
const toCompactStyleStem = (value: string): string => normalizeSpace(value).replace(/[^A-Za-z0-9]+/g, "");
const hasFontExtension = (value: string): boolean => /\.(?:woff2?|otf|ttf)(?:\?|$)/i.test(value);

const containsOrderedTokens = (full: string, base: string): boolean => {
  const fullTokens = tokenList(full).map((token) => token.toLowerCase());
  const baseTokens = tokenList(base).map((token) => token.toLowerCase());
  if (baseTokens.length === 0) return true;

  let cursor = 0;
  for (const token of fullTokens) {
    if (token === baseTokens[cursor]) cursor += 1;
    if (cursor >= baseTokens.length) return true;
  }
  return false;
};

const tokenDifference = (full: string, base: string): string[] => {
  const counts = new Map<string, number>();
  for (const token of tokenList(base)) {
    const key = token.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const remainder: string[] = [];
  for (const token of tokenList(full)) {
    const key = token.toLowerCase();
    const available = counts.get(key) || 0;
    if (available > 0) {
      counts.set(key, available - 1);
      continue;
    }
    remainder.push(token);
  }

  return remainder;
};

const normalizeInputUrl = (input: string): URL => {
  const parsed = new URL(input);
  parsed.hash = "";
  return parsed;
};

const getFamilyScope = (input: string): { pageUrl: string; slug: string } => {
  const parsed = normalizeInputUrl(input);
  if (!parsed.hostname.toLowerCase().includes(TYPOTHEQUE_HOST)) {
    throw new Error("Unsupported Typotheque URL.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const fontsIndex = segments.findIndex((part) => part.toLowerCase() === "fonts");
  if (fontsIndex < 0 || !segments[fontsIndex + 1]) {
    throw new Error("Typotheque scraper expects a family page under /fonts/{slug}.");
  }

  const slug = segments[fontsIndex + 1].trim().toLowerCase();
  return {
    pageUrl: `${parsed.origin}/fonts/${slug}`,
    slug
  };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryStatus = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500;

const fetchWithRetry = async (url: string, init: RequestInit, label: string): Promise<Response> => {
  let lastStatus: number | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < TYPOTHEQUE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(TYPOTHEQUE_FETCH_TIMEOUT_MS)
      });
      if (res.ok || !shouldRetryStatus(res.status) || attempt === TYPOTHEQUE_FETCH_ATTEMPTS - 1) {
        if (!res.ok) throw new Error(`Typotheque ${label} failed (${res.status}) for ${url}`);
        return res;
      }
      lastStatus = res.status;
    } catch (error) {
      lastError = error;
      if (attempt === TYPOTHEQUE_FETCH_ATTEMPTS - 1) break;
    }

    const retryMs = 500 * (attempt + 1) * (attempt + 1);
    await delay(retryMs);
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`Typotheque ${label} failed (${lastStatus || "unknown"}) for ${url}`);
};

const fetchText = async (url: string, referer?: string): Promise<string> => {
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/json,text/css,*/*;q=0.8",
        ...(referer ? { Referer: referer, Origin: TYPOTHEQUE_ORIGIN } : {})
      }
    },
    "fetch"
  );
  return await res.text();
};

const fetchJson = async <T>(url: string, referer?: string): Promise<T> => {
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json,text/plain,*/*",
        ...(referer ? { Referer: referer, Origin: TYPOTHEQUE_ORIGIN } : {})
      }
    },
    "JSON fetch"
  );
  return (await res.json()) as T;
};

const findFontUrlInHtml = (html: string, compactStem: string): string | undefined => {
  if (!compactStem) return undefined;
  const pattern = new RegExp(
    `https://assets\.typotheque\.com/assets/(?:fonts|webfonts)/\d+/${compactStem}\.(?:woff2|woff|otf|ttf)\?v=[^"'\s)]+`,
    "i"
  );
  return html.match(pattern)?.[0];
};

const extractNextData = (html: string): NextData => {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) {
    throw new Error("Typotheque page missing __NEXT_DATA__.");
  }

  const parsed = JSON.parse(match[1]);
  if (!isRecord(parsed)) {
    throw new Error("Typotheque __NEXT_DATA__ payload is invalid.");
  }

  return {
    buildId: asString(parsed.buildId),
    locale: asString(parsed.locale),
    defaultLocale: asString(parsed.defaultLocale)
  };
};

const extractSpecimenPdfUrls = (html: string, baseUrl: string): string[] => {
  const directMatches = [...html.matchAll(/https:\/\/assets\.typotheque\.com\/assets\/pdfspecimens\/[^"' )]+\.pdf/gi)].map(
    (match) => match[0]
  );
  const hrefMatches = [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map((match) => match[1]);

  const urls: string[] = [];
  for (const raw of [...directMatches, ...hrefMatches]) {
    try {
      urls.push(new URL(raw, baseUrl).href);
    } catch {
      // ignore malformed candidates
    }
  }
  return dedupeStringList(urls);
};

const buildDataUrl = (buildId: string, locale: string, slug: string, page: "buy" | "try"): string =>
  `${TYPOTHEQUE_ORIGIN}/_next/data/${buildId}/${locale}/fonts/${slug}/${page}.json?slug=${encodeURIComponent(slug)}`;

const getFamilyDisplayFromProduct = (productTitle: string, styleTitle: string, fallbackFamily: string): string => {
  const product = normalizeSpace(productTitle);
  const style = normalizeSpace(styleTitle);
  if (!product) return fallbackFamily;
  if (!style) return product;

  const suffixPattern = new RegExp(`${style.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  if (suffixPattern.test(product)) {
    const stripped = normalizeSpace(product.replace(suffixPattern, ""));
    if (stripped) return stripped;
  }
  return product;
};

const walkProductTree = (node: BuyProductNode, fallbackFamily: string, entries: StyleEntry[]): void => {
  const productTitle = normalizeSpace(asString(node.title) || fallbackFamily);
  const styles = isRecord(node.styles) && Array.isArray(node.styles.nodes) ? node.styles.nodes : [];

  for (const rawStyle of styles) {
    if (!isRecord(rawStyle)) continue;
    const styleTitle = normalizeSpace(asString(rawStyle.title) || "Regular");
    const fontURL = asString(rawStyle.fontURL);
    if (!fontURL) continue;

    const familyDisplay = getFamilyDisplayFromProduct(productTitle, styleTitle, fallbackFamily);
    const locationTags = Array.isArray(rawStyle.location)
      ? rawStyle.location
          .map((item) => (isRecord(item) ? asString(item.tag) : undefined))
          .filter((tag): tag is string => Boolean(tag))
      : [];

    entries.push({
      productTitle,
      familyDisplay,
      styleTitle,
      fontURL,
      isVariable: isRecord(rawStyle.variableFont) || /\/variable-fonts\//i.test(fontURL),
      locationTags: dedupeStringList(locationTags)
    });
  }

  const children = isRecord(node.childProducts) && Array.isArray(node.childProducts.nodes) ? node.childProducts.nodes : [];
  for (const child of children) {
    if (isRecord(child)) walkProductTree(child, fallbackFamily, entries);
  }
};

const findBestSubtree = (nodes: BuyProductNode[], familyTitle: string, slug: string): BuyProductNode | undefined => {
  const familyToken = toSlug(familyTitle);
  const targetTokens = new Set([familyToken, toSlug(slug), toSlug(humanizeSlug(slug))]);
  let best: { score: number; depth: number; node: BuyProductNode } | undefined;

  const visit = (node: BuyProductNode, depth: number): void => {
    const title = normalizeSpace(asString(node.title) || "");
    const titleToken = toSlug(title);
    let score = 0;
    if (title && title === familyTitle) score += 4;
    if (titleToken && targetTokens.has(titleToken)) score += 3;
    if (titleToken && familyToken && (titleToken.startsWith(familyToken) || familyToken.startsWith(titleToken))) score += 1;

    if (score > 0) {
      if (!best || score > best.score || (score === best.score && depth < best.depth)) {
        best = { score, depth, node };
      }
    }

    const children = isRecord(node.childProducts) && Array.isArray(node.childProducts.nodes) ? node.childProducts.nodes : [];
    for (const child of children) {
      if (isRecord(child)) visit(child, depth + 1);
    }
  };

  for (const node of nodes) {
    if (isRecord(node)) visit(node, 0);
  }

  return best?.node;
};

const combineStyleLabel = (familyDisplay: string, groupFamily: string, styleTitle: string): string => {
  const delta = tokenDifference(familyDisplay, groupFamily).join(" ");
  return normalizeSpace([delta, styleTitle].filter(Boolean).join(" ")) || "Regular";
};

const chooseGroupFamily = (familyDisplays: string[]): string => {
  const unique = dedupeStringList(familyDisplays);
  if (unique.length === 0) return "Font";
  return [...unique].sort((a, b) => {
    const tokenDelta = tokenList(a).length - tokenList(b).length;
    if (tokenDelta !== 0) return tokenDelta;
    return a.length - b.length;
  })[0];
};

const inferItalicGroup = (entries: StyleEntry[], url: string): boolean => {
  if (/italic/i.test(url)) return true;
  if (entries.length === 0) return false;
  return entries.every((entry) => /italic|slanted|backslanted/i.test(entry.styleTitle));
};

const inferFileNameHint = (familyName: string, isVariable: boolean, isItalic: boolean, styles: string[]): string => {
  const familyStem = toFileToken(familyName);
  if (isVariable) {
    return `${familyStem}-variable${isItalic ? "-italic" : ""}.woff2`;
  }
  const styleStem = toFileToken(styles[0] || (isItalic ? "italic" : "regular"));
  return `${familyStem}-${styleStem}.woff2`;
};

const inferPrimaryStyleName = (group: GroupedAsset): string => {
  if (group.isVariable) return group.isItalic ? "Regular Italic" : "Regular";
  return normalizeSpace(group.styles[0] || (group.isItalic ? "Regular Italic" : "Regular"));
};

const shouldDisableExplosion = (group: GroupedAsset): boolean =>
  // Typotheque variable suites often expose complete named instances (e.g. 72 for Zed Text).
  // Keep explosion enabled for practical family ranges so the downloaded output matches
  // full variant coverage expectations instead of collapsing to a single VF file.
  group.isVariable && group.styles.length > 240;

const buildFontUrlTemplates = (entries: StyleEntry[]): FontUrlTemplate[] => {
  const templates = new Map<string, FontUrlTemplate>();

  for (const entry of entries) {
    if (!/^https?:\/\//i.test(entry.fontURL) || !hasFontExtension(entry.fontURL)) continue;

    try {
      const parsed = new URL(entry.fontURL);
      const basename = parsed.pathname.split("/").pop() || "";
      const extensionMatch = basename.match(/\.(woff2|woff|otf|ttf)$/i);
      if (!extensionMatch) continue;

      const familyStem = toCompactStyleStem(entry.familyDisplay);
      const prefix = `${parsed.origin}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)}`;
      const extension = extensionMatch[0];
      const query = parsed.search || "";
      const key = `${familyStem}|${prefix}|${extension}|${query}`;
      if (!templates.has(key)) templates.set(key, { familyStem, prefix, extension, query });
    } catch {
      // ignore malformed URLs
    }
  }

  return [...templates.values()];
};

const repairStyleEntries = (entries: StyleEntry[], html: string): StyleEntry[] => {
  const templates = buildFontUrlTemplates(entries);

  return entries.flatMap((entry) => {
    const rawUrl = normalizeSpace(entry.fontURL);
    if (/^https?:\/\//i.test(rawUrl) && hasFontExtension(rawUrl)) return [entry];
    if (/^\//.test(rawUrl) && hasFontExtension(rawUrl)) {
      return [{ ...entry, fontURL: new URL(rawUrl, TYPOTHEQUE_ORIGIN).href }];
    }

    const compactFamilyStem = toCompactStyleStem(entry.familyDisplay);
    const compactStem = toCompactStyleStem(`${entry.familyDisplay} ${entry.styleTitle}`);
    const htmlMatch = findFontUrlInHtml(html, compactStem);
    if (htmlMatch) return [{ ...entry, fontURL: htmlMatch }];

    if (/^\?/.test(rawUrl)) {
      const template =
        templates.find((item) => compactStem.startsWith(item.familyStem) && item.familyStem === compactFamilyStem) ||
        templates.find((item) => compactStem.startsWith(item.familyStem));

      if (template) {
        return [{ ...entry, fontURL: `${template.prefix}${compactStem}${template.extension}${template.query || rawUrl}` }];
      }
    }

    return [];
  });
};

const groupEntriesByUrl = (entries: StyleEntry[]): GroupedAsset[] => {
  const buckets = new Map<string, StyleEntry[]>();
  for (const entry of entries) {
    const group = buckets.get(entry.fontURL);
    if (group) group.push(entry);
    else buckets.set(entry.fontURL, [entry]);
  }

  const groups: GroupedAsset[] = [];
  for (const [url, groupEntries] of buckets) {
    const familyName = chooseGroupFamily(groupEntries.map((entry) => entry.familyDisplay));
    const styles = dedupeStringList(
      groupEntries.map((entry) => combineStyleLabel(entry.familyDisplay, familyName, entry.styleTitle))
    );
    const isVariable = groupEntries.some((entry) => entry.isVariable) || styles.length > 1;
    const isItalic = inferItalicGroup(groupEntries, url);

    groups.push({
      url,
      familyName,
      styles,
      isVariable,
      isItalic,
      fileNameHint: inferFileNameHint(familyName, isVariable, isItalic, styles)
    });
  }

  return groups.sort((a, b) => a.familyName.localeCompare(b.familyName) || a.url.localeCompare(b.url));
};

const buildFontMetadata = (
  pageUrl: string,
  group: GroupedAsset,
  specimenPdfUrls: string[],
  targetProfile: Record<string, unknown>
): FontMetadata => {
  const primaryStyleName = inferPrimaryStyleName(group);
  const isItalicLike = /italic|slanted|backslanted/i.test(primaryStyleName) || group.isItalic;
  const coveredStyles = group.styles.map((style) => normalizeSpace(`${group.familyName} ${style}`));

  return {
    url: group.url,
    format: "woff2",
    family: group.familyName,
    style: isItalicLike ? "Italic" : "Normal",
    weight: "400",
    downloadable: true,
    note: group.isVariable ? "Typotheque variable webfont." : "Typotheque webfont.",
    metadata: {
      foundry: "Typotheque",
      family: group.familyName,
      pageUrl,
      format: "woff2",
      styleName: primaryStyleName,
      fullName: `${group.familyName} ${primaryStyleName}`.trim(),
      fileNameHint: group.fileNameHint,
      forceMetadataRepair: true,
      disableInstanceExplosion: shouldDisableExplosion(group),
      expectedInstanceCount: group.isVariable ? group.styles.length : 0,
      expectedStyles: group.styles,
      coveredStyles,
      specimenPdfUrls,
      targetProfile,
      headers: {
        Origin: TYPOTHEQUE_ORIGIN,
        Referer: pageUrl,
        Accept: "*/*"
      }
    }
  };
};

const buildTargetProfile = (params: {
  slug: string;
  pageUrl: string;
  familyTitle: string;
  specimenPdfUrls: string[];
  expectedStyles: string[];
  groupedAssets: GroupedAsset[];
  scripts: string[];
  buildId: string;
}): Record<string, unknown> => ({
  profileId: "typotheque-target-profile-v1",
  foundry: "Typotheque",
  family: params.familyTitle,
  familyDisplay: params.familyTitle,
  targetUrl: params.pageUrl,
  targetSlug: params.slug,
  styleScope: "family-style",
  source: "next-data-buy-try",
  buildId: params.buildId,
  specimenPdfUrls: params.specimenPdfUrls,
  expectedStyles: params.expectedStyles,
  expectedStyleCount: params.expectedStyles.length,
  groupedAssetCount: params.groupedAssets.length,
  groupedFamilies: params.groupedAssets.map((group) => group.familyName),
  scripts: params.scripts,
  strictMissingStyles: true
});

const parseTryPageProps = (json: unknown): TryPageProps => {
  if (!isRecord(json) || !isRecord(json.pageProps)) return {};
  return json.pageProps as TryPageProps;
};

const parseBuyPageProps = (json: unknown): BuyPageProps => {
  if (!isRecord(json) || !isRecord(json.pageProps)) return {};
  return json.pageProps as BuyPageProps;
};

export const TypothequeScraper: Scraper = {
  id: "typotheque",
  name: "Typotheque Precision Scraper",

  canHandle(url: string): boolean {
    try {
      return /(^|\.)typotheque\.com$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = getFamilyScope(url);
    const html = await fetchText(scope.pageUrl, scope.pageUrl);
    const nextData = extractNextData(html);
    const buildId = asString(nextData.buildId);
    const locale = asString(nextData.locale) || asString(nextData.defaultLocale) || "en";

    if (!buildId) {
      throw new Error("Typotheque buildId not found.");
    }

    const tryUrl = buildDataUrl(buildId, locale, scope.slug, "try");
    const buyUrl = buildDataUrl(buildId, locale, scope.slug, "buy");
    const [tryPayload, buyPayload] = await Promise.all([
      fetchJson(tryUrl, scope.pageUrl),
      fetchJson(buyUrl, scope.pageUrl)
    ]);

    const tryPage = parseTryPageProps(tryPayload);
    const buyPage = parseBuyPageProps(buyPayload);
    const familyTitle =
      asString(tryPage.family?.title) ||
      asString(buyPage.mainFamily?.title) ||
      humanizeSlug(scope.slug);
    const specimenPdfUrls = extractSpecimenPdfUrls(html, scope.pageUrl);
    const scripts = dedupeStringList((tryPage.family?.encodings || []).map((item) => asString(item.title)));
    const roots = Array.isArray(buyPage.products) ? buyPage.products.filter(isRecord) : [];
    const selectedSubtree = findBestSubtree(roots, familyTitle, scope.slug) || roots[0];

    if (!selectedSubtree) {
      throw new Error(`Typotheque product subtree not found for ${scope.slug}.`);
    }

    const styleEntries: StyleEntry[] = [];
    walkProductTree(selectedSubtree, familyTitle, styleEntries);

    if (styleEntries.length === 0) {
      const fallbackUrl = asString(tryPage.family?.defaultStyle?.fontURL);
      if (!fallbackUrl) {
        throw new Error(`Typotheque style map is empty for ${scope.slug}.`);
      }

      styleEntries.push({
        productTitle: familyTitle,
        familyDisplay: familyTitle,
        styleTitle: normalizeSpace(asString(tryPage.family?.defaultStyle?.title) || "Regular"),
        fontURL: fallbackUrl,
        isVariable: /\/variable-fonts\//i.test(fallbackUrl),
        locationTags: dedupeStringList(
          Array.isArray(tryPage.family?.defaultStyle?.location)
            ? tryPage.family?.defaultStyle?.location.map((item) => (isRecord(item) ? asString(item.tag) : undefined))
            : []
        )
      });
    }

    const repairedEntries = repairStyleEntries(styleEntries, html);
    const relevantEntries = repairedEntries.filter((entry) => containsOrderedTokens(entry.familyDisplay, familyTitle));
    const groupedAssets = groupEntriesByUrl(relevantEntries.length > 0 ? relevantEntries : repairedEntries);
    const expectedStyles = dedupeStringList(
      groupedAssets.flatMap((group) => group.styles.map((style) => normalizeSpace(`${group.familyName} ${style}`)))
    );

    const targetProfile = buildTargetProfile({
      slug: scope.slug,
      pageUrl: scope.pageUrl,
      familyTitle,
      specimenPdfUrls,
      expectedStyles,
      groupedAssets,
      scripts,
      buildId
    });

    const fonts = groupedAssets.map((group) => buildFontMetadata(scope.pageUrl, group, specimenPdfUrls, targetProfile));

    return {
      scraperName: this.name,
      foundryName: "Typotheque",
      fonts,
      originalUrl: url,
      targetUrl: scope.pageUrl,
      expectedCount: groupedAssets.length,
      metadata: {
        foundry: "Typotheque",
        family: familyTitle,
        buildId,
        locale,
        source: "next-data-buy-try",
        buyUrl,
        tryUrl,
        specimenPdfUrls,
        scripts,
        targetProfile
      }
    };
  }
};




