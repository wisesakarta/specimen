import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const ABJAD_PRIMARY_HOST = "abjadfonts.com";
const ABJAD_BUY_HOST = "buy.abjadfonts.com";
const ABJAD_ORIGIN = "https://www.abjadfonts.com";
const ABJAD_FONTS_INDEX = `${ABJAD_ORIGIN}/fonts`;
const ABJAD_FETCH_TIMEOUT_MS = 30_000;
const ABJAD_FETCH_RETRIES = 3;
const ABJAD_SHARED_CSS_FALLBACK_URL =
  "https://cdn.prod.website-files.com/60c23bc36f5455701a45dcd7/css/abjadtypesubdomain.webflow.shared.e6e8042d7.css";
const ABJAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const ABJAD_RESERVED_PATHS = new Set([
  "",
  "about",
  "about-english",
  "contact",
  "custom-fonts",
  "fonts",
  "policies",
  "policies-arabic",
  "school"
]);

const ABJAD_BUY_SLUG_ALIAS: Record<string, string> = {
  "font-collection-1": "fontcollection01",
  "font-collection-02": "fontcollection02",
  manchette: "manchette-original",
  manchettefine: "manchette-fine",
  mostakbal2: "mostakbal-2"
};

const ABJAD_WEB_TO_BUY_SLUG_ALIAS: Record<string, string> = Object.fromEntries(
  Object.entries(ABJAD_BUY_SLUG_ALIAS).map(([buySlug, webSlug]) => [webSlug, buySlug])
);

const ABJAD_DEFAULT_FAMILY_SLUGS = [
  "daken",
  "dames",
  "fontcollection01",
  "fontcollection02",
  "manchette-fine",
  "manchette-modern",
  "manchette-original",
  "miknas",
  "mostakbal",
  "mostakbal-2",
  "mostakbal-extended",
  "muhandes"
];

const ABJAD_COLLECTION_MEMBER_SLUGS: Record<string, string[]> = {
  fontcollection01: [
    "daken",
    "dames",
    "miknas",
    "manchette-fine",
    "manchette-modern",
    "manchette-original",
    "mostakbal",
    "mostakbal-2",
    "mostakbal-extended",
    "muhandes"
  ],
  fontcollection02: [
    "daken",
    "dames",
    "miknas",
    "manchette-fine",
    "manchette-modern",
    "manchette-original",
    "mostakbal",
    "mostakbal-2",
    "mostakbal-extended",
    "muhandes"
  ]
};

const ABJAD_SLUG_TOKEN_HINTS: Record<string, string[]> = {
  daken: ["daken001", "xddv300000000xtest000vf"],
  dames: ["xtest00000000000mxxxovf", "xd2test000000000x0000000vf", "xdtest000000000000x000vf"],
  miknas: ["xmktest00000000xxxxvf", "xxtest000000xx000000000vf"],
  "manchette-modern": ["xxtest000000xx000000000vf", "testxx00m0fvf", "manchette"],
  "manchette-fine": ["testxx00m0fvf", "xtest00000000000mxxxovf", "manchette"],
  "manchette-original": ["xtest00000000000mxxxovf", "manchette"],
  mostakbal: ["mostakbal001vf"],
  "mostakbal-2": ["mostakbal2001vf"],
  "mostakbal-extended": ["mostakbalmomtad002vf"],
  muhandes: ["muhandes06vf", "muhandes04", "muhandes04hairline"],
  fontcollection01: ["fontcollection"],
  fontcollection02: ["fontcollection"]
};

const ABJAD_SLUG_FAMILY_ALLOWLIST: Record<string, string[]> = {
  daken: ["daken001", "xddv300000000xtest000vf"],
  dames: ["xtest00000000000mxxxovf", "xd2test000000000x0000000vf", "xdtest000000000000x000vf"],
  miknas: ["xmktest00000000xxxxvf", "xxtest000000xx000000000vf"],
  "manchette-modern": ["xxtest000000xx000000000vf", "testxx00m0fvf", "xtest00000000000mxxxovf"],
  "manchette-fine": ["testxx00m0fvf", "xtest00000000000mxxxovf"],
  "manchette-original": ["xtest00000000000mxxxovf"],
  mostakbal: ["mostakbal001vf"],
  "mostakbal-2": ["mostakbal2001vf"],
  "mostakbal-extended": ["mostakbalmomtad002vf"],
  muhandes: ["muhandes06vf", "muhandes04", "muhandes04hairline"]
};

const ABJAD_SLUG_FAMILY_DENY_TOKENS: Record<string, string[]> = {
  daken: ["mostakbal"],
  miknas: ["manchette", "jawakertext", "mostakbal"],
  "manchette-modern": ["manchettetext", "jawakertext"],
  "manchette-fine": ["manchettetext", "jawakertext"],
  "manchette-original": ["manchettetext", "jawakertext"],
  mostakbal: ["muhandes04"],
  "mostakbal-2": ["muhandes04"],
  "mostakbal-extended": ["muhandes04"]
};

const ABJAD_FOREIGN_FAMILY_TOKENS = [
  "jawaker",
  "deliveroo",
  "qatarairways",
  "capitalbank",
  "farah",
  "majlis",
  "floward",
  "webflowicons"
];

type AbjadScope = {
  mode: "catalog" | "family";
  targetUrl: string;
  familySlug?: string;
};

type AbjadFontFace = {
  family: string;
  srcUrl: string;
  format: FontMetadata["format"];
  weight?: string;
  style?: string;
  unicodeRange?: string;
};

type AbjadFamilyProfile = {
  slug: string;
  displayName: string;
  targetUrl: string;
  buyUrl?: string;
  scriptLabel?: string;
  languagesLabel?: string;
  weightsLabel?: string;
  yearPublished?: string;
  arabicDesigner?: string;
  fonts: FontMetadata[];
  expectedStyles: string[];
  sourceLimitedStyles: string[];
  specimenPdfUrls: string[];
  targetProfile: Record<string, unknown>;
  injectScript: string;
};

type FamilyUsage = {
  family: string;
  score: number;
  selectorHits: number;
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
    .replace(/[-_]+/g, " ")
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveHost = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, "");

const normalizeInputUrl = (rawUrl: string): URL => {
  try {
    return new URL(rawUrl);
  } catch {
    const prefixed = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(prefixed);
  }
};

const normalizeFamilySlug = (slug: string): string => {
  const normalized = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) return "";
  return ABJAD_BUY_SLUG_ALIAS[normalized] || normalized;
};

const toBuySlug = (slug: string): string => {
  const normalized = normalizeFamilySlug(slug);
  return ABJAD_WEB_TO_BUY_SLUG_ALIAS[normalized] || normalized;
};

const slugTokens = (slug: string): string[] => {
  const normalized = normalizeFamilySlug(slug);
  const pieces = normalized.split("-").map((part) => normalizeToken(part)).filter((part) => part.length >= 3);
  const collapsed = normalizeToken(normalized);
  return dedupeStringList([...pieces, collapsed]).map(normalizeToken).filter((token) => token.length >= 3);
};

const extractScope = (rawUrl: string): AbjadScope => {
  const parsed = normalizeInputUrl(rawUrl);
  const host = resolveHost(parsed);
  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());

  if (host === ABJAD_BUY_HOST) {
    const first = segments[0] || "";
    const slug = normalizeFamilySlug(first);
    if (!slug || ABJAD_RESERVED_PATHS.has(slug)) {
      return { mode: "catalog", targetUrl: ABJAD_FONTS_INDEX };
    }
    return {
      mode: "family",
      familySlug: slug,
      targetUrl: `${ABJAD_ORIGIN}/fonts/${slug}`
    };
  }

  if (host !== ABJAD_PRIMARY_HOST) {
    return { mode: "catalog", targetUrl: ABJAD_FONTS_INDEX };
  }

  if (segments[0] === "fonts" && segments[1]) {
    const slug = normalizeFamilySlug(segments[1]);
    if (slug && !ABJAD_RESERVED_PATHS.has(slug)) {
      return {
        mode: "family",
        familySlug: slug,
        targetUrl: `${ABJAD_ORIGIN}/fonts/${slug}`
      };
    }
  }

  const maybeSlug = normalizeFamilySlug(segments[0] || "");
  if (maybeSlug && !ABJAD_RESERVED_PATHS.has(maybeSlug)) {
    return {
      mode: "family",
      familySlug: maybeSlug,
      targetUrl: `${ABJAD_ORIGIN}/fonts/${maybeSlug}`
    };
  }

  return { mode: "catalog", targetUrl: ABJAD_FONTS_INDEX };
};

const detectFontFormat = (url: string): FontMetadata["format"] | undefined => {
  const lower = url.toLowerCase();
  if (lower.includes(".woff2")) return "woff2";
  if (lower.includes(".woff")) return "woff";
  if (lower.includes(".otf")) return "otf";
  if (lower.includes(".ttf")) return "ttf";
  if (lower.includes(".eot")) return "eot";
  if (lower.includes(".zip")) return "zip";
  return undefined;
};

const fetchTextWithRetry = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ABJAD_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ABJAD_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": ABJAD_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: referer || ABJAD_FONTS_INDEX,
          Origin: ABJAD_ORIGIN
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < ABJAD_FETCH_RETRIES) await sleep(320 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
};

const extractMetaContent = (html: string, property: string): string | undefined => {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  return asString(html.match(pattern)?.[1]);
};

const extractCssUrl = (html: string, baseUrl: string): string | undefined => {
  const sharedPattern = /<link[^>]+href=["']([^"']*abjadtypesubdomain\.webflow\.shared[^"']*\.css[^"']*)["'][^>]*>/i;
  const sharedHit = asString(html.match(sharedPattern)?.[1]);
  if (sharedHit) {
    try {
      return new URL(sharedHit, baseUrl).href;
    } catch {
      // ignore
    }
  }
  return ABJAD_SHARED_CSS_FALLBACK_URL;
};

const parseCssDeclaration = (block: string, key: string): string | undefined => {
  const pattern = new RegExp(`${escapeRegExp(key)}\\s*:\\s*([^;]+);?`, "i");
  return asString(block.match(pattern)?.[1]);
};

const normalizeFamilyName = (value: string): string =>
  normalizeSpace(
    value
      .split(",")[0]
      .replace(/^['"]|['"]$/g, "")
      .replace(/!important/gi, "")
  );

const extractFontFaces = (cssText: string, cssUrl: string): AbjadFontFace[] => {
  const out: AbjadFontFace[] = [];
  const seen = new Set<string>();
  const faceBlockPattern = /@font-face\s*\{[^}]*\}/gi;

  for (const blockMatch of cssText.matchAll(faceBlockPattern)) {
    const block = blockMatch[0];
    const rawFamily = parseCssDeclaration(block, "font-family");
    const family = rawFamily ? normalizeFamilyName(rawFamily) : "";
    if (!family) continue;

    const srcDecl = parseCssDeclaration(block, "src");
    if (!srcDecl) continue;
    const weight = parseCssDeclaration(block, "font-weight");
    const style = parseCssDeclaration(block, "font-style");
    const unicodeRange = parseCssDeclaration(block, "unicode-range");

    for (const srcMatch of srcDecl.matchAll(/url\(([^)]+)\)/gi)) {
      const rawUrl = normalizeSpace(String(srcMatch[1] || "").replace(/^['"]|['"]$/g, ""));
      if (!rawUrl || rawUrl.startsWith("data:")) continue;
      let resolvedUrl: string;
      try {
        resolvedUrl = new URL(rawUrl, cssUrl).href;
      } catch {
        continue;
      }
      const format = detectFontFormat(resolvedUrl);
      if (!format) continue;

      const key = `${normalizeToken(family)}|${resolvedUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        family,
        srcUrl: resolvedUrl,
        format,
        weight,
        style,
        unicodeRange
      });
    }
  }

  return out;
};

const collectFamilyUsage = (cssText: string, slug: string): Map<string, FamilyUsage> => {
  const usage = new Map<string, FamilyUsage>();
  const tokens = slugTokens(slug);

  const addUsage = (family: string, score: number) => {
    const key = normalizeToken(family);
    if (!key) return;
    const prev = usage.get(key);
    if (prev) {
      prev.score += score;
      prev.selectorHits += 1;
      return;
    }
    usage.set(key, { family, score, selectorHits: 1 });
  };

  for (const match of cssText.matchAll(/([^{}@][^{}]*)\{([^{}]+)\}/g)) {
    const selector = normalizeSpace(match[1] || "");
    const body = String(match[2] || "");
    if (!selector || !/font-family\s*:/i.test(body)) continue;

    const selectorToken = normalizeToken(selector);
    const tokenHits = tokens.filter((token) => selectorToken.includes(token)).length;
    if (tokenHits === 0) continue;

    const scoreBase = 1 + tokenHits + (/font-variation-settings\s*:/i.test(body) ? 3 : 0);
    for (const familyMatch of body.matchAll(/font-family\s*:\s*([^;]+);?/gi)) {
      const family = normalizeFamilyName(asString(familyMatch[1]) || "");
      if (!family) continue;
      addUsage(family, scoreBase);
    }
  }

  return usage;
};

const familyTokenHintsForSlug = (slug: string): string[] => {
  const normalized = normalizeFamilySlug(slug);
  const direct = ABJAD_SLUG_TOKEN_HINTS[normalized] || [];
  return dedupeStringList(direct).map(normalizeToken).filter(Boolean);
};

const familyAllowTokensForSlug = (slug: string): string[] => {
  const normalized = normalizeFamilySlug(slug);
  const direct = ABJAD_SLUG_FAMILY_ALLOWLIST[normalized] || [];
  return dedupeStringList(direct).map(normalizeToken).filter(Boolean);
};

const familyDenyTokensForSlug = (slug: string): string[] => {
  const normalized = normalizeFamilySlug(slug);
  const direct = ABJAD_SLUG_FAMILY_DENY_TOKENS[normalized] || [];
  return dedupeStringList(direct).map(normalizeToken).filter(Boolean);
};

const isForeignFamilyForSlug = (familyToken: string, slug: string): boolean => {
  const slugTokenList = slugTokens(slug);
  const foreign = ABJAD_FOREIGN_FAMILY_TOKENS.find((token) => familyToken.includes(token));
  if (!foreign) return false;
  return !slugTokenList.some((token) => token.includes(foreign) || foreign.includes(token));
};

const isAllowedFamilyForSlug = (familyToken: string, slug: string): boolean => {
  const allow = familyAllowTokensForSlug(slug);
  if (allow.length === 0) return true;
  return allow.some((token) => familyToken.includes(token) || token.includes(familyToken));
};

const isDeniedFamilyForSlug = (familyToken: string, slug: string): boolean => {
  const deny = familyDenyTokensForSlug(slug);
  return deny.some((token) => familyToken.includes(token) || token.includes(familyToken));
};

const selectTargetFamilies = (params: {
  usage: Map<string, FamilyUsage>;
  fontFaces: AbjadFontFace[];
  familySlug: string;
}): string[] => {
  const { usage, fontFaces, familySlug } = params;
  const slugTokenList = slugTokens(familySlug);
  const hints = familyTokenHintsForSlug(familySlug);

  const faceByToken = new Map<string, string>();
  for (const face of fontFaces) {
    const token = normalizeToken(face.family);
    if (!token || faceByToken.has(token)) continue;
    faceByToken.set(token, face.family);
  }

  const ranked = Array.from(usage.values())
    .filter((item) => faceByToken.has(normalizeToken(item.family)))
    .sort((a, b) => b.score - a.score || b.selectorHits - a.selectorHits);

  const usageTokens = new Set(Array.from(usage.keys()));
  const hintedFamilies = fontFaces
    .map((face) => face.family)
    .filter((family) => {
      const token = normalizeToken(family);
      if (!token) return false;
      if (!hints.some((hint) => token.includes(hint) || hint.includes(token))) return false;
      if (usageTokens.size === 0) return true;
      return usageTokens.has(token);
    });

  const fallbackHintedFamilies =
    hintedFamilies.length > 0
      ? hintedFamilies
      : fontFaces
          .map((face) => face.family)
          .filter((family) => {
            const token = normalizeToken(family);
            return token ? hints.some((hint) => token.includes(hint) || hint.includes(token)) : false;
          });

  let selected = dedupeStringList([...fallbackHintedFamilies, ...ranked.map((row) => row.family)]).slice(0, 10);

  selected = selected.filter((family) => {
    const token = normalizeToken(family);
    if (!token) return false;
    if (isForeignFamilyForSlug(token, familySlug)) return false;
    if (!isAllowedFamilyForSlug(token, familySlug)) return false;
    if (isDeniedFamilyForSlug(token, familySlug)) return false;
    return true;
  });

  if (selected.length > 0) {
    const strictHinted = selected.filter((family) => {
      const token = normalizeToken(family);
      return hints.some((hint) => token.includes(hint) || hint.includes(token));
    });
    if (strictHinted.length > 0) return dedupeStringList(strictHinted).slice(0, 4);

    const slugMatched = selected.filter((family) => {
      const token = normalizeToken(family);
      return slugTokenList.some((slugToken) => token.includes(slugToken) || slugToken.includes(token));
    });
    if (slugMatched.length > 0) return dedupeStringList(slugMatched).slice(0, 4);

    return dedupeStringList(selected).slice(0, 4);
  }

  const fallback = fontFaces
    .map((face) => face.family)
    .filter((family) => {
      const token = normalizeToken(family);
      if (!token) return false;
      if (isForeignFamilyForSlug(token, familySlug)) return false;
      if (!isAllowedFamilyForSlug(token, familySlug)) return false;
      if (isDeniedFamilyForSlug(token, familySlug)) return false;
      if (hints.length === 0) return true;
      return hints.some((hint) => token.includes(hint) || hint.includes(token));
    });

  return dedupeStringList(fallback).slice(0, 3);
};

const parseWeightLabel = (weight?: string): string => {
  const value = normalizeSpace(weight || "");
  if (!value) return "Regular";
  if (/^\d+\s+\d+$/.test(value) || /^\d+\s*-\s*\d+$/.test(value)) return "Variable";
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    const cleaned = value.replace(/^normal$/i, "Regular");
    return cleaned || "Regular";
  }
  if (numeric <= 150) return "Thin";
  if (numeric <= 250) return "ExtraLight";
  if (numeric <= 350) return "Light";
  if (numeric <= 450) return "Regular";
  if (numeric <= 550) return "Medium";
  if (numeric <= 650) return "SemiBold";
  if (numeric <= 750) return "Bold";
  if (numeric <= 850) return "ExtraBold";
  return "Black";
};

const inferWeightFromSourceFamily = (sourceFamily?: string): string | undefined => {
  const token = normalizeToken(sourceFamily || "");
  if (!token) return undefined;
  if (token.includes("hairline")) return "Hairline";
  if (token.includes("variable") || token.endsWith("vf")) return "Variable";
  if (token.includes("extralight") || token.includes("ultralight")) return "ExtraLight";
  if (token.includes("thin")) return "Thin";
  if (token.includes("light")) return "Light";
  if (token.includes("book")) return "Book";
  if (token.includes("extrabold") || token.includes("ultrabold")) return "ExtraBold";
  if (token.includes("semibold") || token.includes("demibold")) return "SemiBold";
  if (token.includes("black") || token.includes("heavy")) return "Black";
  if (token.includes("bold")) return "Bold";
  if (token.includes("medium")) return "Medium";
  if (token.includes("regular")) return "Regular";
  return undefined;
};

const parseStyleLabel = (style?: string, sourceFamily?: string): "Normal" | "Italic" => {
  const probe = `${normalizeSpace(style || "")} ${normalizeSpace(sourceFamily || "")}`;
  return /italic|oblique/i.test(probe) ? "Italic" : "Normal";
};

const toStyleSlug = (label: string): string =>
  normalizeSpace(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "regular";

const extractPdfLinks = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  const pattern = /https?:\/\/[^"'\s>]+?\.pdf(?:\?[^"'\s>]*)?|\/[^"'\s>]+?\.pdf(?:\?[^"'\s>]*)?/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = asString(match[0]);
    if (!raw) continue;
    try {
      const resolved = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw, baseUrl);
      const host = resolveHost(resolved);
      if (host !== ABJAD_PRIMARY_HOST && host !== ABJAD_BUY_HOST) continue;
      out.add(resolved.href);
    } catch {
      // ignore malformed
    }
  }
  return Array.from(out);
};

const extractDisplayNameFromPage = (html: string, slug: string): string => {
  const ogTitle = normalizeSpace(extractMetaContent(html, "og:title") || "");
  if (ogTitle) return ogTitle.replace(/\s+\|.+$/g, "").trim();

  const title = normalizeSpace(asString(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]) || "");
  if (title) {
    const cleaned = title
      .replace(/^abjad\s*type\s*foundry\s*[-–:]\s*/i, "")
      .replace(/[-–:]\s*abjad\s*type\s*foundry$/i, "")
      .trim();
    if (cleaned) return cleaned;
  }

  return titleCase(slug);
};

const parseDeclaredStylesFromBuyHtml = (buyHtml: string): string[] => {
  if (!buyHtml) return [];
  const out: string[] = [];
  const knownStyles = [
    "Thin",
    "ExtraLight",
    "Light",
    "Regular",
    "Medium",
    "SemiBold",
    "Bold",
    "ExtraBold",
    "Black",
    "Variable"
  ];

  for (const match of buyHtml.matchAll(/<label[^>]+for=["']weight-\d+["'][^>]*>([\s\S]*?)<\/label>/gi)) {
    const labelHtml = String(match[1] || "").replace(/<[^>]+>/g, " ");
    const normalized = normalizeSpace(labelHtml);
    if (!normalized) continue;
    const hit = knownStyles.find((style) => new RegExp(`\\b${escapeRegExp(style)}\\b`, "i").test(normalized));
    if (hit) out.push(hit);
  }

  return dedupeStringList(out);
};

const buildInjectScript = (families: string[], slug: string): string => {
  const familiesJson = JSON.stringify(families);
  const slugToken = JSON.stringify(slug);
  return `
    (async () => {
      const families = ${familiesJson};
      const slug = ${slugToken};
      const sample = "\\u0633\\u0644\\u0627\\u0645 Abjad 012345";
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      if (slug) {
        const nodes = Array.from(document.querySelectorAll("[class*='" + slug + "']"));
        for (const node of nodes.slice(0, 180)) {
          try {
            if (node instanceof HTMLElement) {
              node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
              node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
              node.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
            }
          } catch {}
        }
      }

      if (document.fonts && document.fonts.load) {
        for (let i = 0; i < 3; i += 1) {
          await Promise.all(
            families.map((family) =>
              document.fonts.load('72px "' + family + '"', sample).catch(() => undefined)
            )
          );
          await sleep(240);
        }
      }

      await sleep(900);
      window.__specimen_abjad_probe_done = true;
    })();
  `;
};

const buildFallbackTargetProfile = (slugInput: string, displayName: string, targetUrl: string) => {
  const slug = normalizeFamilySlug(slugInput);
  const selectedSourceFamilies = dedupeStringList([
    ...(ABJAD_SLUG_FAMILY_ALLOWLIST[slug] || []),
    ...(ABJAD_SLUG_TOKEN_HINTS[slug] || [])
  ]);
  const expectedAssetTokens = selectedSourceFamilies.map((item) => normalizeToken(item)).filter(Boolean);

  return {
    profileId: "abjad-target-profile-fallback-v1",
    source: "abjad-browser-intercept-fallback",
    foundry: "Abjad Type Foundry",
    styleScope: "family-style",
    strictMissingStyles: false,
    family: displayName,
    familyDisplay: displayName,
    familySlug: slug,
    targetUrl,
    expectedStyles: displayName ? [`${displayName} Variable`] : [],
    expectedStyleCount: 1,
    selectedSourceFamilies,
    expectedAssetTokens,
    outputNaming: {
      prefix: "abjad-type-foundry",
      pattern: "abjad-type-foundry-{family-slug}-{style-slug}.{ext}",
      separator: "-",
      styleTokenCase: "lowercase"
    },
    disableInstanceExplosion: true,
    forceMetadataRepair: true,
    outputFormats: ["woff2", "woff", "ttf", "otf"],
    collectedAt: new Date().toISOString()
  };
};

const buildFallbackFamilyResult = (slugInput: string, targetUrl: string, error: unknown): ScrapeResult => {
  const slug = normalizeFamilySlug(slugInput);
  const displayName = titleCase(slug || "abjad");
  const targetProfile = buildFallbackTargetProfile(slug, displayName, targetUrl);
  const selectedSourceFamilies = Array.isArray(targetProfile.selectedSourceFamilies)
    ? targetProfile.selectedSourceFamilies.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return {
    scraperName: AbjadTypeScraper.name,
    foundryName: "Abjad Type Foundry",
    fonts: [
      {
        url: "browser-intercept",
        family: displayName,
        format: "woff2",
        weight: "Variable",
        style: "Normal",
        downloadable: true,
        note: "Abjad browser intercept fallback.",
        metadata: {
          foundry: "Abjad Type Foundry",
          family: displayName,
          familySlug: slug,
          styleName: "Variable",
          fullName: `${displayName} Variable`,
          targetUrl,
          pageUrl: targetUrl,
          selectedSourceFamilies,
          targetProfile,
          fallbackReason: error instanceof Error ? error.message : String(error)
        }
      }
    ],
    originalUrl: targetUrl,
    targetUrl,
    injectScript: buildInjectScript(selectedSourceFamilies, slug),
    expectedCount: 1,
    metadata: {
      foundry: "Abjad Type Foundry",
      mode: "family",
      familySlug: slug,
      familyDisplay: displayName,
      sourceLimitedStyles: [],
      targetProfile,
      specimenPdfUrls: [],
      fallbackReason: error instanceof Error ? error.message : String(error)
    }
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

const extractFamilySlugsFromCatalog = (html: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = asString(match[1]);
    if (!href) continue;

    let parsed: URL;
    try {
      parsed = /^https?:\/\//i.test(href) ? new URL(href) : new URL(href, ABJAD_ORIGIN);
    } catch {
      continue;
    }

    const host = resolveHost(parsed);
    if (host !== ABJAD_PRIMARY_HOST && host !== ABJAD_BUY_HOST) continue;

    const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
    if (segments.length === 0) continue;

    const slugCandidate =
      host === ABJAD_BUY_HOST
        ? normalizeFamilySlug(segments[0] || "")
        : segments[0] === "fonts"
          ? normalizeFamilySlug(segments[1] || "")
          : normalizeFamilySlug(segments[0] || "");

    if (!slugCandidate || ABJAD_RESERVED_PATHS.has(slugCandidate)) continue;
    out.add(slugCandidate);
  }

  return Array.from(out);
};

const collectFamilyProfile = async (slugInput: string): Promise<AbjadFamilyProfile> => {
  const slug = normalizeFamilySlug(slugInput);
  const targetUrl = `${ABJAD_ORIGIN}/fonts/${slug}`;
  const buySlug = toBuySlug(slug);
  const buyUrlCandidate = `https://${ABJAD_BUY_HOST}/${buySlug}`;

  let html = "";
  try {
    html = await fetchTextWithRetry(targetUrl, ABJAD_FONTS_INDEX);
  } catch {
    html = "";
  }

  const displayName = html ? extractDisplayNameFromPage(html, slug) : titleCase(slug);
  const scriptLabel = html ? asString(html.match(/Script:\s*([^<\n\r]+)/i)?.[1]) : undefined;
  const languagesLabel = html ? asString(html.match(/Languages:\s*([^<\n\r]+)/i)?.[1]) : undefined;
  const weightsLabel = html ? asString(html.match(/Weights:\s*([^<\n\r]+)/i)?.[1]) : undefined;
  const yearPublished = html ? asString(html.match(/Year Published:\s*([^<\n\r]+)/i)?.[1]) : undefined;
  const arabicDesigner = html ? asString(html.match(/Arabic Designer:\s*([^<\n\r]+)/i)?.[1]) : undefined;
  const specimenPdfUrls = html ? extractPdfLinks(html, targetUrl) : [];

  const buyUrlMatch = html
    ? asString(html.match(/href=["'](https:\/\/buy\.abjadfonts\.com\/[^"']+)["'][^>]*>\s*(?:شراء|BUY)/i)?.[1])
    : undefined;
  const buyUrl = buyUrlMatch || buyUrlCandidate;

  let buyHtml = "";
  try {
    buyHtml = await fetchTextWithRetry(buyUrl, targetUrl);
  } catch {
    buyHtml = "";
  }
  const declaredStyles = parseDeclaredStylesFromBuyHtml(buyHtml);

  const cssUrl = extractCssUrl(html, targetUrl) || ABJAD_SHARED_CSS_FALLBACK_URL;
  const cssText = await fetchTextWithRetry(cssUrl, targetUrl);
  const fontFaces = extractFontFaces(cssText, cssUrl);
  if (fontFaces.length === 0) throw new Error(`No @font-face assets found for ${targetUrl}`);

  const usage = collectFamilyUsage(cssText, slug);
  const targetFamilies = selectTargetFamilies({ usage, fontFaces, familySlug: slug });
  if (targetFamilies.length === 0) {
    throw new Error(`No target source family resolved for ${targetUrl}`);
  }

  const targetFamilyTokens = new Set(targetFamilies.map((family) => normalizeToken(family)));
  let selectedFaces = fontFaces.filter((face) => targetFamilyTokens.has(normalizeToken(face.family)));

  if (selectedFaces.length === 0) {
    const hints = familyTokenHintsForSlug(slug);
    if (hints.length > 0) {
      selectedFaces = fontFaces.filter((face) => {
        const token = normalizeToken(face.family);
        return hints.some((hint) => token.includes(hint) || hint.includes(token));
      });
    }
  }

  if (selectedFaces.length === 0) {
    throw new Error(`No slug-scoped font faces resolved for ${targetUrl}`);
  }

  const fonts: FontMetadata[] = [];
  const styleRows: Array<Record<string, unknown>> = [];
  const seenUrl = new Set<string>();
  const seenStyleFormat = new Set<string>();
  const usageScoreByToken = new Map<string, number>(
    Array.from(usage.entries()).map(([token, row]) => [token, row.score])
  );
  const selectedFacesSorted = [...selectedFaces].sort((a, b) => {
    const scoreA = usageScoreByToken.get(normalizeToken(a.family)) || 0;
    const scoreB = usageScoreByToken.get(normalizeToken(b.family)) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.srcUrl.localeCompare(b.srcUrl);
  });

  for (let index = 0; index < selectedFacesSorted.length; index += 1) {
    const face = selectedFacesSorted[index];
    if (seenUrl.has(face.srcUrl)) continue;
    seenUrl.add(face.srcUrl);

    const inferredWeight = inferWeightFromSourceFamily(face.family);
    const parsedWeight = parseWeightLabel(face.weight);
    const weightLabel = parsedWeight === "Regular" && inferredWeight ? inferredWeight : parsedWeight;
    const styleLabel = parseStyleLabel(face.style, face.family);
    const familyStyleLabel = styleLabel === "Italic" ? `${weightLabel} Italic` : weightLabel;
    const styleFormatKey = `${normalizeToken(familyStyleLabel)}|${String(face.format || "").toLowerCase()}`;
    if (seenStyleFormat.has(styleFormatKey)) continue;
    seenStyleFormat.add(styleFormatKey);

    const expectedStyle = `${displayName} ${familyStyleLabel}`;
    const styleSlug = toStyleSlug(familyStyleLabel);
    const sourceToken = normalizeToken(face.family).slice(0, 8) || `f${index + 1}`;
    const fileNameHint = `abjad-${slug}-${styleSlug}-${sourceToken}.${face.format}`;

    styleRows.push({
      sourceFamily: face.family,
      sourceUrl: face.srcUrl,
      expectedStyle,
      style: styleLabel,
      weight: weightLabel,
      unicodeRange: face.unicodeRange || "U+0-10FFFF"
    });

    fonts.push({
      url: face.srcUrl,
      format: face.format,
      family: displayName,
      style: styleLabel,
      weight: weightLabel,
      downloadable: true,
      note: "Abjad slug-scoped CSS font-face asset.",
      metadata: {
        foundry: "Abjad Type Foundry",
        family: displayName,
        familySlug: slug,
        styleName: familyStyleLabel,
        fullName: expectedStyle,
        sourceFamily: face.family,
        sourceUrl: face.srcUrl,
        pageUrl: targetUrl,
        targetUrl,
        buyUrl,
        script: scriptLabel,
        languages: languagesLabel,
        weightsDeclared: weightsLabel,
        yearPublished,
        arabicDesigner,
        declaredStyles,
        fileNameHint,
        disableInstanceExplosion: true,
        forceMetadataRepair: true
      }
    });
  }

  const expectedStyles = dedupeStringList(styleRows.map((row) => String(row.expectedStyle || ""))).filter(Boolean);
  const sourceLimitedStyles = declaredStyles
    .map((style) => `${displayName} ${style}`)
    .filter((declared) => !expectedStyles.some((existing) => normalizeToken(existing) === normalizeToken(declared)));

  const targetProfile = {
    profileId: "abjad-target-profile-v2",
    source: "abjad-webflow-shared-css-scope",
    foundry: "Abjad Type Foundry",
    styleScope: "family-style",
    strictMissingStyles: false,
    family: displayName,
    familyDisplay: displayName,
    familySlug: slug,
    targetUrl,
    buyUrl,
    script: scriptLabel,
    languages: languagesLabel,
    weightsDeclared: weightsLabel,
    yearPublished,
    arabicDesigner,
    declaredStyles,
    expectedStyles,
    sourceLimitedStyles,
    expectedStyleCount: expectedStyles.length,
    styleMap: styleRows,
    selectedSourceFamilies: targetFamilies,
    specimenPdfUrls,
    outputNaming: {
      prefix: "abjad-type-foundry",
      pattern: "abjad-type-foundry-{family-slug}-{style-slug}.{ext}",
      separator: "-",
      styleTokenCase: "lowercase"
    },
    disableInstanceExplosion: true,
    forceMetadataRepair: true,
    outputFormats: ["woff2", "woff", "ttf", "otf"],
    collectedAt: new Date().toISOString()
  };

  const injectScript = buildInjectScript(targetFamilies, slug);
  for (const font of fonts) {
    font.metadata = {
      ...(font.metadata as Record<string, unknown>),
      targetProfile
    };
  }

  return {
    slug,
    displayName,
    targetUrl,
    buyUrl,
    scriptLabel,
    languagesLabel,
    weightsLabel,
    yearPublished,
    arabicDesigner,
    fonts,
    expectedStyles,
    sourceLimitedStyles,
    specimenPdfUrls,
    targetProfile,
    injectScript
  };
};


const collectResolvedFamilyProfile = async (slugInput: string): Promise<AbjadFamilyProfile> => {
  const slug = normalizeFamilySlug(slugInput);
  const memberSlugs = ABJAD_COLLECTION_MEMBER_SLUGS[slug] || [];
  if (memberSlugs.length === 0) {
    return collectFamilyProfile(slug);
  }

  let collectionHtml = "";
  const collectionUrl = `${ABJAD_ORIGIN}/fonts/${slug}`;
  try {
    collectionHtml = await fetchTextWithRetry(collectionUrl, ABJAD_FONTS_INDEX);
  } catch {
    collectionHtml = "";
  }

  const settled = await mapLimit(memberSlugs, 2, async (memberSlug) => {
    try {
      const profile = await collectFamilyProfile(memberSlug);
      return { ok: true as const, profile };
    } catch (error) {
      return {
        ok: false as const,
        slug: memberSlug,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  const okProfiles = settled.filter((item) => item.ok).map((item) => item.profile);
  if (okProfiles.length === 0) {
    const failed = settled.filter((item) => !item.ok).map((item) => `${item.slug}: ${item.error}`);
    throw new Error(`No collection members resolved for ${collectionUrl} (${failed.join(" | ")})`);
  }

  const displayName = collectionHtml
    ? extractDisplayNameFromPage(collectionHtml, slug)
    : titleCase(slug);
  const scriptLabel = asString(collectionHtml.match(/Script:\s*([^<\n\r]+)/i)?.[1]);
  const languagesLabel = asString(collectionHtml.match(/Languages:\s*([^<\n\r]+)/i)?.[1]);
  const weightsLabel = asString(collectionHtml.match(/Weights:\s*([^<\n\r]+)/i)?.[1]);
  const yearPublished = asString(collectionHtml.match(/Year Published:\s*([^<\n\r]+)/i)?.[1]);
  const arabicDesigner = asString(collectionHtml.match(/Arabic Designer:\s*([^<\n\r]+)/i)?.[1]);
  const specimenPdfUrls = dedupeStringList(okProfiles.flatMap((item) => item.specimenPdfUrls));

  const fonts: FontMetadata[] = [];
  const seenUrl = new Set<string>();
  for (const profile of okProfiles) {
    for (const font of profile.fonts) {
      if (seenUrl.has(font.url)) continue;
      seenUrl.add(font.url);
      fonts.push({
        ...font,
        metadata: {
          ...(font.metadata as Record<string, unknown>),
          collectionSlug: slug,
          collectionDisplayName: displayName,
          sourceCollectionUrl: collectionUrl
        }
      });
    }
  }

  const expectedStyles = dedupeStringList(
    fonts
      .map((font) => {
        const metadata = (font.metadata || {}) as Record<string, unknown>;
        const fullName = asString(metadata.fullName);
        if (fullName) return fullName;
        const styleName = asString(metadata.styleName) || "Regular";
        return `${font.family} ${styleName}`.trim();
      })
      .filter(Boolean)
  );
  const sourceLimitedStyles = dedupeStringList(okProfiles.flatMap((item) => item.sourceLimitedStyles));
  const selectedSourceFamilies = dedupeStringList(
    okProfiles.flatMap((item) => {
      const profile = item.targetProfile as Record<string, unknown>;
      const selected = Array.isArray(profile.selectedSourceFamilies) ? profile.selectedSourceFamilies : [];
      return selected.map((entry) => String(entry));
    })
  );

  const targetProfile = {
    profileId: "abjad-target-profile-collection-v1",
    source: "abjad-webflow-shared-css-scope",
    foundry: "Abjad Type Foundry",
    styleScope: "family-style",
    strictMissingStyles: false,
    family: displayName,
    familyDisplay: displayName,
    familySlug: slug,
    targetUrl: collectionUrl,
    collectionMembers: memberSlugs,
    memberCount: okProfiles.length,
    expectedStyles,
    sourceLimitedStyles,
    expectedStyleCount: expectedStyles.length,
    selectedSourceFamilies,
    specimenPdfUrls,
    outputNaming: {
      prefix: "abjad-type-foundry",
      pattern: "abjad-type-foundry-{family-slug}-{style-slug}.{ext}",
      separator: "-",
      styleTokenCase: "lowercase"
    },
    disableInstanceExplosion: true,
    forceMetadataRepair: true,
    outputFormats: ["woff2", "woff", "ttf", "otf"],
    collectedAt: new Date().toISOString()
  };

  const injectScript = buildInjectScript(selectedSourceFamilies, slug);
  for (const font of fonts) {
    font.metadata = {
      ...(font.metadata as Record<string, unknown>),
      targetProfile
    };
  }

  return {
    slug,
    displayName,
    targetUrl: collectionUrl,
    buyUrl: undefined,
    scriptLabel,
    languagesLabel,
    weightsLabel,
    yearPublished,
    arabicDesigner,
    fonts,
    expectedStyles,
    sourceLimitedStyles,
    specimenPdfUrls,
    targetProfile,
    injectScript
  };
};

const collectResolvedFamilyProfileWithRetry = async (slugInput: string): Promise<AbjadFamilyProfile> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await collectResolvedFamilyProfile(slugInput);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(350 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to resolve Abjad family profile for ${slugInput}`);
};

export const AbjadTypeScraper: Scraper = {
  id: "abjad-type",
  name: "Abjad Type Precision Scraper",

  canHandle(url: string): boolean {
    try {
      const parsed = normalizeInputUrl(url);
      const host = resolveHost(parsed);
      return host === ABJAD_PRIMARY_HOST || host === ABJAD_BUY_HOST;
    } catch {
      return /abjadfonts\.com/i.test(url);
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const scope = extractScope(url);

      if (scope.mode === "family" && scope.familySlug) {
        try {
          const family = await collectResolvedFamilyProfileWithRetry(scope.familySlug);
          return {
            scraperName: this.name,
            foundryName: "Abjad Type Foundry",
            fonts: family.fonts,
            originalUrl: url,
            targetUrl: family.targetUrl,
            injectScript: family.injectScript,
            expectedCount: family.expectedStyles.length > 0 ? family.expectedStyles.length : family.fonts.length,
            metadata: {
              foundry: "Abjad Type Foundry",
              mode: "family",
              familySlug: family.slug,
              familyDisplay: family.displayName,
              sourceLimitedStyles: family.sourceLimitedStyles,
              targetProfile: family.targetProfile,
              specimenPdfUrls: family.specimenPdfUrls
            }
          };
        } catch (familyError) {
          return buildFallbackFamilyResult(scope.familySlug, scope.targetUrl, familyError);
        }
      }

      let catalogHtml = "";
      try {
        catalogHtml = await fetchTextWithRetry(ABJAD_FONTS_INDEX, ABJAD_FONTS_INDEX);
      } catch {
        catalogHtml = "";
      }

      const extractedSlugs = catalogHtml ? extractFamilySlugsFromCatalog(catalogHtml).slice(0, 24) : [];
      const slugs = extractedSlugs.length > 0 ? extractedSlugs : ABJAD_DEFAULT_FAMILY_SLUGS;

      const settled = await mapLimit(slugs, 2, async (slug) => {
        try {
          const family = await collectResolvedFamilyProfileWithRetry(slug);
          return { slug, ok: true as const, family };
        } catch (error) {
          return {
            slug,
            ok: false as const,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      });

      const okFamilies = settled.filter((row) => row.ok).map((row) => row.family);
      const failedFamilies = settled.filter((row) => !row.ok).map((row) => ({ slug: row.slug, error: row.error }));

      const fonts = okFamilies.flatMap((family) => family.fonts);
      const expectedStyles = dedupeStringList(okFamilies.flatMap((family) => family.expectedStyles));
      const injectScript = buildInjectScript(
        dedupeStringList(okFamilies.flatMap((family) => (family.targetProfile.selectedSourceFamilies as string[]) || [])),
        ""
      );

      const targetProfile = {
        profileId: "abjad-target-profile-catalog-v2",
        source: "abjad-webflow-shared-css-scope",
        foundry: "Abjad Type Foundry",
        styleScope: "family-style",
        strictMissingStyles: false,
        family: "Abjad Type Foundry",
        familyDisplay: "Abjad Type Foundry",
        targetUrl: ABJAD_FONTS_INDEX,
        expectedStyles,
        expectedStyleCount: expectedStyles.length,
        familyCount: okFamilies.length,
        specimenPdfUrls: dedupeStringList(okFamilies.flatMap((family) => family.specimenPdfUrls)),
        collectedAt: new Date().toISOString()
      };

      return {
        scraperName: this.name,
        foundryName: "Abjad Type Foundry",
        fonts,
        originalUrl: url,
        targetUrl: ABJAD_FONTS_INDEX,
        injectScript,
        expectedCount: expectedStyles.length > 0 ? expectedStyles.length : fonts.length || undefined,
        metadata: {
          foundry: "Abjad Type Foundry",
          mode: "catalog",
          familyCount: okFamilies.length,
          failedFamilies,
          targetProfile
        }
      };
    } catch (error) {
      return {
        scraperName: this.name,
        foundryName: "Abjad Type Foundry",
        fonts: [],
        originalUrl: url,
        metadata: {
          foundry: "Abjad Type Foundry",
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};

