import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const HANLI_HOST = "type.hanli.eu";
const HANLI_ORIGIN = `https://${HANLI_HOST}`;
const HANLI_HOME_URL = `${HANLI_ORIGIN}/home/`;
const HANLI_FETCH_TIMEOUT_MS = 30000;
const HANLI_FETCH_MAX_RETRIES = 3;
const HANLI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const HANLI_KNOWN_FAMILY_SLUGS = [
  "gap",
  "magic",
  "colant",
  "four-grotesk",
  "twins",
  "repost",
  "matex",
  "vincent",
  "timezone"
];

const HANLI_BLOCKED_LINK_SLUGS = new Set([
  "",
  "home",
  "info",
  "trials",
  "bespoke",
  "shop",
  "cart",
  "checkout",
  "my-account",
  "wp-admin",
  "wp-content",
  "wp-includes",
  "wp-json",
  "feed",
  "category",
  "tag",
  "author"
]);

const HANLI_LEGAL_PDF_RE = /\b(eula|license|licen[cs]e|terms|agreement|privacy|cookie|policy|refund)\b/i;
const HANLI_GENERIC_FONT_RE = /^(edition\s+international|arial|helvetica|times\s+new\s+roman|sans-serif|serif)/i;
const HANLI_NON_FAMILY_SLUG_RE = /(note|notes|release|manual|origin|origins|typepad)/i;

const HANLI_SLUG_ALIAS_MAP: Record<string, string[]> = {
  gap: ["gap"],
  magic: ["magic", "high", "mid", "low"],
  colant: ["colant"],
  "four-grotesk": ["four", "grotesk", "fourgrotesk"],
  twins: ["twins"],
  repost: ["repost"],
  matex: ["matex"],
  vincent: ["vincent"],
  timezone: ["timezone"]
};

type HanliScope = {
  mode: "catalog" | "family";
  targetUrl: string;
  familySlug?: string;
};

type HanliFamilyProfile = {
  slug: string;
  targetUrl: string;
  displayName: string;
  expectedStyles: string[];
  specimenPdfUrls: string[];
  injectScript: string;
  targetProfile: Record<string, unknown>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeSpace = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const titleCase = (value: string): string =>
  normalizeSpace(value)
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const dedupeStringList = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizeSpace(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

const normalizeInputUrl = (url: string): URL => {
  try {
    return new URL(url);
  } catch {
    const prefixed = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(prefixed);
  }
};

const normalizeHanliUrl = (url: string): string => {
  const parsed = normalizeInputUrl(url);
  parsed.protocol = "https:";
  parsed.hostname = HANLI_HOST;
  parsed.hash = "";
  return parsed.href;
};

const extractScope = (url: string): HanliScope => {
  const normalized = normalizeHanliUrl(url);
  const parsed = new URL(normalized);
  const segments = parsed.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
  const first = segments[0] || "";

  if (!first || first === "home") {
    return { mode: "catalog", targetUrl: HANLI_HOME_URL };
  }

  if (HANLI_BLOCKED_LINK_SLUGS.has(first)) {
    return { mode: "catalog", targetUrl: HANLI_HOME_URL };
  }

  return {
    mode: "family",
    familySlug: first,
    targetUrl: `${HANLI_ORIGIN}/${first}/`
  };
};

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= HANLI_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HANLI_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": HANLI_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: referer || HANLI_HOME_URL,
          Origin: HANLI_ORIGIN
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < HANLI_FETCH_MAX_RETRIES) {
        await sleep(350 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Hanli fetch failed: ${url}`);
};

const extractFamilySlugsFromHome = (html: string): string[] => {
  const out = new Set<string>();
  const hrefRe = /href=["']([^"']+)["']/gi;

  for (const match of html.matchAll(hrefRe)) {
    const href = asString(match[1]);
    if (!href) continue;

    let absolute: URL;
    try {
      absolute = /^https?:\/\//i.test(href) ? new URL(href) : new URL(href, HANLI_ORIGIN);
    } catch {
      continue;
    }

    const host = absolute.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== HANLI_HOST) continue;

    const first = absolute.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
    if (!first) continue;
    if (HANLI_BLOCKED_LINK_SLUGS.has(first)) continue;
    if (first.includes(".")) continue;
    if (!HANLI_NON_FAMILY_SLUG_RE.test(first)) out.add(first);
  }

  return dedupeStringList([...HANLI_KNOWN_FAMILY_SLUGS, ...Array.from(out)]).map((slug) => slug.toLowerCase());
};

const extractFontFamiliesFromHtml = (html: string): string[] => {
  const out: string[] = [];
  const re = /font-family\s*:\s*([^;"'}<\n]+|['"][^'"]+['"])/gi;

  for (const match of html.matchAll(re)) {
    const raw = asString(match[1]);
    if (!raw) continue;

    const primary = raw.split(",")[0] || raw;
    const cleaned = normalizeSpace(
      primary
        .replace(/^['"]|['"]$/g, "")
        .replace(/!important/gi, "")
        .replace(/&quot;/gi, "")
    );

    if (!cleaned) continue;
    out.push(cleaned);
  }

  return dedupeStringList(out);
};

const extractPdfLinks = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  const re = /https?:\/\/[^"'\s>]+?\.pdf(?:\?[^"'\s>]*)?|\/[^"'\s>]+?\.pdf(?:\?[^"'\s>]*)?/gi;

  for (const match of html.matchAll(re)) {
    const raw = asString(match[0]);
    if (!raw) continue;
    try {
      const absolute = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw, baseUrl);
      if (absolute.hostname.toLowerCase().replace(/^www\./, "") !== HANLI_HOST) continue;
      const href = absolute.href;
      if (HANLI_LEGAL_PDF_RE.test(href)) continue;
      out.add(href);
    } catch {
      // ignore invalid link
    }
  }

  return Array.from(out);
};

const slugTokens = (slug: string): string[] => {
  const baseTokens = slug
    .split(/[-_]+/g)
    .map((part) => normalizeToken(part))
    .filter((token) => token.length >= 3);
  const aliases = HANLI_SLUG_ALIAS_MAP[slug] || [];
  const aliasTokens = aliases.map((item) => normalizeToken(item)).filter((token) => token.length >= 3);
  return dedupeStringList([...baseTokens, ...aliasTokens]);
};

const filterTargetStyles = (styles: string[], slug: string): string[] => {
  const tokens = slugTokens(slug);
  const filtered = styles.filter((styleName) => {
    if (HANLI_GENERIC_FONT_RE.test(styleName)) return false;
    if (!/^hal\s+/i.test(styleName)) return false;

    if (tokens.length === 0) return true;
    const norm = normalizeToken(styleName);
    return tokens.some((token) => norm.includes(token));
  });

  if (filtered.length > 0) return dedupeStringList(filtered);

  // Last fallback: keep HAL styles only.
  return dedupeStringList(styles.filter((styleName) => /^hal\s+/i.test(styleName) && !HANLI_GENERIC_FONT_RE.test(styleName)));
};

const canonicalizeHanliStyleName = (styleName: string): string | undefined => {
  const normalized = normalizeSpace(styleName);
  if (!normalized) return undefined;

  if (/^HAL\s+Colant\s+Regular\s+Display$/i.test(normalized)) return "HAL Colant Display Regular";
  if (/^HAL\s+Colant\s+Regular\s+Text$/i.test(normalized)) return "HAL Colant Text Regular";
  if (/^HAL\s+Colant\s+Regular$/i.test(normalized)) return undefined;

  if (/^HAL\s+Four\s+Grotesk\s+Italic$/i.test(normalized)) return "HAL Four Grotesk Regular Italic";

  if (/^HAL\s+Twins\s+01$/i.test(normalized)) return undefined;

  return normalized;
};

const normalizeHanliExpectedStyles = (styles: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const style of styles) {
    const canonical = canonicalizeHanliStyleName(style);
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }

  return out;
};

const familyDisplayFromTitle = (html: string, slug: string): string => {
  const title = asString(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]) || "";
  const right = normalizeSpace(title.split("–")[1] || title.split("|")[1] || "");
  if (right && !/^hal\s*typefaces$/i.test(right)) {
    const normalized = /^hal\s+/i.test(right) ? right : `HAL ${right}`;
    return normalizeSpace(normalized);
  }
  return `HAL ${titleCase(slug)}`;
};

const inferFamilyDisplayFromStyles = (styles: string[], slug: string): string => {
  const first = styles[0] || "";
  if (first) {
    const parts = first.split(" ");
    if (parts.length >= 2) {
      return normalizeSpace(parts.slice(0, 2).join(" "));
    }
  }
  return `HAL ${titleCase(slug)}`;
};

const toStyleMapRow = (styleName: string) => {
  const isItalic = /italic|oblique/i.test(styleName);
  return {
    styleName,
    expectedStyle: styleName,
    style: isItalic ? "Italic" : "Normal",
    weight: /thin/i.test(styleName)
      ? "Thin"
      : /extralight|ultralight/i.test(styleName)
        ? "ExtraLight"
        : /light/i.test(styleName)
          ? "Light"
          : /book/i.test(styleName)
            ? "Book"
            : /medium/i.test(styleName)
              ? "Medium"
              : /semibold|demibold/i.test(styleName)
                ? "SemiBold"
                : /bold/i.test(styleName)
                  ? "Bold"
                  : /heavy/i.test(styleName)
                    ? "Heavy"
                    : /ultra/i.test(styleName)
                      ? "Ultra"
                      : "Regular"
  };
};

const buildInjectScript = (fontFamilies: string[]): string => {
  const familiesJson = JSON.stringify(fontFamilies);
  return `
    (async () => {
      const families = ${familiesJson};
      const sample = 'Hamburgefonsiv 0123456789 AaBbCcDdEeFfGg';

      const probe = document.createElement('div');
      probe.setAttribute('data-specimen-hanli-probe', '1');
      probe.style.position = 'fixed';
      probe.style.left = '-99999px';
      probe.style.top = '-99999px';
      probe.style.opacity = '0';
      probe.style.pointerEvents = 'none';
      probe.style.whiteSpace = 'nowrap';

      for (const family of families) {
        const node = document.createElement('span');
        node.textContent = sample;
        node.style.display = 'block';
        node.style.fontSize = '32px';
        node.style.fontFamily = family;
        probe.appendChild(node);
      }
      document.body.appendChild(probe);

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      if (document.fonts && document.fonts.load) {
        for (let i = 0; i < 3; i += 1) {
          await Promise.all(
            families.map((family) =>
              document.fonts
                .load('32px "' + family + '"', sample)
                .catch(() => undefined)
            )
          );
          await sleep(220);
        }
      }

      await sleep(900);
      window.__specimen_hanli_probe_done = true;
    })();
  `;
};

const buildTargetProfile = (params: {
  slug: string;
  displayName: string;
  targetUrl: string;
  expectedStyles: string[];
  specimenPdfUrls: string[];
}): Record<string, unknown> => ({
  profileId: "hanli-target-profile-v1",
  source: "hanli-wordpress-fontdue-css",
  foundry: "HAL Typefaces",
  styleScope: "family-style",
  strictMissingStyles: true,
  targetUrl: params.targetUrl,
  family: params.displayName,
  familyDisplay: params.displayName,
  familySlug: params.slug,
  expectedStyles: params.expectedStyles,
  expectedStyleCount: params.expectedStyles.length,
  styleMap: params.expectedStyles.map((styleName) => toStyleMapRow(styleName)),
  requiredFeatureTags: [],
  specimenPdfUrls: params.specimenPdfUrls,
  outputNaming: {
    prefix: "hal-typefaces",
    pattern: "hal-typefaces-{family-slug}-{style-slug}.{ext}",
    separator: "-",
    styleTokenCase: "lowercase"
  },
  outputFormats: ["woff2", "woff", "ttf", "otf"],
  collectedAt: new Date().toISOString()
});

const collectFamilyProfile = async (slug: string): Promise<HanliFamilyProfile> => {
  const targetUrl = `${HANLI_ORIGIN}/${slug}/`;
  const html = await fetchTextWithRetry(targetUrl, HANLI_HOME_URL);
  const allStyles = extractFontFamiliesFromHtml(html);
  const expectedStyles = normalizeHanliExpectedStyles(filterTargetStyles(allStyles, slug));
  const displayName =
    familyDisplayFromTitle(html, slug) ||
    inferFamilyDisplayFromStyles(expectedStyles, slug) ||
    `HAL ${titleCase(slug)}`;
  const specimenPdfUrls = extractPdfLinks(html, targetUrl);
  const injectScript = buildInjectScript(expectedStyles);
  const targetProfile = buildTargetProfile({
    slug,
    displayName,
    targetUrl,
    expectedStyles,
    specimenPdfUrls
  });

  return {
    slug,
    targetUrl,
    displayName,
    expectedStyles,
    specimenPdfUrls,
    injectScript,
    targetProfile
  };
};

const toPlaceholderFont = (family: HanliFamilyProfile): FontMetadata => ({
  url: "browser-intercept",
  family: family.displayName,
  format: "woff2",
  style: "Normal",
  weight: "Regular",
  downloadable: true,
  note: "HAL Typefaces browser-intercept mode.",
  metadata: {
    foundry: "HAL Typefaces",
    family: family.displayName,
    targetUrl: family.targetUrl,
    pageUrl: family.targetUrl,
    targetProfile: family.targetProfile
  }
});

const buildFallbackFamilyProfile = (slugInput: string): HanliFamilyProfile => {
  const slug = String(slugInput || "").toLowerCase().replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "-");
  const displayName = `HAL ${titleCase(slug)}`.trim();
  const targetUrl = `${HANLI_ORIGIN}/${slug}/`;
  const expectedStyles = [`${displayName} Regular`];
  const targetProfile = {
    ...buildTargetProfile({
      slug,
      displayName,
      targetUrl,
      expectedStyles,
      specimenPdfUrls: []
    }),
    strictMissingStyles: false,
    expectedAssetTokens: [`hal${slug}`, slug].map((value) => value.toLowerCase())
  };

  return {
    slug,
    targetUrl,
    displayName,
    expectedStyles,
    specimenPdfUrls: [],
    injectScript: buildInjectScript(expectedStyles),
    targetProfile
  };
};

const mapLimit = async <T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.floor(limit));

  const run = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
  return out;
};

export const HanliTypeScraper: Scraper = {
  id: "hanli-type",
  name: "HAL Typefaces Deep Browser Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(type\.)?hanli\.eu/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const scope = extractScope(url);

      if (scope.mode === "family" && scope.familySlug) {
        let family: HanliFamilyProfile;
        try {
          family = await collectFamilyProfile(scope.familySlug);
        } catch (familyError) {
          family = buildFallbackFamilyProfile(scope.familySlug);
          family.targetProfile = {
            ...(family.targetProfile || {}),
            fallbackReason: familyError instanceof Error ? familyError.message : String(familyError)
          };
        }
        return {
          scraperName: this.name,
          foundryName: "HAL Typefaces",
          fonts: [toPlaceholderFont(family)],
          originalUrl: url,
          targetUrl: family.targetUrl,
          injectScript: family.injectScript,
          expectedCount: family.expectedStyles.length || undefined,
          metadata: {
            foundry: "HAL Typefaces",
            mode: "family",
            familySlug: family.slug,
            familyDisplay: family.displayName,
            expectedStyleCount: family.expectedStyles.length,
            targetProfile: family.targetProfile,
            specimenPdfUrls: family.specimenPdfUrls,
            fonts: [toPlaceholderFont(family)]
          }
        };
      }

      const homeHtml = await fetchTextWithRetry(HANLI_HOME_URL, HANLI_HOME_URL);
      const slugs = extractFamilySlugsFromHome(homeHtml);

      const familySettled = await mapLimit(slugs, 3, async (slug) => {
        try {
          const family = await collectFamilyProfile(slug);
          return { slug, ok: true as const, family };
        } catch (error) {
          return {
            slug,
            ok: false as const,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      });

      const okFamilies = familySettled.filter((row) => row.ok).map((row) => row.family);
      const failedFamilies = familySettled
        .filter((row) => !row.ok)
        .map((row) => ({ slug: row.slug, error: row.error }));

      if (okFamilies.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "HAL Typefaces",
          fonts: [],
          originalUrl: url,
          targetUrl: HANLI_HOME_URL,
          metadata: {
            foundry: "HAL Typefaces",
            mode: "catalog",
            failedFamilies
          }
        };
      }

      const fonts = okFamilies.map((family) => toPlaceholderFont(family));
      const expectedStyles = dedupeStringList(okFamilies.flatMap((family) => family.expectedStyles));
      const aggregateTargetProfile = {
        profileId: "hanli-target-profile-catalog-v1",
        source: "hanli-wordpress-fontdue-css",
        foundry: "HAL Typefaces",
        styleScope: "family-style",
        strictMissingStyles: false,
        targetUrl: HANLI_HOME_URL,
        family: "HAL Typefaces",
        familyDisplay: "HAL Typefaces",
        expectedStyles,
        expectedStyleCount: expectedStyles.length,
        requiredFeatureTags: [],
        specimenPdfUrls: dedupeStringList(okFamilies.flatMap((family) => family.specimenPdfUrls)),
        collectedAt: new Date().toISOString()
      };

      const injectScript = buildInjectScript(expectedStyles);

      return {
        scraperName: this.name,
        foundryName: "HAL Typefaces",
        fonts,
        originalUrl: url,
        targetUrl: HANLI_HOME_URL,
        injectScript,
        expectedCount: expectedStyles.length || undefined,
        metadata: {
          foundry: "HAL Typefaces",
          mode: "catalog",
          familyCount: okFamilies.length,
          families: okFamilies.map((family) => ({
            familySlug: family.slug,
            familyDisplay: family.displayName,
            expectedStyleCount: family.expectedStyles.length,
            specimenPdfCount: family.specimenPdfUrls.length,
            targetUrl: family.targetUrl
          })),
          failedFamilies,
          targetProfile: aggregateTargetProfile,
          fonts
        }
      };
    } catch (error) {
      console.error("[HanliTypeScraper] Error:", error);
      const scope = extractScope(url);
      if (scope.mode === "family" && scope.familySlug) {
        const family = buildFallbackFamilyProfile(scope.familySlug);
        family.targetProfile = {
          ...(family.targetProfile || {}),
          fallbackReason: error instanceof Error ? error.message : String(error)
        };
        return {
          scraperName: this.name,
          foundryName: "HAL Typefaces",
          fonts: [toPlaceholderFont(family)],
          originalUrl: url,
          targetUrl: family.targetUrl,
          injectScript: family.injectScript,
          expectedCount: family.expectedStyles.length || undefined,
          metadata: {
            foundry: "HAL Typefaces",
            mode: "family",
            familySlug: family.slug,
            familyDisplay: family.displayName,
            expectedStyleCount: family.expectedStyles.length,
            targetProfile: family.targetProfile,
            specimenPdfUrls: family.specimenPdfUrls,
            fonts: [toPlaceholderFont(family)],
            fallbackReason: error instanceof Error ? error.message : String(error)
          }
        };
      }
      return {
        scraperName: this.name,
        foundryName: "HAL Typefaces",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
