import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const HOST_RE = /(^|\/\/)(www\.)?deinwaller\.com/i;
const ORIGIN = "https://deinwaller.com";
const GRAPHQL = "https://fonts.deinwaller.com/graphql";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const TIMEOUT_MS = 30_000;
const RETRIES = 3;
const CONCURRENCY = 5;

const GENERIC_PATHS = new Set(["", "index", "menu-2", "all-fonts", "trial-fonts-2", "studio", "selected-work"]);
const GENERIC_TOKENS = new Set([
  "index",
  "menu",
  "all",
  "fonts",
  "font",
  "trial",
  "deinwaller",
  "dein",
  "waller"
]);

const CHARACTER_VIEWER_QUERY = `query CharacterViewerIDQuery($collectionId: ID!){node(id:$collectionId){__typename ... on FontCollection {id name cssUrl collectionType isVariableFont glyphGroups{name characterSets{features}} featureStyle{id glyphNames{name features} verticalMetrics{unitsPerEm ascender descender xHeight capHeight lineGap}} fontStyles{id cssFamily name variableInstances{name coordinates{axis value}}} children(collectionTypes:[FAMILY]){id name cssUrl collectionType isVariableFont fontStyles{id cssFamily name variableInstances{name coordinates{axis value}}}}}}}`;

type Scope = {
  targetUrl: string;
  slug: string;
  tokens: string[];
  isCatalog: boolean;
};

type Candidate = {
  id: string;
  name: string;
  cssUrl: string;
  type: string;
  isVariable: boolean;
  fontStyles: any[];
  featureTags: string[];
  glyphCount?: number;
  metrics?: Record<string, number>;
};

type CssFace = {
  familyRaw: string;
  italic: boolean;
  weight: string | number;
  sources: Array<{ url: string; format: FontMetadata["format"] }>;
};

type StyleRow = {
  expectedStyle: string;
  familyName: string;
  styleName: string;
  style: "Normal" | "Italic";
  weight: string | number;
  sourceType: "static" | "variable";
  collectionId: string;
  cssUrl: string;
  coordinates?: Record<string, number>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeSpace = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();
const normalizeToken = (value: string): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const dedupeStrings = (values: Array<string | undefined | null>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = normalizeSpace(value);
    if (!text) continue;
    const key = normalizeToken(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const decodeEscapes = (value: string): string =>
  value.replace(/\\u002F/gi, "/").replace(/\\u003D/gi, "=").replace(/\\\//g, "/").replace(/\\+/g, "");

const parseScope = (rawUrl: string): Scope => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  parsed.hostname = "deinwaller.com";
  parsed.hash = "";

  const slug = normalizeSpace(String(parsed.pathname.split("/").filter(Boolean)[0] || "index").toLowerCase());
  const normalizedSlug = slug.replace(/-\d+$/g, "");
  const tokens = normalizedSlug
    .split(/[-_]+/g)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 2 && !GENERIC_TOKENS.has(token));

  return {
    targetUrl: parsed.href,
    slug,
    tokens,
    isCatalog: GENERIC_PATHS.has(slug)
  };
};

const fetchTextWithRetry = async (url: string, headers: Record<string, string>): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(450 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed fetch ${url}`);
};

const fetchCollectionNode = async (collectionId: string, referer: string): Promise<any | undefined> => {
  const endpoint = `${GRAPHQL}?queryName=CharacterViewerIDQuery`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Referer: referer,
          "User-Agent": UA,
          "fontdue-client-version": "2.19.2",
          "fontdue-stripe-integration": "dynamic"
        },
        body: JSON.stringify({
          query: CHARACTER_VIEWER_QUERY,
          variables: { collectionId }
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const envelope = (await response.json()) as any;
      return envelope?.data?.node;
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(450 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  console.warn(`[DeinWaller] GraphQL failed for ${collectionId}:`, lastError);
  return undefined;
};

const mapLimit = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  if (items.length === 0) return [];
  const output: R[] = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      output[i] = await worker(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return output;
};

const extractCollectionIds = (html: string): string[] => {
  const text = decodeEscapes(html);
  const out = new Set<string>();
  for (const match of text.matchAll(/collection-id=["']([^"']+)["']/gi)) {
    const id = normalizeSpace(String(match[1] || ""));
    if (id.startsWith("Rm9udENvbGxlY3Rpb246")) out.add(id);
  }
  for (const match of text.matchAll(/Rm9udENvbGxlY3Rpb246[0-9A-Za-z_=+-]+/g)) {
    out.add(String(match[0] || ""));
  }
  for (const match of text.matchAll(
    /https?:\/\/fonts\.fontdue\.com\/deinwaller\/css\/([A-Za-z0-9%_=:+-]+)\.css(?:\?[^\s"'<>]*)?/gi
  )) {
    try {
      const id = decodeURIComponent(String(match[1] || ""));
      if (id.startsWith("Rm9udENvbGxlY3Rpb246")) out.add(id);
    } catch {
      // ignore
    }
  }
  return Array.from(out);
};

const extractDirectCss = (html: string, pageUrl: string): string[] => {
  const text = decodeEscapes(html);
  const out = new Set<string>();
  const add = (rawValue: string) => {
    try {
      const value = normalizeSpace(rawValue.replace(/^['"]|['"]$/g, ""));
      const resolved = value.startsWith("//")
        ? new URL(`https:${value}`)
        : /^https?:\/\//i.test(value)
          ? new URL(value)
          : new URL(value, pageUrl);
      if (/^https?:\/\/fonts\.fontdue\.com\/deinwaller\/css\/[A-Za-z0-9%_=:+-]+\.css(?:$|[?#])/i.test(resolved.href)) {
        out.add(resolved.href);
      }
    } catch {
      // ignore malformed url
    }
  };
  for (const match of text.matchAll(
    /https?:\/\/fonts\.fontdue\.com\/deinwaller\/css\/[A-Za-z0-9%_=:+-]+\.css(?:\?[^\s"'<>]*)?/gi
  )) {
    add(String(match[0] || ""));
  }
  return Array.from(out);
};

const extractHints = (html: string): string[] => {
  const hints: string[] = [];
  const title = normalizeSpace(String(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || ""));
  if (title) {
    hints.push(title.split("—")[0] || title);
  }
  const buy = normalizeSpace(String(html.match(/BUY\s+([A-Za-z0-9\- ]{2,})/i)?.[1] || ""));
  if (buy) hints.push(buy);
  return dedupeStrings(hints.filter((value) => !/deinwaller/i.test(value)));
};

const extractPdfUrls = (html: string, pageUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of decodeEscapes(html).matchAll(
    /https?:\/\/[^"'\s<>]+?\.pdf(?:\?[^"'\s<>]*)?|\/[^"'\s<>]+?\.pdf(?:\?[^"'\s<>]*)?/gi
  )) {
    try {
      const raw = String(match[0] || "");
      const absolute = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw, pageUrl);
      out.add(absolute.href);
    } catch {
      // ignore malformed
    }
  }
  return Array.from(out);
};

const featureTagsFromNode = (node: any): string[] => {
  const tags = new Set<string>();
  for (const group of Array.isArray(node?.glyphGroups) ? node.glyphGroups : []) {
    for (const charSet of Array.isArray(group?.characterSets) ? group.characterSets : []) {
      for (const feature of Array.isArray(charSet?.features) ? charSet.features : []) {
        const token = normalizeSpace(String(feature || "")).toLowerCase();
        if (token) tags.add(token);
      }
    }
  }
  for (const glyphName of Array.isArray(node?.featureStyle?.glyphNames) ? node.featureStyle.glyphNames : []) {
    for (const feature of Array.isArray(glyphName?.features) ? glyphName.features : []) {
      const token = normalizeSpace(String(feature || "")).toLowerCase();
      if (token) tags.add(token);
    }
  }
  return Array.from(tags).sort();
};

const toCandidates = (nodes: Map<string, any>): Candidate[] => {
  const out = new Map<string, Candidate>();
  for (const [id, node] of nodes.entries()) {
    const name = normalizeSpace(String(node?.name || ""));
    const cssUrl = normalizeSpace(String(node?.cssUrl || ""));
    const styles = Array.isArray(node?.fontStyles) ? node.fontStyles : [];
    if (!name || !cssUrl || styles.length === 0) continue;
    if (!/^https?:\/\/fonts\.fontdue\.com\/deinwaller\/css\/[A-Za-z0-9%_=:+-]+\.css(?:$|[?#])/i.test(cssUrl)) continue;
    out.set(id, {
      id,
      name,
      cssUrl,
      type: normalizeSpace(String(node?.collectionType || "family")).toLowerCase(),
      isVariable: Boolean(node?.isVariableFont) || /(?:^|\s)vf(?:\s|$)/i.test(name),
      fontStyles: styles,
      featureTags: featureTagsFromNode(node),
      glyphCount: Array.isArray(node?.featureStyle?.glyphNames) ? node.featureStyle.glyphNames.length : undefined,
      metrics: node?.featureStyle?.verticalMetrics
    });
  }
  return Array.from(out.values());
};

const scoreCandidate = (candidate: Candidate, tokens: string[]): number => {
  if (tokens.length === 0) return 0;
  const haystack = normalizeToken(candidate.name);
  let score = 0;
  let matched = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 2;
      matched += 1;
    }
  }
  if (matched === tokens.length) score += 4;
  if (candidate.type === "family") score += 1;
  return score;
};

const guessFormat = (url: string): FontMetadata["format"] => {
  if (/\.woff2(?:$|[?#])/i.test(url)) return "woff2";
  if (/\.woff(?:$|[?#])/i.test(url)) return "woff";
  if (/\.ttf(?:$|[?#])/i.test(url)) return "ttf";
  if (/\.otf(?:$|[?#])/i.test(url)) return "otf";
  if (/\.eot(?:$|[?#])/i.test(url)) return "eot";
  return "woff2";
};

const parseCssFaces = (cssText: string, cssUrl: string): CssFace[] => {
  const out: CssFace[] = [];
  for (const block of cssText.match(/@font-face\s*{[^}]*}/gi) || []) {
    const familyRaw = normalizeSpace(block.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?\s*;/i)?.[1] || "");
    if (!familyRaw) continue;
    const styleRaw = normalizeSpace(block.match(/font-style\s*:\s*([^;]+);/i)?.[1] || "normal");
    const weightText = normalizeSpace(block.match(/font-weight\s*:\s*([^;]+);/i)?.[1] || "400");
    const weightNumber = Number(weightText);
    const weight: string | number = Number.isFinite(weightNumber) ? weightNumber : weightText;
    const sources: Array<{ url: string; format: FontMetadata["format"] }> = [];
    for (const match of block.matchAll(/url\(([^)]+)\)(?:\s*format\(([^)]+)\))?/gi)) {
      const rawUrl = normalizeSpace(String(match[1] || "").replace(/^['"]|['"]$/g, ""));
      if (!rawUrl) continue;
      try {
        const resolved = new URL(rawUrl, cssUrl).href;
        const format = guessFormat(String(match[2] || "").replace(/^['"]|['"]$/g, "") || resolved);
        sources.push({ url: resolved, format });
      } catch {
        // ignore malformed source
      }
    }
    if (sources.length > 0) out.push({ familyRaw, italic: /italic|oblique/i.test(styleRaw), weight, sources });
  }
  return out;
};

const sourcePriority = (format: FontMetadata["format"]): number =>
  format === "woff2" ? 5 : format === "woff" ? 4 : format === "ttf" ? 3 : format === "otf" ? 2 : 1;

export const DeinwallerScraper: Scraper = {
  id: "deinwaller",
  name: "D Einwaller Fontdue Deep Scraper",

  canHandle(url: string): boolean {
    return HOST_RE.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const scope = parseScope(url);
      const html = await fetchTextWithRetry(scope.targetUrl, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: ORIGIN,
        "User-Agent": UA
      });

      const hints = extractHints(html);
      const tokens = dedupeStrings([...scope.tokens, ...hints.join(" ").split(/[\s\-_]+/g)]);
      const collectionIds = extractCollectionIds(html);
      const directCssUrls = extractDirectCss(html, scope.targetUrl);
      const pdfUrls = extractPdfUrls(html, scope.targetUrl);

      const queue = [...collectionIds];
      const nodes = new Map<string, any>();
      const seen = new Set<string>();
      while (queue.length > 0) {
        const batch: string[] = [];
        while (queue.length > 0 && batch.length < CONCURRENCY) {
          const id = String(queue.shift() || "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          batch.push(id);
        }
        if (batch.length === 0) break;

        const rows = await mapLimit(batch, CONCURRENCY, async (id) => ({ id, node: await fetchCollectionNode(id, scope.targetUrl) }));
        for (const row of rows) {
          if (!row.node) continue;
          nodes.set(row.id, row.node);
          for (const child of Array.isArray(row.node.children) ? row.node.children : []) {
            const childId = normalizeSpace(String(child?.id || ""));
            if (childId && !seen.has(childId)) queue.push(childId);
          }
        }
      }

      const allCandidates = toCandidates(nodes);
      const scored = allCandidates
        .map((candidate) => ({ candidate, score: scoreCandidate(candidate, tokens) }))
        .sort((a, b) => b.score - a.score);
      let picked = allCandidates;
      if (!scope.isCatalog && tokens.length > 0 && scored.length > 0 && (scored[0]?.score ?? 0) > 0) {
        const best = scored[0].score;
        picked = scored.filter((row) => row.score === best).map((row) => row.candidate);
      }

      const styleMap: StyleRow[] = [];
      for (const candidate of picked) {
        for (const style of candidate.fontStyles) {
          const baseStyle = normalizeSpace(String(style?.name || "Regular")) || "Regular";
          const instances = Array.isArray(style?.variableInstances) ? style.variableInstances : [];
          if (candidate.isVariable && instances.length > 0) {
            for (const instance of instances) {
              const styleName = normalizeSpace(String(instance?.name || baseStyle)) || baseStyle;
              const coords: Record<string, number> = {};
              for (const coord of Array.isArray(instance?.coordinates) ? instance.coordinates : []) {
                const axis = normalizeSpace(String(coord?.axis || ""));
                const value = Number(coord?.value);
                if (axis && Number.isFinite(value)) coords[axis] = value;
              }
              styleMap.push({
                expectedStyle: normalizeSpace(`${candidate.name} ${styleName}`),
                familyName: candidate.name,
                styleName,
                style: /italic|oblique/i.test(styleName) ? "Italic" : "Normal",
                weight: Number.isFinite(Number(coords.wght)) ? Number(coords.wght) : "Variable",
                sourceType: "variable",
                collectionId: candidate.id,
                cssUrl: candidate.cssUrl,
                coordinates: Object.keys(coords).length > 0 ? coords : undefined
              });
            }
          } else {
            styleMap.push({
              expectedStyle: normalizeSpace(`${candidate.name} ${baseStyle}`),
              familyName: candidate.name,
              styleName: baseStyle,
              style: /italic|oblique/i.test(baseStyle) ? "Italic" : "Normal",
              weight: "Regular",
              sourceType: "static",
              collectionId: candidate.id,
              cssUrl: candidate.cssUrl
            });
          }
        }
      }

      const expectedStyles = dedupeStrings(styleMap.map((row) => row.expectedStyle));
      const featureTags = dedupeStrings(picked.flatMap((candidate) => candidate.featureTags));
      const glyphCount = Math.max(...picked.map((candidate) => Number(candidate.glyphCount || 0)), 0) || undefined;

      const targetProfile: Record<string, unknown> = {
        profileId: "deinwaller-target-profile-v1",
        source: "deinwaller-cargo-html+fontdue-graphql+fontdue-css",
        foundry: "D Einwaller",
        targetUrl: scope.targetUrl,
        targetSlug: scope.slug,
        familyDisplay: hints[0] || picked[0]?.name || "D Einwaller",
        styleScope: "family-style",
        strictMissingStyles: true,
        expectedStyles,
        expectedStyleCount: expectedStyles.length,
        styleMap,
        requiredFeatureTags: [],
        catalogFeatureTags: featureTags,
        glyphCount,
        collectionIds: picked.map((candidate) => candidate.id),
        specimenPdfUrls: pdfUrls,
        collectedAt: new Date().toISOString()
      };

      const fonts: FontMetadata[] = [];
      const seenFonts = new Set<string>();
      for (const candidate of picked) {
        let cssText = "";
        try {
          cssText = await fetchTextWithRetry(candidate.cssUrl, {
            Accept: "text/css,*/*;q=0.1",
            Origin: ORIGIN,
            Referer: scope.targetUrl,
            "Sec-Fetch-Dest": "style",
            "Sec-Fetch-Mode": "no-cors",
            "Sec-Fetch-Site": "cross-site",
            "User-Agent": UA
          });
        } catch {
          continue;
        }
        for (const face of parseCssFaces(cssText, candidate.cssUrl)) {
          const source = face.sources.slice().sort((a, b) => sourcePriority(b.format) - sourcePriority(a.format))[0];
          if (!source) continue;
          const styleName = normalizeSpace(face.familyRaw.replace(new RegExp(`^${candidate.name}\\s*`, "i"), "")) || "Regular";
          const expectedStyle = normalizeSpace(`${candidate.name} ${styleName}`);
          const expectedForFont = candidate.isVariable
            ? expectedStyles.filter((item) => normalizeToken(item).startsWith(normalizeToken(candidate.name)))
            : expectedStyles.filter((item) => normalizeToken(item) === normalizeToken(expectedStyle));
          const key = `${normalizeToken(source.url)}::${normalizeToken(candidate.name)}::${normalizeToken(styleName)}`;
          if (seenFonts.has(key)) continue;
          seenFonts.add(key);

          fonts.push({
            url: source.url,
            family: candidate.name,
            format: source.format,
            style: face.italic || /italic|oblique/i.test(styleName) ? "Italic" : "Normal",
            weight: candidate.isVariable ? "Variable" : face.weight,
            downloadable: true,
            note: candidate.isVariable
              ? "D Einwaller variable source from Fontdue CSS/GraphQL."
              : "D Einwaller static source from Fontdue CSS/GraphQL.",
            metadata: {
              foundry: "D Einwaller",
              family: candidate.name,
              styleName,
              fullName: normalizeSpace(`${candidate.name} ${styleName}`),
              targetUrl: scope.targetUrl,
              pageUrl: scope.targetUrl,
              collectionId: candidate.id,
              collectionType: candidate.type,
              cssUrl: candidate.cssUrl,
              sourceType: candidate.isVariable ? "variable" : "static",
              expectedStyles: expectedForFont.length > 0 ? expectedForFont : [expectedStyle],
              expectedStyleCount: expectedForFont.length > 0 ? expectedForFont.length : 1,
              styleMap,
              featureTags: candidate.featureTags,
              glyphCount: candidate.glyphCount,
              forceMetadataRepair: true,
              targetProfile,
              specimenPdfUrls: pdfUrls,
              headers: {
                Origin: ORIGIN,
                Referer: scope.targetUrl,
                Accept: "*/*",
                "User-Agent": UA,
                "Sec-Fetch-Dest": "font",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site"
              }
            }
          });
        }
      }

      if (fonts.length === 0 && directCssUrls.length > 0) {
        for (const cssUrl of directCssUrls) {
          let cssText = "";
          try {
            cssText = await fetchTextWithRetry(cssUrl, {
              Accept: "text/css,*/*;q=0.1",
              Origin: ORIGIN,
              Referer: scope.targetUrl,
              "Sec-Fetch-Dest": "style",
              "Sec-Fetch-Mode": "no-cors",
              "Sec-Fetch-Site": "cross-site",
              "User-Agent": UA
            });
          } catch {
            continue;
          }
          for (const face of parseCssFaces(cssText, cssUrl)) {
            const source = face.sources.slice().sort((a, b) => sourcePriority(b.format) - sourcePriority(a.format))[0];
            if (!source) continue;
            fonts.push({
              url: source.url,
              family: hints[0] || "D Einwaller",
              format: source.format,
              style: face.italic ? "Italic" : "Normal",
              weight: face.weight,
              downloadable: true,
              note: "D Einwaller fallback source from direct CSS.",
              metadata: {
                foundry: "D Einwaller",
                targetUrl: scope.targetUrl,
                pageUrl: scope.targetUrl,
                sourceType: "fallback-direct-css",
                forceMetadataRepair: true,
                targetProfile,
                specimenPdfUrls: pdfUrls
              }
            });
          }
        }
      }

      if (fonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "D Einwaller",
          fonts: [
            {
              url: "browser-intercept",
              family: hints[0] || "D Einwaller",
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "D Einwaller",
                targetUrl: scope.targetUrl,
                pageUrl: scope.targetUrl,
                targetProfile
              }
            }
          ],
          originalUrl: url,
          targetUrl: scope.targetUrl,
          metadata: { source: "deinwaller-fallback", targetProfile, fallbackMode: "browser-intercept" }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "D Einwaller",
        fonts,
        originalUrl: url,
        targetUrl: scope.targetUrl,
        expectedCount: expectedStyles.length > 0 ? expectedStyles.length : fonts.length,
        metadata: {
          source: "deinwaller-cargo-html+fontdue-graphql+fontdue-css",
          mode: scope.isCatalog ? "catalog" : "family",
          selectedCollections: picked.map((candidate) => candidate.name),
          targetTokens: tokens,
          targetProfile,
          specimenPdfUrls: pdfUrls
        }
      };
    } catch (error) {
      console.error("[DeinwallerScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "D Einwaller",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
