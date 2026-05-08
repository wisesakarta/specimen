import type { Scraper, ScrapeResult } from "./scraper-protocol";

const KLIM_HOST = "klim.co.nz";
const KLIM_FETCH_TIMEOUT_MS = 25000;
const KLIM_FETCH_MAX_RETRIES = 3;
const KLIM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

type KlimScope = {
  targetUrl: string;
  familySlug?: string;
  familyDisplay: string;
  familyTokens: string[];
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeToken = (value: string): string =>
  String(value || "")
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

const familySlugToDisplay = (slug?: string): string => {
  if (!slug) return "Klim Family";
  const withSpaces = slug
    .replace(/^ft-?/i, "FT ")
    .replace(/-/g, " ");
  const titled = toTitleCase(withSpaces);
  return titled || "Klim Family";
};

const normalizeKlimUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === `www.${KLIM_HOST}`) parsed.hostname = KLIM_HOST;
  parsed.hash = "";
  return parsed.href;
};

const parseScope = (rawUrl: string): KlimScope => {
  const normalizedUrl = normalizeKlimUrl(rawUrl);
  const parsed = new URL(normalizedUrl);
  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  const collectionIndex = segments.findIndex((segment) => segment === "collections" || segment === "typefaces");
  const familySlug = collectionIndex >= 0 && segments[collectionIndex + 1] ? segments[collectionIndex + 1] : undefined;
  const familyDisplay = familySlugToDisplay(familySlug);

  const tokens = new Set<string>();
  if (familySlug) tokens.add(normalizeToken(familySlug));
  if (familySlug) {
    // Handle common transliteration variants: soehne -> sohne, haeufig -> haufig, etc.
    tokens.add(normalizeToken(familySlug.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")));
  }
  tokens.add(normalizeToken(familyDisplay));

  return {
    targetUrl: normalizedUrl,
    familySlug,
    familyDisplay,
    familyTokens: Array.from(tokens).filter(Boolean)
  };
};

const fetchTextWithRetry = async (url: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= KLIM_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KLIM_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": KLIM_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < KLIM_FETCH_MAX_RETRIES) await sleep(400 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Klim fetch failed");
};

const extractSpecimenPdfUrls = (html: string, pageUrl: string): string[] => {
  const out = new Set<string>();
  const add = (raw: string) => {
    const candidate = normalizeSpace(raw);
    if (!candidate) return;
    try {
      const parsed = /^https?:\/\//i.test(candidate)
        ? new URL(candidate)
        : candidate.startsWith("//")
          ? new URL(`https:${candidate}`)
          : new URL(candidate, pageUrl);
      const href = parsed.href;
      if (/\.pdf(?:$|[?#])/i.test(href) || /\/media\/documents\/.+\.pdf(?:$|[?#])/i.test(href)) {
        out.add(href);
      }
    } catch {
      // ignore malformed candidates
    }
  };

  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi)) add(String(match[0] || ""));
  for (const match of html.matchAll(/["'](\/[^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) add(String(match[1] || ""));
  for (const match of html.matchAll(/["'](\/\/[^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) add(String(match[1] || ""));
  return Array.from(out).sort();
};

const splitFileWords = (fileStem: string): string[] =>
  fileStem
    .replace(/[_]+/g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .split(/[^A-Za-z0-9]+/g)
    .map((part) => normalizeToken(part))
    .filter(Boolean);

const trimHashedTail = (words: string[]): string[] => {
  const out = [...words];
  while (out.length > 0) {
    const tail = out[out.length - 1];
    const isShortHashLike = /^[a-z0-9]{6,10}$/i.test(tail) && /[a-z]/i.test(tail) && /\d/.test(tail);
    const isLongHashLike = /^[0-9a-f]{12,}$/i.test(tail);
    if (!isShortHashLike && !isLongHashLike) break;
    out.pop();
  }
  return out;
};

const sanitizeStyleWords = (words: string[]): string[] => {
  const filtered = words.filter((word) => {
    if (!word) return false;
    if (/^\d+$/.test(word)) return false;
    if (/^[a-z0-9]{4,12}$/i.test(word) && /[a-z]/i.test(word) && /\d/.test(word)) return false;
    if (/^[0-9a-f]{12,}$/i.test(word)) return false;
    return true;
  });

  const out = [...filtered];
  while (out.length > 0 && out[out.length - 1].length <= 2) out.pop();
  return out;
};

const KLIM_STYLE_LEXICON = new Set([
  "soehne",
  "sohne",
  "breit",
  "schmal",
  "mono",
  "ikon",
  "buch",
  "kraftig",
  "leicht",
  "extraleicht",
  "fett",
  "halbfett",
  "dreiviertelfett",
  "extrafett",
  "italic",
  "kursiv",
  "regular",
  "bold",
  "light",
  "medium",
  "black",
  "thin"
]);

const isCleanStyleHint = (label: string): boolean => {
  const words = label
    .split(/\s+/g)
    .map((part) => normalizeToken(part))
    .filter(Boolean);
  if (words.length === 0) return false;
  return words.every((word) => KLIM_STYLE_LEXICON.has(word));
};

const extractStyleHints = (html: string, familyTokens: string[]): string[] => {
  const out = new Set<string>();
  const urlMatches = [
    ...html.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:woff2?|ttf|otf)(?:\?[^\s"'<>]*)?/gi),
    ...html.matchAll(/["'](\/[^"']+?\.(?:woff2?|ttf|otf)(?:\?[^"']*)?)["']/gi),
    ...html.matchAll(/["'](\/\/[^"']+?\.(?:woff2?|ttf|otf)(?:\?[^"']*)?)["']/gi)
  ];

  for (const match of urlMatches) {
    const raw = String(match[1] || match[0] || "");
    const stem = normalizeSpace(raw.split(/[?#]/)[0].split("/").pop()?.replace(/\.(woff2?|ttf|otf)$/i, "") || "");
    if (!stem) continue;
    const words = splitFileWords(stem);
    if (words.length === 0) continue;
    const stemToken = words.join("");

    const matchesFamily = familyTokens.length === 0 || familyTokens.some((token) => token && stemToken.includes(token));
    if (!matchesFamily) continue;

    let styleWords = [...words];
    for (const token of familyTokens) {
      if (!token) continue;
      if (stemToken.startsWith(token)) {
        let consumed = 0;
        let built = "";
        for (const word of words) {
          if (built.length >= token.length) break;
          built += word;
          consumed += 1;
        }
        styleWords = words.slice(consumed);
        break;
      }
    }

    styleWords = sanitizeStyleWords(trimHashedTail(styleWords));
    if (styleWords.length === 0) continue;
    const styleLabel = toTitleCase(styleWords.join(" ").replace(/\bkursiv\b/gi, "Italic"));
    if (styleLabel && isCleanStyleHint(styleLabel)) out.add(styleLabel);
  }

  return Array.from(out).sort();
};

const buildInjectScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const controls = Array.from(
      document.querySelectorAll(
        "button,a,[role='button'],input,textarea,[contenteditable],[class*='style'],[class*='specimen'],[class*='weight'],[class*='axis']"
      )
    );

    for (const node of controls.slice(0, 280)) {
      try {
        if (node instanceof HTMLElement) {
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
            node.focus();
            node.value = "Hamburgefontsiv 0123456789";
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      } catch {}
      await sleep(40);
    }

    for (let pass = 0; pass < 4; pass += 1) {
      window.scrollTo(0, Math.floor(document.body.scrollHeight * ((pass + 1) / 4)));
      await sleep(450);
    }
  })();
`;

export const KlimScraper: Scraper = {
  id: "klim",
  name: "Klim Precision Scraper",

  canHandle(url: string): boolean {
    try {
      return /(^|\.)klim\.co\.nz$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const scope = parseScope(url);

    let html = "";
    try {
      html = await fetchTextWithRetry(scope.targetUrl);
    } catch {
      // Keep browser-intercept fallback even if prefetch failed.
    }

    const specimenPdfUrls = html ? extractSpecimenPdfUrls(html, scope.targetUrl) : [];
    const styleHints = html ? extractStyleHints(html, scope.familyTokens) : [];
    const expectedStyles = styleHints.map((style) => `${scope.familyDisplay} ${style}`);

    const targetProfile = {
      profileId: "klim-target-v2",
      source: "klim-page-prefetch+browser-intercept",
      foundry: "Klim Type Foundry",
      family: scope.familyDisplay,
      familyDisplay: scope.familyDisplay,
      familySlug: scope.familySlug,
      targetUrl: scope.targetUrl,
      styleScope: "family-style",
      strictMissingStyles: false,
      failOnTrialAssets: false,
      expectedStyles,
      expectedStyleCount: expectedStyles.length,
      styleHints,
      specimenPdfUrls
    } as Record<string, unknown>;

    return {
      scraperName: this.name,
      foundryName: "Klim Type Foundry",
      originalUrl: url,
      targetUrl: scope.targetUrl,
      injectScript: buildInjectScript(),
      expectedCount: expectedStyles.length > 0 ? expectedStyles.length : undefined,
      fonts: [
        {
          url: "browser-intercept",
          format: "woff2",
          family: scope.familyDisplay,
          weight: "Regular",
          style: "Normal",
          downloadable: true,
          note: "Klim extraction via browser interception.",
          metadata: {
            foundry: "Klim Type Foundry",
            family: scope.familyDisplay,
            familySlug: scope.familySlug,
            pageUrl: scope.targetUrl,
            targetUrl: scope.targetUrl,
            specimenPdfUrls,
            targetProfile
          }
        }
      ],
      metadata: {
        foundry: "Klim Type Foundry",
        family: scope.familyDisplay,
        familySlug: scope.familySlug,
        specimenPdfUrls,
        targetProfile
      }
    };
  }
};
