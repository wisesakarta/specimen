import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const KHTYPE_HOST = "khtype.com";
const KHTYPE_ORIGIN = "https://khtype.com";
const KHTYPE_STORE_ENDPOINT = "https://khtype.com/wp-json/wc/store/v1/products";
const KHTYPE_FETCH_TIMEOUT_MS = 30000;
const KHTYPE_FETCH_MAX_RETRIES = 3;
const KHTYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const BUNDLE_TERM_RE = /(complete[\s-]*(family|set)|complete-family|complete-set)/i;

type KhStyleMode = "Normal" | "Italic";
type KhFormat = "woff2" | "woff" | "otf" | "ttf" | "eot";

type KhStyleTerm = {
  name: string;
  slug: string;
  styleName: string;
  fullName: string;
  style: KhStyleMode;
  weight?: number;
};

type KhFaceSource = {
  format: KhFormat;
  url: string;
};

type KhFaceGroup = {
  family: string;
  familyToken: string;
  style: KhStyleMode;
  weight?: number;
  stemToken: string;
  sources: KhFaceSource[];
  signature: string;
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

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

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
    const cleaned = item.trim();
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
  if (parsed.hostname.toLowerCase() === "www.khtype.com") parsed.hostname = KHTYPE_HOST;
  return parsed.href;
};

const extractSlugFromUrl = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && (parts[0] === "product" || parts[0] === "typeface")) {
      return parts[1].toLowerCase();
    }
  } catch {
    // ignore
  }
  return undefined;
};

const buildProductUrl = (slug: string): string => `${KHTYPE_ORIGIN}/product/${slug}/`;
const buildTypefaceUrl = (slug: string): string => `${KHTYPE_ORIGIN}/typeface/${slug}/`;

const fetchTextWithRetry = async (url: string, headers: Record<string, string>): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= KHTYPE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KHTYPE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < KHTYPE_FETCH_MAX_RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("KH Type fetch failed");
};

const fetchJsonWithRetry = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const text = await fetchTextWithRetry(url, headers);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON payload from ${url}: ${String(error)}`);
  }
};

const extractFamilyNameFromHtml = (html: string, fallbackFamily: string): string => {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const raw = decodeHtml(h1Match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (raw) return raw;
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = decodeHtml((titleMatch?.[1] || "").trim());
  if (title) {
    const head = title.split("|")[0]?.split("-")[0]?.trim();
    if (head) return head;
  }

  return fallbackFamily;
};

const extractSpecimenPdfUrls = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) {
    const raw = asString(match[1]);
    if (!raw) continue;
    try {
      out.add(new URL(decodeHtml(raw), baseUrl).href);
    } catch {
      // ignore malformed URL
    }
  }
  return Array.from(out);
};

const extractSpecimenArchiveUrls = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  const add = (raw: string | undefined) => {
    const value = asString(raw);
    if (!value) return;

    let candidate = decodeHtml(value);
    const encodedMatch = candidate.match(/(?:^|[?&#])download_url=([^&#"'s]+)/i);
    if (encodedMatch?.[1]) {
      try {
        candidate = decodeURIComponent(encodedMatch[1]);
      } catch {
        // keep original candidate
      }
    }

    try {
      const resolved = new URL(candidate, baseUrl);
      if (!/\.zip(?:$|\?)/i.test(resolved.href)) return;
      if (/\/download_url=/i.test(resolved.pathname)) return;
      out.add(resolved.href);
    } catch {
      // ignore malformed URL
    }
  };

  for (const match of html.matchAll(/(?:href|src|action)=["']([^"']+?\.zip(?:\?[^"']*)?)["']/gi)) {
    add(match[1]);
  }
  for (const match of html.matchAll(/value=["']([^"']+?\.zip(?:\?[^"']*)?)["']/gi)) {
    add(match[1]);
  }
  for (const match of html.matchAll(/\\"(https?:\/\/[^\\"]+?\.zip(?:\?[^\\"]*)?)\\"/gi)) {
    add(match[1]);
  }
  for (const match of html.matchAll(/\\"(\/[^\\"]+?\.zip(?:\?[^\\"]*)?)\\"/gi)) {
    add(match[1]);
  }

  return Array.from(out);
};

const pickVariableProduct = (payload: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(payload)) return undefined;
  const rows = payload.filter(isRecord);
  const variable = rows.find((row) => asString(row.type) === "variable");
  return variable || rows[0];
};

const inferWeightFromStyleName = (styleName: string): number | undefined => {
  const token = normalizeToken(styleName);
  if (!token) return undefined;
  if (/^[abc](100|300|500)$/i.test(token)) return Number(token.slice(1));
  if (token.includes("hairline")) return 100;
  if (token.includes("thin")) return 100;
  if (token.includes("extralight")) return 200;
  if (token.includes("light")) return 300;
  if (token.includes("book")) return 350;
  if (token.includes("regular")) return 400;
  if (token.includes("medium")) return 500;
  if (token.includes("semibold")) return 600;
  if (token.includes("bold")) return 700;
  if (token.includes("extrabold")) return 800;
  if (token.includes("black")) return 900;
  return undefined;
};

const normalizeStyleLabel = (value: string): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "Regular";
  if (/^[abc]\d{3}$/i.test(compact)) return compact.toUpperCase();
  return compact
    .replace(/semi[\s-]*bold/gi, "Semibold")
    .replace(/extra[\s-]*light/gi, "Extralight")
    .replace(/extra[\s-]*bold/gi, "Extrabold")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const stripFamilyPrefix = (value: string, familyName: string): string => {
  const label = value.replace(/\s+/g, " ").trim();
  const family = familyName.replace(/\s+/g, " ").trim();
  if (!label || !family) return label;
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escaped}\\s+`, "i");
  const stripped = label.replace(matcher, "").trim();
  if (stripped) return stripped;
  return normalizeToken(label) === normalizeToken(family) ? "Regular" : label;
};

const extractAtomicStyleTerms = (params: {
  product: Record<string, unknown>;
  familyName: string;
}): { styles: KhStyleTerm[]; excludedBundles: string[] } => {
  const { product, familyName } = params;
  const attributes = Array.isArray(product.attributes) ? product.attributes.filter(isRecord) : [];
  const styleAttribute =
    attributes.find((attribute) => asString(attribute.taxonomy) === "pa_single-styles") ||
    attributes.find((attribute) => /styles?/i.test(asString(attribute.name) || ""));

  const terms = Array.isArray(styleAttribute?.terms) ? styleAttribute.terms.filter(isRecord) : [];
  const styles: KhStyleTerm[] = [];
  const excludedBundles: string[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const rawName = decodeHtml(asString(term.name) || "");
    const rawSlug = (asString(term.slug) || rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-")).trim();
    if (!rawName || !rawSlug) continue;
    if (BUNDLE_TERM_RE.test(rawName) || BUNDLE_TERM_RE.test(rawSlug)) {
      excludedBundles.push(rawName);
      continue;
    }

    const styleName = normalizeStyleLabel(stripFamilyPrefix(rawName, familyName));
    const fullName = `${familyName} ${styleName}`.replace(/\s+/g, " ").trim();
    const style: KhStyleMode = /italic|oblique/i.test(styleName) ? "Italic" : "Normal";
    const weight = inferWeightFromStyleName(styleName);
    const slug = toSafeSlug(rawSlug) || toSafeSlug(styleName) || "regular";
    const dedupeKey = normalizeToken(`${fullName}|${slug}`);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    styles.push({
      name: rawName,
      slug,
      styleName,
      fullName,
      style,
      weight
    });
  }

  styles.sort((a, b) => `${a.slug}|${a.fullName}`.localeCompare(`${b.slug}|${b.fullName}`));
  return { styles, excludedBundles: dedupeStringList(excludedBundles) };
};

const normalizeFormatToken = (token: string): KhFormat | undefined => {
  const lowered = token.toLowerCase();
  if (lowered.includes("woff2")) return "woff2";
  if (lowered.includes("woff")) return "woff";
  if (lowered.includes("opentype") || lowered.includes("otf")) return "otf";
  if (lowered.includes("truetype") || lowered.includes("ttf")) return "ttf";
  if (lowered.includes("embedded-opentype") || lowered.includes("eot")) return "eot";
  return undefined;
};

const inferFormatFromUrl = (url: string): KhFormat | undefined => {
  if (/\.woff2(?:$|\?)/i.test(url)) return "woff2";
  if (/\.woff(?:$|\?)/i.test(url)) return "woff";
  if (/\.otf(?:$|\?)/i.test(url)) return "otf";
  if (/\.ttf(?:$|\?)/i.test(url)) return "ttf";
  if (/\.eot(?:$|\?)/i.test(url)) return "eot";
  return undefined;
};

const parseFontFaceGroups = (html: string, baseUrl: string): KhFaceGroup[] => {
  const blocks = html.match(/@font-face\s*{[^}]*}/gi) || [];
  const groups: KhFaceGroup[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const family = decodeHtml(asString(block.match(/font-family\s*:\s*['"]?([^;'\"]+)['"]?\s*;/i)?.[1]) || "");
    if (!family) continue;

    const styleRaw = asString(block.match(/font-style\s*:\s*([^;]+);?/i)?.[1]) || "normal";
    const style: KhStyleMode = /italic|oblique/i.test(styleRaw) ? "Italic" : "Normal";
    const weight = asNumber(asString(block.match(/font-weight\s*:\s*([^;]+);?/i)?.[1]));

    const byFormat = new Map<KhFormat, string>();
    for (const match of block.matchAll(/url\(([^)]+)\)\s*format\(([^)]+)\)/gi)) {
      const rawUrl = asString(String(match[1] || "").replace(/^['"]|['"]$/g, ""));
      const rawFormat = asString(String(match[2] || "").replace(/^['"]|['"]$/g, ""));
      if (!rawUrl || !rawFormat) continue;
      const format = normalizeFormatToken(rawFormat) || inferFormatFromUrl(rawUrl);
      if (!format) continue;
      try {
        const resolved = new URL(rawUrl, baseUrl).href;
        if (!byFormat.has(format)) byFormat.set(format, resolved);
      } catch {
        // ignore malformed URL
      }
    }

    if (byFormat.size === 0) {
      for (const match of block.matchAll(/url\(([^)]+)\)/gi)) {
        const rawUrl = asString(String(match[1] || "").replace(/^['"]|['"]$/g, ""));
        if (!rawUrl) continue;
        const format = inferFormatFromUrl(rawUrl);
        if (!format) continue;
        try {
          const resolved = new URL(rawUrl, baseUrl).href;
          if (!byFormat.has(format)) byFormat.set(format, resolved);
        } catch {
          // ignore malformed URL
        }
      }
    }

    if (byFormat.size === 0) continue;

    const sources = Array.from(byFormat.entries())
      .map(([format, url]) => ({ format, url }))
      .sort((a, b) => ["woff2", "woff", "otf", "ttf", "eot"].indexOf(a.format) - ["woff2", "woff", "otf", "ttf", "eot"].indexOf(b.format));

    const primaryUrl = sources[0]?.url || "";
    const primaryFile = primaryUrl.split("/").pop() || "";
    const stem = primaryFile.replace(/\?.*$/, "").replace(/\.(woff2?|otf|ttf|eot)$/i, "");

    const familyToken = normalizeToken(family);
    const stemToken = normalizeToken(stem);
    const signature = `${familyToken}|${style}|${String(weight ?? "")}|${stemToken}`;
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);

    groups.push({
      family,
      familyToken,
      style,
      weight,
      stemToken,
      sources,
      signature
    });
  }

  return groups;
};

const buildMatchingTokens = (style: KhStyleTerm): string[] =>
  Array.from(new Set([...style.slug.split("-"), ...style.styleName.split(/\s+/g)].map(normalizeToken).filter(Boolean)));

const scoreFace = (style: KhStyleTerm, face: KhFaceGroup): number => {
  let score = 0;
  if (style.style === face.style) score += 45;
  else score -= 25;

  if (typeof style.weight === "number" && Number.isFinite(style.weight) && typeof face.weight === "number") {
    if (style.weight === face.weight) score += 40;
    else if (Math.floor(style.weight / 100) === Math.floor(face.weight / 100)) score += 20;
    else score -= 8;
  }

  for (const token of buildMatchingTokens(style)) {
    if (face.stemToken.includes(token)) score += 8;
    else score -= 4;
  }

  return score;
};

const mapStylesToFaces = (styles: KhStyleTerm[], faces: KhFaceGroup[], familyName: string): Map<string, KhFaceGroup> => {
  const familyToken = normalizeToken(familyName);
  let candidates = faces.filter((face) => face.familyToken === familyToken);
  if (candidates.length === 0) {
    candidates = faces.filter((face) => face.familyToken.includes(familyToken) || familyToken.includes(face.familyToken));
  }
  if (candidates.length === 0) candidates = faces;

  const assigned = new Set<string>();
  const out = new Map<string, KhFaceGroup>();

  for (const style of styles) {
    const ranked = candidates
      .map((face) => ({ face, score: scoreFace(style, face) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);
    if (ranked.length === 0) continue;
    const pick = ranked.find((row) => !assigned.has(row.face.signature)) || ranked[0];
    if (!pick) continue;
    assigned.add(pick.face.signature);
    out.set(style.slug, pick.face);
  }

  return out;
};

const buildTargetProfile = (params: {
  targetUrl: string;
  slug: string;
  familyName: string;
  styles: KhStyleTerm[];
  specimenPdfUrls: string[];
  specimenArchiveUrls: string[];
  excludedBundles: string[];
}): Record<string, unknown> => ({
  profileId: "khtype-target-profile-v1",
  source: "khtype-store-api+html-font-face",
  foundry: "KH Type",
  styleScope: "family-style",
  strictMissingStyles: true,
  targetUrl: params.targetUrl,
  family: params.familyName,
  familyDisplay: params.familyName,
  familySlug: params.slug,
  expectedStyles: params.styles.map((style) => style.fullName),
  expectedStyleCount: params.styles.length,
  styleMap: params.styles.map((style) => ({
    styleSlug: style.slug,
    sourceLabel: style.name,
    styleName: style.styleName,
    expectedStyle: style.fullName,
    style: style.style,
    weight: style.weight,
    source: "store-api-pa_single-styles"
  })),
  optionalExcludedStyles: params.excludedBundles,
  excludedStyles: params.excludedBundles,
  specimenPdfUrls: params.specimenPdfUrls,
  specimenArchiveUrls: params.specimenArchiveUrls,
  outputNaming: {
    prefix: "kh-type",
    pattern: "kh-type-{typeface-slug}-{style-slug}.{ext}",
    styleTokenCase: "lowercase",
    separator: "-",
    stableSort: "lexical"
  },
  formatPolicy: "woff2+woff (desktop variants via converter)",
  outputFormats: ["woff2", "woff", "ttf", "otf"],
  collectedAt: new Date().toISOString()
});

const buildFonts = (params: {
  targetUrl: string;
  familyName: string;
  slug: string;
  styles: KhStyleTerm[];
  mapping: Map<string, KhFaceGroup>;
  targetProfile: Record<string, unknown>;
  specimenArchiveUrls: string[];
  referenceUrl: string;
}): FontMetadata[] => {
  const out: FontMetadata[] = [];
  const seen = new Set<string>();
  const foundryPrefix = "kh-type";
  const safeFamilySlug = toSafeSlug(params.slug) || "unknown-family";

  for (const style of params.styles) {
    const face = params.mapping.get(style.slug);
    if (!face) continue;

    const hasWoff2Seed = face.sources.some((item) => item.format === "woff2");
    const safeStyleSlug = toSafeSlug(style.slug) || toSafeSlug(style.styleName) || "regular";
    const baseName = `${foundryPrefix}-${safeFamilySlug}-${safeStyleSlug}`;

    for (const source of face.sources) {
      if (source.format !== "woff2" && source.format !== "woff") continue;
      const dedupeKey = `${style.slug}|${source.format}|${source.url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({
        url: source.url,
        family: params.familyName,
        format: source.format,
        style: style.style,
        weight: style.weight ?? face.weight ?? "Regular",
        downloadable: true,
        note: "KH Type CSS asset.",
        metadata: {
          foundry: "KH Type",
          family: params.familyName,
          familySlug: params.slug,
          styleName: style.styleName,
          fullName: style.fullName,
          sourceLabel: style.name,
          styleSlug: style.slug,
          pageUrl: params.targetUrl,
          targetUrl: params.targetUrl,
          forceMetadataRepair: true,
          skipConversion: source.format !== "woff2" && hasWoff2Seed,
          conversionSeedPreferred: "woff2",
          format: source.format,
          fileNameHint: `${baseName}.${source.format}`,
          targetProfile: params.targetProfile,
          headers: {
            Origin: KHTYPE_ORIGIN,
            Referer: params.targetUrl,
            Accept: "*/*"
          }
        }
      });
    }
  }

  const seenArchives = new Set<string>();
  for (const archiveUrl of params.specimenArchiveUrls) {
    const trimmed = archiveUrl.trim();
    if (!trimmed || seenArchives.has(trimmed)) continue;
    seenArchives.add(trimmed);

    out.push({
      url: trimmed,
      family: params.familyName,
      format: "zip",
      style: "Normal",
      weight: "Regular",
      downloadable: true,
      note: "KH Type trial archive (specimen/technical bundle).",
      metadata: {
        foundry: "KH Type",
        family: params.familyName,
        familySlug: params.slug,
        pageUrl: params.referenceUrl,
        targetUrl: params.referenceUrl,
        skipConversion: true,
        extractSpecimenOnlyZip: true,
        extractSpecimenPdfFromZip: true,
        pruneRawZipAfterExtract: true,
        fileNameHint: `${foundryPrefix}-${safeFamilySlug}-trial.zip`,
        targetProfile: params.targetProfile,
        headers: {
          Origin: KHTYPE_ORIGIN,
          Referer: params.referenceUrl,
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
    const nodes = Array.from(document.querySelectorAll("select, option, button, [role='button'], a"));
    for (const node of nodes.slice(0, 240)) {
      try {
        if (node instanceof HTMLSelectElement) {
          for (let i = 0; i < node.options.length; i += 1) {
            node.selectedIndex = i;
            node.dispatchEvent(new Event("change", { bubbles: true }));
            await sleep(75);
          }
          continue;
        }
        node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      } catch {}
      await sleep(40);
    }
    await sleep(1200);
  })();
`;

export const KHTypeScraper: Scraper = {
  id: "khtype",
  name: "KH Type Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?khtype\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const normalizedInput = normalizeTargetUrl(url);
      const slug = extractSlugFromUrl(normalizedInput);
      if (!slug) {
        return {
          scraperName: this.name,
          foundryName: "KH Type",
          fonts: [],
          originalUrl: url,
          metadata: {
            foundry: "KH Type",
            reason: "slug-not-found"
          }
        };
      }

      const productUrl = buildProductUrl(slug);
      const typefaceUrl = buildTypefaceUrl(slug);
      const [productHtml, typefaceHtml, storePayload] = await Promise.all([
        fetchTextWithRetry(productUrl, {
          "User-Agent": KHTYPE_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: KHTYPE_ORIGIN
        }),
        fetchTextWithRetry(typefaceUrl, {
          "User-Agent": KHTYPE_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: KHTYPE_ORIGIN
        }).catch(() => undefined),
        fetchJsonWithRetry(`${KHTYPE_STORE_ENDPOINT}?slug=${encodeURIComponent(slug)}`, {
          "User-Agent": KHTYPE_UA,
          Accept: "application/json,*/*;q=0.8",
          Referer: KHTYPE_ORIGIN
        })
      ]);

      const referenceUrl = typefaceHtml ? typefaceUrl : productUrl;
      const fontFaceHtml = typefaceHtml || productHtml;

      const product = pickVariableProduct(storePayload);
      const fallbackFamily = slug
        .split(/[-_]+/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      const productName = decodeHtml(asString(product?.name) || "");
      const familyName =
        productName || extractFamilyNameFromHtml(typefaceHtml || productHtml, fallbackFamily || "KH Type");

      const specimenPdfUrls = dedupeStringList([
        ...extractSpecimenPdfUrls(productHtml, productUrl),
        ...(typefaceHtml ? extractSpecimenPdfUrls(typefaceHtml, typefaceUrl) : [])
      ]);
      const specimenArchiveUrls = dedupeStringList([
        ...extractSpecimenArchiveUrls(productHtml, productUrl),
        ...(typefaceHtml ? extractSpecimenArchiveUrls(typefaceHtml, typefaceUrl) : [])
      ]);

      const { styles, excludedBundles } = product
        ? extractAtomicStyleTerms({ product, familyName })
        : { styles: [] as KhStyleTerm[], excludedBundles: [] as string[] };

      const faceGroups = parseFontFaceGroups(fontFaceHtml, referenceUrl);
      const mapping = mapStylesToFaces(styles, faceGroups, familyName);
      const targetProfile = buildTargetProfile({
        targetUrl: referenceUrl,
        slug,
        familyName,
        styles,
        specimenPdfUrls,
        specimenArchiveUrls,
        excludedBundles
      });

      const fonts = buildFonts({
        targetUrl: referenceUrl,
        familyName,
        slug,
        styles,
        mapping,
        targetProfile,
        specimenArchiveUrls,
        referenceUrl
      });

      if (fonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "KH Type",
          fonts: [
            {
              url: "browser-intercept",
              family: familyName,
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "KH Type",
                family: familyName,
                pageUrl: referenceUrl,
                targetUrl: referenceUrl,
                targetProfile
              }
            }
          ],
          originalUrl: url,
          targetUrl: referenceUrl,
          injectScript: buildFallbackInjectScript(),
          expectedCount: styles.length > 0 ? styles.length : undefined,
          metadata: {
            foundry: "KH Type",
            family: familyName,
            targetProfile,
            specimenPdfUrls,
            specimenArchiveUrls,
            fallbackMode: "browser-intercept"
          }
        };
      }

      const mappedStyles = new Set<string>();
      for (const style of styles) {
        if (mapping.has(style.slug)) mappedStyles.add(style.fullName);
      }
      const unmatchedStyles = styles.filter((style) => !mappedStyles.has(style.fullName)).map((style) => style.fullName);

      return {
        scraperName: this.name,
        foundryName: "KH Type",
        fonts,
        originalUrl: url,
        targetUrl: referenceUrl,
        expectedCount: styles.length > 0 ? styles.length : fonts.length,
        metadata: {
          foundry: "KH Type",
          family: familyName,
          familySlug: slug,
          targetProfile,
          specimenPdfUrls,
          specimenArchiveUrls,
          totalFaceGroups: faceGroups.length,
          mappedStyles: mappedStyles.size,
          unmatchedStyles,
          excludedBundles
        }
      };
    } catch (error) {
      console.error("[KHTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "KH Type",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
