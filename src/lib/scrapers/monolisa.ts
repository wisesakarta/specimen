import { Scraper, ScrapeResult } from "./types";

const MONOLISA_HOST = "monolisa.dev";
const CSS_INITIAL_ENDPOINT = "https://www.monolisa.dev/api/fonts/initial/latest";
const CSS_ALL_ENDPOINT = "https://www.monolisa.dev/api/fonts/all/latest";
const FULL_UNICODE_RANGE = "U+0-10FFFF";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const MONOLISA_EXPECTED_STATIC_STYLES = [
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
const MONOLISA_REQUIRED_FEATURE_TAGS = ["liga", "calt", "zero", "ss01", "ss03", "ss04", "ss15", "ss16", "ss17", "ss18"];

type MonoLisaScope = "full" | "initial" | "all";

type MonoLisaPayload = Record<string, unknown> & {
  version?: string;
  font_family?: string;
  style?: string;
  format?: string;
  unicodeRange?: string;
  include?: unknown[];
  exclude?: unknown[];
};

type ParsedBlock = {
  index: number;
  rawUrl: string;
  resolvedUrl: string;
  weight: string;
  style: "Normal" | "Italic";
  styleToken: "normal" | "italic";
  unicodeRange: string;
  isCoreSubset: boolean;
  version?: string;
  payload?: MonoLisaPayload;
};

const extractBlocks = (css: string): string[] => {
  const blocks: string[] = [];
  const regex = /@font-face\s*{[^}]*}/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(css))) {
    blocks.push(match[0]);
  }
  return blocks;
};

const pick = (block: string, pattern: RegExp, fallback = ""): string => {
  const m = block.match(pattern);
  if (m && m[1]) return m[1].trim();
  return fallback;
};

const extractPayloadToken = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const keyed = parsed.searchParams.get("payload");
    if (keyed) return keyed;
    const rawQuery = parsed.search.replace(/^\?/, "").trim();
    if (!rawQuery) return undefined;
    // MonoLisa payload URLs are often query-only base64 without key/value.
    if (!rawQuery.includes("=")) return rawQuery;
    return undefined;
  } catch {
    // ignore
  }
  return undefined;
};

const decodePayloadFromUrl = (url: string): MonoLisaPayload | undefined => {
  const token = extractPayloadToken(url);
  if (!token) return undefined;
  try {
    const decoded = Buffer.from(decodeURIComponent(token), "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as MonoLisaPayload;
    }
  } catch {
    // ignore
  }
  return undefined;
};

const decodeVersionFromUrl = (url: string): string | undefined => {
  const payload = decodePayloadFromUrl(url);
  if (typeof payload?.version === "string" && payload.version.trim()) {
    return payload.version.trim();
  }
  return undefined;
};

const buildPayloadUrl = (sourceUrl: string, payload: MonoLisaPayload): string => {
  const parsed = new URL(sourceUrl);
  const encoded = encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString("base64"));
  parsed.search = `?${encoded}`;
  parsed.hash = "";
  return parsed.href;
};

const normalizeScope = (scopeParam: string | undefined): MonoLisaScope => {
  const token = (scopeParam || "").trim().toLowerCase();
  if (token === "initial") return "initial";
  if (token === "all") return "all";
  if (token === "core") return "full"; // backward-compatible alias
  return "full";
};

const parseBlocks = (blocks: string[], cssEndpoint: string): ParsedBlock[] =>
  blocks
    .map((block, idx) => {
      const rawUrl = pick(block, /url\(([^)]+)\)/i, "").replace(/^['"]|['"]$/g, "");
      if (!rawUrl) return undefined;

      let resolvedUrl: string;
      try {
        resolvedUrl = new URL(rawUrl, cssEndpoint).href;
      } catch {
        return undefined;
      }

      const weight = pick(block, /font-weight\s*:\s*([^;]+);?/i, "400");
      const styleRaw = pick(block, /font-style\s*:\s*([^;]+);?/i, "normal");
      const styleToken = /italic/i.test(styleRaw) ? "italic" : "normal";
      const style = styleToken === "italic" ? "Italic" : "Normal";
      const unicodeRange = pick(block, /unicode-range\s*:\s*([^;]+);?/i, "");
      const isCoreSubset = /U\+0020-007F/i.test(unicodeRange);
      const payload = decodePayloadFromUrl(resolvedUrl);
      const version = decodeVersionFromUrl(resolvedUrl);

      return {
        index: idx,
        rawUrl,
        resolvedUrl,
        weight,
        style,
        styleToken,
        unicodeRange,
        isCoreSubset,
        version,
        payload
      } satisfies ParsedBlock;
    })
    .filter(Boolean) as ParsedBlock[];

const buildFullRangeFonts = (entries: ParsedBlock[], targetUrl: string): ScrapeResult["fonts"] => {
  const byStyle = new Map<"normal" | "italic", ParsedBlock>();

  for (const entry of entries) {
    const key = entry.styleToken;
    const prev = byStyle.get(key);
    if (!prev) {
      byStyle.set(key, entry);
      continue;
    }

    // Prefer the U+0020-007F source shard as the payload seed.
    if (!prev.isCoreSubset && entry.isCoreSubset) {
      byStyle.set(key, entry);
      continue;
    }

    // If both are equivalent, prefer one with payload we can rewrite.
    if (!prev.payload && entry.payload) {
      byStyle.set(key, entry);
    }
  }

  const targetProfile = {
    foundry: "MonoLisa",
    family: "MonoLisa",
    expectedStaticStyles: MONOLISA_EXPECTED_STATIC_STYLES,
    expectedStaticCount: MONOLISA_EXPECTED_STATIC_STYLES.length,
    requiredFeatureTags: MONOLISA_REQUIRED_FEATURE_TAGS,
    minCmapEntries: 1200,
    minFeatureCount: 30
  };

  return (["normal", "italic"] as const)
    .map((styleToken) => {
      const seed = byStyle.get(styleToken);
      if (!seed) return undefined;

      const payload: MonoLisaPayload = {
        ...(seed.payload || {}),
        version: seed.version || seed.payload?.version,
        font_family: "MonoLisa",
        style: styleToken,
        format: "woff2",
        unicodeRange: FULL_UNICODE_RANGE,
        include: [],
        exclude: []
      };

      const rewrittenUrl = buildPayloadUrl(seed.resolvedUrl, payload);

      return {
        url: rewrittenUrl,
        family: "MonoLisa",
        format: "woff2" as const,
        weight: "100 900",
        style: styleToken === "italic" ? "Italic" : "Normal",
        metadata: {
          foundry: "MonoLisa",
          family: "MonoLisa",
          pageUrl: targetUrl,
          format: "woff2",
          scope: "full",
          sourceMode: "payload-full-range",
          requestedUnicodeRange: FULL_UNICODE_RANGE,
          seedUnicodeRange: seed.unicodeRange || "",
          version: payload.version,
          skipConversion: false,
          forceMetadataRepair: true,
          disableInstanceExplosion: false,
          targetProfile,
          headers: {
            Origin: "https://www.monolisa.dev",
            Referer: targetUrl,
            Accept: "*/*"
          },
          index: seed.index
        }
      };
    })
    .filter(Boolean) as ScrapeResult["fonts"];
};

export const MonoLisaScraper: Scraper = {
  id: "monolisa",
  name: "MonoLisa Scraper",

  canHandle(url: string): boolean {
    return url.includes(MONOLISA_HOST);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const inputUrl = new URL(url);
    const scopeParam = inputUrl.searchParams.get("scope")?.toLowerCase();
    const scope = normalizeScope(scopeParam);
    const cssEndpoint = scope === "all" ? CSS_ALL_ENDPOINT : CSS_INITIAL_ENDPOINT;
    const targetUrl = url.includes("/specimen") ? url : "https://www.monolisa.dev/specimen";

    const res = await fetch(cssEndpoint, {
      headers: {
        "User-Agent": UA,
        Origin: "https://www.monolisa.dev",
        Referer: targetUrl,
        Accept: "text/css,*/*;q=0.8"
      }
    });
    if (!res.ok) {
      throw new Error(`Gagal fetch CSS MonoLisa (${res.status})`);
    }
    const cssText = await res.text();
    const blocks = extractBlocks(cssText);
    const entries = parseBlocks(blocks, cssEndpoint);

    const fonts =
      scope === "full"
        ? buildFullRangeFonts(entries, targetUrl)
        : entries.map((entry) => ({
            url: entry.resolvedUrl,
            family: "MonoLisa",
            format: "woff2" as const,
            weight: entry.weight,
            style: entry.style,
            metadata: {
              foundry: "MonoLisa",
              family: "MonoLisa",
              pageUrl: targetUrl,
              unicodeRange: entry.unicodeRange,
              version: entry.version,
              format: "woff2",
              scope,
              isCoreSubset: entry.isCoreSubset,
              // all/latest contains hundreds of micro-subsets; initial includes language shards.
              // Convert only core subset by default so output remains usable and clean.
              skipConversion: scope === "all" || (scope === "initial" && !entry.isCoreSubset),
              forceMetadataRepair: scope !== "all" && entry.isCoreSubset,
              headers: {
                Origin: "https://www.monolisa.dev",
                Referer: targetUrl,
                Accept: "*/*"
              },
              index: entry.index
            }
          }));

    return {
      scraperName: this.name,
      foundryName: "MonoLisa",
      fonts,
      originalUrl: url,
      targetUrl,
      expectedCount: fonts.length,
      metadata: {
        source: cssEndpoint,
        scope,
        availableScopes: ["full", "initial", "all"],
        hint:
          scope === "all"
            ? "all scope: complete unicode subsets (many small files)"
            : scope === "initial"
              ? "initial scope: starter pack + language subsets"
              : "full scope: 2 full-range variable sources (normal + italic) expanded into 18 static styles at download",
        targetProfile:
          scope === "full"
            ? {
                expectedStaticStyles: MONOLISA_EXPECTED_STATIC_STYLES,
                requiredFeatureTags: MONOLISA_REQUIRED_FEATURE_TAGS,
                minCmapEntries: 1200,
                minFeatureCount: 30
              }
            : undefined,
        collectedAt: new Date().toISOString(),
        totalFonts: fonts.length
      }
    };
  }
};
