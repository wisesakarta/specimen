import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const MASSDRIVER_HOST = "mass-driver.com";
const MASSDRIVER_ORIGIN = "https://mass-driver.com";
const MASSDRIVER_STORE_GRAPHQL = "https://store.mass-driver.com/graphql";
const MASSDRIVER_FETCH_TIMEOUT_MS = 25000;
const MASSDRIVER_FETCH_MAX_RETRIES = 3;
const MASSDRIVER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const CHARACTER_VIEWER_QUERY = `query CharacterViewerIDQuery($collectionId: ID!){node(id:$collectionId){__typename ... on FontCollection {id name cssUrl collectionType fontStyles {id cssFamily name} children(collectionTypes:[FAMILY]) {id name cssUrl fontStyles {id cssFamily name}}}}}`;

type MassDriverScope = {
  targetUrl: string;
  familySlug?: string;
  styleSlug?: string;
  familyDisplayHint?: string;
  targetWords: string[];
};

type FontCollectionNode = {
  id?: string;
  name?: string;
  cssUrl?: string;
  children?: Array<{
    id?: string;
    name?: string;
    cssUrl?: string;
  }>;
};

type CollectionCandidate = {
  name: string;
  cssUrl: string;
};

type DirectCssCandidate = {
  cssUrl: string;
  refererPage: string;
};

type CssSource = {
  url: string;
  format: FontMetadata["format"];
};

type CssFace = {
  familyRaw: string;
  isItalic: boolean;
  weight: number | string;
  source: CssSource;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeToken = (value: string): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeSpace = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();

const toTitleCase = (value: string): string =>
  normalizeSpace(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");

const uniqueStrings = (values: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSpace(value);
    if (!normalized) continue;
    const key = normalizeToken(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

const styleSlugTokens = (styleSlug?: string): string[] =>
  String(styleSlug || "")
    .split(/[-_]+/g)
    .map((token) => normalizeToken(token))
    .filter(Boolean);

const buildFamilyPageUrl = (scope: MassDriverScope): string | undefined => {
  if (!scope.familySlug) return undefined;
  return `${MASSDRIVER_ORIGIN}/typefaces/${scope.familySlug}`;
};

const extractCollectionIds = (html: string): string[] =>
  Array.from(
    new Set(
      [...html.matchAll(/collection-id=["']([^"']+)["']/gi)]
        .map((match) => String(match[1] || "").trim())
        .filter(Boolean)
    )
  );

const extractDirectFontdueCssCandidates = (html: string, pageUrl: string): DirectCssCandidate[] => {
  const out = new Map<string, DirectCssCandidate>();

  const add = (rawValue: string) => {
    const candidate = normalizeSpace(rawValue || "");
    if (!candidate) return;
    try {
      const resolved =
        candidate.startsWith("//")
          ? new URL(`https:${candidate}`)
          : /^https?:\/\//i.test(candidate)
            ? new URL(candidate)
            : new URL(candidate, pageUrl);
      const href = resolved.href;
      if (!/^https?:\/\/fonts\.fontdue\.com\/mass-driver\/css\/.+\.css(?:$|[?#])/i.test(href)) return;
      if (!out.has(href)) {
        out.set(href, { cssUrl: href, refererPage: pageUrl });
      }
    } catch {
      // Ignore malformed URLs.
    }
  };

  for (const match of html.matchAll(/https?:\/\/fonts\.fontdue\.com\/mass-driver\/css\/[A-Za-z0-9%._=:-]+\.css(?:\?[^\s"'<>]*)?/gi)) {
    add(String(match[0] || ""));
  }
  for (const match of html.matchAll(/["'](\/\/fonts\.fontdue\.com\/mass-driver\/css\/[A-Za-z0-9%._=:-]+\.css(?:\?[^"']*)?)["']/gi)) {
    add(String(match[1] || ""));
  }

  return Array.from(out.values());
};

const parseScope = (rawUrl: string): MassDriverScope => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === `www.${MASSDRIVER_HOST}`) parsed.hostname = MASSDRIVER_HOST;
  parsed.hash = "";

  const segments = parsed.pathname.split("/").filter(Boolean);
  const typefaceIndex = segments.findIndex((segment) => segment.toLowerCase() === "typefaces");
  const familySlug = typefaceIndex >= 0 && segments[typefaceIndex + 1] ? segments[typefaceIndex + 1].toLowerCase() : undefined;
  const styleSlug = typefaceIndex >= 0 && segments[typefaceIndex + 2] ? segments[typefaceIndex + 2].toLowerCase() : undefined;

  const familyDisplayHint = familySlug
    ? toTitleCase(
        familySlug
          .replace(/^md-?/i, "MD ")
          .replace(/-/g, " ")
      )
    : undefined;

  const targetWords = uniqueStrings([familySlug || "", styleSlug || ""])
    .join(" ")
    .split(/\s+/g)
    .map((token) => normalizeToken(token))
    .filter(Boolean);

  return {
    targetUrl: parsed.href,
    familySlug,
    styleSlug,
    familyDisplayHint,
    targetWords
  };
};

const fetchTextWithRetry = async (url: string, timeoutMs = MASSDRIVER_FETCH_TIMEOUT_MS): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MASSDRIVER_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": MASSDRIVER_UA }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MASSDRIVER_FETCH_MAX_RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Fetch failed");
};

const fetchFontdueCss = async (cssUrl: string, referer: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MASSDRIVER_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MASSDRIVER_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(cssUrl, {
        signal: controller.signal,
        headers: {
          Accept: "text/css,*/*;q=0.1",
          Origin: MASSDRIVER_ORIGIN,
          Referer: referer,
          "Sec-Fetch-Dest": "style",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
          "User-Agent": MASSDRIVER_UA
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MASSDRIVER_FETCH_MAX_RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("CSS fetch failed");
};

const queryFontdueGraphQL = async (collectionId: string, referer: string): Promise<FontCollectionNode | undefined> => {
  const queryName = "CharacterViewerIDQuery";
  const endpoint = `${MASSDRIVER_STORE_GRAPHQL}?queryName=${encodeURIComponent(queryName)}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MASSDRIVER_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MASSDRIVER_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": MASSDRIVER_UA,
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: MASSDRIVER_ORIGIN,
          Referer: referer
        },
        body: JSON.stringify({ query: CHARACTER_VIEWER_QUERY, variables: { collectionId } })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const envelope = (await response.json()) as Record<string, unknown>;
      const data = envelope.data as Record<string, unknown> | undefined;
      const node = data?.node as FontCollectionNode | undefined;
      if (node && typeof node === "object") return node;
      throw new Error("GraphQL node empty");
    } catch (error) {
      lastError = error;
      if (attempt < MASSDRIVER_FETCH_MAX_RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn(`[MassDriver] GraphQL failed for ${collectionId}:`, lastError);
  return undefined;
};

const collectCollectionCandidates = (node: FontCollectionNode): CollectionCandidate[] => {
  const out = new Map<string, CollectionCandidate>();
  const add = (nameValue: unknown, cssUrlValue: unknown) => {
    const name = normalizeSpace(String(nameValue || ""));
    const cssUrl = normalizeSpace(String(cssUrlValue || ""));
    if (!name || !cssUrl) return;
    if (!/^https?:\/\//i.test(cssUrl)) return;
    if (!out.has(cssUrl)) out.set(cssUrl, { name, cssUrl });
  };

  add(node.name, node.cssUrl);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) add(child.name, child.cssUrl);
  return Array.from(out.values());
};

const scoreCollectionName = (name: string, targetWords: string[]): number => {
  if (targetWords.length === 0) return 0;
  const token = normalizeToken(name);
  if (!token) return 0;
  let score = 0;
  for (const word of targetWords) {
    if (!word) continue;
    if (token.includes(word)) score += 2;
  }
  if (targetWords.every((word) => token.includes(word))) score += 4;
  return score;
};

const pickCollections = (candidates: CollectionCandidate[], targetWords: string[]): CollectionCandidate[] => {
  if (candidates.length <= 1) return candidates;
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCollectionName(candidate.name, targetWords)
    }))
    .sort((a, b) => b.score - a.score);

  const bestScore = ranked[0]?.score ?? 0;
  if (bestScore <= 0) return candidates;
  return ranked.filter((row) => row.score === bestScore).map((row) => row.candidate);
};

const guessFormat = (rawFormat: string, url: string): FontMetadata["format"] | undefined => {
  const token = normalizeToken(rawFormat);
  if (token === "woff2") return "woff2";
  if (token === "woff") return "woff";
  if (token === "otf" || token === "opentype") return "otf";
  if (token === "ttf" || token === "truetype") return "ttf";
  if (token === "eot") return "eot";

  const lower = url.toLowerCase();
  if (/\.woff2(?:$|\?)/.test(lower)) return "woff2";
  if (/\.woff(?:$|\?)/.test(lower)) return "woff";
  if (/\.otf(?:$|\?)/.test(lower)) return "otf";
  if (/\.ttf(?:$|\?)/.test(lower)) return "ttf";
  if (/\.eot(?:$|\?)/.test(lower)) return "eot";
  return undefined;
};

const sourcePriority = (format: FontMetadata["format"]): number => {
  if (format === "woff2") return 5;
  if (format === "woff") return 4;
  if (format === "ttf") return 3;
  if (format === "otf") return 2;
  return 1;
};

const parseWeight = (value: string): number | string => {
  const trimmed = normalizeSpace(value);
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  return trimmed || "400";
};

const extractCssFaces = (cssText: string, cssUrl: string): CssFace[] => {
  const out: CssFace[] = [];
  const blocks = cssText.match(/@font-face\s*{[^}]*}/gi) || [];
  for (const block of blocks) {
    const familyRaw = normalizeSpace(block.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?\s*;/i)?.[1] || "");
    if (!familyRaw) continue;
    const styleRaw = normalizeSpace(block.match(/font-style\s*:\s*([^;]+);/i)?.[1] || "normal");
    const weightRaw = normalizeSpace(block.match(/font-weight\s*:\s*([^;]+);/i)?.[1] || "400");
    const isItalic = /italic|oblique/i.test(styleRaw);

    const sources: CssSource[] = [];
    for (const match of block.matchAll(/url\(([^)]+)\)(?:\s*format\(([^)]+)\))?/gi)) {
      const rawUrl = normalizeSpace(String(match[1] || "").replace(/^['"]|['"]$/g, ""));
      const rawFormat = normalizeSpace(String(match[2] || "").replace(/^['"]|['"]$/g, ""));
      if (!rawUrl) continue;

      let resolvedUrl: string;
      try {
        resolvedUrl = new URL(rawUrl, cssUrl).href;
      } catch {
        continue;
      }

      const format = guessFormat(rawFormat, resolvedUrl);
      if (!format) continue;
      sources.push({ url: resolvedUrl, format });
    }

    if (sources.length === 0) continue;
    const bestSource = [...sources].sort((a, b) => sourcePriority(b.format) - sourcePriority(a.format))[0];
    if (!bestSource) continue;

    out.push({
      familyRaw,
      isItalic,
      weight: parseWeight(weightRaw),
      source: bestSource
    });
  }

  return out;
};

const weightLabelFromValue = (weight: number | string): string => {
  const numeric = typeof weight === "number" ? weight : Number(weight);
  if (Number.isFinite(numeric)) {
    if (numeric <= 150) return "Thin";
    if (numeric <= 250) return "ExtraLight";
    if (numeric <= 350) return "Light";
    if (numeric <= 450) return "Regular";
    if (numeric <= 550) return "Medium";
    if (numeric <= 650) return "SemiBold";
    if (numeric <= 750) return "Bold";
    if (numeric <= 850) return "ExtraBold";
    return "Black";
  }
  return toTitleCase(String(weight || "Regular")) || "Regular";
};

const deriveStyleName = (face: CssFace, familyName: string): string => {
  const familyToken = normalizeToken(familyName);
  const raw = normalizeSpace(face.familyRaw);
  let tail = raw;
  if (familyToken) {
    const rawToken = normalizeToken(raw);
    if (rawToken.startsWith(familyToken)) {
      const index = raw.toLowerCase().indexOf(familyName.toLowerCase());
      if (index >= 0) {
        tail = normalizeSpace(raw.slice(index + familyName.length));
      } else {
        tail = "";
      }
    }
  }

  let styleName = toTitleCase(tail);
  if (!styleName) styleName = weightLabelFromValue(face.weight);
  if (face.isItalic && !/italic|oblique/i.test(styleName)) {
    styleName = styleName === "Regular" ? "Italic" : `${styleName} Italic`;
  }
  if (!face.isItalic && styleName === "Regular Italic") styleName = "Regular";
  return normalizeSpace(styleName) || (face.isItalic ? "Italic" : "Regular");
};

const extractSpecimenPdfUrls = (html: string, pageUrl: string): string[] => {
  const out = new Set<string>();
  const add = (raw: string) => {
    const candidate = normalizeSpace(raw);
    if (!candidate) return;
    try {
      const resolved = /^https?:\/\//i.test(candidate)
        ? new URL(candidate)
        : candidate.startsWith("//")
          ? new URL(`https:${candidate}`)
          : new URL(candidate, pageUrl);
      const href = resolved.href;
      if (/\/pdfs\/[a-z0-9-]+(?:$|[?#])/i.test(href) || /\.pdf(?:$|[?#])/i.test(href)) {
        out.add(href);
      }
    } catch {
      // ignore malformed candidates
    }
  };

  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi)) add(String(match[0] || ""));
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+?\/pdfs\/[a-z0-9-]+(?:\?[^\s"'<>]*)?/gi)) add(String(match[0] || ""));
  for (const match of html.matchAll(/["'](\/[^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) add(String(match[1] || ""));
  for (const match of html.matchAll(/["'](\/pdfs\/[a-z0-9-]+(?:\?[^"']*)?)["']/gi)) add(String(match[1] || ""));

  return Array.from(out).sort();
};

const buildFallbackInjectScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const controls = Array.from(document.querySelectorAll("button,a,[role='button'],[class*='style'],[class*='weight'],[class*='tester'],[data-style],[data-font]"));
    for (const node of controls.slice(0, 240)) {
      try {
        if (node instanceof HTMLElement) {
          if (node.tagName === "A") {
            const href = String(node.getAttribute("href") || "").trim();
            if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
              continue;
            }
            let resolved;
            try {
              resolved = new URL(href, location.href);
            } catch {
              continue;
            }
            // Prevent navigation to a different page/domain while probing.
            if (resolved.origin !== location.origin) continue;
            if (resolved.pathname !== location.pathname) continue;
          }
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } catch {}
      await sleep(45);
    }
    await sleep(1000);
  })();
`;

export const MassDriverScraper: Scraper = {
  id: "massdriver",
  name: "Mass Driver Precision Scraper",

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === MASSDRIVER_HOST || parsed.hostname.endsWith(`.${MASSDRIVER_HOST}`);
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = parseScope(url);
    const fontsByUrl = new Map<string, FontMetadata>();
    const specimenPdfUrls = new Set<string>();
    const fallbackFamilyPage = buildFamilyPageUrl(scope);
    const pages = uniqueStrings([scope.targetUrl, fallbackFamilyPage || ""]);
    const idReferrers = new Map<string, string>();
    const directCssCandidates = new Map<string, DirectCssCandidate>();
    const processedCssUrls = new Set<string>();

    for (const pageUrl of pages) {
      const html = await fetchTextWithRetry(pageUrl);
      for (const pdfUrl of extractSpecimenPdfUrls(html, pageUrl)) specimenPdfUrls.add(pdfUrl);

      const uniqueIds = extractCollectionIds(html);
      for (const collectionId of uniqueIds) {
        if (!idReferrers.has(collectionId)) idReferrers.set(collectionId, pageUrl);
      }

      for (const candidate of extractDirectFontdueCssCandidates(html, pageUrl)) {
        if (!directCssCandidates.has(candidate.cssUrl)) {
          directCssCandidates.set(candidate.cssUrl, candidate);
        }
      }
    }

    for (const collectionId of idReferrers.keys()) {
      const refererPage = idReferrers.get(collectionId) || scope.targetUrl;
      const node = await queryFontdueGraphQL(collectionId, refererPage);
      if (!node) continue;

      const selectedCollections = pickCollections(collectCollectionCandidates(node), scope.targetWords);
      for (const collection of selectedCollections) {
        processedCssUrls.add(collection.cssUrl);
        let cssText = "";
        try {
          cssText = await fetchFontdueCss(collection.cssUrl, refererPage);
        } catch (error) {
          console.warn(`[MassDriver] Failed to fetch CSS: ${collection.cssUrl}`, error);
          continue;
        }

        const faces = extractCssFaces(cssText, collection.cssUrl);
        for (const face of faces) {
          if (fontsByUrl.has(face.source.url)) continue;

          const family = normalizeSpace(collection.name) || scope.familyDisplayHint || "Mass Driver";
          const styleName = deriveStyleName(face, family);
          const style = /italic|oblique/i.test(styleName) ? "Italic" : "Normal";
          const fullName = normalizeSpace(`${family} ${styleName}`);

          fontsByUrl.set(face.source.url, {
            url: face.source.url,
            format: face.source.format,
            family,
            style,
            weight: face.weight,
            downloadable: true,
            note: "Mass Driver Fontdue CSS asset.",
            metadata: {
              foundry: "Mass Driver",
              family,
              styleName,
              fullName,
              sourceCssUrl: collection.cssUrl,
              pageUrl: refererPage,
              targetUrl: scope.targetUrl,
              forceMetadataRepair: true,
              headers: {
                Origin: MASSDRIVER_ORIGIN,
                Referer: collection.cssUrl
              }
            }
          });
        }
      }
    }

    if (fontsByUrl.size === 0 && scope.familySlug) {
      for (const candidate of directCssCandidates.values()) {
        if (processedCssUrls.has(candidate.cssUrl)) continue;

        let cssText = "";
        try {
          cssText = await fetchFontdueCss(candidate.cssUrl, candidate.refererPage);
        } catch (error) {
          console.warn(`[MassDriver] Failed to fetch direct CSS: ${candidate.cssUrl}`, error);
          continue;
        }

        const faces = extractCssFaces(cssText, candidate.cssUrl);
        for (const face of faces) {
          const faceToken = normalizeToken(face.familyRaw);
          if (scope.targetWords.length > 0) {
            const matched = scope.targetWords.some((token) => token && faceToken.includes(token));
            if (!matched) continue;
          }

          if (fontsByUrl.has(face.source.url)) continue;

          const family = scope.familyDisplayHint || normalizeSpace(face.familyRaw) || "Mass Driver";
          const styleName = deriveStyleName(face, family);
          const style = /italic|oblique/i.test(styleName) ? "Italic" : "Normal";
          const fullName = normalizeSpace(`${family} ${styleName}`);

          fontsByUrl.set(face.source.url, {
            url: face.source.url,
            format: face.source.format,
            family,
            style,
            weight: face.weight,
            downloadable: true,
            note: "Mass Driver direct Fontdue CSS asset.",
            metadata: {
              foundry: "Mass Driver",
              family,
              styleName,
              fullName,
              sourceCssUrl: candidate.cssUrl,
              pageUrl: candidate.refererPage,
              targetUrl: scope.targetUrl,
              forceMetadataRepair: true,
              headers: {
                Origin: MASSDRIVER_ORIGIN,
                Referer: candidate.cssUrl
              }
            }
          });
        }
      }
    }

    const allFonts = Array.from(fontsByUrl.values()).sort((a, b) => {
      const family = String(a.family || "").localeCompare(String(b.family || ""));
      if (family !== 0) return family;
      const aWeight = typeof a.weight === "number" ? a.weight : Number(a.weight || 400);
      const bWeight = typeof b.weight === "number" ? b.weight : Number(b.weight || 400);
      if (Number.isFinite(aWeight) && Number.isFinite(bWeight) && aWeight !== bWeight) return aWeight - bWeight;
      return String(a.style || "").localeCompare(String(b.style || ""));
    });

    const scopedStyleTokens = styleSlugTokens(scope.styleSlug);
    const styleScopedFonts =
      scopedStyleTokens.length === 0
        ? allFonts
        : allFonts.filter((font) => {
            const styleName = normalizeSpace(String((font.metadata as any)?.styleName || ""));
            const fullName = normalizeSpace(String((font.metadata as any)?.fullName || ""));
            const haystack = normalizeToken(`${styleName} ${fullName} ${font.family || ""}`);
            return scopedStyleTokens.every((token) => haystack.includes(token));
          });

    const fonts = styleScopedFonts.length > 0 ? styleScopedFonts : allFonts;

    const expectedStyles = uniqueStrings(
      fonts.map((font) =>
        normalizeSpace(
          String(
            (font.metadata && typeof font.metadata === "object" ? (font.metadata as any).fullName : undefined) ||
              `${font.family} ${(font.metadata as any)?.styleName || ""}`
          )
        )
      )
    );

    const targetProfile = {
      profileId: "massdriver-target-v2",
      source: "massdriver-fontdue-css",
      foundry: "Mass Driver",
      family: scope.familyDisplayHint || fonts[0]?.family || "Mass Driver",
      familyDisplay: scope.familyDisplayHint || fonts[0]?.family || "Mass Driver",
      familySlug: scope.familySlug,
      styleSlug: scope.styleSlug,
      styleScope: scope.styleSlug ? "single-style" : "family-style",
      strictMissingStyles: false,
      failOnTrialAssets: false,
      expectedStyles,
      expectedStyleCount: expectedStyles.length,
      styleMap: fonts.map((font) => ({
        fontFile: font.url,
        postscriptName: normalizeSpace(String((font.metadata as any)?.fullName || `${font.family} ${(font.metadata as any)?.styleName || ""}`))
          .replace(/\s+/g, "-")
          .replace(/[^A-Za-z0-9-]+/g, ""),
        styleName: (font.metadata as any)?.styleName,
        style: font.style,
        weight: font.weight
      })),
      specimenPdfUrls: Array.from(specimenPdfUrls),
      targetUrl: scope.targetUrl
    } as Record<string, unknown>;

    for (const font of fonts) {
      if (!font.metadata || typeof font.metadata !== "object") font.metadata = {};
      (font.metadata as any).targetProfile = targetProfile;
      (font.metadata as any).specimenPdfUrls = Array.from(specimenPdfUrls);
    }

    if (fonts.length === 0) {
      return {
        scraperName: this.name,
        foundryName: "Mass Driver",
        originalUrl: url,
        targetUrl: scope.targetUrl,
        injectScript: buildFallbackInjectScript(),
        fonts: [
          {
            url: "browser-intercept",
            format: "woff2",
            family: scope.familyDisplayHint || "Mass Driver",
            style: "Normal",
            weight: "Regular",
            downloadable: true,
            metadata: {
              foundry: "Mass Driver",
              family: scope.familyDisplayHint || "Mass Driver",
              pageUrl: scope.targetUrl,
              targetUrl: scope.targetUrl,
              targetProfile
            }
          }
        ],
        metadata: {
          foundry: "Mass Driver",
          reason: "no-fonts-from-fontdue-css",
          targetProfile
        }
      };
    }

    return {
      scraperName: this.name,
      foundryName: "Mass Driver",
      originalUrl: url,
      targetUrl: scope.targetUrl,
      expectedCount: expectedStyles.length || fonts.length,
      fonts,
      metadata: {
        foundry: "Mass Driver",
        targetProfile,
        specimenPdfUrls: Array.from(specimenPdfUrls)
      }
    };
  }
};


