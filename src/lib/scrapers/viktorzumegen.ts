import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const VIKTORZUMEGEN_HOST_RE = /(^|\/\/)(www\.)?viktorzumegen\.de/i;
const VIKTORZUMEGEN_ORIGIN = "https://www.viktorzumegen.de";
const VIKTORZUMEGEN_TYPEFACES_URL = `${VIKTORZUMEGEN_ORIGIN}/typefaces.html`;
const VIKTORZUMEGEN_LICENSING_URL = `${VIKTORZUMEGEN_ORIGIN}/licensing.php`;
const VIKTORZUMEGEN_STYLE_CSS_URL = `${VIKTORZUMEGEN_ORIGIN}/css/style.css`;
const VIKTORZUMEGEN_TIMEOUT_MS = 30_000;
const VIKTORZUMEGEN_RETRIES = 3;
const VIKTORZUMEGEN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const VIKTORZUMEGEN_GENERIC_SLUGS = new Set([
  "",
  "index",
  "index.html",
  "typefaces",
  "typefaces.html",
  "licensing",
  "licensing.php",
  "about",
  "contact",
  "imprint-data-privacy",
  "letterings-logos",
  "fonts"
]);

const VIKTORZUMEGEN_IGNORE_TOKENS = new Set([
  "index",
  "typefaces",
  "licensing",
  "about",
  "contact",
  "imprint",
  "privacy",
  "letterings",
  "logos",
  "html",
  "php",
  "font",
  "fonts",
  "vzwo",
  "type"
]);

const VIKTORZUMEGEN_STYLE_TOKENS = [
  "thin",
  "extralight",
  "light",
  "regular",
  "medium",
  "semibold",
  "demibold",
  "bold",
  "extrabold",
  "black",
  "italic",
  "oblique",
  "slanted",
  "backslanted",
  "upright",
  "variable"
] as const;

const VIKTORZUMEGEN_OT_TAGS = new Set(
  [
    "aalt",
    "afrc",
    "c2pc",
    "c2sc",
    "calt",
    "case",
    "ccmp",
    "clig",
    "cpct",
    "cpsp",
    "dlig",
    "dnom",
    "frac",
    "hlig",
    "kern",
    "liga",
    "lnum",
    "locl",
    "numr",
    "onum",
    "ordn",
    "pnum",
    "rlig",
    "salt",
    "sinf",
    "smcp",
    "subs",
    "sups",
    "titl",
    "tnum",
    "zero"
  ].concat(Array.from({ length: 20 }, (_, index) => `ss${String(index + 1).padStart(2, "0")}`))
);

type ViktorZumegenScope = {
  inputUrl: string;
  targetUrl: string;
  mode: "family" | "catalog";
  slug?: string;
  tokens: string[];
};

type ViktorZumegenFace = {
  familyRaw: string;
  fullName: string;
  familyName: string;
  styleName: string;
  style: "Normal" | "Italic";
  weight: string | number;
  isVariable: boolean;
  format: FontMetadata["format"];
  url: string;
  fileName: string;
};

type ViktorZumegenLicenseStyle = {
  name: string;
  value: string;
  href?: string;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toAbsoluteUrl = (raw: string, baseUrl: string): string | undefined => {
  const value = normalizeSpace(raw).replace(/^['"]|['"]$/g, "");
  if (!value) return undefined;

  try {
    const url = value.startsWith("//")
      ? new URL(`https:${value}`)
      : /^https?:\/\//i.test(value)
        ? new URL(value)
        : new URL(value, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
};

const inferFormat = (sourceUrl: string): FontMetadata["format"] => {
  const token = sourceUrl.toLowerCase();
  if (/\.woff2(?:$|[?#])/i.test(token)) return "woff2";
  if (/\.woff(?:$|[?#])/i.test(token)) return "woff";
  if (/\.ttf(?:$|[?#])/i.test(token)) return "ttf";
  if (/\.otf(?:$|[?#])/i.test(token)) return "otf";
  if (/\.eot(?:$|[?#])/i.test(token)) return "eot";
  return "woff2";
};

const sourcePriority = (format: FontMetadata["format"]): number =>
  format === "woff2" ? 5 : format === "woff" ? 4 : format === "ttf" ? 3 : format === "otf" ? 2 : 1;

const parseScope = (rawUrl: string): ViktorZumegenScope => {
  const parsed = /^https?:\/\//i.test(rawUrl) ? new URL(rawUrl) : new URL(`https://${rawUrl}`);
  parsed.protocol = "https:";
  parsed.hostname = "www.viktorzumegen.de";
  parsed.hash = "";

  let pathname = normalizeSpace(parsed.pathname || "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname === "/") pathname = "/typefaces.html";

  const leafOriginal = pathname.split("/").filter(Boolean).pop() || "typefaces.html";
  const leafLower = leafOriginal.toLowerCase();

  if (!/\.[a-z0-9]+$/i.test(leafLower) && !VIKTORZUMEGEN_GENERIC_SLUGS.has(leafLower)) {
    pathname = `${pathname.replace(/\/+$/g, "")}.html`;
  }

  const leaf = pathname.split("/").filter(Boolean).pop()?.toLowerCase() || "typefaces.html";
  const slug = leaf.replace(/\.(html|php)$/i, "");
  const mode: "family" | "catalog" = VIKTORZUMEGEN_GENERIC_SLUGS.has(leaf) || VIKTORZUMEGEN_GENERIC_SLUGS.has(slug)
    ? "catalog"
    : "family";

  const tokens =
    mode === "family"
      ? slug
          .split(/[-_]+/g)
          .map((token) => normalizeToken(token))
          .filter((token) => token.length >= 2 && !VIKTORZUMEGEN_IGNORE_TOKENS.has(token))
      : [];

  return {
    inputUrl: rawUrl,
    targetUrl: `${VIKTORZUMEGEN_ORIGIN}${pathname}${parsed.search || ""}`,
    mode,
    slug: mode === "family" ? slug : undefined,
    tokens
  };
};

const fetchTextWithRetry = async (url: string, headers: Record<string, string>): Promise<string> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= VIKTORZUMEGEN_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIKTORZUMEGEN_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < VIKTORZUMEGEN_RETRIES) {
        await sleep(350 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`ViktorZumegen fetch failed for ${url}`);
};

const inferStyle = (seed: string): "Normal" | "Italic" => {
  const token = normalizeToken(seed);
  if (/(italic|oblique|slanted|backslanted)/i.test(token)) return "Italic";
  return "Normal";
};

const inferWeight = (seed: string, isVariable: boolean): string | number => {
  if (isVariable) return "Variable";
  const numeric = seed.match(/\b([1-9]00)\b/);
  if (numeric && numeric[1]) return Number(numeric[1]);

  const token = normalizeToken(seed);
  if (token.includes("thin")) return 100;
  if (token.includes("extralight") || token.includes("ultralight")) return 200;
  if (token.includes("light")) return 300;
  if (token.includes("regular")) return 400;
  if (token.includes("medium")) return 500;
  if (token.includes("semibold") || token.includes("demibold")) return 600;
  if (token.includes("bold") && !token.includes("extrabold")) return 700;
  if (token.includes("extrabold")) return 800;
  if (token.includes("black")) return 900;

  return "Regular";
};

const splitFamilyAndStyle = (familyRawInput: string): { familyName: string; styleName: string; fullName: string } => {
  const fullName = normalizeSpace(familyRawInput.replace(/['"]/g, ""));
  if (!fullName) {
    return {
      familyName: "VZWO Type",
      styleName: "Regular",
      fullName: "VZWO Type Regular"
    };
  }

  const choreoMatch = fullName.match(/^(VZWO\s+Choreo\s+(?:Text|Display|Banner|Stencil))\s*(.*)$/i);
  if (choreoMatch) {
    const familyName = normalizeSpace(choreoMatch[1] || "VZWO Choreo");
    const styleName = normalizeSpace(choreoMatch[2] || "") || "Regular";
    return { familyName, styleName, fullName };
  }

  const varianzMatch = fullName.match(/^(VZWO\s+VARIANZ)(?:\s+(Low|Mid|High)\s+(Sans|Mix|Serif)|\s+(Variable))(?:\s+(.*))?$/i);
  if (varianzMatch) {
    const base = normalizeSpace(varianzMatch[1] || "VZWO VARIANZ");
    const level = normalizeSpace(varianzMatch[2] || "");
    const branch = normalizeSpace(varianzMatch[3] || "");
    const variableToken = normalizeSpace(varianzMatch[4] || "");
    const trailing = normalizeSpace(varianzMatch[5] || "");
    const familyName = branch ? `${base} ${branch}` : base;
    const styleName = dedupeStrings([level, variableToken, trailing]).join(" ") || "Regular";
    return { familyName, styleName, fullName };
  }

  const volMatch = fullName.match(/^(VZWO\s+VOL)(?:[-\s]*(\d{3}|Variable))?(?:\s+([A-Za-z]+))?$/i);
  if (volMatch) {
    const familyName = normalizeSpace(volMatch[1] || "VZWO VOL");
    const token1 = normalizeSpace(volMatch[2] || "");
    const token2 = normalizeSpace(volMatch[3] || "");
    const styleName = dedupeStrings([token1, token2]).join(" ") || "Regular";
    return { familyName, styleName, fullName };
  }

  const directFamilyMatch = fullName.match(/^(VZWO\s+(?:Egen|Elephant|ScytheSerif))\s*(.*)$/i);
  if (directFamilyMatch) {
    const familyName = normalizeSpace(directFamilyMatch[1] || "VZWO Type");
    const styleName = normalizeSpace(directFamilyMatch[2] || "") || "Regular";
    return { familyName, styleName, fullName };
  }

  const styleTailRe = new RegExp(`^(.*?)(?:\\s+(${VIKTORZUMEGEN_STYLE_TOKENS.join("|")}(?:\\s+(?:italic|oblique|slanted|backslanted|upright))?))$`, "i");
  const styleTailMatch = fullName.match(styleTailRe);
  if (styleTailMatch) {
    const familyName = normalizeSpace(styleTailMatch[1] || "");
    const styleName = normalizeSpace(styleTailMatch[2] || "");
    if (familyName) return { familyName, styleName, fullName };
  }

  return {
    familyName: fullName,
    styleName: /variable/i.test(fullName) ? "Variable" : "Regular",
    fullName
  };
};

const parseCssFaces = (cssText: string, cssUrl: string): ViktorZumegenFace[] => {
  const out: ViktorZumegenFace[] = [];
  const faceBlocks = cssText.match(/@font-face\s*{[^}]*}/gi) || [];

  for (const block of faceBlocks) {
    const familyRaw = normalizeSpace(block.match(/font-family\s*:\s*["']?([^;"'}]+)["']?\s*;/i)?.[1] || "");
    if (!familyRaw) continue;

    const styleDecl = normalizeSpace(block.match(/font-style\s*:\s*([^;]+);/i)?.[1] || "");
    const weightDecl = normalizeSpace(block.match(/font-weight\s*:\s*([^;]+);/i)?.[1] || "");
    const sources = Array.from(block.matchAll(/url\(([^)]+)\)(?:\s*format\(([^)]+)\))?/gi))
      .map((match) => {
        const absolute = toAbsoluteUrl(String(match[1] || ""), cssUrl);
        if (!absolute) return undefined;
        const formatToken = normalizeSpace(String(match[2] || "").replace(/^['"]|['"]$/g, ""));
        const format = formatToken ? inferFormat(formatToken) : inferFormat(absolute);
        return { url: absolute, format };
      })
      .filter((item): item is { url: string; format: FontMetadata["format"] } => Boolean(item));

    if (sources.length === 0) continue;
    const source = sources.slice().sort((a, b) => sourcePriority(b.format) - sourcePriority(a.format))[0];
    const familyStyle = splitFamilyAndStyle(familyRaw);
    const styleSeed = `${familyRaw} ${familyStyle.styleName} ${styleDecl}`;
    const isVariable = /variable/i.test(familyRaw) || /variable/i.test(familyStyle.styleName);
    const weight = weightDecl || inferWeight(styleSeed, isVariable);
    const style = inferStyle(styleSeed);
    const fileName = normalizeSpace(new URL(source.url).pathname.split("/").pop() || "");

    out.push({
      familyRaw,
      fullName: familyStyle.fullName,
      familyName: familyStyle.familyName,
      styleName: familyStyle.styleName,
      style,
      weight,
      isVariable,
      format: source.format,
      url: source.url,
      fileName
    });
  }

  return out;
};

const extractTitleHints = (html: string): string[] => {
  const out: string[] = [];
  const title = normalizeSpace(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  if (title) {
    const titleParts = title
      .split("|")
      .map((part) => normalizeSpace(part))
      .filter(Boolean);
    out.push(...titleParts);
  }
  const headings = Array.from(html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi))
    .map((match) => normalizeSpace(String(match[1] || "").replace(/<[^>]+>/g, "")))
    .filter(Boolean);
  out.push(...headings);
  return dedupeStrings(out);
};

const scoreCandidate = (textSeed: string, tokens: string[]): number => {
  if (tokens.length === 0) return 0;
  const haystack = normalizeToken(textSeed);
  if (!haystack) return 0;

  let score = 0;
  let matched = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (haystack.includes(token)) {
      score += 2;
      matched += 1;
    }
  }
  if (matched > 0 && matched === tokens.length) score += 2;
  return score;
};

const selectFacesForScope = (faces: ViktorZumegenFace[], scope: ViktorZumegenScope, pageHints: string[]): ViktorZumegenFace[] => {
  if (scope.mode === "catalog" || scope.tokens.length === 0) return faces;

  const hintTokens = dedupeStrings(pageHints)
    .flatMap((hint) => hint.split(/[\s\-_]+/g).map((token) => normalizeToken(token)))
    .filter((token) => token.length >= 2 && !VIKTORZUMEGEN_IGNORE_TOKENS.has(token));
  const tokens = dedupeStrings([...scope.tokens, ...hintTokens]);

  const scored = faces.map((face) => {
    const seed = `${face.familyRaw} ${face.fullName} ${face.familyName} ${face.styleName} ${face.fileName}`;
    return { face, score: scoreCandidate(seed, tokens) };
  });

  const max = Math.max(...scored.map((item) => item.score), 0);
  if (max <= 0) return faces;

  const threshold = max >= 4 ? max - 1 : max;
  const picked = scored.filter((row) => row.score >= threshold && row.score > 0).map((row) => row.face);
  return picked.length > 0 ? picked : faces;
};

const parseLicenseStyles = (html: string, baseUrl: string): ViktorZumegenLicenseStyle[] => {
  const out: ViktorZumegenLicenseStyle[] = [];
  const regex = /<input[^>]*type=["']checkbox["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']+)["'][^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const name = normalizeSpace(String(match[1] || ""));
    const value = normalizeSpace(String(match[2] || ""));
    if (!name || !value) continue;

    const windowStart = Math.max(0, (match.index || 0) - 220);
    const windowEnd = Math.min(html.length, (match.index || 0) + 420);
    const context = html.slice(windowStart, windowEnd);
    const hrefRaw = normalizeSpace(context.match(/href=["']([^"']+\.html(?:\?[^"']*)?)["']/i)?.[1] || "");
    const href = hrefRaw ? toAbsoluteUrl(hrefRaw, baseUrl) : undefined;

    out.push({ name, value, href });
  }

  return out;
};

const pickCatalogExpectedStyles = (
  styles: ViktorZumegenLicenseStyle[],
  scope: ViktorZumegenScope,
  pageHints: string[]
): string[] => {
  if (scope.mode !== "family") {
    return dedupeStrings(styles.filter((item) => item.name.startsWith("single-style-")).map((item) => item.value));
  }

  const hintTokens = dedupeStrings(pageHints)
    .flatMap((hint) => hint.split(/[\s\-_]+/g).map((token) => normalizeToken(token)))
    .filter((token) => token.length >= 2 && !VIKTORZUMEGEN_IGNORE_TOKENS.has(token));
  const tokens = dedupeStrings([...scope.tokens, ...hintTokens]);

  const singleStyles = styles.filter((item) => item.name.startsWith("single-style-"));
  const scored = singleStyles.map((item) => {
    const seed = `${item.name} ${item.value} ${item.href || ""}`;
    return { item, score: scoreCandidate(seed, tokens) };
  });

  const max = Math.max(...scored.map((row) => row.score), 0);
  if (max <= 0) return [];

  const threshold = max >= 4 ? max - 1 : max;
  return dedupeStrings(scored.filter((row) => row.score >= threshold && row.score > 0).map((row) => row.item.value));
};

const extractPdfUrls = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  const regex = /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const absolute = toAbsoluteUrl(String(match[1] || ""), baseUrl);
    if (absolute) out.add(absolute);
  }

  return Array.from(out.values());
};

const extractFeatureTags = (html: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/\b([a-z0-9]{4})\b/gi)) {
    const token = normalizeSpace(String(match[1] || "")).toLowerCase();
    if (VIKTORZUMEGEN_OT_TAGS.has(token)) out.add(token);
  }
  return Array.from(out.values()).sort();
};

const extractGlyphCount = (html: string): number | undefined => {
  let max = 0;
  for (const match of html.matchAll(/(\d{2,5})\+?\s*glyphs?/gi)) {
    const count = Number(match[1]);
    if (Number.isFinite(count) && count > max) max = count;
  }

  const listedCharacters = (html.match(/class=["'][^"']*\bcharacter\b[^"']*["']/gi) || []).length;
  if (listedCharacters > max) max = listedCharacters;

  return max > 0 ? max : undefined;
};

const extractLanguageCount = (html: string): number | undefined => {
  let max = 0;
  for (const match of html.matchAll(/(\d{2,4})\s*languages?/gi)) {
    const count = Number(match[1]);
    if (Number.isFinite(count) && count > max) max = count;
  }

  const languageSupportIndex = html.search(/language-support/i);
  if (languageSupportIndex >= 0) {
    const snippet = html.slice(languageSupportIndex, Math.min(html.length, languageSupportIndex + 140_000));
    const listCount = (snippet.match(/<li>/gi) || []).length;
    if (listCount > max) max = listCount;
  }

  return max > 0 ? max : undefined;
};

const dedupeFaces = (faces: ViktorZumegenFace[]): ViktorZumegenFace[] => {
  const out: ViktorZumegenFace[] = [];
  const seen = new Set<string>();

  for (const face of faces) {
    const key = `${normalizeToken(face.url)}::${normalizeToken(face.fullName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(face);
  }

  return out;
};

const toFoundryFamilyDisplay = (scope: ViktorZumegenScope, selectedFaces: ViktorZumegenFace[], pageHints: string[]): string => {
  if (scope.mode === "family" && selectedFaces.length > 0) {
    const grouped = dedupeStrings(selectedFaces.map((face) => face.familyName));
    if (grouped.length === 1 && grouped[0]) return grouped[0];
    if (grouped.length > 1 && scope.slug) return `VZWO ${scope.slug.replace(/[-_]+/g, " ")}`.replace(/\s+/g, " ").trim();
  }
  const hint = pageHints.find((item) => /choreo|varianz|vol|egen|elephant|scytheserif/i.test(item));
  if (hint) return hint;
  return "VZWO Type";
};

export const ViktorZumegenScraper: Scraper = {
  id: "viktorzumegen",
  name: "VZWO / Viktor Zumegen Precision Scraper",

  canHandle(url: string): boolean {
    return VIKTORZUMEGEN_HOST_RE.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = parseScope(url);
    const pageHtml = await fetchTextWithRetry(scope.targetUrl, {
      "User-Agent": VIKTORZUMEGEN_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: VIKTORZUMEGEN_ORIGIN
    });

    const pageHints = extractTitleHints(pageHtml);
    const [typefacesHtml, licensingHtml, styleCss] = await Promise.all([
      scope.mode === "catalog"
        ? Promise.resolve(pageHtml)
        : fetchTextWithRetry(VIKTORZUMEGEN_TYPEFACES_URL, {
            "User-Agent": VIKTORZUMEGEN_UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: scope.targetUrl
          }).catch(() => ""),
      fetchTextWithRetry(VIKTORZUMEGEN_LICENSING_URL, {
        "User-Agent": VIKTORZUMEGEN_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: scope.targetUrl
      }).catch(() => ""),
      fetchTextWithRetry(VIKTORZUMEGEN_STYLE_CSS_URL, {
        "User-Agent": VIKTORZUMEGEN_UA,
        Accept: "text/css,*/*;q=0.1",
        Referer: scope.targetUrl,
        Origin: VIKTORZUMEGEN_ORIGIN
      })
    ]);

    const allFaces = parseCssFaces(styleCss, VIKTORZUMEGEN_STYLE_CSS_URL);
    const pickedFaces = dedupeFaces(selectFacesForScope(allFaces, scope, pageHints));

    const fallbackFaces = scope.mode === "catalog" || pickedFaces.length > 0 ? pickedFaces : allFaces;
    const selectedFaces = dedupeFaces(fallbackFaces);

    const licensingStyles = licensingHtml ? parseLicenseStyles(licensingHtml, VIKTORZUMEGEN_LICENSING_URL) : [];
    const catalogExpectedStyles = pickCatalogExpectedStyles(licensingStyles, scope, pageHints);
    const expectedStyles = dedupeStrings(selectedFaces.map((face) => face.fullName));
    const styleMap = selectedFaces.map((face) => ({
      familyName: face.familyName,
      styleName: face.styleName,
      expectedStyle: face.fullName,
      style: face.style,
      weight: face.weight,
      sourceType: face.isVariable ? "variable" : "static",
      format: face.format,
      url: face.url
    }));

    const featureTags = dedupeStrings([
      ...extractFeatureTags(pageHtml),
      ...extractFeatureTags(typefacesHtml),
      ...extractFeatureTags(licensingHtml)
    ]).map((item) => item.toLowerCase());
    const glyphCount = extractGlyphCount(pageHtml);
    const languageCount = extractLanguageCount(pageHtml);
    const specimenPdfUrls = dedupeStrings([
      ...extractPdfUrls(pageHtml, scope.targetUrl),
      ...extractPdfUrls(typefacesHtml, VIKTORZUMEGEN_TYPEFACES_URL)
    ]);

    const familyDisplay = toFoundryFamilyDisplay(scope, selectedFaces, pageHints);
    const targetProfile: Record<string, unknown> = {
      profileId: "viktorzumegen-target-profile-v1",
      source: "viktorzumegen-static-css+catalog-html",
      foundry: "VZWO Type",
      styleScope: scope.mode === "family" ? "family-style" : "catalog",
      strictMissingStyles: scope.mode === "family",
      targetUrl: scope.targetUrl,
      targetSlug: scope.slug,
      familyDisplay,
      expectedStyles,
      expectedStyleCount: expectedStyles.length,
      styleMap,
      requiredFeatureTags: [],
      catalogFeatureTags: featureTags,
      catalogExpectedStyles,
      catalogExpectedStyleCount: catalogExpectedStyles.length,
      glyphCount,
      languageCount,
      specimenPdfUrls,
      collectedAt: new Date().toISOString()
    };

    const fonts: FontMetadata[] = selectedFaces.map((face) => ({
      url: face.url,
      family: face.familyName,
      format: face.format,
      style: face.style,
      weight: face.weight,
      downloadable: true,
      note: face.isVariable
        ? "VZWO variable source from canonical style.css."
        : "VZWO static source from canonical style.css.",
      metadata: {
        foundry: "VZWO Type",
        family: face.familyName,
        styleName: face.styleName,
        fullName: face.fullName,
        pageUrl: scope.targetUrl,
        targetUrl: scope.targetUrl,
        originalUrl: scope.inputUrl,
        sourceType: face.isVariable ? "variable" : "static",
        fileName: face.fileName,
        featureTags,
        glyphCount,
        languageCount,
        forceMetadataRepair: true,
        targetProfile,
        specimenPdfUrls,
        headers: {
          Origin: VIKTORZUMEGEN_ORIGIN,
          Referer: scope.targetUrl,
          Accept: "*/*",
          "User-Agent": VIKTORZUMEGEN_UA
        }
      }
    }));

    if (fonts.length === 0) {
      return {
        scraperName: this.name,
        foundryName: "VZWO Type",
        fonts: [
          {
            url: "browser-intercept",
            family: familyDisplay,
            format: "woff2",
            style: "Normal",
            weight: "Regular",
            downloadable: true,
            metadata: {
              foundry: "VZWO Type",
              pageUrl: scope.targetUrl,
              targetUrl: scope.targetUrl,
              targetProfile
            }
          }
        ],
        originalUrl: url,
        targetUrl: scope.targetUrl,
        metadata: {
          source: "viktorzumegen-fallback",
          fallbackMode: "browser-intercept",
          targetProfile
        }
      };
    }

    return {
      scraperName: this.name,
      foundryName: "VZWO Type",
      fonts,
      originalUrl: url,
      targetUrl: scope.targetUrl,
      expectedCount: expectedStyles.length > 0 ? expectedStyles.length : fonts.length,
      metadata: {
        source: "viktorzumegen-static-css+catalog-html",
        mode: scope.mode,
        slug: scope.slug,
        totalFonts: fonts.length,
        familyDisplay,
        targetProfile,
        specimenPdfUrls
      }
    };
  }
};
