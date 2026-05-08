import { Scraper, ScrapeResult } from "./scraper-protocol";

const SASCHA_BENTE_HOST = "saschabente.com";
const FOUNDRY_NAME = "Sascha Bente";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

// Weight map: key = normalized style name (italic stripped, lowercased), value = CSS weight
// "screen"  → 400: optical-size variant of Regular (not a weight class)
// "plakat"  → 700: Plakat = German for "poster", historically a heavy display cut — treat as Bold
// "ultra"   → 900: heavier than Black in some foundry conventions
// "display" → 400: optical-size label, defaults to Regular weight
const STYLE_WEIGHT_MAP: Record<string, string> = {
  hairline: "100",
  thin: "100",
  extralight: "200",
  "extra light": "200",
  ultralight: "200",
  "ultra light": "200",
  light: "300",
  regular: "400",
  roman: "400",
  screen: "400",
  display: "400",
  book: "450",
  medium: "500",
  semibold: "600",
  "semi bold": "600",
  demibold: "600",
  bold: "700",
  plakat: "700",
  extrabold: "800",
  "extra bold": "800",
  ultrabold: "800",
  black: "900",
  heavy: "900",
  ultra: "900"
};

const GRAPHQL_QUERY = `
  query GetCollection($id: ID!) {
    node(id: $id) {
      id
      __typename
      ... on FontCollection {
        name
        fontStyles {
          id
          name
          webfontSources {
            url
            format
          }
        }
      }
    }
  }
`.trim();

type WebfontSource = { url: string; format: string };
type FontStyle = { id: string; name: string; webfontSources: WebfontSource[] };
type GraphQLResponse = {
  data?: {
    node?: {
      __typename: string;
      id: string;
      name: string;
      fontStyles: FontStyle[];
    };
  };
  errors?: { message: string }[];
};

const inferWeight = (styleName: string): string => {
  // Strip italic suffix, trim, and lowercase for matching
  const lower = styleName
    .replace(/\s*italic\s*/i, "")
    .replace(/\s*oblique\s*/i, "")
    .trim()
    .toLowerCase();
  // Exact match first
  if (STYLE_WEIGHT_MAP[lower] !== undefined) return STYLE_WEIGHT_MAP[lower];
  // Word-boundary match for compound style names (e.g. "SB Reimann Std Ultra Italic" → "ultra")
  // Sort keys longest-first so "extra light" matches before "light"
  const sorted = Object.entries(STYLE_WEIGHT_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [key, weight] of sorted) {
    const escaped = key.replace(/[-\s]+/g, "[\\s-]+");
    if (new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i").test(lower)) return weight;
  }
  return "400";
};

const inferStyle = (styleName: string): "Normal" | "Italic" =>
  /italic/i.test(styleName) ? "Italic" : "Normal";

const extractCollectionId = (html: string): string | undefined => {
  // <fontdue-type-testers collection-id="..."> or <fontdue-buy-button collection-id="...">
  const m = html.match(/collection-id="([^"]+)"/);
  return m?.[1];
};

const extractFontdueBaseUrl = (html: string): string => {
  const m = html.match(/fontdue\.initialize\s*\(\s*\{[^}]*url\s*:\s*["']([^"']+)["']/);
  return m?.[1] ?? "";
};

export const SaschaBenteScraper: Scraper = {
  id: "saschabente",
  name: "Sascha Bente (Fontdue)",

  canHandle(url: string): boolean {
    return url.includes(SASCHA_BENTE_HOST);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    // Step 1: fetch the specimen page
    const pageRes = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,*/*;q=0.8"
      }
    });
    if (!pageRes.ok) {
      throw new Error(`Failed to fetch Sascha Bente page (${pageRes.status}): ${url}`);
    }
    const html = await pageRes.text();

    // Step 2: extract Fontdue wiring from HTML
    const collectionId = extractCollectionId(html);
    if (!collectionId) {
      throw new Error(`No Fontdue collection-id found on page: ${url}`);
    }

    const fontdueBase = extractFontdueBaseUrl(html);
    if (!fontdueBase) {
      throw new Error(`No Fontdue base URL found on page: ${url}`);
    }
    const graphqlEndpoint = `${fontdueBase}/graphql`;

    // Step 3: query Fontdue GraphQL
    const gqlRes = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        Origin: new URL(url).origin,
        Referer: url
      },
      body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { id: collectionId } })
    });
    if (!gqlRes.ok) {
      throw new Error(`Fontdue GraphQL request failed (${gqlRes.status})`);
    }
    const gqlData: GraphQLResponse = await gqlRes.json();

    if (gqlData.errors?.length) {
      throw new Error(`Fontdue GraphQL errors: ${gqlData.errors.map((e) => e.message).join("; ")}`);
    }

    const collection = gqlData.data?.node;
    if (!collection || collection.__typename !== "FontCollection") {
      throw new Error(`Unexpected GraphQL response — node is not a FontCollection`);
    }

    const familyName = collection.name; // e.g. "SB Viadukt"
    const fontStyles = collection.fontStyles ?? [];

    // Step 4: map fontStyles → FontMetadata (woff2 only; highest quality)
    const fonts: ScrapeResult["fonts"] = fontStyles.flatMap((fs) => {
      const woff2Source = fs.webfontSources.find((s) => s.format === "woff2");
      if (!woff2Source) return [];
      const weight = inferWeight(fs.name);
      const style = inferStyle(fs.name);
      return [
        {
          url: woff2Source.url,
          family: familyName,
          format: "woff2" as const,
          weight,
          style,
          metadata: {
            foundry: FOUNDRY_NAME,
            family: familyName,
            styleName: fs.name,
            pageUrl: url,
            collectionId,
            graphqlEndpoint,
            fontStyleId: fs.id,
            format: "woff2",
            skipConversion: false,
            forceMetadataRepair: true,
            headers: {
              Origin: new URL(url).origin,
              Referer: url
            }
          }
        }
      ];
    });

    return {
      scraperName: this.name,
      foundryName: FOUNDRY_NAME,
      fonts,
      originalUrl: url,
      targetUrl: url,
      expectedCount: fonts.length,
      metadata: {
        source: graphqlEndpoint,
        collectionId,
        collectionName: familyName,
        totalStyles: fontStyles.length,
        collectedAt: new Date().toISOString()
      }
    };
  }
};
