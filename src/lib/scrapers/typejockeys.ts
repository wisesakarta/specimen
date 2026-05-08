import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const TYPEJOCKEYS_HOST_RE = /(^|\/\/)(www\.)?typejockeys\.com/i;
const TYPEJOCKEYS_MARKETING_ORIGIN = "https://www.typejockeys.com";
const TYPEJOCKEYS_FONTDUE_GRAPHQL = "https://fontdue.typejockeys.com/graphql";
const TYPEJOCKEYS_FETCH_TIMEOUT_MS = 25_000;
const TYPEJOCKEYS_FETCH_MAX_RETRIES = 3;
const TYPEJOCKEYS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

type GraphQlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type TypejockeysWebfontSource = {
  format?: string;
  url?: string;
};

type TypejockeysFontStyle = {
  id?: string;
  name?: string;
  cssFamily?: string;
  cssStyle?: string;
  cssWeight?: string;
  sku?: { id?: string } | null;
  webfontSources?: TypejockeysWebfontSource[];
};

type TypejockeysFontCollection = {
  id?: string;
  name?: string;
  collectionType?: string;
  designYear?: number | null;
  totalStyles?: number | null;
  isVariableFont?: boolean | null;
  fontStyles?: TypejockeysFontStyle[];
  children?: TypejockeysFontCollection[];
  latestVersion?: { label?: string | null; status?: string | null } | null;
  updatedAt?: string | null;
  url?: string | null;
};

type TypejockeysSlugPayload = {
  viewer?: {
    slug?: {
      name?: string;
      fontCollection?: TypejockeysFontCollection | null;
    } | null;
  } | null;
};

type TypejockeysScope = {
  inputUrl: string;
  targetUrl: string;
  slug: string;
  locale: string;
};

const VIEWER_SLUG_QUERY = `query SpecimenTypejockeysSlug($name:String!){viewer{slug(name:$name){name fontCollection{id name collectionType designYear totalStyles isVariableFont updatedAt url latestVersion{label status} fontStyles{id name cssFamily cssStyle cssWeight sku{id} webfontSources{format url}} children(collectionTypes:[FAMILY]){id name collectionType designYear totalStyles isVariableFont url latestVersion{label status} fontStyles{id name cssFamily cssStyle cssWeight sku{id} webfontSources{format url}}}}}}}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeHttpsUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === "typejockeys.com") {
    parsed.hostname = "www.typejockeys.com";
  }
  return parsed.href;
};

const extractFontSlug = (url: string): { slug: string; locale?: string } | undefined => {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);

    // Marketing page: /en/font/<slug> (or /de/font/<slug>)
    if (parts.length >= 3 && parts[1]?.toLowerCase() === "font") {
      const locale = parts[0]?.toLowerCase();
      const slug = parts[2];
      if (slug) return { slug, locale };
    }

    // Marketing page (no locale): /font/<slug>
    if (parts.length >= 2 && parts[0]?.toLowerCase() === "font") {
      const slug = parts[1];
      if (slug) return { slug };
    }

    // Fontdue page: /fonts/<slugOrId>
    if (parts.length >= 2 && parts[0]?.toLowerCase() === "fonts") {
      const slug = parts[1];
      if (slug) return { slug };
    }
  } catch {
    // ignore
  }
  return undefined;
};

const normalizeLocale = (value: string | undefined): string => {
  const token = String(value || "")
    .trim()
    .toLowerCase();
  if (!token) return "en";
  if (/^[a-z]{2}$/.test(token)) return token;
  return "en";
};

const buildMarketingFontUrl = (slug: string, locale: string): string =>
  `${TYPEJOCKEYS_MARKETING_ORIGIN}/${locale}/font/${encodeURIComponent(slug)}`;

const fetchGraphQlWithRetry = async <T>(params: {
  queryName: string;
  query: string;
  variables: Record<string, unknown>;
  referer: string;
}): Promise<T> => {
  const { queryName, query, variables, referer } = params;
  let lastError: unknown;

  for (let attempt = 1; attempt <= TYPEJOCKEYS_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TYPEJOCKEYS_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(TYPEJOCKEYS_FONTDUE_GRAPHQL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": TYPEJOCKEYS_UA,
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: TYPEJOCKEYS_MARKETING_ORIGIN,
          Referer: referer
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const envelope = (await response.json()) as GraphQlEnvelope<T>;
      if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
        const message = envelope.errors.map((item) => item?.message || "graphql-error").join(" | ");
        throw new Error(message);
      }

      if (envelope.data) return envelope.data;
      throw new Error("GraphQL empty data payload");
    } catch (error) {
      lastError = error;
      if (attempt < TYPEJOCKEYS_FETCH_MAX_RETRIES) {
        await sleep(500 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[Typejockeys] GraphQL ${queryName} gagal: ${message}`);
};

const normalizeStyleLabel = (cssStyle?: string): "Normal" | "Italic" =>
  /italic/i.test(String(cssStyle || "")) ? "Italic" : "Normal";

const pickWebfontUrl = (sources: TypejockeysWebfontSource[] | undefined): { url: string; format: "woff2" | "woff" } | undefined => {
  const list = Array.isArray(sources) ? sources : [];
  const woff2 = list.find((item) => String(item?.format || "").toLowerCase() === "woff2");
  const woff = list.find((item) => String(item?.format || "").toLowerCase() === "woff");
  const candidate = woff2 || woff;
  const url = typeof candidate?.url === "string" ? candidate.url.trim() : "";
  if (!url) return undefined;
  const format = woff2 ? "woff2" : "woff";
  return { url, format };
};

const flattenCollections = (collection?: TypejockeysFontCollection | null): Array<{
  collection: TypejockeysFontCollection;
  familyName: string;
  isChild: boolean;
}> => {
  if (!collection) return [];
  const familyName = typeof collection.name === "string" && collection.name.trim() ? collection.name.trim() : "Typejockeys";

  const out: Array<{ collection: TypejockeysFontCollection; familyName: string; isChild: boolean }> = [
    { collection, familyName, isChild: false }
  ];

  if (Array.isArray(collection.children) && collection.children.length > 0) {
    for (const child of collection.children) {
      if (!child) continue;
      const childName = typeof child.name === "string" && child.name.trim() ? child.name.trim() : familyName;
      out.push({ collection: child, familyName: childName, isChild: true });
    }
  }

  return out;
};

const toFontMetas = (params: {
  scope: TypejockeysScope;
  root: TypejockeysFontCollection;
}): FontMetadata[] => {
  const { scope, root } = params;
  const out: FontMetadata[] = [];
  const seen = new Set<string>();
  const collections = flattenCollections(root);

  for (const { collection, familyName, isChild } of collections) {
    const styles = Array.isArray(collection.fontStyles) ? collection.fontStyles : [];
    for (const style of styles) {
      const source = pickWebfontUrl(style?.webfontSources);
      if (!source) continue;
      if (seen.has(source.url)) continue;
      seen.add(source.url);

      const styleName = typeof style?.name === "string" && style.name.trim() ? style.name.trim() : "Regular";
      const weight = typeof style?.cssWeight === "string" && style.cssWeight.trim() ? style.cssWeight.trim() : undefined;
      const fontStyle = normalizeStyleLabel(style?.cssStyle);
      const fullName = `${familyName} ${styleName}`.trim();
      const fileNameHint = (() => {
        const familyToken = familyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
        const styleToken = styleName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (!familyToken || !styleToken) return undefined;
        return `${familyToken}-${styleToken}.${source.format}`;
      })();

      out.push({
        url: source.url,
        family: familyName,
        format: source.format,
        style: fontStyle,
        weight,
        downloadable: true,
        note: isChild ? "Typejockeys Fontdue webfont (child collection)." : "Typejockeys Fontdue webfont.",
        metadata: {
          foundry: "Typejockeys",
          family: familyName,
          styleName,
          fullName,
          collectionId: collection.id,
          collectionName: collection.name,
          collectionType: collection.collectionType,
          isVariableFont: collection.isVariableFont,
          designYear: collection.designYear,
          latestVersion: collection.latestVersion?.label,
          updatedAt: collection.updatedAt,
          pageUrl: scope.targetUrl,
          targetUrl: scope.targetUrl,
          originalUrl: scope.inputUrl,
          format: source.format,
          fileNameHint,
          forceMetadataRepair: true,
          headers: {
            Origin: TYPEJOCKEYS_MARKETING_ORIGIN,
            Referer: scope.targetUrl,
            Accept: source.format === "woff2" ? "font/woff2,*/*;q=0.8" : "*/*"
          },
          skuId: style?.sku?.id ?? null
        }
      });
    }
  }

  return out;
};

export const TypejockeysScraper: Scraper = {
  id: "typejockeys",
  name: "Typejockeys Precision Scraper",

  canHandle(url: string): boolean {
    return TYPEJOCKEYS_HOST_RE.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const inputUrl = normalizeHttpsUrl(url);
    const slugMatch = extractFontSlug(inputUrl);
    const slug = slugMatch?.slug?.trim();

    if (!slug) {
      throw new Error(
        "Typejockeys: URL harus mengarah ke halaman font. Contoh: https://www.typejockeys.com/en/font/marie"
      );
    }

    const locale = normalizeLocale(slugMatch?.locale);
    const targetUrl = buildMarketingFontUrl(slug, locale);
    const scope: TypejockeysScope = { inputUrl: url, targetUrl, slug, locale };

    const data = await fetchGraphQlWithRetry<TypejockeysSlugPayload>({
      queryName: "viewer.slug",
      query: VIEWER_SLUG_QUERY,
      variables: { name: slug },
      referer: targetUrl
    });

    const collection = data?.viewer?.slug?.fontCollection;
    if (!collection || typeof collection !== "object") {
      return {
        scraperName: this.name,
        foundryName: "Typejockeys",
        fonts: [],
        originalUrl: url,
        targetUrl,
        metadata: {
          foundry: "Typejockeys",
          slug,
          reason: "font-collection-not-found"
        }
      };
    }

    const fonts = toFontMetas({ scope, root: collection });
    const familyName = typeof collection.name === "string" && collection.name.trim() ? collection.name.trim() : "Typejockeys";

    return {
      scraperName: this.name,
      foundryName: "Typejockeys",
      fonts,
      originalUrl: url,
      targetUrl,
      expectedCount: fonts.length || (typeof collection.totalStyles === "number" ? collection.totalStyles : undefined),
      metadata: {
        source: "typejockeys-fontdue-graphql",
        slug,
        locale,
        family: familyName,
        collectionType: collection.collectionType,
        totalStyles: collection.totalStyles,
        collectedAt: new Date().toISOString(),
        totalFonts: fonts.length
      }
    };
  }
};
